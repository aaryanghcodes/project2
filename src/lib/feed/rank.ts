/**
 * Building a page of the feed: retrieve → score → filter → assemble.
 *
 * The shape of this follows PLAN.md §5. The one thing worth understanding
 * before changing anything here is why retrieval and scoring are separate
 * steps: pgvector can find the nearest few hundred articles to a centroid very
 * fast using the index, but it cannot express the full scoring formula. So the
 * database narrows the field and application code does the judgement.
 */

import { db } from "@/lib/db";
import { toSqlVector, parseSqlVector } from "@/lib/vector";
import { loadCentroids, type Centroid } from "@/lib/profile/centroids";
import { savedArticleIds } from "@/lib/saved/saved";
import { scoreArticle, type ScoredArticle } from "./scoring";

export const PAGE_SIZE = 12;

/** Candidates pulled per positive centroid. */
const CANDIDATES_PER_CENTROID = 200;

/** Nothing older than this reaches the feed. */
const MAX_AGE_DAYS = 7;

/**
 * Share of slots reserved for articles outside the user's current taste.
 *
 * PLAN.md §5 is blunt about why: without it the feed collapses into a bubble
 * within a week and stops discovering the interests we are trying to find. It
 * costs a little relevance now to keep the profile improving later.
 */
const EXPLORATION_RATIO = 0.15;

export interface FeedItem {
  id: string;
  title: string;
  description: string | null;
  url: string;
  sourceName: string;
  imageUrl: string | null;
  publishedAt: Date;
  storyClusterId: string | null;
  /** The interest label behind "why am I seeing this", when we can name one. */
  reason: string | null;
  exploration: boolean;
  score: number;
  /** Whether this user has bookmarked it. Display only — never scored. */
  saved: boolean;
}

interface CandidateRow {
  id: string;
  title: string;
  description: string | null;
  summary: string | null;
  url: string;
  source_name: string;
  image_url: string | null;
  published_at: Date;
  story_cluster_id: string | null;
  quality_score: number;
  embedding: string;
}

/**
 * Pull candidates near each positive centroid.
 *
 * One query per centroid rather than one query with an OR: pgvector's index
 * serves `ORDER BY embedding <=> $1 LIMIT n` and nothing else, so a combined
 * query would fall back to a sequential scan over the whole table.
 */
async function retrieveCandidates(
  userId: string,
  positives: Centroid[],
): Promise<Map<string, CandidateRow>> {
  const byId = new Map<string, CandidateRow>();

  const perCentroid = await Promise.all(
    positives.map((centroid) =>
      db.$queryRawUnsafe<CandidateRow[]>(
        `SELECT a.id, a.title, a.description, a.summary, a.url, a.source_name,
                a.image_url, a.published_at, a.story_cluster_id,
                a.quality_score, a.embedding::text AS embedding
         FROM articles a
         WHERE a.embedding IS NOT NULL
           AND a.published_at > now() - ($2 || ' days')::interval
           AND NOT EXISTS (
             SELECT 1 FROM impressions i
             WHERE i.article_id = a.id AND i.user_id = $3
           )
         ORDER BY a.embedding <=> $1::vector
         LIMIT $4`,
        toSqlVector(centroid.vector),
        String(MAX_AGE_DAYS),
        userId,
        CANDIDATES_PER_CENTROID,
      ),
    ),
  );

  for (const rows of perCentroid) {
    for (const row of rows) byId.set(row.id, row);
  }

  return byId;
}

/**
 * Candidates for the exploration slots: recent, good, and *not* near the
 * user's profile.
 *
 * Deliberately ordered by quality rather than sampled at random. Random
 * exploration mostly surfaces routine wire copy, which teaches the profile
 * nothing and trains the user to ignore the slots. High-quality items they did
 * not ask for are the ones that can actually change their mind.
 */
async function retrieveExploration(
  userId: string,
  excludeIds: string[],
  limit: number,
): Promise<CandidateRow[]> {
  if (limit <= 0) return [];

  return db.$queryRawUnsafe<CandidateRow[]>(
    `SELECT a.id, a.title, a.description, a.summary, a.url, a.source_name,
            a.image_url, a.published_at, a.story_cluster_id,
            a.quality_score, a.embedding::text AS embedding
     FROM articles a
     WHERE a.embedding IS NOT NULL
       AND a.published_at > now() - ($1 || ' days')::interval
       AND NOT (a.id = ANY($2::text[]))
       AND NOT EXISTS (
         SELECT 1 FROM impressions i
         WHERE i.article_id = a.id AND i.user_id = $3
       )
     ORDER BY a.quality_score DESC, a.published_at DESC
     LIMIT $4`,
    String(MAX_AGE_DAYS),
    excludeIds,
    userId,
    limit * 4,
  );
}

/** Name the interest behind a centroid match, for the "why" chip. */
async function reasonLabels(
  articleIds: string[],
): Promise<Map<string, string>> {
  if (articleIds.length === 0) return new Map();

  // Highest-confidence topic per article. The centroid itself has no label —
  // it is a point in embedding space — so the nearest tagged interest is the
  // closest thing to an honest explanation we can give.
  const rows = await db.$queryRaw<{ article_id: string; label: string }[]>`
    SELECT DISTINCT ON (t.article_id) t.article_id, i.label
    FROM article_topics t
    JOIN interests i ON i.id = t.interest_id
    WHERE t.article_id = ANY(${articleIds}::text[])
    ORDER BY t.article_id, t.confidence DESC
  `;

  return new Map(rows.map((row) => [row.article_id, row.label]));
}

