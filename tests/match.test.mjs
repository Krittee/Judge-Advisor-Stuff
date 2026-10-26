import assert from "node:assert/strict";
import test from "node:test";
import {
  fieldLabel,
  filterMatchNumberInput,
  isValidMatchNumber,
  matchReference,
  normalizeField,
  normalizeMatchNumber,
} from "../src/lib/match";

/* Match number and field: what lets a head referee trace a flag back to
   a moment on the field. These run the real functions in src/lib/match.ts
   (tests run under tsx), so a change to them fails here.

   A plain number (P, Q, Skills, VEX IQ's Final) is digits; a V5RC
   elimination (R16, QF, SF, F) is a bracket and a match, "2-1". Whether a
   type is a bracket depends on the program, so those calls name the ruleset. */

test("a match number keeps only digits", () => {
  assert.equal(normalizeMatchNumber("23"), "23");
  assert.equal(normalizeMatchNumber(" 23 "), "23");
  assert.equal(normalizeMatchNumber("Q23"), "23");
  assert.equal(normalizeMatchNumber("23-1"), "231");
  assert.equal(normalizeMatchNumber(""), "");
  assert.equal(normalizeMatchNumber(null), "");
  assert.equal(normalizeMatchNumber(undefined), "");
  assert.equal(normalizeMatchNumber("023"), "23");
  assert.equal(normalizeMatchNumber("Q0023"), "23");
  assert.equal(normalizeMatchNumber("0000"), "0");
});

test("a match number is capped rather than truncating silently wrong", () => {
  assert.equal(normalizeMatchNumber("123456"), "1234");
  assert.equal(isValidMatchNumber(normalizeMatchNumber("123456")), true);
});

test("an empty or non-numeric match number is invalid", () => {
  for (const bad of ["", "abc", "-", " "]) {
    assert.equal(isValidMatchNumber(normalizeMatchNumber(bad)), false, `"${bad}" should be invalid`);
  }
  assert.equal(isValidMatchNumber("23"), true);
  assert.equal(isValidMatchNumber("1"), true);
});

test("typing filter matches the normalizer, so what you see while typing is what gets saved", () => {
  for (const typed of ["23", "2a3b", "  99  ", "123456789"]) {
    assert.equal(filterMatchNumberInput(typed), normalizeMatchNumber(typed));
  }
});

test("plain types stay plain on both programs, Skills and VEX IQ's Final included", () => {
  for (const [type, ruleset] of [
    ["P", "v5rc"],
    ["Q", "v5rc"],
    ["SKD", "v5rc"],
    ["SKA", "viqrc"],
    ["F", "viqrc"],
    ["SK", "viqrc"], // the legacy Skills type
  ]) {
    assert.equal(normalizeMatchNumber("2-1", type, ruleset), "21", `${type} on ${ruleset} is a plain number`);
    assert.equal(isValidMatchNumber("21", type, ruleset), true);
    assert.equal(isValidMatchNumber("2-1", type, ruleset), false, `${type} on ${ruleset} takes no bracket`);
  }
});

test("a V5RC elimination number is a bracket and a match, whatever separates them", () => {
  for (const type of ["R16", "QF", "SF", "F"]) {
    assert.equal(normalizeMatchNumber("2-1", type, "v5rc"), "2-1", type);
    assert.equal(isValidMatchNumber("2-1", type, "v5rc"), true, type);
  }
  assert.equal(normalizeMatchNumber("2 1", "QF", "v5rc"), "2-1");
  assert.equal(normalizeMatchNumber("2/1", "QF", "v5rc"), "2-1");
  assert.equal(normalizeMatchNumber("02-01", "QF", "v5rc"), "2-1", "leading zeros go, as for a plain number");
  assert.equal(normalizeMatchNumber("12-3", "SF", "v5rc"), "12-3");
  assert.equal(normalizeMatchNumber("", "QF", "v5rc"), "");
  assert.equal(normalizeMatchNumber(null, "QF", "v5rc"), "");
});

