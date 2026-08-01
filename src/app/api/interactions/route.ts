import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

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
  const opposites: Record<string, string[]> = {
    LIKE: ["DISLIKE", "HIDE"],
    SAVE: ["DISLIKE", "HIDE"],
    DISLIKE: ["LIKE", "SAVE"],
    HIDE: ["LIKE", "SAVE"],
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

  return NextResponse.json({ ok: true });
}
