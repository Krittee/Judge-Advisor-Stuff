import { store } from "./db";
import type { Session } from "./auth";

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

  const conflicts = await store().listConflicts();
  return conflicts.some((c) => c.panel_id === session.panelId && c.team_id === teamId);
}

export const CONFLICT_MESSAGE =
  "Your panel has a declared conflict of interest with this team, so it is not yours to judge. " +
  "Speak to the Judge Advisor.";
