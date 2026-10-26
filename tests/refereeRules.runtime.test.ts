import assert from "node:assert/strict";
import test from "node:test";

import { parseFlagFields, parseRefereeSetup } from "../src/lib/flagValidation";
import { normalizeMatchNumber } from "../src/lib/match";
import { isValidMatchType, matchTypes, refereeFlags } from "../src/lib/presets";
import { refereeHistory } from "../src/lib/refereeHistory";
import {
  getRuleset,
  MAX_FLAG_RULES,
  QUICK_REFERENCE_RULE_CATEGORIES,
  RULE_CATEGORIES,
  searchRules,
} from "../src/lib/rules";
import type { FlagRow } from "../src/lib/types";

const validReport = {
  kind: "warning",
  body: "Robot contacted a second Bean Bag.",
  matchType: "Q",
  matchNumber: "23",
  field: "2",
  rule: null,
};

test("the real validator applies the exact rule requirement for every severity", () => {
  const good = parseFlagFields({ ...validReport, kind: "good", body: "" });
  assert.equal(good.ok, true, "Good Conduct must work without a rule");

  const warning = parseFlagFields({ ...validReport, body: "" });
  assert.equal(warning.ok, true, "Warning must work without a rule");

  for (const kind of ["minor", "major", "dq"]) {
    const missing = parseFlagFields({ ...validReport, kind, body: "" });
    assert.equal(missing.ok, false, `${kind} must be blocked without a rule`);

    const result = parseFlagFields({ ...validReport, kind, rule: "sg6", body: "" });
    assert.equal(result.ok, true, `${kind} must work with a real rule`);
    if (result.ok) assert.equal(result.rule, "SG6");
  }
});

test("Good Conduct cannot retain a stale rule and malformed rule ids are rejected", () => {
  const good = parseFlagFields({ ...validReport, kind: "good", rule: "SG6", rules: ["SG6"] });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.rule, null);
    assert.deepEqual(good.rules, []);
  }

  const malformed = parseFlagFields({ ...validReport, kind: "warning", rule: "SG999" });
  assert.equal(malformed.ok, false);
});

