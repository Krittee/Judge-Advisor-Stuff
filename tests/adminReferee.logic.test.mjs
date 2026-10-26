import assert from "node:assert/strict";
import test from "node:test";

import {
  correctionBlocker,
  correctionReport,
  flagLabel,
  flaggedTeams,
  goBack,
  historyOf,
  pickTeam,
  pillClass,
  phoneView,
  removeAfterAsking,
  REMOVE_QUESTION,
  repeatedRules,
  repeatingOn,
  ruleChipIds,
  saveCorrection,
  selectedTeamId,
  severityTotals,
  startCorrection,
  startNav,
  teamTags,
} from "../src/components/admin/refereeLogic";
import { createConfirmer } from "../src/components/ConfirmDialog";
import { MAX_FIELD_COUNT, parseFlagFields } from "../src/lib/flagValidation";
import { commonFieldRules, getRuleset, isValidRuleId } from "../src/lib/rules";

/* The Judge Advisor Referee tab's decisions, run for real against
   src/components/admin/refereeLogic.ts. How they are drawn is in
   adminReferee.runtime.test.tsx. */

const kinds = [
  { id: "good", label: "Good conduct", short: "Good", color: "emerald", severity: 0, requiresRule: false },
  { id: "warning", label: "Warning", short: "Warning", color: "amber", severity: 1, requiresRule: false },
  { id: "minor", label: "Minor violation", short: "Minor", color: "orange", severity: 2, requiresRule: true },
  { id: "major", label: "Major violation", short: "Major", color: "rose", severity: 3, requiresRule: true },
  { id: "dq", label: "Disqualified", short: "DQ", color: "black", severity: 4, requiresRule: true },
];

const team = (number, name, over = {}) => ({
  id: `t-${number}`, number, name, panel_id: null, division: "Middle School", category: "developing", pit: null, created_at: "2026-10-20T08:00:00Z", ...over,
});
const rookies = team("1101R", "Rookies");
const titans = team("9882K", "Torque Titans", { panel_id: "p2", pit: "14" });
const nuts = team("6036D", "Nuts & Bolts");
const breakers = team("1108", "Circuit Breakers");
const gremlins = team("2011A", "Gear Gremlins");
const teams = [rookies, titans, nuts, breakers, gremlins];

let n = 0;
const flag = (t, kind, over = {}) => ({
  id: `f${++n}`, team_id: t.id, kind, body: "", author: "Jordan Lee", match_type: "Q", match_number: "1", field: "1", rule: null,
  ruleset: "v5rc", manual_version: null, match_affecting: false, created_at: "2026-10-20T10:00:00.000Z", ...over,
});
const at = (hhmm) => `2026-10-20T${hhmm}:00.000Z`;

// The Referee mocks, as data: 9 flags over 5 teams.
const mock = [
  flag(rookies, "dq", { rule: "SG6", match_number: "30", created_at: at("11:10") }),
  flag(rookies, "good", { match_number: "31", created_at: at("11:20") }),
  flag(titans, "warning", { rule: "GG17", match_number: "12", field: "1", created_at: at("09:58") }),
  flag(titans, "minor", { rule: "GG17", match_number: "19", field: "2", match_affecting: true, body: "pinned for 7s", created_at: at("10:42") }),
  flag(nuts, "minor", { rule: "SG9", match_number: "4", created_at: at("10:00") }),
  flag(breakers, "warning", { match_number: "2", created_at: at("09:00") }),
  flag(breakers, "warning", { match_number: "9", created_at: at("09:30") }),
  flag(breakers, "warning", { match_number: "15", created_at: at("10:30") }),
  flag(gremlins, "good", { match_number: "7", created_at: at("10:15") }),
];

/* ---- the flagged teams ---------------------------------------------------------- */

