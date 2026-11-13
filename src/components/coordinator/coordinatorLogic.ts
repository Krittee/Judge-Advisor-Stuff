import { slotGrid, slotKind, slotTime, teamMatches, type GridDay, type SlotKind } from "@/components/desk/deskLogic";
import { dayPrefix } from "@/components/ui";
import { buildSlots, liveRequestFor } from "@/lib/data";
import { comparePits } from "@/lib/pit";
import { STATUS_META } from "@/lib/status";
import { compareTeamNumbers } from "@/lib/teamNumber";
import type { PublicPanel, RequestRow, Slot, Team } from "@/lib/types";

/* The coordinator console's decisions, kept apart from how they are drawn
   (CoordinatorView.tsx, TeamsTab.tsx, SlotsTab.tsx) so they can be run as
   they are. The coordinator sets languages and puts teams in the queue or
   on a slot; everything the desk does after that is the desk's. */

/* ---- the two tabs, and the URL that remembers which ---------------------------- */

export type CoordinatorTab = "teams" | "slots";

/** `?tab=slots` is Slots; anything else, or nothing, is Teams. */
export const tabFrom = (param: string | null): CoordinatorTab => (param === "slots" ? "slots" : "teams");

/* ---- the words the console uses more than once ------------------------------------ */

export const SET_LANGUAGE_LINE = "Set the language first";
export const NO_PANEL_LINE = "No panel yet — the Judge Advisor assigns one.";
export const ASK_DESK_LINE = "To change it, ask the queue desk.";

/* ---- language chips -------------------------------------------------------------------- */

/** The list a chip tap asks for: that language added or taken out, in config order. */
export function toggleLanguage(current: string[], id: string, order: string[]): string[] {
  const next = current.includes(id) ? current.filter((l) => l !== id) : [...current, id];
  return order.filter((l) => next.includes(l));
}

/* ---- the Teams list ------------------------------------------------------------------------ */

/**
 * What a team is doing, for its pill: the live request, else the earliest
 * booking (as everywhere), else the interview it has already had.
 */
export function requestOf(teamId: string, requests: RequestRow[]): RequestRow | null {
  const held = liveRequestFor(teamId, requests);
  if (held) return held;
  const done = requests
    .filter((r) => r.team_id === teamId && r.status === "completed")
    .sort((a, b) => (b.finished_at ?? b.updated_at).localeCompare(a.finished_at ?? a.updated_at));
  return done[0] ?? null;
}

/** "Booked 10:40" ("Booked Sun 9:15" on another day) for a booking, else the status's short word. */
export function pillText(request: Pick<RequestRow, "status" | "slot_start">, now: number = Date.now()): string {
  const word = STATUS_META[request.status].short;
  return request.status === "scheduled" && request.slot_start ? `${word} ${dayPrefix(request.slot_start, now)}${slotTime(request.slot_start)}` : word;
}

export type TeamFilter = { query: string; division: string; notAskedOnly: boolean };

export type TeamRowData = { team: Team; request: RequestRow | null };

export type TeamList = {
  /** The rows to draw, in walking order: down the pit rows, then by number. */
  rows: TeamRowData[];
  /** Counts over the teams the search and division leave, whether or not "Not asked" is on. */
  total: number;
  asked: number;
  notAsked: number;
};

export function teamList(teams: Team[], requests: RequestRow[], filter: TeamFilter): TeamList {
  const inScope = teams.filter((t) => (!filter.division || t.division === filter.division) && teamMatches(t, filter.query));
  const notAsked = inScope.filter((t) => !t.languages.length).length;
  const rows = (filter.notAskedOnly ? inScope.filter((t) => !t.languages.length) : inScope)
    .sort((a, b) => comparePits(a.pit, b.pit) || compareTeamNumbers(a.number, b.number))
    .map((team) => ({ team, request: requestOf(team.id, requests) }));
  return { rows, total: inScope.length, asked: inScope.length - notAsked, notAsked };
}

/* ---- what an opened row offers --------------------------------------------------------------- */

export type RowState =
  /** Waiting, on the way, interviewing or booked: the queue desk's to change. */
  | { kind: "held"; request: RequestRow }
  | { kind: "no-language" }
  | { kind: "no-panel" }
  | { kind: "ready"; panel: PublicPanel };

/** A request that has not finished is held; a completed one is history and the team may be asked for again. */
export function rowState(team: Team, panel: PublicPanel | null, request: RequestRow | null): RowState {
  if (request && request.status !== "completed") return { kind: "held", request };
  if (!team.languages.length) return { kind: "no-language" };
  if (!panel) return { kind: "no-panel" };
  return { kind: "ready", panel };
}

/* ---- the Slots tab --------------------------------------------------------------------------- */

/** What the pinned bar is about: nobody yet, or a team and what can be done with it (the row's own state). */
export type BookBar = { kind: "none" } | (RowState & { team: Team });

export const bookBar = (team: Team | null, panel: PublicPanel | null, request: RequestRow | null): BookBar =>
  team ? { ...rowState(team, panel, request), team } : { kind: "none" };

export type SlotLine = { slot: Slot; kind: SlotKind };

/** Book is live only for a team that can be booked, on its own panel, in a slot that is open. */
export const canBook = (bar: BookBar, line: SlotLine): boolean =>
  bar.kind === "ready" && bar.team.panel_id === line.slot.panelId && line.kind === "open";

export type SlotsModel = {
  panel: PublicPanel | null;
  /** The panel's whole day, past slots included (noSlotsLeftLine counts them). */
  slots: Slot[];
  /** Today's slots still to come: past ones are left out. */
  lines: SlotLine[];
  /** The same slots by day, with each day's heading and break row (slotGrid). */
  days: GridDay[];
  showDayHeadings: boolean;
  open: number;
  bar: BookBar;
  /** The slot picked, only while it can still be booked. */
  chosen: Slot | null;
};

export function slotsModel(input: {
  teams: Team[];
  panels: PublicPanel[];
  requests: RequestRow[];
  chosenId: string | null;
  panelPick: string | null;
  picked: string | null;
  now: number;
}): SlotsModel {
  const team = input.teams.find((t) => t.id === input.chosenId) ?? null;
  const own = team?.panel_id ? (input.panels.find((p) => p.id === team.panel_id) ?? null) : null;
  const bar = bookBar(team, own, team ? requestOf(team.id, input.requests) : null);
  // The panel tapped, else the chosen team's, else the first.
  const panel = input.panels.find((p) => p.id === input.panelPick) ?? own ?? input.panels[0] ?? null;
  const slots = panel ? buildSlots(panel, input.requests, input.teams) : [];

  const ctx = { teamId: team?.id ?? null, currentStart: null, now: input.now };
  const lines = slots.map((slot) => ({ slot, kind: slotKind(slot, ctx) })).filter((l) => l.kind !== "past");
  const grid = panel ? slotGrid(slots, panel, ctx) : null;
  const chosen = lines.find((l) => l.slot.start === input.picked && canBook(bar, l))?.slot ?? null;
  return { panel, slots, lines, days: grid?.days ?? [], showDayHeadings: grid?.showDayHeadings ?? false, open: lines.filter((l) => l.kind === "open").length, bar, chosen };
}
