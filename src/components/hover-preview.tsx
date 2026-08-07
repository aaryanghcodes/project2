"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { SaveButton } from "@/components/save-button";

/**
 * The expanded article preview.
 *
 * Three things drive the design here.
 *
 * **Hover is not a signal.** Opening this panel records nothing — the endpoint
 * it calls is read-only and the reading tracker is not started. A cursor
 * crossing a card while someone scrolls says nothing about interest, and
 * letting mouse movement steer a taste profile would be both wrong and
 * impossible for the user to reason about.
 *
 * **It must not fire on a passing cursor.** An open delay means sweeping the
 * pointer across a grid does not detonate twelve fetches. A close delay means
 * the diagonal path from card to panel does not dismiss it mid-move.
 *
 * **Pointer-hover only.** Touch devices report a tap as a hover, which would
 * make every tap open a panel the user then has to dismiss. Gated on an actual
 * fine pointer.
 */

const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 180;

interface SimilarArticle {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  summary: string | null;
  imageUrl: string | null;
}

interface PreviewData {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  author: string | null;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: string;
  readingMinutes: number | null;
  topics: string[];
  saved: boolean;
  similar: SimilarArticle[];
}

/** Cached per session: the same card is hovered repeatedly while scanning. */
const cache = new Map<string, PreviewData>();

/**
 * True only on devices with a real hovering pointer.
 *
 * `useSyncExternalStore` rather than an effect that calls setState: the media
 * query is external state, and reading it during render on the client avoids
 * both the lint rule against setting state in an effect and the flash where
 * the first paint assumes no pointer.
 */
function useFinePointer(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(hover: hover) and (pointer: fine)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    // Server snapshot: assume no hover, so nothing renders until hydration.
    () => false,
  );
}

export function HoverPreview({
  articleId,
  children,
}: {
  articleId: string;
  children: React.ReactNode;
}) {
  const finePointer = useFinePointer();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PreviewData | null>(null);
  const [failed, setFailed] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  useEffect(() => clearTimers, []);

  const load = useCallback(async () => {
    const cached = cache.get(articleId);
    if (cached) {
      setData(cached);
      return;
    }
    try {
      const response = await fetch(`/api/articles/${articleId}/preview`);
      if (!response.ok) throw new Error("failed");
      const body: PreviewData = await response.json();
      cache.set(articleId, body);
      setData(body);
    } catch {
      setFailed(true);
    }
  }, [articleId]);

  function onEnter() {
    if (!finePointer || failed) return;
    clearTimers();
    openTimer.current = setTimeout(() => {
      setOpen(true);
      void load();
    }, OPEN_DELAY_MS);
  }

  function onLeave() {
    clearTimers();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }

  return (
    <div
      className="relative"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocusCapture={onEnter}
      onBlurCapture={onLeave}
    >
      {children}

      {open && finePointer ? (
        <div
          // Sits above the card it expanded from. `pointer-events-auto` so the
          // panel itself is hoverable — the cursor has to be able to travel
          // into it to reach the actions and the suggestions.
          className="absolute inset-x-0 top-0 z-30 w-full min-w-[22rem] animate-[fadeIn_120ms_ease-out] rounded-2xl border border-border-strong bg-surface p-5 shadow-2xl"
          style={{ transform: "translateY(-0.5rem)" }}
          role="dialog"
          aria-label={`Preview: ${data?.title ?? "loading"}`}
        >
          {data ? (
            <>
              {data.imageUrl ? (
                <div className="relative mb-4 aspect-[16/9] w-full overflow-hidden rounded-lg bg-surface-raised">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={data.imageUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
                <span className="font-medium text-muted">{data.sourceName}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {new Date(data.publishedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                {data.readingMinutes ? (
                  <>
                    <span aria-hidden="true">·</span>
                    {/* "~" is load-bearing: we measure the stored snippet, not
                        the full article, so this under-counts long pieces. */}
                    <span title="Estimated from the text we have stored">
                      ~{data.readingMinutes} min read
                    </span>
                  </>
                ) : null}
              </div>

              <a
                href={data.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block text-lg font-semibold leading-snug tracking-tight hover:text-accent"
              >
                {data.title}
              </a>

              {data.topics.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {data.topics.map((topic) => (
                    <span
                      key={topic}
                      className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent"
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              ) : null}

              {data.summary ? (
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  {data.summary}
                </p>
              ) : null}

              <div className="mt-4 flex items-center gap-2 border-t border-border-base pt-3">
                <a
                  href={data.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
                >
                  Read article
                </a>
                <SaveButton articleId={data.id} initialSaved={data.saved} />
                <ShareButton url={data.url} title={data.title} />
              </div>

              {data.similar.length > 0 ? (
                <div className="mt-4 border-t border-border-base pt-3">
                  <p className="text-xs font-semibold tracking-tight text-muted">
                    Similar articles you may like
                  </p>
                  <ul className="mt-2 space-y-2.5">
                    {data.similar.map((item) => (
                      <li key={item.id}>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex gap-3"
                        >
                          <span className="relative h-12 w-16 shrink-0 overflow-hidden rounded bg-surface-raised">
                            {item.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={item.imageUrl}
                                alt=""
                                loading="lazy"
                                className="absolute inset-0 h-full w-full object-cover"
                              />
                            ) : null}
                          </span>
                          <span className="min-w-0">
                            <span className="line-clamp-2 block text-sm font-medium leading-snug group-hover:text-accent">
                              {item.title}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-subtle">
                              {item.sourceName}
                              {item.summary ? ` — ${item.summary}` : ""}
                            </span>
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <p className="py-6 text-center text-sm text-subtle">Loading preview…</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Share via the native sheet where available, clipboard otherwise.
 *
 * No third-party share targets: adding Twitter and Facebook buttons would mean
 * loading their scripts, which track the reader across the site — a poor fit
 * for a product whose pitch is that it does not optimise against you.
 */
function ShareButton({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Cancelled, or unavailable — fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* nothing sensible to do */
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      aria-label="Share article"
      title="Share"
      className="rounded-lg px-2.5 py-1.5 text-subtle transition-colors hover:bg-surface-raised hover:text-foreground"
    >
      {copied ? (
        <span className="text-xs font-medium text-accent">Copied</span>
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-[18px] w-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
        </svg>
      )}
    </button>
  );
}
