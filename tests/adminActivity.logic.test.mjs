import assert from "node:assert/strict";
import test from "node:test";

import {
  actionParts,
  actorName,
  bannerText,
  chipCounts,
  clockText,
  dotFor,
  filterRows,
  footText,
  hourGroups,
  KIND_CHIPS,
  KIND_NAMES,
  namedFlag,
  NO_FILTERS,
  NO_POLL,
  polled,
  shownRole,
  spansDays,
  teamOf,
  updatedText,
  whoLabel,
  whoOptions,
} from "../src/components/admin/activityLogic";

/* The Judge Advisor Activity tab's decisions, run for real against
   src/components/admin/activityLogic.ts. How they are drawn is in
   adminActivity.runtime.test.tsx. Times are built in the machine's own zone,
   because the timeline reads the viewer's clock. */

/** 21 Oct 2026 at h:m local, as the ISO string the API sends. */
const at = (h, m, day = 21) => new Date(2026, 9, day, h, m).toISOString();

const kinds = [
  { id: "good", label: "Good conduct", short: "Good", color: "emerald", severity: 0, requiresRule: false },
  { id: "warning", label: "Warning", short: "Warning", color: "amber", severity: 1, requiresRule: false },
  { id: "minor", label: "Minor violation", short: "Minor", color: "orange", severity: 2, requiresRule: true },
  { id: "major", label: "Major violation", short: "Major", color: "rose", severity: 3, requiresRule: true },
  { id: "dq", label: "Disqualified", short: "DQ", color: "black", severity: 4, requiresRule: true },
];

let n = 0;
const entry = (kind, time, over = {}) => ({
  id: `a${++n}`,
  request_id: null,
  team_id: null,
  kind,
  actor: "Alex Morgan",
  actor_role: "Judge Advisor",
  action: "did something",
  detail: null,
  created_at: time,
  team_number: null,
  ...over,
});

/** Newest first, as the API sends it. */
const log = [
  entry("request", at(11, 42), { actor: "Priya Nair", actor_role: "Panel 2", action: "→ Interview in progress", team_id: "t-2011A", team_number: "2011A" }),
  entry("request", at(11, 40), { actor: "Front desk", actor_role: "Front desk", action: "joined queue", team_id: "t-9882K", team_number: "9882K" }),
  entry("referee", at(11, 38), { actor: "Jordan Lee", actor_role: "Referee", action: "flagged minor", team_id: "t-9882K", team_number: "9882K" }),
  entry("referee", at(11, 12), { action: "corrected a flag: warning → minor", team_id: "t-6036D", team_number: "6036D" }),
  entry("request", at(11, 5), { actor: "team", actor_role: "Team", action: "booked slot", team_id: "t-4410C", team_number: "4410C" }),
  entry("conflict", at(10, 42), { action: "declared conflicts of interest", detail: "Priya Nair: 9882K, 7700B" }),
  entry("setup", at(10, 15), { action: "Referee setup: V5RC" }),
  entry("setup", at(9, 55), { action: "imported teams", detail: "46 teams · 12 new" }),
];

/* ---- the hours ---------------------------------------------------------------- */

test("entries are grouped by the hour they happened in, newest hour first, with their count", () => {
  const groups = hourGroups(log);
  assert.deepEqual(
    groups.map((g) => [g.label, g.count, g.rows.length]),
    [
      ["11:00–11:59", "5 events", 5],
      ["10:00–10:59", "2 events", 2],
      ["09:00–09:59", "1 event", 1],
    ],
  );
  // Inside an hour the order the API gave is kept: newest first.
  assert.deepEqual(groups[0].rows.map((r) => clockText(r.created_at)), ["11:42", "11:40", "11:38", "11:12", "11:05"]);
  assert.equal(groups.reduce((sum, g) => sum + g.rows.length, 0), log.length, "every entry is in exactly one hour");
});

test("the same clock hour on two days is two groups, and then each says which day", () => {
  const twoDays = [entry("setup", at(11, 30, 21)), entry("setup", at(11, 10, 20))];
  assert.equal(hourGroups(twoDays).length, 2);
  assert.equal(spansDays(twoDays), true);
  assert.equal(spansDays(log), false);
  assert.deepEqual(hourGroups(twoDays, true).map((g) => g.label), ["Wed 21 Oct · 11:00–11:59", "Tue 20 Oct · 11:00–11:59"]);
  assert.deepEqual(hourGroups([]), []);
});

