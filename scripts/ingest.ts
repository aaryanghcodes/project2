/**
 * Ingestion entry point. Run by the GitHub Actions cron every 30 minutes, and
 * by hand during development.
 *
 * This runs as a standalone Node process rather than a Vercel route because
 * the embedding weights are ~130MB — too large for a serverless bundle, and
 * far too slow to cold-start per invocation. See PLAN.md §2.
 *
 *   npm run ingest              # live RSS
 *   npm run ingest -- --fixtures  # checked-in synthetic corpus
 */

import "dotenv/config";
import { db } from "../src/lib/db";
import { ingest } from "../src/lib/ingest/pipeline";
import { FixtureNewsSource } from "../src/lib/news/fixtures";
import { RssNewsSource } from "../src/lib/news/rss";
import { activeProvider } from "../src/lib/embeddings";
import type { NewsSource } from "../src/lib/news/types";

function selectSource(): NewsSource {
  const useFixtures =
    process.argv.includes("--fixtures") || process.env.INGEST_SOURCE === "fixtures";
  return useFixtures ? new FixtureNewsSource() : new RssNewsSource();
}

async function main(): Promise<void> {
  const source = selectSource();
  console.log(
    `[ingest] source=${source.id} embeddings=${activeProvider()}`,
  );

  const report = await ingest(source);

  console.log(
    `[ingest] fetched=${report.fetched} new=${report.inserted} ` +
      `duplicate=${report.duplicates} topics=${report.tagged} ` +
      `clusters(joined=${report.clustersJoined} new=${report.clustersCreated}) ` +
      `in ${(report.durationMs / 1000).toFixed(1)}s`,
  );

  if (report.feedErrors.length > 0) {
    console.warn(`[ingest] ${report.feedErrors.length} feed(s) failed:`);
    for (const error of report.feedErrors) {
      console.warn(`  ${error.feedId}: ${error.message}`);
    }
  }

  // A run where every feed failed is a failure, not a quiet no-op — otherwise
  // a DNS problem or a blanket block looks identical to a slow news hour and
  // the cron goes green for weeks while the database goes stale.
  if (report.fetched === 0 && report.feedErrors.length > 0) {
    throw new Error(
      "Every feed failed — no articles fetched. See the errors above.",
    );
  }
}

main()
  .catch((error) => {
    console.error("[ingest] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