test("flagged teams are worst severity first, then most flags, then team number", () => {
  const rows = flaggedTeams(mock, kinds, teams);
  // 1101R (DQ) > 9882K (Minor, 2) > 6036D (Minor, 1) > 1108 (Warning, 3) > 2011A (Good, 1).
  assert.deepEqual(rows.map((r) => r.team.number), ["1101R", "9882K", "6036D", "1108", "2011A"]);
  assert.deepEqual(rows.map((r) => r.worst.short), ["DQ", "Minor", "Minor", "Warning", "Good"]);
  assert.deepEqual(rows.map((r) => r.flags.length), [2, 2, 1, 3, 1]);

  // Severity beats count: three Warnings never outrank one Minor.
  assert.ok(rows.findIndex((r) => r.team.number === "6036D") < rows.findIndex((r) => r.team.number === "1108"));
  // Count breaks a tie in severity.
  const tie = flaggedTeams([flag(nuts, "minor", { rule: "SG9" }), flag(titans, "minor", { rule: "SG9" }), flag(titans, "good")], kinds, teams);
  assert.deepEqual(tie.map((r) => r.team.number), ["9882K", "6036D"]);
  // Neither: team number, whatever order the flags came in.
  const same = [flag(titans, "warning"), flag(nuts, "warning"), flag(breakers, "warning")];
  assert.deepEqual(flaggedTeams(same, kinds, teams).map((r) => r.team.number), ["1108", "6036D", "9882K"]);
  assert.deepEqual(flaggedTeams([...same].reverse(), kinds, teams).map((r) => r.team.number), ["1108", "6036D", "9882K"]);
});

test("a team that was removed is still listed, last among equals, with no team on its row", () => {
  const ghost = flag({ id: "t-gone" }, "warning");
  const rows = flaggedTeams([ghost, flag(titans, "warning")], kinds, teams);
  assert.deepEqual(rows.map((r) => r.team?.number ?? null), ["9882K", null]);
  assert.equal(rows[1].id, "t-gone");
  assert.equal(teamTags(null, []).length, 0);
});

test("the count strip lists every kind, worst first, and shows a 0 for one nobody has", () => {
  assert.deepEqual(
    severityTotals(mock, kinds).map(({ kind, count }) => [kind.short, count]),
    [["DQ", 1], ["Major", 0], ["Minor", 2], ["Warning", 4], ["Good", 2]],
  );
  assert.deepEqual(severityTotals([], kinds).map((t) => t.count), [0, 0, 0, 0, 0]);
});

/* ---- which team is open ----------------------------------------------------------- */

test("with nothing picked and no Scores trip the first row is shown", () => {
  const rows = flaggedTeams(mock, kinds, teams);
  assert.equal(selectedTeamId(rows, startNav(null)), rows[0].id);
  assert.equal(selectedTeamId(rows, startNav(undefined)), rows[0].id);
  assert.equal(selectedTeamId([], startNav(null)), null);
});

test("arriving from Scores selects that team and opens it, and it stays until another is picked", () => {
  const rows = flaggedTeams(mock, kinds, teams);
  const nav = startNav(breakers.id);
  assert.deepEqual(nav, { picked: breakers.id, open: true });
  assert.equal(selectedTeamId(rows, nav, breakers.id), breakers.id);
  // A poll that redraws the list does not move it.
  assert.equal(selectedTeamId(flaggedTeams([...mock].reverse(), kinds, teams), nav, breakers.id), breakers.id);
  // Picking another replaces it, even though Scores' team is still the focus.
  assert.equal(selectedTeamId(rows, pickTeam(nav, nuts.id), breakers.id), nuts.id);
});

test("the focus alone selects its team, and a focus on a team with no flags falls back to the first row", () => {
  const rows = flaggedTeams(mock, kinds, teams);
  assert.equal(selectedTeamId(rows, { picked: null, open: false }, gremlins.id), gremlins.id);
  const unflagged = team("0000X", "Nobody");
  assert.equal(selectedTeamId(rows, startNav(unflagged.id), unflagged.id), rows[0].id);
  // Nor does it open on a phone: there is nothing to show.
  assert.equal(phoneView(rows, startNav(unflagged.id)), "list");
});

test("a picked team that lost its last flag is dropped for the next choice", () => {
  const nav = pickTeam(startNav(null), gremlins.id);
  const without = flaggedTeams(mock.filter((f) => f.team_id !== gremlins.id), kinds, teams);
  assert.equal(selectedTeamId(without, nav), without[0].id);
  assert.equal(phoneView(without, nav), "list", "a phone is not left on a team that is gone");
});

