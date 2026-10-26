import assert from "node:assert/strict";
import test from "node:test";

import {
  activeScoreFilters,
  COMPARE_FULL,
  compareLines,
  compareMeta,
  conductText,
  filterRows,
  flagsByTeam,
  higherSide,
  livePicks,
  NO_SCORE_FILTERS,
  notesText,
  percentText,
  pickBlocker,
  scoredText,
  showingText,
  togglePick,
  totalLine,
  withRanks,
  worstConduct,
} from "../src/components/admin/scoresLogic";
import { sectionMax } from "../src/components/judge/logic";
import { rankTeams } from "../src/lib/ranking";
import { rubrics } from "../src/lib/rubrics";

/* The Judge Advisor Scores tab's decisions, run for real against
   src/components/admin/scoresLogic.ts and the real rubrics in
   config/rubrics.json. How they are drawn is in adminScores.runtime.test.tsx. */

const rubricList = rubrics();
const notebook = rubricList.find((r) => r.id === "notebook");
const interview = rubricList.find((r) => r.id === "interview");
const categories = [{ id: "developing" }, { id: "fully-developed" }, { id: "ungraded", excludesRubrics: ["notebook"] }];

const team = (number, over = {}) => ({
  id: `t-${number}`,
  number,
  name: `Team ${number}`,
  panel_id: "p2",
  division: "Middle School",
  category: "developing",
  pit: null,
  created_at: "2026-10-20T08:00:00Z",
  ...over,
});

/** Every criterion of a rubric marked by `mark(sectionIndex, criterionIndex)`; the total is what they add up to. */
function marked(t, rubric, mark) {
  const values = {};
  rubric.sections.forEach((s, si) => s.criteria.forEach((c, ci) => (values[c.id] = mark(si, ci))));
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  return { id: `s-${t.number}-${rubric.id}`, team_id: t.id, rubric_id: rubric.id, values, total, scored_by: "Sam", panel_id: t.panel_id, updated_at: "2026-10-20T09:00:00Z" };
}
const all = (n) => () => n;

const kinds = [
  { id: "good", label: "Good conduct", short: "Good", color: "emerald", severity: 0, requiresRule: false },
  { id: "warning", label: "Warning", short: "Warning", color: "amber", severity: 1, requiresRule: false },
  { id: "minor", label: "Minor violation", short: "Minor", color: "orange", severity: 2, requiresRule: true },
  { id: "major", label: "Major violation", short: "Major", color: "rose", severity: 3, requiresRule: true },
  { id: "dq", label: "Disqualified", short: "DQ", color: "black", severity: 4, requiresRule: true },
];
let n = 0;
const flag = (t, kind) => ({ id: `f${++n}`, team_id: t.id, kind, body: "", author: "Jordan Lee", created_at: "2026-10-20T10:00:00.000Z" });

// Five scored teams in three notebooks/divisions, and one nobody has scored.
const sparky = team("5150Z", { division: "High School" });
const velocity = team("8080V");
const breakers = team("1108", { division: "Elementary School" });
const gremlins = team("2011A", { category: "fully-developed" });
const rangers = team("4410C", { category: "ungraded", division: "Elementary School" });
const pi = team("3141P", { division: "High School" });
const teams = [pi, rangers, gremlins, breakers, velocity, sparky];
const scores = [
  marked(sparky, notebook, all(2)), marked(sparky, interview, all(2)), // 32 + 12 = 44
  marked(velocity, notebook, all(2)), marked(velocity, interview, (si) => (si === 0 ? 2 : 1)), // 32 + 9 = 41
  marked(breakers, notebook, all(1)), marked(breakers, interview, all(2)), // 16 + 12 = 28
  marked(gremlins, notebook, all(1)), marked(gremlins, interview, all(1)), // 16 + 6 = 22
  marked(rangers, interview, all(2)), // an Ungraded notebook: 12 of 12
];
const ranked = rankTeams(teams, scores, rubricList, categories);
const rows = withRanks(ranked);
const byNumber = (number) => rows.find((r) => r.team.number === number);
const order = (list) => list.map((r) => `${r.team.number}:${r.rank ?? "-"}`);

/* ---- the ranked list --------------------------------------------------------- */

