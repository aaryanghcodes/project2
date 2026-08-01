/**
 * The ingestion pipeline: source → dedupe → embed → store → tag → cluster.
 *
 * Written against the `NewsSource` interface rather than RSS specifically, and
 * split into exported stages so each one can be run and inspected on its own.
 * The whole thing is idempotent: running it twice over the same feed contents
 * inserts nothing the second time, which matters because the cron overlaps
 * with itself whenever a run is slow.
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { articleEmbeddingText, embedBatch } from "@/lib/embeddings";
import { toSqlVector } from "@/lib/vector";
import { urlHash } from "@/lib/news/normalize";
import type { NewsSource, RawArticle } from "@/lib/news/types";

/**
 * Minimum cosine similarity for an article to be tagged with an interest.
 *
 * PROVISIONAL. This is a starting value for bge-small-en-v1.5, not a measured
 * one: the sandbox this was written in cannot reach huggingface.co, so the
 * only embeddings available locally were the lexical fallback, whose
 * similarity scale is completely different (best interest match across the
 * fixture corpus: 0.21, where the real model would be expected around
 * 0.6-0.8). Validate against a real run before trusting it — see
 * `npm run verify:ingest`, which prints the distribution this should sit in.
 *
 * The direction of the trade, at least, is stable: too low attaches
 * plausible-sounding but wrong topics, which is worse than leaving an article
 * untagged, because vector retrieval can still find an untagged article.
 */
const TOPIC_THRESHOLD = 0.55;

/** At most this many interests per article, best-scoring first. */
const TOPIC_LIMIT = 4;

/**
 * Minimum similarity for two articles to be considered the same story.
 *
 * PROVISIONAL for the same reason as TOPIC_THRESHOLD above — validate on real
 * embeddings before trusting the number.
 *
 * Deliberately set high, and that part is a judgement rather than a
 * measurement: wrongly merging two distinct stories makes one of them vanish
 * from every feed permanently, while missing a merge only means a user sees
 * two cards about one event. The failure modes are not symmetric, so this
 * should err toward under-merging.
 */
const CLUSTER_THRESHOLD = 0.86;

/** Only articles published within this window are candidates for the same story. */
const CLUSTER_WINDOW_HOURS = 48;

export interface IngestReport {
  fetched: number;
  duplicates: number;
  inserted: number;
  tagged: number;
  clustersJoined: number;
  clustersCreated: number;
  feedErrors: { feedId: string; message: string }[];
  durationMs: number;
}

/**
 * Drop articles whose URL we already have. Done as one query against the
 * unique hash index rather than per-article, because a typical run fetches
 * ~1500 items of which nearly all are already stored.
 */
export async function filterNew(
  articles: RawArticle[],
): Promise<{ fresh: RawArticle[]; duplicates: number }> {
  if (articles.length === 0) return { fresh: [], duplicates: 0 };

  const hashes = articles.map((a) => urlHash(a.url));
  const existing = await db.article.findMany({
    where: { urlHash: { in: hashes } },
    select: { urlHash: true },
  });
  const seen = new Set(existing.map((row) => row.urlHash));

  const fresh: RawArticle[] = [];
  for (let i = 0; i < articles.length; i++) {
    if (!seen.has(hashes[i])) fresh.push(articles[i]);
  }
  return { fresh, duplicates: articles.length - fresh.length };
}

/**
 * Embed and insert. The embedding column is `Unsupported("vector(384)")`, so
 * Prisma Client cannot write it — rows go in through raw SQL with the literal
 * built by `toSqlVector`, per the project convention.
 *
 * `ON CONFLICT DO NOTHING` rather than a transaction-wide failure: a
 * concurrent run that inserted the same URL a moment ago is an expected
 * outcome, not an error.
 */
export async function embedAndStore(articles: RawArticle[]): Promise<string[]> {
  if (articles.length === 0) return [];

  const vectors = await embedBatch(
    articles.map((a) => articleEmbeddingText(a)),
  );

  const ids: string[] = [];

  // Chunked so a single statement never carries thousands of parameters.
  const CHUNK = 50;
  for (let start = 0; start < articles.length; start += CHUNK) {
    const chunk = articles.slice(start, start + CHUNK);
    const values: unknown[] = [];
    const rows: string[] = [];

    chunk.forEach((article, offset) => {
      const id = randomUUID();
      ids.push(id);
      const base = values.length;
      values.push(
        id,
        urlHash(article.url),
        article.url,
        article.sourceName,
        article.author,
        article.title,
        article.description,
        article.contentSnippet,
        article.imageUrl,
        article.publishedAt,
        article.qualityScore,
        toSqlVector(vectors[start + offset]),
      );
      const p = (n: number) => `$${base + n}`;
      rows.push(
        `(${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ` +
          `${p(8)}, ${p(9)}, ${p(10)}, ${p(11)}, ${p(12)}::vector)`,
      );
    });

    await db.$executeRawUnsafe(
      `INSERT INTO articles (
         id, url_hash, url, source_name, author, title, description,
         content_snippet, image_url, published_at, quality_score, embedding
       ) VALUES ${rows.join(", ")}
       ON CONFLICT (url_hash) DO NOTHING`,
      ...values,
    );
  }

  return ids;
}

