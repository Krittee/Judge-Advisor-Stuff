import type { Panel, PublicPanel, RequestRow, Slot, Team } from "./types";
import type { Status } from "./status";

/**
 * Pure helpers shared by the browser and the server.
 *
 * Nothing here may import the store: these functions are bundled into
 * client components, and the store reaches for node:fs. Server-only
 * reads live in server-state.ts instead.
 */

/** Judge codes must never reach a browser that has not earned them. */
export function stripCode(panel: Panel): PublicPanel {
  const { code: _code, created_at: _created, ...rest } = panel;
  return rest;
}

/**
 * Build a panel's booking grid.
 *
 * Slots are not stored rows — they are computed from the panel's start
 * time, length and count, then matched against any request holding that
 * start time. That way you can re-time a whole panel by editing two
 * numbers instead of migrating rows.
 */
export function buildSlots(
  panel: Pick<PublicPanel, "id" | "slot_start_at" | "slot_minutes" | "slot_count">,
  requests: RequestRow[],
  teams: Team[],
): Slot[] {
  if (!panel.slot_start_at || panel.slot_count <= 0) return [];

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const held = new Map<number, RequestRow>();
  for (const r of requests) {
    if (r.kind !== "slot" || r.panel_id !== panel.id || !r.slot_start) continue;
    if (r.status === "cancelled") continue;
    held.set(new Date(r.slot_start).getTime(), r);
  }

  const startMs = new Date(panel.slot_start_at).getTime();
  const lengthMs = panel.slot_minutes * 60_000;

  return Array.from({ length: panel.slot_count }, (_, i) => {
    const start = new Date(startMs + i * lengthMs);
    const end = new Date(startMs + (i + 1) * lengthMs);
    const taken = held.get(start.getTime());
    const team = taken ? teamById.get(taken.team_id) : undefined;

    return {
      panelId: panel.id,
      start: start.toISOString(),
      end: end.toISOString(),
      takenBy:
        taken && team
          ? { teamId: team.id, teamNumber: team.number, status: taken.status as Status }
          : null,
    };
  });
}

/** The one request that represents a team's current state, if any. */
export function liveRequestFor(teamId: string, requests: RequestRow[]): RequestRow | null {
  const live = requests.filter(
    (r) =>
      r.team_id === teamId &&
      (r.status === "requested" || r.status === "acknowledged" || r.status === "interviewing"),
  );
  if (live.length) return live[0];

  const scheduled = requests
    .filter((r) => r.team_id === teamId && r.status === "scheduled")
    .sort((a, b) => (a.slot_start ?? "").localeCompare(b.slot_start ?? ""));
  return scheduled[0] ?? null;
}

/** Most recent request of any status, used for "already interviewed" checks. */
export function latestRequestFor(teamId: string, requests: RequestRow[]): RequestRow | null {
  return requests.find((r) => r.team_id === teamId) ?? null;
}
