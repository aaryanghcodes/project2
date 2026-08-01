import Link from "next/link";
import { SITE } from "@/lib/site";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 block text-center text-lg font-semibold tracking-tight text-foreground"
        >
          {SITE.name}
        </Link>
        <div className="rounded-2xl border border-border-base bg-surface p-6 shadow-[var(--shadow)]">
          {children}
        </div>
      </div>
    </main>
  );
}
