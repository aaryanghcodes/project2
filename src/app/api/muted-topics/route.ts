import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const schema = z.object({ interestId: z.string().min(1) });

/**
 * Mute a topic.
 *
 * Distinct from disliking an article. A dislike is evidence that shifts a
 * negative centroid and can be outweighed by a strong enough positive match; a
 * mute is an instruction, and retrieval filters on it outright. Users who ask
 * not to see something and then keep seeing it stop trusting the controls.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const interest = await db.interest.findUnique({
    where: { id: parsed.data.interestId },
    select: { id: true, label: true },
  });
  if (!interest) {
    return NextResponse.json({ error: "No such topic." }, { status: 404 });
  }

  await db.mutedTopic.upsert({
    where: {
      userId_interestId: { userId: user.id, interestId: interest.id },
    },
    create: { userId: user.id, interestId: interest.id },
    update: {},
  });

  return NextResponse.json({ muted: true, label: interest.label });
}

/** Unmute. */
export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const interestId = new URL(request.url).searchParams.get("interestId");
  if (!interestId) {
    return NextResponse.json({ error: "interestId is required." }, { status: 400 });
  }

  const result = await db.mutedTopic.deleteMany({
    where: { userId: user.id, interestId },
  });

  return NextResponse.json({ muted: false, removed: result.count });
}

/** The user's muted topics, for a settings screen. */
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const rows = await db.mutedTopic.findMany({
    where: { userId: user.id },
    select: { interestId: true, interest: { select: { label: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    topics: rows.map((row) => ({
      interestId: row.interestId,
      label: row.interest.label,
    })),
  });
}
