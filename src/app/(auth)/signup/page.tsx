import Link from "next/link";
import { redirect } from "next/navigation";

import { currentUserId } from "@/lib/auth";
import { SignUpForm } from "./form";

export const metadata = { title: "Create your account" };

export default async function SignUpPage() {
  if (await currentUserId()) redirect("/feed");

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">
        Create your account
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        Next you&rsquo;ll pick a few interests, then rate a handful of stories.
      </p>
      <div className="mt-6">
        <SignUpForm />
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/signin" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
