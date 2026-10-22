import type { Ask } from "@/components/judge/logic";
import type { PanelLoad } from "@/components/SlotPicker";
import { clockParts } from "@/components/team/teamLogic";
import { formatClock } from "@/components/ui";
import { liveRequestFor } from "@/lib/data";
import type { Status } from "@/lib/status";
import { compareTeamNumbers, normalizeTeamNumber } from "@/lib/teamNumber";
import type { PublicPanel, RequestRow, Slot, Team } from "@/lib/types";

/* The queue desk's decisions, kept apart from how they are drawn
   (DeskView.tsx, DeskSlots.tsx) so they can be run as they are. */

/* ---- what the team number on screen means ------------------------------------ */

export type LookupState =
  /** Nothing typed, or not far enough to say anything. */
  | { kind: "none" }
  /** A complete-looking number that is not on the roster. */
  | { kind: "not-found" }
  /** In the queue already (requested, acknowledged or interviewing). */
  | { kind: "waiting"; request: RequestRow }
  /** Holds a later slot. */
  | { kind: "booked"; booking: RequestRow }
  | { kind: "no-panel" }
  | { kind: "ready" };

/** Shortest number that can be called "complete" (a team number is usually 3-6 characters). */
const COMPLETE_LENGTH = 3;

/**
 * Which of the five cases the number on screen is.
 *
 * "Not found" waits until the number could not still be on its way to a real
 * one: 770 is not an error while 7700B is on the roster, and an empty box
 * says nothing at all. Text that matches a team's name is not an error either:
 * the All teams list finds that team (same matching, teamMatches).
 */
export function lookupState(input: {
  number: string;
  team: Team | null;
  panel: PublicPanel | null;
  /** The team's live request, or failing that its earliest booking (liveRequestFor). */
  existing: RequestRow | null;
  /** The whole roster, for telling a half-typed number or a name from a wrong number. */
  roster: Pick<Team, "number" | "name">[];
}): LookupState {
  const { number, team, panel, existing, roster } = input;
  if (!team) {
    // Until the roster has arrived nothing can be called wrong.
    const complete =
      number.length >= COMPLETE_LENGTH &&
      roster.length > 0 &&
      !roster.some((t) => teamMatches(t, number));
    return complete ? { kind: "not-found" } : { kind: "none" };
  }
  if (existing) {
    return existing.status === "scheduled"
      ? { kind: "booked", booking: existing }
      : { kind: "waiting", request: existing };
  }
  return panel ? { kind: "ready" } : { kind: "no-panel" };
}

/** "2 waiting · 1 in interview", or "free now" when neither. */
export function busyText(load: PanelLoad): string {
  const parts: string[] = [];
  if (load.waiting) parts.push(`${load.waiting} waiting`);
  if (load.interviewing) parts.push(`${load.interviewing} in interview`);
  return parts.length ? parts.join(" · ") : "free now";
}

/* ---- the slot grid ------------------------------------------------------------- */

export type SlotKind = "past" | "theirs" | "current" | "taken" | "too-close" | "open";

export type SlotContext = {
  /** The team on screen, so a slot it holds reads as theirs. */
  teamId: string | null;
  /** While rescheduling: the start of the booking being moved. */
  currentStart: string | null;
  now: number;
};

/**
 * What a slot is, in the order SlotPicker has always decided it: theirs, then
 * taken, then too close, then open. The booking being moved is "current"
 * instead of theirs; a slot that is over is "past" and not drawn.
 */
export function slotKind(slot: Slot, ctx: SlotContext): SlotKind {
  if (new Date(slot.end).getTime() <= ctx.now) return "past";
  if (slot.takenBy) {
    if (ctx.currentStart && new Date(slot.start).getTime() === new Date(ctx.currentStart).getTime()) {
      return "current";
    }
    return ctx.teamId && slot.takenBy.teamId === ctx.teamId ? "theirs" : "taken";
  }
  return slot.blocked ? "too-close" : "open";
}

/** The first slot a booking could still go into, or null when there is none. */
export function nextFreeStart(slots: Slot[], now: number): string | null {
  return (
    slots.find((s) => slotKind(s, { teamId: null, currentStart: null, now }) === "open")?.start ??
    null
  );
}

