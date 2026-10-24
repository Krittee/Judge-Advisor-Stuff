import assert from "node:assert/strict";
import test from "node:test";
import { awards, parseAwards } from "../src/lib/presets";

/* The awards list in config/event.json: its order is the presentation order
   everywhere, and an id is what nominations and winners are stored against. */

test("config/event.json lists the eleven awards in presentation order", () => {
  assert.deepEqual(
    awards().map((a) => [a.id, a.label, a.short]),
    [
      ["excellence", "Excellence", "Exc"],
      ["design", "Design", "Des"],
      ["innovate", "Innovate", "Inn"],
      ["think", "Think", "Thk"],
      ["amaze", "Amaze", "Amz"],
      ["build", "Build", "Bld"],
      ["create", "Create", "Cre"],
      ["judges", "Judges", "Jdg"],
      ["inspire", "Inspire", "Ins"],
      ["sportsmanship", "Sportsmanship", "Spt"],
      ["energy", "Energy", "Enr"],
    ],
  );
  assert.ok(awards().every((a) => a.blurb.length > 0), "every award says what it is for");
  assert.equal(awards().find((a) => a.id === "think")?.blurb, "Coding, programming and software development.");
});

test("a repeated id is rejected: the first one stays and the order is kept", () => {
  const parsed = parseAwards([
    { id: "design", label: "Design", short: "Des", blurb: "First." },
    { id: "think", label: "Think", short: "Thk", blurb: "" },
    { id: "design", label: "Design again", short: "Dsg", blurb: "Second." },
    { id: " think ", label: "Think too", short: "Tk", blurb: "" },
  ]);
  assert.deepEqual(
    parsed.map((a) => [a.id, a.label, a.blurb]),
    [
      ["design", "Design", "First."],
      ["think", "Think", ""],
    ],
  );
});

test("a malformed entry is dropped rather than thrown, and a missing label or short falls back", () => {
  assert.deepEqual(parseAwards(undefined), []);
  assert.deepEqual(parseAwards("design"), []);
  assert.deepEqual(parseAwards([null, 7, {}, { id: "  " }, { label: "No id" }]), []);
  assert.deepEqual(parseAwards([{ id: "grit" }, { id: "spark", label: "Spark" }]), [
    { id: "grit", label: "grit", short: "grit", blurb: "" },
    { id: "spark", label: "Spark", short: "Spark", blurb: "" },
  ]);
});
