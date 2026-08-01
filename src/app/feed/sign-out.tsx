"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/" })}
      className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-foreground"
    >
      Sign out
    </button>
  );
}
