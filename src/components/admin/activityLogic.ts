import { kindOf, type FlagKind } from "@/components/Flags";
import type { ActivityKind, ActivityRow, Team } from "@/lib/types";
import { dotClass } from "./refereeLogic";

/* The Judge Advisor Activity tab's decisions, kept out of the markup so they run
   as plain functions in tests/adminActivity.logic.test.mjs. The order is never
   decided here: the API sends the latest entries newest first, and the
   timeline reads them that way. */

/** How many entries the API sends (listActivity's default): the footer says so once the log is that long. */
export const ACTIVITY_LIMIT = 150;

/* ---- polling ---------------------------------------------------------------- */

/** What the tab has to show: the last good log, when it came, and whether the poll since then failed. */
export type Poll = { rows: ActivityRow[]; updatedAt: string | null; error: string | null };

export const NO_POLL: Poll = { rows: [], updatedAt: null, error: null };

/**
 * One poll's answer folded into what the tab shows. A failure keeps the last
 * good rows and the time they came, so the banner can sit above them; the next
 * success is the recovery and clears it.
 */
export function polled(prev: Poll, answer: { rows: ActivityRow[] } | { error: string }, now: Date): Poll {
  return "error" in answer ? { ...prev, error: answer.error } : { rows: answer.rows, updatedAt: now.toISOString(), error: null };
}

/* ---- the clock and the words around it ---------------------------------------- */

const two = (n: number): string => String(n).padStart(2, "0");

/** "11:42", 24-hour, in the viewer's own time. */
export function clockText(iso: string): string {
  const at = new Date(iso);
  return `${two(at.getHours())}:${two(at.getMinutes())}`;
}

export const updatedText = (iso: string): string => `Updated ${clockText(iso)} · refreshes every 10 s`;

/** The caution banner: above the last good log once a poll fails; before there is one, the reason alone. */
export const bannerText = (poll: Pick<Poll, "updatedAt" | "error">): string =>
  poll.updatedAt ? `Couldn't refresh — showing what we had at ${clockText(poll.updatedAt)}` : `Couldn't load the log — ${poll.error}`;

export const eventsText = (n: number): string => (n === 1 ? "1 event" : `${n} events`);

/** The footer: the latest 150 once the log is that long, the whole of it before. */
export const footText = (loaded: number): string => (loaded >= ACTIVITY_LIMIT ? `Showing the latest ${ACTIVITY_LIMIT} events` : `Showing all ${eventsText(loaded)}`);

/* ---- who did it -------------------------------------------------------------- */

type Actor = Pick<ActivityRow, "actor" | "actor_role">;

const sameWord = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The name to show. When the role is the same word ("team" / "Team") it is the role's capitals. */
export const actorName = (r: Actor): string => (r.actor_role && sameWord(r.actor, r.actor_role) ? r.actor_role : r.actor);

/** The role to show beside the name; null when there is none or it only repeats the name. */
export const shownRole = (r: Actor): string | null => (r.actor_role && !sameWord(r.actor, r.actor_role) ? r.actor_role : null);

/** "Priya Nair · Panel 2", or just "Front desk": what the Who select lists and filters on. */
export function whoLabel(r: Actor): string {
  const role = shownRole(r);
  return role ? `${r.actor} · ${role}` : actorName(r);
}

/** The actors present, by name. The one chosen stays listed after its entries have left the latest 150, so the select still shows what filters the log. */
export function whoOptions(rows: Actor[], chosen = ""): string[] {
  const labels = new Set(rows.map(whoLabel));
  if (chosen) labels.add(chosen);
  return [...labels].sort((a, b) => a.localeCompare(b));
}

/* ---- the filters ------------------------------------------------------------ */

export type KindFilter = "all" | ActivityKind;
/** `kind` "all", `team` "" and `who` "" are each off. */
export type ActivityFilters = { kind: KindFilter; team: string; who: string };

export const NO_FILTERS: ActivityFilters = { kind: "all", team: "", who: "" };

export const KIND_CHIPS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "request", label: "Requests" },
  { id: "referee", label: "Referee" },
  { id: "conflict", label: "Conflicts" },
  { id: "setup", label: "Setup" },
  { id: "award", label: "Awards" },
];

