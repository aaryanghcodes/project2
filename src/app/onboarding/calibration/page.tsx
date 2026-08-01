import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCalibrationSample, MIN_RATINGS } from "@/lib/onboarding/calibration";
import { Calibrator } from "./calibrator";

export const metadata = { title: "Tune your feed" };
export const dynamic = "force-dynamic";

export default async function CalibrationPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const selected = await db.userInterest.findMany({
    where: { userId: user.id, source: "ONBOARDING" },
    select: { interestId: true },
  });

  // Reached directly by URL before picking anything — send them back rather
  // than rendering an empty deck.
  if (selected.length === 0) redirect("/onboarding/interests");

  const [cards, alreadyRated] = await Promise.all([
    buildCalibrationSample(
      user.id,
      selected.map((row) => row.interestId),
    ),
    db.interaction.count({
      where: {
        userId: user.id,
        context: "ONBOARDING",
        type: { in: ["LIKE", "DISLIKE"] },
      },
    }),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header>
        <p className="text-sm font-medium text-accent">Step 2 of 2</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Which of these would you read?
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Some of these are deliberately off your stated interests. Rating them
          honestly — including the ones you would skip — is what makes the feed
          worth reading.
        </p>
      </header>

      <Calibrator
        cards={cards.map((card) => ({
          ...card,
          publishedAt: card.publishedAt.toISOString(),
        }))}
        alreadyRated={alreadyRated}
        minRatings={MIN_RATINGS}
      />
    </main>
  );
}
