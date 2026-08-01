import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
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

  const [interestCount, articleCount] = await Promise.all([
    db.interest.count(),
    db.article.count(),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">{SITE.name}</span>
        <SignOutButton />
      </header>

      <section className="mt-10 rounded-2xl border border-border-base bg-surface p-6 shadow-[var(--shadow)]">
        <h1 className="text-xl font-semibold tracking-tight">
          You&rsquo;re signed in as {user.name || user.email}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          Onboarding state:{" "}
          <code className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-xs text-accent">
            {user.onboardingState}
          </code>
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-border-base pt-6">
          <div>
            <dt className="text-sm text-muted">Interests in catalog</dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums">
              {interestCount}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Articles ingested</dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums">
              {articleCount}
            </dd>
          </div>
        </dl>
      </section>

      <p className="mt-6 text-sm leading-relaxed text-subtle">
        Phase 0 is complete: accounts, sessions, the pgvector schema, and the
        embedded interest catalog are all working. The interest picker and
        calibration feed arrive in Phase 2, and this page becomes the ranked
        feed in Phase 3.
      </p>
    </main>
  );
}
