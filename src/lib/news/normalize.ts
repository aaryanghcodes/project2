/**
 * Turning messy feed entries into rows we are willing to store.
 *
 * RSS is a loose standard and publishers treat it loosely: the same article
 * arrives with tracking parameters attached, with the summary wrapped in
 * markup, with the image in any of four different elements, and occasionally
 * with no date at all. Everything that cleans that up lives here, separate
 * from the fetching code, because it is the part worth testing.
 */

import { createHash } from "node:crypto";

/**
 * Query parameters that identify a referral rather than the article. Two URLs
 * differing only in these point at the same page, so they are stripped before
 * hashing — otherwise the same story syndicated through two feeds is stored
 * twice and the user sees it twice.
 */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^ic[ei]d$/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_[ce]id$/i,
  /^ref$/i,
  /^source$/i,
  /^cmpid$/i,
  /^smid$/i,
  /^partner$/i,
  /^__twitter_impression$/i,
  /^guccounter$/i,
];

/**
 * Canonicalize a URL for identity purposes: drop tracking noise, normalize
 * the host, and discard the fragment. Returns null for anything that is not a
 * usable http(s) URL, which is the signal to skip the entry entirely.
 */
export function canonicalizeUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) {
      url.searchParams.delete(key);
    }
  }
  // Sorting makes ?a=1&b=2 and ?b=2&a=1 hash identically.
  url.searchParams.sort();

  // A trailing slash is not a different page.
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

/**
 * Stable identity for an article. Hashed rather than stored raw because it
 * backs a unique index, and URLs can exceed sensible index key lengths.
 */
export function urlHash(canonicalUrl: string): string {
  return createHash("sha256").update(canonicalUrl).digest("hex");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const code = entity.startsWith("#x") || entity.startsWith("#X")
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Strip markup and collapse whitespace. Feed summaries routinely contain full
 * HTML — links, images, share widgets — and none of it should reach either the
 * embedding model or the UI.
 */
export function stripHtml(input: string | null | undefined): string | null {
  if (!input) return null;
  const text = decodeEntities(
    input
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text : null;
}

/**
 * Publisher boilerplate that appears verbatim on every item in a feed. Left in
 * place it would pull every article from that publisher toward the same region
 * of embedding space, which is precisely the signal we do not want.
 */
const BOILERPLATE = [
  /\bcontinue reading[\s\S]*$/i,
  /\bread more( at| on)?\b[\s\S]*$/i,
  /\bthe post .{0,120}appeared first on\b[\s\S]*$/i,
  /\bsign up (for|to) (our )?newsletter\b[\s\S]*$/i,
  /\bsubscribe to\b[\s\S]*$/i,
  /\bthis article (was )?originally (appeared|published)\b[\s\S]*$/i,
  /\bcomments?\s*$/i,
];

export function stripBoilerplate(text: string | null): string | null {
  if (!text) return null;
  let cleaned = text;
  for (const pattern of BOILERPLATE) cleaned = cleaned.replace(pattern, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Parse whatever the feed offered as a date. Returns null rather than falling
 * back to "now", because a wrong timestamp is worse than a missing one here —
 * recency is a ranking input, and defaulting to now would float every
 * undated item to the top of the feed forever.
 */
export function parseDate(...candidates: (string | undefined | null)[]): Date | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      // Feeds occasionally carry dates far in the future, usually a timezone
      // or template bug. Treat anything more than a day out as unusable.
      if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) continue;
      return parsed;
    }
  }
  return null;
}

/** Pull the first <img src> out of an HTML blob, as a last-resort image source. */
export function firstImageInHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (!match) return null;
  const src = match[1].trim();
  return src.startsWith("http") ? src : null;
}

/**
 * Titles arrive padded with the publication name ("Headline - Ars Technica"),
 * which is redundant next to the source label in the UI and dilutes the
 * embedding.
 */
export function cleanTitle(raw: string, sourceName: string): string {
  const title = stripHtml(raw) ?? raw;
  const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return title
    .replace(new RegExp(`\\s*[-–—|]\\s*${escaped}\\s*$`, "i"), "")
    .trim();
}
