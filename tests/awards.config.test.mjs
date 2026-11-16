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
    { id: "grit", label: "grit", short: "grit", blurb: "", places: 1 },
    { id: "spark", label: "Spark", short: "Spark", blurb: "", places: 1 },
  ]);
});

test("the Judges Award has two winners per division; every other award has one", () => {
  assert.deepEqual(
    awards().filter((a) => a.places !== 1).map((a) => [a.id, a.places]),
    [["judges", 2]],
  );
});

test("winners is a whole number from 1 to 10, and 1 when it is missing or not a number", () => {
  const winnersOf = (winners) => parseAwards([{ id: "x", winners }])[0].places;
  assert.equal(winnersOf(undefined), 1);
  assert.equal(winnersOf("lots"), 1);
  assert.equal(winnersOf(2), 2);
  assert.equal(winnersOf(2.6), 3);
  assert.equal(winnersOf(0), 1);
  assert.equal(winnersOf(-4), 1);
  assert.equal(winnersOf(99), 10);
});
