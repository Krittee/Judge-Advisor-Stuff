import assert from "node:assert/strict";
import test from "node:test";

import { rankTeams } from "../src/lib/ranking";

/* The panel ranking, against the real src/lib/ranking.ts. It feeds the
   awards, so what it sorts on matters as much as how it looks. */

const rubrics = [
  { id: "interview", name: "Interview", max: 12 },
  { id: "notebook", name: "Notebook", max: 64 },
];
const categories = [
  { id: "graded" },
  { id: "ungraded", excludesRubrics: ["notebook"] },
];

const team = (number, category = "graded") => ({ id: `t${number}`, number, category });
/** One rubric's row; `values` non-empty is what makes a team "scored". */
const score = (number, rubric_id, total) => ({
  team_id: `t${number}`,
  rubric_id,
  total,
  values: { c1: total },
});
const order = (rows) => rows.map((r) => r.team.number);

test("unscored teams come last, below a team that scored zero", () => {
  const teams = [team("1A"), team("2A"), team("3A")];
  const scores = [{ team_id: "t3A", rubric_id: "interview", total: 0, values: { c1: 0 } }];
  const rows = rankTeams(teams, scores, rubrics, categories);
  assert.deepEqual(order(rows), ["3A", "1A", "2A"]);
  assert.deepEqual(rows.map((r) => r.scored), [true, false, false]);
});

test("teams rank on points, not on share of what they could score", () => {
  // 7A: a perfect interview and no notebook (12/12, 100%).
  // 8A: a graded team with more points but a smaller share (30/76, 39%).
  const teams = [team("7A", "ungraded"), team("8A")];
  const scores = [score("7A", "interview", 12), score("8A", "interview", 8), score("8A", "notebook", 22)];
  const rows = rankTeams(teams, scores, rubrics, categories);
  assert.deepEqual(order(rows), ["8A", "7A"]);
  assert.equal(rows[0].max, 76);
  assert.equal(rows[1].max, 12, "the notebook-less team is still totalled on its own denominator");
});

test("equal points fall back to team number", () => {
  const teams = [team("30A"), team("2A"), team("10A")];
  const scores = teams.map((t) => score(t.number, "interview", 6));
  // localeCompare on the number, as the admin Rankings table always did.
  assert.deepEqual(order(rankTeams(teams, scores, rubrics, categories)), ["10A", "2A", "30A"]);
});

test("a rubric a category drops is left out of that team's total", () => {
  const rows = rankTeams([team("7A", "ungraded")], [score("7A", "interview", 5), score("7A", "notebook", 40)], rubrics, categories);
  assert.equal(rows[0].total, 5);
  assert.deepEqual(rows[0].applicable.map((r) => r.id), ["interview"]);
  assert.equal(rows[0].perRubric.length, 2, "its rows are kept, for the table to show as n/a");
});
