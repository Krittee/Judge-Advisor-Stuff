import { kindCounts, type FlagKind } from "@/components/Flags";
import type { Ask } from "@/components/judge/logic";
import type { Rubric } from "@/lib/rubrics";
import type { AwardView, FlagRow, NominationRow, PublicPanel, Team, WinnerRow } from "@/lib/types";
import { teamCount } from "./floorLogic";
import { compareLines, type RankedRow } from "./scoresLogic";
import type { Call } from "./teamsLogic";

/* The Judge Advisor Awards board's decisions, kept out of the markup so they run
   as plain functions in tests/adminAwards.logic.test.mjs. Nothing here decides
   an award: the Judge Advisor does, and "already has another award" is a
   caution this file works out for the screen to show, never a rule that
   refuses. Scores are not worked out here either: the side panel's
   "Notebook 55/64" reads the Scores compare panel's own cells (`compareLines`). */

/* ---- what is on screen ------------------------------------------------------ */

/** The two ways to read one board. Remembered per viewer, in this browser. */
export type View = "matrix" | "award";

export const VIEW_KEY = "ja-awards-view";

type ViewStore = Pick<Storage, "getItem" | "setItem">;

/** The saved view; the matrix when nothing is saved or the browser will not say (private windows, blocked site data, no window at all). */
export function loadView(store?: ViewStore): View {
  try {
    return (store ?? localStorage).getItem(VIEW_KEY) === "award" ? "award" : "matrix";
  } catch {
    return "matrix";
  }
}

export function saveView(view: View, store?: ViewStore): void {
  try {
    (store ?? localStorage).setItem(VIEW_KEY, view);
  } catch {
    // Nothing to do: the choice just lasts until the page is closed.
  }
}

/** One nominee for one award: what the matrix cell and the By award row both open the side panel on. */
export type Sel = { awardId: string; teamId: string };

/** "" is every panel, combined. */
export const ALL_PANELS = "";

/** The division the board opens on: the first with a nomination in it, else the first there is. */
export function defaultDivision(divisions: string[], nominations: Pick<NominationRow, "team_id">[], teams: Pick<Team, "id" | "division">[]): string {
  const divisionOf = new Map(teams.map((t) => [t.id, t.division]));
  const nominated = new Set(nominations.map((n) => divisionOf.get(n.team_id)));
  return divisions.find((d) => nominated.has(d)) ?? divisions[0] ?? "";
}

/** The division chosen if it still exists, else the default: the rail's count and the board must agree on one. */
export function pickDivision(chosen: string | null, divisions: string[], nominations: Pick<NominationRow, "team_id">[], teams: Pick<Team, "id" | "division">[]): string {
  return chosen && divisions.includes(chosen) ? chosen : defaultDivision(divisions, nominations, teams);
}

/* ---- decided ----------------------------------------------------------------- */

/** One division's winners by award. */
export function winnersOf(winners: WinnerRow[], division: string): Map<string, WinnerRow> {
  return new Map(winners.filter((w) => w.division === division).map((w) => [w.award_id, w]));
}

/** How many of the config's awards a division has decided. A winner for an award the config has dropped has no row to show, so it is not counted. */
export function decidedCount(winners: WinnerRow[], awards: Pick<AwardView, "id">[], division: string): number {
  const decided = winnersOf(winners, division);
  return awards.filter((a) => decided.has(a.id)).length;
}

/** "3/11": the rail's count and a division chip's. */
export const decidedText = (winners: WinnerRow[], awards: Pick<AwardView, "id">[], division: string): string => `${decidedCount(winners, awards, division)}/${awards.length}`;

/** The awards a team holds in its division, in the config's order, other than `except`. */
export function alreadyHas(awards: AwardView[], decided: Map<string, WinnerRow>, teamId: string, except = ""): AwardView[] {
  return awards.filter((a) => a.id !== except && decided.get(a.id)?.team_id === teamId);
}

/* ---- the words ----------------------------------------------------------------- */

const byNumber = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

/** "Panel 2" is "P2"; a panel named anything else keeps its name. */
export function panelShort(name: string): string {
  const m = /^panel\s+(\S+)$/i.exec(name.trim());
  return m ? `P${m[1]}` : name.trim();
}

