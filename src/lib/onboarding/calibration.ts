/**
 * Building the calibration sample shown during onboarding.
 *
 * This is not a feed, and optimizing it like one is the mistake PLAN.md §5
 * warns about: eighteen articles the user is 95% likely to like teach us
 * almost nothing about them. What we want is the sample that most reduces our
 * uncertainty — coverage across what they picked, spread *within* each of
 * those picks so a like/dislike actually splits the space, and a few probes
 * outside their stated interests to catch the ones they did not think to
 * check.
 */

import { db } from "@/lib/db";
import { cosineSimilarity, parseSqlVector } from "@/lib/vector";

/** Total cards in the calibration deck. */
export const CALIBRATION_SIZE = 18;

/** Ratings required before onboarding can be completed (PLAN.md §5). */
export const MIN_RATINGS = 8;

/** Cards drawn from outside the user's stated interests. */
const OFF_PROFILE_SLOTS = 3;

/** Candidates pulled per interest before MMR narrows them. */
const CANDIDATES_PER_INTEREST = 24;

/**
 * MMR's relevance/diversity balance. At 0.6 the sample leans toward relevance —
 * the cards still have to look like plausible articles about topics the user
 * chose, or rating them feels arbitrary — while leaving enough weight on
 * diversity to avoid eighteen near-identical takes on one story.
 */
const MMR_LAMBDA = 0.6;

/** Only recent articles: rating six-day-old news is a poor first impression. */
const MAX_AGE_DAYS = 7;

export interface CalibrationCard {
  id: string;
  title: string;
  description: string | null;
  url: string;
  sourceName: string;
  imageUrl: string | null;
  publishedAt: Date;
  /** Which selected interest pulled this card in; null for off-profile probes. */
  viaInterest: string | null;
  /** Marks the deliberate probes, so we can measure whether they earn ratings. */
  offProfile: boolean;
}

interface Candidate {
  id: string;
  title: string;
  description: string | null;
  summary: string | null;
  url: string;
  source_name: string;
  image_url: string | null;
  published_at: Date;
  story_cluster_id: string | null;
  embedding: string;
  similarity: number;
}

/**
 * Maximal marginal relevance.
 *
 * Greedily takes the candidate with the best relevance-minus-redundancy score,
 * where redundancy is similarity to what has already been picked. The point
 * here is not novelty for its own sake: two articles about the same event give
 * us one bit between them, while two articles from opposite ends of an
 * interest tell us where inside that interest the user actually sits.
 */
function selectByMmr(
  candidates: { embedding: number[]; similarity: number }[],
  count: number,
  alreadyChosen: number[][],
): number[] {
  const chosen: number[] = [];
  const chosenVectors = [...alreadyChosen];
  const remaining = candidates.map((_, i) => i);

  while (chosen.length < count && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let r = 0; r < remaining.length; r++) {
      const candidate = candidates[remaining[r]];

      let redundancy = 0;
      for (const vector of chosenVectors) {
        redundancy = Math.max(
          redundancy,
          cosineSimilarity(candidate.embedding, vector),
        );
      }

      const score =
        MMR_LAMBDA * candidate.similarity - (1 - MMR_LAMBDA) * redundancy;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = r;
      }
    }

    const picked = remaining.splice(bestIndex, 1)[0];
    chosen.push(picked);
    chosenVectors.push(candidates[picked].embedding);
  }

  return chosen;
}

async function candidatesForInterest(
  interestId: string,
  excludeIds: string[],
): Promise<Candidate[]> {
  return db.$queryRawUnsafe<Candidate[]>(
    `SELECT a.id, a.title, a.description, a.summary, a.url, a.source_name, a.image_url,
            a.published_at, a.story_cluster_id,
            a.embedding::text AS embedding,
            1 - (a.embedding <=> i.seed_embedding) AS similarity
     FROM articles a
     CROSS JOIN (SELECT seed_embedding FROM interests WHERE id = $1) i
     WHERE a.embedding IS NOT NULL
       AND i.seed_embedding IS NOT NULL
       AND a.published_at > now() - ($2 || ' days')::interval
       AND NOT (a.id = ANY($3::text[]))
     ORDER BY a.embedding <=> i.seed_embedding
     LIMIT $4`,
    interestId,
    String(MAX_AGE_DAYS),
    excludeIds,
    CANDIDATES_PER_INTEREST,
  );
}

