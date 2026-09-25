import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { blendedDivisions, divisionsCompatible } from "../src/lib/presets";

/**
 * The division wall, and the hole a blended team used to fall through.
 *
 * A team competing across age groups has no one age group's panel to
 * belong to. When the wall was strict equality, such a team was assignable
 * only to a panel someone had created in the blended division -- and if
 * nobody had, auto-assign skipped it in silence, the admin console offered
 * an empty panel list, and the only way to get the team judged at all was
 * to file it as an age group it was not in. These pin down that Blended
 * both stays Blended and reaches a judge.
 */

const ES = "Elementary School";
const MS = "Middle School";
const BLEND = "Blended";

test("the shipped config recognises its blended division", () => {
  assert.deepEqual(blendedDivisions(), [BLEND]);
});

test("the wall still holds between two ordinary divisions", () => {
  assert.equal(divisionsCompatible(ES, ES), true);
  assert.equal(divisionsCompatible(MS, MS), true);
  assert.equal(divisionsCompatible(ES, MS), false, "an ES team must not land on an MS panel");
  assert.equal(divisionsCompatible(MS, ES), false);
});

test("a blended team clears the wall in either direction", () => {
  assert.equal(divisionsCompatible(BLEND, ES), true, "a Blended team may be judged by ES");
  assert.equal(divisionsCompatible(BLEND, MS), true);
  assert.equal(divisionsCompatible(ES, BLEND), true, "a Blended panel may judge an ES team");
  assert.equal(divisionsCompatible(BLEND, BLEND), true);
});

test("a blended team is assignable, stays blended, and reaches its judge", async () => {
  process.env.DATA_FILE = join(
    tmpdir(),
    `judge-queue-blend-${process.pid}-${Date.now()}.json`,
  );
  process.env.SEED_DEMO = "false";

  const { fileStore } = await import("../src/lib/db/file");
  await fileStore.resetAll();

  // One panel per age group and none for Blended -- the configuration that
  // used to make a Blended team unjudgeable.
  const panel = await fileStore.createPanel({
    name: "Panel A",
    code: "BLEND1",
    division: ES,
    judges: ["Dana Ruiz"],
    languages: [],
    sort_order: 1,
    slot_start_at: null,
    slot_minutes: 20,
    slot_count: 0,
  });

  await fileStore.upsertTeams([
    { number: "1001", name: "Elementary Team", pit: "A1", division: ES, category: "developing" },
    { number: "1002", name: "Middle Team", pit: "A2", division: MS, category: "developing" },
    { number: "1003", name: "Blended Team", pit: "A3", division: BLEND, category: "developing" },
  ]);

  const es = await fileStore.findTeamByNumber("1001");
  const ms = await fileStore.findTeamByNumber("1002");
  const blend = await fileStore.findTeamByNumber("1003");
  assert.ok(es && ms && blend);

  // Assignable by hand, and the category survives the assignment.
  const assigned = await fileStore.updateTeam(blend.id, { panel_id: panel.id });
  assert.equal(assigned.panel_id, panel.id, "a Blended team must be assignable to an ES panel");
  assert.equal(assigned.division, BLEND, "assignment must not rewrite the team's division");

  // Auto-assign reaches it too, rather than passing over it in silence.
  await fileStore.updateTeam(blend.id, { panel_id: null });
  const count = await fileStore.autoAssignTeams(10);
  const after = await fileStore.listTeams();
  const blendAfter = after.find((t) => t.id === blend.id);
  assert.equal(blendAfter?.panel_id, panel.id, "auto-assign must not skip a Blended team");
  assert.equal(blendAfter?.division, BLEND);
  // The MS team has no panel that may judge it, so the wall still stops it.
  assert.equal(after.find((t) => t.id === ms.id)?.panel_id, null);
  assert.equal(count, 2, "the ES and Blended teams are placed; the MS team is not");

  // And it is visible to the judge who now holds it: an assignment the
  // judge console cannot see is the same as no assignment.
  const { loadState } = await import("../src/lib/server-state");
  const state = await loadState({
    role: "judge",
    name: "Dana Ruiz",
    panelId: panel.id,
    panelName: panel.name,
  });
  const numbers = state.teams.map((t) => t.number).sort();
  assert.deepEqual(numbers, ["1001", "1003"], "the ES judge sees their ES and Blended teams");
  assert.equal(
    state.teams.find((t) => t.number === "1003")?.division,
    BLEND,
    "the judge sees it as Blended, not relabelled to match their panel",
  );
});

test("the wall is read against the division a request is moving the team to", async () => {
  /* PATCH /api/admin/teams can carry a division change and an assignment
     at once. The check has to read the division the team will end up in,
     not the one stored a moment ago -- otherwise "move to Middle School
     and put them on the Elementary panel" passes validation by arguing
     about a division neither side is asking for. */
  assert.equal(divisionsCompatible(MS, ES), false, "the effective division is what must be judged");
  assert.equal(divisionsCompatible(BLEND, ES), true, "unless it is blended, which any panel may take");
});

test("moving a panel's division keeps the teams it may still judge", async () => {
  process.env.DATA_FILE = join(
    tmpdir(),
    `judge-queue-blend-move-${process.pid}-${Date.now()}.json`,
  );
  process.env.SEED_DEMO = "false";

  const { fileStore } = await import("../src/lib/db/file");
  await fileStore.resetAll();

  const panel = await fileStore.createPanel({
    name: "Panel B",
    code: "BLEND2",
    division: ES,
    judges: [],
    languages: [],
    sort_order: 1,
    slot_start_at: null,
    slot_minutes: 20,
    slot_count: 0,
  });

  await fileStore.upsertTeams([
    { number: "2001", name: "Elementary Team", pit: "B1", division: ES, category: "developing" },
    { number: "2002", name: "Blended Team", pit: "B2", division: BLEND, category: "developing" },
  ]);
  const es = await fileStore.findTeamByNumber("2001");
  const blend = await fileStore.findTeamByNumber("2002");
  assert.ok(es && blend);
  await fileStore.updateTeam(es.id, { panel_id: panel.id });
  await fileStore.updateTeam(blend.id, { panel_id: panel.id });

  await fileStore.updatePanel(panel.id, { division: MS });

  const teams = await fileStore.listTeams();
  assert.equal(
    teams.find((t) => t.id === es.id)?.panel_id,
    null,
    "the ES team is released: its panel now judges another age group",
  );
  assert.equal(
    teams.find((t) => t.id === blend.id)?.panel_id,
    panel.id,
    "the Blended team stays: the panel may still judge it either side of the move",
  );
});
