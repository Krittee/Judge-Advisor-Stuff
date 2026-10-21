import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Postgres cascades flags on team delete (`on delete cascade`), nulls
 * activity.team_id (`on delete set null`), and deletes any activity row
 * whose request is deleted with the team (activity.request_id is on delete
 * cascade). The file store must match all three, or a deleted team leaves
 * an orphan flag behind -- still counting toward repeat-violation history
 * under a dead id -- on the storage backend most events actually run on.
 */
test("deleting a team clears its flags and request-linked activity, and nulls the rest, matching Postgres", async () => {
  process.env.DATA_FILE = join(
    tmpdir(),
    `judge-queue-team-delete-parity-${process.pid}-${Date.now()}.json`,
  );
  process.env.SEED_DEMO = "false";

  const { fileStore } = await import("../src/lib/db/file");
  await fileStore.resetAll();
  const panel = await fileStore.createPanel({
    name: "Panel A",
    code: "PARITY1",
    division: "Elementary School",
    judges: [],
    languages: ["en"],
    sort_order: 1,
    slot_start_at: null,
    slot_minutes: 20,
    slot_count: 0,
  });
  await fileStore.upsertTeams([
    { number: "1852B", name: "Delete Me", pit: "A1", division: "Elementary School", category: "graded" },
    { number: "1853", name: "Keep Me", pit: "A2", division: "Elementary School", category: "graded" },
  ]);
  const team = await fileStore.findTeamByNumber("1852B");
  const other = await fileStore.findTeamByNumber("1853");
  assert.ok(team && other);

  const request = await fileStore.createRequest({
    teamId: team.id,
    panelId: panel.id,
    kind: "queue",
    createdBy: "team",
    language: "en",
  });
  const otherRequest = await fileStore.createRequest({
    teamId: other.id,
    panelId: panel.id,
    kind: "queue",
    createdBy: "team",
    language: "en",
  });

  await fileStore.createFlag({
    teamId: team.id,
    kind: "minor",
    body: "Possessed two Bean Bags.",
    author: "Head Referee",
    matchType: "Q",
    matchNumber: "23",
    field: "2",
    rule: "SG6",
    ruleset: "viqrc",
    manualVersion: null,
    matchAffecting: false,
  });
  // Team-only activity survives the delete with its team nulled.
  await fileStore.logActivity({ teamId: team.id, kind: "setup", actor: "Desk", actorRole: "Front desk", action: "note" });
  // Activity tied to the deleted team's request is dropped with the request.
  await fileStore.logActivity({
    requestId: request.id,
    teamId: team.id,
    kind: "request",
    actor: "Desk",
    actorRole: "Front desk",
    action: "requested",
  });
  // Another team's request-linked activity is not touched.
  await fileStore.logActivity({
    requestId: otherRequest.id,
    teamId: other.id,
    kind: "request",
    actor: "Desk",
    actorRole: "Front desk",
    action: "requested",
  });

  assert.equal((await fileStore.listFlags(team.id)).length, 1);
  assert.equal(
    (await fileStore.listActivity()).filter((a) => a.team_id === team.id).length,
    2,
  );

  await fileStore.deleteTeam(team.id);

  assert.deepEqual(
    await fileStore.listFlags(),
    [],
    "a deleted team's flags must not survive under a dead team_id",
  );
  const activity = await fileStore.listActivity();
  assert.equal(
    activity.some((a) => a.request_id === request.id),
    false,
    "activity for a request deleted with the team must be dropped, as Postgres cascades it",
  );
  assert.equal(
    activity.filter((a) => a.team_id === team.id).length,
    0,
    "no activity may keep the deleted team's id",
  );
  const nulled = activity.filter((a) => a.team_id === null);
  assert.equal(nulled.length, 1, "team-only activity survives with team_id nulled");
  assert.equal(nulled[0].action, "note");
  assert.equal(
    activity.filter((a) => a.request_id === otherRequest.id).length,
    1,
    "another team's request-linked activity survives",
  );
});