test("times read as 24-hour hh:mm and the update line says how often it refreshes", () => {
  assert.equal(clockText(at(9, 5)), "09:05");
  assert.equal(clockText(at(23, 59)), "23:59");
  assert.equal(updatedText(at(11, 42)), "Updated 11:42 · refreshes every 10 s");
});

test("the footer names the 150 once the log is that long, and the whole log before", () => {
  assert.equal(footText(150), "Showing the latest 150 events");
  assert.equal(footText(12), "Showing all 12 events");
  assert.equal(footText(1), "Showing all 1 event");
});

/* ---- the filters --------------------------------------------------------------- */

test("the kind chips count the loaded entries, whatever else is filtered", () => {
  assert.deepEqual(chipCounts(log), { all: 8, request: 3, referee: 2, conflict: 1, setup: 2, award: 0 });
  assert.deepEqual(chipCounts([]), { all: 0, request: 0, referee: 0, conflict: 0, setup: 0, award: 0 });
});

test("the kind filter keeps one kind, and All keeps everything", () => {
  assert.equal(filterRows(log, NO_FILTERS).length, 8);
  for (const [kind, count] of [["request", 3], ["referee", 2], ["conflict", 1], ["setup", 2]]) {
    const shown = filterRows(log, { ...NO_FILTERS, kind });
    assert.equal(shown.length, count, kind);
    assert.ok(shown.every((r) => r.kind === kind));
  }
});

test("every kind the log can hold has a chip, so the awards entries can be filtered to", () => {
  assert.deepEqual(KIND_CHIPS.map((c) => c.id), ["all", "request", "referee", "conflict", "setup", "award"]);
  assert.equal(KIND_CHIPS.at(-1).label, "Awards");
  assert.deepEqual(Object.keys(KIND_NAMES).sort(), KIND_CHIPS.map((c) => c.id).filter((id) => id !== "all").sort());
  const rows = [...log, { ...log[0], id: "aw1", kind: "award", action: "gave Design to 2088C" }, { ...log[0], id: "aw2", kind: "award", action: "nominated 7700B for Excellence" }];
  assert.deepEqual(filterRows(rows, { ...NO_FILTERS, kind: "award" }).map((r) => r.id), ["aw1", "aw2"]);
  assert.equal(chipCounts(rows).award, 2);
  assert.equal(dotFor(rows.at(-1), []), "ja-ac-d-award");
});

test("the team search matches inside the number, in any case, and drops entries that name no team", () => {
  const numbers = (team) => filterRows(log, { ...NO_FILTERS, team }).map((r) => r.team_number);
  assert.deepEqual(numbers("9882K"), ["9882K", "9882K"]);
  assert.deepEqual(numbers("9882k"), ["9882K", "9882K"]);
  assert.deepEqual(numbers("  98 "), ["9882K", "9882K"], "a part of the number, trimmed");
  assert.deepEqual(numbers("r"), [], "R is in no team here: 6036D is D, 4410C is C");
  assert.equal(numbers("A").length, 1, "2011A");
  assert.equal(filterRows(log, { ...NO_FILTERS, team: "7700B" }).length, 0, "a team named only in a detail is not a team of the entry");
  assert.equal(filterRows(log, { ...NO_FILTERS, team: "   " }).length, 8, "blank is off");
});

test("the Who filter keeps one actor", () => {
  const who = (label) => filterRows(log, { ...NO_FILTERS, who: label }).map((r) => clockText(r.created_at));
  assert.deepEqual(who("Alex Morgan · Judge Advisor"), ["11:12", "10:42", "10:15", "09:55"]);
  assert.deepEqual(who("Priya Nair · Panel 2"), ["11:42"]);
  assert.deepEqual(who("Front desk"), ["11:40"]);
  assert.deepEqual(who("Team"), ["11:05"]);
  assert.deepEqual(who("Nobody"), []);
});

