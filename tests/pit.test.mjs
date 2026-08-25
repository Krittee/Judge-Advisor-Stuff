import assert from "node:assert/strict";
import test from "node:test";

/* Mirrors src/lib/pit.ts. A pit is a letter and a number — the letter is
   the row, the number the position along it — which is what lets the
   board draw a floor plan nobody had to lay out by hand. */

const PIT = /^([A-Z])\s*0*(\d{1,3})$/;

function normalizePit(input) {
  const raw = String(input ?? "").replace(/\s+/g, "").toUpperCase().replace(/^PIT/, "");
  if (!raw) return null;
  const match = PIT.exec(raw);
  if (!match) return raw.slice(0, 12);
  const [, row, position] = match;
  return `${row}${Number(position)}`;
}

function parsePit(pit) {
  if (!pit) return null;
  const match = PIT.exec(pit.toUpperCase());
  if (!match) return null;
  const [, row, position] = match;
  return { row, position: Number(position), label: `${row}${Number(position)}` };
}

function comparePits(a, b) {
  const pa = parsePit(a);
  const pb = parsePit(b);
  if (!pa && !pb) return (a ?? "").localeCompare(b ?? "");
  if (!pa) return 1;
  if (!pb) return -1;
  return pa.row.localeCompare(pb.row) || pa.position - pb.position;
}

function buildFloorPlan(items, pitOf) {
  const placed = new Map();
  let widest = 0;
  for (const item of items) {
    const pit = parsePit(pitOf(item));
    if (!pit) continue;
    const row = placed.get(pit.row) ?? new Map();
    row.set(pit.position, item);
    placed.set(pit.row, row);
    widest = Math.max(widest, pit.position);
  }
  return [...placed.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([row, cells]) => {
      const taken = [...cells.keys()].sort((a, b) => a - b);
      return {
        row,
        cells: Array.from({ length: widest }, (_, i) => cells.get(i + 1) ?? null),
        from: taken[0],
        to: taken[taken.length - 1],
      };
    });
}

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

test("rows line up: every row is as wide as the widest one", () => {
  const teams = [
    { n: "1", pit: "A1" },
    { n: "2", pit: "A5" },
    { n: "3", pit: "B1" },
  ];
  const plan = buildFloorPlan(teams, (t) => t.pit);

  assert.deepEqual(plan.map((r) => r.row), ["A", "B"]);
  assert.equal(plan[0].cells.length, 5, "A5 sets the width");
  assert.equal(plan[1].cells.length, 5, "B matches it, so columns align");
});

test("a gap stays a gap instead of shifting the row along", () => {
  const teams = [
    { n: "1", pit: "A1" },
    { n: "3", pit: "A3" },
  ];
  const [rowA] = buildFloorPlan(teams, (t) => t.pit);

  assert.equal(rowA.cells[0].n, "1");
  assert.equal(rowA.cells[1], null, "A2 is empty and must read as empty");
  assert.equal(rowA.cells[2].n, "3", "A3 stays in the third column");
});

test("teams with no placeable pit are left off the plan entirely", () => {
  const teams = [
    { n: "1", pit: "A1" },
    { n: "2", pit: null },
    { n: "3", pit: "TABLE3" },
  ];
  const plan = buildFloorPlan(teams, (t) => t.pit);

  assert.equal(plan.length, 1);
  assert.equal(plan[0].cells.filter(Boolean).length, 1, "only A1 is placed");
});

test("an empty roster produces an empty plan rather than throwing", () => {
  assert.deepEqual(buildFloorPlan([], (t) => t.pit), []);
});

test("two teams cannot occupy one cell — the later one wins predictably", () => {
  const teams = [
    { n: "first", pit: "A1" },
    { n: "second", pit: "A1" },
  ];
  const [rowA] = buildFloorPlan(teams, (t) => t.pit);
  assert.equal(rowA.cells[0].n, "second", "last write wins, and nothing is dropped silently");
});

test("each row reports the span it actually occupies", () => {
  const teams = [
    { n: "1", pit: "C5" },
    { n: "2", pit: "C6" },
    { n: "3", pit: "D1" },
  ];
  const plan = buildFloorPlan(teams, (t) => t.pit);
  const rowC = plan.find((r) => r.row === "C");

  assert.equal(rowC.from, 5);
  assert.equal(rowC.to, 6);
  assert.equal(rowC.cells.length, 6, "still full width, so rows line up");
  assert.equal(
    rowC.cells[0],
    null,
    "C1 is blank here, but from=5 marks it as somebody else's pit rather than a free one",
  );
});

test("a gap inside the span is still a real empty pit", () => {
  const teams = [
    { n: "1", pit: "A2" },
    { n: "2", pit: "A4" },
  ];
  const [rowA] = buildFloorPlan(teams, (t) => t.pit);

  assert.equal(rowA.from, 2);
  assert.equal(rowA.to, 4);
  assert.equal(rowA.cells[2], null, "A3 sits inside the span, so it is genuinely free");
});