export type SlotRow = {
  /** The hour the row stands for (its first slot's hour), as an ISO time. */
  hourStart: string;
  cells: { slot: Slot; kind: SlotKind; column: number; row: number }[];
};

export type SlotGrid = {
  rows: SlotRow[];
  /** Columns the grid has besides the hour label. */
  columns: number;
  /** Slots drawn (past ones are not), and how many of them can be booked. */
  shown: number;
  open: number;
};

const MAX_COLUMNS = 4;

/**
 * One row per hour, past slots left out. A slot sits in the column its minute
 * falls in (a 20-minute panel has :00 :20 :40), so the columns line up from
 * hour to hour. Slots shorter than 15 minutes would need more than
 * MAX_COLUMNS, so they just fill the row from the left and wrap.
 */
export function slotGrid(slots: Slot[], slotMinutes: number, ctx: SlotContext): SlotGrid {
  const perHour = Math.max(1, Math.ceil(60 / Math.max(1, slotMinutes)));
  const aligned = perHour <= MAX_COLUMNS;
  const columns = Math.min(perHour, MAX_COLUMNS);

  const rows: SlotRow[] = [];
  const byHour = new Map<number, SlotRow>();
  let open = 0;
  let shown = 0;

  for (const slot of slots) {
    const kind = slotKind(slot, ctx);
    if (kind === "past") continue;
    shown++;
    if (kind === "open") open++;

    const at = new Date(slot.start);
    const hour = new Date(at).setMinutes(0, 0, 0);
    let row = byHour.get(hour);
    if (!row) {
      row = { hourStart: new Date(hour).toISOString(), cells: [] };
      byHour.set(hour, row);
      rows.push(row);
    }
    const n = row.cells.length;
    row.cells.push(
      aligned
        ? { slot, kind, column: Math.floor(at.getMinutes() / slotMinutes) % columns, row: 0 }
        : { slot, kind, column: n % columns, row: Math.floor(n / columns) },
    );
  }
  return { rows, columns, shown, open };
}

/** "10:40" without the AM/PM, which the hour label carries. */
export const slotTime = (iso: string): string => clockParts(iso).time;

/* ---- statuses ------------------------------------------------------------------- */

/** Which `.dk-s-*` class a status wears. */
export const TONE: Partial<Record<Status, "booked" | "waiting" | "enroute" | "active" | "done">> = {
  scheduled: "booked",
  requested: "waiting",
  acknowledged: "enroute",
  interviewing: "active",
  completed: "done",
};

/* ---- all teams ---------------------------------------------------------------------- */

/** Does typed text point at this team: a number it starts, or a name it is part of (any case)? */
export function teamMatches(t: Pick<Team, "number" | "name">, query: string): boolean {
  const number = normalizeTeamNumber(query);
  return !number || t.number.startsWith(number) || t.name.toLowerCase().includes(number.toLowerCase());
}

export type TeamListRow = { team: Team; request: RequestRow | null };

/**
 * Every team in number order, each with its live request or earliest booking.
 * Typed text narrows it to the teams whose number starts with it or whose name
 * contains it; an empty box is everyone.
 */
export function teamList(teams: Team[], requests: RequestRow[], query: string): TeamListRow[] {
  return teams
    .filter((t) => teamMatches(t, query))
    .sort((a, b) => compareTeamNumbers(a.number, b.number))
    .map((team) => ({ team, request: liveRequestFor(team.id, requests) }));
}

/* ---- cancelling a booking --------------------------------------------------------- */

export const cancelBookingPrompt = (teamNumber: string, slotStart: string | null): string =>
  `Cancel ${teamNumber}'s ${formatClock(slotStart)} booking?`;

/**
 * Cancel booking, asked first: it is the one thing the desk cannot take back.
 * `send` is the write; on a no it is never called. Returns whether it was.
 * The buttons read "Cancel booking" / "Keep it", never "Cancel" beside
 * "Cancel booking".
 */
export async function cancelBookingAfterAsking(
  ask: Ask,
  teamNumber: string,
  booking: Pick<RequestRow, "slot_start">,
  send: () => Promise<void>,
): Promise<boolean> {
  const question = cancelBookingPrompt(teamNumber, booking.slot_start);
  if (!(await ask(question, { confirmLabel: "Cancel booking", cancelLabel: "Keep it", danger: true }))) {
    return false;
  }
  await send();
  return true;
}