test("the three filters combine: an entry has to pass all of them", () => {
  const f = (over) => filterRows(log, { ...NO_FILTERS, ...over }).map((r) => clockText(r.created_at));
  assert.deepEqual(f({ kind: "referee", team: "9882K" }), ["11:38"]);
  assert.deepEqual(f({ kind: "referee", who: "Alex Morgan · Judge Advisor" }), ["11:12"]);
  assert.deepEqual(f({ team: "9882K", who: "Front desk" }), ["11:40"]);
  assert.deepEqual(f({ kind: "request", team: "9882K", who: "Front desk" }), ["11:40"]);
  // Passing two of the three is not enough.
  assert.deepEqual(f({ kind: "referee", team: "9882K", who: "Front desk" }), []);
  assert.deepEqual(f({ kind: "setup", team: "9882K" }), []);
});

test("filtering regroups the hours: an hour with nothing left disappears and the counts follow", () => {
  const groups = hourGroups(filterRows(log, { ...NO_FILTERS, kind: "setup" }));
  assert.deepEqual(groups.map((g) => [g.label, g.count]), [["10:00–10:59", "1 event"], ["09:00–09:59", "1 event"]]);
});

/* ---- who did it ---------------------------------------------------------------- */

test("the role is not repeated when it is the name: Front desk, and the anonymous team", () => {
  const desk = { actor: "Front desk", actor_role: "Front desk" };
  const anon = { actor: "team", actor_role: "Team" };
  const priya = { actor: "Priya Nair", actor_role: "Panel 2" };
  const old = { actor: "Sam", actor_role: null };

  assert.equal(shownRole(desk), null);
  assert.equal(shownRole(anon), null);
  assert.equal(shownRole(priya), "Panel 2");
  assert.equal(shownRole(old), null);

  assert.equal(actorName(desk), "Front desk");
  assert.equal(actorName(anon), "Team", "the role's capitals");
  assert.equal(actorName(priya), "Priya Nair");

  assert.equal(whoLabel(desk), "Front desk");
  assert.equal(whoLabel(anon), "Team");
  assert.equal(whoLabel(priya), "Priya Nair · Panel 2");
  assert.equal(whoLabel(old), "Sam");
});

test("the Who select lists each actor once, by name, and keeps the chosen one listed", () => {
  assert.deepEqual(whoOptions(log), ["Alex Morgan · Judge Advisor", "Front desk", "Jordan Lee · Referee", "Priya Nair · Panel 2", "Team"]);
  assert.deepEqual(whoOptions(log, "Sam Park · Referee"), ["Alex Morgan · Judge Advisor", "Front desk", "Jordan Lee · Referee", "Priya Nair · Panel 2", "Sam Park · Referee", "Team"]);
  assert.deepEqual(whoOptions([]), []);
  // The same name on two panels is two people to filter by.
  const moved = [entry("request", at(9, 0), { actor: "Lee Chen", actor_role: "Panel 1" }), entry("request", at(9, 1), { actor: "Lee Chen", actor_role: "Panel 2" })];
  assert.deepEqual(whoOptions(moved), ["Lee Chen · Panel 1", "Lee Chen · Panel 2"]);
});

/* ---- what an entry says -------------------------------------------------------- */

test("the flag kinds inside a referee action are pulled out, to be drawn as severity pills", () => {
  assert.deepEqual(actionParts("flagged minor"), [{ text: "flagged " }, { flag: "minor" }]);
  assert.deepEqual(actionParts("corrected a flag: warning → minor"), [{ text: "corrected a flag: " }, { flag: "warning" }, { text: " → " }, { flag: "minor" }]);
  assert.deepEqual(actionParts("removed a flag: major"), [{ text: "removed a flag: " }, { flag: "major" }]);
  // Nothing else is touched: a correction that changed no kind, and the words other kinds of entry use.
  assert.deepEqual(actionParts("corrected a flag"), [{ text: "corrected a flag" }]);
  assert.deepEqual(actionParts("→ Interview in progress"), [{ text: "→ Interview in progress" }]);
  assert.deepEqual(actionParts("reassigned to Panel 2"), [{ text: "reassigned to Panel 2" }]);
});

