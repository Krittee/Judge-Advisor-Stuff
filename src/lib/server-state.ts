import { store } from "./db";
import { stripCode } from "./data";
import type { AppState } from "./types";

/**
 * Server-only. Imports the store, which reaches for node:fs — keep this
 * out of anything a client component imports.
 *
 * `includeMessages` is off for anyone not on staff: the note a team types
 * for its judges is free text, and it has no business being readable by
 * the other 119 teams polling the same endpoint.
 */
export async function loadState(includeMessages = false): Promise<AppState> {
  const db = store();
  const [panels, teams, rows] = await Promise.all([
    db.listPanels(),
    db.listTeams(),
    db.listRequests(),
  ]);

  return {
    panels: panels.map(stripCode),
    teams,
    requests: includeMessages ? rows : rows.map((r) => ({ ...r, message: null })),
    serverTime: new Date().toISOString(),
  };
}
