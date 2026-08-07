import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { nudgeCentroidToward } from "@/lib/profile/centroids";
import { parseSqlVector } from "@/lib/vector";

const schema = z.object({
  articleId: z.string().min(1),
  type: z.enum(["LIKE", "DISLIKE", "CLICK", "DWELL", "SAVE", "HIDE"]),
  dwellMs: z.number().int().nonnegative().max(3_600_000).optional(),
  context: z.enum(["ONBOARDING", "FEED"]).default("FEED"),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { articleId, type, dwellMs, context } = parsed.data;

  // The unique constraint is (userId, articleId, type), so changing a rating
  // from like to dislike would otherwise leave both rows in place and feed
  // contradictory evidence into the centroid rebuild. Opposites are cleared.
  // SAVE is absent on purpose. Bookmarking is orthogonal to taste — saving an
  // article you disagree with should not silently retract the dislike, and
  // disliking something should not un-save it from your reading list.
  const opposites: Record<string, string[]> = {
    LIKE: ["DISLIKE", "HIDE"],
    DISLIKE: ["LIKE"],
    HIDE: ["LIKE"],
  };

  await db.$transaction(async (tx) => {
    const conflicting = opposites[type];
    if (conflicting) {
      await tx.interaction.deleteMany({
        where: {
          userId: user.id,
          articleId,
          type: { in: conflicting as never[] },
        },
      });
    }

    await tx.interaction.upsert({
      where: { userId_articleId_type: { userId: user.id, articleId, type } },
      create: { userId: user.id, articleId, type, dwellMs, context },
      update: { dwellMs },
    });
  });

  // Feed ratings move the profile immediately, so the next page already
  // reflects the feedback. Onboarding ratings are deliberately excluded: the
  // whole calibration set is clustered in one pass at completion, and nudging
  // during it would let the order the cards happened to appear in bias the
  // result.
  let profile: { updated: number | null; created: boolean } | null = null;
  if (context === "FEED" && (type === "LIKE" || type === "DISLIKE")) {
    const [row] = await db.$queryRaw<{ embedding: string | null }[]>`
      SELECT embedding::text AS embedding FROM articles WHERE id = ${articleId}
    `;
    if (row?.embedding) {
      profile = await nudgeCentroidToward(
        user.id,
        parseSqlVector(row.embedding),
        type === "LIKE" ? "POS" : "NEG",
      );
    }
  }

  return NextResponse.json({ ok: true, profile });
}
