"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Primary navigation for signed-in pages.
 *
 * Deliberately two links and nothing else. Onboarding screens do not render
 * this — a way out mid-calibration invites people to abandon a flow that only
 * pays off when finished.
 */
const TABS = [
  { href: "/feed", label: "Feed" },
  { href: "/saved", label: "Saved" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1" aria-label="Primary">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
              (active
                ? "bg-accent-soft text-accent"
                : "text-muted hover:bg-surface-raised hover:text-foreground")
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
