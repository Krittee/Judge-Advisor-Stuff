import assert from "node:assert/strict";
import test from "node:test";

import {
  bookBar,
  canBook,
  pillText,
  requestOf,
  rowState,
  slotsModel,
  tabFrom,
  teamList,
  toggleLanguage,
} from "../src/components/coordinator/coordinatorLogic";
import { bookLanguageFor, slotTime } from "../src/components/desk/deskLogic";
import { bookingLanguage } from "../src/lib/presets";
import type { PublicPanel, RequestRow, Team } from "../src/lib/types";

/* The coordinator console's decisions, run for real against
   src/components/coordinator/coordinatorLogic.ts. How they are drawn is in
   coordinatorPage.runtime.test.tsx. */

const ORDER = ["en", "th"];

const team = (number: string, over: Partial<Team> = {}): Team =>
  ({ id: `t-${number}`, number, name: `Team ${number}`, panel_id: "p3", division: "Middle School", category: "developing", pit: null, languages: ["th"], created_at: "", ...over }) as Team;

const BASE = Date.parse("2099-01-01T10:00:00.000Z");
const at = (n: number, minutes = 20) => new Date(BASE + n * minutes * 60_000).toISOString();

const panel = (id: string, over: Partial<PublicPanel> = {}): PublicPanel => ({
  id, name: `Panel ${id.slice(1)}`, division: "Middle School", judges: [], languages: ["th"], sort_order: 1,
  slot_start_at: at(0), slot_minutes: 20, slot_count: 6, slot_days: [], ...over,
});
const p2 = panel("p2", { languages: ["en"] });
const p3 = panel("p3");

const req = (who: Team, status: RequestRow["status"], over: Partial<RequestRow> = {}): RequestRow =>
  ({ id: `r-${who.number}-${status}`, team_id: who.id, panel_id: who.panel_id, status, kind: "queue", language: "en", slot_start: null, slot_end: null, finished_at: null, updated_at: "", ...over }) as RequestRow;
const booking = (who: Team, n: number, minutes = 20, panel_id = who.panel_id): RequestRow =>
  req(who, "scheduled", { kind: "slot", panel_id, slot_start: at(n, minutes), slot_end: at(n + 1, minutes) });

/* ---- the chips ---------------------------------------------------------------------- */

test("toggleLanguage adds or removes one language and keeps the config order", () => {
  assert.deepEqual(toggleLanguage([], "th", ORDER), ["th"]);
  assert.deepEqual(toggleLanguage(["th"], "en", ORDER), ["en", "th"], "EN lit after TH is still EN, TH");
  assert.deepEqual(toggleLanguage(["en", "th"], "en", ORDER), ["th"]);
  assert.deepEqual(toggleLanguage(["th"], "th", ORDER), [], "the last one off is 'not asked' again");
});

/* ---- the Teams list ------------------------------------------------------------------------ */

const rows = (
  teams: Team[],
  filter: Partial<Parameters<typeof teamList>[2]> = {},
  requests: RequestRow[] = [],
) => teamList(teams, requests, { query: "", division: "", notAskedOnly: false, ...filter });

test("teams come in walking order: down the pit rows, then by number; no pit last", () => {
  const list = [
    team("9000Z", { pit: null }), team("2011A", { pit: "A3" }), team("4410C", { pit: "A9" }),
    team("1234A", { pit: "A6" }), team("9882K", { pit: "B4" }), team("100A", { pit: "A3" }),
  ];
  assert.deepEqual(rows(list).rows.map((r) => r.team.number), ["100A", "2011A", "1234A", "4410C", "9882K", "9000Z"]);
});

test("search matches a number's start or a name's part; division narrows; the Not asked toggle keeps teams with no language", () => {
  const list = [
    team("2011A", { name: "Gear Gremlins" }),
    team("2012B", { name: "Robo Rangers", languages: [] }),
    team("5150Z", { name: "Sparky", division: "High School", languages: [] }),
  ];
  assert.deepEqual(rows(list, { query: "20" }).rows.map((r) => r.team.number), ["2011A", "2012B"]);
  assert.deepEqual(rows(list, { query: "GREM" }).rows.map((r) => r.team.number), ["2011A"]);
  assert.deepEqual(rows(list, { division: "High School" }).rows.map((r) => r.team.number), ["5150Z"]);
  assert.deepEqual(rows(list, { notAskedOnly: true }).rows.map((r) => r.team.number), ["2012B", "5150Z"]);
});

