import assert from "node:assert/strict";
import test from "node:test";
import {
  localDate,
  matchIsSet,
  matchTeams,
  needsEventSetup,
  recordBlocker,
  recordLabel,
  recordPayload,
  setupChangeQuestion,
  setupRequest,
} from "../src/components/referee/logic";

/* The referee console's decisions, run for real: when the event setup is asked
   for, what a save sends, and what stops the Record button. The page's wiring
   of these is checked in refereePage.source.test.mjs. */

const setup = (over = {}) => ({
  ruleset: "v5rc",
  field_count: 3,
  set_by: "Jordan Lee",
  set_on: "2026-10-18",
  updated_at: "2026-10-18T02:00:00.000Z",
  ...over,
});

/* ---- the event setup gate ------------------------------------------------ */

test("the setup is asked for when there is none, or it was saved on another day", () => {
  assert.equal(needsEventSetup(null, "2026-10-18"), true, "no setup at all");
  assert.equal(needsEventSetup(setup({ set_on: "2026-10-17" }), "2026-10-18"), true, "yesterday's setup");
  assert.equal(needsEventSetup(setup({ set_on: "2026-10-19" }), "2026-10-18"), true, "a date that is not today");
  assert.equal(needsEventSetup(setup(), "2026-10-18"), false, "today's setup goes straight to the console");
});

