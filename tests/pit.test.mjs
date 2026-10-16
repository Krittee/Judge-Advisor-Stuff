import assert from "node:assert/strict";
import test from "node:test";

/* Runs against the real src/lib/pit.ts rather than a copy of it. A pit is a
   letter and a number -- the letter is the row, the number the position
   along it -- which is what lets the board draw a floor plan nobody had to
   lay out by hand. */

import { buildFloorPlan, comparePits, normalizePit, parsePit } from "../src/lib/pit";

test("a pit code is a letter and a number", () => {
  assert.deepEqual(parsePit("A1"), { row: "A", position: 1, label: "A1" });
  assert.deepEqual(parsePit("B12"), { row: "B", position: 12, label: "B12" });
});

test("however it was typed, one pit is one pit", () => {
  for (const typed of ["a1", "A1", " A 1 ", "A01", "Pit A1", "pit a01"]) {
    assert.equal(normalizePit(typed), "A1", `${typed} should normalise to A1`);
  }
});

test("a pit that is not a letter and a number is kept, not mangled", () => {
  // The older free-text style still has to survive a round trip.
  assert.equal(normalizePit("TABLE3"), "TABLE3");
  assert.equal(parsePit("TABLE3"), null, "it just cannot be placed on the plan");
  assert.equal(normalizePit(""), null);
  assert.equal(normalizePit(null), null);
});

test("pits sort in reading order, not alphabetically", () => {
  const sorted = ["A10", "B1", "A2", "A1"].sort(comparePits);
  assert.deepEqual(sorted, ["A1", "A2", "A10", "B1"], "plain text sort would put A10 before A2");
});

test("unplaceable pits sort to the end", () => {
  const sorted = ["TABLE3", "B1", "A1"].sort(comparePits);
  assert.deepEqual(sorted, ["A1", "B1", "TABLE3"]);
});

test("each row is drawn across its own span, not the width of the whole floor", () => {
  const teams = [
    { n: "1", pit: "A1" },
    { n: "2", pit: "A5" },
    { n: "3", pit: "B1" },
  ];
  const plan = buildFloorPlan(teams, (t) => t.pit);

  assert.deepEqual(plan.map((r) => r.row), ["A", "B"]);
  assert.equal(plan[0].cells.length, 5, "A runs A1 to A5");
  assert.equal(plan[1].cells.length, 1, "B has only B1, so it draws nothing past it");
});

test("a gap stays a gap instead of shifting the row along", () => {
  const teams = [
    { n: "1", pit: "A1" },
    { n: "3", pit: "A3" },
  ];
  const [rowA] = buildFloorPlan(teams, (t) => t.pit);

  assert.equal(rowA.cells[0][0].n, "1");
  assert.deepEqual(rowA.cells[1], [], "A2 is empty and must read as empty");
  assert.equal(rowA.cells[2][0].n, "3", "A3 stays in the third column");
});

test("teams with no placeable pit are left off the plan entirely", () => {
  const teams = [
    { n: "1", pit: "A1" },
    { n: "2", pit: null },
    { n: "3", pit: "TABLE3" },
  ];
  const plan = buildFloorPlan(teams, (t) => t.pit);

  assert.equal(plan.length, 1);
  assert.equal(plan[0].cells.flat().length, 1, "only A1 is placed");
});

test("an empty roster produces an empty plan rather than throwing", () => {
  assert.deepEqual(buildFloorPlan([], (t) => t.pit), []);
});

test("two teams on one pit are both kept in that cell, neither overwriting the other", () => {
  const teams = [
    { n: "first", pit: "A1" },
    { n: "second", pit: "A1" },
  ];
  const [rowA] = buildFloorPlan(teams, (t) => t.pit);
  assert.deepEqual(
    rowA.cells[0].map((t) => t.n),
    ["first", "second"],
    "a Map keyed by pit used to keep only the last team; both must stay findable",
  );
});

test("each row reports the span it actually occupies, and draws only that span", () => {
  const teams = [
    { n: "1", pit: "C5" },
    { n: "2", pit: "C6" },
    { n: "3", pit: "D1" },
  ];
  const plan = buildFloorPlan(teams, (t) => t.pit);
  const rowC = plan.find((r) => r.row === "C");

  assert.equal(rowC.from, 5);
  assert.equal(rowC.to, 6);
  assert.equal(rowC.cells.length, 2, "C1 to C4 are not drawn, so they cannot read as free pits");
  assert.equal(rowC.cells[0][0].n, "1", "the first cell is C5, not C1");
});

test("a gap inside the span is still a real empty pit", () => {
  const teams = [
    { n: "1", pit: "A2" },
    { n: "2", pit: "A4" },
  ];
  const [rowA] = buildFloorPlan(teams, (t) => t.pit);

  assert.equal(rowA.from, 2);
  assert.equal(rowA.to, 4);
  assert.deepEqual(rowA.cells[1], [], "A3 sits inside the span, so it is genuinely free");
});

test("a row never stretches past its own last team", () => {
  const plan = buildFloorPlan([{ n: "1", pit: "A3" }], (t) => t.pit);
  assert.deepEqual([plan[0].from, plan[0].to, plan[0].cells.length], [3, 3, 1]);
});
