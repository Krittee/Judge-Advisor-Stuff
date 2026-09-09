import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("day reset retains event-wide flags while full wipe starts a clean event", async () => {
  process.env.DATA_FILE = join(
    tmpdir(),
    `judge-queue-event-boundary-${process.pid}-${Date.now()}.json`,
  );
  process.env.SEED_DEMO = "false";

  const { fileStore } = await import("../src/lib/db/file");
  await fileStore.resetAll();
  await fileStore.upsertTeams([
    {
      number: "1852B",
      name: "Boundary Test Team",
      pit: "A1",
      division: "Elementary School",
      category: "graded",
    },
  ]);
  const team = await fileStore.findTeamByNumber("1852B");
  assert.ok(team);

  await fileStore.createFlag({
    teamId: team.id,
    kind: "minor",
    body: "Possessed two Bean Bags.",
    author: "Head Referee",
    matchType: "Q",
    matchNumber: "23",
    field: "Field 2",
    rule: "SG6",
  });
  await fileStore.createFlag({
    teamId: team.id,
    kind: "minor",
    body: "Repeated in the same Match.",
    author: "Head Referee",
    matchType: "Q",
    matchNumber: "23",
    field: "Field 2",
    rule: "SG6",
  });

  const beforeReset = await fileStore.listFlags(team.id);
  assert.equal(beforeReset.length, 2);
  assert.notEqual(beforeReset[0].id, beforeReset[1].id);

  await fileStore.resetDay();
  assert.equal((await fileStore.listFlags(team.id)).length, 2);

  await fileStore.resetAll();
  assert.deepEqual(await fileStore.listFlags(), []);
  assert.deepEqual(await fileStore.listTeams(), []);
});
