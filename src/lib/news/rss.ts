/**
 * The RSS/Atom implementation of `NewsSource`.
 *
 * Fetching is done with `fetch` rather than rss-parser's own `parseURL` so we
 * control the timeout, the user agent, and the redirect behaviour — a handful
 * of publishers reject requests with no UA, and a hung socket on one feed
 * should not stall the whole run.
 */

import Parser from "rss-parser";
import { FEEDS, type FeedSource } from "@/data/feeds";
import {
  canonicalizeUrl,
  cleanTitle,
  firstImageInHtml,
  parseDate,
  stripBoilerplate,
  stripHtml,
} from "./normalize";
import type { FetchError, FetchResult, NewsSource, RawArticle } from "./types";

const USER_AGENT =
  "newsfeed/0.1 (+https://github.com/aaryanghcodes/project2) rss-reader";

const FEED_TIMEOUT_MS = 15_000;

/** Feeds fetched at once. Enough to keep a run brisk, low enough to stay polite. */
const CONCURRENCY = 6;

/**
 * How far back an item can be published and still be ingested. The cron runs
 * every 30 minutes, so anything older than this window has either been seen
 * already or is a feed replaying its archive.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Media elements rss-parser does not surface by default. */
type FeedItem = Parser.Item & {
  "media:content"?: { $?: { url?: string; medium?: string } };
  "media:thumbnail"?: { $?: { url?: string } };
  "content:encoded"?: string;
  enclosure?: { url?: string; type?: string };
  summary?: string;
  // Atom feeds put the byline here; rss-parser only types RSS's `creator`.
  author?: string;
};

const parser: Parser<Record<string, unknown>, FeedItem> = new Parser({
  customFields: {
    item: ["media:content", "media:thumbnail", "content:encoded", "summary"],
  },
});

function extractImage(item: FeedItem): string | null {
  const mediaContent = item["media:content"]?.$;
  if (mediaContent?.url && mediaContent.medium !== "audio") {
    return mediaContent.url;
  }
  const thumbnail = item["media:thumbnail"]?.$?.url;
  if (thumbnail) return thumbnail;

  if (item.enclosure?.url && item.enclosure.type?.startsWith("image/")) {
    return item.enclosure.url;
  }
  return firstImageInHtml(item["content:encoded"] ?? item.content ?? null);
}

/**
 * Convert one feed item, or null if it is unusable. Items are dropped rather
 * than patched up: a missing URL, title, or date means we cannot rank or
 * deduplicate it correctly, and a feed of thousands makes any single loss
 * irrelevant.
 */
function toRawArticle(item: FeedItem, feed: FeedSource): RawArticle | null {
  const rawUrl = item.link ?? item.guid;
  if (!rawUrl) return null;

  const url = canonicalizeUrl(rawUrl);
  if (!url) return null;

  const title = item.title ? cleanTitle(item.title, feed.name) : null;
  if (!title || title.length < 8) return null;

  const publishedAt = parseDate(item.isoDate, item.pubDate);
  if (!publishedAt) return null;
  if (Date.now() - publishedAt.getTime() > MAX_AGE_MS) return null;

  // contentSnippet is rss-parser's own text extraction; the others are
  // fallbacks for feeds that only populate one of them.
  const description = stripBoilerplate(
    stripHtml(item.contentSnippet ?? item.summary ?? item.content ?? null),
  );
  const body = stripBoilerplate(
    stripHtml(item["content:encoded"] ?? item.content ?? null),
  );

  return {
    url,
    title,
    description: description?.slice(0, 400) ?? null,
    // Kept longer than we embed; the ranking layer and UI may want more later.
    contentSnippet: body?.slice(0, 2000) ?? null,
    imageUrl: extractImage(item),
    author: item.creator ?? item.author ?? null,
    publishedAt,
    sourceName: feed.name,
    qualityScore: feed.quality,
  };
}

async function fetchFeed(feed: FeedSource): Promise<RawArticle[]> {
  const response = await fetch(feed.url, {
    headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/xml, text/xml, */*" },
    redirect: "follow",
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const parsed = await parser.parseString(xml);

  const articles: RawArticle[] = [];
  for (const item of parsed.items ?? []) {
    const article = toRawArticle(item, feed);
    if (article) articles.push(article);
  }
  return articles;
}

/** Run tasks with a bounded number in flight. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

export class RssNewsSource implements NewsSource {
  readonly id = "rss";

  constructor(private readonly feeds: FeedSource[] = FEEDS) {}

  async fetchLatest(): Promise<FetchResult> {
    const errors: FetchError[] = [];

    const perFeed = await mapWithConcurrency(
      this.feeds,
      CONCURRENCY,
      async (feed) => {
        try {
          return await fetchFeed(feed);
        } catch (error) {
          errors.push({
            feedId: feed.id,
            feedUrl: feed.url,
            message: error instanceof Error ? error.message : String(error),
          });
          return [] as RawArticle[];
        }
      },
    );

    // Within a single run the same story can arrive from two feeds (Guardian
    // World and Guardian Culture overlap, for instance). Collapse here so the
    // database write does not have to handle in-batch duplicates.
    const seen = new Set<string>();
    const articles: RawArticle[] = [];
    for (const article of perFeed.flat()) {
      if (seen.has(article.url)) continue;
      seen.add(article.url);
      articles.push(article);
    }

    return { articles, errors };
  }
}
