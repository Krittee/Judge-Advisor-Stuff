import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Postgres cascades flags on team delete (`on delete cascade`) and nulls
 * activity.team_id (`on delete set null`) rather than dropping the row.
 * The file store must match both, or a deleted team leaves an orphan
 * flag behind -- still counting toward repeat-violation history under a
 * dead id -- on the storage backend most events actually run on.
 */
test("deleting a team clears its flags and nulls its activity, matching Postgres", async () => {
  process.env.DATA_FILE = join(
    tmpdir(),
    `judge-queue-team-delete-parity-${process.pid}-${Date.now()}.json`,
  );
  process.env.SEED_DEMO = "false";

  const { fileStore } = await import("../src/lib/db/file");
  await fileStore.resetAll();
  await fileStore.upsertTeams([
    { number: "1852B", name: "Delete Me", pit: "A1", division: "Elementary School", category: "graded" },
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
  await fileStore.logActivity({ teamId: team.id, actor: "queuer:Desk", action: "requested" });

  assert.equal((await fileStore.listFlags(team.id)).length, 1);
  assert.equal(
    (await fileStore.listActivity()).filter((a) => a.team_id === team.id).length,
    1,
  );

  await fileStore.deleteTeam(team.id);

  assert.deepEqual(
    await fileStore.listFlags(),
    [],
    "a deleted team's flags must not survive under a dead team_id",
  );
  const activity = await fileStore.listActivity();
  assert.equal(activity.length, 1, "activity rows survive a team delete");
  assert.equal(activity[0].team_id, null, "activity.team_id is nulled, not left dangling");
});
