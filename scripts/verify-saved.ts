/**
 * Acceptance check for bookmarking.
 *
 * The load-bearing requirement is the negative one: saving must not influence
 * the recommendation profile. That is easy to believe and easy to get wrong —
 * SAVE previously counted as positive evidence in the centroid rebuild, so a
 * bookmark quietly pulled the profile toward whatever you meant to read later.
 * This asserts it, rather than trusting the code to stay that way.
 *
 *   npm run verify:saved
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import {
  listSaved,
  saveArticle,
  savedArticleIds,
  savedFacets,
  unsaveArticle,
} from "../src/lib/saved/saved";
import {
  loadCentroids,
  rebuildProfile,
  seedCentroidsFromInterests,
} from "../src/lib/profile/centroids";

/** Stable fingerprint of a profile, so any drift shows up as a string diff. */
function fingerprint(
  centroids: { polarity: string; idx: number; weight: number; articleCount: number; vector: number[] }[],
): string {
  return centroids
    .map(
      (c) =>
        `${c.polarity}#${c.idx}:${c.weight.toFixed(6)}:${c.articleCount}:` +
        c.vector.map((v) => v.toFixed(6)).join(","),
    )
    .join("|");
}

async function main(): Promise<void> {
  const email = `saved-check-${randomUUID()}@example.test`;
  const user = await db.user.create({
    data: { email, onboardingState: "COMPLETE" },
  });

  try {
    const interests = await db.interest.findMany({ take: 4, select: { id: true } });
    await db.userInterest.createMany({
      data: interests.map((i) => ({
        userId: user.id,
        interestId: i.id,
        source: "ONBOARDING" as const,
      })),
    });
    await seedCentroidsFromInterests(user.id, interests.map((i) => i.id));

    // Raw SQL because `embedding` is an Unsupported column and cannot appear
    // in a Prisma `where`.
    const articles = await db.$queryRaw<{ id: string; title: string }[]>`
      SELECT id, title FROM articles WHERE embedding IS NOT NULL LIMIT 6
    `;
    if (articles.length < 4) {
      throw new Error(`Need at least 4 embedded articles, found ${articles.length}.`);
    }

    // ---- the profile must not move ---------------------------------------
    const before = fingerprint(await loadCentroids(user.id));

    for (const article of articles.slice(0, 4)) {
      await saveArticle(user.id, article.id);
    }
    console.log(`1. saved ${4} article(s)`);

    const afterSave = fingerprint(await loadCentroids(user.id));
    if (afterSave !== before) {
      throw new Error("Saving changed the taste profile.");
    }
    console.log("   ✓ centroids byte-identical after saving");

    // A rebuild is where a stray SAVE would leak in, since it re-reads every
    // stored interaction. Checking only the live centroids would miss it.
    await rebuildProfile(user.id, interests.map((i) => i.id));
    const afterRebuild = await loadCentroids(user.id);
    if (afterRebuild.length === 0) {
      throw new Error("Rebuild wiped the profile.");
    }
    const positives = afterRebuild.filter((c) => c.polarity === "POS");
    if (positives.some((c) => c.articleCount > 0)) {
      throw new Error(
        "A rebuild after saving produced centroids backed by article evidence — " +
          "saves are leaking into the profile.",
      );
    }
    console.log("   ✓ full profile rebuild ignores saves entirely");

    const interactions = await db.interaction.count({ where: { userId: user.id } });
    if (interactions !== 0) {
      throw new Error(`Saving wrote ${interactions} interaction row(s); it should write none.`);
    }
    console.log("   ✓ saving wrote zero interaction rows");

    // ---- ordering, listing, idempotency ----------------------------------
    const listed = await listSaved(user.id);
    if (listed.total !== 4) throw new Error(`Expected 4 saved, got ${listed.total}.`);

    const times = listed.items.map((i) => i.savedAt.getTime());
    const descending = times.every((t, i) => i === 0 || times[i - 1] >= t);
    if (!descending) throw new Error("Saved list is not in reverse-chronological order.");
    console.log(`2. listed ${listed.total} saved, newest first`);

    const again = await saveArticle(user.id, articles[0].id);
    if (!again.alreadySaved) throw new Error("Re-saving created a duplicate.");
    if ((await listSaved(user.id)).total !== 4) {
      throw new Error("Re-saving changed the count.");
    }
    console.log("   ✓ saving twice is idempotent");

    const ids = await savedArticleIds(user.id, articles.map((a) => a.id));
    if (ids.size !== 4) throw new Error(`savedArticleIds returned ${ids.size}, expected 4.`);
    console.log("   ✓ batch saved-state lookup agrees");

    // ---- filters ---------------------------------------------------------
    const facets = await savedFacets(user.id);
    console.log(
      `3. facets: ${facets.sources.length} source(s), ${facets.topics.length} topic(s)`,
    );
    if (facets.sources.length > 0) {
      const bySource = await listSaved(user.id, { source: facets.sources[0] });
      if (bySource.total === 0) throw new Error("Source filter returned nothing for its own facet.");
      console.log(`   ✓ source filter "${facets.sources[0]}" → ${bySource.total}`);
    }
    if (facets.topics.length > 0) {
      const byTopic = await listSaved(user.id, { topic: facets.topics[0] });
      if (byTopic.total === 0) throw new Error("Topic filter returned nothing for its own facet.");
      console.log(`   ✓ topic filter "${facets.topics[0]}" → ${byTopic.total}`);
    }

    const word = listed.items[0].title.split(/\s+/).find((w) => w.length > 4);
    if (word) {
      const found = await listSaved(user.id, { query: word });
      if (found.total === 0) throw new Error(`Search for "${word}" found nothing.`);
      console.log(`   ✓ search "${word}" → ${found.total}`);
    }

    const future = await listSaved(user.id, { from: new Date(Date.now() + 86_400_000) });
    if (future.total !== 0) throw new Error("Date filter did not exclude a future-only range.");
    console.log("   ✓ date range filter excludes correctly");

    // ---- the snapshot outlives the article -------------------------------
    const victim = articles[3];
    await db.article.delete({ where: { id: victim.id } });
    const afterDelete = await listSaved(user.id);
    const orphan = afterDelete.items.find((i) => i.title === victim.title);
    if (!orphan) {
      throw new Error("Deleting the article removed the bookmark — the snapshot did not survive.");
    }
    if (!orphan.archived) throw new Error("Orphaned save is not flagged as archived.");
    if (!orphan.url || !orphan.sourceName) {
      throw new Error("Archived save lost its snapshot fields.");
    }
    console.log(`4. ✓ bookmark survived the article being deleted, flagged archived`);

    // ---- unsave ----------------------------------------------------------
    await unsaveArticle(user.id, articles[0].id);
    if ((await listSaved(user.id)).total !== 3) throw new Error("Unsave did not remove the row.");
    const noop = await unsaveArticle(user.id, articles[0].id);
    if (noop.removed !== 0) throw new Error("Unsaving twice removed something.");
    console.log("5. ✓ unsave works and is idempotent");

    console.log("\n✓ Saved articles: bookmarking works and the profile is untouched.");
  } finally {
    await db.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log("[check] removed throwaway user");
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
