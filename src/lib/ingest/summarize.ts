/**
 * Deriving a usable summary for each article.
 *
 * The problem this solves: RSS `<description>` is whatever the publisher felt
 * like putting there. Often that is a pull-quote with no context ("A reader
 * writes: 'I will likely be in a position to decline my benefits.'"), a
 * one-line teaser, or newsletter boilerplate. Showing it under the headline
 * tells the reader nothing about whether to click.
 *
 * The approach is **extractive**: pick the sentences from the article that are
 * most central to what it is about, using the embedding model the pipeline
 * already runs. Nothing is generated, so nothing can be hallucinated — every
 * word shown was written by the publisher. That matters more than usual here,
 * because a wrong AI-written summary attached to a real news headline is a
 * misinformation problem, not a quality problem.
 *
 * The alternative — an LLM writing genuinely new prose — needs a paid API per
 * article, which the project explicitly does not use. See the note at the
 * bottom of this file for what switching would involve.
 */

import { cosineSimilarity } from "@/lib/vector";

/** Target length. Long enough to be informative, short enough for a card. */
export const MAX_SUMMARY_CHARS = 280;

/**
 * Budget for the hover preview. Roughly triple the card, which is enough for
 * the surrounding detail — who, where, what happens next — without becoming a
 * wall of text that is slower to scan than the article itself.
 */
export const MAX_LONG_SUMMARY_CHARS = 800;

/** Sentences shorter than this are fragments — captions, bylines, stubs. */
const MIN_SENTENCE_CHARS = 40;

/** Sentences longer than this are usually run-on extraction failures. */
const MAX_SENTENCE_CHARS = 400;

/**
 * How much to favour sentences that appear early.
 *
 * News writing is front-loaded by convention — the first two sentences carry
 * the who/what/where. Pure semantic centrality tends to pick a sentence from
 * the middle that summarises the *topic* well but reads as though it started
 * mid-thought. This nudges toward the top without overriding relevance.
 */
const LEAD_BIAS = 0.12;

/**
 * Sentences that are structurally not summaries, however central they look.
 *
 * Pull-quotes are the main target: they are often the single most
 * topic-relevant sentence in the document, so centrality alone actively
 * selects for them. That is exactly the failure this module exists to fix.
 */
