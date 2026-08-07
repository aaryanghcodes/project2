import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth";
import {
  listSaved,
  saveArticle,
  unsaveArticle,
  SAVED_PAGE_SIZE,
} from "@/lib/saved/saved";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ articleId: z.string().min(1) });

/** Save an article. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const result = await saveArticle(user.id, parsed.data.articleId);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "No such article." }, { status: 404 });
  }
}

/** Unsave an article. */
export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const articleId = new URL(request.url).searchParams.get("articleId");
  if (!articleId) {
    return NextResponse.json({ error: "articleId is required." }, { status: 400 });
  }

  return NextResponse.json(await unsaveArticle(user.id, articleId));
}

/** List bookmarks with optional search and filters. */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const parseDate = (value: string | null) => {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  };

  const cursor = Number.parseInt(params.get("cursor") ?? "0", 10);

  const result = await listSaved(
    user.id,
    {
      query: params.get("q") ?? undefined,
      source: params.get("source") ?? undefined,
      topic: params.get("topic") ?? undefined,
      from: parseDate(params.get("from")),
      // An end date from a date picker means "through the end of that day",
      // not midnight at its start, which would exclude everything saved on it.
      to: (() => {
        const to = parseDate(params.get("to"));
        if (to) to.setHours(23, 59, 59, 999);
        return to;
      })(),
    },
    { cursor: Number.isFinite(cursor) && cursor > 0 ? cursor : 0, pageSize: SAVED_PAGE_SIZE },
  );

  return NextResponse.json(result);
}