/** The tag a row wears: the panel (or panels) that nominated, "P2" or "P2/P3". A panel since deleted has no name to show. */
export function panelTagText(panelIds: (string | null)[], panels: Pick<PublicPanel, "id" | "name">[]): string {
  const tags = panelIds.flatMap((id) => {
    const name = panels.find((p) => p.id === id)?.name;
    return name ? [panelShort(name)] : [];
  });
  return tags.join("/") || "—";
}

export const judgesText = (n: number): string => (n === 0 ? "Withdrawn" : n === 1 ? "1 judge" : `${n} judges`);

export const nominationsText = (nominations: number, teams: number): string => `${nominations} ${nominations === 1 ? "nomination" : "nominations"} for ${teamCount(teams)}`;

const list = (words: string[]): string => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);

/** "Energy has no nominations yet, so its column is hidden." Under a panel it says whose nominations there are none of. Empty when nothing is hidden. */
export function hiddenNote(hidden: Pick<AwardView, "label">[], panelName: string | null): string {
  if (!hidden.length) return "";
  const one = hidden.length === 1;
  return `${list(hidden.map((a) => a.label))} ${one ? "has" : "have"} no nominations ${panelName ? `from ${panelName}` : "yet"}, so ${one ? "its column is" : "their columns are"} hidden.`;
}

/* ---- the nominations in view ---------------------------------------------------- */

/** The nominations of teams in this division, and when a panel is chosen only that panel's. */
export function nominationsIn(nominations: NominationRow[], teams: Pick<Team, "id" | "division">[], division: string, panelId = ALL_PANELS): NominationRow[] {
  const here = new Set(teams.filter((t) => t.division === division).map((t) => t.id));
  return nominations.filter((n) => here.has(n.team_id) && (!panelId || n.panel_id === panelId));
}

/** How many teams a set of nominations names. */
export const distinctTeams = (nominations: Pick<NominationRow, "team_id">[]): number => new Set(nominations.map((n) => n.team_id)).size;

export type PanelChip = { id: string; label: string; count: number };

/** "All panels" and one chip per panel in the division, each with the teams it nominated. */
export function panelChips(panels: Pick<PublicPanel, "id" | "name">[], inDivision: NominationRow[]): PanelChip[] {
  return [
    { id: ALL_PANELS, label: "All panels", count: distinctTeams(inDivision) },
    ...panels.map((p) => ({ id: p.id, label: p.name, count: distinctTeams(inDivision.filter((n) => n.panel_id === p.id)) })),
  ];
}

/** Nominations of one award grouped by team, the judges of each. */
function byTeam(nominations: NominationRow[]): Map<string, NominationRow[]> {
  const out = new Map<string, NominationRow[]>();
  for (const n of nominations) out.set(n.team_id, [...(out.get(n.team_id) ?? []), n]);
  return out;
}

/** The panels that nominated, each once, in the order they first appear. */
const panelIdsOf = (nominations: NominationRow[]): (string | null)[] => [...new Set(nominations.map((n) => n.panel_id))];

/* ---- the matrix ------------------------------------------------------------------- */

export type CellState = "none" | "nominated" | "winner";

export type MatrixRow = {
  team: Team;
  /** Nomination rows, one per judge per award: what the rows are sorted on. */
  count: number;
  tag: string;
  /** Awards the team holds, for "Has Amaze" in place of its name. */
  has: AwardView[];
  /** One per column. */
  cells: CellState[];
};

export type Matrix = { columns: { award: AwardView; decided: boolean }[]; rows: MatrixRow[]; hidden: AwardView[] };

/**
 * Only teams with a nomination are rows (most nominations first, then team
 * number) and only awards with one are columns. A winner counts even when no
 * judge is nominating the team any more: a judge can withdraw after the
 * Judge Advisor has decided, and the tick must not vanish with the dot. That
 * only holds for the combined view: a panel's view is that panel's nominations.
 */
