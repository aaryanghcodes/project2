/**
 * Seeds the interest catalog and computes each interest's seed embedding.
 *
 * Idempotent: re-running updates labels, descriptions and vectors in place
 * rather than duplicating rows, so editing src/data/interests.ts and re-running
 * is the normal workflow.
 *
 * Run with: npm run db:seed
 */

import { db } from "../src/lib/db";
import { interestsWithOrder } from "../src/data/interests";
import { activeProvider, embedBatch } from "../src/lib/embeddings";
import { toSqlVector } from "../src/lib/vector";

async function main() {
  const interests = interestsWithOrder();
  console.log(
    `Seeding ${interests.length} interests using the "${activeProvider()}" embedding provider…`,
  );

  // Upsert the rows first. Vectors cannot go through Prisma Client because the
  // column is Unsupported(), so they are written separately below.
  for (const interest of interests) {
    await db.interest.upsert({
      where: { slug: interest.slug },
      create: {
        slug: interest.slug,
        label: interest.label,
        description: interest.description,
        group: interest.group,
        emoji: interest.emoji,
        sortOrder: interest.sortOrder,
      },
      update: {
        label: interest.label,
        description: interest.description,
        group: interest.group,
        emoji: interest.emoji,
        sortOrder: interest.sortOrder,
      },
    });
  }
  console.log(`  ✓ ${interests.length} interest rows upserted`);

  const started = Date.now();
  const vectors = await embedBatch(interests.map((i) => i.description));
  console.log(
    `  ✓ embedded in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );

  for (let i = 0; i < interests.length; i++) {
    await db.$executeRaw`
      UPDATE interests
         SET seed_embedding = ${toSqlVector(vectors[i])}::vector
       WHERE slug = ${interests[i].slug}
    `;
  }
  console.log(`  ✓ ${vectors.length} seed embeddings written`);

  const [{ count }] = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM interests WHERE seed_embedding IS NOT NULL
  `;
  if (Number(count) !== interests.length) {
    throw new Error(
      `Expected ${interests.length} embedded interests, found ${count}.`,
    );
  }

  console.log(`\nDone. ${count} interests ready.`);
}

main()
  .catch((error) => {
    console.error("\nSeed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
