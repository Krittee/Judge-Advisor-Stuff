import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  compareTeamNumbers,
  danglingSuffixes,
  filterTeamNumberInput,
  isValidTeamNumber,
  normalizeTeamNumber,
  parseTeamNumberList,
} from "../src/lib/teamNumber";

/* src/lib/teamNumber.ts, run as it is. Team numbers are text — plenty of
   programmes use a letter suffix, like 9882K — but people still expect
   them ordered as if they were numbers. */

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

/* ---- reading a hand-written list of team numbers --------------------- */

/* The Judge Advisor asks a panel "any teams you're affiliated with?" and
   types the answer in as it was given: commas, spaces, newlines, or all
   three. Every number has to come back out, because one silently dropped
   is a conflict that never gets recorded. */

test("separators can be mixed however they were written down", () => {
  const expected = ["1234", "5678", "9882K"];
  for (const written of [
    "1234, 5678, 9882K",
    "1234 5678 9882K",
    "1234\n5678\n9882K",
    "1234;5678;9882K",
    "1234,5678\n  9882K  ",
    "  1234 ,, 5678 ;\n\n 9882K ",
  ]) {
    assert.deepEqual(parseTeamNumberList(written), expected, `failed on ${JSON.stringify(written)}`);
  }
});

test("a number repeated in the list is recorded once", () => {
  assert.deepEqual(parseTeamNumberList("1234, 5678, 1234"), ["1234", "5678"]);
  /* Including when only the case differs. */
  assert.deepEqual(parseTeamNumberList("9882k, 9882K"), ["9882K"]);
});

/* ---- a suffix split off its number ----------------------------------- */

test("a space inside a team number splits it, which must not pass silently", () => {
  /* "9882 K" cannot read as one team in a space-separated list, and the
     halves are dangerous: 9882 may be a real team, so recording against it
     would conflict the wrong people and leave 9882K judgeable. */
  assert.deepEqual(parseTeamNumberList("9882 K"), ["9882", "K"]);
  assert.deepEqual(danglingSuffixes("9882 K"), ["K"]);
  assert.deepEqual(danglingSuffixes("1234, 9882 K, 5678"), ["K"]);
});

test("a clean list has nothing adrift", () => {
  for (const clean of ["1234, 5678, 9882K", "1234\n5678", "9882K 1234A"]) {
    assert.deepEqual(danglingSuffixes(clean), [], `flagged something in ${clean}`);
  }
});

test("the source still carries the guard", () => {
  const src = readFileSync(new URL("../src/lib/teamNumber.ts", import.meta.url), "utf8");
  assert.ok(src.includes("export function danglingSuffixes"), "danglingSuffixes was removed");
});

test("order is kept, so the result reads against what was typed", () => {
  assert.deepEqual(parseTeamNumberList("9882K, 1234, 5678"), ["9882K", "1234", "5678"]);
});

test("an empty or separator-only list yields nothing", () => {
  for (const nothing of ["", "   ", ",,,", " ; , \n ", null, undefined]) {
    assert.deepEqual(parseTeamNumberList(nothing), []);
  }
});

test("letter suffixes and case survive the trip", () => {
  assert.deepEqual(parseTeamNumberList("9882k\n1234a"), ["9882K", "1234A"]);
});
