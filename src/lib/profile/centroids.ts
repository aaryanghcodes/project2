/**
 * Reading and writing a user's taste profile.
 *
 * Centroids live in `user_taste_centroids` as `Unsupported("vector(384)")`, so
 * every read and write here goes through raw SQL with literals built by
 * `toSqlVector` — Prisma Client cannot touch those columns.
 */

import { db } from "@/lib/db";
import { parseSqlVector, toSqlVector } from "@/lib/vector";
import { clusterCountFor, kmeans } from "./kmeans";

export type Polarity = "POS" | "NEG";

export interface Centroid {
  polarity: Polarity;
  idx: number;
  weight: number;
  articleCount: number;
  vector: number[];
}

/** Caps from PLAN.md §5: six things you like, three you do not. */
export const MAX_POSITIVE_CENTROIDS = 6;
export const MAX_NEGATIVE_CENTROIDS = 3;

export async function loadCentroids(userId: string): Promise<Centroid[]> {
  const rows = await db.$queryRaw<
    {
      polarity: Polarity;
      idx: number;
      weight: number;
      article_count: number;
      vector: string | null;
    }[]
  >`
    SELECT polarity, idx, weight, article_count, vector::text AS vector
    FROM user_taste_centroids
    WHERE user_id = ${userId}
    ORDER BY polarity, idx
  `;

  return rows
    .filter((row) => row.vector !== null)
    .map((row) => ({
      polarity: row.polarity,
      idx: row.idx,
      weight: row.weight,
      articleCount: row.article_count,
      vector: parseSqlVector(row.vector!),
    }));
}

/**
 * Replace a user's centroids of one polarity.
 *
 * Scoped to a single polarity so rebuilding positives from likes cannot wipe
 * negatives that were derived from a different set of ratings. Wrapped in a
 * transaction because a half-applied profile ranks worse than either the old
 * one or the new one.
 */
export async function replaceCentroids(
  userId: string,
  polarity: Polarity,
  centroids: { vector: number[]; weight: number; articleCount: number }[],
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM user_taste_centroids
      WHERE user_id = ${userId} AND polarity = ${polarity}::"CentroidPolarity"
    `;

    for (const [idx, centroid] of centroids.entries()) {
      // updated_at is @updatedAt, which Prisma Client fills in — but this row
      // is written as raw SQL to carry the vector column, so it has to be set
      // explicitly or the NOT NULL constraint rejects the insert.
      await tx.$executeRawUnsafe(
        `INSERT INTO user_taste_centroids
           (user_id, polarity, idx, weight, article_count, vector, updated_at)
         VALUES ($1, $2::"CentroidPolarity", $3, $4, $5, $6::vector, now())`,
        userId,
        polarity,
        idx,
        centroid.weight,
        centroid.articleCount,
        toSqlVector(centroid.vector),
      );
    }
  });
}

/**
 * Cold start: build positive centroids straight from the interests the user
 * checked, before they have rated anything.
 *
 * One centroid per interest *group* rather than per interest. Someone who
 * checks six Technology topics holds one broad technology taste, not six
 * separate ones, and spending all six centroid slots on it would leave no room
 * for the Sports interest they also picked. Grouping keeps the profile's
 * breadth proportional to the breadth of what they actually chose.
 *
 * These are deliberately weak (weight 0.6): they are a guess from a checkbox,
 * and should yield to real ratings as soon as any exist.
 */
export async function seedCentroidsFromInterests(
  userId: string,
  interestIds: string[],
): Promise<number> {
  if (interestIds.length === 0) return 0;

  const rows = await db.$queryRaw<
    { interest_group: string; vector: string | null }[]
  >`
    SELECT interest_group, avg(seed_embedding)::text AS vector
    FROM interests
    WHERE id = ANY(${interestIds}::text[]) AND seed_embedding IS NOT NULL
    GROUP BY interest_group
    ORDER BY interest_group
  `;

  const centroids = rows
    .filter((row) => row.vector !== null)
    .slice(0, MAX_POSITIVE_CENTROIDS)
    .map((row) => ({
      vector: parseSqlVector(row.vector!),
      weight: 0.6,
      articleCount: 0,
    }));

  await replaceCentroids(userId, "POS", centroids);
  return centroids.length;
}

/**
 * Rebuild one polarity's centroids from a set of article embeddings.
 *
 * Centroid weight is the share of ratings it accounts for, normalized so the
 * largest is 1.0. A taste backed by nine likes should outrank one backed by a
 * single like when both match a candidate, and scoring reads that weight
 * directly (PLAN.md §5).
 */
export async function rebuildCentroidsFromVectors(
  userId: string,
  polarity: Polarity,
  vectors: number[][],
): Promise<number> {
  if (vectors.length === 0) {
    await replaceCentroids(userId, polarity, []);
    return 0;
  }

  const max =
    polarity === "POS" ? MAX_POSITIVE_CENTROIDS : MAX_NEGATIVE_CENTROIDS;
  const clusters = kmeans(vectors, clusterCountFor(vectors.length, max));

  const largest = Math.max(...clusters.map((c) => c.members.length));
  const centroids = clusters.map((cluster) => ({
    vector: cluster.centroid,
    weight: cluster.members.length / largest,
    articleCount: cluster.members.length,
  }));

  await replaceCentroids(userId, polarity, centroids);
  return centroids.length;
}

/**
 * Fetch the embeddings of articles a user reacted to a given way.
 *
 * LIKE and SAVE both count as positive evidence; DISLIKE and HIDE as negative.
 * CLICK and DWELL are deliberately excluded — PLAN.md §5 defers implicit
 * signals until there is real traffic to calibrate their weight against.
 */
export async function interactionVectors(
  userId: string,
  polarity: Polarity,
): Promise<number[][]> {
  const types =
    polarity === "POS" ? ["LIKE", "SAVE"] : ["DISLIKE", "HIDE"];

  const rows = await db.$queryRaw<{ vector: string }[]>`
    SELECT a.embedding::text AS vector
    FROM interactions i
    JOIN articles a ON a.id = i.article_id
    WHERE i.user_id = ${userId}
      AND i.type::text = ANY(${types}::text[])
      AND a.embedding IS NOT NULL
  `;

  return rows.map((row) => parseSqlVector(row.vector));
}

/**
 * Rebuild both polarities from everything the user has rated. Called at the end
 * of onboarding calibration, and again by the nightly refit in Phase 4.
 *
 * Positives fall back to the interest seeds when there is nothing to cluster:
 * a user who disliked all 18 calibration cards would otherwise finish
 * onboarding with an empty positive profile and an unrankable feed.
 */
export async function rebuildProfile(
  userId: string,
  fallbackInterestIds: string[] = [],
): Promise<{ positive: number; negative: number }> {
  const [positiveVectors, negativeVectors] = await Promise.all([
    interactionVectors(userId, "POS"),
    interactionVectors(userId, "NEG"),
  ]);

  const positive =
    positiveVectors.length > 0
      ? await rebuildCentroidsFromVectors(userId, "POS", positiveVectors)
      : await seedCentroidsFromInterests(userId, fallbackInterestIds);

  const negative = await rebuildCentroidsFromVectors(
    userId,
    "NEG",
    negativeVectors,
  );

  return { positive, negative };
}
