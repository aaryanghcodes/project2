/**
 * Turning reading behaviour into profile evidence.
 *
 * The spec this implements is explicit about what *not* to do: no CTR as the
 * primary signal, no optimising for time-on-app, no popularity. That rules out
 * the obvious implementation, so the design here is deliberately different in
 * two ways.
 *
 * **Dwell is a threshold, not a quantity.** We ask "did this person read it?"
 * and stop. We never score longer as better. Treating dwell as a magnitude is
 * precisely the mechanism that makes a system chase whatever holds attention
 * longest, which is not the same as what is worth reading — and a ranking
 * layer that mildly prefers longer reads becomes one that prefers outrage
 * within a few thousand users.
 *
 * **A click on its own is not positive.** A click is a response to a headline;
 * only what happens afterwards says anything about the article. Clicking and
 * returning in four seconds is mild evidence the headline oversold it, which
 * is why a short read counts slightly negative rather than neutral. That is
 * the anti-clickbait term.
 *
 * All of this is weighted well below explicit likes. Someone pressing a button
 * is telling us something; someone leaving a tab open is not necessarily.
 */

import { db } from "@/lib/db";
import { parseSqlVector } from "@/lib/vector";

/**
 * Below this, a click looks like a bounce: the reader opened it, saw it was
 * not what they expected, and came back. Above it, they engaged with the page.
 */
export const READ_THRESHOLD_MS = 20_000;

/**
 * Anything past this is almost certainly a tab left open, not sustained
 * reading, so it is clamped rather than trusted.
 */
export const MAX_CREDIBLE_DWELL_MS = 15 * 60_000;

/** Under this, we assume a mis-tap and record nothing at all. */
export const MIN_CREDIBLE_DWELL_MS = 2_000;

/**
 * How much each implicit signal counts relative to an explicit like at 1.0.
 *
 * Small on purpose. These weights are a starting point, not a measurement —
 * there is no traffic yet to calibrate them against, and PLAN.md §5 defers
 * exactly this until there is. They are collected in one object so a future
 * calibration is a single edit.
 */
export const SIGNAL_WEIGHTS = {
  /** Read past the threshold. The main positive implicit signal. */
  read: 0.35,
  /** Came back to the same article on a later visit — a strong-ish signal. */
  revisit: 0.5,
  /** Opened and bounced. Negative, and the anti-clickbait term. */
  bounce: -0.25,
  /** Shown, scrolled past, never opened. Very weak: most of a feed goes unread. */
  ignored: -0.05,
} as const;

export type SignalKind = keyof typeof SIGNAL_WEIGHTS;

/**
 * Classify one reading event.
 *
 * Returns null when the event is not credible enough to record, which is the
 * common case for accidental taps.
 */
export function classifyDwell(
  dwellMs: number,
  isRevisit: boolean,
): { kind: SignalKind; weight: number } | null {
  if (!Number.isFinite(dwellMs) || dwellMs < MIN_CREDIBLE_DWELL_MS) return null;

  const clamped = Math.min(dwellMs, MAX_CREDIBLE_DWELL_MS);

  if (clamped < READ_THRESHOLD_MS) {
    return { kind: "bounce", weight: SIGNAL_WEIGHTS.bounce };
  }
  // Note the absence of any scaling by `clamped` — a two-minute read and a
  // ten-minute read produce the same weight, on purpose.
  const kind: SignalKind = isRevisit ? "revisit" : "read";
  return { kind, weight: SIGNAL_WEIGHTS[kind] };
}

export interface WeightedVector {
  vector: number[];
  weight: number;
}

/**
 * Implicit evidence for one polarity, as vectors with per-article weights.
 *
 * Explicit likes and dislikes stay in `interactionVectors`; this is the
 * separate, quieter channel. Keeping them apart means the explicit signal can
 * never be diluted by a flood of weak implicit ones.
 */
export async function readingSignalVectors(
  userId: string,
  polarity: "POS" | "NEG",
): Promise<WeightedVector[]> {
  const rows = await db.$queryRaw<
    { vector: string; dwell_ms: number | null; visits: bigint }[]
  >`
    SELECT a.embedding::text AS vector,
           max(i.dwell_ms)   AS dwell_ms,
           count(*)          AS visits
    FROM interactions i
    JOIN articles a ON a.id = i.article_id
    WHERE i.user_id = ${userId}
      AND i.type = 'DWELL'
      AND a.embedding IS NOT NULL
      AND i.dwell_ms IS NOT NULL
    GROUP BY a.id, a.embedding
  `;

  const out: WeightedVector[] = [];
  for (const row of rows) {
    const signal = classifyDwell(row.dwell_ms ?? 0, Number(row.visits) > 1);
    if (!signal) continue;

    const wantsPositive = signal.weight > 0;
    if (wantsPositive !== (polarity === "POS")) continue;

    out.push({
      vector: parseSqlVector(row.vector),
      weight: Math.abs(signal.weight),
    });
  }

  return out;
}

/**
 * Articles shown to the user and never opened.
 *
 * The weakest signal in the system, and the easiest to over-read: most items
 * in any feed go unopened for reasons that have nothing to do with interest.
 * Only counted once an article has been ignored several times, and even then
 * at a fraction of a dislike.
 */
export async function ignoredVectors(
  userId: string,
  minImpressions = 3,
): Promise<WeightedVector[]> {
  const rows = await db.$queryRaw<{ vector: string }[]>`
    SELECT a.embedding::text AS vector
    FROM impressions p
    JOIN articles a ON a.id = p.article_id
    WHERE p.user_id = ${userId}
      AND a.embedding IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM interactions i
        WHERE i.user_id = p.user_id AND i.article_id = p.article_id
      )
    GROUP BY a.id, a.embedding
    HAVING count(*) >= ${minImpressions}
  `;

  return rows.map((row) => ({
    vector: parseSqlVector(row.vector),
    weight: Math.abs(SIGNAL_WEIGHTS.ignored),
  }));
}
