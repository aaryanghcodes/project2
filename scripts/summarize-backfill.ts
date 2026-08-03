/**
 * Generate summaries for articles already in the database.
 *
 * Summarisation runs at ingest, so without this the several hundred articles
 * collected before the feature existed would keep showing publisher
 * descriptions forever.
 *
 * Safe to re-run: by default it only touches articles with no summary. Pass
 * --all to regenerate everything, which is what you want after changing the
 * selection heuristics in src/lib/ingest/summarize.ts.
 *
 *   npm run summarize:backfill
 *   npm run summarize:backfill -- --all
 *   npm run summarize:backfill -- --sample     # preview, writes nothing
 */

import "dotenv/config";
import { db } from "../src/lib/db";
import { summarizeArticles } from "../src/lib/ingest/pipeline";
import { sourceText, summarize } from "../src/lib/ingest/summarize";
import { embedBatch, activeProvider } from "../src/lib/embeddings";
import { parseSqlVector } from "../src/lib/vector";

/** Small batches so a long run reports progress and can be interrupted safely. */
const BATCH = 50;

/**
 * Preview mode. Prints the publisher description next to the derived summary
 * so the difference is actually inspectable — the whole point of this feature
 * is qualitative, and a count of rows written tells you nothing about whether
 * it reads better.
 */
async function sample(): Promise<void> {
  const rows = await db.$queryRaw<
    {
      title: string;
      description: string | null;
      content_snippet: string | null;
      embedding: string;
    }[]
  >`
    SELECT title, description, content_snippet, embedding::text AS embedding
    FROM articles
    WHERE embedding IS NOT NULL AND content_snippet IS NOT NULL
    ORDER BY random() LIMIT 8
  `;

  for (const row of rows) {
    const text = sourceText({
      description: row.description,
      contentSnippet: row.content_snippet,
    });
    const summary = text
      ? await summarize(
          { text, articleEmbedding: parseSqlVector(row.embedding) },
          (texts) => embedBatch(texts),
        )
      : null;

    console.log(`\n${"─".repeat(72)}`);
    console.log(`TITLE    ${row.title}`);
    console.log(`WAS      ${(row.description ?? "(none)").slice(0, 200)}`);
    console.log(`NOW      ${summary ?? "(no summary — falls back to above)"}`);
  }
  console.log(`\n${"─".repeat(72)}\n`);
}

async function main(): Promise<void> {
  const all = process.argv.includes("--all");

  if (process.argv.includes("--sample")) {
    console.log(`[backfill] preview only, nothing written\n`);
    await sample();
    return;
  }

  console.log(`[backfill] provider=${activeProvider()} mode=${all ? "all" : "missing only"}`);

  const targets = await db.article.findMany({
    where: all ? {} : { summary: null },
    select: { id: true },
    orderBy: { publishedAt: "desc" },
  });

  console.log(`[backfill] ${targets.length} article(s) to process`);
  if (targets.length === 0) return;

  let written = 0;
  for (let i = 0; i < targets.length; i += BATCH) {
    const ids = targets.slice(i, i + BATCH).map((row) => row.id);
    written += await summarizeArticles(ids);
    process.stdout.write(
      `\r[backfill] ${Math.min(i + BATCH, targets.length)}/${targets.length} processed, ${written} written`,
    );
  }

  const remaining = await db.article.count({ where: { summary: null } });
  console.log(
    `\n[backfill] done. ${written} summaries written; ${remaining} article(s) ` +
      `still have none (too little source text — the UI falls back to the ` +
      `publisher description for those).`,
  );

  await sample();
}

main()
  .catch((error) => {
    console.error("[backfill] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
