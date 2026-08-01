/**
 * Deterministic offline embedder — a DEVELOPMENT FALLBACK, not a real model.
 *
 * It exists because some environments (CI sandboxes, locked-down networks)
 * cannot reach huggingface.co to download model weights, which would otherwise
 * make the whole ingest/seed/rank pipeline impossible to run or test.
 *
 * WHAT IT DOES: hashes word unigrams and bigrams into 384 signed buckets with
 * sublinear term weighting, then normalises. Documents sharing vocabulary come
 * out similar.
 *
 * WHAT IT DOES NOT DO: understand meaning. "Fed cuts rates" and "central bank
 * lowers borrowing costs" share no tokens and will score near zero, where a
 * real model scores them high. Feed quality under this provider is meaningless
 * — it validates plumbing only. Never enable it in production.
 */

import { EMBEDDING_DIM } from "../vector";

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for",
  "from", "has", "have", "he", "her", "his", "in", "is", "it", "its", "of",
  "on", "or", "she", "that", "the", "their", "they", "this", "to", "was",
  "were", "will", "with",
]);

/** FNV-1a. Fast, stable across runs and machines, good enough spread here. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));

  // Bigrams add a little word-order signal, which pure bag-of-words loses.
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]}_${words[i + 1]}`);
  }
  return [...words, ...bigrams];
}

export function hashedEmbed(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIM).fill(0);
  const counts = new Map<string, number>();

  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  for (const [token, count] of counts) {
    const h = hash(token);
    const bucket = h % EMBEDDING_DIM;
    // Signed hashing keeps collisions from systematically inflating similarity.
    const sign = (h >>> 31) & 1 ? -1 : 1;
    // Sublinear term frequency: the tenth mention matters less than the first.
    vector[bucket] += sign * (1 + Math.log(count));
  }

  let sumSquares = 0;
  for (const v of vector) sumSquares += v * v;
  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) {
    // An all-stopword string. Return a fixed nonzero vector so callers relying
    // on unit length do not divide by zero.
    vector[0] = 1;
    return vector;
  }
  return vector.map((v) => v / magnitude);
}
