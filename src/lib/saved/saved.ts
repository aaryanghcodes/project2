/**
 * Bookmarks.
 *
 * Reads and writes `saved_articles` only. Nothing in this module touches
 * `interactions` or `user_taste_centroids`, which is what keeps saving from
 * influencing the recommendation profile — the isolation is structural rather
 * than a filter someone has to remember.
 */

import { db } from "@/lib/db";

export interface SavedItem {
  id: string;
  articleId: string | null;
  title: string;
  url: string;
  sourceName: string;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: Date;
  savedAt: Date;
  topics: string[];
  /** True when the underlying article has been pruned and only the snapshot remains. */
  archived: boolean;
}

export interface SavedFilters {
  /** Free text over title, summary, and source. */
  query?: string;
  source?: string;
  topic?: string;
  /** Inclusive bounds on when the article was *saved*, not published. */
  from?: Date;
  to?: Date;
}

export const SAVED_PAGE_SIZE = 24;

/**
 * Save an article, copying its display fields into the bookmark.
 *
 * Idempotent: saving twice keeps the original `savedAt` rather than bumping
 * it to the top of the list, since a double-tap is far more likely to be a
 * mis-tap than an intent to re-file.
 */
export async function saveArticle(
  userId: string,
  articleId: string,
): Promise<{ saved: true; alreadySaved: boolean }> {
  const existing = await db.savedArticle.findUnique({
    where: { userId_articleId: { userId, articleId } },
    select: { id: true },
  });
  if (existing) return { saved: true, alreadySaved: true };

  const article = await db.article.findUnique({
    where: { id: articleId },
    select: {
      title: true,
      url: true,
      sourceName: true,
      summary: true,
      description: true,
      imageUrl: true,
      publishedAt: true,
      topics: {
        select: { interest: { select: { label: true } } },
        orderBy: { confidence: "desc" },
      },
    },
  });
  if (!article) throw new Error("No such article.");

  await db.savedArticle.create({
    data: {
      userId,
      articleId,
      title: article.title,
      url: article.url,
      sourceName: article.sourceName,
      // Same precedence the feed uses, so a card does not change wording the
      // moment it is saved.
      summary: article.summary ?? article.description,
      imageUrl: article.imageUrl,
      publishedAt: article.publishedAt,
      topics: article.topics.map((t) => t.interest.label),
    },
  });

  return { saved: true, alreadySaved: false };
}

/** Remove a bookmark. Idempotent — unsaving something not saved is not an error. */
export async function unsaveArticle(
  userId: string,
  articleId: string,
): Promise<{ saved: false; removed: number }> {
  const result = await db.savedArticle.deleteMany({
    where: { userId, articleId },
  });
  return { saved: false, removed: result.count };
}

/**
 * Which of these articles the user has saved.
 *
 * Batched rather than per-card so rendering a feed page costs one query
 * instead of twelve.
 */
export async function savedArticleIds(
  userId: string,
  articleIds: string[],
): Promise<Set<string>> {
  if (articleIds.length === 0) return new Set();
  const rows = await db.savedArticle.findMany({
    where: { userId, articleId: { in: articleIds } },
    select: { articleId: true },
  });
  return new Set(rows.flatMap((row) => (row.articleId ? [row.articleId] : [])));
}

/**
 * List bookmarks, newest save first.
 *
 * Ordered by `savedAt` rather than `publishedAt` deliberately: a reading list
 * is organised by when you put something on it, not when it was written.
 */
export async function listSaved(
  userId: string,
  filters: SavedFilters = {},
  options: { cursor?: number; pageSize?: number } = {},
): Promise<{ items: SavedItem[]; total: number; nextCursor: number | null }> {
  const { cursor = 0, pageSize = SAVED_PAGE_SIZE } = options;

  const where = {
    userId,
    ...(filters.source ? { sourceName: filters.source } : {}),
    ...(filters.topic ? { topics: { has: filters.topic } } : {}),
    ...(filters.from || filters.to
      ? {
          savedAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
    ...(filters.query
      ? {
          OR: [
            { title: { contains: filters.query, mode: "insensitive" as const } },
            { summary: { contains: filters.query, mode: "insensitive" as const } },
            { sourceName: { contains: filters.query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.savedArticle.findMany({
      where,
      orderBy: { savedAt: "desc" },
      skip: cursor,
      take: pageSize,
    }),
    db.savedArticle.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      articleId: row.articleId,
      title: row.title,
      url: row.url,
      sourceName: row.sourceName,
      summary: row.summary,
      imageUrl: row.imageUrl,
      publishedAt: row.publishedAt,
      savedAt: row.savedAt,
      topics: row.topics,
      archived: row.articleId === null,
    })),
    total,
    nextCursor: cursor + rows.length < total ? cursor + pageSize : null,
  };
}

/**
 * The distinct sources and topics present in this user's bookmarks.
 *
 * Drawn from what they have actually saved rather than the full catalog, so
 * the filter menus never offer an option that returns nothing.
 */
export async function savedFacets(
  userId: string,
): Promise<{ sources: string[]; topics: string[] }> {
  const rows = await db.savedArticle.findMany({
    where: { userId },
    select: { sourceName: true, topics: true },
  });

  const sources = new Set<string>();
  const topics = new Set<string>();
  for (const row of rows) {
    sources.add(row.sourceName);
    for (const topic of row.topics) topics.add(topic);
  }

  return {
    sources: [...sources].sort(),
    topics: [...topics].sort(),
  };
}
