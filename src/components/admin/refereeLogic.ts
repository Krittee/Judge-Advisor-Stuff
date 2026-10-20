import { kindCounts, kindOf, type FlagKind } from "@/components/Flags";
import type { Ask } from "@/components/judge/logic";
import type { MatchDraft } from "@/components/MatchFields";
import { isValidFieldPick, MATCH_AFFECTING_KINDS, type FlagReport } from "@/lib/flagValidation";
import { isValidMatchNumber, matchReference, normalizeMatchNumber } from "@/lib/match";
import { isValidMatchType } from "@/lib/presets";
import { refereeHistory } from "@/lib/refereeHistory";
import { commonFieldRules, findMatchType, getRuleset, parseRuleList } from "@/lib/rules";
import { compareTeamNumbers } from "@/lib/teamNumber";
import { toneRail, toneSolid } from "@/lib/tone";
import type { FlagRow, PublicPanel, Team } from "@/lib/types";
import { divisionTag } from "./floorLogic";

/* The Judge Advisor Referee tab's decisions, kept out of the markup so they run
   as plain functions in tests/adminReferee.logic.test.mjs. What counts as a
   repeat is never decided here: it is read off `refereeHistory`, the same
   calculation the referee's own page warns with. */

/* ---- the list of flagged teams --------------------------------------------- */

/** A team that has been flagged, with its flags and the worst thing said about it. `team` is null once the team was removed. */
export type FlaggedTeam = { id: string; team: Team | null; flags: FlagRow[]; worst: FlagKind | null };

/**
 * One row per team with flags: worst severity first, then most flags. Ties go
 * by team number, so the list does not reshuffle between polls; a team that
 * was removed since sorts last.
 */
export function flaggedTeams(flags: FlagRow[], kinds: FlagKind[], teams: Team[]): FlaggedTeam[] {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const groups = new Map<string, FlagRow[]>();
  for (const f of flags) groups.set(f.team_id, [...(groups.get(f.team_id) ?? []), f]);

  return [...groups.entries()]
    .map(([id, own]): FlaggedTeam => ({
      id,
      team: teamById.get(id) ?? null,
      flags: own,
      worst: kindCounts(own, kinds)[0]?.kind ?? null,
    }))
    .sort(
      (a, b) =>
        (b.worst?.severity ?? -1) - (a.worst?.severity ?? -1) ||
        b.flags.length - a.flags.length ||
        (a.team && b.team ? compareTeamNumbers(a.team.number, b.team.number) : Number(!a.team) - Number(!b.team)),
    );
}

/** The count strip: every kind the config has, worst first, with how many flags each holds (none is a 0). */
export function severityTotals(flags: FlagRow[], kinds: FlagKind[]): { kind: FlagKind; count: number }[] {
  return [...kinds]
    .sort((a, b) => b.severity - a.severity)
    .map((kind) => ({ kind, count: flags.filter((f) => f.kind === kind.id).length }));
}

/* ---- which team is open ---------------------------------------------------- */

/** Which team is picked, and on a phone whether its history is open instead of the list. */
export type RefereeNav = { picked: string | null; open: boolean };

/** Arriving from Scores' conduct link opens that team; anything else starts on the list. */
export function startNav(focusTeamId: string | null | undefined): RefereeNav {
  return focusTeamId ? { picked: focusTeamId, open: true } : { picked: null, open: false };
}

export const pickTeam = (_nav: RefereeNav, id: string): RefereeNav => ({ picked: id, open: true });
export const goBack = (nav: RefereeNav): RefereeNav => ({ ...nav, open: false });

/**
 * The team whose history shows: the one picked, else the one Scores sent you
 * to, else the first row. A team that no longer has flags falls back to the
 * next choice, so the pane is never left on a team that is gone.
 */
export function selectedTeamId(rows: FlaggedTeam[], nav: RefereeNav, focusTeamId?: string | null): string | null {
  const has = (id: string | null | undefined): id is string => Boolean(id) && rows.some((r) => r.id === id);
  if (has(nav.picked)) return nav.picked;
  if (has(focusTeamId)) return focusTeamId;
  return rows[0]?.id ?? null;
}

/** On a phone: the team's history while it is open, else the list. A removed team's history is not left on screen. */
export function phoneView(rows: FlaggedTeam[], nav: RefereeNav): "list" | "team" {
  return nav.open && rows.some((r) => r.id === nav.picked) ? "team" : "list";
}

