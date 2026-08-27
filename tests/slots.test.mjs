import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/* Mirrors slotTimes/isRealSlot in src/lib/data.ts.

   Bookings must tile the session: 1:00-1:20, 1:20-1:40, and so on, with
   no two teams ever holding overlapping time. The database only refuses
   two bookings that share a start time, so the thing that actually
   prevents an overlap is every accepted booking sitting exactly on the
   panel's grid. These cover that. */

const event = JSON.parse(readFileSync(new URL("../config/event.json", import.meta.url)));

function slotTimes(panel) {
  if (!panel.slot_start_at || panel.slot_count <= 0 || panel.slot_minutes <= 0) return [];
  const startMs = new Date(panel.slot_start_at).getTime();
  if (Number.isNaN(startMs)) return [];
  const lengthMs = panel.slot_minutes * 60_000;
  return Array.from({ length: panel.slot_count }, (_, i) => ({
    start: new Date(startMs + i * lengthMs),
    end: new Date(startMs + (i + 1) * lengthMs),
  }));
}

function isRealSlot(panel, start, end) {
  return slotTimes(panel).some(
    (s) => s.start.getTime() === start.getTime() && s.end.getTime() === end.getTime(),
  );
}

const panel = {
  slot_start_at: "2026-09-01T13:00:00.000Z",
  slot_minutes: 20,
  slot_count: 4,
};
const at = (hhmm) => new Date(`2026-09-01T${hhmm}:00.000Z`);

test("slots run back to back with no gap and no overlap", () => {
  const times = slotTimes(panel).map((s) => [
    s.start.toISOString().slice(11, 16),
    s.end.toISOString().slice(11, 16),
  ]);
  assert.deepEqual(times, [
    ["13:00", "13:20"],
    ["13:20", "13:40"],
    ["13:40", "14:00"],
    ["14:00", "14:20"],
  ]);

  /* Each slot starts exactly where the last one ended. */
  const slots = slotTimes(panel);
  for (let i = 1; i < slots.length; i++) {
    assert.equal(
      slots[i].start.getTime(),
      slots[i - 1].end.getTime(),
      `slot ${i} does not begin where slot ${i - 1} ended`,
    );
  }
});

test("no two slots in the grid overlap", () => {
  const slots = slotTimes(panel);
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const overlaps =
        slots[i].start.getTime() < slots[j].end.getTime() &&
        slots[j].start.getTime() < slots[i].end.getTime();
      assert.ok(!overlaps, `slots ${i} and ${j} overlap`);
    }
  }
});

test("a real slot is accepted", () => {
  assert.ok(isRealSlot(panel, at("13:00"), at("13:20")));
  assert.ok(isRealSlot(panel, at("13:20"), at("13:40")));
  assert.ok(isRealSlot(panel, at("14:00"), at("14:20")));
});

test("a time that straddles two slots is refused", () => {
  /* The case the one-team-per-start-time rule cannot catch: 13:10-13:30
     shares a start time with nothing, yet overlaps both 13:00-13:20 and
     13:20-13:40. */
  assert.ok(!isRealSlot(panel, at("13:10"), at("13:30")));
});

test("a right start with a wrong end is refused", () => {
  /* Otherwise the stored finish time would disagree with the grid and the
     screens would show a slot running long. */
  assert.ok(!isRealSlot(panel, at("13:00"), at("13:40")));
  assert.ok(!isRealSlot(panel, at("13:00"), at("13:10")));
});

test("a time past the end of the grid is refused", () => {
  assert.ok(!isRealSlot(panel, at("14:20"), at("14:40")));
});

test("a time before the grid starts is refused", () => {
  assert.ok(!isRealSlot(panel, at("12:40"), at("13:00")));
});

test("a panel running no slots accepts none", () => {
  assert.deepEqual(slotTimes({ ...panel, slot_count: 0 }), []);
  assert.ok(!isRealSlot({ ...panel, slot_count: 0 }, at("13:00"), at("13:20")));
  assert.deepEqual(slotTimes({ ...panel, slot_start_at: null }), []);
  /* A zero or negative length would otherwise make every slot the same
     instant, so every booking would collide on one start time. */
  assert.deepEqual(slotTimes({ ...panel, slot_minutes: 0 }), []);
});

test("an unparseable start time yields no slots rather than Invalid Date", () => {
  assert.deepEqual(slotTimes({ ...panel, slot_start_at: "not a date" }), []);
});

test("the configured booking length is 20 minutes", () => {
  assert.equal(event.booking.slotMinutes, 20);
  /* A whole number of minutes keeps the grid on clock times people can
     read out loud. */
  assert.equal(event.booking.slotMinutes % 1, 0);
});

test("the source still validates both ends of a slot", () => {
  const src = readFileSync(new URL("../src/lib/data.ts", import.meta.url), "utf8");
  assert.ok(src.includes("export function isRealSlot"), "isRealSlot was renamed or removed");
  assert.ok(
    src.includes("s.end.getTime() === end.getTime()"),
    "isRealSlot no longer checks the end time",
  );
});

test("the booking route checks the slot against the panel", () => {
  const src = readFileSync(
    new URL("../src/app/api/requests/route.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    src.includes("isRealSlot("),
    "the request route no longer validates bookings against the panel's grid",
  );
});
