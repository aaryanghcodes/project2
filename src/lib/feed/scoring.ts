/**
 * The ranking formula. See PLAN.md §5.
 *
 * Kept as pure functions over plain numbers, separate from both retrieval and
 * the database, because this is the part whose behaviour we actually need to
 * reason about — and the part most likely to be tuned repeatedly.
 */

import { cosineSimilarity } from "@/lib/vector";
import type { Centroid } from "@/lib/profile/centroids";

/**
 * Starting weights from PLAN.md §5. The relative sizes carry the intent:
 *
 * - `relevance` dominates; it is the reason the product exists.
 * - `aversion` is nearly as strong, because a feed that keeps showing things
 *   you rejected is worse than one that merely misses something good.
 * - `freshness` is a third of relevance: enough that today's story outranks a
 *   comparable one from Tuesday, not enough to float breaking news the user
 *   has no interest in.
 * - `quality` is small on purpose — it is a per-source prior, not a judgement
 *   of the article, so it should only break ties.
 */
export const WEIGHTS = {
  relevance: 1.0,
  aversion: 0.8,
  freshness: 0.35,
  quality: 0.1,
} as const;

/**
 * Freshness half-life. exp(-age/36) puts a 36-hour-old article at 0.37 of a
 * brand-new one and a three-day-old article near 0.13 — steep enough to keep
 * the feed current, shallow enough that a strong match from yesterday still
 * beats a weak match from an hour ago.
 */
const FRESHNESS_TAU_HOURS = 36;

/**
 * Random jitter added to every score. Without it the same profile against the
 * same corpus produces a byte-identical feed on every visit, which reads as
 * broken even when the ranking is correct. Small enough not to reorder items
 * that differ meaningfully.
 */
const NOISE = 0.02;

export interface ScoredArticle {
  id: string;
  score: number;
  relevance: number;
  aversion: number;
  freshness: number;
  /** Index of the positive centroid that matched best, for "why am I seeing this". */
  matchedCentroid: number | null;
  exploration: boolean;
}

export interface ScoreInput {
  id: string;
  embedding: number[];
  publishedAt: Date;
  qualityScore: number;
}

export function freshness(publishedAt: Date, now = new Date()): number {
  const ageHours = Math.max(
    0,
    (now.getTime() - publishedAt.getTime()) / 3_600_000,
  );
  return Math.exp(-ageHours / FRESHNESS_TAU_HOURS);
}

/**
 * Best match across positive centroids, scaled by that centroid's weight.
 *
 * Max rather than mean: a user with six tastes should see a great quantum
 * computing article at full strength, not averaged down by the five centroids
 * that have nothing to do with it. That is the entire argument for keeping
 * multiple centroids in the first place.
 */
export function relevanceOf(
  embedding: number[],
  positives: Centroid[],
): { relevance: number; matchedCentroid: number | null } {
  let best = 0;
  let matched: number | null = null;

  for (const centroid of positives) {
    const score = cosineSimilarity(embedding, centroid.vector) * centroid.weight;
    if (score > best) {
      best = score;
      matched = centroid.idx;
    }
  }

  return { relevance: best, matchedCentroid: matched };
}

/** Worst offence across negative centroids. Unweighted: one strong reason to dislike is enough. */
export function aversionOf(embedding: number[], negatives: Centroid[]): number {
  let worst = 0;
  for (const centroid of negatives) {
    worst = Math.max(worst, cosineSimilarity(embedding, centroid.vector));
  }
  return worst;
}

export function scoreArticle(
  article: ScoreInput,
  positives: Centroid[],
  negatives: Centroid[],
  options: { now?: Date; random?: () => number } = {},
): ScoredArticle {
  const { now = new Date(), random = Math.random } = options;

  const { relevance, matchedCentroid } = relevanceOf(article.embedding, positives);
  const aversion = aversionOf(article.embedding, negatives);
  const fresh = freshness(article.publishedAt, now);

  const score =
    WEIGHTS.relevance * relevance -
    WEIGHTS.aversion * aversion +
    WEIGHTS.freshness * fresh +
    WEIGHTS.quality * article.qualityScore +
    (random() - 0.5) * 2 * NOISE;

  return {
    id: article.id,
    score,
    relevance,
    aversion,
    freshness: fresh,
    matchedCentroid,
    exploration: false,
  };
}