test("the counts follow the search and division but not the Not asked toggle itself", () => {
  const list = [team("1A"), team("2A", { languages: [] }), team("3A", { languages: ["en", "th"] }), team("4A", { languages: [], division: "High School" })];
  const all = rows(list);
  assert.deepEqual([all.total, all.asked, all.notAsked], [4, 2, 2]);
  const toggled = rows(list, { notAskedOnly: true });
  assert.deepEqual([toggled.total, toggled.asked, toggled.notAsked], [4, 2, 2], "turning it on does not change what it counts");
  assert.equal(toggled.rows.length, 2);
  const ms = rows(list, { division: "Middle School" });
  assert.deepEqual([ms.total, ms.asked, ms.notAsked], [3, 2, 1]);
});

test("a team's pill is its live request, else its booking, else the interview it has had", () => {
  const t = team("7700B");
  const done = req(t, "completed", { finished_at: "2099-01-01T09:00:00.000Z" });
  const later = req(t, "completed", { id: "later", finished_at: "2099-01-01T11:00:00.000Z" });
  const live = req(t, "requested");
  const booked = booking(t, 3);
  assert.equal(requestOf(t.id, [done, later]), later, "the latest finished one");
  assert.equal(requestOf(t.id, [done, booked]), booked);
  assert.equal(requestOf(t.id, [done, booked, live]), live);
  assert.equal(requestOf(t.id, [req(t, "cancelled")]), null, "a cancelled request says nothing");
  assert.equal(requestOf("nobody", [live]), null);
});

test("pill words: a booking carries its time, the rest are the status's short word", () => {
  assert.equal(pillText({ status: "scheduled", slot_start: at(3) }), `Booked ${slotTime(at(3))}`);
  assert.equal(pillText({ status: "scheduled", slot_start: null }), "Booked");
  assert.equal(pillText({ status: "acknowledged", slot_start: null }), "On the way");
  assert.equal(pillText({ status: "interviewing", slot_start: null }), "Interviewing");
});

/* ---- what an opened row offers --------------------------------------------------------------- */

test("row state: held beats everything; then no language; then no panel; else ready", () => {
  const t = team("7700B");
  const noLang = team("5150Z", { languages: [] });
  for (const status of ["requested", "acknowledged", "interviewing", "scheduled"] as const) {
    const r = req(t, status);
    assert.deepEqual(rowState(t, p3, r), { kind: "held", request: r }, status);
  }
  assert.deepEqual(rowState(noLang, p3, req(noLang, "requested")).kind, "held", "even a team with no language");
  assert.deepEqual(rowState(t, p3, req(t, "completed")), { kind: "ready", panel: p3 }, "an interview already had does not hold the team");
  assert.deepEqual(rowState(noLang, p3, null), { kind: "no-language" });
  assert.deepEqual(rowState(noLang, null, null), { kind: "no-language" }, "language comes first");
  assert.deepEqual(rowState(t, null, null), { kind: "no-panel" });
  assert.deepEqual(rowState(t, p3, null), { kind: "ready", panel: p3 });
});

/* ---- the booking language --------------------------------------------------------------------- */

test("a bilingual team on a Thai-only panel is booked in Thai by both the desk and the coordinator", () => {
  const t = team("7700B", { languages: ["en", "th"] });
  const thaiOnly = panel("p3", { languages: ["th"] });
  assert.equal(bookLanguageFor(null, t, "en", thaiOnly), "th");
  assert.equal(bookingLanguage(undefined, t, thaiOnly), "th", "the Slots tab's bar sends this one");
});

/* ---- the Slots tab ---------------------------------------------------------------------------------- */

test("the pinned bar: nobody, somebody who cannot be booked (and why), somebody who can", () => {
  const t = team("7700B");
  assert.deepEqual(bookBar(null, null, null), { kind: "none" });
  assert.deepEqual(bookBar(t, p3, req(t, "scheduled")).kind, "held");
  assert.deepEqual(bookBar(team("5150Z", { languages: [] }), p3, null).kind, "no-language");
  assert.deepEqual(bookBar(t, null, null).kind, "no-panel");
  assert.deepEqual(bookBar(t, p3, null), { kind: "ready", team: t, panel: p3 });
});

const NOW = BASE + 30 * 60_000; // the first slot (10:00-10:20) is over
const model = (over: Partial<Parameters<typeof slotsModel>[0]> = {}) => {
  const mine = team("7700B");
  const other = team("4410C");
  return slotsModel({
    teams: [mine, other, team("1111T", { panel_id: "p2", languages: ["en"] })],
    panels: [p2, p3],
    requests: [booking(other, 2)],
    chosenId: mine.id,
    panelPick: null,
    picked: null,
    now: NOW,
    ...over,
  });
};

