"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { FormError, Input } from "@/components/ui";
import { SaveButton } from "@/components/save-button";

interface SavedItem {
  id: string;
  articleId: string | null;
  title: string;
  url: string;
  sourceName: string;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: string;
  savedAt: string;
  topics: string[];
  archived: boolean;
}

function savedOn(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function SavedList({
  initialItems,
  initialTotal,
  initialCursor,
  sources,
  topics,
}: {
  initialItems: SavedItem[];
  initialTotal: number;
  initialCursor: number | null;
  sources: string[];
  topics: string[];
}) {
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [topic, setTopic] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtering = Boolean(query || source || topic || from || to);

  const buildUrl = useCallback(
    (nextCursor: number) => {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (source) params.set("source", source);
      if (topic) params.set("topic", topic);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (nextCursor) params.set("cursor", String(nextCursor));
      return `/api/saved?${params.toString()}`;
    },
    [query, source, topic, from, to],
  );

  const fetchPage = useCallback(
    async (nextCursor: number, append: boolean) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(buildUrl(nextCursor));
        if (!response.ok) throw new Error("failed");
        const body = await response.json();
        setItems((current) => (append ? [...current, ...body.items] : body.items));
        setTotal(body.total);
        setCursor(body.nextCursor);
      } catch {
        setError("Could not load your saved articles.");
      } finally {
        setLoading(false);
      }
    },
    [buildUrl],
  );

  // Debounced so typing in the search box does not fire a request per
  // keystroke. Skips the very first run so the server-rendered page is not
  // immediately refetched on mount.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = setTimeout(() => void fetchPage(0, false), 250);
    return () => clearTimeout(timer);
  }, [fetchPage]);

  function clearFilters() {
    setQuery("");
    setSource("");
    setTopic("");
    setFrom("");
    setTo("");
  }

  /** Drop the card as soon as it is unsaved — it no longer belongs in this list. */
  function handleUnsave(id: string, saved: boolean) {
    if (saved) return;
    setItems((current) => current.filter((item) => item.articleId !== id));
    setTotal((current) => Math.max(0, current - 1));
  }

  const selectClass =
    "rounded-lg border border-border-base bg-surface px-3 py-2 text-sm " +
    "text-foreground focus:border-accent focus:outline-none";

  return (
    <div className="mt-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-border-base bg-surface p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1">
          <label className="mb-1.5 block text-xs font-medium text-muted">
            Search
          </label>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Title, summary, or source"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">
            Source
          </label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className={selectClass}
          >
            <option value="">All sources</option>
            {sources.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">
            Topic
          </label>
          <select
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className={selectClass}
          >
            <option value="">All topics</option>
            {topics.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">
            Saved from
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={selectClass}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">
            Saved to
          </label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={selectClass}
          />
        </div>

        {filtering ? (
          <button
            type="button"
            onClick={clearFilters}
            className="self-start rounded-lg px-3 py-2 text-sm text-accent hover:underline sm:self-end"
          >
            Clear
          </button>
        ) : null}
      </div>

      <p className="mt-4 text-sm text-muted" aria-live="polite">
        {loading
          ? "Loading…"
          : `${total} saved article${total === 1 ? "" : "s"}${filtering ? " matching" : ""}`}
      </p>

      {error ? (
        <div className="mt-4">
          <FormError>{error}</FormError>
        </div>
      ) : null}

      {items.length === 0 && !loading ? (
        <section className="mt-5 rounded-2xl border border-border-base bg-surface p-6">
          <h2 className="font-semibold">
            {filtering ? "Nothing matches those filters" : "No saved articles yet"}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {filtering
              ? "Try widening the date range or clearing a filter."
              : "Tap the bookmark icon on any article in your feed to keep it here for later."}
          </p>
        </section>
      ) : (
        <ul className="mt-5 grid grid-cols-1 items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-border-base bg-surface shadow-[var(--shadow)]"
            >
              {item.imageUrl ? (
                <div className="relative aspect-[16/9] w-full shrink-0 bg-surface-raised">
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
                  <span className="text-subtle">Saved {savedOn(item.savedAt)}</span>
                  {item.archived ? (
                    // The article has aged out of the main table; this card is
                    // rendering from the snapshot taken when it was saved.
                    <span
                      className="rounded-full border border-border-base px-2 py-0.5 text-subtle"
                      title="The original article is no longer in our index. This is the copy saved at the time."
                    >
                      Archived copy
                    </span>
                  ) : null}
                </div>

                <h2 className="mt-2 text-lg font-semibold leading-snug tracking-tight">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-accent"
                  >
                    {item.title}
                  </a>
                </h2>

                {item.summary ? (
                  <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">
                    {item.summary}
                  </p>
                ) : null}

                {item.topics.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {item.topics.slice(0, 3).map((label) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setTopic(label)}
                        className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent hover:underline"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="mt-auto flex items-center pt-4">
                  {item.articleId ? (
                    <SaveButton
                      articleId={item.articleId}
                      initialSaved
                      onChange={(saved) => handleUnsave(item.articleId!, saved)}
                    />
                  ) : (
                    // Without an article id there is nothing to unsave against;
                    // the snapshot is all that is left.
                    <span className="px-2.5 py-1.5 text-xs text-subtle">
                      Archived
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cursor !== null ? (
        <div className="py-8 text-center">
          <button
            type="button"
            onClick={() => void fetchPage(cursor, true)}
            disabled={loading}
            className="rounded-lg border border-border-strong bg-surface px-4 py-2.5 text-sm font-medium hover:bg-surface-raised disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