/**
 * Attach interests to articles by comparing each article's embedding against
 * the catalog's seed vectors.
 *
 * Done entirely in SQL: pgvector does the comparison next to the data, and a
 * LATERAL join gives us a per-article top-K rather than one global ranking.
 * Pulling 384-dim vectors into Node to do this in a loop would be an order of
 * magnitude slower for no benefit.
 */
export async function tagTopics(articleIds: string[]): Promise<number> {
  if (articleIds.length === 0) return 0;

  return db.$executeRawUnsafe(
    `INSERT INTO article_topics (article_id, interest_id, confidence)
     SELECT a.id, t.interest_id, t.confidence
     FROM articles a
     CROSS JOIN LATERAL (
       SELECT i.id AS interest_id,
              1 - (a.embedding <=> i.seed_embedding) AS confidence
       FROM interests i
       WHERE i.seed_embedding IS NOT NULL
       ORDER BY a.embedding <=> i.seed_embedding
       LIMIT $2
     ) t
     WHERE a.id = ANY($1::text[])
       AND a.embedding IS NOT NULL
       AND t.confidence >= $3
     ON CONFLICT (article_id, interest_id)
       DO UPDATE SET confidence = EXCLUDED.confidence`,
    articleIds,
    TOPIC_LIMIT,
    TOPIC_THRESHOLD,
  );
}

/**
 * Group articles covering the same event.
 *
 * Greedy single-link assignment: each new article joins the cluster of its
 * nearest neighbour if they are similar enough, and otherwise starts its own.
 * Articles are processed oldest-first so the earliest report of a story
 * becomes the cluster seed and later syndications attach to it.
 *
 * This is not a global clustering — it never revisits earlier assignments —
 * which is the right trade for a stream: it is O(n) queries against an index
 * instead of an O(n²) rebuild, and the feed only ever needs "is this the same
 * story as something I already showed you".
 */
export async function clusterStories(
  articleIds: string[],
): Promise<{ joined: number; created: number }> {
  if (articleIds.length === 0) return { joined: 0, created: 0 };

  const pending = await db.$queryRawUnsafe<
    { id: string; published_at: Date; embedding: string }[]
  >(
    `SELECT id, published_at, embedding::text AS embedding
     FROM articles
     WHERE id = ANY($1::text[]) AND embedding IS NOT NULL
     ORDER BY published_at ASC`,
    articleIds,
  );

  let joined = 0;
  let created = 0;

  for (const article of pending) {
    const [nearest] = await db.$queryRawUnsafe<
      { story_cluster_id: string; similarity: number }[]
    >(
      `SELECT story_cluster_id,
              1 - (embedding <=> $1::vector) AS similarity
       FROM articles
       WHERE story_cluster_id IS NOT NULL
         AND embedding IS NOT NULL
         AND id <> $2
         AND published_at BETWEEN $3 AND $4
       ORDER BY embedding <=> $1::vector
       LIMIT 1`,
      article.embedding,
      article.id,
      new Date(article.published_at.getTime() - CLUSTER_WINDOW_HOURS * 3600_000),
      new Date(article.published_at.getTime() + CLUSTER_WINDOW_HOURS * 3600_000),
    );

    const clusterId =
      nearest && nearest.similarity >= CLUSTER_THRESHOLD
        ? nearest.story_cluster_id
        : randomUUID();

    if (nearest && nearest.similarity >= CLUSTER_THRESHOLD) joined++;
    else created++;

    await db.$executeRawUnsafe(
      `UPDATE articles SET story_cluster_id = $1 WHERE id = $2`,
      clusterId,
      article.id,
    );
  }

  return { joined, created };
}

/** Run every stage. This is what the cron calls. */
export async function ingest(source: NewsSource): Promise<IngestReport> {
  const startedAt = Date.now();

  const { articles, errors } = await source.fetchLatest();
  const { fresh, duplicates } = await filterNew(articles);
  const ids = await embedAndStore(fresh);
  const tagged = await tagTopics(ids);
  const clusters = await clusterStories(ids);

  return {
    fetched: articles.length,
    duplicates,
    inserted: ids.length,
    tagged,
    clustersJoined: clusters.joined,
    clustersCreated: clusters.created,
    feedErrors: errors.map((e) => ({ feedId: e.feedId, message: e.message })),
    durationMs: Date.now() - startedAt,
  };
}
