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

      const value = lambda * normalized[index] - (1 - lambda) * redundancy;
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