test("phone: the list, a team, and back", () => {
  const rows = flaggedTeams(mock, kinds, teams);
  let nav = startNav(null);
  assert.equal(phoneView(rows, nav), "list");

  nav = pickTeam(nav, nuts.id);
  assert.equal(phoneView(rows, nav), "team");
  assert.equal(selectedTeamId(rows, nav), nuts.id);

  nav = goBack(nav);
  assert.equal(phoneView(rows, nav), "list");
  assert.equal(selectedTeamId(rows, nav), nuts.id, "the team stays marked in the list");

  // Another team from the list, then back again.
  nav = goBack(pickTeam(nav, breakers.id));
  assert.equal(phoneView(rows, nav), "list");
  assert.equal(selectedTeamId(rows, nav), breakers.id);
  // Arriving from Scores opens straight on the team.
  assert.equal(phoneView(rows, startNav(titans.id)), "team");
});

/* ---- the repeat box ---------------------------------------------------------------- */

test("the repeat box names the rule, how often, and each match with its severity, oldest first", () => {
  const own = mock.filter((f) => f.team_id === titans.id);
  assert.deepEqual(repeatedRules(own, kinds), [{ rule: "GG17", times: 2, text: "GG17 twice: Q12 (Warning), Q19 (Minor)" }]);
  // Newest first in the data changes nothing.
  assert.equal(repeatedRules([...own].reverse(), kinds)[0].text, "GG17 twice: Q12 (Warning), Q19 (Minor)");
});

test("three or more flags on a rule say how many times; two rules give two lines", () => {
  const rule = (m, r, hh) => flag(titans, "warning", { rule: r, match_number: m, created_at: at(hh) });
  const own = [rule("1", "GG17", "09:00"), rule("2", "GG17", "09:10"), rule("3", "GG17", "09:20"), rule("4", "SG9", "09:30"), rule("5", "SG9", "09:40")];
  assert.deepEqual(
    repeatedRules(own, kinds).map((r) => [r.rule, r.times, r.text]),
    [
      ["GG17", 3, "GG17 3 times: Q1 (Warning), Q2 (Warning), Q3 (Warning)"],
      ["SG9", 2, "SG9 twice: Q4 (Warning), Q5 (Warning)"],
    ],
  );
});

test("a rule cited once, Good Conduct, and another program's rule of the same code are not repeats", () => {
  assert.deepEqual(repeatedRules(mock.filter((f) => f.team_id === nuts.id), kinds), []);
  // Good Conduct is praise, even if an old record carries a rule.
  assert.deepEqual(repeatedRules([flag(titans, "good", { rule: "GG17" }), flag(titans, "good", { rule: "GG17" })], kinds), []);
  // IQ's SG6 and V5RC's SG6 are different rules that share a code.
  assert.deepEqual(repeatedRules([flag(titans, "minor", { rule: "SG6", ruleset: "viqrc" }), flag(titans, "minor", { rule: "SG6", ruleset: "v5rc" })], kinds), []);
  assert.deepEqual(repeatedRules([], kinds), []);
});

test("one flag cites several rules: only the repeated one is tagged, and only on the later flag", () => {
  const first = flag(titans, "warning", { rule: "GG17,SG9", match_number: "12", created_at: at("09:00") });
  const second = flag(titans, "minor", { rule: "GG17", match_number: "19", created_at: at("10:00") });
  const third = flag(titans, "warning", { rule: "SG6", match_number: "21", created_at: at("11:00") });
  const all = [first, second, third];
  assert.deepEqual(repeatingOn(first, all), [], "the first time is not a repeat");
  assert.deepEqual(repeatingOn(second, all), ["GG17"]);
  assert.deepEqual(repeatingOn(third, all), []);
  assert.deepEqual(repeatingOn(flag(titans, "good", { rule: "GG17", created_at: at("12:00") }), [...all]), [], "Good Conduct is never tagged");
});

test("history is newest first", () => {
  const own = mock.filter((f) => f.team_id === titans.id);
  assert.deepEqual(historyOf(own).map((f) => f.match_number), ["19", "12"]);
  assert.deepEqual(historyOf([...own].reverse()).map((f) => f.match_number), ["19", "12"]);
});

/* ---- the header and the labels ------------------------------------------------------ */

test("a team's tags are its division, pit and panel, whichever it has", () => {
  const panels = [{ id: "p2", name: "Panel 2" }];
  assert.deepEqual(teamTags(titans, panels), ["MS", "Pit 14", "Panel 2"]);
  assert.deepEqual(teamTags(rookies, panels), ["MS"]);
});

test("a flag's accessible name is the team, the match and the severity", () => {
  assert.equal(flagLabel(mock[3], titans, kinds), "9882K, Q19, Minor");
  assert.equal(flagLabel(flag(titans, "good", { match_type: null, match_number: null }), null, kinds), "team removed, Good");
});

