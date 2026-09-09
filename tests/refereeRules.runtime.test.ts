import assert from "node:assert/strict";
import test from "node:test";

import { parseFlagFields } from "../src/lib/flagValidation";
import { normalizeMatchNumber } from "../src/lib/match";
import { refereeHistory } from "../src/lib/refereeHistory";
import { RULE_CATEGORIES, RULES, searchRules } from "../src/lib/rules";
import type { FlagRow } from "../src/lib/types";

const validReport = {
  kind: "warning",
  body: "Robot contacted a second Bean Bag.",
  matchType: "Q",
  matchNumber: "23",
  field: "Field 2",
  rule: null,
};

test("the real validator applies the exact rule requirement for every severity", () => {
  const good = parseFlagFields({ ...validReport, kind: "good" });
  assert.equal(good.ok, true, "Good Conduct must work without a rule");

  const warning = parseFlagFields(validReport);
  assert.equal(warning.ok, true, "Warning must work without a rule");

  const minor = parseFlagFields({ ...validReport, kind: "minor" });
  assert.equal(minor.ok, false, "Minor must be blocked without a rule");

  const major = parseFlagFields({ ...validReport, kind: "major" });
  assert.equal(major.ok, false, "Major must be blocked without a rule");

  for (const kind of ["minor", "major"]) {
    const result = parseFlagFields({ ...validReport, kind, rule: "sg6" });
    assert.equal(result.ok, true, `${kind} must work with a real rule`);
    if (result.ok) assert.equal(result.rule, "SG6");
  }
});

test("Good Conduct cannot retain a stale rule and malformed rule ids are rejected", () => {
  const good = parseFlagFields({ ...validReport, kind: "good", rule: "SG6" });
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.rule, null);

  const malformed = parseFlagFields({ ...validReport, kind: "warning", rule: "SG999" });
  assert.equal(malformed.ok, false);
});

test("the real validator preserves the existing required observation and match fields", () => {
  for (const [field, value] of [
    ["body", ""],
    ["matchType", "X"],
    ["matchNumber", ""],
    ["field", ""],
  ] as const) {
    const result = parseFlagFields({ ...validReport, [field]: value });
    assert.equal(result.ok, false, `${field} must still be validated`);
  }
});

test("a legacy rule-less violation can be corrected but cannot bypass a severity transition", () => {
  const sameKind = parseFlagFields(
    { ...validReport, kind: "minor" },
    { allowLegacyRulelessKind: "minor" },
  );
  assert.equal(sameKind.ok, true, "legacy text/match corrections must remain possible");

  const changedKind = parseFlagFields(
    { ...validReport, kind: "major" },
    { allowLegacyRulelessKind: "minor" },
  );
  assert.equal(changedKind.ok, false, "PATCH must not change a rule-less Minor into Major");
});

test("leading zeroes are canonicalized so Q023 and Q23 identify the same match", () => {
  assert.equal(normalizeMatchNumber("023"), "23");
  assert.equal(normalizeMatchNumber("Q0023"), "23");
  assert.equal(normalizeMatchNumber("0000"), "0");
});

function flag(id: string, values: Partial<FlagRow> = {}): FlagRow {
  return {
    id,
    team_id: "team-1852B",
    kind: "minor",
    body: `Observation ${id}`,
    author: "Head Referee",
    match_type: "Q",
    match_number: "23",
    field: "Field 2",
    rule: "SG6",
    created_at: `2026-09-09T10:00:${id.padStart(2, "0")}Z`,
    ...values,
  };
}

test("history is scoped to the exact team and rule, excludes Good Conduct, and keeps repeated records separate", () => {
  const reports = [
    flag("1", { match_number: "023" }),
    flag("2"),
    flag("3", { kind: "warning", match_number: "24" }),
    flag("4", { rule: "SG7" }),
    flag("5", { team_id: "team-1852A" }),
    flag("6", { kind: "good" }),
    flag("7", { kind: "warning", rule: null, match_number: "25" }),
  ];

  const beforeKinds = reports.map((report) => report.kind);
  const history = refereeHistory(reports, "team-1852B", "SG6", "Q", "23");

  assert.deepEqual(history.sameRule.map((report) => report.id), ["1", "2", "3"]);
  assert.deepEqual(history.sameMatchSameRule.map((report) => report.id), ["1", "2"]);
  assert.equal(new Set(history.sameMatchSameRule.map((report) => report.id)).size, 2);
  assert.equal(history.eventTotals.get("minor"), 3, "event totals include SG6 and SG7 Minors");
  assert.equal(history.eventTotals.get("warning"), 2, "event totals include all team Warnings");
  assert.equal(history.eventTotals.has("good"), false);
  assert.equal(history.escalationReviewRequired, true);
  assert.deepEqual(reports.map((report) => report.kind), beforeKinds, "history must never alter severity");
});

test("changing team or rule cannot leave another selection's repeated history behind", () => {
  const reports = [flag("1"), flag("2", { rule: "SG7" }), flag("3", { team_id: "other" })];

  assert.deepEqual(
    refereeHistory(reports, "team-1852B", "SG7", "Q", "23").sameRule.map((f) => f.id),
    ["2"],
  );
  assert.deepEqual(
    refereeHistory(reports, "other", "SG6", "Q", "23").sameRule.map((f) => f.id),
    ["3"],
  );
  assert.deepEqual(refereeHistory(reports, null, "SG6", "Q", "23").sameRule, []);
});

test("the runtime rule catalog has exactly the required categories and 78 ids", () => {
  assert.deepEqual([...RULE_CATEGORIES], [
    "Scoring Rules",
    "Specific Game Rules",
    "Safety Rules",
    "General Rules",
    "General Game Rules",
    "Robot Skills Challenge Rules",
    "Robot Rules",
    "Tournament Rules",
  ]);
  assert.equal(RULES.length, 78);
  assert.equal(new Set(RULES.map((rule) => rule.id)).size, 78);

  const expectedIds = [
    ...Array.from({ length: 5 }, (_, i) => `SC${i + 1}`),
    ...Array.from({ length: 7 }, (_, i) => `SG${i + 1}`),
    ...Array.from({ length: 3 }, (_, i) => `S${i + 1}`),
    ...Array.from({ length: 5 }, (_, i) => `G${i + 1}`),
    ...Array.from({ length: 14 }, (_, i) => `GG${i + 1}`),
    ...Array.from({ length: 8 }, (_, i) => `RSC${i + 1}`),
    ...Array.from({ length: 17 }, (_, i) => `R${i + 1}`),
    ...Array.from({ length: 19 }, (_, i) => `T${i + 1}`),
  ];
  assert.deepEqual(RULES.map((rule) => rule.id), expectedIds);
});

test("the real search finds every mandated rule using partial, case-insensitive terms", () => {
  const cases: Record<string, string[]> = {
    SG6: ["SG6", "<SG6>", "6", "possession", "possess", "plow", "plowing", "bean bag"],
    SG7: ["SG7", "load", "loading", "loader", "load zone"],
    GG4: ["GG4", "hands", "hand", "field"],
    GG10: ["GG10", "handling", "robot", "reset"],
    GG12: ["GG12", "timer", "start", "stop", "early", "late", "timing"],
  };

  for (const [id, queries] of Object.entries(cases)) {
    for (const query of queries) {
      assert.ok(searchRules(query.toUpperCase()).some((rule) => rule.id === id), `${query} missed ${id}`);
    }
  }
});