const LOW_VALUE_PATTERNS = [
  /^["“”'']/, // opens with a quotation mark — a pull-quote
  /^(a|one)\s+(reader|listener|viewer|user)\s+(writes|asks|says)/i,
  /\b(sign up|subscribe|newsletter|follow us|download the app)\b/i,
  /\b(photograph|photo|image|illustration|credit|getty|reuters|ap photo)\s*:/i,
  /^(by|written by|reporting by)\s+[A-Z]/,
  /^(updated|published|posted)\s/i,
  /\b(click here|read more|continue reading|full story)\b/i,
  /^\W*$/, // punctuation only
];

/**
 * Split into sentences.
 *
 * Deliberately simple rather than a full NLP tokenizer: this runs over every
 * ingested article and the failure mode of a wrong split is a slightly odd
 * summary, not a broken pipeline. The lookbehind guards the common
 * abbreviations that would otherwise split mid-sentence.
 */
export function splitSentences(text: string): string[] {
  const guarded = text
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|i\.e|e\.g|U\.S|U\.K)\./g, "$1<DOT>")
    .replace(/\b([A-Z])\./g, "$1<DOT>"); // initials

  return guarded
    .split(/(?<=[.!?])\s+(?=[A-Z"“'])/)
    .map((sentence) => sentence.replace(/<DOT>/g, ".").trim())
    .filter(Boolean);
}

function isLowValue(sentence: string): boolean {
  return LOW_VALUE_PATTERNS.some((pattern) => pattern.test(sentence));
}

/**
 * Cut to a length without splitting a word.
 *
 * A hard slice produces "was once criti…", which reads as a rendering bug
 * rather than as deliberate truncation, and undermines trust in the rest of
 * the text on the card.
 */
function truncateAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  // Only back off to the word boundary when it is reasonably close; a string
  // with no spaces near the limit would otherwise lose most of its content.
  const trimmed = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return trimmed.replace(/[,;:.\-–—\s]+$/, "") + "…";
}

/**
 * Assemble the text to summarise, from everything we stored.
 *
 * Both fields go in, description first. An earlier version summarised only the
 * body and it was measurably worse: publisher descriptions are unreliable but
 * they are not uniformly bad, and when a publisher writes a proper lede it is
 * usually the single best sentence available. Summarising the body alone threw
 * that away and reliably surfaced a supporting detail or a caveat from
 * paragraph four instead — technically central to the article, and not what a
 * reader wants under the headline.
 *
 * So both are candidates and the ranking decides. Description first so the
 * lead bias favours it, and the low-value filter discards it when it turns out
 * to be a pull-quote or a teaser.
 */
export function sourceText(article: {
  description?: string | null;
  contentSnippet?: string | null;
}): string | null {
  const description = article.description?.trim() ?? "";
  const body = article.contentSnippet?.trim() ?? "";

  // Feeds commonly repeat the description as the opening of content:encoded.
  // Concatenating both would then double the lede and let it win twice.
  const bodyIsSuperset =
    description.length > 0 && body.startsWith(description.slice(0, 80));

  const combined = bodyIsSuperset
    ? body
    : [description, body].filter(Boolean).join(" ");

  return combined.length >= 120 ? combined : null;
}

export interface SummaryCandidate {
  /** Text to summarise, already selected by `sourceText`. */
  text: string;
  /** The article's own embedding — the centrality reference. */
  articleEmbedding: number[];
}

/**
 * Build the summary.
 *
 * Sentences are scored on similarity to the article's own vector, which is
 * what "most representative" means here, then filtered for the structural
 * junk above, then emitted **in original order** so the result reads as prose
 * rather than as a ranked list.
 *
 * `embedBatch` is injected so this stays testable without loading the model.
 */
export async function summarize(
  candidate: SummaryCandidate,
  embedBatch: (texts: string[]) => Promise<number[][]>,
  maxChars: number = MAX_SUMMARY_CHARS,
): Promise<string | null> {
  const sentences = splitSentences(candidate.text).filter(
    (sentence) =>
      sentence.length >= MIN_SENTENCE_CHARS &&
      sentence.length <= MAX_SENTENCE_CHARS &&
      !isLowValue(sentence),
  );

  if (sentences.length === 0) return null;

  // A single usable sentence needs no ranking, and embedding it would be
  // wasted work on the most common case in short feed items.
  if (sentences.length === 1) {
    return truncateAtWord(sentences[0], maxChars);
  }

  const vectors = await embedBatch(sentences);

  const scored = sentences.map((sentence, index) => ({
    sentence,
    index,
    score:
      cosineSimilarity(vectors[index], candidate.articleEmbedding) +
      LEAD_BIAS * (1 - index / sentences.length),
  }));

  const chosen: { sentence: string; index: number }[] = [];
  let budget = maxChars;

  for (const entry of [...scored].sort((a, b) => b.score - a.score)) {
    // +1 for the joining space. Stop rather than skip-and-continue: a summary
    // that jumps over a sentence to fit a later short one reads as disjointed.
    if (entry.sentence.length + 1 > budget) {
      if (chosen.length > 0) break;
      // Nothing fits yet — take a truncated first sentence rather than
      // returning nothing at all.
      return truncateAtWord(entry.sentence, maxChars);
    }
    chosen.push(entry);
    budget -= entry.sentence.length + 1;
    // Scale the sentence cap with the budget: a card wants two or three,
    // a preview can carry more without becoming unscannable.
    if (chosen.length >= (maxChars > MAX_SUMMARY_CHARS ? 6 : 3)) break;
  }

  if (chosen.length === 0) return null;

  return chosen
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.sentence)
    .join(" ");
}

/**
 * ---------------------------------------------------------------------------
 * On generating summaries instead of extracting them
 *
 * An LLM writing original prose would read better than sentence selection.
 * Two things stand in the way, and both are worth understanding before
 * anyone swaps this out:
 *
 * 1. **Cost.** Roughly 100 new articles per 30-minute run, ~5k daily. Even at
 *    cheap per-token rates that is a recurring bill, and the project's whole
 *    architecture — local embeddings, CI cron, free tiers — exists to keep
 *    marginal cost near zero. That property is load-bearing for the business
 *    model, not incidental.
 *
 * 2. **Hallucination.** A generated summary attached to a real headline from a
 *    real publisher, under our brand, is a different risk class from a
 *    badly-chosen sentence. If a model invents a death toll or reverses who
 *    said what, we have published misinformation and attributed it to the
 *    outlet. Extraction cannot do that.
 *
 * If it is worth doing anyway, the cheapest credible route is a small
 * instruction-tuned model (~1B) running in the ingest job the way the
 * embedding model already does — free, no key, no data leaving CI — accepting
 * slower runs and weaker prose. Keep the extractive path as the fallback for
 * whatever the model refuses or mangles.
 * ---------------------------------------------------------------------------
 */
