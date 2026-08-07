/**
 * Maximal marginal relevance — the topic-diversity control.
 *
 * Pure ranking by score is what produced a feed of ten consecutive soccer
 * articles for a soccer-heavy profile: every one of them genuinely was the
 * best remaining match. MMR trades a little relevance for spread, penalising
 * each candidate by how similar it already is to what has been selected.
 *
 * Shared between the calibration deck and the feed because they want the same
 * mechanism for different reasons — calibration wants spread so a rating is
 * informative, the feed wants spread so a page is worth scrolling.
 */

import { cosineSimilarity } from "@/lib/vector";

export interface MmrCandidate {
  embedding: number[];
  /** Whatever "good" means to the caller: similarity, or a full ranking score. */
  score: number;
}

/**
 * Select `count` items balancing score against redundancy.
 *
 * `lambda` is the weight on score; `1 - lambda` weights dissimilarity from
 * what is already chosen. At 1.0 this degrades to plain ranking.
 *
 * Returns indices into `candidates`, in selection order.
 */
export function selectByMmr(
  candidates: MmrCandidate[],
  count: number,
  lambda: number,
  alreadyChosen: number[][] = [],
): number[] {
  if (count <= 0 || candidates.length === 0) return [];

  const chosen: number[] = [];
  const chosenVectors = [...alreadyChosen];
  const remaining = candidates.map((_, i) => i);

  // Scores from a full ranking formula are not bounded to [0,1] the way a
  // cosine is, so they are normalised before being mixed with a similarity
  // penalty. Skipping this lets whichever term happens to have the larger
  // numeric range silently dominate.
  const scores = candidates.map((c) => c.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = max - min;
  const normalized = scores.map((s) => (span > 0 ? (s - min) / span : 1));

  // The redundancy term needs the same treatment, for a reason specific to
  // this embedding model. bge-small packs cosine similarity into a narrow band
  // — unrelated articles sit around 0.40, closely related ones around 0.55 —
  // so a *raw* similarity penalty spans maybe 0.15 while normalised scores
  // span a full 1.0. Mixed directly, the penalty is too small to reorder
  // anything: the first live run selected byte-identical items to plain
  // ranking (0.4461 mean pairwise similarity either way).
  //
  // So redundancy is standardised against this pool's own similarity
  // distribution. "How similar is this to what I picked, relative to how
  // similar these articles are to each other in general" is the question that
  // actually has a stable answer across corpora and models.
  const { mean, sd } = pairwiseStats(candidates);

  while (chosen.length < count && remaining.length > 0) {
    let bestAt = 0;
    let bestValue = -Infinity;

    for (let r = 0; r < remaining.length; r++) {
      const index = remaining[r];

      let redundancy = 0;
      for (const vector of chosenVectors) {
        redundancy = Math.max(
          redundancy,
          cosineSimilarity(candidates[index].embedding, vector),
        );
      }

      // Standardised into roughly [0,1]: 0 at the pool's average similarity,
      // 1 at two standard deviations above it. Clamped so a single outlier
      // pair cannot swamp the score term.
      const relative =
        sd > 0 ? Math.min(1, Math.max(0, (redundancy - mean) / (2 * sd))) : 0;

      const value = lambda * normalized[index] - (1 - lambda) * relative;
      if (value > bestValue) {
        bestValue = value;
        bestAt = r;
      }
    }

    const picked = remaining.splice(bestAt, 1)[0];
    chosen.push(picked);
    chosenVectors.push(candidates[picked].embedding);
  }

  return chosen;
}

/**
 * Mean and spread of pairwise similarity within a candidate pool.
 *
 * Sampled above a modest size: this is O(n²) in 384-dimension dot products,
 * and the statistic converges long before the full set is needed.
 */
function pairwiseStats(candidates: MmrCandidate[]): {
  mean: number;
  sd: number;
} {
  const SAMPLE_LIMIT = 40;
  const pool =
    candidates.length <= SAMPLE_LIMIT
      ? candidates
      : candidates.filter(
          (_, i) => i % Math.ceil(candidates.length / SAMPLE_LIMIT) === 0,
        );

  const sims: number[] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      sims.push(cosineSimilarity(pool[i].embedding, pool[j].embedding));
    }
  }
  if (sims.length === 0) return { mean: 0, sd: 0 };

  const mean = sims.reduce((sum, s) => sum + s, 0) / sims.length;
  const variance =
    sims.reduce((sum, s) => sum + (s - mean) * (s - mean), 0) / sims.length;

  return { mean, sd: Math.sqrt(variance) };
}
