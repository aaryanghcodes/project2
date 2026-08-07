import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { similarArticles } from "@/lib/feed/similar";
import { savedArticleIds } from "@/lib/saved/saved";

export const dynamic = "force-dynamic";

/** Average adult reading speed for news prose. */
const WORDS_PER_MINUTE = 220;

/**
 * Everything the hover preview needs, in one request.
 *
 * Deliberately read-only. Hovering records nothing — no impression, no click,
 * no dwell — because a cursor passing over a card is not evidence of interest
 * and treating it as such would let mouse movement steer someone's profile.
 * The reading tracker only starts on an actual click.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;

  const article = await db.article.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      url: true,
      sourceName: true,
      author: true,
      summary: true,
      longSummary: true,
      description: true,
      imageUrl: true,
      publishedAt: true,
      wordCount: true,
      topics: {
        select: { confidence: true, interest: { select: { label: true } } },
        orderBy: { confidence: "desc" },
        take: 4,
      },
    },
  });

  if (!article) {
    return NextResponse.json({ error: "No such article." }, { status: 404 });
  }

  const [similar, saved] = await Promise.all([
    similarArticles(user.id, id, 3),
    savedArticleIds(user.id, [id]),
  ]);

  return NextResponse.json({
    id: article.id,
    title: article.title,
    url: article.url,
    sourceName: article.sourceName,
    author: article.author,
    // Falls back through the same chain the card uses, so the preview never
    // shows less than the card it expanded from.
    summary: article.longSummary ?? article.summary ?? article.description,
    imageUrl: article.imageUrl,
    publishedAt: article.publishedAt,
    // Null when we have no body text to measure. The client renders "~N min",
    // acknowledging that a capped snippet under-counts a long article.
    readingMinutes: article.wordCount
      ? Math.max(1, Math.round(article.wordCount / WORDS_PER_MINUTE))
      : null,
    topics: article.topics.map((t) => t.interest.label),
    saved: saved.has(id),
    similar,
  });
}
