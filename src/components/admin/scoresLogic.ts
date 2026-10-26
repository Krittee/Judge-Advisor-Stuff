import { kindCounts, type FlagKind } from "@/components/Flags";
import { sectionMax } from "@/components/judge/logic";
import type { RankedTeam } from "@/lib/ranking";
import type { Rubric } from "@/lib/rubrics";
import type { FlagRow, PublicPanel } from "@/lib/types";
import { teamCount } from "./floorLogic";

/* The Judge Advisor Scores tab's decisions, kept out of the markup so they run
   as plain functions in tests/adminScores.logic.test.mjs. The order is never
   decided here: it is `rankTeams` (src/lib/ranking.ts), the one the judge
   console ranks with too. */

/* ---- the ranked list ------------------------------------------------------- */

/** A ranked team with its place in the whole event; null while unscored, which the list draws as "—". */
export type RankedRow = RankedTeam & { rank: number | null };

/** `rankTeams` puts the scored teams first, so a place is just the count so far. Done before any filter, so a filtered list keeps the event-wide numbers. */
export function withRanks(ranked: RankedTeam[]): RankedRow[] {
  let place = 0;
  return ranked.map((r) => ({ ...r, rank: r.scored ? ++place : null }));
}

/** "" is All. */
export type ScoreFilters = { category: string; division: string };

export const NO_SCORE_FILTERS: ScoreFilters = { category: "", division: "" };

/** How many of the two filters are on: the phone's Filters badge. */
export const activeScoreFilters = (f: ScoreFilters): number => (f.category ? 1 : 0) + (f.division ? 1 : 0);

/** Narrows the list. The rows keep their `rank`. */
export function filterRows(rows: RankedRow[], f: ScoreFilters): RankedRow[] {
  return rows.filter((r) => (!f.category || r.team.category === f.category) && (!f.division || r.team.division === f.division));
}

/** "Showing 12 teams". The scored count beside it is the whole event's: the ranks are. */
export const showingText = (shown: number): string => `Showing ${teamCount(shown)}`;

/** "9 of 48 scored", over the whole event. */
export const scoredText = (rows: Pick<RankedTeam, "scored">[]): string => `${rows.filter((r) => r.scored).length} of ${rows.length} scored`;

/* ---- picking two ------------------------------------------------------------ */

export const COMPARE_MAX = 2;
export const COMPARE_FULL = "Compare two at a time";
export const COMPARE_HINT = "Tick two teams to compare them";

/** Ticks a team, or un-ticks it. A third is refused: the list holds at most two. */
export function togglePick(picked: string[], id: string): string[] {
  if (picked.includes(id)) return picked.filter((p) => p !== id);
  return picked.length < COMPARE_MAX ? [...picked, id] : picked;
}

/** Why a row's checkbox is off, or null when it can be ticked. A ticked one can always be un-ticked. */
export function pickBlocker(picked: string[], row: Pick<RankedRow, "team" | "scored">): string | null {
  if (picked.includes(row.team.id)) return null;
  if (!row.scored) return "Not scored yet, so there is nothing to compare";
  return picked.length >= COMPARE_MAX ? COMPARE_FULL : null;
}

/** The ticks that still name a scored team (clearing a team's scores from its sheet un-scores it), oldest first. */
export function livePicks(picked: string[], rows: Pick<RankedRow, "team" | "scored">[]): string[] {
  return picked.filter((id) => rows.some((r) => r.team.id === id && r.scored));
}

/* ---- the compare panel ------------------------------------------------------ */

export type Cell =
  | { kind: "value"; got: number; max: number }
  /** The rubric is out of scope for this team's notebook. */
  | { kind: "excluded" }
  /** In scope, but nothing marked yet. */
  | { kind: "unscored" };

export type CompareLine = {
  id: string;
  label: string;
  level: "total" | "rubric" | "section";
  cells: [Cell, Cell];
  /** Which side has the higher value, for the bold; null on a tie, or when either side has no value. */
  higher: 0 | 1 | null;
};

