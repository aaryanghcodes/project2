"use client";

import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";

import { Button, Field, FormError, Input } from "@/components/ui";

export function SignInForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);

    try {
      const result = await signIn("credentials", {
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        redirect: false,
      });

      if (result?.error) {
        // Deliberately vague: saying which half was wrong tells an attacker
        // whether the address is registered.
        setError("That email and password combination is not correct.");
        return;
      }

      // The post-sign-in landing page depends on how far through onboarding
      // they got, so /feed decides where they actually belong.
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

      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>

      <Field label="Password">
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
