import { kindCounts, type FlagKind } from "@/components/Flags";
import type { Ask } from "@/components/judge/logic";
import { goodConductTeams, GOOD_CONDUCT, GOOD_CONDUCT_MIN, SPORTSMANSHIP } from "@/lib/awards";
import { matchReference } from "@/lib/match";
import { judgeKey } from "@/lib/roster";
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
   "Notebook 55/64" reads the Scores compare panel's own cells (`compareLines`).
   Referees do not nominate, but Good conduct flagged twice or more counts as a
   nomination for Sportsmanship (src/lib/awards.ts): such a team is drawn in
   green and has no judge to count. It belongs to no panel, so a panel's own
   view leaves it out.
   The Judge Advisor can nominate too (role "admin", no panel, "JA" on screen):
   it counts like a judge's nomination, and like the Good conduct one it belongs
   to no panel, so it shows under All panels only. */

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

/** Teams by number, 1234A before 7700B: the Add team picker's order. */
export const teamsByNumber = (teams: Team[]): Team[] => [...teams].sort((a, b) => byNumber(a.number, b.number));

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

/** The Judge Advisor, by the name the side panel's heading and the confirm question use. */
export const JA_NAME = "the Judge Advisor";

/** The key of the side panel's section for the Judge Advisor's own nomination: no panel to name it by. */
export const JA_KEY = "ja";

export const nominationsText = (nominations: number, teams: number): string => `${nominations} ${nominations === 1 ? "nomination" : "nominations"} for ${teamCount(teams)}`;

const list = (words: string[]): string => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);

/** "Energy has no nominations yet, so its column is hidden." Under a panel it says whose nominations there are none of. Empty when nothing is hidden. */
export function hiddenNote(hidden: Pick<AwardView, "label">[], panelName: string | null): string {
  if (!hidden.length) return "";
  const one = hidden.length === 1;
  return `${list(hidden.map((a) => a.label))} ${one ? "has" : "have"} no nominations ${panelName ? `from ${panelName}` : "yet"}, so ${one ? "its column is" : "their columns are"} hidden.`;
}

/* ---- the nominations in view ---------------------------------------------------- */

/** The nominations of teams in this division, and when a panel is chosen only that panel's (the Judge Advisor's have no panel, so a panel's view leaves them out). */
export function nominationsIn(nominations: NominationRow[], teams: Pick<Team, "id" | "division">[], division: string, panelId = ALL_PANELS): NominationRow[] {
  const here = new Set(teams.filter((t) => t.division === division).map((t) => t.id));
  return nominations.filter((n) => here.has(n.team_id) && (!panelId || n.panel_id === panelId));
}

/** How many teams a set of nominations names, and any further teams (the Good conduct ones) besides. */
export const distinctTeams = (nominations: Pick<NominationRow, "team_id">[], more: Iterable<string> = []): number =>
  new Set([...nominations.map((n) => n.team_id), ...more]).size;

/** The teams in this division that referees' Good conduct flags put up for Sportsmanship, with how many flags. None under a panel: no panel nominated them. */
export function conductIn(flags: Pick<FlagRow, "team_id" | "kind">[], teams: Pick<Team, "id" | "division">[], division: string, panelId = ALL_PANELS): Map<string, number> {
  if (panelId) return new Map();
  const here = new Set(teams.filter((t) => t.division === division).map((t) => t.id));
  return new Map([...goodConductTeams(flags)].filter(([id]) => here.has(id)));
}

/** "Good conduct ×3". */
export const conductText = (n: number): string => `Good conduct ×${n}`;

/** "Good conduct ×2+": the matrix key's words for the green dot. */
export const conductKeyText = `${conductText(GOOD_CONDUCT_MIN)}+`;

/**
 * What backs a nominee: its judges, the Judge Advisor ("1 judge · JA", or "JA" alone) and, for
 * Sportsmanship, its Good conduct flags. A team with flags alone has no judges to count, and says
 * nothing of them. `jaWord` is what the Judge Advisor is called: short on the screen, in full for a screen reader.
 */
export function backing(judges: number, conduct: number, ja = 0, jaWord = "JA"): { judges: string | null; conduct: string | null } {
  const who = [judges || (!conduct && !ja) ? judgesText(judges) : null, ja ? jaWord : null].filter(Boolean).join(" · ");
  return { judges: who || null, conduct: conduct ? conductText(conduct) : null };
}

