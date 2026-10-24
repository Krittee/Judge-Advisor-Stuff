import assert from "node:assert/strict";
import test from "node:test";

import { GOOD_CONDUCT, GOOD_CONDUCT_MIN, goodConductTeams, SPORTSMANSHIP } from "../src/lib/awards";

/* The one rule that lets referees speak for an award (src/lib/awards.ts): two
   Good conduct flags on a team count as a nomination for Sportsmanship. */

const flag = (team_id, kind) => ({ team_id, kind });

test("the rule's names are the config's: the Sportsmanship award, the Good conduct flag, and two flags", () => {
  assert.equal(SPORTSMANSHIP, "sportsmanship");
  assert.equal(GOOD_CONDUCT, "good");
  assert.equal(GOOD_CONDUCT_MIN, 2);
});

test("a team counts from its second Good conduct flag, and the count is every one it has", () => {
  assert.deepEqual([...goodConductTeams([])], []);
  assert.deepEqual([...goodConductTeams([flag("a", "good")])], [], "one is not enough");
  assert.deepEqual([...goodConductTeams([flag("a", "good"), flag("a", "good")])], [["a", 2]]);
  assert.deepEqual([...goodConductTeams([flag("a", "good"), flag("a", "good"), flag("a", "good")])], [["a", 3]]);
});

test("each team is counted on its own flags, and the other kinds of flag count for nothing", () => {
  const flags = [
    flag("a", "good"), flag("b", "good"), flag("a", "good"), flag("c", "good"),
    flag("b", "warning"), flag("b", "minor"), flag("c", "major"), flag("c", "warning"), flag("d", "warning"), flag("d", "warning"),
  ];
  assert.deepEqual([...goodConductTeams(flags)], [["a", 2]], "b and c have one Good conduct each; d has none, however many Warnings");
});