/* ---- a team's history ------------------------------------------------------ */

/** Newest first. */
export function historyOf(flags: FlagRow[]): FlagRow[] {
  return [...flags].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

/** Negative when `a` was recorded before `b`. */
const compareAge = (a: FlagRow, b: FlagRow) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** One rule a team has been flagged for more than once: "GG17 twice: Q12 (Warning), Q19 (Minor)". */
export type RepeatedRule = { rule: string; times: number; text: string };

const countWord = (n: number) => (n === 2 ? "twice" : `${n} times`);

/**
 * The rules a team has more than one flag for, from `refereeHistory`: a rule
 * counts under the ruleset it was cited in, Good Conduct is never a prior
 * violation. Each lists the matches oldest first, with the severity recorded.
 */
export function repeatedRules(teamFlags: FlagRow[], kinds: FlagKind[]): RepeatedRule[] {
  const teamId = teamFlags[0]?.team_id;
  const rulesets = [...new Set(teamFlags.map((f) => getRuleset(f.ruleset).id))];
  return rulesets.flatMap((rulesetId) => {
    const cited = new Set(
      teamFlags.filter((f) => f.kind !== "good" && getRuleset(f.ruleset).id === rulesetId).flatMap((f) => parseRuleList(f.rule)),
    );
    return refereeHistory(teamFlags, teamId, [...cited], "", "", rulesetId)
      .byRule.filter((h) => h.sameRule.length > 1)
      .map(({ rule, sameRule }) => {
        const oldestFirst = [...sameRule].sort(compareAge);
        const where = oldestFirst.map((f) => `${matchReference(f.match_type, f.match_number) ?? "—"} (${kindOf(f.kind, kinds)?.short ?? f.kind})`);
        return { rule, times: sameRule.length, text: `${rule} ${countWord(sameRule.length)}: ${where.join(", ")}` };
      });
  });
}

/** The rules on this flag that an earlier flag of the team already cited: the ones to tag "Repeated". */
export function repeatingOn(flag: FlagRow, teamFlags: FlagRow[]): string[] {
  if (flag.kind === "good") return [];
  return refereeHistory(teamFlags, flag.team_id, parseRuleList(flag.rule), flag.match_type ?? "", flag.match_number ?? "", flag.ruleset)
    .byRule.filter((h) => h.sameRule.some((g) => g.id !== flag.id && compareAge(g, flag) < 0))
    .map((h) => h.rule);
}

/** "MS", "Pit 14", "Panel 2": whatever of the three the team has. */
export function teamTags(team: Team | null, panels: Pick<PublicPanel, "id" | "name">[]): string[] {
  if (!team) return [];
  const panel = panels.find((p) => p.id === team.panel_id);
  return [team.division ? divisionTag(team.division) : "", team.pit ? `Pit ${team.pit}` : "", panel?.name ?? ""].filter(Boolean);
}

/** What a flag is called to a screen reader: "9882K, Q19, Minor". */
export function flagLabel(flag: FlagRow, team: Team | null, kinds: FlagKind[]): string {
  return [team?.number ?? "team removed", matchReference(flag.match_type, flag.match_number), kindOf(flag.kind, kinds)?.short ?? flag.kind]
    .filter(Boolean)
    .join(", ");
}

/** The day a flag was recorded, when it is not the day shown: "Oct 19". Null for the same day. */
export function otherDay(iso: string, now: Date = new Date()): string | null {
  const at = new Date(iso);
  if (at.toDateString() === now.toDateString()) return null;
  return at.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** A severity pill's colours: the kind's solid fill and its ink, without the hover a button has. */
export const pillClass = (color: string): string => toneSolid(color).replace(/\s*hover:\S+/g, "");
/** A severity dot's fill. */
export const dotClass = (color: string): string => toneRail(color);

/* ---- Remove ---------------------------------------------------------------- */

export const REMOVE_QUESTION = "Remove this flag? The judges will stop seeing it.";

/** Ask first; `remove` runs only on a yes. Returns whether it ran. `ask` is the in-page confirm (useConfirm), never window.confirm. */
export async function removeAfterAsking(ask: Ask, remove: () => Promise<void>): Promise<boolean> {
  const yes = await ask(REMOVE_QUESTION, { confirmLabel: "Remove flag", danger: true });
  if (yes) await remove();
  return yes;
}

/* ---- Correct flag ---------------------------------------------------------- */

/** What the Correct flag sheet edits. Starts as the flag is; only "Save correction" sends it. */
export type Correction = {
  kind: string;
  body: string;
  match: MatchDraft;
  rules: string[];
  matchAffecting: boolean;
};

export function startCorrection(flag: FlagRow): Correction {
  return {
    kind: flag.kind,
    body: flag.body,
    match: { matchType: flag.match_type ?? "", matchNumber: flag.match_number ?? "", field: flag.field ?? "" },
    rules: parseRuleList(flag.rule),
    matchAffecting: flag.match_affecting,
  };
}

/**
 * The rule chips: the ruleset's common rules, then any other rule already
 * picked (from All rules, or on the flag as it was recorded), so what is
 * selected can always be seen and undone. The referee page lists them the same way.
 */
export function ruleChipIds(rulesetId: string, picked: string[]): string[] {
  const common = commonFieldRules(rulesetId).map((r) => r.id);
  return [...common, ...picked.filter((id) => !common.includes(id))];
}

/**
 * What still stops the correction being saved, as the one line shown above
 * the button; null when nothing does. The checks are the server's own: the
 * match type must be one the flag's ruleset offers (or the flag's own, if
 * old), the number the right shape once tidied the way the server tidies it,
 * the field 1..N (or the flag's own, if
 * old), and Minor, Major and Disqualified need a rule -- except that a flag
 * recorded with none may keep its own kind.
 */
export function correctionBlocker(p: { flag: FlagRow; draft: Correction; kinds: FlagKind[]; fieldCount: number }): string | null {
  const { flag, draft, kinds, fieldCount } = p;
  const rulesetId = getRuleset(flag.ruleset).id;
  const { matchType, matchNumber, field } = draft.match;
  const typeOk = isValidMatchType(matchType, rulesetId) || (matchType !== "" && matchType === flag.match_type && findMatchType(matchType, rulesetId) !== null);
  const fieldOk = isValidFieldPick(field, fieldCount) || (field !== "" && field === flag.field);
  const numberOk = isValidMatchNumber(normalizeMatchNumber(matchNumber, matchType, rulesetId), matchType, rulesetId);
  if (!typeOk || !numberOk || !fieldOk) return "Set the match and field first.";

  const kind = kinds.find((k) => k.id === draft.kind);
  if (!kind) return "Pick how serious it was.";
  const keepsRulelessKind = kind.id === flag.kind && !parseRuleList(flag.rule).length;
  if (kind.requiresRule && !draft.rules.length && !keepsRulelessKind) {
    return `${kind.label} needs at least one rule — pick it under Rules broken.`;
  }
  return null;
}

/**
 * The body of the PATCH, as the inline correction has always sent it: the
 * flag keeps the ruleset it was recorded under. Match affecting only rides
 * along for Minor and Major.
 */
export function correctionReport(flag: FlagRow, draft: Correction): FlagReport {
  return {
    kind: draft.kind,
    body: draft.body,
    matchType: draft.match.matchType,
    matchNumber: draft.match.matchNumber,
    field: draft.match.field,
    ruleset: getRuleset(flag.ruleset).id,
    rules: draft.rules,
    matchAffecting: draft.matchAffecting && MATCH_AFFECTING_KINDS.includes(draft.kind),
  };
}

/**
 * "Save correction": the one place a correction is sent from. Picking a
 * severity, a rule or a field only changes the draft; this runs when Save is
 * pressed, and sends nothing while something still blocks it. Returns whether
 * it sent.
 */
export async function saveCorrection(p: {
  flag: FlagRow;
  draft: Correction;
  kinds: FlagKind[];
  fieldCount: number;
  onSave: (id: string, report: FlagReport) => Promise<void>;
}): Promise<boolean> {
  if (correctionBlocker(p)) return false;
  await p.onSave(p.flag.id, correctionReport(p.flag, p.draft));
  return true;
}

/** Whether the match-affecting switch is offered: Minor and Major only. */
export const canAffectMatch = (kind: string): boolean => MATCH_AFFECTING_KINDS.includes(kind);