/**
 * Probe articles from outside the user's stated interests.
 *
 * Ordered by quality rather than randomly: a random draw from everything
 * ingested mostly surfaces routine wire copy, and a card nobody would rate
 * either way wastes one of eighteen slots. High-quality items the user did not
 * ask for are the ones that can genuinely surprise us.
 */
async function offProfileCandidates(
  selectedInterestIds: string[],
  excludeIds: string[],
): Promise<Candidate[]> {
  return db.$queryRawUnsafe<Candidate[]>(
    `SELECT a.id, a.title, a.description, a.summary, a.url, a.source_name, a.image_url,
            a.published_at, a.story_cluster_id,
            a.embedding::text AS embedding,
            a.quality_score AS similarity
     FROM articles a
     WHERE a.embedding IS NOT NULL
       AND a.published_at > now() - ($1 || ' days')::interval
       AND NOT (a.id = ANY($2::text[]))
       AND NOT EXISTS (
         SELECT 1 FROM article_topics t
         WHERE t.article_id = a.id AND t.interest_id = ANY($3::text[])
       )
     ORDER BY a.quality_score DESC, random()
     LIMIT $4`,
    String(MAX_AGE_DAYS),
    excludeIds,
    selectedInterestIds,
    CANDIDATES_PER_INTEREST,
  );
}

function toCard(
  row: Candidate,
  viaInterest: string | null,
  offProfile: boolean,
): CalibrationCard {
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
    viaInterest,
    offProfile,
  };
}

/**
 * Build the deck.
 *
 * Interests are visited round-robin rather than one-at-a-time-to-exhaustion so
 * that a user who picked ten interests still gets coverage of all ten when the
 * deck runs out at eighteen, instead of three interests covered in depth and
 * seven not at all.
 */
export async function buildCalibrationSample(
  userId: string,
  interestIds: string[],
): Promise<CalibrationCard[]> {
  if (interestIds.length === 0) return [];

  // Anything already rated is spent — re-showing it teaches us nothing and
  // reads as a bug to the user.
  const rated = await db.interaction.findMany({
    where: { userId },
    select: { articleId: true },
  });
  const excludeIds = rated.map((row) => row.articleId);

  const seenClusters = new Set<string>();
  const chosenVectors: number[][] = [];
  const cards: CalibrationCard[] = [];

  const perInterest = new Map<string, Candidate[]>();
  await Promise.all(
    interestIds.map(async (id) => {
      perInterest.set(id, await candidatesForInterest(id, excludeIds));
    }),
  );

  const interestSlots = CALIBRATION_SIZE - OFF_PROFILE_SLOTS;
  const rounds = Math.ceil(interestSlots / interestIds.length);

  for (let round = 0; round < rounds; round++) {
    for (const interestId of interestIds) {
      if (cards.length >= interestSlots) break;

      const pool = (perInterest.get(interestId) ?? []).filter((row) => {
        if (cards.some((card) => card.id === row.id)) return false;
        // One card per story: the same event from three outlets is one
        // question asked three times.
        return !row.story_cluster_id || !seenClusters.has(row.story_cluster_id);
      });
      if (pool.length === 0) continue;

      const parsed = pool.map((row) => ({
        embedding: parseSqlVector(row.embedding),
        similarity: row.similarity,
      }));

      const [pick] = selectByMmr(parsed, 1, chosenVectors);
      if (pick === undefined) continue;

      const row = pool[pick];
      cards.push(toCard(row, interestId, false));
      chosenVectors.push(parsed[pick].embedding);
      if (row.story_cluster_id) seenClusters.add(row.story_cluster_id);
    }
  }

  // Probes last, so they are chosen to be far from everything already picked.
  const offProfile = (
    await offProfileCandidates(interestIds, [
      ...excludeIds,
      ...cards.map((card) => card.id),
    ])
  ).filter((row) => !row.story_cluster_id || !seenClusters.has(row.story_cluster_id));

  if (offProfile.length > 0) {
    const parsed = offProfile.map((row) => ({
      embedding: parseSqlVector(row.embedding),
      similarity: row.similarity,
    }));
    for (const pick of selectByMmr(parsed, OFF_PROFILE_SLOTS, chosenVectors)) {
      cards.push(toCard(offProfile[pick], null, true));
      chosenVectors.push(parsed[pick].embedding);
    }
  }

  // Interleave so the probes are not an obvious block at the end, and so the
  // order does not telegraph which interest produced which card.
  return shuffle(cards);
}

/** Fisher-Yates. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