test("a panel's day leaves past slots out, counts what is open, and shows who holds the rest", () => {
  const m = model();
  assert.equal(m.panel?.id, "p3", "the chosen team's panel");
  assert.equal(m.slots.length, 6, "the whole day is kept for the 'nothing left' wording");
  assert.deepEqual(m.lines.map((l) => l.kind), ["open", "taken", "open", "open", "open"], "slot 0 is over and not drawn");
  assert.equal(m.open, 4);
  assert.equal(m.lines[1].slot.takenBy?.teamNumber, "4410C");
});

test("Book is live only for a chosen team, on its own panel, in an open slot", () => {
  const m = model();
  assert.deepEqual(m.lines.map((l) => canBook(m.bar, l)), [true, false, true, true, true], "taken is not bookable");

  const elsewhere = model({ panelPick: "p2" });
  assert.equal(elsewhere.panel?.id, "p2");
  assert.ok(elsewhere.lines.every((l) => !canBook(elsewhere.bar, l)), "the chosen team's panel is Panel 3, not Panel 2");

  const nobody = model({ chosenId: null });
  assert.deepEqual(nobody.bar, { kind: "none" });
  assert.equal(nobody.panel?.id, "p2", "no team chosen: the first panel");
  assert.equal(model({ chosenId: null, panelPick: "gone" }).panel?.id, "p2", "a panel that no longer exists is not shown");
  assert.ok(nobody.lines.every((l) => !canBook(nobody.bar, l)));
});

test("a slot too close to another booking reads as such and cannot be booked", () => {
  const tight = panel("p3", { slot_minutes: 10, slot_count: 6 });
  const other = team("4410C");
  const m = model({ panels: [p2, tight], requests: [booking(other, 3, 10)], now: BASE });
  assert.deepEqual(m.lines.map((l) => l.kind), ["open", "open", "too-close", "taken", "too-close", "open"]);
  assert.equal(m.open, 3);
  assert.ok(!canBook(m.bar, m.lines[2]));
});

test("the picked slot counts only while it can still be booked", () => {
  const m = model({ picked: at(2) });
  assert.equal(m.chosen, null, "someone else holds it now");
  assert.equal(model({ picked: at(3) }).chosen?.start, at(3));
  assert.equal(model({ picked: at(3), panelPick: "p2" }).chosen, null, "that slot is on another panel");
  assert.equal(model({ picked: at(3), chosenId: null }).chosen, null, "nobody to book it for");
  assert.equal(model({ picked: at(0) }).chosen, null, "it is over");
});

test("a chosen team that has since been booked cannot book again", () => {
  const mine = team("7700B");
  const m = model({ requests: [booking(mine, 4)], picked: at(3) });
  assert.equal(m.bar.kind, "held");
  assert.equal(m.chosen, null);
  assert.ok(m.lines.every((l) => !canBook(m.bar, l)));
});

/* ---- the tab in the URL --------------------------------------------------------------------------------- */

test("?tab=slots is Slots; anything else is Teams", () => {
  assert.equal(tabFrom("slots"), "slots");
  assert.equal(tabFrom("teams"), "teams");
  assert.equal(tabFrom(null), "teams");
  assert.equal(tabFrom("SLOTS"), "teams");
});

test("the model carries the same day headings and break as the desk grid", () => {
  const two = panel("p3", {
    slot_start_at: "2026-11-21T10:00:00+07:00", slot_minutes: 15, slot_count: 32,
    slot_days: [
      { open_at: "2026-11-21T10:00:00+07:00", end_at: "2026-11-21T16:00:00+07:00", break_from: "2026-11-21T12:00:00+07:00", break_to: "2026-11-21T13:00:00+07:00" },
      { open_at: "2026-11-22T09:00:00+07:00", end_at: "2026-11-22T12:00:00+07:00", break_from: null, break_to: null },
    ],
  });
  const m = model({ panels: [p2, two], now: Date.parse("2026-11-21T11:00:00+07:00") });
  assert.equal(m.showDayHeadings, true);
  assert.deepEqual(m.days.map((d) => [d.label, d.open]), [["Day 1 · Sat 21 Nov", 16], ["Day 2 · Sun 22 Nov", 12]]);
  assert.equal(m.days[0].breakLabel, "12:00–13:00 · Break");
  assert.equal(m.open, 28);
  assert.equal(m.lines.length, m.days.flatMap((d) => d.rows.flatMap((r) => r.cells)).length);
  assert.equal(model().showDayHeadings, false, "a one-day panel has none");
});
