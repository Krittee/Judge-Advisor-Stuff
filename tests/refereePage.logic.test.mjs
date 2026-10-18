import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  localDate,
  matchIsSet,
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
  kind: { label: "Minor violation", requiresRule: true },
  rules: ["GG17"],
};

test("nothing blocks Record once the match, team, severity and rule are all there", () => {
  assert.equal(recordBlocker(ready), null);
});

test("each missing piece is named, in the order a referee fills them in", () => {
  assert.match(recordBlocker({ ...ready, match: { ...qf, field: "" } }), /Set the match and field/);
  assert.match(recordBlocker({ ...ready, hasTeam: false }), /Enter a team number/);
  assert.equal(recordBlocker({ ...ready, kind: null }), "Pick how serious it was.");
  assert.match(recordBlocker({ ...ready, rules: [] }), /Minor violation needs at least one rule/);

  // The first missing thing wins.
  assert.match(
    recordBlocker({ ...ready, match: { ...qf, matchNumber: "" }, hasTeam: false, kind: null }),
    /Set the match/,
  );
  assert.match(recordBlocker({ ...ready, hasTeam: false, kind: null }), /team number/);
  assert.match(recordBlocker({ ...ready, kind: null, rules: [] }), /how serious/);
});

test("a rule is only needed for the severities that require one", () => {
  assert.equal(recordBlocker({ ...ready, kind: { label: "Warning", requiresRule: false }, rules: [] }), null);
  assert.equal(recordBlocker({ ...ready, kind: { label: "Good conduct", requiresRule: false }, rules: [] }), null);
});

test("Record never asks for an alliance, Teamwork or Skills", () => {
  const skills = { ...ready, match: { matchType: "SKD", matchNumber: "1", field: "2" } };
  assert.equal(recordBlocker(ready), null, "Teamwork with everything else set is ready");
  assert.equal(recordBlocker(skills), null);
  assert.equal(recordBlocker({ ...skills, rulesetId: "viqrc" }), null);

  // Whatever is missing, the line never mentions a side of the field.
  const missing = [
    { ...ready, match: { ...qf, field: "" } },
    { ...ready, hasTeam: false },
    { ...ready, kind: null },
    { ...ready, rules: [] },
    { ...skills, kind: null },
    { ...skills, rules: [] },
  ];
  for (const p of missing) assert.doesNotMatch(recordBlocker(p), /alliance|\bred\b|\bblue\b/i);
});

test("the Record button names the severity and the team", () => {
  const minor = { short: "Minor" };
  const team = { number: "9882K" };
  assert.equal(recordLabel(minor, team), "Record Minor · 9882K");
  assert.equal(recordLabel(minor, null), "Record Minor");
  assert.equal(recordLabel(null, team), "Record");
  assert.equal(recordLabel(null, null), "Record");
});

/* ---- what a record sends -------------------------------------------------- */

const base = {
  teamId: "t1",
  kind: "minor",
  body: "Held a Cup past the count.",
  match: qf,
  rulesetId: "v5rc",
  rules: ["GG17", "SG6"],
  matchAffecting: true,
};

test("a record carries the match, field, rules and the event's ruleset, and no alliance", () => {
  assert.deepEqual(recordPayload(base), {
    teamId: "t1",
    kind: "minor",
    body: "Held a Cup past the count.",
    matchType: "QF",
    matchNumber: "2-1",
    field: "2",
    ruleset: "v5rc",
    rules: ["GG17", "SG6"],
    matchAffecting: true,
  });
});

test("a Skills run is recorded the same way", () => {
  const skills = recordPayload({ ...base, match: { matchType: "SKA", matchNumber: "2", field: "1" }, rulesetId: "viqrc" });
  assert.equal(skills.ruleset, "viqrc");
  assert.equal(skills.matchType, "SKA");
  assert.equal(skills.matchNumber, "2");
  // Even a stray side handed in by an old caller never reaches the request.
  assert.equal("alliance" in recordPayload({ ...base, alliance: "red" }), false);
});

test("the referee console's logic has no alliance left in it", () => {
  const src = readFileSync(new URL("../src/components/referee/logic.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /alliance/i);
  assert.doesNotMatch(src, /matchTeams/, "the In match shortcut is gone");
});
