import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { seedCentroidsFromInterests } from "@/lib/profile/centroids";

/**
 * Saves the interest selection and seeds a cold-start profile from it.
 *
 * Auth is checked here rather than in proxy.ts — per the Next 16 docs, proxy
 * is for optimistic checks only, and this route writes.
 */

const MIN_INTERESTS = 3;

const schema = z.object({
  interestIds: z
    .array(z.string().min(1))
    .min(MIN_INTERESTS, `Pick at least ${MIN_INTERESTS} interests.`)
    .max(40, "That is more interests than the catalog holds."),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  // Validate against the catalog rather than trusting the ids: an unknown id
  // would otherwise fail later, at centroid-seeding time, as a foreign key
  // error with nothing useful to show the user.
  const known = await db.interest.findMany({
    where: { id: { in: parsed.data.interestIds } },
    select: { id: true },
  });
  if (known.length < MIN_INTERESTS) {
    return NextResponse.json(
      { error: `Pick at least ${MIN_INTERESTS} interests.` },
      { status: 400 },
    );
  }
  const interestIds = known.map((row) => row.id);

  await db.$transaction([
    // Replace rather than merge: the picker submits the full selection, so a
    // removed checkbox has to actually remove the row. Only ONBOARDING-sourced
    // rows are cleared — INFERRED interests come from behaviour, not this form.
    db.userInterest.deleteMany({
      where: { userId: user.id, source: "ONBOARDING" },
    }),
    db.userInterest.createMany({
      data: interestIds.map((interestId) => ({
        userId: user.id,
        interestId,
        source: "ONBOARDING" as const,
      })),
      skipDuplicates: true,
    }),
    db.user.update({
      where: { id: user.id },
      data: { onboardingState: "CALIBRATION" },
    }),
  ]);

  const seeded = await seedCentroidsFromInterests(user.id, interestIds);

  return NextResponse.json({ ok: true, interests: interestIds.length, seeded });
}