test("the real validator preserves the required match fields", () => {
  for (const [field, value] of [
    ["matchType", "X"],
    ["matchNumber", ""],
    ["field", ""],
    ["field", "ES2"], // the division prefix is no longer a field
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

/* ---- rulesets and several rules, through the real validator ------------- */

test("a request with no ruleset is VEX IQ, and the server fills in the manual version", () => {
  const iq = parseFlagFields({ ...validReport, kind: "minor", rule: "SG6" });
  assert.equal(iq.ok && iq.ruleset, "viqrc");
  assert.equal(iq.ok && iq.manualVersion, null, "the IQ data records no edition");

  const v5 = parseFlagFields({ ...validReport, kind: "minor", ruleset: "v5rc", rules: ["SG6"] });
  assert.equal(v5.ok && v5.ruleset, "v5rc");
  assert.equal(v5.ok && v5.manualVersion, "2.1", "the edition comes from the V5RC data");
});

test("a client-supplied manual version is ignored: it is always taken from the ruleset", () => {
  const forged = parseFlagFields({
    ...validReport,
    kind: "minor",
    ruleset: "v5rc",
    rules: ["SG6"],
    manualVersion: "9.9",
    manual_version: "9.9",
  });
  assert.equal(forged.ok && forged.manualVersion, "2.1");
});

test("an IQ-only rule id is rejected under V5RC, and a V5RC-only id under IQ", () => {
  // RSC8 (Skills Stop Time) exists only in the IQ manual.
  const iqOnly = parseFlagFields({ ...validReport, kind: "minor", ruleset: "v5rc", rules: ["RSC8"] });
  assert.equal(iqOnly.ok, false, "RSC8 must not validate against V5RC");
  assert.match(!iqOnly.ok ? iqOnly.error : "", /RSC8/);
  assert.equal(parseFlagFields({ ...validReport, kind: "minor", ruleset: "viqrc", rules: ["RSC8"] }).ok, true);

  const v5Only = parseFlagFields({ ...validReport, kind: "minor", ruleset: "viqrc", rules: ["GG17"] });
  assert.equal(v5Only.ok, false, "GG17 must not validate against VEX IQ");
  assert.equal(parseFlagFields({ ...validReport, kind: "minor", ruleset: "v5rc", rules: ["GG17"] }).ok, true);

  // A mixed list fails as a whole: one bad id is a bad request, not a trim.
  assert.equal(
    parseFlagFields({ ...validReport, kind: "minor", ruleset: "v5rc", rules: ["GG17", "RSC8"] }).ok,
    false,
  );
});

test("an unknown ruleset is refused rather than guessed", () => {
  const result = parseFlagFields({ ...validReport, kind: "minor", ruleset: "vexu", rules: ["SG6"] });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 400);
});

test("several rules are normalised, de-duplicated and stored comma-joined", () => {
  const result = parseFlagFields({
    ...validReport,
    kind: "major",
    ruleset: "v5rc",
    rules: ["gg17", "SG9", " GG17 "],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.rules, ["GG17", "SG9"]);
    assert.equal(result.rule, "GG17,SG9");
  }
});

test("the legacy single `rule` string still works, including a comma-joined one", () => {
  const single = parseFlagFields({ ...validReport, kind: "minor", rule: "sg7" });
  assert.equal(single.ok && single.rule, "SG7");
  const joined = parseFlagFields({ ...validReport, kind: "minor", rule: "SG6,SG7" });
  assert.equal(joined.ok && joined.rule, "SG6,SG7");
});

test(`more than ${MAX_FLAG_RULES} rules is refused`, () => {
  const ids = ["SG1", "SG2", "SG3", "SG4", "SG5", "SG6"];
  assert.equal(ids.length > MAX_FLAG_RULES, true);
  assert.equal(parseFlagFields({ ...validReport, kind: "minor", rules: ids }).ok, false);
  assert.equal(parseFlagFields({ ...validReport, kind: "minor", rules: ids.slice(0, MAX_FLAG_RULES) }).ok, true);
});

test("a correction that names no ruleset keeps the flag's own, so V5RC is not silently moved to IQ", () => {
  const kept = parseFlagFields(
    { ...validReport, kind: "minor", rules: ["GG17"] },
    { defaultRuleset: "v5rc" },
  );
  assert.equal(kept.ok && kept.ruleset, "v5rc");
  // And a flag with no ruleset at all (legacy) is IQ.
  const legacy = parseFlagFields({ ...validReport, kind: "minor", rule: "SG6" }, { defaultRuleset: null });
  assert.equal(legacy.ok && legacy.ruleset, "viqrc");
});

test("match affecting is stored only for Minor and Major", () => {
  const stored = (kind: string, matchAffecting: unknown) => {
    const r = parseFlagFields({ ...validReport, kind, rule: "SG6", matchAffecting });
    assert.equal(r.ok, true, kind);
    return r.ok && r.matchAffecting;
  };
  assert.equal(stored("minor", true), true);
  assert.equal(stored("major", true), true);
  for (const kind of ["good", "warning", "dq"]) {
    assert.equal(stored(kind, true), false, `${kind} must not keep a match-affecting tick`);
  }
  assert.equal(stored("minor", false), false);
  assert.equal(stored("minor", "yes"), false, "only a real boolean true counts");
  assert.equal(stored("minor", undefined), false);
});

test("Disqualified is a configured kind: the most severe, rule-requiring, and never the fallback", () => {
  const kinds = refereeFlags();
  const dq = kinds.find((k) => k.id === "dq");
  assert.ok(dq, "config/event.json has no dq kind");
  assert.equal(dq.label, "Disqualified");
  assert.equal(dq.short, "DQ");
  assert.equal(dq.requiresRule, true);
  assert.equal(dq.severity, Math.max(...kinds.map((k) => k.severity)));

  const parsed = parseFlagFields({ ...validReport, kind: "Disqualified", rule: "GG6" });
  assert.equal(parsed.ok && parsed.kind, "dq");
  // An unrecognised kind still falls back to the LEAST severe, never to DQ.
  const unknown = parseFlagFields({ ...validReport, kind: "banned" });
  assert.equal(unknown.ok && unknown.kind, "good");
});

/* ---- match types and field ------------------------------------- */

const ids = (rulesetId: string) => matchTypes(rulesetId).map((t) => t.id);

test("each program offers its own Teamwork types, and Driver and Auto for Skills", () => {
  assert.deepEqual(ids("viqrc"), ["P", "Q", "F", "SKD", "SKA"]);
  assert.deepEqual(ids("v5rc"), ["P", "Q", "R16", "QF", "SF", "F", "SKD", "SKA"]);
  for (const rulesetId of ["viqrc", "v5rc"]) {
    const groups = Object.fromEntries(matchTypes(rulesetId).map((t) => [t.id, t.group]));
    assert.equal(groups.SKD, "skills");
    assert.equal(groups.SKA, "skills");
    assert.equal(groups.Q, "teamwork");
  }
  assert.equal(matchTypes("v5rc").find((t) => t.id === "QF")?.label, "Quarterfinal");
});

test("a V5RC-only type is refused on VEX IQ, and VEX IQ's plain Final on V5RC is not a bracket", () => {
  assert.equal(isValidMatchType("QF", "v5rc"), true);
  assert.equal(isValidMatchType("QF", "viqrc"), false);
  assert.equal(isValidMatchType("R16", "viqrc"), false);

  const onIq = parseFlagFields({ ...validReport, matchType: "QF", matchNumber: "2-1", ruleset: "viqrc" });
  assert.equal(onIq.ok, false, "QF is not a VEX IQ match type");
  assert.match(!onIq.ok ? onIq.error : "", /Pick which match this was/);
  assert.doesNotMatch(!onIq.ok ? onIq.error : "", /QF/, "and the answer lists VEX IQ's own types");

  // The reverse: VEX IQ's shapes do not pass on V5RC.
  const plainFinal = parseFlagFields({ ...validReport, matchType: "F", matchNumber: "3", ruleset: "v5rc" });
  assert.equal(plainFinal.ok, false, "a V5RC Final is a bracket and a match");
  assert.match(!plainFinal.ok ? plainFinal.error : "", /bracket and match/);
  const iqFinal = parseFlagFields({ ...validReport, matchType: "F", matchNumber: "3", ruleset: "viqrc" });
  assert.equal(iqFinal.ok && iqFinal.matchNumber, "3");
  const bracketOnIq = parseFlagFields({ ...validReport, matchType: "F", matchNumber: "1-2", ruleset: "viqrc" });
  assert.equal(bracketOnIq.ok && bracketOnIq.matchNumber, "12", "VEX IQ numbers are plain: the dash is dropped");

  // Old flags' types stay valid on both.
  for (const type of ["P", "Q", "F"]) {
    assert.equal(isValidMatchType(type, "viqrc"), true, type);
  }
});

test("a V5RC elimination is stored as bracket-match, \"QF 2-1\"", () => {
  const qf = parseFlagFields({ ...validReport, matchType: "QF", matchNumber: "2 1", ruleset: "v5rc" });
  assert.equal(qf.ok && qf.matchType, "QF");
  assert.equal(qf.ok && qf.matchNumber, "2-1");
  for (const half of ["2", "", "2-"]) {
    assert.equal(
      parseFlagFields({ ...validReport, matchType: "QF", matchNumber: half, ruleset: "v5rc" }).ok,
      false,
      `"${half}" is not a bracket and a match`,
    );
  }
});

test("the legacy SK is refused on a new flag but a flag already holding it can be corrected", () => {
  assert.equal(isValidMatchType("SK", "viqrc"), false, "never offered");
  const fresh = parseFlagFields({ ...validReport, matchType: "SK", matchNumber: "3" });
  assert.equal(fresh.ok, false);

  const legacy = flag("1", { match_type: "SK", match_number: "3", field: "HS2" });
  const kept = parseFlagFields(
    { ...validReport, matchType: "SK", matchNumber: "3", field: "HS2" },
    { existing: legacy },
  );
  assert.equal(kept.ok, true, "an unchanged correction keeps the legacy type and field");
  assert.equal(kept.ok && kept.matchType, "SK");
  assert.equal(kept.ok && kept.field, "HS2");

  // Moving it to a type the program offers is a normal pick.
  const moved = parseFlagFields(
    { ...validReport, matchType: "SKD", matchNumber: "3", field: "HS2" },
    { existing: legacy },
  );
  assert.equal(moved.ok && moved.matchType, "SKD");
});

test("an alliance in the request is ignored: nothing of it is validated, kept or returned", () => {
  for (const matchType of ["Q", "SKD"]) {
    for (const alliance of ["red", "blue", "green", "", null]) {
      const r = parseFlagFields({ ...validReport, matchType, matchNumber: "1", alliance });
      assert.equal(r.ok, true, `${matchType} with alliance ${JSON.stringify(alliance)}`);
      assert.equal(r.ok && "alliance" in r, false, "the parsed fields carry no alliance");
    }
  }
});

test("a field is a number from 1 to the event's field count", () => {
  const field = (f: unknown, fieldCount?: number | null) =>
    parseFlagFields({ ...validReport, field: f }, { fieldCount });
  const stored = (f: unknown, fieldCount?: number | null) => {
    const r = field(f, fieldCount);
    return r.ok ? r.field : null;
  };

  assert.equal(stored("1", 3), "1");
  assert.equal(stored(" 3 ", 3), "3");
  assert.equal(stored(2, 3), "2", "a JSON number is fine");
  assert.equal(stored("02", 3), "2", "stored as a plain number");

  for (const bad of ["4", "0", "", "-1", "1.5", "two", "ES2", "Field 2", "100"]) {
    const r = field(bad, 3);
    assert.equal(r.ok, false, `"${bad}" with 3 fields`);
    assert.equal(!r.ok && r.error, "Pick the field — 1 to 3.");
  }

  // No setup saved yet: the setup's own ceiling, 20.
  assert.equal(stored("20"), "20");
  const tooMany = field("21");
  assert.equal(!tooMany.ok && tooMany.error, "Pick the field — 1 to 20.");
  assert.equal(stored("5", null), "5");
});

test("a correction that leaves the field alone keeps a legacy or outgrown one; changing it must be a real pick", () => {
  const old = flag("1", { field: "HS2" });
  const keep = parseFlagFields({ ...validReport, field: "HS2" }, { existing: old, fieldCount: 3 });
  assert.equal(keep.ok && keep.field, "HS2");

  // The event shrank from 4 fields to 3 after this flag was raised on field 4.
  const outgrown = flag("2", { field: "4" });
  assert.equal(parseFlagFields({ ...validReport, field: "4" }, { existing: outgrown, fieldCount: 3 }).ok, true);

  // Changing it is a new pick: not a legacy value, not above the count.
  assert.equal(parseFlagFields({ ...validReport, field: "ES3" }, { existing: old, fieldCount: 3 }).ok, false);
  assert.equal(parseFlagFields({ ...validReport, field: "5" }, { existing: outgrown, fieldCount: 3 }).ok, false);
  assert.equal(parseFlagFields({ ...validReport, field: "2" }, { existing: old, fieldCount: 3 }).ok, true);
  // And "unchanged" needs something to be unchanged from.
  assert.equal(parseFlagFields({ ...validReport, field: "HS2" }, { fieldCount: 3 }).ok, false);
  assert.equal(parseFlagFields({ ...validReport, field: "" }, { existing: flag("3", { field: null }) }).ok, false);
});

test("a new flag takes the event's program, and naming another is refused with its name", () => {
  const defaulted = parseFlagFields({ ...validReport, kind: "minor", rule: "SG6" }, { eventRuleset: "v5rc" });
  assert.equal(defaulted.ok && defaulted.ruleset, "v5rc", "the request named none");
  assert.equal(defaulted.ok && defaulted.manualVersion, "2.1");

  const same = parseFlagFields({ ...validReport, ruleset: "v5rc", kind: "minor", rule: "SG6" }, { eventRuleset: "v5rc" });
  assert.equal(same.ok, true);

  const other = parseFlagFields({ ...validReport, ruleset: "viqrc", kind: "minor", rule: "SG6" }, { eventRuleset: "v5rc" });
  assert.equal(other.ok, false);
  assert.equal(!other.ok && other.error, "This event is set to V5RC Override.");
  assert.equal(!other.ok && other.status, 400);
  const otherWay = parseFlagFields({ ...validReport, ruleset: "v5rc", kind: "minor", rule: "SG6" }, { eventRuleset: "viqrc" });
  assert.equal(!otherWay.ok && otherWay.error, "This event is set to VEX IQ.");

  // No setup: today's behaviour, VEX IQ, and any real ruleset may be named.
  assert.equal(parseFlagFields({ ...validReport, kind: "minor", rule: "SG6" }).ok && "viqrc", "viqrc");
  assert.equal(parseFlagFields({ ...validReport, ruleset: "v5rc", kind: "minor", rule: "SG6" }, { eventRuleset: null }).ok, true);

  // A correction names no event ruleset: a flag keeps (or is moved off) its own.
  const corrected = parseFlagFields(
    { ...validReport, ruleset: "viqrc", kind: "minor", rule: "SG6" },
    { defaultRuleset: "v5rc" },
  );
  assert.equal(corrected.ok && corrected.ruleset, "viqrc");
});

test("the setup body: a real program, 1 to 20 fields and a real calendar date", () => {
  const ok = parseRefereeSetup({ ruleset: "v5rc", field_count: 3, today: "2026-09-09" });
  assert.deepEqual(ok, { ok: true, ruleset: "v5rc", fieldCount: 3, today: "2026-09-09" });
  assert.equal(parseRefereeSetup({ ruleset: "viqrc", field_count: 1, today: "2024-02-29" }).ok, true, "a leap day");
  assert.equal(parseRefereeSetup({ ruleset: "viqrc", field_count: 20, today: "2026-12-31" }).ok, true);

  const bad = (body: Record<string, unknown>) => parseRefereeSetup({ ruleset: "v5rc", field_count: 3, today: "2026-09-09", ...body });
  for (const ruleset of ["", "vexu", undefined, 5]) assert.equal(bad({ ruleset }).ok, false, `ruleset ${ruleset}`);
  for (const field_count of [0, 21, 1.5, -1, "3", null, undefined, NaN, 3.0000001]) {
    assert.equal(bad({ field_count }).ok, false, `field_count ${field_count}`);
  }
  for (const today of ["", undefined, "2026-9-9", "09/09/2026", "2026-09-09T10:00", "2026-02-30", "2025-02-29", "2026-13-01", "2026-00-10", "today"]) {
    assert.equal(bad({ today }).ok, false, `today ${today}`);
  }
});

/* ---- repeat history ------------------------------------------------------ */

function flag(id: string, values: Partial<FlagRow> = {}): FlagRow {
  return {
    id,
    team_id: "team-1852B",
    kind: "minor",
    body: `Observation ${id}`,
    author: "Head Referee",
    match_type: "Q",
    match_number: "23",
    field: "2",
    rule: "SG6",
    ruleset: "viqrc",
    manual_version: null,
    match_affecting: false,
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
  const history = refereeHistory(reports, "team-1852B", ["SG6"], "Q", "23", "viqrc");

  assert.equal(history.byRule.length, 1);
  const sg6 = history.byRule[0];
  assert.equal(sg6.rule, "SG6");
  assert.deepEqual(sg6.sameRule.map((report) => report.id), ["1", "2", "3"]);
  assert.deepEqual(sg6.sameMatchSameRule.map((report) => report.id), ["1", "2"]);
  assert.equal(history.eventTotals.get("minor"), 3, "event totals include SG6 and SG7 Minors");
  assert.equal(history.eventTotals.get("warning"), 2, "event totals include all team Warnings");
  assert.equal(history.eventTotals.has("good"), false);
  assert.equal(history.escalationReviewRequired, true);
  assert.deepEqual(reports.map((report) => report.kind), beforeKinds, "history must never alter severity");
});

test("changing team or rule cannot leave another selection's repeated history behind", () => {
  const reports = [flag("1"), flag("2", { rule: "SG7" }), flag("3", { team_id: "other" })];

  assert.deepEqual(
    refereeHistory(reports, "team-1852B", ["SG7"], "Q", "23").byRule[0].sameRule.map((f) => f.id),
    ["2"],
  );
  assert.deepEqual(
    refereeHistory(reports, "other", ["SG6"], "Q", "23").byRule[0].sameRule.map((f) => f.id),
    ["3"],
  );
  assert.deepEqual(refereeHistory(reports, null, ["SG6"], "Q", "23").byRule, []);
  assert.deepEqual(refereeHistory(reports, "team-1852B", [], "Q", "23").byRule, []);
});

test("history never mixes rulesets: V5RC SG6 and IQ SG6 are different rules", () => {
  const reports = [
    flag("1", { ruleset: "viqrc" }),
    flag("2", { ruleset: "v5rc" }),
    flag("3", { ruleset: null }), // recorded before rulesets: it is IQ
    flag("4", { ruleset: "v5rc", rule: "SG7" }),
  ];

  const v5 = refereeHistory(reports, "team-1852B", ["SG6"], "Q", "23", "v5rc");
  assert.deepEqual(v5.byRule[0].sameRule.map((f) => f.id), ["2"]);

  const iq = refereeHistory(reports, "team-1852B", ["SG6"], "Q", "23", "viqrc");
  assert.deepEqual(iq.byRule[0].sameRule.map((f) => f.id), ["1", "3"], "a null ruleset counts as IQ");

  // Omitting the ruleset is IQ, the same as a legacy flag.
  assert.deepEqual(
    refereeHistory(reports, "team-1852B", ["SG6"], "Q", "23").byRule[0].sameRule.map((f) => f.id),
    ["1", "3"],
  );
});

test("a flag citing several rules counts toward each, and several current rules report per rule", () => {
  const reports = [
    flag("1", { ruleset: "v5rc", rule: "GG17,SG9" }),
    flag("2", { ruleset: "v5rc", rule: "SG9" }),
    flag("3", { ruleset: "v5rc", rule: "SG90" }), // not SG9: ids match whole, never by prefix
    flag("4", { ruleset: "v5rc", rule: "GG17", match_number: "24" }),
  ];

  const history = refereeHistory(reports, "team-1852B", ["SG9", "GG17", "SG6"], "Q", "23", "v5rc");
  assert.deepEqual(history.byRule.map((h) => h.rule), ["SG9", "GG17", "SG6"], "one entry per cited rule, in order");
  assert.deepEqual(history.byRule[0].sameRule.map((f) => f.id), ["1", "2"]);
  assert.deepEqual(history.byRule[1].sameRule.map((f) => f.id), ["1", "4"]);
  assert.deepEqual(history.byRule[1].sameMatchSameRule.map((f) => f.id), ["1"]);
  assert.deepEqual(history.byRule[2].sameRule, [], "a cited rule with no history is reported empty");
});

test("history stays advisory: no result field selects or implies a kind", () => {
  const history = refereeHistory([flag("1")], "team-1852B", ["SG6"], "Q", "23");
  assert.deepEqual(Object.keys(history).sort(), ["byRule", "escalationReviewRequired", "eventTotals"]);
});

test("the runtime rule categories keep the Quick Reference order with Tournament Special last", () => {
  assert.deepEqual([...QUICK_REFERENCE_RULE_CATEGORIES], [
    "Scoring Rules",
    "Specific Game Rules",
    "Safety Rules",
    "General Rules",
    "General Game Rules",
    "Robot Skills Challenge Rules",
    "Robot Rules",
    "Tournament Rules",
  ]);
  assert.deepEqual([...RULE_CATEGORIES], [
    ...QUICK_REFERENCE_RULE_CATEGORIES,
    "Tournament Special",
  ]);
  assert.equal(getRuleset("viqrc").rules.length, 81);
  assert.equal(getRuleset("v5rc").rules.length, 109);
});

test("the real search finds every mandated IQ rule using partial, case-insensitive terms", () => {
  const cases: Record<string, string[]> = {
    SG6: ["SG6", "<SG6>", "6", "possession", "possess", "plow", "plowing", "bean bag"],
    SG7: ["SG7", "load", "loading", "loader", "load zone"],
    GG4: ["GG4", "hands", "hand", "field"],
    GG10: ["GG10", "handling", "robot", "reset"],
    GG12: ["GG12", "timer", "start", "stop", "early", "late", "timing"],
    TS1: ["TS1", "sportsmanship", "respect"],
    TS2: ["TS2", "unsportsmanlike", "taunting"],
    TS3: ["TS3", "help reset", "field reset"],
  };

  for (const [id, queries] of Object.entries(cases)) {
    for (const query of queries) {
      assert.ok(searchRules(query.toUpperCase(), "viqrc").some((rule) => rule.id === id), `${query} missed ${id}`);
    }
  }
});

test("\"same match\" is the whole reference: QF 2-1 and QF 2-2 are different matches", () => {
  const reports = [
    flag("1", { ruleset: "v5rc", rule: "GG17", match_type: "QF", match_number: "2-1" }),
    flag("2", { ruleset: "v5rc", rule: "GG17", match_type: "QF", match_number: "2-2" }),
    flag("3", { ruleset: "v5rc", rule: "GG17", match_type: "QF", match_number: "02-01" }),
    flag("4", { ruleset: "v5rc", rule: "GG17", match_type: "SF", match_number: "2-1" }),
    flag("5", { ruleset: "v5rc", rule: "GG17", match_type: "QF", match_number: "1-12" }),
    flag("6", { ruleset: "v5rc", rule: "GG17", match_type: "QF", match_number: "11-2" }),
  ];
  const sameMatch = (type: string, number: string) =>
    refereeHistory(reports, "team-1852B", ["GG17"], type, number, "v5rc").byRule[0].sameMatchSameRule.map((f) => f.id);

  assert.deepEqual(sameMatch("QF", "2-1"), ["1", "3"], "the stored 02-01 is the same bracket and match");
  assert.deepEqual(sameMatch("QF", "2-2"), ["2"]);
  assert.deepEqual(sameMatch("SF", "2-1"), ["4"], "a different type is a different match");
  assert.deepEqual(sameMatch("QF", "1-12"), ["5"], "1-12 is not 11-2");
  assert.deepEqual(sameMatch("QF", "11-2"), ["6"]);
  assert.deepEqual(sameMatch("QF", ""), [], "no match number, no match");
  assert.deepEqual(sameMatch("", "2-1"), [], "no match type, no match");

  const plain = [flag("7", { match_type: "P", match_number: "3" }), flag("8", { match_type: "Q", match_number: "3" })];
  assert.deepEqual(
    refereeHistory(plain, "team-1852B", ["SG6"], "Q", "3", "viqrc").byRule[0].sameMatchSameRule.map((f) => f.id),
    ["8"],
  );
});
