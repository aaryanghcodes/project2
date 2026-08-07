/**
 * "Similar articles you may like" for the hover preview.
 *
 * Related-but-not-identical is the whole difficulty. Pure nearest-neighbour
 * search returns the same story from five outlets, which is useless: the
 * reader is already looking at that story. So this deliberately excludes both
 * the article's own story cluster and anything similar enough to be a
 * near-duplicate, then trades a little similarity for source diversity.
 *
 * User relevance is folded in but weighted below similarity. The reader asked
 * "what else is like *this*", not "what else do you have for me" — their
 * profile breaks ties rather than choosing the subject.
 */

import { db } from "@/lib/db";
import { parseSqlVector } from "@/lib/vector";
import { loadCentroids } from "@/lib/profile/centroids";
import { relevanceOf, freshness } from "./scoring";

/**
 * Above this, two articles are the same story told twice. Story clustering
 * already catches most of these, but it only merges within a 48-hour window
 * and a follow-up piece the next week is still not a useful suggestion.
 */
const NEAR_DUPLICATE_CEILING = 0.9;

/** Below this there is no meaningful relationship left to show. */
const MIN_SIMILARITY = 0.45;

/** Candidates pulled before diversity filtering. */
const CANDIDATE_POOL = 40;

/** Suggestions are allowed to be older than the feed's window. */
const MAX_AGE_DAYS = 14;

const WEIGHTS = {
  similarity: 1.0,
  /** Deliberately a third of similarity — the anchor article leads. */
  userRelevance: 0.35,
  freshness: 0.2,
} as const;

export interface SimilarArticle {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: Date;
  similarity: number;
}

interface Row {
  id: string;
  title: string;
  url: string;
  source_name: string;
  summary: string | null;
  description: string | null;
  image_url: string | null;
  published_at: Date;
  embedding: string;
  similarity: number;
}

export async function similarArticles(
  userId: string,
  articleId: string,
  limit = 3,
): Promise<SimilarArticle[]> {
  const [anchor] = await db.$queryRaw<
    { embedding: string; story_cluster_id: string | null; source_name: string }[]
  >`
    SELECT embedding::text AS embedding, story_cluster_id, source_name
    FROM articles WHERE id = ${articleId} AND embedding IS NOT NULL
  `;
  if (!anchor) return [];

  const rows = await db.$queryRawUnsafe<Row[]>(
    `SELECT a.id, a.title, a.url, a.source_name, a.summary, a.description,
            a.image_url, a.published_at, a.embedding::text AS embedding,
            1 - (a.embedding <=> $1::vector) AS similarity
     FROM articles a
     WHERE a.embedding IS NOT NULL
       AND a.id <> $2
       AND a.published_at > now() - ($3 || ' days')::interval
       -- Same story from another outlet is not a suggestion.
       AND (a.story_cluster_id IS NULL OR a.story_cluster_id IS DISTINCT FROM $4)
       -- Respect an explicit mute here too; a suggestion panel is not a
       -- loophole around it.
       AND NOT EXISTS (
         SELECT 1 FROM article_topics t
         JOIN muted_topics m ON m.interest_id = t.interest_id AND m.user_id = $5
         WHERE t.article_id = a.id
       )
     ORDER BY a.embedding <=> $1::vector
     LIMIT $6`,
    anchor.embedding,
    articleId,
    String(MAX_AGE_DAYS),
    anchor.story_cluster_id,
    userId,
    CANDIDATE_POOL,
  );

  const centroids = await loadCentroids(userId);
  const positives = centroids.filter((c) => c.polarity === "POS");
  const now = new Date();

  const scored = rows
    .filter(
      (row) =>
        row.similarity >= MIN_SIMILARITY &&
        row.similarity <= NEAR_DUPLICATE_CEILING,
    )
    .map((row) => {
      const embedding = parseSqlVector(row.embedding);
      const { relevance } = relevanceOf(embedding, positives);
      return {
        row,
        score:
          WEIGHTS.similarity * row.similarity +
          WEIGHTS.userRelevance * relevance +
          WEIGHTS.freshness * freshness(row.published_at, now),
      };
    })
    .sort((a, b) => b.score - a.score);

  // One per source, and prefer a different outlet from the anchor. Three
  // suggestions all from the same publication read as that publication's
  // "related links" rather than as a recommendation.
  const chosen: SimilarArticle[] = [];
  const usedSources = new Set<string>();

  for (const pass of [0, 1]) {
    for (const entry of scored) {
      if (chosen.length >= limit) break;
      const source = entry.row.source_name;

      if (usedSources.has(source)) continue;
      // First pass skips the anchor's own source; second pass allows it, so a
      // thin corpus still fills the panel.
      if (pass === 0 && source === anchor.source_name) continue;
      if (chosen.some((c) => c.id === entry.row.id)) continue;

      usedSources.add(source);
      chosen.push({
        id: entry.row.id,
        title: entry.row.title,
        url: entry.row.url,
        sourceName: source,
        summary: entry.row.summary ?? entry.row.description,
        imageUrl: entry.row.image_url,
        publishedAt: entry.row.published_at,
        similarity: entry.row.similarity,
      });
    }
    if (chosen.length >= limit) break;
  }

  return chosen;
}
