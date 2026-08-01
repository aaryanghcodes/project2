/**
 * The boundary between "where articles come from" and everything downstream.
 *
 * Phase 1 ships exactly one implementation (RSS), but the pipeline is written
 * against this interface so adding a second source later — a publisher API, a
 * scraper, a partner feed — is a new file rather than a rewrite of the
 * ingestion code. See PLAN.md §4.
 */

/**
 * An article as a source hands it to us: cleaned and normalized, but not yet
 * deduped, embedded, or persisted. Deliberately close to what RSS actually
 * provides, so a source never has to invent fields it does not have.
 */
export interface RawArticle {
  /** Canonical URL, tracking parameters already stripped. */
  url: string;
  title: string;
  description: string | null;
  contentSnippet: string | null;
  imageUrl: string | null;
  author: string | null;
  publishedAt: Date;
  /** Display name of the publication, e.g. "Ars Technica". */
  sourceName: string;
  /**
   * Editorial prior from the feed list, carried through to
   * `Article.qualityScore`. Not a judgment of the individual article — the
   * ranking layer treats it as one weak signal among several.
   */
  qualityScore: number;
}

export interface FetchResult {
  articles: RawArticle[];
  /**
   * Per-feed failures. Ingestion must not abort because one publisher is
   * down or rate-limiting, so errors are collected and reported rather than
   * thrown — a run that loses one feed out of thirty is a successful run.
   */
  errors: FetchError[];
}

export interface FetchError {
  feedId: string;
  feedUrl: string;
  message: string;
}

export interface NewsSource {
  /** Stable identifier, used in logs. */
  readonly id: string;
  fetchLatest(): Promise<FetchResult>;
}
