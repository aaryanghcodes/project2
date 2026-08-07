import { redirect } from "next/navigation";

import { Wordmark } from "@/components/ui";
import { Nav } from "@/components/nav";
import { currentUser } from "@/lib/auth";
import { listSaved, savedFacets } from "@/lib/saved/saved";
import { SignOutButton } from "../feed/sign-out";
import { SavedList } from "./list";

export const metadata = { title: "Saved" };
export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  // Onboarding is not required to *read* a saved list, but a user who has not
  // finished it has nothing saved and no feed to save from.
  if (user.onboardingState === "INTERESTS") redirect("/onboarding/interests");
  if (user.onboardingState === "CALIBRATION") redirect("/onboarding/calibration");

  const [initial, facets] = await Promise.all([
    listSaved(user.id),
    savedFacets(user.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10 lg:max-w-6xl">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-5">
          <Wordmark />
          <Nav />
        </div>
        <SignOutButton />
      </header>

      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Saved</h1>
      <p className="mt-1.5 text-sm text-muted">
        Bookmarks are private to your account and never affect what the feed
        shows you.
      </p>

      <SavedList
        initialItems={initial.items.map((item) => ({
          ...item,
          publishedAt: item.publishedAt.toISOString(),
          savedAt: item.savedAt.toISOString(),
        }))}
        initialTotal={initial.total}
        initialCursor={initial.nextCursor}
        sources={facets.sources}
        topics={facets.topics}
      />
    </main>
  );
}
