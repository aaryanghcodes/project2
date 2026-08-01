"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Button, FormError } from "@/components/ui";

interface Card {
  id: string;
  title: string;
  description: string | null;
  url: string;
  sourceName: string;
  imageUrl: string | null;
  publishedAt: string;
  offProfile: boolean;
}

function relativeTime(iso: string): string {
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export function Calibrator({
  cards,
  alreadyRated,
  minRatings,
}: {
  cards: Card[];
  alreadyRated: number;
  minRatings: number;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [rated, setRated] = useState(alreadyRated);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const card = cards[index];
  const done = index >= cards.length;
  const canFinish = rated >= minRatings;

  const progress = useMemo(
    () => Math.min(100, Math.round((rated / minRatings) * 100)),
    [rated, minRatings],
  );

  async function rate(type: "LIKE" | "DISLIKE" | null) {
    if (!card) return;
    setError("");

    // Advance immediately rather than awaiting the write. The rating is not
    // load-bearing until "Done", and a spinner between every card would make
    // eighteen of them feel like a chore.
    setIndex((i) => i + 1);
    if (type) setRated((count) => count + 1);

    if (!type) return; // skip records nothing

    const response = await fetch("/api/interactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        articleId: card.id,
        type,
        context: "ONBOARDING",
      }),
    });

    if (!response.ok) {
      // Roll the count back so the "Done" gate still reflects what was
      // actually stored; the server recounts anyway, and a client that thinks
      // it has eight ratings when the server has seven is a confusing dead end.
      setRated((count) => Math.max(0, count - 1));
      setError("That rating did not save. Check your connection.");
    }
  }

  async function finish() {
    setError("");
    const response = await fetch("/api/onboarding/complete", { method: "POST" });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Could not build your profile.");
      return;
    }

    startTransition(() => {
      router.push("/feed");
      router.refresh();
    });
  }

  if (cards.length === 0) {
    return (
      <section className="mt-8 rounded-2xl border border-border-base bg-surface p-6">
        <h2 className="font-semibold">Nothing to rate yet</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          No articles have been ingested for these interests yet. Ingestion runs
          every 30 minutes — check back shortly.
        </p>
      </section>
    );
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted" aria-live="polite">
          {rated} of {minRatings} rated
          {rated >= minRatings ? " — enough to finish" : ""}
        </span>
        <span className="tabular-nums text-subtle">
          {Math.min(index + 1, cards.length)}/{cards.length}
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent-soft"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Ratings collected"
      >
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      {error ? (
        <div className="mt-4">
          <FormError>{error}</FormError>
        </div>
      ) : null}

      {done ? (
        <section className="mt-6 rounded-2xl border border-border-base bg-surface p-6 text-center">
          <h2 className="font-semibold">
            {canFinish ? "That is enough to start" : "Out of cards"}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {canFinish
              ? "We will group what you liked into a taste profile. It keeps adjusting as you read."
              : `You rated ${rated}. We need ${minRatings} before the profile means anything — reload for more cards.`}
          </p>
          <div className="mt-5 flex justify-center gap-3">
            {canFinish ? (
              <Button onClick={finish} disabled={isPending}>
                {isPending ? "Building your feed…" : "Finish"}
              </Button>
            ) : (
              <Button onClick={() => router.refresh()}>Load more cards</Button>
            )}
          </div>
        </section>
      ) : (
        <article className="mt-6 overflow-hidden rounded-2xl border border-border-base bg-surface shadow-[var(--shadow)]">
          {card.imageUrl ? (
            // Plain <img>: these are arbitrary remote hosts from RSS, and
            // next/image would need every one allow-listed in advance.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.imageUrl}
              alt=""
              className="h-48 w-full object-cover"
            />
          ) : null}
          <div className="p-6">
            <p className="flex items-center gap-2 text-xs text-subtle">
              <span className="font-medium text-muted">{card.sourceName}</span>
              <span aria-hidden="true">·</span>
              <span>{relativeTime(card.publishedAt)}</span>
            </p>
            <h2 className="mt-2 text-lg font-semibold leading-snug tracking-tight">
              {card.title}
            </h2>
            {card.description ? (
              <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-muted">
                {card.description}
              </p>
            ) : null}
            <a
              href={card.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm text-accent hover:underline"
            >
              Read the original ↗
            </a>
          </div>
        </article>
      )}

      {!done ? (
        <div className="mt-5 flex items-center justify-center gap-3">
          <Button variant="secondary" onClick={() => rate("DISLIKE")}>
            Not for me
          </Button>
          <button
            type="button"
            onClick={() => rate(null)}
            className="px-3 py-2 text-sm text-subtle hover:text-muted"
          >
            Skip
          </button>
          <Button onClick={() => rate("LIKE")}>I&rsquo;d read this</Button>
        </div>
      ) : null}

      {!done && canFinish ? (
        <p className="mt-4 text-center text-sm text-subtle">
          <button
            type="button"
            onClick={finish}
            disabled={isPending}
            className="text-accent hover:underline disabled:opacity-50"
          >
            {isPending ? "Building your feed…" : "Finish now"}
          </button>{" "}
          — or keep going for a sharper profile.
        </p>
      ) : null}
    </div>
  );
}
