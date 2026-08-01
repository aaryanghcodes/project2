/**
 * Inspect what ingestion actually produced.
 *
 * Ingestion can succeed mechanically — rows inserted, no errors — while being
 * quietly useless, because every number that decides whether an article gets
 * tagged or clustered is a cosine similarity, and those depend entirely on
 * which embedding provider ran. This script prints the distributions those
 * thresholds sit in, and fails loudly on the two silent-corruption cases.
 *
 *   npm run verify:ingest
 */

import "dotenv/config";
import { db } from "../src/lib/db";
import { expectedClusters } from "../src/lib/news/fixtures";
import { activeProvider } from "../src/lib/embeddings";

/**
 * Below this, an "article's best matching interest" score is not credible for
 * a real semantic model. bge-small puts a good topical match around 0.6-0.8;
 * anything near 0.2 means the lexical fallback produced these vectors, or —
 * worse — that articles and interests were embedded by different providers,
 * which yields numbers that look fine and mean nothing.
 */
const IMPLAUSIBLE_SIMILARITY = 0.35;

function bar(value: number, max: number, width = 28): string {
  const filled = max === 0 ? 0 : Math.round((value / max) * width);
  return "█".repeat(filled).padEnd(width, "·");
}

async function main(): Promise<void> {
  const [counts] = await db.$queryRaw<
    { articles: bigint; embedded: bigint; clustered: bigint; topics: bigint }[]
  >`
    SELECT (SELECT count(*) FROM articles)                              AS articles,
           (SELECT count(*) FROM articles WHERE embedding IS NOT NULL)  AS embedded,
           (SELECT count(DISTINCT story_cluster_id) FROM articles
              WHERE story_cluster_id IS NOT NULL)                       AS clustered,
           (SELECT count(*) FROM article_topics)                        AS topics
  `;

  console.log(`\nprovider (this process): ${activeProvider()}`);
  console.log(
    `articles: ${counts.articles}  embedded: ${counts.embedded}  ` +
      `clusters: ${counts.clustered}  topic tags: ${counts.topics}`,
  );

  if (Number(counts.articles) === 0) {
    console.log("\nNothing ingested yet. Run: npm run ingest -- --fixtures");
    return;
  }

  if (counts.embedded < counts.articles) {
    console.warn(
      `\n!! ${counts.articles - counts.embedded} article(s) have no embedding. ` +
        `They are invisible to retrieval.`,
    );
  }

  // ---- how well articles match the interest catalog -----------------------
  const [match] = await db.$queryRaw<
    { max: number | null; mean: number | null; p10: number | null }[]
  >`
    SELECT max(sim) AS max, avg(sim) AS mean,
           percentile_cont(0.1) WITHIN GROUP (ORDER BY sim) AS p10
    FROM (
      SELECT max(1 - (a.embedding <=> i.seed_embedding)) AS sim
      FROM articles a CROSS JOIN interests i
      WHERE a.embedding IS NOT NULL AND i.seed_embedding IS NOT NULL
      GROUP BY a.id
    ) s
  `;

  if (match?.max != null) {
    console.log(
      `\nbest-matching interest per article — max ${match.max.toFixed(3)}  ` +
        `mean ${match.mean!.toFixed(3)}  p10 ${match.p10!.toFixed(3)}`,
    );

    if (match.max < IMPLAUSIBLE_SIMILARITY) {
      console.warn(
        `\n!! Best similarity in the entire corpus is ${match.max.toFixed(3)}.\n` +
          `   For a real semantic model this should reach 0.6-0.8. Either these\n` +
          `   vectors came from EMBEDDING_PROVIDER=hashed, or articles and\n` +
          `   interests were embedded by DIFFERENT providers — which produces\n` +
          `   plausible-looking numbers that mean nothing.\n` +
          `   Fix: re-run 'npm run db:seed' and re-ingest under one provider.`,
      );
    }
  }

  // ---- topic tag distribution --------------------------------------------
  const topInterests = await db.$queryRaw<
    { label: string; n: bigint; avg_conf: number }[]
  >`
    SELECT i.label, count(*) AS n, avg(t.confidence) AS avg_conf
    FROM article_topics t JOIN interests i ON i.id = t.interest_id
    GROUP BY i.label ORDER BY n DESC LIMIT 12
  `;

  if (topInterests.length > 0) {
    const peak = Number(topInterests[0].n);
    console.log("\ntop tagged interests:");
    for (const row of topInterests) {
      console.log(
        `  ${row.label.padEnd(26)} ${bar(Number(row.n), peak)} ` +
          `${String(row.n).padStart(4)}  avg ${row.avg_conf.toFixed(3)}`,
      );
    }
  } else {
    console.warn(
      "\n!! No topic tags at all. Every article scored below TOPIC_THRESHOLD.\n" +
        "   Expected if running under the hashed fallback; a real problem if not.",
    );
  }

  const [untagged] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM articles a
    WHERE NOT EXISTS (SELECT 1 FROM article_topics t WHERE t.article_id = a.id)
  `;
  console.log(`\nuntagged articles: ${untagged.n} of ${counts.articles}`);

  // ---- did the planted fixture stories actually cluster? ------------------
  const planted = expectedClusters();
  if (planted.size > 0) {
    console.log("\nplanted fixture stories (each group should share one cluster):");
    let correct = 0;
    for (const [key, urls] of planted) {
      const rows = await db.$queryRaw<{ story_cluster_id: string | null }[]>`
        SELECT story_cluster_id FROM articles WHERE url = ANY(${urls}::text[])
      `;
      if (rows.length === 0) {
        console.log(`  ${key.padEnd(16)} — not ingested, skipped`);
        continue;
      }
      const ids = new Set(rows.map((r) => r.story_cluster_id));
      const merged = ids.size === 1 && !ids.has(null);
      if (merged) correct++;
      console.log(
        `  ${key.padEnd(16)} ${merged ? "✓ merged" : "✗ split"} ` +
          `(${rows.length} articles → ${ids.size} clusters)`,
      );
    }
    console.log(`\n  ${correct}/${planted.size} planted stories merged correctly.`);
    if (correct < planted.size && activeProvider() === "hashed") {
      console.log(
        "  Under the hashed fallback this is expected — it has no notion of\n" +
          "  paraphrase. Re-check on real embeddings before tuning CLUSTER_THRESHOLD.",
      );
    }
  }

  // ---- largest clusters, to catch over-merging ---------------------------
  const biggest = await db.$queryRaw<{ n: bigint; sample: string }[]>`
    SELECT count(*) AS n, min(title) AS sample
    FROM articles WHERE story_cluster_id IS NOT NULL
    GROUP BY story_cluster_id HAVING count(*) > 1
    ORDER BY count(*) DESC LIMIT 5
  `;
  if (biggest.length > 0) {
    console.log("\nlargest clusters:");
    for (const row of biggest) {
      console.log(`  ${String(row.n).padStart(3)}  ${row.sample.slice(0, 64)}`);
    }
    const oversized = biggest.filter((r) => Number(r.n) > 12);
    if (oversized.length > 0) {
      console.warn(
        `\n!! ${oversized.length} cluster(s) hold more than 12 articles. That is\n` +
          `   usually over-merging: CLUSTER_THRESHOLD is too low, and distinct\n` +
          `   stories are collapsing into one card.`,
      );
    }
  }

  console.log("");
}

main()
  .catch((error) => {
    console.error("[verify] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