test("today is the device's calendar date, zero-padded, not UTC", () => {
  assert.equal(localDate(new Date(2026, 0, 5, 9, 30)), "2026-01-05");
  assert.equal(localDate(new Date(2026, 11, 31, 23, 59, 59)), "2026-12-31");

  // The date that matters is the one on the referee's clock. In Bangkok
  // 00:30 on the 2nd is still 17:30 on the 1st in UTC, which toISOString()
  // would report.
  const before = process.env.TZ;
  try {
    process.env.TZ = "Asia/Bangkok";
    const justAfterMidnight = new Date("2026-06-01T17:30:00Z");
    assert.equal(localDate(justAfterMidnight), "2026-06-02");
    assert.notEqual(justAfterMidnight.toISOString().slice(0, 10), localDate(justAfterMidnight));
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test("saving the setup sends the program, the field count and the device's date", () => {
  assert.deepEqual(setupRequest("v5rc", 3, "2026-10-18"), { ruleset: "v5rc", field_count: 3, today: "2026-10-18" });
  // Left out, the date is this device's today.
  assert.deepEqual(setupRequest("viqrc", 4), { ruleset: "viqrc", field_count: 4, today: localDate() });
});

test("changing a setup other referees are working from today asks first; a fresh day or no change does not", () => {
  const today = "2026-10-18";
  assert.equal(setupChangeQuestion(null, { ruleset: "v5rc", fieldCount: 3 }, today), null, "a first setup");
  assert.equal(
    setupChangeQuestion(setup({ set_on: "2026-10-17" }), { ruleset: "viqrc", fieldCount: 2 }, today),
    null,
    "yesterday's setup is nobody's to protect",
  );
  assert.equal(setupChangeQuestion(setup(), { ruleset: "v5rc", fieldCount: 3 }, today), null, "nothing changed");
  assert.equal(
    setupChangeQuestion(setup(), { ruleset: "viqrc", fieldCount: 3 }, today),
    "Change the program for everyone at this event?",
  );
  assert.equal(
    setupChangeQuestion(setup(), { ruleset: "v5rc", fieldCount: 5 }, today),
    "Change the number of fields for everyone at this event?",
  );
});

/* ---- the match ------------------------------------------------------------ */

const qf = { matchType: "QF", matchNumber: "2-1", field: "2" };

test("a match is set when its type, number and field are all real for the program", () => {
  assert.equal(matchIsSet(qf, "v5rc", 3), true);
  assert.equal(matchIsSet({ ...qf, matchType: "" }, "v5rc", 3), false, "no type");
  assert.equal(matchIsSet({ ...qf, matchNumber: "" }, "v5rc", 3), false, "no number");
  assert.equal(matchIsSet({ ...qf, matchNumber: "2" }, "v5rc", 3), false, "a bracket needs both halves");
  assert.equal(matchIsSet({ ...qf, field: "" }, "v5rc", 3), false, "no field");
  assert.equal(matchIsSet({ ...qf, field: "4" }, "v5rc", 3), false, "a field the event does not have");
  assert.equal(matchIsSet(qf, "viqrc", 3), false, "QF is not a VEX IQ match");
  assert.equal(matchIsSet({ matchType: "Q", matchNumber: "23", field: "1" }, "viqrc", 3), true);
  assert.equal(matchIsSet({ matchType: "SKD", matchNumber: "1", field: "3" }, "viqrc", 3), true);
});

/* ---- what stops the Record button ----------------------------------------- */

const ready = {
  match: qf,
  rulesetId: "v5rc",
  fieldCount: 3,
  hasTeam: true,
  alliance: "red",
  kind: { label: "Minor violation", requiresRule: true },
  rules: ["GG17"],
};

test("nothing blocks Record once the match, team, alliance, severity and rule are all there", () => {
  assert.equal(recordBlocker(ready), null);
});

test("each missing piece is named, in the order a referee fills them in", () => {
  assert.match(recordBlocker({ ...ready, match: { ...qf, field: "" } }), /Set the match and field/);
  assert.match(recordBlocker({ ...ready, hasTeam: false }), /Enter a team number/);
  assert.equal(recordBlocker({ ...ready, alliance: null }), "Pick the alliance — Red or Blue.");
  assert.equal(recordBlocker({ ...ready, kind: null }), "Pick how serious it was.");
  assert.match(recordBlocker({ ...ready, rules: [] }), /Minor violation needs at least one rule/);

  // The first missing thing wins.
  assert.match(
    recordBlocker({ ...ready, match: { ...qf, matchNumber: "" }, hasTeam: false, alliance: null, kind: null }),
    /Set the match/,
  );
  assert.match(recordBlocker({ ...ready, hasTeam: false, alliance: null, kind: null }), /team number/);
  assert.match(recordBlocker({ ...ready, alliance: null, kind: null }), /alliance/);
  assert.match(recordBlocker({ ...ready, kind: null, rules: [] }), /how serious/);
});

test("a rule is only needed for the severities that require one", () => {
  assert.equal(recordBlocker({ ...ready, kind: { label: "Warning", requiresRule: false }, rules: [] }), null);
  assert.equal(recordBlocker({ ...ready, kind: { label: "Good conduct", requiresRule: false }, rules: [] }), null);
});

test("a Skills run never needs an alliance", () => {
  const skills = { ...ready, match: { matchType: "SKD", matchNumber: "1", field: "2" }, alliance: null };
  assert.equal(recordBlocker(skills), null);
  assert.equal(recordBlocker({ ...skills, rulesetId: "viqrc" }), null);
  // The same missing alliance on a Teamwork match does block.
  assert.equal(recordBlocker({ ...ready, alliance: null }), "Pick the alliance — Red or Blue.");
});

test("the Record button names the severity, the team and the alliance", () => {
  const minor = { short: "Minor" };
  const team = { number: "9882K" };
  assert.equal(recordLabel(minor, team, "red"), "Record Minor · 9882K (Red)");
  assert.equal(recordLabel(minor, team, "blue"), "Record Minor · 9882K (Blue)");
  assert.equal(recordLabel(minor, team, null), "Record Minor · 9882K", "a Skills run has no alliance to name");
  assert.equal(recordLabel(minor, null, null), "Record Minor");
  assert.equal(recordLabel(null, team, "red"), "Record");
});

/* ---- what a record sends -------------------------------------------------- */

const base = {
  teamId: "t1",
  kind: "minor",
  body: "Held a Cup past the count.",
  match: qf,
  alliance: "red",
  rulesetId: "v5rc",
  rules: ["GG17", "SG6"],
  matchAffecting: true,
};

test("a record carries the alliance and the event's ruleset", () => {
  assert.deepEqual(recordPayload(base), {
    teamId: "t1",
    kind: "minor",
    body: "Held a Cup past the count.",
    matchType: "QF",
    matchNumber: "2-1",
    alliance: "red",
    field: "2",
    ruleset: "v5rc",
    rules: ["GG17", "SG6"],
    matchAffecting: true,
  });
});

test("a Skills run sends no alliance, even if one was picked on an earlier Teamwork match", () => {
  const skills = recordPayload({
    ...base,
    match: { matchType: "SKA", matchNumber: "2", field: "1" },
    rulesetId: "viqrc",
    alliance: "blue",
  });
  assert.equal(skills.alliance, "");
  assert.equal(skills.ruleset, "viqrc");
  assert.equal(skills.matchType, "SKA");
  assert.equal(recordPayload({ ...base, alliance: null }).alliance, "", "nothing picked sends nothing");
});

/* ---- the teams already in this match -------------------------------------- */

const team = (id, number) => ({ id, number, name: `Team ${number}`, division: "Division 1", category: "graded", panel_id: null, pit: null, created_at: "" });
const teams = [team("a", "9882K"), team("b", "1234A"), team("c", "77777Z")];
const flag = (over) => ({
  id: String(Math.random()),
  team_id: "a",
  kind: "minor",
  body: "",
  author: "Jordan Lee",
  match_type: "QF",
  match_number: "2-1",
  alliance: "red",
  field: "2",
  rule: "GG17",
  ruleset: "v5rc",
  manual_version: "2.1",
  match_affecting: false,
  created_at: "2026-10-18T03:00:00.000Z",
  ...over,
});

test("teams already flagged in this match are listed with the side they were on", () => {
  const found = matchTeams(
    [
      flag({ team_id: "a", alliance: "red", created_at: "2026-10-18T03:00:00.000Z" }),
      flag({ team_id: "b", alliance: "blue", created_at: "2026-10-18T03:05:00.000Z" }),
    ],
    teams,
    qf,
    "v5rc",
  );
  assert.deepEqual(
    found.map((m) => [m.team.number, m.alliance]),
    [
      ["1234A", "blue"],
      ["9882K", "red"],
    ],
    "newest first",
  );
});

test("a different match, field or program is not this match", () => {
  const flags = [
    flag({ team_id: "a", match_number: "2-2" }),
    flag({ team_id: "b", field: "1" }),
    flag({ team_id: "c", ruleset: "viqrc", match_type: "Q", match_number: "23" }),
    flag({ team_id: "a", match_type: "Q", match_number: "21" }),
  ];
  assert.deepEqual(matchTeams(flags, teams, qf, "v5rc"), []);
  // team c's flag is a VEX IQ Q23 on field 2: found there, and not as V5RC's Q23.
  const q23 = { matchType: "Q", matchNumber: "23", field: "2" };
  assert.deepEqual(matchTeams(flags, teams, q23, "viqrc").map((m) => m.team.number), ["77777Z"]);
  assert.deepEqual(matchTeams(flags, teams, q23, "v5rc"), []);
  assert.deepEqual(matchTeams([flag({})], teams, { matchType: "", matchNumber: "", field: "" }, "v5rc"), [], "no match set");
});

test("a team keeps the side the latest report named, and a Skills run lists teams with no side", () => {
  const found = matchTeams(
    [
      flag({ team_id: "a", alliance: "red", created_at: "2026-10-18T03:00:00.000Z" }),
      flag({ team_id: "a", alliance: "blue", created_at: "2026-10-18T03:10:00.000Z" }),
      flag({ team_id: "a", alliance: null, created_at: "2026-10-18T03:20:00.000Z" }),
    ],
    teams,
    qf,
    "v5rc",
  );
  assert.deepEqual(found.map((m) => [m.team.number, m.alliance]), [["9882K", "blue"]], "a later report with no side does not erase it");

  const skills = matchTeams(
    [flag({ team_id: "c", match_type: "SKD", match_number: "1", alliance: null, ruleset: "viqrc", field: "3" })],
    teams,
    { matchType: "SKD", matchNumber: "1", field: "3" },
    "viqrc",
  );
  assert.deepEqual(skills.map((m) => [m.team.number, m.alliance]), [["77777Z", null]]);
});
