import type { Ask } from "@/components/judge/logic";
import type { call } from "@/components/useAppState";
import { panelDays, parseSlotDays, slotTimes, type SlotFields } from "@/lib/data";
import { bangkokClock, bangkokDay, isoOnDay } from "@/lib/stepTimes";
import type { ConflictRow, JudgeRow, PublicPanel, SlotDay, Team } from "@/lib/types";
import { panelTag } from "./conflictsLogic";

/* The Judge Advisor Panels tab's decisions, kept out of the markup so they run
   as plain functions in tests/adminPanels.logic.test.mjs. Nothing here decides
   which panel a conflict blocks: moving a judge asks the server (`dryRun`),
   which reads the one rule, `panelBlocks`. */

/** "1 conflict" / "3 conflicts". */
export const conflictsLabel = (n: number): string => `${n} ${n === 1 ? "conflict" : "conflicts"}`;

/** How many conflicts belong to this judge: the pill on their row, and what removing them withdraws. */
export const judgeConflicts = (judgeId: string, conflicts: Pick<ConflictRow, "judge_id">[]): number =>
  conflicts.filter((x) => x.judge_id === judgeId).length;

/** The value of a judge's Panel select: their panel, or "" (— none —) when they have none or it is gone. */
export const panelValue = (judge: Pick<JudgeRow, "panel_id">, panels: Pick<PublicPanel, "id">[]): string =>
  panels.some((p) => p.id === judge.panel_id) ? (judge.panel_id as string) : "";

export type RosterGroup = { key: string; label: string; judges: JudgeRow[] };

/**
 * The roster's groups: "Not on a panel" first, then one per panel in panel
 * order, labelled as the Conflicts list is ("Panel 2 · MS"). A group with
 * nobody in it is left out. Judges keep the roster's own order inside a group.
 */
export function rosterGroups(judges: JudgeRow[], panels: PublicPanel[]): RosterGroup[] {
  const known = new Set(panels.map((p) => p.id));
  const groups: RosterGroup[] = [
    { key: "none", label: "Not on a panel", judges: judges.filter((j) => !j.panel_id || !known.has(j.panel_id)) },
    ...panels.map((p) => ({ key: p.id, label: panelTag(p), judges: judges.filter((j) => j.panel_id === p.id) })),
  ];
  return groups.filter((g) => g.judges.length);
}

/** How many teams hold each panel. */
export function teamsByPanel(teams: Pick<Team, "panel_id">[]): Map<string, number> {
  const held = new Map<string, number>();
  for (const t of teams) if (t.panel_id) held.set(t.panel_id, (held.get(t.panel_id) ?? 0) + 1);
  return held;
}

/** The roster's names on a panel, for the card's read-only "Judges" line. */
export const panelJudges = (panelId: string, judges: Pick<JudgeRow, "name" | "panel_id">[]): string[] =>
  judges.filter((j) => j.panel_id === panelId).map((j) => j.name);

/* ---- booking slots ---------------------------------------------------------- */

/** The slot dialog offers this many days for now; the store and API allow MAX_SLOT_DAYS. */
export const UI_MAX_DAYS = 2;

/** The card's one line: "Day 1 10:00–16:00 · Day 2 09:00–12:00 · 15 min", or "Booking slots off". */
export function slotsSummary(p: SlotFields): string {
  const days = panelDays(p);
  if (!slotTimes(p).length) return "Booking slots off";
  const spans = days.map((d, i) => `Day ${i + 1} ${bangkokClock(d.open_at)}–${bangkokClock(d.end_at)}`);
  return `${spans.join(" · ")} · ${p.slot_minutes} min`;
}

/** The slot dialog's heading, as the old details summary read: "Booking slots (8)" / "(off)". */
export function slotsHeader(p: SlotFields): string {
  const n = slotTimes(p).length;
  return `Booking slots ${n ? `(${n})` : "(off)"}`;
}

/** One day as the dialog edits it: Bangkok wall time, as the date and time inputs read it. */
export type DayDraft = { date: string; open: string; end: string; breakFrom: string | null; breakTo: string | null };
/** What "Save slots" sends. */
export type SlotDraft = { minutes: number; days: DayDraft[] };

export const startSlotDraft = (p: SlotFields): SlotDraft => ({
  minutes: p.slot_minutes,
  days: panelDays(p).map((d) => ({
    date: bangkokDay(d.open_at),
    open: bangkokClock(d.open_at),
    end: bangkokClock(d.end_at),
    breakFrom: d.break_from ? bangkokClock(d.break_from) : null,
    breakTo: d.break_to ? bangkokClock(d.break_to) : null,
  })),
});

// "" for a box that is empty or not a time: the server then says the times must be real.
const iso = (date: string, clock: string | null): string => {
  try {
    return (clock && date && isoOnDay(date, clock)) || "";
  } catch {
    return "";
  }
};

