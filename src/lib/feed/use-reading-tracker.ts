"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Measures how long a reader spent on an article we linked out to.
 *
 * Articles open on the publisher's site, where no script of ours runs, so this
 * can never observe reading directly. What it measures is the gap between
 * clicking a link and returning to this tab. That is a proxy, and the guards
 * below exist because it is a leaky one:
 *
 * - The away period must begin within a moment of the click, or a reader who
 *   clicked, came back, and later switched to email would have the email trip
 *   recorded as reading.
 * - Very short trips are discarded as mis-taps; very long ones are capped,
 *   since a tab left open overnight is not a two-hour read.
 * - The result is sent with `sendBeacon` where available, because the return
 *   to this tab is often immediately followed by closing it, and a normal
 *   fetch gets cancelled.
 *
 * See src/lib/profile/reading-signals.ts for how the number is interpreted —
 * as a threshold, never as a quantity to maximise.
 */

/** Away periods starting later than this after a click are not that click. */
const CLICK_TO_HIDE_GRACE_MS = 2_500;

const MIN_REPORTABLE_MS = 2_000;
const MAX_REPORTABLE_MS = 15 * 60_000;

interface PendingRead {
  articleId: string;
  clickedAt: number;
  hiddenAt: number | null;
}

export function useReadingTracker() {
  const pending = useRef<PendingRead | null>(null);

  const report = useCallback((articleId: string, dwellMs: number) => {
    const clamped = Math.min(Math.round(dwellMs), MAX_REPORTABLE_MS);
    if (clamped < MIN_REPORTABLE_MS) return;

    const body = JSON.stringify({
      articleId,
      type: "DWELL",
      dwellMs: clamped,
      context: "FEED",
    });

    // Beacon survives the page being closed; fetch does not.
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/interactions",
        new Blob([body], { type: "application/json" }),
      );
      return;
    }
    void fetch("/api/interactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    });
  }, []);

  useEffect(() => {
    function onVisibility() {
      const current = pending.current;
      if (!current) return;

      if (document.visibilityState === "hidden") {
        // Only treat this as "gone to read" if it followed the click closely.
        if (Date.now() - current.clickedAt <= CLICK_TO_HIDE_GRACE_MS) {
          current.hiddenAt = Date.now();
        } else {
          pending.current = null;
        }
        return;
      }

      if (current.hiddenAt !== null) {
        report(current.articleId, Date.now() - current.hiddenAt);
        pending.current = null;
      }
    }

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [report]);

  /**
   * Call when the reader opens an article. Records the click itself, which is
   * stored but is not positive evidence on its own — see reading-signals.ts.
   */
  const trackOpen = useCallback((articleId: string) => {
    pending.current = { articleId, clickedAt: Date.now(), hiddenAt: null };

    void fetch("/api/interactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ articleId, type: "CLICK", context: "FEED" }),
    }).catch(() => {});
  }, []);

  return { trackOpen };
}
