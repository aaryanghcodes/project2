/**
 * Walks a throwaway user through the whole onboarding flow and checks what it
 * produced.
 *
 * This is the Phase 2 acceptance test from PLAN.md §8 — "a new user finishes
 * onboarding and has populated user_taste_centroids" — expressed as something
 * runnable. It exercises the library layer directly rather than the HTTP
 * routes, since the routes are thin wrappers over these calls and driving them
 * would mean standing up a server and a session just to reach the same code.
 *
 *   npm run verify:onboarding
 *
 * The test user is deleted on the way out, including on failure.
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import {
  buildCalibrationSample,
  CALIBRATION_SIZE,
  MIN_RATINGS,
} from "../src/lib/onboarding/calibration";
import { loadCentroids, rebuildProfile, seedCentroidsFromInterests } from "../src/lib/profile/centroids";
import { cosineSimilarity } from "../src/lib/vector";

async function main(): Promise<void> {
  const email = `onboarding-check-${randomUUID()}@example.test`;
  const user = await db.user.create({ data: { email } });
  console.log(`[check] created throwaway user ${email}\n`);

  try {
    // ---- step 1: pick interests ----------------------------------------
    const catalog = await db.interest.findMany({
      select: { id: true, label: true, group: true },
      orderBy: { sortOrder: "asc" },
    });
    if (catalog.length === 0) throw new Error("Interest catalog is empty — run npm run db:seed.");

    // Deliberately spread across groups, which is the case that matters: a
    // single-group pick would not exercise multi-centroid behaviour at all.
    const byGroup = new Map<string, string>();
    for (const interest of catalog) {
      if (!byGroup.has(interest.group)) byGroup.set(interest.group, interest.id);
    }
    const picked = [...byGroup.values()].slice(0, 5);
    const pickedLabels = catalog
      .filter((i) => picked.includes(i.id))
      .map((i) => i.label);

    await db.userInterest.createMany({
      data: picked.map((interestId) => ({
        userId: user.id,
        interestId,
        source: "ONBOARDING" as const,
      })),
    });
    console.log(`1. picked ${picked.length} interests: ${pickedLabels.join(", ")}`);

    // ---- step 2: cold-start seeding ------------------------------------
    const seeded = await seedCentroidsFromInterests(user.id, picked);
    const coldStart = await loadCentroids(user.id);
    console.log(
      `2. cold start seeded ${seeded} centroid(s) from interest groups ` +
        `(weight ${coldStart[0]?.weight ?? "n/a"})`,
    );
    if (seeded === 0) throw new Error("Cold start produced no centroids.");

    // ---- step 3: calibration deck --------------------------------------
    const cards = await buildCalibrationSample(user.id, picked);
    const offProfile = cards.filter((c) => c.offProfile).length;
    const covered = new Set(cards.map((c) => c.viaInterest).filter(Boolean));
    console.log(
      `3. calibration deck: ${cards.length}/${CALIBRATION_SIZE} cards, ` +
        `${offProfile} off-profile probe(s), ${covered.size}/${picked.length} interests covered`,
    );

    if (cards.length === 0) {
      throw new Error("Calibration produced no cards — is the article table empty?");
    }

    const uniqueIds = new Set(cards.map((c) => c.id));
    if (uniqueIds.size !== cards.length) {
      throw new Error("Calibration deck contains duplicate articles.");
    }
    console.log(`   no duplicates (${uniqueIds.size} distinct articles)`);

    // The whole point of MMR: cards should not be near-copies of each other.
    // Reported rather than asserted, because the right value depends on the
    // embedding provider and corpus size.
    const sample = cards.slice(0, 8);
    let worstPair = -1;
    for (let i = 0; i < sample.length; i++) {
      for (let j = i + 1; j < sample.length; j++) {
        const a = await db.$queryRaw<{ sim: number }[]>`
          SELECT 1 - (x.embedding <=> y.embedding) AS sim
          FROM articles x, articles y
          WHERE x.id = ${sample[i].id} AND y.id = ${sample[j].id}
        `;
        if (a[0]) worstPair = Math.max(worstPair, a[0].sim);
      }
    }
    console.log(`   most-similar pair among first 8: ${worstPair.toFixed(3)}`);

    // ---- step 4: rate them ---------------------------------------------
    // Alternating like/dislike gives both polarities something to cluster,
    // which is what makes the negative-centroid path testable at all.
    const toRate = cards.slice(0, Math.max(MIN_RATINGS, 12));
    await db.interaction.createMany({
      data: toRate.map((card, i) => ({
        userId: user.id,
        articleId: card.id,
        type: i % 3 === 2 ? ("DISLIKE" as const) : ("LIKE" as const),
        context: "ONBOARDING" as const,
      })),
    });
    const likes = toRate.filter((_, i) => i % 3 !== 2).length;
    console.log(`4. rated ${toRate.length} cards (${likes} like, ${toRate.length - likes} dislike)`);

    // ---- step 5: build the profile -------------------------------------
    const profile = await rebuildProfile(user.id, picked);
    const centroids = await loadCentroids(user.id);
    const pos = centroids.filter((c) => c.polarity === "POS");
    const neg = centroids.filter((c) => c.polarity === "NEG");

    console.log(
      `5. profile rebuilt: ${profile.positive} positive, ${profile.negative} negative`,
    );

    if (pos.length === 0) throw new Error("No positive centroids after completion.");

    // Dislikes were recorded, so the negative side must exist too. Without
    // this the aversion term in scoring is silently always zero, and the feed
    // never learns what to stop showing.
    if (neg.length === 0) {
      throw new Error(
        "Dislikes were recorded but produced no negative centroids.",
      );
    }
    for (const centroid of centroids) {
      if (centroid.vector.length !== 384) {
        throw new Error(`Centroid ${centroid.idx} has ${centroid.vector.length} dims, expected 384.`);
      }
      const magnitude = Math.sqrt(
        centroid.vector.reduce((sum, v) => sum + v * v, 0),
      );
      if (Math.abs(magnitude - 1) > 0.01) {
        throw new Error(
          `Centroid ${centroid.idx} is not unit length (${magnitude.toFixed(4)}) — ` +
            `cosine scoring assumes it is.`,
        );
      }
    }
    console.log(`   all ${centroids.length} centroids are 384-dim and unit length`);

    for (const centroid of pos) {
      console.log(
        `   POS #${centroid.idx}  weight ${centroid.weight.toFixed(2)}  ` +
          `${centroid.articleCount} article(s)`,
      );
    }

    // Distinct centroids are the entire reason for the multi-vector design.
    // Identical ones would mean k-means collapsed and one vector would do.
    if (pos.length > 1) {
      let closest = -1;
      for (let i = 0; i < pos.length; i++) {
        for (let j = i + 1; j < pos.length; j++) {
          closest = Math.max(closest, cosineSimilarity(pos[i].vector, pos[j].vector));
        }
      }
      console.log(`   most-similar centroid pair: ${closest.toFixed(3)}`);
      if (closest > 0.99) {
        throw new Error("Positive centroids are effectively identical — k-means collapsed.");
      }
    }

    console.log(`\n✓ Phase 2 acceptance: user finished onboarding with a populated profile.`);
  } finally {
    // Cascades to interests, interactions, and centroids.
    await db.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log(`[check] removed throwaway user`);
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