/** The side with the higher value. A tie, or a side with nothing to compare, is nobody's. */
export function higherSide(a: Cell, b: Cell): 0 | 1 | null {
  if (a.kind !== "value" || b.kind !== "value" || a.got === b.got) return null;
  return a.got > b.got ? 0 : 1;
}

const line = (id: string, label: string, level: CompareLine["level"], cells: [Cell, Cell]): CompareLine => ({
  id,
  label,
  level,
  cells,
  higher: higherSide(cells[0], cells[1]),
});

/** The total row: points, not share, as the ranking is. */
export function totalLine(a: RankedRow, b: RankedRow): CompareLine {
  const cell = (r: RankedRow): Cell => ({ kind: "value", got: r.total, max: r.max });
  return line("total", "Total", "total", [cell(a), cell(b)]);
}

/** A rubric's cell for one team: its stored total, "excluded", or unscored. */
function rubricCell(row: RankedRow, rubric: Rubric): Cell {
  if (!row.applicable.some((r) => r.id === rubric.id)) return { kind: "excluded" };
  const score = row.perRubric.find((s) => s.rubric_id === rubric.id);
  if (!score || !Object.keys(score.values ?? {}).length) return { kind: "unscored" };
  return { kind: "value", got: score.total, max: rubric.max };
}

/**
 * One line per rubric, then one per section of it. A section's subtotal is
 * added up here from the score's `values` and the rubric's `sections` (the
 * judge's team sheet adds it the same way); the rubric's own line is the
 * stored total the ranking was worked from.
 */
export function compareLines(a: RankedRow, b: RankedRow, rubricList: Rubric[]): CompareLine[] {
  return rubricList.flatMap((rubric) => {
    const cells: [Cell, Cell] = [rubricCell(a, rubric), rubricCell(b, rubric)];
    const sections = rubric.sections.map((section) => {
      const side = (row: RankedRow, rubricSide: Cell): Cell => {
        if (rubricSide.kind !== "value") return rubricSide;
        const values = row.perRubric.find((s) => s.rubric_id === rubric.id)?.values ?? {};
        const got = section.criteria.reduce((sum, c) => sum + (Number(values[c.id]) || 0), 0);
        return { kind: "value", got, max: sectionMax(rubric, section.criteria.length) };
      };
      return line(`${rubric.id}:${section.name}`, section.name, "section", [side(a, cells[0]), side(b, cells[1])]);
    });
    return [line(rubric.id, rubric.name, "rubric", cells), ...sections];
  });
}

/** "81.6%": one decimal. */
export const percentText = (total: number, max: number): string => (max > 0 ? `${((total / max) * 100).toFixed(1)}%` : "—");

/** "Rank 2 · Panel 2". */
export function compareMeta(row: Pick<RankedRow, "team" | "rank">, panels: Pick<PublicPanel, "id" | "name">[]): string {
  const panel = row.team.panel_id ? (panels.find((p) => p.id === row.team.panel_id)?.name ?? "No panel") : "No panel";
  return `${row.rank ? `Rank ${row.rank}` : "Not ranked"} · ${panel}`;
}

/* ---- conduct --------------------------------------------------------------- */

export function flagsByTeam(flags: FlagRow[]): Map<string, FlagRow[]> {
  const byTeam = new Map<string, FlagRow[]>();
  for (const f of flags) byTeam.set(f.team_id, [...(byTeam.get(f.team_id) ?? []), f]);
  return byTeam;
}

/** The most serious thing a team was flagged with, and how many of that kind: the Referee tab's order (`kindCounts`, worst first). Null when nothing was flagged. */
export function worstConduct(flags: FlagRow[], kinds: FlagKind[]): { kind: FlagKind; count: number } | null {
  return kindCounts(flags, kinds)[0] ?? null;
}

/** "Warning ×2, Good ×1": every kind a team was flagged with, worst first. */
export const conductText = (flags: FlagRow[], kinds: FlagKind[]): string =>
  kindCounts(flags, kinds)
    .map(({ kind, count }) => `${kind.short} ×${count}`)
    .join(", ");

/* ---- notes ----------------------------------------------------------------- */

/** "3 notes". */
export const notesText = (n: number): string => (n === 0 ? "No notes" : n === 1 ? "1 note" : `${n} notes`);
