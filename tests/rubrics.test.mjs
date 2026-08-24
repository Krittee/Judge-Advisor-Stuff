import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/* Mirrors src/lib/rubrics.ts, plus a check that the shipped config still
   matches the official Team Interview Rubric v2.0 it was taken from. */

const config = JSON.parse(readFileSync(new URL("../config/rubrics.json", import.meta.url)));

function criterionId(rubricId, label) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `${rubricId}:${slug}`;
}

function buildRubric(entry, sharedScale) {
  const scale = (entry.scale ?? sharedScale).slice().sort((a, b) => a.value - b.value);
  const top = scale[scale.length - 1].value;
  const sections = entry.sections.map((s) => ({
    name: s.name,
    criteria: s.criteria.map((label) => ({ id: criterionId(entry.id, label), label })),
  }));
  const criteria = sections.flatMap((s) => s.criteria);
  return { ...entry, scale, sections, criteria, max: criteria.length * top };
}

const built = config.rubrics.map((r) => buildRubric(r, config.scale));
const interview = built.find((r) => r.id === "interview");

function bandFor(total, max, scored) {
  if (!scored || max <= 0) return null;
  const percent = (total / max) * 100;
  const sorted = [...config.bands].sort((a, b) => b.minPercent - a.minPercent);
  return sorted.find((b) => percent >= b.minPercent) ?? sorted[sorted.length - 1];
}

/* ---- the shipped interview rubric --------------------------------- */

test("the Team Interview rubric matches the official sheet: 6 criteria, 12 points", () => {
  assert.equal(interview.criteria.length, 6);
  assert.equal(interview.max, 12, "six criteria at 2 points each");
  assert.equal(interview.placeholder, undefined, "this one is not a stand-in");
});

test("its scale is the rubric's own 0/1/2 wording", () => {
  assert.deepEqual(
    interview.scale.map((p) => [p.value, p.label]),
    [
      [0, "Not Yet Heard"],
      [1, "Heard"],
      [2, "Heard, with Specifics"],
    ],
  );
});

test("its two sections carry three criteria each", () => {
  assert.deepEqual(
    interview.sections.map((s) => [s.name, s.criteria.length]),
    [
      ["Explain Your Learning", 3],
      ["How You Worked with Others", 3],
    ],
  );
});

test("every criterion across all rubrics has a unique id", () => {
  const ids = built.flatMap((r) => r.criteria.map((c) => c.id));
  assert.equal(new Set(ids).size, ids.length, "scores would collide otherwise");
});

test("ids are namespaced by rubric, so identical wording never collides", () => {
  const a = criterionId("notebook", "Decisions were made together");
  const b = criterionId("interview", "Decisions were made together");
  assert.notEqual(a, b);
});

/* ---- totals -------------------------------------------------------- */

function totalOf(rubric, values) {
  return rubric.criteria.reduce((sum, c) => sum + (Number(values[c.id]) || 0), 0);
}

test("a total is the sum of the criteria the rubric still recognises", () => {
  const values = Object.fromEntries(interview.criteria.map((c, i) => [c.id, i < 3 ? 2 : 1]));
  assert.equal(totalOf(interview, values), 3 * 2 + 3 * 1);
});

test("a score left over from a deleted criterion does not inflate the total", () => {
  const values = { ...Object.fromEntries(interview.criteria.map((c) => [c.id, 1])) };
  values["interview:a-criterion-since-removed"] = 2;
  assert.equal(totalOf(interview, values), 6, "only the six live criteria count");
});

test("an unscored rubric totals zero without erroring", () => {
  assert.equal(totalOf(interview, {}), 0);
});

/* ---- colour bands --------------------------------------------------- */

test("bands are picked by percentage, highest threshold first", () => {
  assert.equal(bandFor(30, 30, true).label, "Top");
  assert.equal(bandFor(26, 30, true).label, "Top", "87% clears the 85 threshold");
  assert.equal(bandFor(24, 30, true).label, "Strong", "80%");
  assert.equal(bandFor(18, 30, true).label, "Middle", "60%");
  assert.equal(bandFor(6, 30, true).label, "Emerging", "20%");
});

test("a threshold is inclusive at its exact boundary", () => {
  assert.equal(bandFor(85, 100, true).label, "Top");
  assert.equal(bandFor(70, 100, true).label, "Strong");
  assert.equal(bandFor(50, 100, true).label, "Middle");
});

test("an unscored team gets no band at all", () => {
  assert.equal(bandFor(0, 30, false), null, "not-yet-judged is not the same as scoring badly");
  assert.equal(bandFor(0, 30, true).label, "Emerging", "a real zero does get one");
});

test("a rubric with no points cannot produce a band", () => {
  assert.equal(bandFor(0, 0, true), null, "no division by zero");
});

/* ---- ranking -------------------------------------------------------- */

test("unscored teams rank below every scored team, including a scored zero", () => {
  const rows = [
    { number: "1001", total: 0, scored: false },
    { number: "1002", total: 0, scored: true },
    { number: "1003", total: 12, scored: true },
  ].sort(
    (a, b) =>
      Number(b.scored) - Number(a.scored) ||
      b.total - a.total ||
      a.number.localeCompare(b.number),
  );

  assert.deepEqual(rows.map((r) => r.number), ["1003", "1002", "1001"]);
});

/* ---- team categories ----------------------------------------------
   The two kinds of team, kept apart by colour. Configured rather than
   hard-coded, so these check the shipped config and the resolver that
   maps whatever someone typed onto a real category. */

const event = JSON.parse(readFileSync(new URL("../config/event.json", import.meta.url)));
const categories = event.teamCategories;

function defaultCategory() {
  return categories[0].id;
}

function resolveCategory(input) {
  const wanted = String(input ?? "").trim().toLowerCase();
  if (!wanted) return defaultCategory();
  const match = categories.find(
    (c) => c.id.toLowerCase() === wanted || c.label.toLowerCase() === wanted,
  );
  return match ? match.id : defaultCategory();
}

test("there are exactly two kinds of team, each with its own colour", () => {
  assert.equal(categories.length, 2);
  assert.deepEqual(
    categories.map((c) => c.label),
    ["Developing", "Fully Developed"],
  );
  const colours = categories.map((c) => c.color);
  assert.equal(new Set(colours).size, 2, "two types sharing one colour would defeat the point");
});

test("a category resolves from its id or its label, in any case", () => {
  assert.equal(resolveCategory("fully-developed"), "fully-developed");
  assert.equal(resolveCategory("Fully Developed"), "fully-developed");
  assert.equal(resolveCategory("FULLY DEVELOPED"), "fully-developed");
  assert.equal(resolveCategory("developing"), "developing");
  assert.equal(resolveCategory("  Developing  "), "developing");
});

test("anything unrecognised falls back rather than corrupting the roster", () => {
  for (const junk of ["", null, undefined, "<script>", "half-developed", 42]) {
    assert.equal(resolveCategory(junk), defaultCategory(), `${junk} should fall back`);
  }
});

test("no scoring band shares a name with a team type", () => {
  const bandLabels = config.bands.map((b) => b.label.toLowerCase());
  for (const c of categories) {
    assert.ok(
      !bandLabels.includes(c.label.toLowerCase()),
      `"${c.label}" is both a team type and a scoring band — one of them has to change`,
    );
  }
});
