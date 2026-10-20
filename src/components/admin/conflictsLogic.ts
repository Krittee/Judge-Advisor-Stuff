import type { Ask } from "@/components/judge/logic";
import type { call } from "@/components/useAppState";
import { divisionsCompatible } from "@/lib/presets";
import { isPanelBlocked, panelBlocks, type PanelBlock } from "@/lib/roster";
import type { ConflictRow, JudgeRow, PublicPanel, Team } from "@/lib/types";
import { divisionTag } from "./floorLogic";

/* The Judge Advisor Conflicts tab's decisions, kept out of the markup so they
   run as plain functions in tests/adminConflicts.logic.test.mjs. Who a
   conflict blocks is never decided here: it is read off `panelBlocks`. */

/** Conflicts that belong to a judge. The older whole-panel entries are not counted. */
export const judgeConflictCount = (conflicts: Pick<ConflictRow, "judge_id">[]): number =>
  conflicts.filter((c) => c.judge_id).length;

/** "Panel 2 · MS". */
export const panelTag = (panel: Pick<PublicPanel, "name" | "division">): string =>
  `${panel.name} · ${divisionTag(panel.division)}`;

/** One conflict with the team it names (gone if the team was removed). */
export type ConflictLine = { conflict: ConflictRow; team: Team | undefined };

/** A judge who has conflicts, with the panel those conflicts block right now (null: the judge has none). */
export type JudgeGroup = { judge: JudgeRow; panel: PublicPanel | null; rows: ConflictLine[] };

/** An older whole-panel entry, with the panel it blocks. */
export type LegacyLine = ConflictLine & { panel: PublicPanel | null };

/**
 * The list: only judges with conflicts, in roster order, then the older
 * whole-panel entries. A conflict's panel comes from `blocks`, so a judge who
 * moves takes their group's "Blocks Panel N" with them.
 */
export function conflictGroups(
  conflicts: ConflictRow[],
  judges: JudgeRow[],
  panels: PublicPanel[],
  teams: Team[],
  blocks: PanelBlock[] = panelBlocks(conflicts, judges),
): { byJudge: JudgeGroup[]; legacy: LegacyLine[] } {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const panelById = new Map(panels.map((p) => [p.id, p]));
  const blockedPanel = new Map(blocks.map((b) => [b.conflict_id, panelById.get(b.panel_id) ?? null]));
  const line = (conflict: ConflictRow): ConflictLine => ({ conflict, team: teamById.get(conflict.team_id) });

  const byJudge = judges
    .map((judge) => {
      const rows = conflicts.filter((c) => c.judge_id === judge.id).map(line);
      return { judge, panel: rows.map((r) => blockedPanel.get(r.conflict.id)).find(Boolean) ?? null, rows };
    })
    .filter((g) => g.rows.length);

  const legacy = conflicts
    .filter((c) => !c.judge_id)
    .map((c) => ({ ...line(c), panel: blockedPanel.get(c.id) ?? null }));

  return { byJudge, legacy };
}

/**
 * Teams with no panel left to judge them: unassigned, and every panel in
 * their division is blocked from them. Auto-assign skips them, so without
 * this nobody finds out until the team turns up.
 */
export function strandedTeams(teams: Team[], panels: PublicPanel[], blocks: PanelBlock[]): Team[] {
  return teams.filter((team) => {
    if (team.panel_id) return false;
    const inDivision = panels.filter((p) => divisionsCompatible(team.division, p.division));
    return inDivision.length > 0 && inDivision.every((p) => isPanelBlocked(blocks, p.id, team.id));
  });
}

/** The Judge select's groups: a group per panel in panel order, then judges with no panel. Empty groups are left out. */
export function judgeOptionGroups(
  judges: JudgeRow[],
  panels: PublicPanel[],
): { label: string; judges: JudgeRow[] }[] {
  const known = new Set(panels.map((p) => p.id));
  const groups = panels.map((panel) => ({
    label: panelTag(panel),
    judges: judges.filter((j) => j.panel_id === panel.id),
  }));
  groups.push({ label: "Not on a panel", judges: judges.filter((j) => !j.panel_id || !known.has(j.panel_id)) });
  return groups.filter((g) => g.judges.length);
}

/** The line under the Judge select. Nothing until a judge is chosen; a judge about to be created has no panel. */
export function judgeStatus(
  choice: string,
  judges: JudgeRow[],
  panels: PublicPanel[],
): { blocks: boolean; text: string } | null {
  if (choice === "new") return { blocks: false, text: "Not on a panel yet" };
  const judge = judges.find((j) => j.id === choice);
  if (!judge) return null;
  const panel = panels.find((p) => p.id === judge.panel_id);
  return panel ? { blocks: true, text: `Blocks ${panel.name}` } : { blocks: false, text: "Not on a panel yet" };
}

