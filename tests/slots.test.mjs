import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { isRealSlot, slotTimes } from "../src/lib/data";

/* slotTimes/isRealSlot in src/lib/data.ts, run as they are.

   Bookings must tile the session: 1:00-1:20, 1:20-1:40, and so on, with
   no two teams ever holding overlapping time. The database only refuses
   two bookings that share a start time, so the thing that actually
   prevents an overlap is every accepted booking sitting exactly on the
   panel's grid. These cover that. */

const event = JSON.parse(readFileSync(new URL("../config/event.json", import.meta.url)));

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

/* ---- slot windows: per-day open / end / break --------------------------- */

const bk = (day, hhmm) => `2026-11-${day}T${hhmm}:00+07:00`;
const clock = (d) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(11, 16);
const day = (d, open, end, from = null, to = null) => ({
  open_at: bk(d, open),
  end_at: bk(d, end),
  break_from: from ? bk(d, from) : null,
  break_to: to ? bk(d, to) : null,
});
const windows = (over = {}) => ({
  slot_start_at: null,
  slot_minutes: 15,
  slot_count: 0,
  slot_days: [day(21, "10:00", "16:00", "12:00", "13:00"), day(22, "09:00", "12:00")],
  ...over,
});

test("two days with a lunch break give 20 + 12 slots", () => {
  const slots = slotTimes(windows());
  assert.equal(slots.length, 32);
  const day1 = slots.slice(0, 20).map((s) => clock(s.start));
  assert.equal(day1[0], "10:00");
  assert.equal(day1[7], "11:45");
  assert.equal(day1[8], "13:00");
  assert.equal(day1[19], "15:45");
  const day2 = slots.slice(20).map((s) => clock(s.start));
  assert.equal(day2[0], "09:00");
  assert.equal(day2[11], "11:45");
});

test("a slot ending exactly at the break is kept, one crossing it is dropped, afternoon restarts at break_to", () => {
  const p = windows({ slot_minutes: 20, slot_days: [day(21, "10:00", "12:00", "11:00", "11:30")] });
  assert.deepEqual(slotTimes(p).map((s) => clock(s.start)), ["10:00", "10:20", "10:40", "11:30"]);
  const starts = slotTimes(p).map((s) => clock(s.start));
  assert.ok(!starts.includes("11:00") && !starts.includes("11:20"));
  assert.equal(clock(slotTimes(p)[2].end), "11:00");
});

test("a slot crossing end is dropped; one ending exactly at end is kept", () => {
  const p = windows({ slot_minutes: 20, slot_days: [day(21, "10:00", "10:50")] });
  assert.deepEqual(slotTimes(p).map((s) => clock(s.start)), ["10:00", "10:20"]);
  const exact = windows({ slot_minutes: 20, slot_days: [day(21, "10:00", "10:40")] });
  assert.deepEqual(slotTimes(exact).map((s) => clock(s.start)), ["10:00", "10:20"]);
});

test("legacy panel (no slot_days) gives today's slots", () => {
  const fromLegacy = (p) => slotTimes(p).map((s) => [s.start.toISOString(), s.end.toISOString()]);
  const today = fromLegacy(panel);
  assert.equal(today.length, 4);
  assert.deepEqual(fromLegacy({ ...panel, slot_days: [] }), today);
  assert.equal(today[0][0], "2026-09-01T13:00:00.000Z");
  assert.equal(today[3][1], "2026-09-01T14:20:00.000Z");
});

test("slot_days wins over legacy fields when both are set", () => {
  const p = { ...panel, slot_days: [day(21, "10:00", "10:30")], slot_minutes: 15 };
  assert.deepEqual(slotTimes(p).map((s) => clock(s.start)), ["10:00", "10:15"]);
});

test("isRealSlot refuses a break time, an off-grid time and a third day; accepts a Day 2 slot", () => {
  const p = windows();
  const t = (d, hhmm) => new Date(bk(d, hhmm));
  const plus = (d, m) => new Date(d.getTime() + m * 60_000);
  assert.equal(isRealSlot(p, t(21, "12:15"), plus(t(21, "12:15"), 15)), false, "inside the break");
  assert.equal(isRealSlot(p, t(22, "09:07"), plus(t(22, "09:07"), 15)), false, "off the grid");
  assert.equal(isRealSlot(p, t(23, "10:00"), plus(t(23, "10:00"), 15)), false, "no Day 3");
  assert.equal(isRealSlot(p, t(22, "09:15"), t(22, "09:30")), true);
});
