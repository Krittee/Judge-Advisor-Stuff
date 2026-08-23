import assert from "node:assert/strict";
import test from "node:test";

/* Mirrors src/lib/teamNumber.ts. Team numbers are text — plenty of
   programmes use a letter suffix, like 9882K — but people still expect
   them ordered as if they were numbers. */

const MAX_LENGTH = 12;
const VALID = /^[A-Z0-9][A-Z0-9-]*$/;

function normalizeTeamNumber(input) {
  return String(input ?? "").replace(/\s+/g, "").toUpperCase().slice(0, MAX_LENGTH);
}

function isValidTeamNumber(value) {
  return value.length > 0 && value.length <= MAX_LENGTH && VALID.test(value);
}

function filterTeamNumberInput(input) {
  return input.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, MAX_LENGTH);
}

function compareTeamNumbers(a, b) {
  const [, digitsA = "", restA = ""] = /^(\d*)(.*)$/.exec(a ?? "") ?? [];
  const [, digitsB = "", restB = ""] = /^(\d*)(.*)$/.exec(b ?? "") ?? [];
  const numA = digitsA === "" ? Number.POSITIVE_INFINITY : Number(digitsA);
  const numB = digitsB === "" ? Number.POSITIVE_INFINITY : Number(digitsB);
  if (numA !== numB) return numA < numB ? -1 : 1;
  return restA.localeCompare(restB);
}

test("letter-suffixed team numbers are valid", () => {
  for (const n of ["9882K", "1234", "1234A", "12A", "7", "9882-K", "ABC"]) {
    assert.ok(isValidTeamNumber(n), `${n} should be valid`);
  }
});

test("junk is rejected", () => {
  for (const n of ["", "-1234", "12 34", "12.5", "TEAM#1", "1234567890123"]) {
    assert.ok(!isValidTeamNumber(n), `${n} should be rejected`);
  }
});

test("a team finds itself whatever case or spacing they type", () => {
  assert.equal(normalizeTeamNumber("9882k"), "9882K");
  assert.equal(normalizeTeamNumber("  9882 K "), "9882K");
  assert.equal(normalizeTeamNumber("9882K"), "9882K");
  // The important consequence: all three are the same team.
  const typed = ["9882k", "9882 K", " 9882K "].map(normalizeTeamNumber);
  assert.equal(new Set(typed).size, 1);
});

test("typing filters out characters a team number cannot contain", () => {
  assert.equal(filterTeamNumberInput("98 82k!"), "9882K");
  assert.equal(filterTeamNumberInput("<script>"), "SCRIPT");
  assert.equal(filterTeamNumberInput("aaaaaaaaaaaaaaaaaaaa"), "AAAAAAAAAAAA");
});

test("ordering is numeric first, not alphabetical", () => {
  const sorted = ["100", "20", "3", "1234"].sort(compareTeamNumbers);
  assert.deepEqual(sorted, ["3", "20", "100", "1234"], "plain text sort would give 100, 1234, 20, 3");
});

test("a letter suffix sorts right after its own number", () => {
  const sorted = ["9882K", "9883", "9882", "9882A", "9881"].sort(compareTeamNumbers);
  assert.deepEqual(sorted, ["9881", "9882", "9882A", "9882K", "9883"]);
});

test("identifiers with no leading digits sort to the end", () => {
  const sorted = ["ABC", "9882", "ZZ", "100"].sort(compareTeamNumbers);
  assert.deepEqual(sorted, ["100", "9882", "ABC", "ZZ"]);
});

test("sorting is a valid total order (no NaN comparisons)", () => {
  const numbers = ["100", "20", "9882K", "ABC", "3", "9882", "ZZ", "1234A", "1234"];
  const sorted = [...numbers].sort(compareTeamNumbers);
  // A comparator returning NaN leaves the array in an arbitrary order,
  // so assert the result is stable across differently-shuffled inputs.
  const reshuffled = [...numbers].reverse().sort(compareTeamNumbers);
  assert.deepEqual(sorted, reshuffled);
  assert.equal(compareTeamNumbers("ABC", "ABC"), 0);
});