function toFeedItem(
  row: CandidateRow,
  scored: ScoredArticle,
  reason: string | null,
): FeedItem {
  return {
    id: row.id,
    title: row.title,
    // Derived summary when we have one; the publisher's description is the
    // fallback, since it is better than showing nothing.
    description: row.summary ?? row.description,
    url: row.url,
    sourceName: row.source_name,
    imageUrl: row.image_url,
    publishedAt: row.published_at,
    storyClusterId: row.story_cluster_id,
    reason,
    exploration: scored.exploration,
    score: scored.score,
    // Filled in by buildFeedPage once the whole page is known, so saved state
    // costs one query per page rather than one per card.
    saved: false,
  };
}

/**
 * Build one page of the feed.
 *
 * `offset` skips already-served ranked items within a session. Impressions are
 * the durable filter — they survive across sessions — but they are only
 * written once a page is actually delivered, so paging within a single request
 * cycle needs the offset too.
 */
export async function buildFeedPage(
  userId: string,
  options: { offset?: number; pageSize?: number; now?: Date } = {},
): Promise<{ items: FeedItem[]; exhausted: boolean }> {
  const { offset = 0, pageSize = PAGE_SIZE, now = new Date() } = options;

  const centroids = await loadCentroids(userId);
  const positives = centroids.filter((c) => c.polarity === "POS");
  const negatives = centroids.filter((c) => c.polarity === "NEG");

  // No profile means onboarding has not run. Better to say so than to serve an
  // arbitrary feed that looks personalized and is not.
  if (positives.length === 0) return { items: [], exhausted: true };

  const candidates = await retrieveCandidates(userId, positives);
  if (candidates.size === 0) return { items: [], exhausted: true };

  const scored: { row: CandidateRow; scored: ScoredArticle }[] = [];
  for (const row of candidates.values()) {
    scored.push({
      row,
      scored: scoreArticle(
        {
          id: row.id,
          embedding: parseSqlVector(row.embedding),
          publishedAt: row.published_at,
          qualityScore: row.quality_score,
        },
        positives,
        negatives,
        { now },
      ),
    });
  }

  scored.sort((a, b) => b.scored.score - a.scored.score);

  // One article per story: the same event from six outlets is one card.
  const seenClusters = new Set<string>();
  const ranked = scored.filter((entry) => {
    const cluster = entry.row.story_cluster_id;
    if (!cluster) return true;
    if (seenClusters.has(cluster)) return false;
    seenClusters.add(cluster);
    return true;
  });

  const explorationSlots = Math.max(1, Math.round(pageSize * EXPLORATION_RATIO));
  const rankedSlots = pageSize - explorationSlots;

  const page = ranked.slice(offset, offset + rankedSlots);

  const exploration = (
    await retrieveExploration(
      userId,
      [...candidates.keys()],
      explorationSlots,
    )
  )
    .filter((row) => !row.story_cluster_id || !seenClusters.has(row.story_cluster_id))
    .slice(0, explorationSlots);

  const reasons = await reasonLabels([
    ...page.map((entry) => entry.row.id),
    ...exploration.map((row) => row.id),
  ]);

  const items: FeedItem[] = page.map((entry) =>
    toFeedItem(
      entry.row,
      entry.scored,
      entry.scored.matchedCentroid !== null
        ? reasons.get(entry.row.id) ?? null
        : null,
    ),
  );

  for (const row of exploration) {
    const scoredRow = scoreArticle(
      {
        id: row.id,
        embedding: parseSqlVector(row.embedding),
        publishedAt: row.published_at,
        qualityScore: row.quality_score,
      },
      positives,
      negatives,
      { now },
    );
    scoredRow.exploration = true;
    items.push(toFeedItem(row, scoredRow, reasons.get(row.id) ?? null));
  }

  // Interleave rather than appending, so exploration is not a predictable
  // block at the bottom that users learn to scroll past.
  const shuffled = interleaveExploration(items);

  // Saved state is a display concern, resolved after ranking. It is read here
  // and nowhere in the scoring path — bookmarks must not move the feed.
  const saved = await savedArticleIds(userId, shuffled.map((item) => item.id));
  for (const item of shuffled) item.saved = saved.has(item.id);

  return {
    items: shuffled,
    exhausted: page.length < rankedSlots,
  };
}

/** Spread exploration items through the page at roughly even spacing. */
function interleaveExploration(items: FeedItem[]): FeedItem[] {
  const ranked = items.filter((item) => !item.exploration);
  const explore = items.filter((item) => item.exploration);
  if (explore.length === 0) return ranked;

  const out: FeedItem[] = [];
  const gap = Math.max(1, Math.floor(ranked.length / (explore.length + 1)));

  let e = 0;
  for (let i = 0; i < ranked.length; i++) {
    out.push(ranked[i]);
    if (e < explore.length && (i + 1) % gap === 0) {
      out.push(explore[e++]);
    }
  }
  while (e < explore.length) out.push(explore[e++]);

  return out;
}

/**
 * Record that these articles were shown. This is what stops the feed from
 * repeating itself across sessions.
 *
 * `skipDuplicates` because the unique constraint is (userId, articleId) and a
 * double-submitted page is an expected client behaviour, not an error.
 */
export async function recordImpressions(
  userId: string,
  items: FeedItem[],
  startPosition: number,
  sessionId?: string,
): Promise<void> {
  if (items.length === 0) return;

  await db.impression.createMany({
    data: items.map((item, index) => ({
      userId,
      articleId: item.id,
      position: startPosition + index,
      sessionId,
    })),
    skipDuplicates: true,
  });
}
