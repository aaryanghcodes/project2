import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { INTEREST_GROUPS } from "@/data/interests";
import { InterestPicker } from "./picker";

export const metadata = { title: "Pick your interests" };
export const dynamic = "force-dynamic";

export default async function InterestsPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const [interests, existing] = await Promise.all([
    db.interest.findMany({
      select: { id: true, slug: true, label: true, emoji: true, group: true },
      orderBy: [{ group: "asc" }, { sortOrder: "asc" }],
    }),
    db.userInterest.findMany({
      where: { userId: user.id, source: "ONBOARDING" },
      select: { interestId: true },
    }),
  ]);

  // Ordered by the catalog's own group order rather than alphabetically, so
  // Technology leads and Lifestyle trails, as the catalog intends.
  const grouped = INTEREST_GROUPS.map((group) => ({
    group,
    items: interests.filter((interest) => interest.group === group),
  })).filter((section) => section.items.length > 0);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 pb-32">
      <header>
        <p className="text-sm font-medium text-accent">Step 1 of 2</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          What are you interested in?
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Pick at least three. This only needs to get us in the right
          neighbourhood — the next step is where we find out what you actually
          like.
        </p>
      </header>

      <InterestPicker
        groups={grouped}
        initialSelected={existing.map((row) => row.interestId)}
      />
    </main>
  );
}
