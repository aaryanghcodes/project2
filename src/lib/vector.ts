/**
 * Helpers for moving embedding vectors between JS and pgvector.
 *
 * Prisma cannot read or write `Unsupported("vector(384)")` columns, so every
 * vector crosses the boundary as a string literal in a raw query, cast with
 * `::vector` on the SQL side. These helpers are the only place that
 * representation should be constructed.
 */

export const EMBEDDING_DIM = 384;

/** Serialise a vector into the literal pgvector expects: `[0.1,0.2,...]`. */
export function toSqlVector(values: number[]): string {
  if (values.length !== EMBEDDING_DIM) {
    throw new Error(
      `Expected a ${EMBEDDING_DIM}-dimension vector, got ${values.length}.`,
    );
  }
  for (const v of values) {
    if (!Number.isFinite(v)) {
      throw new Error("Vector contains a non-finite value.");
    }
  }
  return `[${values.join(",")}]`;
}

/** Parse the `[0.1,0.2,...]` text pgvector returns back into numbers. */
export function parseSqlVector(raw: string | number[]): number[] {
  if (Array.isArray(raw)) return raw;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new Error(`Not a pgvector literal: ${trimmed.slice(0, 32)}`);
  }
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((part) => Number.parseFloat(part));
}

/** Scale a vector to unit length. Returns a zero vector unchanged. */
export function normalize(values: number[]): number[] {
  let sumSquares = 0;
  for (const v of values) sumSquares += v * v;
  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) return [...values];
  return values.map((v) => v / magnitude);
}

/**
 * Cosine similarity, for scoring candidates in memory after pgvector has
 * narrowed the field. Assumes equal length; does not assume unit length.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}.`);
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** Component-wise mean. Used to build centroids from a group of vectors. */
export function meanVector(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    throw new Error("Cannot average an empty set of vectors.");
  }
  const dim = vectors[0].length;
  const out = new Array<number>(dim).fill(0);
  for (const vec of vectors) {
    if (vec.length !== dim) {
      throw new Error("Cannot average vectors of differing dimensions.");
    }
    for (let i = 0; i < dim; i++) out[i] += vec[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}