/* ---- Remove ------------------------------------------------------------------------- */

test("Remove asks first, in the app's own dialog, and removes only on a yes", async () => {
  const shown = [];
  const { ask, settle } = createConfirmer((p) => shown.push(p));
  let removed = 0;
  const run = removeAfterAsking(ask, async () => {
    removed += 1;
  });
  assert.deepEqual(shown, [{ question: "Remove this flag? The judges will stop seeing it.", confirmLabel: "Remove flag", danger: true }]);
  assert.equal(REMOVE_QUESTION, shown[0].question);
  assert.equal(removed, 0, "nothing is removed while the question is open");
  settle(true);
  assert.equal(await run, true);
  assert.equal(removed, 1);
});

test("declining Remove sends nothing", async () => {
  const { ask, settle } = createConfirmer(() => {});
  let removed = 0;
  const run = removeAfterAsking(ask, async () => {
    removed += 1;
  });
  settle(false);
  assert.equal(await run, false);
  assert.equal(removed, 0);
});

/* ---- Correct flag ------------------------------------------------------------------- */

const recorded = flag(titans, "minor", { rule: "GG17", match_type: "QF", match_number: "2-1", field: "2", body: "pinned for 7s", match_affecting: true });
const open = (over = {}) => ({ flag: recorded, draft: startCorrection(recorded), kinds, fieldCount: 3, ...over });

test("a correction starts as the flag is, and only Save correction sends it", async () => {
  const draft = startCorrection(recorded);
  assert.deepEqual(draft, {
    kind: "minor",
    body: "pinned for 7s",
    match: { matchType: "QF", matchNumber: "2-1", field: "2" },
    rules: ["GG17"],
    matchAffecting: true,
  });

  // Picking a severity is a change of the draft, not a send: nothing here can call onSave.
  const calls = [];
  const onSave = async (id, report) => void calls.push([id, report]);
  const picked = { ...draft, kind: "major" };
  assert.equal(correctionBlocker(open({ draft: picked })), null);
  assert.deepEqual(calls, []);

  assert.equal(await saveCorrection({ ...open({ draft: picked }), onSave }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], recorded.id);
  assert.equal(calls[0][1].kind, "major");
});

test("the PATCH body is the one the inline correction always sent", () => {
  assert.deepEqual(correctionReport(recorded, startCorrection(recorded)), {
    kind: "minor",
    body: "pinned for 7s",
    matchType: "QF",
    matchNumber: "2-1",
    field: "2",
    ruleset: "v5rc",
    rules: ["GG17"],
    matchAffecting: true,
  });
  // The flag keeps the ruleset it was recorded under; an old one with none is VEX IQ.
  assert.equal(correctionReport(flag(titans, "warning", { ruleset: null, match_type: "Q" }), startCorrection(flag(titans, "warning", { ruleset: null }))).ruleset, "viqrc");
  // Match affecting only rides along for Minor and Major.
  assert.equal(correctionReport(recorded, { ...startCorrection(recorded), kind: "warning" }).matchAffecting, false);
  assert.equal(correctionReport(recorded, { ...startCorrection(recorded), kind: "major" }).matchAffecting, true);
});

test("a blocked correction sends nothing, and says what is missing", async () => {
  const calls = [];
  const onSave = async (...args) => void calls.push(args);
  const noRule = { ...startCorrection(recorded), rules: [] };
  assert.equal(correctionBlocker(open({ draft: noRule })), "Minor violation needs at least one rule — pick it under Rules broken.");
  assert.equal(await saveCorrection({ ...open({ draft: noRule }), onSave }), false);

  const noMatch = { ...startCorrection(recorded), match: { matchType: "QF", matchNumber: "", field: "2" } };
  assert.equal(correctionBlocker(open({ draft: noMatch })), "Set the match and field first.");
  const noField = { ...startCorrection(recorded), match: { matchType: "QF", matchNumber: "2-1", field: "" } };
  assert.equal(await saveCorrection({ ...open({ draft: noField }), onSave }), false);
  assert.deepEqual(calls, []);

  // A Warning needs no rule.
  assert.equal(correctionBlocker(open({ draft: { ...noRule, kind: "warning" } })), null);
});

