import { formatClock, formatMinutes } from "@/components/ui";
import { STATUS_META, type Status } from "@/lib/status";
import type { RequestRow } from "@/lib/types";

/* The team page's decisions, kept apart from how they are drawn
   (TeamView.tsx) so they can be run as they are. */

/* ---- the track ------------------------------------------------------------ */

export type StepState = "current" | "done" | "skipped" | "todo";

/** A time the app knows for a step: a clock time, or "how long ago". */
export type StepAt = { kind: "clock" | "ago"; iso: string };

export type TrackStep = {
  key: "booked" | "requested" | "on-the-way" | "interviewing" | "complete";
  label: string;
  /** The status this step stands for, so it wears that status's colour. */
  status: Status;
  state: StepState;
  at: StepAt | null;
};

const STEPS: Pick<TrackStep, "key" | "label" | "status">[] = [
  { key: "booked", label: "Booked", status: "scheduled" },
  { key: "requested", label: "Requested", status: "requested" },
  { key: "on-the-way", label: "On the way", status: "acknowledged" },
  { key: "interviewing", label: "Interviewing", status: "interviewing" },
  { key: "complete", label: "Complete", status: "completed" },
];

type TrackRequest = Pick<RequestRow, "status" | "kind" | "slot_start" | "requested_at">;

/**
 * The five steps, and where a team stands on them.
 *
 * `current` is the team's live request (liveRequestFor), or null for a team
 * with nothing in progress: every step is then still to come.
 *
 *  - The current step is the request's status; earlier ones are done, later
 *    ones still to come.
 *  - Booked is "skipped" (not used) when the team went straight to the queue.
 *    That includes a booking turned into a request with "ready now", which
 *    gives the slot up and leaves a queue request behind.
 *  - Times are shown only where the app really has one: the slot for Booked,
 *    and the request time for Requested -- but not for a booking judges took
 *    on early, whose requested_at is when it was booked, not a request.
 */
export function trackSteps(current: TrackRequest | null): TrackStep[] {
  const at = current ? STEPS.findIndex((s) => s.status === current.status) : -1;
  if (!current || at < 0) return STEPS.map((s) => ({ ...s, state: "todo", at: null }));

  const booked = current.kind === "slot" && current.slot_start != null;
  return STEPS.map((s, i) => {
    const state: StepState =
      i === at ? "current" : i > at ? "todo" : i === 0 && !booked ? "skipped" : "done";
    const reached = i <= at;
    return {
      ...s,
      state,
      at:
        reached && i === 0 && booked
          ? { kind: "clock", iso: current.slot_start! }
          : reached && i === 1 && current.kind === "queue"
            ? { kind: "ago", iso: current.requested_at }
            : null,
    };
  });
}

/** The tone class a status wears on this page (`tp-s-<tone>`). */
export function toneOf(status: Status): "booked" | "waiting" | "enroute" | "active" | "done" | "off" {
  switch (status) {
    case "scheduled":
      return "booked";
    case "requested":
      return "waiting";
    case "acknowledged":
      return "enroute";
    case "interviewing":
      return "active";
    case "completed":
      return "done";
    default:
      return "off";
  }
}

/* ---- the big time on the status panel --------------------------------------- */

export type BigTime = { label: string; at: StepAt };

/**
 * The one time worth reading from across a table, or null when there is none.
 *
 * A booking shows its slot; a request shows how long ago it was made; an
 * interview shows how long ago it started. A booking that judges have taken
 * on early keeps showing its slot -- its requested_at is when it was booked.
 */
export function bigTimeOf(
  r: Pick<RequestRow, "status" | "kind" | "slot_start" | "requested_at" | "started_at">,
): BigTime | null {
  if (r.status === "interviewing") {
    return r.started_at ? { label: "Started", at: { kind: "ago", iso: r.started_at } } : null;
  }
  if (r.status === "scheduled" || (r.kind === "slot" && r.status === "acknowledged")) {
    return r.slot_start ? { label: "Booked slot", at: { kind: "clock", iso: r.slot_start } } : null;
  }
  if (r.status === "requested" || r.status === "acknowledged") {
    return { label: "Requested", at: { kind: "ago", iso: r.requested_at } };
  }
  return null;
}

/** "10:40 AM" as { time: "10:40", period: "AM" }, so the period can be set small beside big digits. */
export function clockParts(iso: string): { time: string; period: string } {
  const parts = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).formatToParts(new Date(iso));
  return {
    time: parts
      .filter((p) => p.type !== "dayPeriod")
      .map((p) => p.value)
      .join("")
      .trim(),
    period: parts.find((p) => p.type === "dayPeriod")?.value ?? "",
  };
}

/**
 * "4 min" + "ago"; under a minute it is just "just now" with nothing after it.
 * `long` is an hour or more ("54h 39m"), too wide for the big digits.
 */
export function agoParts(iso: string, now: number): { text: string; suffix: string; long: boolean } {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  const text = formatMinutes(mins);
  return { text, suffix: mins < 1 ? "" : "ago", long: mins >= 60 };
}

/** The caps label over the status sentence: the short name when the long one would just repeat it. */
export function statusCaps(s: Status): string {
  const { label, short, teamLabel } = STATUS_META[s];
  return label.toLowerCase() === teamLabel.toLowerCase() ? short : label;
}

/** A step's time as one line: "10:40 AM", "4 min ago", "just now". */
export function stepTime(at: StepAt, now: number): string {
  if (at.kind === "clock") return formatClock(at.iso);
  const { text, suffix } = agoParts(at.iso, now);
  return suffix ? `${text} ${suffix}` : text;
}

/* ---- earlier today ------------------------------------------------------------ */

/** When a finished or dropped request is shown as having happened. */
export const historyTime = (r: Pick<RequestRow, "finished_at" | "cancelled_at" | "requested_at">): string =>
  r.finished_at ?? r.cancelled_at ?? r.requested_at;

/* The event's day is Bangkok's calendar day, as in judgeDay() in src/lib/auth.ts. */
const eventDayFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
});

/** Whether an ISO time falls on the same Bangkok calendar day as `now` (ms). */
export const sameEventDay = (iso: string, now: number): boolean =>
  eventDayFormat.format(new Date(iso)) === eventDayFormat.format(new Date(now));

/** Up to five of the team's other requests from today, in the order the server sent them. */
export function earlierToday(requests: RequestRow[], teamId: string, currentId: string | undefined, now: number): RequestRow[] {
  return requests
    .filter((r) => r.team_id === teamId && r.id !== currentId && sameEventDay(historyTime(r), now))
    .slice(0, 5);
}
