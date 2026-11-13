import assert from "node:assert/strict";
import test from "node:test";

import { MAX_SLOT_DAYS, MAX_TOTAL_SLOTS, parseSlotDays, slotSummaryFields } from "../src/lib/data";

/* parseSlotDays / slotSummaryFields: the one place a slotDays body is checked. */

const at = (d, hhmm) => `2026-11-${d}T${hhmm}:00+07:00`;
const day = (d, open, end, from = null, to = null) => ({
  open_at: at(d, open),
  end_at: at(d, end),
  break_from: from ? at(d, from) : null,
  break_to: to ? at(d, to) : null,
});
const day1 = day(21, "10:00", "16:00", "12:00", "13:00");
const day2 = day(22, "09:00", "12:00");

const refuses = (raw, minutes, pattern) => {
  const out = parseSlotDays(raw, minutes);
  assert.ok("error" in out, `expected an error, got ${JSON.stringify(out)}`);
  assert.match(out.error, pattern);
};

test("accepts [] and the two example days", () => {
  assert.deepEqual(parseSlotDays([], 15), { days: [] });
  const ok = parseSlotDays([day1, day2], 15);
  assert.ok("days" in ok);
  assert.equal(ok.days.length, 2);
  assert.equal(ok.days[0].open_at, "2026-11-21T03:00:00.000Z");
  assert.equal(ok.days[0].break_to, "2026-11-21T06:00:00.000Z");
  assert.equal(ok.days[1].break_from, null);
});

test("returns the days sorted when given in reverse order", () => {
  const ok = parseSlotDays([day2, day1], 15);
  assert.ok("days" in ok);
  assert.deepEqual(ok.days.map((d) => d.open_at), ["2026-11-21T03:00:00.000Z", "2026-11-22T02:00:00.000Z"]);
});

test("refuses each bad day and names it", () => {
  refuses([day(21, "10:00", "10:00")], 15, /^Day 1: .*end time must be after the open time/);
  refuses([day1, day(22, "12:00", "09:00")], 15, /^Day 2: .*after the open time/);
  refuses([{ ...day1, end_at: at(22, "10:00") }], 15, /^Day 1: .*same date/);
  refuses([{ ...day1, break_to: null }], 15, /^Day 1: .*both break times, or neither/);
  refuses([{ ...day1, break_from: null }], 15, /^Day 1: .*both break times, or neither/);
  refuses([day(21, "10:00", "16:00", "09:00", "11:00")], 15, /^Day 1: .*break must fall within/);
  refuses([day(21, "10:00", "16:00", "15:00", "17:00")], 15, /^Day 1: .*break must fall within/);
  refuses([day(21, "10:00", "16:00", "13:00", "12:00")], 15, /^Day 1: .*break/);
  refuses([day(21, "10:00", "16:00", "12:00", "12:00")], 15, /^Day 1: .*break/);
  refuses([day1, day(21, "17:00", "18:00")], 15, /^Day 2: .*another day is already on/);
  refuses([day(21, "10:00", "10:10")], 15, /^Day 1: .*no slot fits/);
  refuses([{ ...day1, open_at: "tomorrow at ten" }], 15, /^Day 1: .*real times/);
  refuses([{ ...day1, open_at: "2026-11-21 10:00" }], 15, /^Day 1: .*real times/);
  refuses("nope", 15, /list/);
});

test("refuses more than MAX_SLOT_DAYS days", () => {
  const many = Array.from({ length: MAX_SLOT_DAYS + 1 }, (_, i) => day(String(10 + i), "10:00", "11:00"));
  refuses(many, 15, /at most 7 days/);
  assert.ok("days" in parseSlotDays(many.slice(0, MAX_SLOT_DAYS), 15));
});

test("refuses a total over MAX_TOTAL_SLOTS", () => {
  // 3-minute slots: 10:00-18:00 is 160 a day, two days is 320.
  assert.equal(MAX_TOTAL_SLOTS, 200);
  refuses([day(21, "10:00", "18:00"), day(22, "10:00", "18:00")], 3, /320 slots; the most is 200/);
  assert.ok("days" in parseSlotDays([day(21, "10:00", "18:00")], 3));
});

test("slotSummaryFields gives the first open and the total count", () => {
  const ok = parseSlotDays([day2, day1], 15);
  assert.deepEqual(slotSummaryFields(ok.days, 15), { slot_start_at: "2026-11-21T03:00:00.000Z", slot_count: 32 });
  assert.deepEqual(slotSummaryFields([], 15), { slot_start_at: null, slot_count: 0 });
});

test("errors name the day by the position the user entered, not the sorted one", () => {
  // Given reversed: the first-entered day (Day 2 chronologically) has the bad end.
  refuses([{ ...day2, end_at: day2.open_at }, day1], 15, /^Day 1: .*end time must be after the open time/);
  refuses([day1, { ...day2, open_at: "soon" }], 15, /^Day 2: .*real times/);
  refuses([{ ...day1, open_at: "soon" }, day2], 15, /^Day 1: .*real times/);
});

test("slotSummaryFields picks the first day by instant, not by string", () => {
  // 10:00+07:00 is 03:00Z, earlier than 04:00Z, though it sorts later as text.
  const other = { open_at: "2026-11-21T04:00:00.000Z", end_at: "2026-11-21T06:00:00.000Z", break_from: null, break_to: null };
  const first = { open_at: "2026-11-21T10:00:00+07:00", end_at: "2026-11-21T12:00:00+07:00", break_from: null, break_to: null };
  assert.equal(slotSummaryFields([other, first], 15).slot_start_at, first.open_at);
});