test("a flag recorded with no rule may be corrected in its own kind, but not moved to another that needs one", () => {
  const legacy = flag(titans, "minor", { rule: null, match_type: "Q", match_number: "5", field: "1" });
  const ctx = { flag: legacy, kinds, fieldCount: 3 };
  assert.equal(correctionBlocker({ ...ctx, draft: startCorrection(legacy) }), null);
  assert.match(correctionBlocker({ ...ctx, draft: { ...startCorrection(legacy), kind: "major" } }), /Major violation needs at least one rule/);
  assert.equal(correctionBlocker({ ...ctx, draft: { ...startCorrection(legacy), kind: "warning" } }), null);
});

/* The correction can only produce what the referee's own form could: here every
   draft is run past the server's own validator (parseFlagFields, as the PATCH
   route calls it) and the sheet's answer must agree. */

function serverSays(existing, draft, fieldCount) {
  return parseFlagFields(
    { ...correctionReport(existing, draft) },
    { allowLegacyRulelessKind: existing.rule ? null : existing.kind, defaultRuleset: existing.ruleset, fieldCount, existing },
  ).ok;
}

test("the sheet agrees with the server about every match type, number, field and rule a correction could carry", () => {
  const cases = [
    flag(titans, "minor", { ruleset: "v5rc", rule: "GG17", match_type: "QF", match_number: "2-1", field: "2" }),
    flag(titans, "warning", { ruleset: "viqrc", rule: null, match_type: "Q", match_number: "7", field: "3" }),
    // Old data: the retired "SK" run, a prefixed field, a field the event has outgrown.
    flag(titans, "warning", { ruleset: "viqrc", rule: null, match_type: "SK", match_number: "1", field: "HS2" }),
    flag(titans, "warning", { ruleset: "v5rc", rule: null, match_type: "Q", match_number: "7", field: "9" }),
  ];
  const types = ["P", "Q", "R16", "QF", "SF", "F", "SKD", "SKA", "SK", "ZZ", ""];
  const numbers = ["", "7", "2-1", "2", "12345", "0"];
  const fields = ["", "1", "2", "3", "4", "9", "HS2", "0", "21"];
  const fieldCount = 3;
  let checked = 0;
  for (const existing of cases) {
    for (const matchType of types) {
      for (const matchNumber of numbers) {
        for (const field of fields) {
          for (const kind of ["warning", "minor"]) {
            // Rules come from the ruleset's own shortcuts: the chips and the All rules picker offer nothing else.
            for (const rules of [[], [getRuleset(existing.ruleset).commonRuleIds[0]]]) {
              const draft = { kind, body: "", match: { matchType, matchNumber, field }, rules, matchAffecting: false };
              const sheet = correctionBlocker({ flag: existing, draft, kinds, fieldCount }) === null;
              assert.equal(sheet, serverSays(existing, draft, fieldCount), `${existing.ruleset} ${existing.match_type}/${existing.field}: ${kind} ${matchType} ${matchNumber} field ${field} rules ${rules}`);
              checked += 1;
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 5000, "the grid ran");
});

test("the rule chips are the ruleset's common rules, then any other rule already picked", () => {
  for (const id of ruleChipIds("viqrc", [])) assert.ok(isValidRuleId(id, "viqrc"), `${id} is not an IQ rule`);
  for (const id of ruleChipIds("v5rc", [])) assert.ok(isValidRuleId(id, "v5rc"), `${id} is not a V5RC rule`);
  assert.deepEqual(ruleChipIds("v5rc", []), commonFieldRules("v5rc").map((r) => r.id));
  assert.deepEqual(ruleChipIds("v5rc", ["GG17", "SG1"]).slice(-1), ["SG1"], "a rule from All rules is listed after the common ones");
  assert.equal(ruleChipIds("v5rc", ["GG17"]).filter((id) => id === "GG17").length, 1, "a common rule is not listed twice");
  // Another program's shortcuts are not this one's.
  assert.ok(!ruleChipIds("viqrc", []).includes("GG17"));
  assert.ok(getRuleset("viqrc").rules.length !== getRuleset("v5rc").rules.length);
  assert.ok(MAX_FIELD_COUNT >= 3);
});

/* ---- colour ------------------------------------------------------------------------- */

test("a severity pill is the kind's solid fill and ink, with no hover state", () => {
  assert.equal(pillClass("rose"), "bg-danger text-danger-ink");
  assert.equal(pillClass("orange"), "bg-waiting text-waiting-ink");
  assert.equal(pillClass("black"), "bg-ink text-canvas");
});
