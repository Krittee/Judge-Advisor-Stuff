import assert from "node:assert/strict";
import test from "node:test";

import { BOOKING_SOON_MINUTES, bookingUrgency } from "../src/lib/data";

/**
 * The upcoming-booking warning. Everything on screen -- the orange chip on
 * the board, the team's own page, the coordinator's Booked column -- reads
 * its colour from this one function, so the window boundaries are worth
 * pinning down rather than eyeballing on the day.
 */

const now = Date.parse("2026-05-01T10:00:00.000Z");
const at = (offsetMinutes: number) =>
  new Date(now + offsetMinutes * 60_000).toISOString();

test("a booking far out is not warned about", () => {
  assert.equal(bookingUrgency(at(BOOKING_SOON_MINUTES + 1), now), "later");
  assert.equal(bookingUrgency(at(120), now), "later");
});

test("a booking inside the window is coming up", () => {
  assert.equal(bookingUrgency(at(BOOKING_SOON_MINUTES), now), "soon");
  assert.equal(bookingUrgency(at(1), now), "soon");
});

test("a booking whose time has come reads as due, and stays due once past", () => {
  assert.equal(bookingUrgency(at(0), now), "due");
  assert.equal(bookingUrgency(at(-30), now), "due");
});

test("no booking, or a time that is not one, never warns", () => {
  assert.equal(bookingUrgency(null, now), "later");
  assert.equal(bookingUrgency("not a date", now), "later");
});

test("the warning window moves with the clock, not with the render", () => {
  /* The slot is fixed; only `now` advances. This is what the component's
     own 30-second tick is for -- an idle page gets 304s from /api/state and
     would otherwise never re-read the clock at all. */
  const slot = at(20);
  assert.equal(bookingUrgency(slot, now), "later");
  assert.equal(bookingUrgency(slot, now + 10 * 60_000), "soon");
  assert.equal(bookingUrgency(slot, now + 25 * 60_000), "due");
});
