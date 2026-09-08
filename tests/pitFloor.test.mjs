import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/* Which way round the pit floor is drawn.
 *
 * The plan is a picture of a real hall. Drawing it mirrored sends someone
 * to the opposite corner of the room, so the orientation is configuration
 * rather than an assumption baked into the component. */

const event = JSON.parse(readFileSync(new URL("../config/event.json", import.meta.url)));

test("this event runs right to left, bottom to top", () => {
  assert.deepEqual(event.pitFloor, { columns: "right-to-left", rows: "bottom-to-top" });
});

/* Mirrors the render order in PitMap. */
function draw(plan, { columns, rows }) {
  const facing = columns === "right-to-left" ? [...plan].reverse() : plan;
  return facing.map((col) => {
    const numbered = col.cells.map((cell, i) => ({ cell, position: i + 1 }));
    return { row: col.row, cells: rows === "bottom-to-top" ? numbered.reverse() : numbered };
  });
}

const plan = ["A", "B", "C"].map((row) => ({
  row,
  cells: [1, 2, 3].map((n) => `${row}${n}`),
}));

test("right-to-left puts column A on the right", () => {
  const drawn = draw(plan, { columns: "right-to-left", rows: "top-to-bottom" });
  assert.deepEqual(drawn.map((c) => c.row), ["C", "B", "A"]);
});

test("bottom-to-top puts position 1 at the bottom", () => {
  const drawn = draw(plan, { columns: "left-to-right", rows: "bottom-to-top" });
  assert.deepEqual(drawn[0].cells.map((c) => c.cell), ["A3", "A2", "A1"]);
});

test("this event's setting draws the floor the way the hall runs", () => {
  const drawn = draw(plan, event.pitFloor);
  assert.deepEqual(drawn.map((c) => c.row), ["C", "B", "A"], "column A should be on the right");
  assert.deepEqual(
    drawn[drawn.length - 1].cells.map((c) => c.cell),
    ["A3", "A2", "A1"],
    "A1 should sit at the bottom of its column",
  );
});

test("flipping the setting flips the drawing, both ways", () => {
  const normal = draw(plan, { columns: "left-to-right", rows: "top-to-bottom" });
  assert.deepEqual(normal.map((c) => c.row), ["A", "B", "C"]);
  assert.deepEqual(normal[0].cells.map((c) => c.cell), ["A1", "A2", "A3"]);
});

test("a tile keeps its real pit number wherever it is drawn", () => {
  /* The whole point: only the arrangement moves. If a reversed column
     renumbered its cells, A1 would be labelled A3 and the plan would lie. */
  for (const rows of ["top-to-bottom", "bottom-to-top"]) {
    for (const columns of ["left-to-right", "right-to-left"]) {
      for (const col of draw(plan, { columns, rows })) {
        for (const { cell, position } of col.cells) {
          assert.equal(cell, `${col.row}${position}`, `${columns}/${rows} mislabelled a tile`);
        }
      }
    }
  }
});

test("an unknown setting falls back rather than drawing something arbitrary", () => {
  const src = readFileSync(new URL("../src/lib/presets.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export function pitFloor"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(/PIT_FLOOR_FALLBACK\.columns/.test(body), "columns no longer fall back");
  assert.ok(/PIT_FLOOR_FALLBACK\.rows/.test(body), "rows no longer fall back");
});

test("sorting is untouched — this is drawing, not identity", () => {
  const src = readFileSync(new URL("../src/lib/pit.ts", import.meta.url), "utf8");
  assert.ok(
    !/pitFloor|right-to-left|bottom-to-top/.test(src),
    "orientation leaked into pit.ts; a pit's identity and sort order must not depend on it",
  );
});
