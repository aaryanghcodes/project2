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
import { parseSqlVector, toSqlVector } from "@/lib/vector";
import { urlHash } from "@/lib/news/normalize";
import type { NewsSource, RawArticle } from "@/lib/news/types";
import { sourceText, summarize } from "./summarize";

/**
 * Minimum cosine similarity for an article to be tagged with an interest.
 *
 * Measured, on a 722-article run against the live feed list: the
 * best-matching interest per article has max 0.727, mean 0.541, p10 0.468.
 *
 * A *random* article/interest pair already scores 0.408 on average, with p95
 * at 0.506. That leaves a usable window for a global cutoff roughly 0.035
 * wide — between the noise p95 and the mean best match. Both guesses fell
 * outside it: 0.55 sat above the mean and left 421 of 722 articles (58%)
 * untagged, while 0.50 sat below the noise p95 and began admitting unrelated
 * pairs.
 *
 * A window that narrow is not something to tune more carefully; it means the
 * instrument is wrong. bge-small compresses cosine similarity into a tight
 * band, and where an article sits in that band shifts with its length,
 * register, and subject. So the test is relative: an interest is tagged when
 * it stands out from the other 43 *for this article*, measured in standard
 * deviations. That is scale-free, which also means it survives a change of
 * embedding model far better than a hand-set constant would.
 *
 * Measured outcome of the switch, same 722 articles: untagged went 172 → 200
 * and every interest's tag count fell (Soccer 100 → 95, Asia 91 → 77), while
 * mean confidence rose slightly across the board. So it trimmed the weakest
 * tags — precision up, recall marginally down. Worth being honest that this
 * is a modest aggregate change; the real argument for it is robustness, not a
 * step change in quality. There is no labelled ground truth here, so tuning
 * TOPIC_Z further would be guessing.
 *
 * Re-check `npm run verify:ingest` after touching either value. Tagging only
 * runs at ingest, so `npm run retag` is what applies a change to articles
 * already stored.
 *
 * The trade is asymmetric: too permissive attaches plausible-sounding but
 * wrong topics, which is worse than leaving an article untagged, because
 * vector retrieval can still find an untagged article.
 */
const TOPIC_Z = 1.5;

/**
 * Absolute backstop, set at the measured noise p95. Catches the degenerate
 * case where an article is equally unrelated to everything in the catalog —
 * something is still 1.5σ above the rest there, and it means nothing.
 */
const TOPIC_FLOOR = 0.506;

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
  summarized: number;
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

  // The inner subquery scores this article against every interest and, via the
  // window functions, computes that article's own mean and spread in the same
  // pass. The outer filter then keeps only interests standing out from the
  // article's own distribution, rather than clearing a global line.
  return db.$executeRawUnsafe(
    `INSERT INTO article_topics (article_id, interest_id, confidence)
     SELECT a.id, t.interest_id, t.confidence
     FROM articles a
     CROSS JOIN LATERAL (
       SELECT s.interest_id, s.confidence
       FROM (
         SELECT i.id AS interest_id,
                1 - (a.embedding <=> i.seed_embedding) AS confidence,
                avg(1 - (a.embedding <=> i.seed_embedding)) OVER () AS mean,
                stddev_pop(1 - (a.embedding <=> i.seed_embedding)) OVER () AS sd
         FROM interests i
         WHERE i.seed_embedding IS NOT NULL
       ) s
       -- A zero spread would make the z-test meaningless rather than strict,
       -- so it is treated as "nothing stands out".
       WHERE s.sd > 0
         AND s.confidence >= s.mean + ($2 * s.sd)
         AND s.confidence >= $3
       ORDER BY s.confidence DESC
       LIMIT $4
     ) t
     WHERE a.id = ANY($1::text[])
       AND a.embedding IS NOT NULL
     ON CONFLICT (article_id, interest_id)
       DO UPDATE SET confidence = EXCLUDED.confidence`,
    articleIds,
    TOPIC_Z,
    TOPIC_FLOOR,
    TOPIC_LIMIT,
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

/**
 * Derive and store a summary for each article.
 *
 * Runs after storage rather than before, so it can work from the article's own
 * embedding — the reference point for deciding which sentences are central.
 *
 * Failures are per-article and non-fatal: an article that cannot be summarised
 * keeps a null summary and the UI falls back to the publisher's description.
 * A summarisation problem should never cost us the article.
 */
export async function summarizeArticles(articleIds: string[]): Promise<number> {
  if (articleIds.length === 0) return 0;

  const rows = await db.$queryRawUnsafe<
    {
      id: string;
      description: string | null;
      content_snippet: string | null;
      embedding: string;
    }[]
  >(
    `SELECT id, description, content_snippet, embedding::text AS embedding
     FROM articles
     WHERE id = ANY($1::text[]) AND embedding IS NOT NULL`,
    articleIds,
  );

  let written = 0;

  for (const row of rows) {
    const text = sourceText({
      description: row.description,
      contentSnippet: row.content_snippet,
    });
    if (!text) continue;

    try {
      const summary = await summarize(
        { text, articleEmbedding: parseSqlVector(row.embedding) },
        (texts) => embedBatch(texts),
      );
      if (!summary) continue;

      await db.article.update({
        where: { id: row.id },
        data: { summary },
      });
      written++;
    } catch (error) {
      console.warn(
        `[ingest] could not summarise ${row.id}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  return written;
}

/** Run every stage. This is what the cron calls. */
export async function ingest(source: NewsSource): Promise<IngestReport> {
  const startedAt = Date.now();

  const { articles, errors } = await source.fetchLatest();
  const { fresh, duplicates } = await filterNew(articles);
  const ids = await embedAndStore(fresh);
  const summarized = await summarizeArticles(ids);
  const tagged = await tagTopics(ids);
  const clusters = await clusterStories(ids);

  return {
    fetched: articles.length,
    duplicates,
    inserted: ids.length,
    summarized,
    tagged,
    clustersJoined: clusters.joined,
    clustersCreated: clusters.created,
    feedErrors: errors.map((e) => ({ feedId: e.feedId, message: e.message })),
    durationMs: Date.now() - startedAt,
  };
}
