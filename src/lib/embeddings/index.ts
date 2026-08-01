/**
 * Local text embeddings — no API key, no per-call cost, no rate limit.
 *
 * Default provider is bge-small-en-v1.5 running as ONNX on the CPU via
 * Transformers.js. It is a strong English retrieval model for its size (33M
 * params) and emits 384 dimensions, a quarter the width of common hosted
 * models, which means a smaller index and faster search.
 *
 * Everything downstream depends only on `embed()` / `embedBatch()`, so
 * swapping in a hosted model later is a change to this file alone.
 *
 * Set EMBEDDING_PROVIDER=hashed to use the offline fallback in ./hashed.ts —
 * required in environments that cannot reach huggingface.co. See that file for
 * why its output is not a substitute for real embeddings.
 */

import { EMBEDDING_DIM } from "../vector";
import { hashedEmbed } from "./hashed";

export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";

export type EmbeddingProvider = "model" | "hashed";

export function activeProvider(): EmbeddingProvider {
  return process.env.EMBEDDING_PROVIDER === "hashed" ? "hashed" : "model";
}

// Weights are ~130MB. Downloaded once, then read from this directory, which is
// what CI caches between ingest runs.
process.env.TRANSFORMERS_CACHE ??= ".model-cache";

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "cls" | "mean"; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

/**
 * Loading the model takes a few seconds, so it is done once and shared. The
 * promise itself is cached rather than the result, so concurrent callers
 * during startup wait on one load instead of racing several.
 */
async function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const pipe = await pipeline("feature-extraction", EMBEDDING_MODEL, {
        dtype: "fp32",
      });
      return pipe as unknown as FeatureExtractor;
    })();
  }
  return extractorPromise;
}

/**
 * BGE models are trained with CLS pooling, not mean pooling — using the wrong
 * one measurably degrades retrieval quality, so it is pinned here rather than
 * left to the caller.
 */
async function runModel(texts: string[]): Promise<number[][]> {
  const extract = await getExtractor();
  const output = await extract(texts, { pooling: "cls", normalize: true });
  return output.tolist();
}

let warnedAboutFallback = false;

function runHashed(texts: string[]): number[][] {
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      "[embeddings] EMBEDDING_PROVIDER=hashed — using the offline lexical " +
        "fallback. Similarity is vocabulary-based, not semantic. Feed quality " +
        "under this provider is not representative.",
    );
  }
  return texts.map(hashedEmbed);
}

function assertDimensions(vectors: number[][]): void {
  for (const vec of vectors) {
    if (vec.length !== EMBEDDING_DIM) {
      throw new Error(
        `Embedder returned ${vec.length} dimensions, expected ${EMBEDDING_DIM}. ` +
          `Check that the model and the vector(384) columns still agree.`,
      );
    }
  }
}

/** Embed a single string. Returns a unit-length 384-dim vector. */
export async function embed(text: string): Promise<number[]> {
  const [vector] = await embedBatch([text]);
  return vector;
}

/**
 * Embed many strings. Chunked because a single oversized batch spikes memory
 * on the small containers this runs in.
 */
export async function embedBatch(
  texts: string[],
  batchSize = 32,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const prepared = texts.map((t) => {
    const clean = t.replace(/\s+/g, " ").trim();
    if (!clean) throw new Error("Cannot embed an empty string.");
    return clean;
  });

  const useHashed = activeProvider() === "hashed";
  const results: number[][] = [];

  for (let i = 0; i < prepared.length; i += batchSize) {
    const chunk = prepared.slice(i, i + batchSize);
    results.push(...(useHashed ? runHashed(chunk) : await runModel(chunk)));
  }

  assertDimensions(results);
  return results;
}

/**
 * Build the text we actually embed for an article. Title carries the most
 * signal, so it leads; the snippet is truncated because the model only attends
 * to 512 tokens and trailing boilerplate ("Sign up for our newsletter") is
 * pure noise in the vector.
 */
export function articleEmbeddingText(article: {
  title: string;
  description?: string | null;
  contentSnippet?: string | null;
}): string {
  return [
    article.title,
    article.description ?? "",
    (article.contentSnippet ?? "").slice(0, 600),
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(". ");
}
