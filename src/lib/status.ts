/**
 * The interview lifecycle and its colours.
 *
 * Orange means a team is waiting on you. That is the whole point of the
 * board, so it gets the loudest colour and it is the only one that pulses.
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
  /** Tailwind classes for a filled badge / card. */
  chip: string;
  /** Tailwind classes for the big board tile, ring included. */
  tile: string;
  /**
   * Background and text only, no ring.
   *
   * The pit floor puts a division-coloured ring around every tile, so it
   * needs the fill without a competing one — a status ring would win the
   * cascade and quietly strip the division colour off exactly the tiles
   * that need it most.
   */
  fill: string;
  /** Solid colour for the legend dot and board rail. */
  dot: string;
  order: number;
};

export const STATUS_META: Record<Status, StatusMeta> = {
  scheduled: {
    label: "Scheduled",
    short: "Booked",
    teamLabel: "Your slot is booked",
    chip: "bg-slate-500/15 text-slate-200 ring-1 ring-inset ring-slate-400/40",
    tile: "bg-slate-800/70 ring-1 ring-slate-600",
    fill: "bg-slate-800/70 text-slate-200",
    dot: "bg-slate-400",
    order: 1,
  },
  requested: {
    label: "Requesting a judge",
    short: "Requesting",
    teamLabel: "Judges have been notified",
    chip: "bg-orange-500 text-orange-950 font-semibold",
    tile: "bg-orange-500 text-orange-950 ring-2 ring-orange-300",
    fill: "bg-orange-500 text-orange-950",
    dot: "bg-orange-500",
    order: 0,
  },
  acknowledged: {
    label: "Judges on their way",
    short: "On the way",
    teamLabel: "Judges are on their way to you",
    chip: "bg-sky-500 text-sky-950 font-semibold",
    tile: "bg-sky-500 text-sky-950 ring-2 ring-sky-300",
    fill: "bg-sky-500 text-sky-950",
    dot: "bg-sky-500",
    order: 2,
  },
  interviewing: {
    label: "Interview in progress",
    short: "Interviewing",
    teamLabel: "Interview in progress",
    chip: "bg-violet-500 text-violet-950 font-semibold",
    tile: "bg-violet-500 text-violet-950 ring-2 ring-violet-300",
    fill: "bg-violet-500 text-violet-950",
    dot: "bg-violet-500",
    order: 3,
  },
  completed: {
    label: "Interview complete",
    short: "Complete",
    teamLabel: "Interview complete — thank you!",
    chip: "bg-emerald-500 text-emerald-950 font-semibold",
    tile: "bg-emerald-600/85 text-emerald-50 ring-1 ring-emerald-400",
    fill: "bg-emerald-600/85 text-emerald-50",
    dot: "bg-emerald-500",
    order: 4,
  },
  cancelled: {
    label: "Cancelled",
    short: "Cancelled",
    teamLabel: "Request cancelled",
    chip: "bg-zinc-600/40 text-zinc-300 ring-1 ring-inset ring-zinc-500",
    tile: "bg-zinc-800/60 text-zinc-400 ring-1 ring-zinc-700",
    fill: "bg-zinc-800/60 text-zinc-400",
    dot: "bg-zinc-500",
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

export function isLive(status: Status): boolean {
  return LIVE_STATUSES.includes(status);
}