test("a place is the team's rank in the whole event, and an unscored team has none", () => {
  assert.deepEqual(order(rows), ["5150Z:1", "8080V:2", "1108:3", "2011A:4", "4410C:5", "3141P:-"]);
  assert.deepEqual(rows.map((r) => r.team.number), ranked.map((r) => r.team.number), "the order is rankTeams', untouched");
});

test("filters narrow the list but the rank numbers stay the event-wide ones", () => {
  const unfiltered = filterRows(rows, NO_SCORE_FILTERS);
  assert.equal(unfiltered.length, 6);

  const dev = filterRows(rows, { category: "developing", division: "" });
  assert.deepEqual(order(dev), ["5150Z:1", "8080V:2", "1108:3", "3141P:-"]);

  const fully = filterRows(rows, { category: "fully-developed", division: "" });
  assert.deepEqual(order(fully), ["2011A:4"], "4 means 4th overall, though it is the only row shown");

  const elementary = filterRows(rows, { category: "", division: "Elementary School" });
  assert.deepEqual(order(elementary), ["1108:3", "4410C:5"]);

  const both = filterRows(rows, { category: "ungraded", division: "Elementary School" });
  assert.deepEqual(order(both), ["4410C:5"]);
  assert.deepEqual(filterRows(rows, { category: "ungraded", division: "High School" }), []);
});

test("how many filters are on, for the phone's Filters badge", () => {
  assert.equal(activeScoreFilters(NO_SCORE_FILTERS), 0);
  assert.equal(activeScoreFilters({ category: "ungraded", division: "" }), 1);
  assert.equal(activeScoreFilters({ category: "ungraded", division: "High School" }), 2);
});

test("the counts: Showing N teams is the filtered list, N of M scored is the whole event", () => {
  assert.equal(showingText(1), "Showing 1 team");
  assert.equal(showingText(12), "Showing 12 teams");
  assert.equal(scoredText(rows), "5 of 6 scored");
  assert.equal(scoredText(filterRows(rows, { category: "fully-developed", division: "" })), "1 of 1 scored", "over whatever it is given; the page gives it the whole event");
});

/* ---- picking two -------------------------------------------------------------- */

test("at most two are ticked: a third is refused and every other box is off with the reason", () => {
  let picked = [];
  picked = togglePick(picked, velocity.id);
  assert.deepEqual(picked, [velocity.id]);
  assert.equal(pickBlocker(picked, byNumber("1108")), null, "one tick leaves the rest free");

  picked = togglePick(picked, breakers.id);
  assert.deepEqual(picked, [velocity.id, breakers.id]);
  assert.equal(pickBlocker(picked, byNumber("5150Z")), COMPARE_FULL);
  assert.equal(COMPARE_FULL, "Compare two at a time");
  assert.deepEqual(togglePick(picked, sparky.id), picked, "a third tick changes nothing");
  assert.equal(pickBlocker(picked, byNumber("8080V")), null, "a ticked box can always be un-ticked");

  picked = togglePick(picked, velocity.id);
  assert.deepEqual(picked, [breakers.id], "un-ticking one");
  assert.equal(pickBlocker(picked, byNumber("5150Z")), null, "frees the others");
});

test("an unscored team cannot be ticked, whatever else is ticked", () => {
  assert.match(pickBlocker([], byNumber("3141P")), /Not scored/);
  assert.match(pickBlocker([velocity.id, breakers.id], byNumber("3141P")), /Not scored/);
});

test("ticks that stop naming a scored team fall away (its scores were cleared from the sheet)", () => {
  assert.deepEqual(livePicks([velocity.id, breakers.id], rows), [velocity.id, breakers.id]);
  const cleared = withRanks(rankTeams(teams, scores.filter((s) => s.team_id !== breakers.id), rubricList, categories));
  assert.deepEqual(livePicks([velocity.id, breakers.id], cleared), [velocity.id]);
  assert.deepEqual(livePicks(["gone"], rows), []);
});

/* ---- the compare panel -------------------------------------------------------- */

