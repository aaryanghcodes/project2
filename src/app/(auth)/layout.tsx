import { Wordmark } from "@/components/ui";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <Wordmark className="mb-8 block text-center" />
        <div className="rounded-2xl border border-border-base bg-surface p-6 shadow-[var(--shadow)]">
          {children}
        </div>
      </div>
    </main>
  );
}
