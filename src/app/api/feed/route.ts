import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth";
import { buildFeedPage, PAGE_SIZE, recordImpressions } from "@/lib/feed/rank";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (user.onboardingState !== "COMPLETE") {
    return NextResponse.json(
      { error: "Finish onboarding first.", items: [] },
      { status: 409 },
    );
  }

  const url = new URL(request.url);
  const cursor = Number.parseInt(url.searchParams.get("cursor") ?? "0", 10);
  const offset = Number.isFinite(cursor) && cursor > 0 ? cursor : 0;
  const sessionId = url.searchParams.get("session") ?? undefined;

  const { items, exhausted } = await buildFeedPage(user.id, { offset });

  // Written after the page is assembled, so an article is only marked seen
  // once it has actually been sent. Impressions are the durable "don't repeat
  // this" record, so writing them optimistically would silently burn articles
  // the user never saw.
  await recordImpressions(user.id, items, offset, sessionId);

  return NextResponse.json({
    items,
    nextCursor: exhausted ? null : offset + PAGE_SIZE,
    exhausted,
  });
}
