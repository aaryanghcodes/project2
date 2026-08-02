/**
 * Product name and taglines live here so renaming stays a one-file change.
 * Everything user-facing reads from this object rather than hardcoding the
 * name in copy — keep it that way.
 */
export const SITE = {
  name: "Winnow",
  tagline: "A news feed that learns what you actually read.",
  description:
    "Pick your interests, rate a few stories, and get a feed that sharpens every time you use it.",
} as const;