test("an entry names the severity of the last kind in its action", () => {
  assert.equal(namedFlag("flagged major", kinds)?.id, "major");
  assert.equal(namedFlag("corrected a flag: warning → minor", kinds)?.id, "minor", "a correction takes the kind it corrected to");
  assert.equal(namedFlag("removed a flag: dq", kinds)?.id, "dq");
  assert.equal(namedFlag("corrected a flag", kinds), null);
  assert.equal(namedFlag("flagged vanished", kinds), null, "a kind the config no longer has");
  assert.equal(namedFlag("joined queue", kinds), null);
});

test("the dot: request neutral, conflict caution, setup an outline, referee the severity's colour", () => {
  const dot = (kind, action = "x") => dotFor({ kind, action }, kinds);
  assert.equal(dot("request"), "ja-ac-d-request");
  assert.equal(dot("conflict"), "ja-ac-d-conflict");
  assert.equal(dot("setup"), "ja-ac-d-setup");
  // The colour is the flag kind's own, through the same classes the Referee tab's dots wear.
  assert.equal(dot("referee", "flagged good"), "ja-ac-d-referee bg-done");
  assert.equal(dot("referee", "flagged warning"), "ja-ac-d-referee bg-caution");
  assert.equal(dot("referee", "flagged minor"), "ja-ac-d-referee bg-waiting");
  assert.equal(dot("referee", "flagged major"), "ja-ac-d-referee bg-danger");
  assert.equal(dot("referee", "flagged dq"), "ja-ac-d-referee bg-ink");
  assert.equal(dot("referee", "corrected a flag: warning → minor"), "ja-ac-d-referee bg-waiting");
  // No severity named: neutral, not the colour of some other kind.
  assert.equal(dot("referee", "corrected a flag"), "ja-ac-d-referee bg-line-strong");
  // A request that mentions a flag kind is still a request.
  assert.equal(dot("request", "flagged major"), "ja-ac-d-request");
});

/* ---- the team chip --------------------------------------------------------------- */

test("an entry's team is found on the roster; none named, several named, or gone means no team", () => {
  const roster = [{ id: "t-9882K", number: "9882K", name: "Torque Titans" }];
  assert.equal(teamOf({ team_id: "t-9882K" }, roster)?.number, "9882K");
  assert.equal(teamOf({ team_id: null }, roster), null, "an entry naming no team, or several (the API sends no team_id for those)");
  assert.equal(teamOf({ team_id: "t-gone" }, roster), null, "a team that no longer exists");
  assert.equal(teamOf({ team_id: "t-9882K" }, []), null, "the roster has not loaded");
});

/* ---- polling ----------------------------------------------------------------------- */

test("a failed poll keeps the last good log and when it came; the next success clears the error", () => {
  const good = polled(NO_POLL, { rows: log }, new Date(2026, 9, 21, 11, 42));
  assert.equal(good.rows.length, 8);
  assert.equal(clockText(good.updatedAt), "11:42");
  assert.equal(good.error, null);

  const failed = polled(good, { error: "Request failed (500)" }, new Date(2026, 9, 21, 11, 43));
  assert.equal(failed.rows, good.rows, "the rows stay");
  assert.equal(failed.updatedAt, good.updatedAt, "and so does the time they are from");
  assert.equal(failed.error, "Request failed (500)");

  const stillDown = polled(failed, { error: "Request failed (502)" }, new Date(2026, 9, 21, 11, 44));
  assert.equal(stillDown.rows, good.rows);
  assert.equal(clockText(stillDown.updatedAt), "11:42");

  const back = polled(stillDown, { rows: [log[0]] }, new Date(2026, 9, 21, 11, 45));
  assert.deepEqual(back.rows, [log[0]]);
  assert.equal(clockText(back.updatedAt), "11:45");
  assert.equal(back.error, null);
});

test("the banner says when the log on screen is from; before any log it gives the reason", () => {
  const failed = polled(polled(NO_POLL, { rows: log }, new Date(2026, 9, 21, 11, 42)), { error: "down" }, new Date());
  assert.equal(bannerText(failed), "Couldn't refresh — showing what we had at 11:42");
  assert.equal(bannerText(polled(NO_POLL, { error: "Failed to fetch" }, new Date())), "Couldn't load the log — Failed to fetch");
});
