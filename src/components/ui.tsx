import type { ComponentProps, ReactNode } from "react";

/** Small shared primitives. Deliberately plain — no component library yet. */

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "secondary" }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 " +
    "text-sm font-medium transition-colors disabled:opacity-50 " +
    "disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-accent text-white hover:bg-accent-hover",
    secondary:
      "border border-border-strong bg-surface text-foreground hover:bg-surface-raised",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props} />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-sm text-negative">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-sm text-subtle">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return (
    <input
      className={
        "w-full rounded-lg border border-border-base bg-surface px-3 py-2.5 " +
        "text-sm text-foreground placeholder:text-subtle " +
        "focus:border-accent focus:outline-none " +
        className
      }
      {...props}
    />
  );
}

/** Inline error banner for form-level failures. */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-negative/30 bg-negative/5 px-3 py-2.5 text-sm text-negative"
    >
      {children}
    </p>
  );
}
