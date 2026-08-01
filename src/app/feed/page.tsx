import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";
import { buildFeedPage, recordImpressions } from "@/lib/feed/rank";
import { SITE } from "@/lib/site";
import { SignOutButton } from "./sign-out";
import { FeedStream } from "./stream";

export const metadata = { title: "Your feed" };

// Session state makes this inherently per-request; nothing here is cacheable.
export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const user = await currentUser();

  // Also catches a valid token pointing at a deleted user, which happens
  // routinely after a database reset in development.
  if (!user) redirect("/signin");

  // The real gate. proxy.ts does an optimistic check for signed-in-ness, but
  // per the Next 16 docs the authoritative check belongs here, next to the
  // data it protects.
  if (user.onboardingState === "INTERESTS") redirect("/onboarding/interests");
  if (user.onboardingState === "CALIBRATION") redirect("/onboarding/calibration");

  // The first page is rendered server-side so the feed is populated on arrival
  // rather than flashing an empty state and then filling in.
  const { items } = await buildFeedPage(user.id);
  await recordImpressions(user.id, items, 0);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">{SITE.name}</span>
        <SignOutButton />
      </header>

      <FeedStream
        initialItems={items.map((item) => ({
          ...item,
          publishedAt: item.publishedAt.toISOString(),
        }))}
      />
    </main>
  );
}
