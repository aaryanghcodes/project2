import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadCentroids } from "@/lib/profile/centroids";
import { SITE } from "@/lib/site";
import { SignOutButton } from "./sign-out";

export const metadata = { title: "Your feed" };

// Session state makes this inherently per-request; nothing here is cacheable.
export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const user = await currentUser();

  // Also catches a valid token pointing at a deleted user, which happens
  // routinely after a database reset in development.
  if (!user) redirect("/signin");

  // The real gate. proxy.ts does an optimistic check for signed-in-ness, but
  // per the Next 16 docs the authoritative check belongs here, next to the
  // data it protects.
  if (user.onboardingState === "INTERESTS") redirect("/onboarding/interests");
  if (user.onboardingState === "CALIBRATION") redirect("/onboarding/calibration");

  const [centroids, articleCount, ratedCount, interests] = await Promise.all([
    loadCentroids(user.id),
    db.article.count(),
    db.interaction.count({
      where: { userId: user.id, type: { in: ["LIKE", "DISLIKE"] } },
    }),
    db.userInterest.findMany({
      where: { userId: user.id, source: "ONBOARDING" },
      select: { interest: { select: { label: true, emoji: true } } },
      orderBy: { interest: { sortOrder: "asc" } },
    }),
  ]);

  const positive = centroids.filter((c) => c.polarity === "POS");
  const negative = centroids.filter((c) => c.polarity === "NEG");

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">{SITE.name}</span>
        <SignOutButton />
      </header>

      <section className="mt-10 rounded-2xl border border-border-base bg-surface p-6 shadow-[var(--shadow)]">
        <h1 className="text-xl font-semibold tracking-tight">
          Your taste profile is built
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Onboarding grouped your {ratedCount} ratings into {positive.length}{" "}
          positive centroid{positive.length === 1 ? "" : "s"}
          {negative.length > 0
            ? ` and ${negative.length} negative`
            : ""}
          . Phase 3 turns this into the ranked feed.
        </p>

        <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-border-base pt-6">
          <div>
            <dt className="text-sm text-muted">Positive</dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums">
              {positive.length}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Negative</dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums">
              {negative.length}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Articles</dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums">
              {articleCount}
            </dd>
          </div>
        </dl>

        {positive.length > 0 ? (
          <div className="mt-6 border-t border-border-base pt-6">
            <p className="text-sm text-muted">
              Centroid weights — how much of your profile each taste accounts
              for:
            </p>
            <ul className="mt-3 space-y-2">
              {positive.map((centroid) => (
                <li
                  key={`${centroid.polarity}-${centroid.idx}`}
                  className="flex items-center gap-3 text-sm"
                >
                  <span className="w-16 shrink-0 text-subtle">
                    #{centroid.idx + 1}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent-soft">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${Math.round(centroid.weight * 100)}%` }}
                    />
                  </span>
                  <span className="w-24 shrink-0 text-right tabular-nums text-subtle">
                    {centroid.articleCount} article
                    {centroid.articleCount === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {interests.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold tracking-tight text-muted">
            Interests you picked
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {interests.map(({ interest }) => (
              <span
                key={interest.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-base bg-surface px-3 py-1.5 text-sm"
              >
                {interest.emoji ? (
                  <span aria-hidden="true">{interest.emoji}</span>
                ) : null}
                {interest.label}
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