/** The same in full words, for a label. */
export const backingText = (judges: number, conduct: number, ja = 0): string => Object.values(backing(judges, conduct, ja, "Judge Advisor")).filter(Boolean).join(", ");

/** One Good conduct flag in the side panel: who saw it and at which match. */
export const conductLine = (f: Pick<FlagRow, "author" | "match_type" | "match_number">): string =>
  [f.author, matchReference(f.match_type, f.match_number)].filter(Boolean).join(" · ");

export type PanelChip = { id: string; label: string; count: number };

/** "All panels" and one chip per panel in the division, each with the teams it nominated. */
export function panelChips(panels: Pick<PublicPanel, "id" | "name">[], inDivision: NominationRow[], conduct: Map<string, number> = new Map()): PanelChip[] {
  return [
    { id: ALL_PANELS, label: "All panels", count: distinctTeams(inDivision, conduct.keys()) },
    ...panels.map((p) => ({ id: p.id, label: p.name, count: distinctTeams(inDivision.filter((n) => n.panel_id === p.id)) })),
  ];
}

/**
 * One row per judge per award per team per panel. A judge's name is compared as
 * the roster compares it, so "Dana" and "dana" are one judge, not two: the store
 * keeps them to one row now, and this is for rows written before it did.
 */
function onePerJudge(nominations: NominationRow[]): NominationRow[] {
  const seen = new Set<string>();
  return nominations.filter((n) => {
    const key = [n.award_id, n.team_id, n.role, n.panel_id, judgeKey(n.judge)].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Nominations grouped by team, the judges of each. */
function byTeam(nominations: NominationRow[]): Map<string, NominationRow[]> {
  const out = new Map<string, NominationRow[]>();
  for (const n of onePerJudge(nominations)) out.set(n.team_id, [...(out.get(n.team_id) ?? []), n]);
  return out;
}

/** The panels that nominated, each once, in the order they first appear. The Judge Advisor is no panel. */
const panelIdsOf = (nominations: NominationRow[]): (string | null)[] => [...new Set(nominations.filter((n) => n.role === "judge").map((n) => n.panel_id))];

/** How many of these nominations are judges', and how many the Judge Advisor's. */
const whoMade = (nominations: NominationRow[]): { judges: number; ja: number } => {
  const ja = nominations.filter((n) => n.role === "admin").length;
  return { judges: nominations.length - ja, ja };
};

/** The tag a team's row wears: the panels that nominated it, or when only the Judge Advisor (or referees) did, its own panel. */
const tagOf = (own: NominationRow[], team: Pick<Team, "panel_id">, panels: Pick<PublicPanel, "id" | "name">[]): string => {
  const ids = panelIdsOf(own);
  return panelTagText(ids.length ? ids : [team.panel_id], panels);
};

/* ---- the matrix ------------------------------------------------------------------- */

/** "conduct" is a nomination only referees' Good conduct flags make. */
export type CellState = "none" | "nominated" | "conduct" | "winner";

export type MatrixRow = {
  team: Team;
  /** Nomination rows, one per judge (or Judge Advisor) per award, and one for Good conduct when nobody else nominated for Sportsmanship: what the rows are sorted on. */
  count: number;
  /** Good conduct flags, when they put the team up for Sportsmanship. */
  conduct: number;
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
  conduct: Map<string, number> = new Map(),
): Matrix {
  const keep = panelId ? [] : awards.filter((a) => decided.has(a.id));
  const nominated = new Set(nominations.map((n) => n.award_id));
  if (conduct.size) nominated.add(SPORTSMANSHIP);
  const columns = awards.filter((a) => nominated.has(a.id) || keep.includes(a)).map((award) => ({ award, decided: decided.has(award.id) }));

  const mine = byTeam(nominations);
  const winnerIds = new Set(keep.map((a) => decided.get(a.id)!.team_id));
  const rows = teams
    .filter((t) => mine.has(t.id) || winnerIds.has(t.id) || conduct.has(t.id))
    .map((team): MatrixRow => {
      const own = mine.get(team.id) ?? [];
      const flagged = conduct.get(team.id) ?? 0;
      const byJudge = (awardId: string) => own.some((n) => n.award_id === awardId);
      return {
        team,
        count: own.length + (flagged && !byJudge(SPORTSMANSHIP) ? 1 : 0),
        conduct: flagged,
        tag: tagOf(own, team, panels),
        has: alreadyHas(awards, decided, team.id),
        cells: columns.map(({ award }) =>
          decided.get(award.id)?.team_id === team.id ? "winner" : byJudge(award.id) ? "nominated" : award.id === SPORTSMANSHIP && flagged ? "conduct" : "none",
        ),
      };
    })
    .sort((a, b) => b.count - a.count || byNumber(a.team.number, b.team.number));

  const shown = new Set(columns.map((c) => c.award.id));
  return { columns, rows, hidden: awards.filter((a) => !shown.has(a.id)) };
}

/* ---- by award ---------------------------------------------------------------------- */

export type Nominee = { team: Team; judges: number; /** The Judge Advisor's nominations of it: 0 or 1. */ ja: number; /** Good conduct flags, on Sportsmanship only. */ conduct: number; tag: string; winner: boolean; has: AwardView[] };
/** `ja` is the teams (by id) the Judge Advisor has put up for this award, which the Add team picker marks as added. */
export type AwardPanel = { award: AwardView; decided: boolean; status: string; nominees: Nominee[]; ja: Set<string> };

/** Every award, in the config's order, with its nominees: the winner first, then the most nominations (judges and the Judge Advisor), then team number. */
export function buildAwardPanels(
  awards: AwardView[],
  nominations: NominationRow[],
  decided: Map<string, WinnerRow>,
  teams: Team[],
  panels: Pick<PublicPanel, "id" | "name">[],
  panelId = ALL_PANELS,
  conduct: Map<string, number> = new Map(),
): AwardPanel[] {
  return awards.map((award) => {
    const winnerId = decided.get(award.id)?.team_id ?? null;
    const mine = byTeam(nominations.filter((n) => n.award_id === award.id));
    const flagged = award.id === SPORTSMANSHIP ? conduct : new Map<string, number>();
    const ids = new Set([...mine.keys(), ...flagged.keys()]);
    // A winner nobody nominates any more still has to be seen to be cleared.
    if (winnerId && !panelId) ids.add(winnerId);

    const nominees = teams
      .filter((t) => ids.has(t.id))
      .map((team): Nominee => {
        const own = mine.get(team.id) ?? [];
        return {
          team,
          ...whoMade(own),
          conduct: flagged.get(team.id) ?? 0,
          tag: tagOf(own, team, panels),
          winner: team.id === winnerId,
          has: alreadyHas(awards, decided, team.id, award.id),
        };
      })
      .sort((a, b) => Number(b.winner) - Number(a.winner) || b.judges + b.ja - (a.judges + a.ja) || byNumber(a.team.number, b.team.number));

    const k = nominees.length;
    const ja = new Set(nominations.filter((n) => n.award_id === award.id && n.role === "admin").map((n) => n.team_id));
    return { award, decided: winnerId !== null, status: winnerId ? "Decided" : k ? `${k} ${k === 1 ? "nominee" : "nominees"}` : "Open", nominees, ja };
  });
}

/* ---- the side panel ------------------------------------------------------------------- */

export type Detail = {
  award: AwardView;
  team: Team;
  /** Why each panel nominated the team, a panel at a time, and last (key JA_KEY) the Judge Advisor's own. `id` is the nomination, for Remove. */
  reasons: { key: string; panel: string; judges: { id: string; judge: string; reason: string | null }[] }[];
  /** The Good conduct flags that put the team up for Sportsmanship; empty for any other award, or short of enough of them. */
  conduct: FlagRow[];
  /** Other awards the team is nominated for. */
  alsoFor: AwardView[];
  /** Whether anyone still nominates the team for this award: a judge, the Judge Advisor, or (Sportsmanship) enough Good conduct flags. The server refuses a winner who is not, so the panel offers no Give when it is false. */
  nominated: boolean;
  /** Awards the Judge Advisor has not yet nominated the team for: what "Also nominate for…" offers. */
  addable: AwardView[];
  /** Other awards the team already holds: a caution, never a block. */
  has: AwardView[];
  /** The other teams in the running for this award in this division, and who holds it. */
  others: { team: Team; judges: number; ja: number; conduct: number; winner: boolean; has: AwardView[] }[];
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
  /** Every team's referee flags. */
  flags?: FlagRow[];
};

/** What the side panel shows for the picked nominee; null when the team or the award has since gone. Every panel's nominations count, whichever panel the board is filtered to. */
export function detailFor(sel: Sel, all: Everything): Detail | null {
  const award = all.awards.find((a) => a.id === sel.awardId);
  const team = all.teams.find((t) => t.id === sel.teamId);
  if (!award || !team) return null;

  const decided = winnersOf(all.winners, team.division);
  const here = nominationsIn(all.nominations, all.teams, team.division);
  const mine = onePerJudge(here.filter((n) => n.team_id === team.id));

  const forThis = mine.filter((n) => n.award_id === award.id);
  const place = (id: string | null) => {
    const i = all.panels.findIndex((p) => p.id === id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const line = (n: NominationRow) => ({ id: n.id, judge: n.judge, reason: n.reason });
  const byName = (a: { judge: string }, b: { judge: string }) => a.judge.localeCompare(b.judge);
  const reasons = panelIdsOf(forThis)
    .sort((a, b) => place(a) - place(b))
    .map((id) => ({
      key: id ?? "gone",
      panel: all.panels.find((p) => p.id === id)?.name ?? "a removed panel",
      judges: forThis.filter((n) => n.role === "judge" && n.panel_id === id).map(line).sort(byName),
    }));
  const byJa = forThis.filter((n) => n.role === "admin");
  if (byJa.length) reasons.push({ key: JA_KEY, panel: JA_NAME, judges: byJa.map(line).sort(byName) });

  const flagsAll = all.flags ?? [];
  const conductAll = conductIn(flagsAll, all.teams, team.division);
  const flagged = award.id === SPORTSMANSHIP ? conductAll : new Map<string, number>();

  const holder = decided.get(award.id)?.team_id ?? null;
  const rivals = byTeam(here.filter((n) => n.award_id === award.id && n.team_id !== team.id));
  if (holder && holder !== team.id && !rivals.has(holder)) rivals.set(holder, []);
  for (const id of flagged.keys()) if (id !== team.id && !rivals.has(id)) rivals.set(id, []);
  const others = all.teams
    .filter((t) => rivals.has(t.id))
    .map((t) => ({ team: t, ...whoMade(rivals.get(t.id)!), conduct: flagged.get(t.id) ?? 0, winner: t.id === holder, has: alreadyHas(all.awards, decided, t.id, award.id) }))
    .sort((a, b) => Number(b.winner) - Number(a.winner) || b.judges + b.ja - (a.judges + a.ja) || byNumber(a.team.number, b.team.number));

  const conduct = flagged.has(team.id) ? flagsAll.filter((f) => f.team_id === team.id && f.kind === GOOD_CONDUCT) : [];
  return {
    award,
    team,
    reasons,
    conduct,
    nominated: reasons.length > 0 || conduct.length > 0,
    alsoFor: all.awards.filter((a) => a.id !== award.id && (mine.some((n) => n.award_id === a.id) || (a.id === SPORTSMANSHIP && conductAll.has(team.id)))),
    addable: all.awards.filter((a) => !mine.some((n) => n.award_id === a.id && n.role === "admin")),
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

/** The Judge Advisor nominates a team for an award: no question, since Remove undoes it. Returns whether it sent. */
export async function nominateAsAdmin(call: Call, pick: { awardId: string; teamId: string }): Promise<boolean> {
  await call("/api/awards", { method: "POST", body: { awardId: pick.awardId, teamId: pick.teamId } });
  return true;
}

/** "Remove Priya Nair's Excellence nomination for 7700B?" `by` is the nominator's name, or JA_NAME. */
export const removeQuestion = (by: string, award: Pick<AwardView, "label">, team: Pick<Team, "number">): string => `Remove ${by}'s ${award.label} nomination for ${team.number}?`;

/** Take one nomination away, a judge's or the Judge Advisor's own, asked first. Returns whether it sent. */
export async function removeAfterAsking(ask: Ask, call: Call, pick: { id: string; by: string; award: AwardView; team: Team }): Promise<boolean> {
  if (!(await ask(removeQuestion(pick.by, pick.award, pick.team), { confirmLabel: "Remove nomination", danger: true }))) return false;
  await call("/api/awards", { method: "DELETE", body: { id: pick.id } });
  return true;
}

/** Take the award back off its winner, asked first. Returns whether it sent. */
export async function clearAfterAsking(ask: Ask, call: Call, pick: { award: AwardView; team: Team }): Promise<boolean> {
  const { award, team } = pick;
  if (!(await ask(clearQuestion(award, team), { confirmLabel: "Clear winner" }))) return false;
  await call("/api/awards/winners", { method: "DELETE", body: { awardId: award.id, division: team.division } });
  return true;
}
