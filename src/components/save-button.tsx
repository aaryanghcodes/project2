"use client";

import { useState } from "react";

/**
 * The bookmark toggle, used everywhere an article appears.
 *
 * Optimistic: the icon flips immediately and reverts if the write fails.
 * Saving is a low-stakes, high-frequency action, and a spinner on every tap
 * makes a reading list feel like paperwork.
 */
export function SaveButton({
  articleId,
  initialSaved,
  onChange,
  className = "",
}: {
  articleId: string;
  initialSaved: boolean;
  /** Lets a parent list drop an item the moment it is unsaved. */
  onChange?: (saved: boolean) => void;
  className?: string;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (pending) return;
    const next = !saved;

    setSaved(next);
    setPending(true);
    onChange?.(next);

    try {
      const response = next
        ? await fetch("/api/saved", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ articleId }),
          })
        : await fetch(`/api/saved?articleId=${encodeURIComponent(articleId)}`, {
            method: "DELETE",
          });

      if (!response.ok) throw new Error("save failed");
    } catch {
      setSaved(!next);
      onChange?.(!next);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved" : "Save for later"}
      title={saved ? "Saved — tap to remove" : "Save for later"}
      className={
        "rounded-lg px-2.5 py-1.5 transition-colors " +
        (saved
          ? "bg-accent-soft text-accent"
          : "text-subtle hover:bg-surface-raised hover:text-foreground") +
        " " +
        className
      }
    >
      {/* Filled when saved, outline when not — the state has to be readable at
          a glance in a grid of twelve cards, and colour alone is not enough. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-[18px] w-[18px]"
        fill={saved ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={saved ? 0 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z" />
      </svg>
    </button>
  );
}
