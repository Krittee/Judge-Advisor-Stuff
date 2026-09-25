import assert from "node:assert/strict";
import test from "node:test";

import { BOOKING_GAP_MINUTES, buildSlots, hasNearbyBooking } from "../src/lib/data";

/**
 * A judge needs a fixed walk-and-interview window between two bookings on
 * the same panel. This is what actually enforces that -- tighter than
 * "same exact start time" -- so a panel configured with slots shorter
 * than the window can't let two teams land too close together.
 */

const now = Date.parse("2026-05-01T10:00:00.000Z");
const at = (offsetMinutes: number) => new Date(now + offsetMinutes * 60_000).toISOString();

function slotRequest(panelId: string, slotStart: string, status = "scheduled") {
  return {
    id: `r-${slotStart}`,
    team_id: "t1",
    panel_id: panelId,
    status,
    kind: "slot",
    slot_start: slotStart,
  } as never;
}

test("a booking inside the gap on the same panel conflicts", () => {
  const held = [slotRequest("p1", at(0))];
  assert.equal(
    hasNearbyBooking(held, "p1", Date.parse(at(BOOKING_GAP_MINUTES - 1))),
    true,
  );
});

test("a booking exactly at the gap boundary does not conflict", () => {
  const held = [slotRequest("p1", at(0))];
  assert.equal(hasNearbyBooking(held, "p1", Date.parse(at(BOOKING_GAP_MINUTES))), false);
});

test("a cancelled booking never conflicts", () => {
  const held = [slotRequest("p1", at(0), "cancelled")];
  assert.equal(hasNearbyBooking(held, "p1", Date.parse(at(5))), false);
});

test("a nearby booking on a different panel does not conflict", () => {
  const held = [slotRequest("p2", at(0))];
  assert.equal(hasNearbyBooking(held, "p1", Date.parse(at(5))), false);
});

test("a panel with tight slot_minutes marks the neighbours of a taken slot as blocked", () => {
  const panel = { id: "p1", slot_start_at: at(0), slot_minutes: 10, slot_count: 4 };
  const requests = [slotRequest("p1", at(0))];
  const slots = buildSlots(panel, requests as never, []);

  assert.deepEqual(
    slots.map((s) => s.blocked),
    [false, true, false, false],
  );
});