/** What the dot's screen-reader text says. */
export const KIND_NAMES: Record<ActivityKind, string> = { request: "Requests", referee: "Referee", conflict: "Conflicts", setup: "Setup", award: "Awards" };

/** How many loaded entries each kind chip stands for. The other two filters do not change them. */
export function chipCounts(rows: Pick<ActivityRow, "kind">[]): Record<KindFilter, number> {
  const counts: Record<KindFilter, number> = { all: rows.length, request: 0, referee: 0, conflict: 0, setup: 0, award: 0 };
  for (const r of rows) counts[r.kind]++;
  return counts;
}

/** Narrows the loaded entries: all three filters at once. The team search matches inside the number, in any case. */
export function filterRows(rows: ActivityRow[], f: ActivityFilters): ActivityRow[] {
  const q = f.team.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (f.kind === "all" || r.kind === f.kind) &&
      (!q || (r.team_number ?? "").toLowerCase().includes(q)) &&
      (!f.who || whoLabel(r) === f.who),
  );
}

/* ---- the hours ---------------------------------------------------------------- */

export type HourGroup = { key: string; label: string; count: string; rows: ActivityRow[] };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayKey = (at: Date): string => `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`;

/** Whether the entries come from more than one day: then each hour says which. */
export const spansDays = (rows: Pick<ActivityRow, "created_at">[]): boolean => new Set(rows.map((r) => dayKey(new Date(r.created_at)))).size > 1;

/**
 * The entries grouped by the hour they happened in, in the order they come:
 * newest first gives the newest hour first. "11:00–11:59 · 7 events".
 */
export function hourGroups(rows: ActivityRow[], withDate = false): HourGroup[] {
  const hours = new Map<string, { at: Date; rows: ActivityRow[] }>();
  for (const r of rows) {
    const at = new Date(r.created_at);
    const key = `${dayKey(at)}-${at.getHours()}`;
    const hour = hours.get(key);
    if (hour) hour.rows.push(r);
    else hours.set(key, { at, rows: [r] });
  }
  return [...hours].map(([key, { at, rows }]) => {
    const range = `${two(at.getHours())}:00–${two(at.getHours())}:59`;
    return { key, label: withDate ? `${DAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]} · ${range}` : range, count: eventsText(rows.length), rows };
  });
}

/* ---- what an entry says -------------------------------------------------------- */

export type ActionPart = { text: string } | { flag: string };

/** "flagged minor", "corrected a flag: warning → minor", "removed a flag: minor": the flag kinds inside. The referee routes write them as the kind's id. */
const FLAG_ACTION = /^(flagged |corrected a flag: |removed a flag: )(\S+)(?: → (\S+))?$/;

/** An action as text and flag-kind ids in turn, so the ids can be drawn as the severity pills. */
export function actionParts(action: string): ActionPart[] {
  const m = FLAG_ACTION.exec(action);
  if (!m) return [{ text: action }];
  return [{ text: m[1] }, { flag: m[2] }, ...(m[3] ? [{ text: " → " }, { flag: m[3] }] : [])];
}

/** The severity an entry names: the last kind in its action, so a correction takes the one it corrected to. Null when it names none the config still has. */
export function namedFlag(action: string, kinds: FlagKind[]): FlagKind | null {
  const ids = actionParts(action).flatMap((p) => ("flag" in p ? [p.flag] : []));
  return kindOf(ids[ids.length - 1] ?? "", kinds);
}

/** The timeline dot's classes: a request is neutral ink, a conflict caution, a setup an accent outline, an award the green of a winner, and a referee entry the colour of the severity it names (neutral when it names none). */
export function dotFor(r: Pick<ActivityRow, "kind" | "action">, kinds: FlagKind[]): string {
  if (r.kind !== "referee") return `ja-ac-d-${r.kind}`;
  return `ja-ac-d-referee ${dotClass(namedFlag(r.action, kinds)?.color ?? "zinc")}`;
}

/** The team an entry names, if it is still on the roster: its chip opens that team's sheet. An entry naming several teams, or none, has no team_id. */
export const teamOf = (r: Pick<ActivityRow, "team_id">, teams: Team[]): Team | null => (r.team_id ? (teams.find((t) => t.id === r.team_id) ?? null) : null);
