import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BookingTime, formatClock, slotLabel } from "../src/components/ui";

/* Anchored in Bangkok (+07:00) so the weekday does not depend on the machine's zone. */
const DAY1_NOON = Date.parse("2026-11-21T12:00:00+07:00"); // Saturday
const DAY2_SLOT = "2026-11-22T09:15:00+07:00"; // Sunday

test("a slot on the same Bangkok day reads as the clock alone", () => {
  const iso = "2026-11-21T15:45:00+07:00";
  assert.equal(slotLabel(iso, DAY1_NOON), formatClock(iso));
});

test("a slot on another day reads weekday + clock: Day 2 seen from Day 1", () => {
  assert.equal(slotLabel(DAY2_SLOT, DAY1_NOON), `Sun ${formatClock(DAY2_SLOT)}`);
});

test("the day is Bangkok's, not the machine's: 00:30 on Day 2 is not Day 1 late at night", () => {
  const lateDay1 = Date.parse("2026-11-21T23:50:00+07:00");
  const iso = "2026-11-22T00:30:00+07:00";
  assert.equal(slotLabel(iso, lateDay1), `Sun ${formatClock(iso)}`);
});

test("no time reads as a dash", () => {
  assert.equal(slotLabel(null, DAY1_NOON), "—");
});

test("BookingTime reads a booking on another day with its weekday, and the title keeps it", () => {
  const iso = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const markup = renderToStaticMarkup(createElement(BookingTime, { slotStart: iso, status: "scheduled" }));
  const text = markup.replace(/<[^>]+>/g, "");
  assert.match(text, /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /);
  assert.ok(text.includes(slotLabel(iso)));
});