export function buildMatrix(
  awards: AwardView[],
  nominations: NominationRow[],
  decided: Map<string, WinnerRow>,
  teams: Team[],
  panels: Pick<PublicPanel, "id" | "name">[],
  panelId = ALL_PANELS,
): Matrix {
  const keep = panelId ? [] : awards.filter((a) => decided.has(a.id));
  const nominated = new Set(nominations.map((n) => n.award_id));
  const columns = awards.filter((a) => nominated.has(a.id) || keep.includes(a)).map((award) => ({ award, decided: decided.has(award.id) }));

  const mine = byTeam(nominations);
  const winnerIds = new Set(keep.map((a) => decided.get(a.id)!.team_id));
  const rows = teams
    .filter((t) => mine.has(t.id) || winnerIds.has(t.id))
    .map((team): MatrixRow => {
      const own = mine.get(team.id) ?? [];
      return {
        team,
        count: own.length,
        tag: panelTagText(own.length ? panelIdsOf(own) : [team.panel_id], panels),
        has: alreadyHas(awards, decided, team.id),
        cells: columns.map(({ award }) =>
          decided.get(award.id)?.team_id === team.id ? "winner" : own.some((n) => n.award_id === award.id) ? "nominated" : "none",
        ),
      };
    })
    .sort((a, b) => b.count - a.count || byNumber(a.team.number, b.team.number));

  const shown = new Set(columns.map((c) => c.award.id));
  return { columns, rows, hidden: awards.filter((a) => !shown.has(a.id)) };
}

/* ---- by award ---------------------------------------------------------------------- */

export type Nominee = { team: Team; judges: number; tag: string; winner: boolean; has: AwardView[] };
export type AwardPanel = { award: AwardView; decided: boolean; status: string; nominees: Nominee[] };

/** Every award, in the config's order, with its nominees: the winner first, then the most judges, then team number. */
export function buildAwardPanels(
  awards: AwardView[],
  nominations: NominationRow[],
  decided: Map<string, WinnerRow>,
  teams: Team[],
  panels: Pick<PublicPanel, "id" | "name">[],
  panelId = ALL_PANELS,
): AwardPanel[] {
  return awards.map((award) => {
    const winnerId = decided.get(award.id)?.team_id ?? null;
    const mine = byTeam(nominations.filter((n) => n.award_id === award.id));
    const ids = new Set(mine.keys());
    // A winner nobody nominates any more still has to be seen to be cleared.
    if (winnerId && !panelId) ids.add(winnerId);

    const nominees = teams
      .filter((t) => ids.has(t.id))
      .map((team): Nominee => {
        const own = mine.get(team.id) ?? [];
        return {
          team,
          judges: own.length,
          tag: panelTagText(own.length ? panelIdsOf(own) : [team.panel_id], panels),
          winner: team.id === winnerId,
          has: alreadyHas(awards, decided, team.id, award.id),
        };
      })
      .sort((a, b) => Number(b.winner) - Number(a.winner) || b.judges - a.judges || byNumber(a.team.number, b.team.number));

    const k = nominees.length;
    return { award, decided: winnerId !== null, status: winnerId ? "Decided" : k ? `${k} ${k === 1 ? "nominee" : "nominees"}` : "Open", nominees };
  });
}

/* ---- the side panel ------------------------------------------------------------------- */

export type Detail = {
  award: AwardView;
  team: Team;
  /** Why each panel nominated the team, a panel at a time. */
  reasons: { key: string; panel: string; judges: { judge: string; reason: string | null }[] }[];
  /** Other awards the team is nominated for. */
  alsoFor: AwardView[];
  /** Other awards the team already holds: a caution, never a block. */
  has: AwardView[];
  /** The other teams in the running for this award in this division, and who holds it. */
  others: { team: Team; judges: number; winner: boolean; has: AwardView[] }[];
  isWinner: boolean;
  /** Who holds the award now, when it is not this team. */
  current: Team | null;
};

type Everything = {
  awards: AwardView[];
  nominations: NominationRow[];
  winners: WinnerRow[];
  teams: Team[];
  panels: Pick<PublicPanel, "id" | "name">[];
};

