import assert from "node:assert/strict";
import test from "node:test";

import { noSlotsLeftLine } from "../src/components/SlotPicker";
import type { Slot } from "../src/lib/types";

/* BUG-031: when no slot is open, the line must say why. A slot whose time
   has passed is not taken, and "all taken" sends staff hunting for a booking
   clash that does not exist. */

const now = Date.parse("2026-10-16T12:00:00.000Z");
const slot = (startHour: number, takenBy: Slot["takenBy"] = null): Slot => ({
  panelId: "panel-1",
  start: new Date(now + (startHour - 1) * 3_600_000).toISOString(),
  end: new Date(now + startHour * 3_600_000 - 1).toISOString(),
  takenBy,
  blocked: false,
});
// slot(-2) ended two hours ago; slot(2) starts in two hours.
const booked = { teamId: "t", teamNumber: "1111A", status: "scheduled" as const };

test("when every remaining slot has already passed, the line says so, not that they are taken", () => {
  assert.equal(
    noSlotsLeftLine([slot(-3), slot(-2)], now),
    "No slots left today — the rest have already passed",
  );
});

test("when every slot is booked and none has passed, the line still says they are taken", () => {
  assert.equal(
    noSlotsLeftLine([slot(2, booked), slot(3, booked)], now),
    "All 2 slots are taken — nothing left to book",
  );
});

test("a mix says how many are taken and how many have passed", () => {
  assert.equal(
    noSlotsLeftLine([slot(-3), slot(-2), slot(2, booked)], now),
    "No slots left — 1 taken, 2 already passed",
  );
});

test("a slot that passed while booked counts as taken, not as passed", () => {
  assert.equal(
    noSlotsLeftLine([slot(-2, booked), slot(-3)], now),
    "No slots left — 1 taken, 1 already passed",
  );
});
