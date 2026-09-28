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
  /**
   * A booking being rescheduled, not a new one — its own slot must not
   * count against itself when deciding which nearby slots are "too
   * close". Without this, every slot within 20 minutes of a booking's
   * current time would read as blocked by that same booking while
   * picking where to move it to.
   */
  excludeRequestId?: string,
): Slot[] {
  if (!panel.slot_start_at || panel.slot_count <= 0) return [];

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const held = new Map<number, RequestRow>();
  for (const r of requests) {
    if (r.kind !== "slot" || r.panel_id !== panel.id || !r.slot_start) continue;
    if (r.status === "cancelled") continue;
    held.set(new Date(r.slot_start).getTime(), r);
  }

  return slotTimes(panel).map(({ start, end }) => {
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
      blocked: !taken && hasNearbyBooking(requests, panel.id, start.getTime(), excludeRequestId),
    };
  });
}

/**
 * How long a judge needs, door to door: walk to the team plus the
 * interview itself. Two bookings on the same panel closer together than
 * this would need the judge in two places at once.
 */
export const BOOKING_GAP_MINUTES = 20;

/**
 * Whether some other live slot booking on this panel sits within the
 * walk-and-interview window of the given start time.
 *
 * This is what actually keeps two bookings apart — tighter than "same
 * exact start time" — so it also catches a panel whose own slot_minutes
 * is configured shorter than a judge can physically walk.
 */
export function hasNearbyBooking(
  requests: RequestRow[],
  panelId: string,
  startMs: number,
  excludeRequestId?: string,
): boolean {
  const gapMs = BOOKING_GAP_MINUTES * 60_000;
  return requests.some(
    (r) =>
      r.id !== excludeRequestId &&
      r.kind === "slot" &&
      r.panel_id === panelId &&
      r.status !== "cancelled" &&
      r.slot_start != null &&
      Math.abs(new Date(r.slot_start).getTime() - startMs) < gapMs,
  );
}

/**
 * How long before a booked slot it starts warning.
 *
 * One slot length would be the tidy answer, but a panel can be re-timed
 * to 3 minutes; a team needs long enough to walk across a hall whatever
 * the grid says. Tune it here — this is the only place it is decided.
 */
export const BOOKING_SOON_MINUTES = 15;

export type BookingUrgency = "later" | "soon" | "due";

/**
 * How a booked slot reads against the clock right now.
 *
 * "due" once the slot has started, "soon" inside the warning window,
 * "later" otherwise. `now` is passed in rather than read here so the
 * caller decides when it re-reads the clock — a component ticking on its
 * own interval, a test pinning a fixed instant.
 */
export function bookingUrgency(slotStart: string | null, now: number): BookingUrgency {
  if (!slotStart) return "later";
  const start = new Date(slotStart).getTime();
  if (Number.isNaN(start)) return "later";
  if (start <= now) return "due";
  return start - now <= BOOKING_SOON_MINUTES * 60_000 ? "soon" : "later";
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

/**
 * Just the clock times a panel's slots occupy, back to back.
 *
 * Slot i runs from start + i lengths to start + (i+1) lengths, so they
 * tile the session with no gap and no overlap: 1:00-1:20, 1:20-1:40, and
 * so on. Bookings are checked against this list, which is what makes two
 * teams overlapping impossible rather than merely unlikely — every
 * accepted booking sits exactly on the grid, so two bookings either share
 * a start time (refused) or do not intersect at all.
 */
export function slotTimes(
  panel: Pick<PublicPanel, "slot_start_at" | "slot_minutes" | "slot_count">,
): { start: Date; end: Date }[] {
  if (!panel.slot_start_at || panel.slot_count <= 0 || panel.slot_minutes <= 0) return [];

  const startMs = new Date(panel.slot_start_at).getTime();
  if (Number.isNaN(startMs)) return [];
  const lengthMs = panel.slot_minutes * 60_000;

  return Array.from({ length: panel.slot_count }, (_, i) => ({
    start: new Date(startMs + i * lengthMs),
    end: new Date(startMs + (i + 1) * lengthMs),
  }));
}

/**
 * Whether a requested start and end are exactly one of the panel's slots.
 *
 * The times arrive in the request body, so they are not to be trusted:
 * a page left open while the panel was re-timed will offer slots that no
 * longer exist, and anything posting straight at the API can name any
 * time at all. Either would land a booking across two real slots, which
 * the one-team-per-start-time rule would not catch.
 */
export function isRealSlot(
  panel: Pick<PublicPanel, "slot_start_at" | "slot_minutes" | "slot_count">,
  start: Date,
  end: Date,
): boolean {
  return slotTimes(panel).some(
    (s) => s.start.getTime() === start.getTime() && s.end.getTime() === end.getTime(),
  );
}
