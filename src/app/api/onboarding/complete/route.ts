import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { MIN_RATINGS } from "@/lib/onboarding/calibration";
import { rebuildProfile } from "@/lib/profile/centroids";

export async function POST() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Counted server-side rather than trusted from the client, since this is the
  // gate that decides whether the profile is built from enough evidence to
  // mean anything.
  const rated = await db.interaction.count({
    where: {
      userId: user.id,
      context: "ONBOARDING",
      type: { in: ["LIKE", "DISLIKE"] },
    },
  });

  if (rated < MIN_RATINGS) {
    return NextResponse.json(
      { error: `Rate at least ${MIN_RATINGS} articles first.`, rated },
      { status: 400 },
    );
  }

  const selected = await db.userInterest.findMany({
    where: { userId: user.id, source: "ONBOARDING" },
    select: { interestId: true },
  });

  const profile = await rebuildProfile(
    user.id,
    selected.map((row) => row.interestId),
  );

  await db.user.update({
    where: { id: user.id },
    data: { onboardingState: "COMPLETE" },
  });

  return NextResponse.json({ ok: true, rated, ...profile });
}