test("a bracket number needs both halves, each at most two digits", () => {
  for (const half of ["", "2", "2-", "-1", "21"]) {
    assert.equal(
      isValidMatchNumber(normalizeMatchNumber(half, "QF", "v5rc"), "QF", "v5rc"),
      false,
      `"${half}" is only half a bracket`,
    );
  }
  // A third number is dropped, not folded in.
  assert.equal(normalizeMatchNumber("2-1-3", "QF", "v5rc"), "2-1");
  // Each half is capped at two digits, so "1-12" and "11-2" stay different matches.
  assert.equal(normalizeMatchNumber("123-456", "QF", "v5rc"), "12-45");
  assert.notEqual(normalizeMatchNumber("1-12", "QF", "v5rc"), normalizeMatchNumber("11-2", "QF", "v5rc"));
  assert.equal(isValidMatchNumber("1-123", "QF", "v5rc"), false);
  assert.equal(isValidMatchNumber("123-1", "QF", "v5rc"), false);
});

test("Final is plain on VEX IQ and a bracket on V5RC: the program decides, not the letter", () => {
  assert.equal(normalizeMatchNumber("1-2", "F", "viqrc"), "12");
  assert.equal(normalizeMatchNumber("1-2", "F", "v5rc"), "1-2");
  assert.equal(isValidMatchNumber("3", "F", "viqrc"), true);
  assert.equal(isValidMatchNumber("3", "F", "v5rc"), false);
  // Left out, the ruleset is VEX IQ, the same as a flag recorded before rulesets.
  assert.equal(normalizeMatchNumber("1-2", "F"), "12");
});

test("typing a bracket keeps the dash between the two keystrokes", () => {
  assert.equal(filterMatchNumberInput("2", "QF", "v5rc"), "2");
  assert.equal(filterMatchNumberInput("2-", "QF", "v5rc"), "2-");
  assert.equal(filterMatchNumberInput("2 ", "QF", "v5rc"), "2");
  assert.equal(filterMatchNumberInput("2-1", "QF", "v5rc"), "2-1");
  assert.equal(filterMatchNumberInput("2--", "QF", "v5rc"), "2-");
  assert.equal(filterMatchNumberInput("-", "QF", "v5rc"), "");
  assert.equal(filterMatchNumberInput("2a-b1", "QF", "v5rc"), "2-1");
  // A plain type has no dash to keep.
  assert.equal(filterMatchNumberInput("2-", "Q", "v5rc"), "2");
});

test("a field is trimmed and its internal whitespace collapsed", () => {
  assert.equal(normalizeField("  Field   2  "), "Field 2");
  assert.equal(normalizeField("A"), "A");
  assert.equal(normalizeField(""), "");
  assert.equal(normalizeField(null), "");
});

test("a field longer than the cap is trimmed to it, not silently accepted whole", () => {
  assert.equal(normalizeField("x".repeat(80)).length, 40);
});

test("a picked field reads \"Field 2\"; a legacy one reads as it was recorded", () => {
  assert.equal(fieldLabel("2"), "Field 2");
  assert.equal(fieldLabel("12"), "Field 12");
  assert.equal(fieldLabel("HS2"), "HS2", "a prefixed field from before is not rewritten");
  assert.equal(fieldLabel("Field 2"), "Field 2", "and nor is old free text doubled up");
  assert.equal(fieldLabel(""), null);
  assert.equal(fieldLabel(null), null);
});

test("the match reference combines type and number, and only when both exist", () => {
  assert.equal(matchReference("Q", "23"), "Q23");
  assert.equal(matchReference("F", "1"), "F1");
  assert.equal(matchReference(null, "23"), null);
  assert.equal(matchReference("Q", null), null);
  assert.equal(matchReference(null, null), null);
});

test("a longer type code gets a space, and a Skills run is named in words", () => {
  assert.equal(matchReference("QF", "2-1"), "QF 2-1");
  assert.equal(matchReference("R16", "3-1"), "R16 3-1");
  assert.equal(matchReference("SF", "1-2"), "SF 1-2");
  assert.equal(matchReference("SKD", "1"), "Driver 1");
  assert.equal(matchReference("SKA", "2"), "Auto 2");
  assert.equal(matchReference("SK", "3"), "Skills 3", "a flag from before Driver and Auto were told apart");
  assert.equal(matchReference("P", "4"), "P4", "a single letter is unchanged");
});
