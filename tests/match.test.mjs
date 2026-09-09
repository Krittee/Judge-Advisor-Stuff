import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/* Match number and field: what lets a head referee trace a flag back to
   a moment on the field. Mirrors src/lib/match.ts, the way the other lib
   tests do, since these run under plain node --test with no TS loader. */

const MAX_MATCH_NUMBER_LENGTH = 4;
const MAX_FIELD_LENGTH = 40;

function normalizeMatchNumber(input) {
  const digits = String(input ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.slice(0, MAX_MATCH_NUMBER_LENGTH);
}
function isValidMatchNumber(value) {
  return value.length > 0 && value.length <= MAX_MATCH_NUMBER_LENGTH && /^\d+$/.test(value);
}
function filterMatchNumberInput(input) {
  return normalizeMatchNumber(input);
}
function normalizeField(input) {
  return String(input ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_FIELD_LENGTH);
}
function isValidField(value) {
  return value.length > 0 && value.length <= MAX_FIELD_LENGTH;
}
function matchReference(matchType, matchNumber) {
  if (!matchType || !matchNumber) return null;
  return `${matchType}${matchNumber}`;
}

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

test("a field is trimmed and its internal whitespace collapsed", () => {
  assert.equal(normalizeField("  Field   2  "), "Field 2");
  assert.equal(normalizeField("A"), "A");
  assert.equal(normalizeField(""), "");
  assert.equal(normalizeField(null), "");
});

test("a field longer than the cap is trimmed to it, not silently accepted whole", () => {
  const long = "x".repeat(80);
  assert.equal(normalizeField(long).length, MAX_FIELD_LENGTH);
});

test("an empty field is invalid; anything with content is valid", () => {
  assert.equal(isValidField(""), false);
  assert.equal(isValidField("   ".trim()), false);
  assert.equal(isValidField("A"), true);
  assert.equal(isValidField("Field 2"), true);
});

test("the match reference combines type and number, and only when both exist", () => {
  assert.equal(matchReference("Q", "23"), "Q23");
  assert.equal(matchReference("F", "1"), "F1");
  assert.equal(matchReference(null, "23"), null);
  assert.equal(matchReference("Q", null), null);
  assert.equal(matchReference(null, null), null);
});

test("the mirror above still matches the real limits in src/lib/match.ts", () => {
  const src = readFileSync(new URL("../src/lib/match.ts", import.meta.url), "utf8");
  assert.ok(
    new RegExp(`MAX_MATCH_NUMBER_LENGTH\\s*=\\s*${MAX_MATCH_NUMBER_LENGTH}\\b`).test(src),
    "match number length cap changed in the source; update this mirror",
  );
  assert.ok(
    new RegExp(`MAX_FIELD_LENGTH\\s*=\\s*${MAX_FIELD_LENGTH}\\b`).test(src),
    "field length cap changed in the source; update this mirror",
  );
  assert.ok(src.includes("export function matchReference"), "matchReference was renamed or removed");
});