export const dayFromDraft = (d: DayDraft): SlotDay => ({
  open_at: iso(d.date, d.open),
  end_at: iso(d.date, d.end),
  break_from: d.breakFrom ? iso(d.date, d.breakFrom) : null,
  break_to: d.breakTo ? iso(d.date, d.breakTo) : null,
});

export const slotBody = (d: SlotDraft) => ({ slotMinutes: d.minutes, slotDays: d.days.map(dayFromDraft) });

const toMin = (clock: string): number => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const toClock = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** The next day, same hours as the last one (10:00–15:00 today when there is none). Unchanged at UI_MAX_DAYS. */
export function addDay(d: SlotDraft): SlotDraft {
  if (d.days.length >= UI_MAX_DAYS) return d;
  const last = d.days[d.days.length - 1];
  const lastMs = last ? new Date(`${last.date}T00:00:00Z`).getTime() : NaN;
  const next = Number.isNaN(lastMs) ? bangkokDay(new Date().toISOString()) : new Date(lastMs + 86_400_000).toISOString().slice(0, 10);
  const day: DayDraft = last ? { ...last, date: next } : { date: next, open: "10:00", end: "15:00", breakFrom: null, breakTo: null };
  return { ...d, days: [...d.days, day] };
}

export const removeDay = (d: SlotDraft, i: number): SlotDraft => ({ ...d, days: d.days.filter((_, j) => j !== i) });

/** 12:00–13:00 if that fits inside the day, else the hour in the middle of it. */
export function addBreak(day: DayDraft): DayDraft {
  const ok = /^\d\d:\d\d$/.test(day.open) && /^\d\d:\d\d$/.test(day.end);
  const [o, e] = ok ? [toMin(day.open), toMin(day.end)] : [0, 1440];
  if (o <= 720 && e >= 780) return { ...day, breakFrom: "12:00", breakTo: "13:00" };
  const from = Math.max(o, Math.min(Math.round((o + e) / 2 / 5) * 5 - 30, e - 60));
  return { ...day, breakFrom: toClock(from), breakTo: toClock(Math.min(e, from + 60)) };
}

/** Each day's slot count and last start ("15:45"), and the total. A day that is unfinished or wrong counts 0. */
export function draftCount(d: SlotDraft): { perDay: { count: number; last: string | null }[]; total: number } {
  const perDay = d.days.map((day) => {
    const one = { slot_days: [dayFromDraft(day)], slot_minutes: d.minutes, slot_start_at: null, slot_count: 0 };
    if ("error" in parseSlotDays(one.slot_days, d.minutes)) return { count: 0, last: null };
    const times = slotTimes(one);
    return { count: times.length, last: times.length ? bangkokClock(times[times.length - 1].start.toISOString()) : null };
  });
  return { perDay, total: perDay.reduce((n, x) => n + x.count, 0) };
}

/* ---- moving a judge --------------------------------------------------------- */

/** One team a move takes off the panel, with the note on the judge's conflict with it. */
export type TakeOffLine = { number: string; name: string | null; note: string | null };

/** The teams in `takenOff` (numbers, as the server reports them), each with its name and the judge's note. */
export function takeOffLines(
  judgeId: string,
  takenOff: string[],
  teams: Pick<Team, "id" | "number" | "name">[],
  conflicts: Pick<ConflictRow, "judge_id" | "team_id" | "note">[],
): TakeOffLine[] {
  return takenOff.map((number) => {
    const team = teams.find((t) => t.number === number);
    const theirs = team ? conflicts.find((x) => x.judge_id === judgeId && x.team_id === team.id) : undefined;
    return { number, name: team?.name ?? null, note: theirs?.note ?? null };
  });
}

/**
 * The words of "Add Priya Nair to Panel 3?". The judge's name stands where the
 * mock says "She/her": the roster does not record anyone's pronouns.
 */
export function takeOffCopy(judgeName: string, panelName: string, count: number) {
  const one = count === 1;
  return {
    title: `Add ${judgeName} to ${panelName}?`,
    lead: `${judgeName} has ${one ? "a conflict" : "conflicts"} with ${count} ${one ? "team" : "teams"} on ${panelName}. Adding ${judgeName} takes ${one ? "that team" : "them"} off it.`,
    caution: one ? "That team will need another panel." : "They’ll need another panel.",
    confirm: "Add and take teams off",
  };
}

/** What the confirm shows. */
export type TakeOffInfo = { judge: JudgeRow; panelName: string; lines: TakeOffLine[] };

/**
 * Move a judge to a panel ("" is — none —), looking before it saves.
 *
 *   1. PATCH /api/admin/judges { id, panelId, dryRun: true } -> { takenOff }
 *   2. takenOff not empty: `confirmTakeOff` -- No sends nothing more
 *   3. PATCH /api/admin/judges { id, panelId }
 *
 * The dry run is always sent, moving to — none — included (the server answers
 * an empty `takenOff` for it), so there is one path and no case where a move
 * skips the look. Returns whether the judge was moved.
 */
