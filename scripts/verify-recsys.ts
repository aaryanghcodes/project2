/**
 * Acceptance checks for the content-based recommendation system.
 *
 * Covers the parts of the design that are easy to break silently: whether
 * diversity actually diversifies, whether a mute is really a filter rather
 * than a penalty, whether implicit reading signals are weighted below explicit
 * ones, and whether a brand-new article is recommendable with no interaction
 * history at all.
 *
 *   npm run verify:recsys
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { buildFeedPage } from "../src/lib/feed/rank";
import { selectByMmr } from "../src/lib/feed/mmr";
import { seedCentroidsFromInterests, rebuildProfile, loadCentroids } from "../src/lib/profile/centroids";
import {
  classifyDwell,
  SIGNAL_WEIGHTS,
  READ_THRESHOLD_MS,
} from "../src/lib/profile/reading-signals";
import { extractKeywords, extractEntities } from "../src/lib/ingest/keywords";
import { cosineSimilarity, parseSqlVector } from "../src/lib/vector";

/** Mean pairwise similarity — lower means a more varied page. */
function meanPairwise(vectors: number[][]): number {
  if (vectors.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      total += cosineSimilarity(vectors[i], vectors[j]);
      pairs++;
    }
  }
  return total / pairs;
}

async function main(): Promise<void> {
  const created: string[] = [];

  try {
    // ---- 1. dwell is a threshold, not a magnitude ------------------------
    const shortRead = classifyDwell(READ_THRESHOLD_MS - 1_000, false);
    const longRead = classifyDwell(READ_THRESHOLD_MS + 5_000, false);
    const veryLongRead = classifyDwell(10 * 60_000, false);
    const revisit = classifyDwell(READ_THRESHOLD_MS + 5_000, true);
    const misTap = classifyDwell(500, false);

    if (misTap !== null) throw new Error("A 500ms tap was recorded as a signal.");
    if (shortRead?.kind !== "bounce") throw new Error("A short read was not treated as a bounce.");
    if (shortRead.weight >= 0) throw new Error("A bounce should be negative evidence.");
    if (longRead?.kind !== "read") throw new Error("A long read was not classified as read.");
    if (longRead.weight !== veryLongRead?.weight) {
      throw new Error(
        "A ten-minute read outweighed a thirty-second one — dwell is being " +
          "treated as a magnitude, which is the engagement-maximising failure mode.",
      );
    }
    if ((revisit?.weight ?? 0) <= longRead.weight) {
      throw new Error("A revisit should count for more than a single read.");
    }
    console.log("1. reading signals");
    console.log(`   ✓ mis-taps ignored; short read = bounce (${shortRead.weight})`);
    console.log(`   ✓ 30s and 10min reads weigh the same (${longRead.weight}) — no time maximising`);
    console.log(`   ✓ revisit (${revisit!.weight}) > single read (${longRead.weight})`);

    if (SIGNAL_WEIGHTS.read >= 1) {
      throw new Error("Implicit read weight is not below an explicit like.");
    }
    console.log(`   ✓ implicit read (${SIGNAL_WEIGHTS.read}) ranks below an explicit like (1.0)`);

    // ---- 2. metadata extraction -----------------------------------------
    const keywords = extractKeywords(
      "Central bank holds rates steady amid inflation concerns",
      "Policymakers left the benchmark interest rate unchanged. Inflation " +
        "continues to cool. The committee signalled possible cuts.",
    );
    const entities = extractEntities(
      "The Federal Reserve met in Washington. Jerome Powell said the " +
        "committee would wait. Goldman Sachs analysts disagreed.",
    );
    if (keywords.length === 0) throw new Error("No keywords extracted.");
    if (entities.length === 0) throw new Error("No entities extracted.");
    if (keywords.includes("the") || keywords.includes("said")) {
      throw new Error("Stopwords leaked into keywords.");
    }
    console.log(`\n2. metadata`);
    console.log(`   ✓ keywords: ${keywords.slice(0, 5).join(", ")}`);
    console.log(`   ✓ entities: ${entities.slice(0, 4).join(", ")}`);

    // ---- 3. MMR actually diversifies ------------------------------------
    const sample = await db.$queryRaw<{ embedding: string }[]>`
      SELECT embedding::text AS embedding FROM articles
      WHERE embedding IS NOT NULL LIMIT 40
    `;
    if (sample.length >= 12) {
      const vectors = sample.map((r) => parseSqlVector(r.embedding));
      const candidates = vectors.map((embedding, i) => ({
        embedding,
        // Descending scores, so plain ranking takes a contiguous prefix.
        score: 1 - i / vectors.length,
      }));

      const plain = candidates.slice(0, 8).map((c) => c.embedding);
      const diverse = selectByMmr(candidates, 8, 0.75).map((i) => vectors[i]);

      const plainSim = meanPairwise(plain);
      const diverseSim = meanPairwise(diverse);
      console.log(`\n3. diversity`);
      console.log(
        `   plain top-8 mean pairwise similarity: ${plainSim.toFixed(4)}`,
      );
      console.log(`   MMR top-8:                            ${diverseSim.toFixed(4)}`);
      if (diverseSim > plainSim) {
        throw new Error("MMR produced a *less* varied page than plain ranking.");
      }
      console.log("   ✓ MMR reduces redundancy");
    }

    // ---- 4. cold start: a new article is recommendable immediately -------
    const user = await db.user.create({
      data: { email: `recsys-${randomUUID()}@example.test`, onboardingState: "COMPLETE" },
    });
    created.push(user.id);

    const interests = await db.interest.findMany({ take: 3, select: { id: true } });
    await db.userInterest.createMany({
      data: interests.map((i) => ({
        userId: user.id,
        interestId: i.id,
        source: "ONBOARDING" as const,
      })),
    });
    await seedCentroidsFromInterests(user.id, interests.map((i) => i.id));

    const page = await buildFeedPage(user.id);
    if (page.items.length === 0) {
      throw new Error("A profile built only from interest seeds produced an empty feed.");
    }
    console.log(`\n4. cold start`);
    console.log(
      `   ✓ ${page.items.length} recommendations from interest vectors alone, ` +
        `zero interactions`,
    );

    // ---- 5. muting filters rather than penalises ------------------------
    const topicRows = await db.$queryRaw<{ interest_id: string; label: string; n: bigint }[]>`
      SELECT t.interest_id, i.label, count(*) AS n
      FROM article_topics t JOIN interests i ON i.id = t.interest_id
      GROUP BY t.interest_id, i.label ORDER BY count(*) DESC LIMIT 1
    `;

    if (topicRows.length > 0) {
      const muted = topicRows[0];
      await db.mutedTopic.create({
        data: { userId: user.id, interestId: muted.interest_id },
      });

      // Impressions from the first page would hide the effect, so clear them.
      await db.impression.deleteMany({ where: { userId: user.id } });
      const afterMute = await buildFeedPage(user.id);

      const leaked = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM article_topics
        WHERE interest_id = ${muted.interest_id}
          AND article_id = ANY(${afterMute.items.map((i) => i.id)}::text[])
      `;
      console.log(`\n5. muting`);
      if (Number(leaked[0].n) > 0) {
        throw new Error(
          `Muted topic "${muted.label}" still appeared ${leaked[0].n} time(s) — ` +
            `muting is not filtering at retrieval.`,
        );
      }
      console.log(`   ✓ muted "${muted.label}" produced zero matching articles in the feed`);
    }

    // ---- 6. implicit signals reach the profile without dominating -------
    const before = await loadCentroids(user.id);
    const articles = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM articles WHERE embedding IS NOT NULL LIMIT 3
    `;
    for (const article of articles) {
      await db.interaction.create({
        data: {
          userId: user.id,
          articleId: article.id,
          type: "DWELL",
          dwellMs: READ_THRESHOLD_MS + 10_000,
          context: "FEED",
        },
      });
    }
    const rebuilt = await rebuildProfile(user.id, interests.map((i) => i.id));
    const after = await loadCentroids(user.id);

    console.log(`\n6. learning loop`);
    console.log(
      `   ✓ rebuild consumed ${rebuilt.implicit} implicit signal(s); ` +
        `${before.length} → ${after.length} centroid(s)`,
    );
    if (rebuilt.implicit === 0) {
      throw new Error("Reading signals were recorded but the rebuild ignored them.");
    }

    console.log(`\n✓ Recommendation system checks passed.`);
  } finally {
    for (const id of created) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
  }
}

main()
  .catch((error) => {
    console.error("\n✗ FAILED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
