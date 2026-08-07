/**
 * Reading and writing a user's taste profile.
 *
 * Centroids live in `user_taste_centroids` as `Unsupported("vector(384)")`, so
 * every read and write here goes through raw SQL with literals built by
 * `toSqlVector` — Prisma Client cannot touch those columns.
 */

import { db } from "@/lib/db";
import { cosineSimilarity, normalize, parseSqlVector, toSqlVector } from "@/lib/vector";
import { clusterCountFor, kmeans } from "./kmeans";
import { ignoredVectors, readingSignalVectors } from "./reading-signals";

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
 * LIKE is the only positive evidence; DISLIKE and HIDE are negative.
 *
 * SAVE used to count as positive here and deliberately no longer does. Saving
 * is a filing action, not an endorsement — people bookmark things to read
 * later, to disagree with, or because a colleague sent it — so treating it as
 * a like quietly dragged profiles toward whatever someone meant to get back
 * to. Bookmarks now live in `saved_articles` and never reach this query.
 *
 * CLICK and DWELL are excluded *here* but not from the profile: implicit
 * reading behaviour is a separate, much quieter channel handled by
 * ./reading-signals.ts. Keeping the two apart means a flood of weak implicit
 * evidence can never drown out the handful of times someone pressed a button.
 */
export async function interactionVectors(
  userId: string,
  polarity: Polarity,
): Promise<number[][]> {
  const types = polarity === "POS" ? ["LIKE"] : ["DISLIKE", "HIDE"];

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
 * Nudge the profile toward a single newly-rated article, without a full refit.
 *
 * `c ← normalize(c + η(a - c))` against the nearest centroid of matching
 * polarity, per PLAN.md §5. The learning rate decays as that centroid's
 * article count grows, so early ratings move the profile decisively and later
 * ones refine it — a centroid built from forty likes should not be yanked
 * across embedding space by the forty-first.
 *
 * The floor on η matters as much as the decay: without it a long-established
 * centroid becomes effectively frozen, and someone whose interests genuinely
 * shift can never escape the profile they had a year ago.
 */
export async function nudgeCentroidToward(
  userId: string,
  articleEmbedding: number[],
  polarity: Polarity,
): Promise<{ updated: number | null; created: boolean }> {
  const centroids = (await loadCentroids(userId)).filter(
    (c) => c.polarity === polarity,
  );

  const max =
    polarity === "POS" ? MAX_POSITIVE_CENTROIDS : MAX_NEGATIVE_CENTROIDS;

  // First rating of this polarity, or room to spare and nothing close: the
  // article becomes a centroid of its own rather than distorting an unrelated
  // one. This is how a genuinely new interest gets represented at all.
  let nearestIdx: number | null = null;
  let nearestScore = -Infinity;
  for (const centroid of centroids) {
    const score = cosineSimilarity(articleEmbedding, centroid.vector);
    if (score > nearestScore) {
      nearestScore = score;
      nearestIdx = centroid.idx;
    }
  }

  const NEW_CENTROID_THRESHOLD = 0.3;
  if (
    centroids.length < max &&
    (nearestIdx === null || nearestScore < NEW_CENTROID_THRESHOLD)
  ) {
    const idx = centroids.length;
    await db.$executeRawUnsafe(
      `INSERT INTO user_taste_centroids
         (user_id, polarity, idx, weight, article_count, vector, updated_at)
       VALUES ($1, $2::"CentroidPolarity", $3, $4, $5, $6::vector, now())
       ON CONFLICT (user_id, polarity, idx) DO NOTHING`,
      userId,
      polarity,
      idx,
      0.5,
      1,
      toSqlVector(normalize(articleEmbedding)),
    );
    return { updated: null, created: true };
  }

  if (nearestIdx === null) return { updated: null, created: false };

  const target = centroids.find((c) => c.idx === nearestIdx)!;
  const eta = Math.max(0.05, 1 / (target.articleCount + 3));

  const moved = normalize(
    target.vector.map((v, i) => v + eta * (articleEmbedding[i] - v)),
  );

  await db.$executeRawUnsafe(
    `UPDATE user_taste_centroids
     SET vector = $1::vector, article_count = article_count + 1, updated_at = now()
     WHERE user_id = $2 AND polarity = $3::"CentroidPolarity" AND idx = $4`,
    toSqlVector(moved),
    userId,
    polarity,
    nearestIdx,
  );

  return { updated: nearestIdx, created: false };
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
  options: { includeReadingSignals?: boolean } = {},
): Promise<{ positive: number; negative: number; implicit: number }> {
  const { includeReadingSignals = true } = options;

  const [positiveVectors, negativeVectors] = await Promise.all([
    interactionVectors(userId, "POS"),
    interactionVectors(userId, "NEG"),
  ]);

  const [implicitPositive, implicitNegative, ignored] = includeReadingSignals
    ? await Promise.all([
        readingSignalVectors(userId, "POS"),
        readingSignalVectors(userId, "NEG"),
        ignoredVectors(userId),
      ])
    : [[], [], []];

  const positiveInput = [
    ...positiveVectors.map((vector) => ({ vector, weight: 1 })),
    ...implicitPositive,
  ];
  const negativeInput = [
    ...negativeVectors.map((vector) => ({ vector, weight: 1 })),
    ...implicitNegative,
    ...ignored,
  ];

  const positive =
    positiveInput.length > 0
      ? await rebuildCentroidsFromVectors(userId, "POS", expand(positiveInput))
      : await seedCentroidsFromInterests(userId, fallbackInterestIds);

  const negative = await rebuildCentroidsFromVectors(
    userId,
    "NEG",
    expand(negativeInput),
  );

  return {
    positive,
    negative,
    implicit: implicitPositive.length + implicitNegative.length + ignored.length,
  };
}

/**
 * Turn weighted evidence into the flat vector list k-means expects.
 *
 * k-means gives every point equal say, so weight is expressed as multiplicity:
 * an explicit like (1.0) contributes three copies, a long read (0.35) one, an
 * ignored impression (0.05) none until several accumulate. Crude, but it keeps
 * the clustering code weight-agnostic, and it makes the relative influence of
 * each signal legible as a small integer rather than hidden in a distance
 * function.
 *
 * The resolution is deliberately low. A finer scale would imply these weights
 * are calibrated, and they are not — there is no traffic yet to fit them
 * against.
 */
const WEIGHT_RESOLUTION = 3;

function expand(entries: { vector: number[]; weight: number }[]): number[][] {
  const out: number[][] = [];
  for (const entry of entries) {
    const copies = Math.round(entry.weight * WEIGHT_RESOLUTION);
    for (let i = 0; i < copies; i++) out.push(entry.vector);
  }
  return out;
}
