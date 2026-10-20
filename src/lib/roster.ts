import type { ConflictRow, JudgeRow, RequestRow, Team } from "./types";

/**
 * The one rule for "may this panel meet this team?", and the judge roster
 * helpers around it.
 *
 * Pure on purpose: floorLogic.ts (a client component's logic) needs the
 * rule, and conflicts.ts -- where server code imports it from -- reaches
 * the store, which reaches node:fs. Nothing here may import the store.
 */

export type PanelBlock = { panel_id: string; team_id: string; conflict_id: string };

/**
 * Every (panel, team) pair that may not meet: whole-panel conflicts, plus
 * each judge conflict mapped through that judge's current panel. A judge
 * with no panel blocks nothing yet; move them and the block follows.
 */
export function panelBlocks(
  conflicts: Pick<ConflictRow, "id" | "panel_id" | "judge_id" | "team_id">[],
  judges: Pick<JudgeRow, "id" | "panel_id">[],
): PanelBlock[] {
  const panelOf = new Map(judges.map((j) => [j.id, j.panel_id]));
  const blocks: PanelBlock[] = [];
  for (const c of conflicts) {
    // A judge's conflict is judged by where the judge is now; a row naming
    // a judge who is gone (or on no panel) blocks nothing.
    const panel_id = c.judge_id ? (panelOf.get(c.judge_id) ?? null) : c.panel_id;
    if (panel_id) blocks.push({ panel_id, team_id: c.team_id, conflict_id: c.id });
  }
  return blocks;
}

export function isPanelBlocked(blocks: PanelBlock[], panelId: string, teamId: string): boolean {
  return blocks.some((b) => b.panel_id === panelId && b.team_id === teamId);
}

/** The ids of the teams this panel may not meet. */
export function blockedTeams(blocks: PanelBlock[], panelId: string): Set<string> {
  return new Set(blocks.filter((b) => b.panel_id === panelId).map((b) => b.team_id));
}

/** The conflicts behind one panel's blocks: all a judge on that panel is shown. */
export function conflictsFor<C extends { id: string }>(
  panelId: string,
  conflicts: C[],
  blocks: PanelBlock[],
): C[] {
  const ids = new Set(blocks.filter((b) => b.panel_id === panelId).map((b) => b.conflict_id));
  return conflicts.filter((c) => ids.has(c.id));
}

/** How roster names are compared: trimmed, case-insensitive. */
export const judgeKey = (name: string): string => name.trim().toLowerCase();

/**
 * Teams that a panel holds and may not meet: assigned to it, or with a live
 * request or booking on it. These are the ones that come off the panel when
 * a conflicted judge joins it.
 */
export function blockedAndHeld(
  panelId: string,
  blocks: PanelBlock[],
  teams: Team[],
  requests: Pick<RequestRow, "team_id" | "panel_id" | "status">[],
): Team[] {
  const blocked = blockedTeams(blocks, panelId);
  const inFlight = new Set(
    requests
      .filter(
        (r) =>
          r.panel_id === panelId &&
          (r.status === "requested" ||
            r.status === "acknowledged" ||
            r.status === "interviewing" ||
            r.status === "scheduled"),
      )
      .map((r) => r.team_id),
  );
  return teams.filter((t) => blocked.has(t.id) && (t.panel_id === panelId || inFlight.has(t.id)));
}
