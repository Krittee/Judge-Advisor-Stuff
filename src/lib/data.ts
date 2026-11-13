import type { Panel, PublicPanel, RequestRow, Slot, SlotDay, Team } from "./types";
import type { Status } from "./status";
import { bangkokDay } from "./stepTimes";

/** What the slot helpers read off a panel; slot_days is optional so older callers still compile. */
export type SlotFields = Pick<PublicPanel, "slot_start_at" | "slot_minutes" | "slot_count"> & { slot_days?: SlotDay[] };

export const MAX_SLOT_DAYS = 7;
export const MAX_TOTAL_SLOTS = 200;

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
  panel: Pick<PublicPanel, "id"> & SlotFields,
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
  if (slotTimes(panel).length === 0) return [];

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
 * The days a panel takes bookings: its slot_days, earliest first. A panel with
 * none falls back to its legacy start / length / count as one day, so old
 * panels keep exactly their old slots with no data migration.
 */
export function panelDays(panel: SlotFields): SlotDay[] {
  if (panel.slot_days?.length) {
    return [...panel.slot_days].sort((a, b) => new Date(a.open_at).getTime() - new Date(b.open_at).getTime());
  }
  const startMs = panel.slot_start_at ? new Date(panel.slot_start_at).getTime() : NaN;
  if (Number.isNaN(startMs) || panel.slot_count <= 0 || panel.slot_minutes <= 0) return [];
  return [
    {
      open_at: panel.slot_start_at!,
      end_at: new Date(startMs + panel.slot_count * panel.slot_minutes * 60_000).toISOString(),
      break_from: null,
      break_to: null,
    },
  ];
}

/**
 * Just the clock times a panel's slots occupy, back to back within each day.
 *
 * A day's slots run from open, one length each, skip the break, and stop at
 * the end: one ending exactly at the break is kept, one crossing it is dropped
 * and the next starts at break_to; one crossing the end is dropped. Bookings
 * are checked against this list, which is what makes two teams overlapping
 * impossible rather than merely unlikely — every accepted booking sits exactly
 * on the grid, so two bookings either share a start time (refused) or do not
 * intersect at all.
 */
export function slotTimes(panel: SlotFields): { start: Date; end: Date }[] {
  if (!(panel.slot_minutes > 0)) return [];
  const len = panel.slot_minutes * 60_000;
  const out: { start: Date; end: Date }[] = [];
  for (const day of panelDays(panel)) {
    const end = new Date(day.end_at).getTime();
    const bFrom = day.break_from ? new Date(day.break_from).getTime() : NaN;
    const bTo = day.break_to ? new Date(day.break_to).getTime() : NaN;
    let t = new Date(day.open_at).getTime();
    if (Number.isNaN(t) || Number.isNaN(end)) continue;
    while (t + len <= end) {
      if (t < bTo && t + len > bFrom) {
        t = bTo;
        continue;
      }
      out.push({ start: new Date(t), end: new Date(t + len) });
      t += len;
    }
  }
  return out;
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
  panel: SlotFields,
  start: Date,
  end: Date,
): boolean {
  return slotTimes(panel).some(
    (s) => s.start.getTime() === start.getTime() && s.end.getTime() === end.getTime(),
  );
}

/** What a save writes besides slot_days: first open (or null) and the total slot count. */
export function slotSummaryFields(
  days: SlotDay[],
  minutes: number,
): { slot_start_at: string | null; slot_count: number } {
  const first = [...days].sort((a, b) => a.open_at.localeCompare(b.open_at))[0];
  return {
    slot_start_at: first ? first.open_at : null,
    slot_count: slotTimes({ slot_days: days, slot_minutes: minutes, slot_start_at: null, slot_count: 0 }).length,
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const isoOrNull = (v: unknown): string | null => {
  if (typeof v !== "string" || !ISO.test(v)) return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};

/**
 * Check a slotDays body and return it normalised (ISO instants, sorted by
 * open), or one plain sentence naming the day that is wrong. [] is fine: it
 * turns booking off.
 */
export function parseSlotDays(raw: unknown, minutes: number): { days: SlotDay[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "Slot days must be a list." };
  if (raw.length > MAX_SLOT_DAYS) return { error: `A panel can have at most ${MAX_SLOT_DAYS} days.` };

  const rows = raw.map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : {}));
  rows.sort((a, b) => (new Date(String(a.open_at)).getTime() || Infinity) - (new Date(String(b.open_at)).getTime() || Infinity));

  const days: SlotDay[] = [];
  const dates = new Set<string>();
  let total = 0;
  for (const [i, r] of rows.entries()) {
    const name = `Day ${i + 1}`;
    const open = isoOrNull(r.open_at);
    const end = isoOrNull(r.end_at);
    if (!open || !end) return { error: `${name}: the open and end times must be real times.` };
    if (new Date(open) >= new Date(end)) return { error: `${name}: the end time must be after the open time.` };
    if (bangkokDay(open) !== bangkokDay(end)) return { error: `${name}: open and end must be on the same date.` };

    const hasFrom = r.break_from != null && r.break_from !== "";
    const hasTo = r.break_to != null && r.break_to !== "";
    let break_from: string | null = null;
    let break_to: string | null = null;
    if (hasFrom !== hasTo) return { error: `${name}: set both break times, or neither.` };
    if (hasFrom) {
      break_from = isoOrNull(r.break_from);
      break_to = isoOrNull(r.break_to);
      if (!break_from || !break_to) return { error: `${name}: the break times must be real times.` };
      if (new Date(break_from) >= new Date(break_to)) return { error: `${name}: the break must end after it starts.` };
      if (new Date(break_from) < new Date(open) || new Date(break_to) > new Date(end)) {
        return { error: `${name}: the break must fall within the open hours.` };
      }
    }

    const date = bangkokDay(open);
    if (dates.has(date)) return { error: `${name}: another day is already on ${date}.` };
    dates.add(date);

    const day: SlotDay = { open_at: open, end_at: end, break_from, break_to };
    const count = slotTimes({ slot_days: [day], slot_minutes: minutes, slot_start_at: null, slot_count: 0 }).length;
    if (count === 0) return { error: `${name}: no slot fits in these hours.` };
    total += count;
    days.push(day);
  }
  if (total > MAX_TOTAL_SLOTS) return { error: `That makes ${total} slots; the most is ${MAX_TOTAL_SLOTS}.` };
  return { days };
}
