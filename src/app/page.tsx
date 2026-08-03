import Link from "next/link";

import { Wordmark } from "@/components/ui";
import { currentUserId } from "@/lib/auth";
import { SITE } from "@/lib/site";

const STEPS = [
  {
    title: "Pick what you care about",
    body: "Check a few interests from a list. It takes about twenty seconds and gets us in the right neighbourhood.",
  },
  {
    title: "Rate a sample feed",
    body: "Thumbs up or down on a short run of stories. This is where the feed learns the specifics a checkbox can't capture.",
  },
  {
    title: "Read, and keep teaching it",
    body: "Every like and dislike sharpens the ranking. The feed you get in a month is not the one you started with.",
  },
];

export default async function Home() {
  const signedIn = Boolean(await currentUserId());

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Wordmark />
        <nav className="flex items-center gap-2 text-sm">
          {signedIn ? (
            <Link
              href="/feed"
              className="rounded-lg bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover"
            >
              Go to your feed
            </Link>
          ) : (
            <>
              <Link
                href="/signin"
                className="rounded-lg px-3 py-2 font-medium text-muted hover:text-foreground"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-lg bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover"
              >
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="mx-auto w-full max-w-2xl px-6 pb-16 pt-16 sm:pt-24">
        <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
          A news feed that learns what you{" "}
          <span className="text-accent">actually</span> read.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
          Telling us you like &ldquo;technology&rdquo; is a start. What you
          thumbs-up over the next ten minutes is what really matters — and
          that&rsquo;s what builds your feed.
        </p>

        {!signedIn && (
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="rounded-lg bg-accent px-5 py-3 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Build my feed
            </Link>
            <Link
              href="/signin"
              className="rounded-lg border border-border-strong px-5 py-3 text-sm font-medium hover:bg-surface"
            >
              I already have an account
            </Link>
          </div>
        )}

        <ol className="mt-16 space-y-8">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-4">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-medium text-accent">
                {index + 1}
              </span>
              <div>
                <h2 className="font-medium text-foreground">{step.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-auto border-t border-border-base px-6 py-6 text-sm text-subtle">
        {SITE.name} — headlines and links only, always credited to the original
        publisher.
      </footer>
    </main>
  );
}
