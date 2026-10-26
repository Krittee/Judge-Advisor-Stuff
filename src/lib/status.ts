/**
 * The interview lifecycle and its wording.
 *
 * "Requested" is the one that matters: a team is waiting on a judge.
 */
export const STATUSES = [
  "scheduled",
  "requested",
  "acknowledged",
  "interviewing",
  "completed",
  "cancelled",
] as const;

export type Status = (typeof STATUSES)[number];

/** Statuses that still need someone to do something. */
export const LIVE_STATUSES: Status[] = ["requested", "acknowledged", "interviewing"];

export type StatusMeta = {
  label: string;
  short: string;
  /** What a team reads on their own screen. */
  teamLabel: string;
  /** Where the status sorts among the others; the judge queue's "with us" list reads it. */
  order: number;
};

export const STATUS_META: Record<Status, StatusMeta> = {
  /* Booked, but nobody has to do anything yet: the only status that is
     about the future. */
  scheduled: {
    label: "Scheduled",
    short: "Booked",
    teamLabel: "Your slot is booked",
    order: 1,
  },
  /* The one that matters. A team is stood waiting and nobody has picked
     them up. */
  requested: {
    label: "Requesting a judge",
    short: "Requesting",
    teamLabel: "Judges have been notified",
    order: 0,
  },
  acknowledged: {
    label: "Judges on their way",
    short: "On the way",
    teamLabel: "Judges are on their way to you",
    order: 2,
  },
  interviewing: {
    label: "Interview in progress",
    short: "Interviewing",
    teamLabel: "Interview in progress",
    order: 3,
  },
  completed: {
    label: "Interview complete",
    short: "Complete",
    teamLabel: "Interview complete — thank you!",
    order: 4,
  },
  /* Nothing to act on and nothing to celebrate. */
  cancelled: {
    label: "Cancelled",
    short: "Cancelled",
    teamLabel: "Request cancelled",
    order: 5,
  },
};

/** Which status a given role is allowed to move a request to. */
export const NEXT_STATUS: Partial<Record<Status, Status>> = {
  scheduled: "acknowledged",
  requested: "acknowledged",
  acknowledged: "interviewing",
  interviewing: "completed",
};

/** Nothing left to do: the interview ran, or the request was dropped. */
export const TERMINAL_STATUSES: Status[] = ["completed", "cancelled"];

/**
 * Where each action that names no target status may start from.
 *
 * `advance` is already pinned down by NEXT_STATUS above, and a judge's
 * `set-status` is held to that same table by the route (the Judge Advisor's
 * is the deliberate manual override). The three below had nothing behind
 * them at all, so a stale screen could cancel an interview that had already
 * run or "reopen" one still under way. The route reads this, and the
 * stores' ifStatus check closes the gap between reading it and writing.
 */
export const ACTION_FROM: Partial<Record<string, Status[]>> = {
  cancel: STATUSES.filter((s) => !TERMINAL_STATUSES.includes(s)),
  reopen: TERMINAL_STATUSES,
  // A booking turned into a walk-up request; nothing else has a slot to give up.
  "ready-now": ["scheduled"],
};

/** Whether `action` may start from `from`. Actions not in the table are not restricted here. */
export function canTransition(action: string, from: Status): boolean {
  return ACTION_FROM[action]?.includes(from) ?? true;
}