test("section subtotals are added up from the stored values and match them", () => {
  const a = byNumber("8080V");
  const b = byNumber("1108");
  const lines = compareLines(a, b, rubricList);

  for (const [row, side] of [[a, 0], [b, 1]]) {
    for (const rubric of [notebook, interview]) {
      const stored = row.perRubric.find((s) => s.rubric_id === rubric.id);
      const sections = lines.filter((l) => l.level === "section" && l.id.startsWith(`${rubric.id}:`));
      assert.equal(sections.length, rubric.sections.length, "one line per section");
      rubric.sections.forEach((section, i) => {
        const cell = sections[i].cells[side];
        const expected = section.criteria.reduce((sum, c) => sum + stored.values[c.id], 0);
        assert.deepEqual(cell, { kind: "value", got: expected, max: sectionMax(rubric, section.criteria.length) }, `${row.team.number} ${section.name}`);
      });
      // The subtotals add up to the stored total, and the rubric's own line IS the stored total.
      const sum = sections.reduce((s, l) => s + l.cells[side].got, 0);
      assert.equal(sum, stored.total);
      assert.deepEqual(lines.find((l) => l.id === rubric.id).cells[side], { kind: "value", got: stored.total, max: rubric.max });
    }
  }
  // Velocity's interview: section 0 all 2s, section 1 all 1s.
  assert.deepEqual(lines.find((l) => l.label === interview.sections[0].name).cells[0], { kind: "value", got: 6, max: 6 });
  assert.deepEqual(lines.find((l) => l.label === interview.sections[1].name).cells[0], { kind: "value", got: 3, max: 6 });
});

test("the rubric line comes before its sections, in the config's order", () => {
  const lines = compareLines(byNumber("8080V"), byNumber("1108"), rubricList);
  assert.deepEqual(
    lines.map((l) => [l.level, l.label]),
    [
      ["rubric", notebook.name],
      ...notebook.sections.map((s) => ["section", s.name]),
      ["rubric", interview.name],
      ...interview.sections.map((s) => ["section", s.name]),
    ],
  );
});

test("the higher value in a row is the bold one; a tie is bold on neither side", () => {
  const cell = (got, max = 10) => ({ kind: "value", got, max });
  assert.equal(higherSide(cell(8), cell(5)), 0);
  assert.equal(higherSide(cell(5), cell(8)), 1);
  assert.equal(higherSide(cell(6), cell(6)), null);
  assert.equal(higherSide(cell(0), cell(0)), null, "two zeros tie");

  const x = team("1000X");
  const y = team("2000Y");
  const two = withRanks(
    rankTeams(
      [x, y],
      [
        // X: the first notebook section all 2s, the rest 1s; Y: the reverse. Their interviews are the same.
        marked(x, notebook, (si) => (si === 0 ? 2 : 1)),
        marked(y, notebook, (si) => (si === 0 ? 1 : 2)),
        marked(x, interview, all(1)),
        marked(y, interview, all(1)),
      ],
      rubricList,
      categories,
    ),
  );
  const [first, second] = [two.find((r) => r.team.id === x.id), two.find((r) => r.team.id === y.id)];
  const lines = compareLines(first, second, rubricList);
  const higher = (label) => lines.find((l) => l.label === label).higher;
  assert.equal(higher(notebook.sections[0].name), 0, "X is ahead on section 1");
  assert.equal(higher(notebook.sections[1].name), 1, "Y on section 2");
  assert.equal(higher(interview.name), null, "equal interviews: no bold");
  assert.equal(higher(interview.sections[0].name), null);
  // Y has more notebook points overall (the other four sections outweigh the first), so the rubric row picks Y.
  assert.equal(higher(notebook.name), 1);
});

test("the total row compares points, not share of what could be scored", () => {
  const a = byNumber("4410C"); // 12 of 12, an Ungraded notebook: 100%
  const b = byNumber("8080V"); // 41 of 76: 54%
  const line = totalLine(a, b);
  assert.deepEqual(line.cells, [
    { kind: "value", got: 12, max: 12 },
    { kind: "value", got: 41, max: notebook.max + interview.max },
  ]);
  assert.equal(line.higher, 1, "41 points beat 12 though 12/12 is the bigger share, as the ranking has it");
});