/** What POST /api/conflicts { judgeId, … } answers. */
export type RecordResult = {
  judge: JudgeRow;
  recorded: string[];
  unchanged: string[];
  notFound: string[];
  takenOff: string[];
};

/** One line of the "Last recording" box. `kind` picks the icon and colour. */
export type ResultLine = { kind: "ok" | "warn" | "mute" | "bad"; lead: string; numbers: string[]; tail?: string };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The four things a recording can say, each only when it has something to
 * say: recorded (done green), taken off the judge's panel (caution), already
 * recorded (muted), and numbers that match no team (danger-quiet).
 */
export function resultLines(result: RecordResult, panels: PublicPanel[]): ResultLine[] {
  const { judge, recorded, takenOff, unchanged, notFound } = result;
  const panel = panels.find((p) => p.id === judge.panel_id);
  const lines: ResultLine[] = [];
  if (recorded.length) lines.push({ kind: "ok", lead: `Recorded for ${judge.name}: `, numbers: recorded });
  if (takenOff.length) {
    lines.push({
      kind: "warn",
      lead: `${judge.name} is on ${panel?.name ?? "a panel"}, so `,
      numbers: takenOff,
      tail: ` ${plural(takenOff.length, "comes", "come")} off it and ${plural(takenOff.length, "needs", "need")} a panel`,
    });
  }
  if (unchanged.length) lines.push({ kind: "mute", lead: "Already recorded: ", numbers: unchanged });
  if (notFound.length) {
    lines.push({ kind: "bad", lead: "No team with that number — check these: ", numbers: notFound });
  }
  return lines;
}

/** What the record form holds when it is sent. `judge` is a roster id, or "new" to create one first. */
export type RecordInput = {
  judge: string;
  /** The new judge's name and optional note; read only when `judge` is "new". */
  name: string;
  judgeNote: string;
  teamNumbers: string;
  note: string;
};

/**
 * Record conflicts for one judge: the "+ New judge…" path creates the judge
 * first and then records against the id the roster hands back, so a conflict
 * never names a judge by typed text. `onJudge` hears about a freshly created
 * judge before the recording starts, so a recording that fails leaves the
 * form on that judge rather than offering to create the same name twice.
 */
export async function recordConflicts(
  send: typeof call,
  input: RecordInput,
  onJudge: (judge: JudgeRow) => Promise<void> | void = () => {},
): Promise<RecordResult> {
  let judgeId = input.judge;
  if (judgeId === "new") {
    const made = await send<{ judge: JudgeRow }>("/api/admin/judges", {
      body: { name: input.name.trim(), note: input.judgeNote.trim() },
    });
    judgeId = made.judge.id;
    await onJudge(made.judge);
  }
  return send<RecordResult>("/api/conflicts", {
    body: { judgeId, teamNumbers: input.teamNumbers, note: input.note.trim() },
  });
}

/** Whether the form can be sent: a judge (with a name, if new) and at least one team number. */
export function canRecord(input: RecordInput): boolean {
  if (!input.teamNumbers.trim()) return false;
  return input.judge === "new" ? input.name.trim().length > 0 : input.judge !== "";
}

/**
 * "Withdraw Priya Nair's conflict with 9882K? Panel 2 will be able to judge
 * them again." When another conflict still keeps that panel off the team the
 * second sentence says so instead; a judge on no panel blocks nothing, so
 * there is nothing to promise. `judge` is null for an older whole-panel entry.
 */
export function withdrawQuestion(
  row: { conflict: ConflictRow; team: Team | undefined; judge: JudgeRow | null; panel: PublicPanel | null },
  conflicts: ConflictRow[],
  judges: JudgeRow[],
): string {
  const { conflict, team, judge, panel } = row;
  const number = team?.number ?? "this team";
  const head = judge
    ? `Withdraw ${judge.name}'s conflict with ${number}?`
    : `Withdraw the whole-panel conflict between ${panel?.name ?? "a panel"} and ${number}?`;
  if (!panel || !team) return head;
  const left = panelBlocks(
    conflicts.filter((c) => c.id !== conflict.id),
    judges,
  );
  return isPanelBlocked(left, panel.id, team.id)
    ? `${head} ${panel.name} stays off them for another conflict.`
    : `${head} ${panel.name} will be able to judge them again.`;
}

/** Ask, and withdraw only on a yes. Declining sends nothing. */
export async function withdrawAfterAsking(
  ask: Ask,
  question: string,
  withdraw: () => Promise<void>,
): Promise<boolean> {
  const yes = await ask(question, { confirmLabel: "Withdraw", danger: true });
  if (yes) await withdraw();
  return yes;
}
