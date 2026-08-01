/**
 * A `NewsSource` backed by checked-in synthetic articles.
 *
 * Two jobs, both load-bearing:
 *
 * 1. **The demo is never empty.** PLAN.md §2 calls this out explicitly — a
 *    fresh clone or a fresh deploy must show a populated, believable feed
 *    whether or not the RSS cron has ever run.
 * 2. **The pipeline is testable without network.** Every stage after fetching
 *    (dedupe, embed, tag, cluster) can be exercised deterministically against
 *    a fixed corpus, which is the only way to tell a clustering regression
 *    from the news simply having been different that morning.
 *
 * The fixtures are invented, and attributed to invented publications. See the
 * `_comment` block in articles.json for why that matters.
 */

import fixtures from "@/data/fixtures/articles.json";
import { canonicalizeUrl } from "./normalize";
import type { FetchResult, NewsSource, RawArticle } from "./types";

interface FixtureArticle {
  storyKey?: string;
  sourceName: string;
  title: string;
  description: string;
  contentSnippet: string;
  publishedHoursAgo: number;
  quality: number;
}

/**
 * Fixtures carry relative ages rather than timestamps so the demo feed reads
 * as current no matter when the repository is cloned. Resolved against a
 * caller-supplied "now" so tests can pin it.
 */
function resolvePublishedAt(hoursAgo: number, now: Date): Date {
  return new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
}

/**
 * Fixture URLs must be stable across runs — they are what the dedupe stage
 * hashes, so a URL that changed per run would re-insert the whole corpus on
 * every ingest. Derived from the title, and pointed at example.com, which is
 * reserved for exactly this purpose and cannot be mistaken for a real article.
 */
function fixtureUrl(article: FixtureArticle): string {
  const slug = article.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  const publisher = article.sourceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `https://example.com/${publisher}/${slug}`;
}

export function fixtureArticles(now: Date = new Date()): RawArticle[] {
  const raw = fixtures.articles as FixtureArticle[];

  return raw.map((article) => {
    const url = canonicalizeUrl(fixtureUrl(article));
    if (!url) {
      throw new Error(`Fixture produced an invalid URL: ${article.title}`);
    }
    return {
      url,
      title: article.title,
      description: article.description,
      contentSnippet: article.contentSnippet,
      imageUrl: null,
      author: null,
      publishedAt: resolvePublishedAt(article.publishedHoursAgo, now),
      sourceName: article.sourceName,
      qualityScore: article.quality,
    };
  });
}

export class FixtureNewsSource implements NewsSource {
  readonly id = "fixtures";

  constructor(private readonly now: Date = new Date()) {}

  async fetchLatest(): Promise<FetchResult> {
    return { articles: fixtureArticles(this.now), errors: [] };
  }
}

/**
 * Groups of fixture articles that describe the same event, keyed by storyKey.
 * The clustering stage should collapse each group to one cluster id; this is
 * what the check in `scripts/verify-ingest.ts` asserts against.
 */
export function expectedClusters(): Map<string, string[]> {
  const raw = fixtures.articles as FixtureArticle[];
  const groups = new Map<string, string[]>();
  for (const article of raw) {
    if (!article.storyKey) continue;
    const url = canonicalizeUrl(fixtureUrl(article))!;
    const existing = groups.get(article.storyKey);
    if (existing) existing.push(url);
    else groups.set(article.storyKey, [url]);
  }
  return groups;
}
