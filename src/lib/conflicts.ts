import { store } from "./db";
import type { Session } from "./auth";
import { blockedAndAssigned, blockedTeams, isPanelBlocked, panelBlocks, type PanelBlock } from "./roster";
import type { JudgeRow, Team } from "./types";

// The rule lives in roster.ts (client-safe); server code imports it from here.
export { blockedTeams, conflictsFor, isPanelBlocked, panelBlocks, type PanelBlock } from "./roster";

/** Every (panel, team) pair that may not meet, as the store has it right now. */
export async function loadBlocks(): Promise<PanelBlock[]> {
  const db = store();
  const [conflicts, judges] = await Promise.all([db.listConflicts(), db.listJudges()]);
  return panelBlocks(conflicts, judges);
}

/**
 * The teams a panel would have to give up if the roster became `judgesAfter`:
 * ones assigned to it that the new roster blocks it from and the current one
 * does not. Reads only. This is the list `takeOffPanel` writes, so what is
 * reported is what changes.
 */
export async function teamsToTakeOff(panelId: string, judgesAfter: JudgeRow[]): Promise<Team[]> {
  const db = store();
  const [conflicts, judgesNow, teams] = await Promise.all([db.listConflicts(), db.listJudges(), db.listTeams()]);
  const already = blockedTeams(panelBlocks(conflicts, judgesNow), panelId);
  return blockedAndAssigned(panelId, panelBlocks(conflicts, judgesAfter), teams).filter((t) => !already.has(t.id));
}

/** Take them off their panel the way declaring a conflict always has: the team loses its panel. */
export async function takeOffPanel(teams: Team[]): Promise<void> {
  for (const team of teams) await store().updateTeam(team.id, { panel_id: null });
}

/**
 * Is this caller barred from this team?
 *
 * A conflict is absolute: an affiliated panel may not interview the team,
 * read or write its notes, score it, or move its requests along. The
 * Judge Advisor is not blocked — somebody has to be able to see the whole
 * floor and reassign around a conflict.
 */
export async function isConflicted(
  session: Session | null,
  teamId: string,
): Promise<boolean> {
  if (session?.role !== "judge") return false;

  return isPanelBlocked(await loadBlocks(), session.panelId, teamId);
}

export const CONFLICT_MESSAGE =
  "Your panel has a declared conflict of interest with this team, so it is not yours to judge. " +
  "Speak to the Judge Advisor.";
