import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCalibrationSample } from "@/lib/onboarding/calibration";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const selected = await db.userInterest.findMany({
    where: { userId: user.id, source: "ONBOARDING" },
    select: { interestId: true },
  });

  if (selected.length === 0) {
    return NextResponse.json(
      { error: "Pick your interests first.", cards: [] },
      { status: 409 },
    );
  }

  const cards = await buildCalibrationSample(
    user.id,
    selected.map((row) => row.interestId),
  );

  return NextResponse.json({ cards });
}
