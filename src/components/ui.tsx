"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { STATUS_META, type Status } from "@/lib/status";

export function StatusChip({
  status,
  size = "md",
  short = false,
}: {
  status: Status;
  size?: "sm" | "md" | "lg";
  /** Drop the "Interview" prefix where a column heading already says it. */
  short?: boolean;
}) {
  const meta = STATUS_META[status];
  const pad =
    size === "lg" ? "px-4 py-2 text-base" : size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";

  return (
    <span
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full ${pad} ${
        meta.chip
      } ${status === "requested" ? "pulse-waiting" : ""}`}
    >
      {short ? meta.short : meta.label}
    </span>
  );
}

export function StatusLegend({ className = "" }: { className?: string }) {
  const shown: Status[] = ["scheduled", "requested", "acknowledged", "interviewing", "completed"];
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 ${className}`}>
      {shown.map((s) => (
        <span key={s} className="flex items-center gap-2 text-sm text-zinc-400">
          <span className={`h-3 w-3 rounded-full ${STATUS_META[s].dot}`} />
          {STATUS_META[s].label}
        </span>
      ))}
    </div>
  );
}

/** Live "4m ago" text that ticks without a re-render of the whole tree. */
export function Elapsed({ since, prefix = "" }: { since: string | null; prefix?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  if (!since) return null;
  return (
    <span suppressHydrationWarning>
      {prefix}
      {formatElapsed(since)}
    </span>
  );
}

export function formatElapsed(since: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatClock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  type = "button",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "success" | "warn";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const variants = {
    primary: "bg-indigo-500 text-white hover:bg-indigo-400",
    ghost: "bg-white/5 text-zinc-200 hover:bg-white/10 ring-1 ring-inset ring-white/10",
    danger: "bg-rose-600/90 text-white hover:bg-rose-500",
    success: "bg-emerald-500 text-emerald-950 hover:bg-emerald-400 font-semibold",
    warn: "bg-orange-500 text-orange-950 hover:bg-orange-400 font-semibold",
  };
  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2.5 text-sm",
    lg: "px-6 py-4 text-lg",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl font-medium transition ${variants[variant]} ${sizes[size]} disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-zinc-300">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl bg-white/5 px-4 py-3 text-zinc-100 ring-1 ring-inset ring-white/10 outline-none placeholder:text-zinc-600 focus:ring-2 focus:ring-indigo-400";

export function Banner({
  kind,
  children,
  onDismiss,
}: {
  kind: "error" | "success" | "info";
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  const styles = {
    error: "bg-rose-500/15 text-rose-200 ring-rose-500/40",
    success: "bg-emerald-500/15 text-emerald-200 ring-emerald-500/40",
    info: "bg-sky-500/15 text-sky-200 ring-sky-500/40",
  };
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-xl px-4 py-3 text-sm ring-1 ring-inset ${styles[kind]}`}
    >
      <div>{children}</div>
      {onDismiss ? (
        <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100">
          ✕
        </button>
      ) : null}
    </div>
  );
}

export function ConnectionDot({ online }: { online: boolean }) {
  return (
    <span
      title={online ? "Live" : "Reconnecting…"}
      className={`inline-flex items-center gap-1.5 text-xs ${
        online ? "text-emerald-400" : "text-amber-400"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${online ? "bg-emerald-400" : "bg-amber-400 pulse-waiting"}`}
      />
      {online ? "Live" : "Reconnecting"}
    </span>
  );
}

export function TopBar({
  title,
  subtitle,
  online,
  right,
}: {
  title: string;
  subtitle?: string;
  online?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0a0a0f]/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight hover:text-indigo-300">
          {title}
        </Link>
        {subtitle ? <span className="text-sm text-zinc-500">{subtitle}</span> : null}
        <div className="ml-auto flex items-center gap-3">
          {online !== undefined ? <ConnectionDot online={online} /> : null}
          {right}
        </div>
      </div>
    </header>
  );
}