/** What the side panel shows for the picked nominee; null when the team or the award has since gone. Every panel's nominations count, whichever panel the board is filtered to. */
export function detailFor(sel: Sel, all: Everything): Detail | null {
  const award = all.awards.find((a) => a.id === sel.awardId);
  const team = all.teams.find((t) => t.id === sel.teamId);
  if (!award || !team) return null;

  const decided = winnersOf(all.winners, team.division);
  const here = nominationsIn(all.nominations, all.teams, team.division);
  const mine = here.filter((n) => n.team_id === team.id);

  const forThis = mine.filter((n) => n.award_id === award.id);
  const place = (id: string | null) => {
    const i = all.panels.findIndex((p) => p.id === id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const reasons = panelIdsOf(forThis)
    .sort((a, b) => place(a) - place(b))
    .map((id) => ({
      key: id ?? "gone",
      panel: all.panels.find((p) => p.id === id)?.name ?? "a removed panel",
      judges: forThis.filter((n) => n.panel_id === id).map((n) => ({ judge: n.judge, reason: n.reason })).sort((a, b) => a.judge.localeCompare(b.judge)),
    }));

  const holder = decided.get(award.id)?.team_id ?? null;
  const rivals = byTeam(here.filter((n) => n.award_id === award.id && n.team_id !== team.id));
  if (holder && holder !== team.id && !rivals.has(holder)) rivals.set(holder, []);
  const others = all.teams
    .filter((t) => rivals.has(t.id))
    .map((t) => ({ team: t, judges: rivals.get(t.id)!.length, winner: t.id === holder, has: alreadyHas(all.awards, decided, t.id, award.id) }))
    .sort((a, b) => Number(b.winner) - Number(a.winner) || b.judges - a.judges || byNumber(a.team.number, b.team.number));

  return {
    award,
    team,
    reasons,
    alsoFor: all.awards.filter((a) => a.id !== award.id && mine.some((n) => n.award_id === a.id)),
    has: alreadyHas(all.awards, decided, team.id, award.id),
    others,
    isWinner: holder === team.id,
    current: holder && holder !== team.id ? (all.teams.find((t) => t.id === holder) ?? null) : null,
  };
}

/** "Already has Amaze" / "Already has Amaze, Think". */
export const hasText = (has: Pick<AwardView, "label">[]): string => `Already has ${has.map((a) => a.label).join(", ")}`;

/** "Has Amaze": what the matrix row says in place of the team's name once it has won. */
export const holdsText = (has: Pick<AwardView, "label">[]): string => `Has ${has.map((a) => a.label).join(", ")}`;

/** What a team's referee flags say beside a nomination: Good conduct in green, the worst of the rest in amber. Neither: "No referee flags". */
export function refereeLine(flags: FlagRow[], kinds: FlagKind[]): { good: string | null; caution: string | null } {
  const counts = kindCounts(flags, kinds);
  const say = (c?: (typeof counts)[number]) => (c ? `${c.kind.label} ×${c.count}` : null);
  return { good: say(counts.find((c) => c.kind.id === "good")), caution: say(counts.find((c) => c.kind.id !== "good")) };
}

/** "Notebook 55/64", "Interview 11/12" and the total, from the ranked row the Scores tab draws. Nothing before the scores have loaded. */
export function scoreParts(row: RankedRow | undefined, rubricList: Rubric[]): { parts: { label: string; text: string }[]; total: string | null } | null {
  if (!row) return null;
  const parts = compareLines(row, row, rubricList).flatMap((l) => {
    const [c] = l.cells;
    if (l.level !== "rubric" || c.kind === "excluded") return [];
    return [{ label: l.label, text: c.kind === "value" ? `${c.got}/${c.max}` : "not scored" }];
  });
  return { parts, total: row.scored ? `${row.total}/${row.max}` : null };
}

/* ---- giving and clearing ----------------------------------------------------------------- */

/** "Give Design to 7700B instead of 2088C?" */
export const giveQuestion = (award: Pick<AwardView, "label">, team: Pick<Team, "number">, current: Pick<Team, "number">): string =>
  `Give ${award.label} to ${team.number} instead of ${current.number}?`;

export const clearQuestion = (award: Pick<AwardView, "label">, team: Pick<Team, "number">): string => `Clear ${award.label}? ${team.number} will no longer be the winner.`;

/** Give the award, asking first only when it takes it from another team. Nothing is sent on a no. Returns whether it sent. */
export async function giveAfterAsking(ask: Ask, call: Call, pick: { award: AwardView; team: Team; current: Team | null }): Promise<boolean> {
  const { award, team, current } = pick;
  if (current && !(await ask(giveQuestion(award, team, current), { confirmLabel: "Replace winner" }))) return false;
  await call("/api/awards/winners", { method: "PUT", body: { awardId: award.id, division: team.division, teamId: team.id } });
  return true;
}

/** Take the award back off its winner, asked first. Returns whether it sent. */
export async function clearAfterAsking(ask: Ask, call: Call, pick: { award: AwardView; team: Team }): Promise<boolean> {
  const { award, team } = pick;
  if (!(await ask(clearQuestion(award, team), { confirmLabel: "Clear winner" }))) return false;
  await call("/api/awards/winners", { method: "DELETE", body: { awardId: award.id, division: team.division } });
  return true;
}
