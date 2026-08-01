import Link from "next/link";
import { redirect } from "next/navigation";

import { currentUserId } from "@/lib/auth";
import { SignInForm } from "./form";

export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await currentUserId()) redirect("/feed");

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">
        Welcome back
      </h1>
      <p className="mt-1.5 text-sm text-muted">Sign in to pick up your feed.</p>
      <div className="mt-6">
        <SignInForm />
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        Don&rsquo;t have an account?{" "}
        <Link href="/signup" className="font-medium text-accent hover:underline">
          Create one
        </Link>
      </p>
    </>
  );
}
