"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, FormError } from "@/components/ui";

const MIN_INTERESTS = 3;

interface Interest {
  id: string;
  slug: string;
  label: string;
  emoji: string | null;
}

export function InterestPicker({
  groups,
  initialSelected,
}: {
  groups: { group: string; items: Interest[] }[];
  initialSelected: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelected),
  );
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setError("");
  }

  async function submit() {
    setError("");
    const response = await fetch("/api/onboarding/interests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ interestIds: [...selected] }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Could not save your interests.");
      return;
    }

    // refresh() so the server component re-reads onboardingState; without it
    // the calibration page can render against a stale state and bounce back.
    startTransition(() => {
      router.push("/onboarding/calibration");
      router.refresh();
    });
  }

  const remaining = MIN_INTERESTS - selected.size;

  return (
    <>
      <div className="mt-8 space-y-8">
        {groups.map((section) => (
          <section key={section.group}>
            <h2 className="text-sm font-semibold tracking-tight text-muted">
              {section.group}
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {section.items.map((interest) => {
                const isOn = selected.has(interest.id);
                return (
                  <button
                    key={interest.id}
                    type="button"
                    onClick={() => toggle(interest.id)}
                    aria-pressed={isOn}
                    className={
                      "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 " +
                      "text-sm transition-colors " +
                      (isOn
                        ? "border-accent bg-accent-soft font-medium text-accent"
                        : "border-border-base bg-surface text-foreground hover:border-border-strong")
                    }
                  >
                    {interest.emoji ? (
                      <span aria-hidden="true">{interest.emoji}</span>
                    ) : null}
                    {interest.label}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Sticky so the count and the action stay reachable while scrolling a
          long catalog — the alternative is scrolling back up to find out how
          many more are needed. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-border-base bg-surface/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <p className="text-sm text-muted" aria-live="polite">
            {selected.size} selected
            {remaining > 0
              ? ` — ${remaining} more to continue`
              : ""}
          </p>
          <Button
            onClick={submit}
            disabled={selected.size < MIN_INTERESTS || isPending}
          >
            {isPending ? "Saving…" : "Continue"}
          </Button>
        </div>
        {error ? (
          <div className="mx-auto w-full max-w-3xl px-6 pb-4">
            <FormError>{error}</FormError>
          </div>
        ) : null}
      </div>
    </>
  );
}
