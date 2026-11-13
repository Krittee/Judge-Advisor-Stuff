import type { Ask } from "@/components/judge/logic";
import type { PanelLoad } from "@/components/SlotPicker";
import { clockParts } from "@/components/team/teamLogic";
import { slotLabel } from "@/components/ui";
import { liveRequestFor, panelDays, type SlotFields } from "@/lib/data";
import { bookingLanguage } from "@/lib/presets";
import { bangkokClock, bangkokDay, bangkokDayLabel } from "@/lib/stepTimes";
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

/* ---- interview language ---------------------------------------------------------- */

/**
 * The request buttons for a team, in order. A team that has said exactly one
 * language gets that button first and filled, the other outlined after it;
 * a team with both languages, none, or one we do not run gets equal buttons
 * in config order. The desk reads the team's language, it never sets it.
 */
export function requestOrder(
  team: { languages: string[] } | null,
  languages: { id: string }[],
): { id: string; primary: boolean }[] {
  const known = languages.filter((l) => team?.languages.includes(l.id));
  if (known.length !== 1) return languages.map((l) => ({ id: l.id, primary: true }));
  const one = known[0].id;
  return [
    { id: one, primary: true },
    ...languages.filter((l) => l.id !== one).map((l) => ({ id: l.id, primary: false })),
  ];
}

/** What the desk picked in the Book language select, and for which team. */
export type BookChoice = { teamId: string; language: string };

/**
 * The language the Book select shows: the desk's own pick while it is still the
 * same team, else `bookingLanguage` for the team on its panel. Derived
 * rather than stored so a different team re-defaults without an effect.
 */
export function bookLanguageFor(
  choice: BookChoice | null,
  team: (Pick<Team, "id"> & { languages: string[] }) | null,
  fallback: string,
  panel?: Pick<PublicPanel, "languages"> | null,
): string {
  if (!team) return fallback;
  return choice && choice.teamId === team.id ? choice.language : bookingLanguage("", team, panel);
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

/** One day of a panel's slots: its heading, its hour rows and where its break row goes. */
export type GridDay = {
  /** 1-based, by the panel's day order, so Day 2 stays Day 2 once Day 1 has passed. */
  day: number;
  /** "Day 1 · Sat 21 Nov". */
  label: string;
  /** Slots on this day that can still be booked. */
  open: number;
  rows: SlotRow[];
  /** The break row sits after the hour row starting here; null when there is no break to show. */
  breakAfterHour: string | null;
  /** "12:00–13:00 · Break". */
  breakLabel: string | null;
};

export type SlotGrid = {
  days: GridDay[];
  /** Two or more days configured: each gets a heading, even when only the last is left. */
  showDayHeadings: boolean;
  /** Every day's rows in order, for callers that do not care about days. */
  rows: SlotRow[];
  /** Columns the grid has besides the hour label. */
  columns: number;
  /** Slots drawn (past ones are not), and how many of them can be booked. */
  shown: number;
  open: number;
};

/** Past this many columns the grid is wider than a phone and scrolls sideways as one block. */
const WIDE_FROM = 5;

/** The grid-template-columns of an hour row: the hour label, then one column per slot position. */
export function hourRowColumns(columns: number): string {
  return `56px repeat(${columns}, minmax(${columns >= WIDE_FROM ? "48px" : "0"}, 1fr))`;
}

/** True when the grid has more columns than fit a phone without scrolling. */
export const isWideGrid = (columns: number) => columns >= WIDE_FROM;

/**
 * One row per hour, past slots left out, grouped by the panel's days. A slot
 * sits in the column its minute falls in (a 20-minute panel has :00 :20 :40),
 * so the columns line up from hour to hour, and an hour is always one line
 * however short the slots are (the grid scrolls sideways instead of wrapping).
 * A day's break row is kept only while slots still show on both sides of it.
 */
export function slotGrid(slots: Slot[], panel: SlotFields, ctx: SlotContext): SlotGrid {
  const slotMinutes = panel.slot_minutes;
  const perHour = Math.max(1, Math.ceil(60 / Math.max(1, slotMinutes)));
  const columns = perHour;

  const panelDay = panelDays(panel);
  const days: GridDay[] = panelDay.map((d, i) => ({
    day: i + 1,
    label: `Day ${i + 1} · ${bangkokDayLabel(d.open_at)}`,
    open: 0,
    rows: [],
    breakAfterHour: null,
    breakLabel: null,
  }));
  const byHour = panelDay.map(() => new Map<number, SlotRow>());
  // Per day: the last slot before its break, and the first slot after it.
  const around = panelDay.map(() => ({ before: null as Slot | null, after: null as Slot | null }));
  let shown = 0;
  const hourOf = (iso: string) => new Date(iso).setMinutes(0, 0, 0);

  for (const slot of slots) {
    const kind = slotKind(slot, ctx);
    if (kind === "past") continue;
    // A one-day panel owns every slot (a legacy window can cross midnight); else match by Bangkok day.
    const i = panelDay.length === 1 ? 0 : panelDay.findIndex((d) => bangkokDay(d.open_at) === bangkokDay(slot.start));
    if (i < 0) continue;
    const day = days[i];
    const brk = panelDay[i];
    shown++;
    if (kind === "open") day.open++;

    const at = new Date(slot.start);
    const hour = hourOf(slot.start);
    let row = byHour[i].get(hour);
    if (!row) {
      row = { hourStart: new Date(hour).toISOString(), cells: [] };
      byHour[i].set(hour, row);
      day.rows.push(row);
    }
    row.cells.push({ slot, kind, column: Math.floor(at.getMinutes() / slotMinutes) % columns, row: 0 });

    if (brk.break_from && brk.break_to) {
      if (at.getTime() < new Date(brk.break_from).getTime()) around[i].before = slot;
      else if (at.getTime() >= new Date(brk.break_to).getTime()) around[i].after ??= slot;
    }
  }

  const out = days
    .map((d, i) => {
      const { before, after } = around[i];
      if (!before || !after) return d;
      // Both sides in one hour row (12:15–12:45): the gap in that row says it, a row below would sit under 12:45.
      if (hourOf(before.start) === hourOf(after.start)) return d;
      const brk = panelDay[i];
      return {
        ...d,
        breakAfterHour: new Date(hourOf(before.start)).toISOString(),
        breakLabel: `${bangkokClock(brk.break_from!)}–${bangkokClock(brk.break_to!)} · Break`,
      };
    })
    .filter((d) => d.rows.length);
  return {
    days: out,
    showDayHeadings: panelDay.length >= 2,
    rows: out.flatMap((d) => d.rows),
    columns,
    shown,
    open: out.reduce((sum, d) => sum + d.open, 0),
  };
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
  // The box keeps only A-Z, 0-9 and "-" (filterTeamNumberInput), so squash the
  // name the same way: "orbit otters" arrives as ORBITOTTERS. No length cap here,
  // so the end of a long name still matches. Non-Latin names can't be typed in.
  const squashed = t.name.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  return !number || t.number.startsWith(number) || squashed.includes(number);
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
  `Cancel ${teamNumber}'s ${slotLabel(slotStart)} booking?`;

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