export async function moveJudge(
  send: typeof call,
  judge: Pick<JudgeRow, "id" | "panel_id">,
  panelId: string,
  confirmTakeOff: (takenOff: string[]) => Promise<boolean>,
): Promise<boolean> {
  if (panelId === (judge.panel_id ?? "")) return false;
  const body = { id: judge.id, panelId: panelId || null };
  const looked = await send<{ takenOff?: string[] }>("/api/admin/judges", { method: "PATCH", body: { ...body, dryRun: true } });
  const takenOff = looked.takenOff ?? [];
  if (takenOff.length && !(await confirmTakeOff(takenOff))) return false;
  await send("/api/admin/judges", { method: "PATCH", body });
  return true;
}

/** A move in the air: the judge's select shows `panelId` until the move is answered. */
export type PendingMove = { judgeId: string; panelId: string } | null;

/**
 * `moveJudge`, with the select following it: it shows where the judge is going
 * while the dry run and the question are open, and goes back to where the judge
 * is once the move is cancelled, refused, or done (`afterMove` -- redrawing the
 * roster -- runs first, so the select never flashes back to the old panel).
 */
export async function moveJudgeShowing(
  send: typeof call,
  judge: Pick<JudgeRow, "id" | "panel_id">,
  panelId: string,
  confirmTakeOff: (takenOff: string[]) => Promise<boolean>,
  show: (pending: PendingMove) => void,
  afterMove: () => Promise<void>,
): Promise<boolean> {
  show({ judgeId: judge.id, panelId });
  try {
    const moved = await moveJudge(send, judge, panelId, confirmTakeOff);
    if (moved) await afterMove();
    return moved;
  } finally {
    show(null);
  }
}

/* ---- the roster ------------------------------------------------------------- */

/** "Remove Jordan Kim from the roster?", and what goes with them if they have conflicts. */
export function removeJudgeQuestion(name: string, conflicts: number): string {
  const head = `Remove ${name} from the roster?`;
  const detail = conflicts ? `\n\nRemoving ${name} also withdraws ${conflictsLabel(conflicts)}.` : "";
  return `${head}${detail}\n\nIf they are on a panel, its shared code will change and everyone there will need to sign in again.`;
}

/** Ask, then remove the judge. A No sends nothing. Returns whether they were removed. */
export async function removeJudgeAfterAsking(
  ask: Ask,
  send: typeof call,
  judge: Pick<JudgeRow, "id" | "name">,
  conflicts: number,
): Promise<boolean> {
  if (!(await ask(removeJudgeQuestion(judge.name, conflicts), { confirmLabel: "Remove from roster", danger: true }))) return false;
  await send(`/api/admin/judges?id=${encodeURIComponent(judge.id)}`, { method: "DELETE" });
  return true;
}

/** "+ New judge": the roster only, so no panel is sent and the judge starts on — none —. */
export async function addJudge(send: typeof call, name: string, note: string): Promise<JudgeRow> {
  const made = await send<{ judge: JudgeRow }>("/api/admin/judges", { body: { name: name.trim(), note: note.trim() } });
  return made.judge;
}

/* ---- panels ----------------------------------------------------------------- */

/** Today's wording, kept: the teams are not moved, they are left without a panel. */
export const divisionQuestion = (panelName: string, division: string): string =>
  `Move ${panelName} to ${division}?\n\n` +
  "Its current teams stay in their own division and become unassigned, so you will need to give them to another panel.";

/** Ask, then save. A No sends nothing. */
export async function changeDivisionAfterAsking(
  ask: Ask,
  panelName: string,
  division: string,
  save: () => Promise<void>,
): Promise<boolean> {
  if (!(await ask(divisionQuestion(panelName, division), { confirmLabel: "Move division", danger: true }))) return false;
  await save();
  return true;
}

/** Today's wording, kept. The store leaves a deleted panel's judges on the roster with no panel (and their conflicts as they were), so the question speaks of teams only. */
export const deletePanelQuestion = (panelName: string): string => `Delete ${panelName}? Its teams become unassigned.`;

/** Ask, then delete the panel. A No sends nothing. Returns whether it was deleted. */
export async function deletePanelAfterAsking(
  ask: Ask,
  send: typeof call,
  panel: Pick<PublicPanel, "id" | "name">,
): Promise<boolean> {
  if (!(await ask(deletePanelQuestion(panel.name), { confirmLabel: "Delete panel", danger: true }))) return false;
  await send(`/api/admin/panels?id=${encodeURIComponent(panel.id)}`, { method: "DELETE" });
  return true;
}

/** The second click of "Delete all panels". */
export const deleteAllPanels = (send: typeof call) =>
  send<{ deleted: number }>("/api/admin/panels?all=true", { method: "DELETE" });

export const deletedAllNotice = (deleted: number): string =>
  `Deleted ${deleted} panel${deleted === 1 ? "" : "s"}. Teams are still here, now unassigned. Judges are still on the roster.`;
