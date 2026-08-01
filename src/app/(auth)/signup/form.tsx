"use client";

import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";

import { Button, Field, FormError, Input } from "@/components/ui";

export function SignUpForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "");

    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? "Could not create the account.");
        return;
      }

      // Registration succeeded, so sign them straight in rather than bouncing
      // them to a login form they just filled out.
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Account created, but sign-in failed. Try signing in.");
        return;
      }

      // /feed routes onward based on how far through onboarding they are.
      router.push("/feed");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormError>{error}</FormError>

      <Field label="Name" hint="Optional.">
        <Input name="name" type="text" autoComplete="name" maxLength={80} />
      </Field>

      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>

      <Field label="Password" hint="At least 10 characters.">
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={72}
        />
      </Field>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
