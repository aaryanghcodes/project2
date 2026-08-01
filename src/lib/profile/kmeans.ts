/**
 * Spherical k-means over embedding vectors.
 *
 * "Spherical" because the vectors are unit-length and compared by cosine: the
 * update step re-normalizes each centroid instead of leaving it at the
 * arithmetic mean. Skipping that would shrink centroids toward the origin as
 * their clusters grow, which quietly changes what cosine means for them.
 *
 * This is the piece that lets one user hold several unrelated tastes. See
 * PLAN.md §5 — averaging someone interested in both quantum computing and the
 * NBA into a single vector produces a vector pointing at neither.
 */

import { cosineSimilarity, meanVector, normalize } from "@/lib/vector";

export interface Cluster {
  centroid: number[];
  /** Indices into the input array. */
  members: number[];
}

/**
 * How many clusters to ask for given how much the user has actually rated.
 * Asking for six centroids from eight ratings produces six centroids that each
 * describe one article — precise, and useless for generalizing. Grows with
 * evidence, per PLAN.md §5.
 */
export function clusterCountFor(sampleSize: number, max = 6): number {
  if (sampleSize < 4) return 1;
  if (sampleSize < 10) return 2;
  if (sampleSize < 25) return 3;
  if (sampleSize < 50) return 4;
  return Math.min(max, 6);
}

/**
 * k-means++ seeding: pick the first centre at random, then bias each subsequent
 * pick toward points far from everything already chosen. Plain random seeding
 * regularly puts two centres inside the same dense cluster, which leaves a real
 * taste unrepresented — exactly the failure this whole design exists to avoid.
 *
 * `random` is injectable so tests can pin the seeding.
 */
function seedCentroids(
  vectors: number[][],
  k: number,
  random: () => number,
): number[][] {
  const centroids: number[][] = [vectors[Math.floor(random() * vectors.length)]];

  while (centroids.length < k) {
    // Distance to the nearest existing centre, squared, as the sampling weight.
    const weights = vectors.map((vec) => {
      let nearest = -1;
      for (const centroid of centroids) {
        nearest = Math.max(nearest, cosineSimilarity(vec, centroid));
      }
      const distance = 1 - nearest;
      return distance * distance;
    });

    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total <= 0) break; // every point coincides with a centre

    let target = random() * total;
    let picked = weights.length - 1;
    for (let i = 0; i < weights.length; i++) {
      target -= weights[i];
      if (target <= 0) {
        picked = i;
        break;
      }
    }
    centroids.push(vectors[picked]);
  }

  return centroids.map((c) => normalize(c));
}

/**
 * Cluster `vectors` into at most `k` groups.
 *
 * Empty clusters are dropped rather than re-seeded. A cluster that attracts no
 * members is telling us the data does not support that many tastes, and
 * returning four honest centroids beats six where two are noise.
 */
export function kmeans(
  vectors: number[][],
  k: number,
  options: { maxIterations?: number; random?: () => number } = {},
): Cluster[] {
  const { maxIterations = 25, random = Math.random } = options;

  if (vectors.length === 0) return [];
  if (k <= 1 || vectors.length <= 1) {
    return [
      {
        centroid: normalize(meanVector(vectors)),
        members: vectors.map((_, i) => i),
      },
    ];
  }

  const effectiveK = Math.min(k, vectors.length);
  let centroids = seedCentroids(vectors, effectiveK, random);
  let assignments = new Array<number>(vectors.length).fill(-1);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let changed = false;

    const next = vectors.map((vec) => {
      let best = 0;
      let bestScore = -Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const score = cosineSimilarity(vec, centroids[c]);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      return best;
    });

    for (let i = 0; i < next.length; i++) {
      if (next[i] !== assignments[i]) changed = true;
    }
    assignments = next;

    const grouped: number[][][] = centroids.map(() => []);
    for (let i = 0; i < vectors.length; i++) grouped[assignments[i]].push(vectors[i]);

    centroids = grouped.map((group, c) =>
      group.length > 0 ? normalize(meanVector(group)) : centroids[c],
    );

    // Converged: another pass would reproduce the same assignments exactly.
    if (!changed) break;
  }

  const clusters: Cluster[] = centroids.map((centroid) => ({
    centroid,
    members: [],
  }));
  for (let i = 0; i < vectors.length; i++) {
    clusters[assignments[i]].members.push(i);
  }

  return clusters.filter((cluster) => cluster.members.length > 0);
}
