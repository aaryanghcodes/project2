"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { FormError } from "@/components/ui";
import { SaveButton } from "@/components/save-button";
import { useReadingTracker } from "@/lib/feed/use-reading-tracker";

interface FeedItem {
  id: string;
  title: string;
  description: string | null;
  url: string;
  sourceName: string;
  imageUrl: string | null;
  publishedAt: string;
  reason: string | null;
  exploration: boolean;
  saved: boolean;
}

type Reaction = "LIKE" | "DISLIKE";

function relativeTime(iso: string): string {
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export function FeedStream({ initialItems }: { initialItems: FeedItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState<number | null>(
    initialItems.length > 0 ? initialItems.length : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reactions, setReactions] = useState<Record<string, Reaction>>({});
  const { trackOpen } = useReadingTracker();
  const sentinel = useRef<HTMLDivElement>(null);

  // Stable across the session so impressions can be grouped by visit later.
  const sessionId = useRef(
    typeof crypto !== "undefined" ? crypto.randomUUID() : "session",
  );

  const loadMore = useCallback(async () => {
    if (loading || cursor === null) return;
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/feed?cursor=${cursor}&session=${sessionId.current}`,
      );
      if (!response.ok) throw new Error("Request failed");

      const body = await response.json();
      setItems((current) => {
        // The server filters by impressions, but a page in flight during a
        // reaction can still overlap. Dedupe here so React never sees
        // duplicate keys.
        const seen = new Set(current.map((item) => item.id));
        return [
          ...current,
          ...(body.items as FeedItem[]).filter((item) => !seen.has(item.id)),
        ];
      });
      setCursor(body.nextCursor);
    } catch {
      setError("Could not load more articles.");
    } finally {
      setLoading(false);
    }
  }, [cursor, loading]);

  // Load the next page slightly before the sentinel is actually visible, so
  // scrolling does not stall waiting on the request.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || cursor === null) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, cursor]);

  async function react(articleId: string, type: Reaction) {
    // Toggle off if the same reaction is tapped twice.
    const next = reactions[articleId] === type ? null : type;
    setReactions((current) => {
      const copy = { ...current };
      if (next) copy[articleId] = next;
      else delete copy[articleId];
      return copy;
    });

    if (!next) return;

    const response = await fetch("/api/interactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ articleId, type: next, context: "FEED" }),
    });

    if (!response.ok) {
      setReactions((current) => {
        const copy = { ...current };
        delete copy[articleId];
        return copy;
      });
      setError("That reaction did not save.");
    }
  }

  if (items.length === 0) {
    return (
      <section className="mt-8 rounded-2xl border border-border-base bg-surface p-6">
        <h2 className="font-semibold">Nothing left to show</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          You have seen everything ingested in the last week that matches your
          profile. Ingestion runs every 30 minutes — check back shortly.
        </p>
      </section>
    );
  }

  return (
    <div className="mt-8">
      {error ? (
        <div className="mb-4">
          <FormError>{error}</FormError>
        </div>
      ) : null}

      {/* One column on phones, two from md, three on large screens.
          `items-start` so each card hugs its own content: cards in a row vary a
          lot in height depending on whether the article had an image, and
          stretching them to match left a large blank gap inside the shorter
          ones. Ragged bottoms read better than hollow cards. */}
      <ul className="grid grid-cols-1 items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const reaction = reactions[item.id];
          return (
            <li
              key={item.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-border-base bg-surface shadow-[var(--shadow)]"
            >
              {item.imageUrl ? (
                // A fixed aspect box with object-contain rather than
                // object-cover: feed images arrive at wildly different
                // dimensions, and cropping them to a uniform height cut the
                // subject out of portrait and square images. Letterboxing on a
                // neutral panel shows the whole picture instead.
                //
                // The grid also helps the other half of the problem — many RSS
                // thumbnails are only a few hundred pixels wide, and stretching
                // one across a full-width column was what made them look soft.
                // A narrower card asks less of the source image.
                // `absolute inset-0` on the image, not just `h-full`: as a flex
                // child, a box whose height comes from aspect-ratio while its
                // content asks for `h-full` is circular, and the browser
                // resolves it in favour of the image's natural height. A
                // portrait image then rendered ~850px tall and stretched the
                // whole grid row. Taking the image out of flow lets the
                // aspect-ratio actually decide.
                <div className="relative aspect-[16/9] w-full shrink-0 bg-surface-raised">
                  {/* Plain <img>: RSS images come from arbitrary hosts, and
                      next/image would need each one allow-listed up front. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.imageUrl}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                </div>
              ) : null}

              <div className="flex flex-1 flex-col p-5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-muted">{item.sourceName}</span>
                  <span className="text-subtle" aria-hidden="true">·</span>
                  <span className="text-subtle">
                    {relativeTime(item.publishedAt)}
                  </span>
                  {item.exploration ? (
                    <span className="rounded-full border border-border-base px-2 py-0.5 text-subtle">
                      Something different
                    </span>
                  ) : item.reason ? (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">
                      {item.reason}
                    </span>
                  ) : null}
                </div>

                <h2 className="mt-2 text-lg font-semibold leading-snug tracking-tight">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackOpen(item.id)}
                    className="hover:text-accent"
                  >
                    {item.title}
                  </a>
                </h2>

                {item.description ? (
                  <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">
                    {item.description}
                  </p>
                ) : null}

                {/* mt-auto pins the reactions to the bottom of the card, so
                    they line up across a row whose titles wrapped to different
                    heights. */}
                <div className="mt-auto flex items-center gap-1 pt-4">
                  <ReactionButton
                    active={reaction === "LIKE"}
                    onClick={() => react(item.id, "LIKE")}
                    label="More like this"
                  >
                    👍
                  </ReactionButton>
                  <ReactionButton
                    active={reaction === "DISLIKE"}
                    onClick={() => react(item.id, "DISLIKE")}
                    label="Less like this"
                  >
                    👎
                  </ReactionButton>
                  {/* Sits with the reactions but is not one: it posts to
                      /api/saved, never to /api/interactions, so it cannot
                      reach the profile. */}
                  <SaveButton
                    articleId={item.id}
                    initialSaved={item.saved}
                    className="ml-auto"
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div ref={sentinel} className="py-10 text-center text-sm text-subtle">
        {cursor === null
          ? "That is everything for now."
          : loading
            ? "Loading…"
            : " "}
      </div>
    </div>
  );
}

function ReactionButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={
        "rounded-lg px-2.5 py-1.5 text-base transition-colors " +
        (active
          ? "bg-accent-soft"
          : "opacity-55 hover:bg-surface-raised hover:opacity-100")
      }
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
