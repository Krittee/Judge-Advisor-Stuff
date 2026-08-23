import { db } from "./supabase";
import type { AppState, Panel, PublicPanel, RequestRow, Slot, Team } from "./types";
import type { Status } from "./status";

/**
 * Everything every screen needs, in one round trip.
 *
 * `includeMessages` is off for anyone not on staff: the note a team types
 * for its judges is free text, and it has no business being readable by
 * the other 119 teams polling the same endpoint.
 */
export async function loadState(includeMessages = false): Promise<AppState> {
  const client = db();
  const [panels, teams, requests] = await Promise.all([
    client.from("panels").select("*").order("sort_order").order("name"),
    client.from("teams").select("*").order("number"),
    client
      .from("requests")
      .select("*")
      .order("requested_at", { ascending: false })
      .limit(1500),
  ]);

  const err = panels.error || teams.error || requests.error;
  if (err) throw new Error(err.message);

  const rows = (requests.data ?? []) as RequestRow[];

  return {
    panels: ((panels.data ?? []) as Panel[]).map(stripCode),
    teams: (teams.data ?? []) as Team[],
    requests: includeMessages ? rows : rows.map((r) => ({ ...r, message: null })),
    serverTime: new Date().toISOString(),
  };
}

/** Judge codes must never reach a browser that has not earned them. */
export function stripCode(panel: Panel): PublicPanel {
  const { code: _code, created_at: _created, ...rest } = panel;
  return rest;
}

export async function logActivity(entry: {
  requestId?: string | null;
  teamId?: string | null;
  actor: string;
  action: string;
  detail?: string | null;
}): Promise<void> {
  // Never let a failed audit write break the thing the user actually asked for.
  await db()
    .from("activity")
    .insert({
      request_id: entry.requestId ?? null,
      team_id: entry.teamId ?? null,
      actor: entry.actor,
      action: entry.action,
      detail: entry.detail ?? null,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

/**
 * Build a panel's booking grid.
 *
 * Slots are not rows in the database — they are computed from the panel's
 * start time, length and count, then matched against any request holding
 * that start time. That way you can re-time a whole panel by editing two
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
