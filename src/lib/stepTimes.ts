import type { RequestRow } from "./types";

/* The Judge Advisor's "Times" correction: which of a request's step times can
   be edited, and whether an edit is allowed. Pure, so the drawer (to say why
   Save times is off) and PATCH /api/requests/[id] `set-times` (to refuse) run
   the same rules. */

/** The steps, in the order they happen. Cancelled can come after any of them. */
export const TIME_STEPS = [
  { field: "requested_at", label: "Requested" },
  { field: "acknowledged_at", label: "On the way" },
  { field: "started_at", label: "Started" },
  { field: "finished_at", label: "Finished" },
  { field: "cancelled_at", label: "Cancelled" },
] as const;

export type TimeField = (typeof TIME_STEPS)[number]["field"];

/** Step times as ISO strings, only the ones named. */
export type StepTimes = Partial<Record<TimeField, string>>;

type TimedRequest = Pick<RequestRow, "kind" | "slot_start" | TimeField>;

const labelOf = (field: TimeField): string => TIME_STEPS.find((s) => s.field === field)!.label;

// The event is in Bangkok (UTC+7, no daylight saving). bangkokDay() is the one place the
// timezone lives: judgeDay() in auth.ts and sameEventDay() in team/teamLogic.ts call it.
// Add an event timezone setting if this app runs elsewhere.
const OFFSET = "+07:00";
const dayFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });
const clockFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** The Bangkok calendar day of an ISO time: "2026-10-25". */
export const bangkokDay = (iso: string): string => dayFormat.format(new Date(iso));

/** The Bangkok clock time of an ISO time as a time input reads it: "10:52". */
export const bangkokClock = (iso: string): string => clockFormat.format(new Date(iso));

/**
 * The day a request belongs to: when it was asked for. A booking belongs to the
 * day of its slot, not the day it was made.
 */
export const requestDay = (r: Pick<RequestRow, "kind" | "slot_start" | "requested_at">): string =>
  bangkokDay(r.kind === "slot" && r.slot_start ? r.slot_start : r.requested_at);

/**
 * The steps a request has reached: the ones it holds a time for. A booking's
 * requested_at is when it was booked, not a request, so it is no step.
 */
export function reachedSteps(r: TimedRequest): TimeField[] {
  return TIME_STEPS.map((s) => s.field).filter((f) => r[f] != null && !(f === "requested_at" && r.kind === "slot"));
}

/** The Times form as it starts: "HH:MM" for each step reached. */
export function startTimes(r: TimedRequest): Partial<Record<TimeField, string>> {
  return Object.fromEntries(reachedSteps(r).map((f) => [f, bangkokClock(r[f]!)]));
}

/** "HH:MM" typed on a request's day, as an ISO time; null when it isn't a time. */
export function isoOnDay(day: string, clock: string): string | null {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(clock) ? new Date(`${day}T${clock}:00${OFFSET}`).toISOString() : null;
}

/**
 * What the form changes, as ISO times on the request's day: only the steps whose
 * time was edited (the others keep their seconds). A cleared box is sent as
 * null so `readTimes` can say so.
 */
export function formTimes(r: TimedRequest, form: Partial<Record<TimeField, string>>): Record<string, string | null> {
  const start = startTimes(r);
  const day = requestDay(r);
  const out: Record<string, string | null> = {};
  for (const f of reachedSteps(r)) {
    if (form[f] !== undefined && form[f] !== start[f]) out[f] = isoOnDay(day, form[f]!);
  }
  return out;
}

/**
 * Whether `input` (the `times` of a set-times body) may be written to `r`, and
 * what is written: the times as clean ISO strings. Otherwise the reason, in words
 * for the Judge Advisor. Checked in this order: something to change, only steps the
 * request has reached, real times, on the request's day, and then the order
 * requested, on the way, started, finished (cancelled last). The order is checked
 * between neighbours with at least one edited, so a request already out of order
 * can still have its other times corrected.
 */
export function readTimes(r: TimedRequest, input: unknown): { times: StepTimes } | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input) || !Object.keys(input).length) {
    return { error: "Change at least one time." };
  }
  const given = input as Record<string, unknown>;
  const reached = reachedSteps(r);
  const day = requestDay(r);
  const times: StepTimes = {};

  for (const [key, value] of Object.entries(given)) {
    const step = TIME_STEPS.find((s) => s.field === key);
    if (!step) return { error: `${key} is not a time that can be corrected.` };
    if (!reached.includes(step.field)) return { error: `This request has not reached "${step.label}", so it has no time to correct.` };
    const at = typeof value === "string" ? new Date(value) : null;
    if (!at || Number.isNaN(at.getTime())) return { error: `Enter a time for ${step.label}.` };
    if (bangkokDay(at.toISOString()) !== day) return { error: `${step.label} must be on the request's own day (${day}, Bangkok time).` };
    times[step.field] = at.toISOString();
  }

  // The request as it would be: its own times, then the edits.
  const present = TIME_STEPS.filter((s) => reached.includes(s.field)).map((s) => ({ ...s, at: times[s.field] ?? r[s.field]! }));
  for (let i = 1; i < present.length; i++) {
    const [before, after] = [present[i - 1], present[i]];
    if (!(before.field in times) && !(after.field in times)) continue;
    if (new Date(after.at).getTime() < new Date(before.at).getTime()) {
      return { error: `${after.label} (${bangkokClock(after.at)}) can't be before ${before.label} (${bangkokClock(before.at)}).` };
    }
  }
  return { times };
}

/** The Activity line for a correction: "corrected times: finished 10:58 → 10:52". */
export function timesLogLine(r: TimedRequest, times: StepTimes): string {
  const changes = TIME_STEPS.filter((s) => times[s.field]).map(
    (s) => `${labelOf(s.field).toLowerCase()} ${bangkokClock(r[s.field]!)} → ${bangkokClock(times[s.field]!)}`,
  );
  return `corrected times: ${changes.join(", ")}`;
}
