"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { STATUS_META, type Status } from "@/lib/status";
import { bookingUrgency, type BookingUrgency } from "@/lib/data";
import { ConsoleLinks } from "./nav";
import type { Role } from "@/lib/auth";

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
        <span key={s} className="flex items-center gap-2 text-sm text-ink-subtle">
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

function formatElapsed(since: string): string {
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

/**
 * A booked slot time, which turns orange as it comes up.
 *
 * Every screen showing a booking uses this, so the clock format and the
 * moment it starts warning are the same everywhere rather than decided
 * again per page.
 *
 * It keeps its own 30-second tick because nothing else would re-render
 * it: /api/state answers an unchanged board with a 304 and no state
 * update, so a page left open on the desk would sit on a stale colour
 * until something unrelated changed. One interval per booking shown, and
 * only while a booking is actually pending -- a slot already due, or one
 * whose interview has started, has nothing left to count down to.
 *
 * The warning is the colour and a "in 12 min" line, nothing more: no
 * toast, no sound, no repeat. It is read at a glance off a board across
 * a room, which is also why it does not pulse until the slot is due.
 */
export function BookingTime({
  slotStart,
  status,
  size = "md",
  label,
}: {
  slotStart: string | null;
  /**
   * The request's status, where there is one.
   *
   * Only a slot still being waited on counts down. Once judges have
   * acknowledged it the team is already being dealt with, and a tile
   * pulsing orange through the interview is noise about something nobody
   * still has to act on -- but the time is kept on screen, because "when
   * were they booked" is a question the desk still asks afterwards.
   */
  status?: Status;
  size?: "sm" | "md" | "lg";
  /** Prefix such as "Slot" or "Booked". Left off where a column says it. */
  label?: string;
}) {
  const pending = !status || status === "scheduled";
  const live = useBookingUrgency(slotStart);
  const urgency: BookingUrgency = pending ? live : "later";

  if (!slotStart) return <span className="text-ink-faint">Not booked</span>;

  const pad =
    size === "lg"
      ? "px-3 py-1 text-base"
      : size === "sm"
        ? "px-1.5 py-0.5 text-xs"
        : "px-2 py-0.5 text-sm";

  const tone =
    urgency === "due"
      ? "bg-waiting text-waiting-ink font-semibold pulse-waiting"
      : urgency === "soon"
        ? "bg-waiting/20 text-waiting-quiet font-semibold ring-1 ring-inset ring-waiting/50"
        : "text-ink-muted";

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full tabular-nums ${pad} ${tone}`}
      title={urgency === "later" ? undefined : `Booked for ${formatClock(slotStart)}`}
      suppressHydrationWarning
    >
      {label ? <span className="font-normal opacity-70">{label}</span> : null}
      {formatClock(slotStart)}
      {urgency === "due" ? <span className="text-xs">now</span> : null}
      {urgency === "soon" ? (
        <span className="text-xs font-normal">in {minutesUntil(slotStart)} min</span>
      ) : null}
    </span>
  );
}

/**
 * Re-reads the clock while a booking is still ahead of us.
 *
 * The interval is dropped once the slot is due, so a board full of
 * finished bookings is not still waking up every 30 seconds for each one.
 */
function useBookingUrgency(slotStart: string | null): BookingUrgency {
  const [urgency, setUrgency] = useState<BookingUrgency>(() =>
    bookingUrgency(slotStart, Date.now()),
  );

  useEffect(() => {
    const read = () => bookingUrgency(slotStart, Date.now());
    setUrgency(read());
    if (!slotStart || read() === "due") return;

    const t = setInterval(() => {
      const next = read();
      setUrgency(next);
      if (next === "due") clearInterval(t);
    }, 30_000);
    return () => clearInterval(t);
  }, [slotStart]);

  return urgency;
}

function minutesUntil(slotStart: string): number {
  return Math.max(1, Math.ceil((new Date(slotStart).getTime() - Date.now()) / 60_000));
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
  /**
   * Not every button is a primary button.
   *
   * `quiet` exists so a secondary action can sit next to a real one
   * without competing with it -- a screen where three buttons are all
   * filled is a screen that has not said which one you want.
   */
  variant?: "primary" | "ghost" | "quiet" | "danger" | "success" | "warn";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const variants = {
    primary: "bg-accent text-accent-ink hover:bg-accent-quiet",
    ghost: "bg-surface text-ink hover:bg-surface-2 ring-1 ring-inset ring-line",
    quiet: "text-ink-subtle hover:text-ink hover:bg-surface-2",
    danger: "bg-danger text-danger-ink hover:bg-danger-quiet",
    success: "bg-done text-done-ink hover:bg-done-quiet font-semibold",
    warn: "bg-waiting text-waiting-ink hover:bg-waiting-quiet font-semibold",
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
      <span className="mb-1.5 block text-sm font-medium text-ink-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-faint">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl bg-surface px-4 py-3 text-ink ring-1 ring-inset ring-line outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-accent";

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
    error: "bg-danger/15 text-danger-quiet ring-danger/40",
    success: "bg-done/15 text-done-quiet ring-done/40",
    info: "bg-enroute/15 text-enroute-quiet ring-enroute/40",
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
        online ? "text-done-quiet" : "text-caution-quiet"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${online ? "bg-done" : "bg-caution pulse-waiting"}`}
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
  /** Where this session may go. Omitted on the public pages. */
  role,
  current,
}: {
  title: string;
  subtitle?: string;
  online?: boolean;
  right?: React.ReactNode;
  role?: Role | "team";
  current?: string;
}) {
  return (
    <header className="app-header sticky top-0 z-20 border-b border-line backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <Link
          href="/"
          className="font-display text-lg font-semibold tracking-tight transition hover:text-accent"
        >
          {title}
        </Link>
        {subtitle ? (
          <span className="border-l border-line pl-3 text-sm text-ink-subtle">{subtitle}</span>
        ) : null}
        {role && current ? (
          <div className="ml-1 hidden sm:block">
            <ConsoleLinks role={role} current={current} />
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          {online !== undefined ? <ConnectionDot online={online} /> : null}
          {right}
        </div>
        {/* On a phone the switcher drops to its own line rather than
            being cut off the end of a row it shares with a sign-out. */}
        {role && current ? (
          <div className="no-scrollbar -mb-0.5 w-full overflow-x-auto pb-0.5 sm:hidden">
            <ConsoleLinks role={role} current={current} />
          </div>
        ) : null}
      </div>
    </header>
  );
}
