/**
 * Re-run topic tagging over articles already in the database.
 *
 * Tagging normally happens once, at ingest, against whatever TOPIC_THRESHOLD
 * was set at the time. That makes threshold changes invisible on everything
 * already stored — which is exactly backwards, since the reason to change a
 * threshold is usually that you just looked at the existing corpus and did not
 * like what you saw.
 *
 * Safe to re-run: tagging upserts, so this converges rather than accumulating.
 * It does NOT re-embed anything, so it is cheap and needs no model download.
 *
 *   npm run retag
 */

import "dotenv/config";
import { db } from "../src/lib/db";
import { tagTopics } from "../src/lib/ingest/pipeline";

/** Tagged in batches so one statement never carries the whole corpus. */
const BATCH = 500;

async function main(): Promise<void> {
  const articles = await db.article.findMany({ select: { id: true } });
  console.log(`[retag] ${articles.length} article(s) to re-tag`);

  if (articles.length === 0) return;

  // Tags below the new threshold would otherwise survive from the old one:
  // tagTopics upserts, and an upsert never deletes. Clearing first is what
  // makes raising a threshold actually take effect.
  const removed = await db.articleTopic.deleteMany({});
  console.log(`[retag] cleared ${removed.count} existing tag(s)`);

  let written = 0;
  for (let i = 0; i < articles.length; i += BATCH) {
    const ids = articles.slice(i, i + BATCH).map((a) => a.id);
    written += await tagTopics(ids);
    process.stdout.write(
      `\r[retag] ${Math.min(i + BATCH, articles.length)}/${articles.length}`,
    );
  }

  const untagged = await db.article.count({ where: { topics: { none: {} } } });
  console.log(
    `\n[retag] wrote ${written} tag(s); ${untagged} article(s) still untagged`,
  );
}

main()
  .catch((error) => {
    console.error("[retag] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