test("a rubric out of scope for a team's notebook reads excluded, on its line and on every section line, and nothing is bold there", () => {
  const lines = compareLines(byNumber("4410C"), byNumber("8080V"), rubricList);
  for (const l of lines.filter((x) => x.id.startsWith("notebook"))) {
    assert.deepEqual(l.cells[0], { kind: "excluded" }, l.label);
    assert.equal(l.cells[1].kind, "value");
    assert.equal(l.higher, null, "nothing to compare it with");
  }
  // The interview still compares.
  assert.deepEqual(lines.find((l) => l.id === "interview").cells[0], { kind: "value", got: 12, max: 12 });
  assert.equal(lines.find((l) => l.id === "interview").higher, 0);
});

test("a rubric in scope but not marked yet is unscored, not a zero", () => {
  const lonely = team("9000L");
  const r = withRanks(rankTeams([lonely, velocity], [marked(lonely, interview, all(2)), ...scores.filter((s) => s.team_id === velocity.id)], rubricList, categories));
  const lines = compareLines(r.find((x) => x.team.id === lonely.id), r.find((x) => x.team.id === velocity.id), rubricList);
  assert.deepEqual(lines.find((l) => l.id === "notebook").cells[0], { kind: "unscored" });
  assert.deepEqual(lines.find((l) => l.label === notebook.sections[0].name).cells[0], { kind: "unscored" });
  assert.equal(lines.find((l) => l.id === "notebook").higher, null);
});

test("percent has one decimal", () => {
  assert.equal(percentText(62, 76), "81.6%");
  assert.equal(percentText(58, 76), "76.3%");
  assert.equal(percentText(10, 12), "83.3%");
  assert.equal(percentText(12, 12), "100.0%");
  assert.equal(percentText(0, 44), "0.0%");
  assert.equal(percentText(0, 0), "—");
});

test("a header line reads 'Rank 2 · Panel 2', and says so when a team holds no panel", () => {
  const panels = [{ id: "p2", name: "Panel 2" }];
  assert.equal(compareMeta(byNumber("8080V"), panels), "Rank 2 · Panel 2");
  assert.equal(compareMeta({ team: team("1", { panel_id: null }), rank: 3 }, panels), "Rank 3 · No panel");
  assert.equal(compareMeta({ team: team("1", { panel_id: "gone" }), rank: 3 }, panels), "Rank 3 · No panel");
});

test("notes read '3 notes'", () => {
  assert.equal(notesText(3), "3 notes");
  assert.equal(notesText(1), "1 note");
  assert.equal(notesText(0), "No notes");
});

/* ---- conduct ------------------------------------------------------------------- */

test("the worst conduct is the Referee tab's order: the highest severity, with how many of that kind", () => {
  const t = team("7000B");
  assert.equal(worstConduct([], kinds), null);
  const some = [flag(t, "good"), flag(t, "warning"), flag(t, "warning")];
  assert.deepEqual(worstConduct(some, kinds).kind.id, "warning");
  assert.equal(worstConduct(some, kinds).count, 2);
  // A disqualification outranks everything, however many of the others there are.
  const dq = [...some, flag(t, "major"), flag(t, "major"), flag(t, "dq")];
  assert.equal(worstConduct(dq, kinds).kind.id, "dq");
  assert.equal(worstConduct(dq, kinds).count, 1);
  // Good conduct alone is still what was said about them.
  assert.equal(worstConduct([flag(t, "good")], kinds).kind.id, "good");
  // A kind the config no longer has is not a conduct pill.
  assert.equal(worstConduct([flag(t, "gone")], kinds), null);
});

test("every kind a team was flagged with, worst first, for the link's accessible name", () => {
  const t = team("7000B");
  assert.equal(conductText([flag(t, "good"), flag(t, "warning"), flag(t, "warning")], kinds), "Warning ×2, Good ×1");
  assert.equal(conductText([], kinds), "");
});

test("flags are grouped by team", () => {
  const a = team("1A");
  const b = team("2B");
  const g = flagsByTeam([flag(a, "warning"), flag(b, "dq"), flag(a, "good")]);
  assert.equal(g.get(a.id).length, 2);
  assert.equal(g.get(b.id).length, 1);
  assert.equal(g.get("nobody"), undefined);
});
