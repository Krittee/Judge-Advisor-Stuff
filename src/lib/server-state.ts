import { store } from "./db";
import { stripCode } from "./data";
import { presetDivisions, teamCategories } from "./presets";
import { canAdminister, canAdvance, canReadNotes, type Session } from "./auth";
import type { AppState, ViewerCapabilities } from "./types";

/**
 * Server-only. Imports the store, which reaches for node:fs — keep this
 * out of anything a client component imports.
 *
 * What comes back depends on who is asking:
 *
 *   admin   everything
 *   judge   their own division only — the wall applies to what they can
 *           see, not only to what they can touch
 *   queuer  everything, including the notes teams leave for judges
 *   team    everything, minus those notes
 *
 * Team numbers, names and statuses are public by design: they are on the
 * big board on the wall. The private things are judging notes, panel
 * codes and the free-text message a team leaves, and none of those are
 * in this payload for anyone who has not earned them.
 */
export async function loadState(session: Session | null): Promise<AppState> {
  const db = store();
  const [panels, teams, rows] = await Promise.all([
    db.listPanels(),
    db.listTeams(),
    db.listRequests(),
  ]);

  const isJudge = session?.role === "judge";
  const division = isJudge
    ? (panels.find((p) => p.id === session.panelId)?.division ?? null)
    : null;

  // A judge sees their own division and nothing else.
  const visiblePanels = division ? panels.filter((p) => p.division === division) : panels;
  const visibleTeams = division ? teams.filter((t) => t.division === division) : teams;
  const visiblePanelIds = new Set(visiblePanels.map((p) => p.id));
  const visibleTeamIds = new Set(visibleTeams.map((t) => t.id));
  const visibleRequests = division
    ? rows.filter((r) => visibleTeamIds.has(r.team_id) || visiblePanelIds.has(r.panel_id ?? ""))
    : rows;

  // The note a team types for its judges is free text, and has no
  // business being readable by the other 119 teams polling this.
  const includeMessages = session !== null;

  const divisions = [
    ...new Set([
      ...presetDivisions(),
      ...panels.map((p) => p.division),
      ...teams.map((t) => t.division),
    ]),
  ].filter(Boolean);

  return {
    panels: visiblePanels.map(stripCode),
    teams: visibleTeams,
    requests: includeMessages
      ? visibleRequests
      : visibleRequests.map((r) => ({ ...r, message: null })),
    divisions: division ? [division] : divisions,
    categories: teamCategories(),
    viewer: describeViewer(session, division),
    serverTime: new Date().toISOString(),
  };
}

/** Told to the browser so the UI never offers what the API would refuse. */
function describeViewer(session: Session | null, division: string | null): ViewerCapabilities {
  return {
    role: session?.role ?? "team",
    name: session?.name ?? null,
    panelId: session?.role === "judge" ? session.panelId : null,
    panelName: session?.role === "judge" ? session.panelName : null,
    division,
    canAdvance: canAdvance(session),
    canReadNotes: canReadNotes(session),
    canAdminister: canAdminister(session),
  };
}
