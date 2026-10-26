import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/**
 * A state file written before Activity entries had a kind and a role must
 * still load: each old entry is read as the kind its action implies and its
 * "role:Name" / "Name (Panel N)" actor split, with the number of the team it
 * names joined on. The data file is named before the store is imported
 * because file.ts resolves DATA_FILE once, at load.
 */
const dir = join(tmpdir(), `judge-queue-activity-migration-${process.pid}-${Date.now()}`);
mkdirSync(dir, { recursive: true });
const file = join(dir, "state.json");
process.env.DATA_FILE = file;
process.env.SEED_DEMO = "false";

const teamId = "00000000-0000-4000-8000-000000000001";
const at = (minute: number) => `2025-01-01T09:${String(minute).padStart(2, "0")}:00.000Z`;
const old = (n: number, over: Record<string, unknown>) => ({
  id: `a${n}`,
  request_id: null,
  team_id: null,
  detail: null,
  created_at: at(n),
  ...over,
});

writeFileSync(
  file,
  JSON.stringify({
    panels: [],
    teams: [{ id: teamId, number: "9882K", name: "Old team", pit: null, division: "Elementary School", category: "developing", panel_id: null }],
    requests: [],
    notes: [],
    scores: [],
    conflicts: [],
    flags: [],
    activity: [
      old(1, { request_id: "r1", team_id: teamId, actor: "Priya (Panel 2)", action: "→ Interview in progress" }),
      old(2, { team_id: teamId, actor: "referee:Jordan", action: "flagged minor" }),
      old(3, { team_id: teamId, actor: "admin:Alex", action: "corrected a flag: warning → minor" }),
      old(4, { team_id: teamId, actor: "admin:Alex", action: "withdrew a conflict of interest" }),
      old(5, { actor: "queuer:Sam", action: "Referee setup: V5RC, 3 fields" }),
      old(6, { request_id: "r2", team_id: teamId, actor: "team", action: "joined queue" }),
    ],
  }),
);

test("old entries are read with the kind, name, role and team number their data implies", async () => {
  const { fileStore } = await import("../src/lib/db/file");
  const byTime = (await fileStore.listActivity()).reverse();

  assert.deepEqual(
    byTime.map((a) => [a.kind, a.actor, a.actor_role, a.team_number]),
    [
      ["request", "Priya", "Panel 2", "9882K"],
      ["referee", "Jordan", "Referee", "9882K"],
      ["referee", "Alex", "Judge Advisor", "9882K"],
      ["conflict", "Alex", "Judge Advisor", "9882K"],
      ["setup", "Sam", "Front desk", null],
      ["request", "team", "Team", "9882K"],
    ],
  );
});

test("an old entry and a new one sit side by side, each read its own way", async () => {
  const { fileStore } = await import("../src/lib/db/file");
  await fileStore.logActivity({
    teamId,
    kind: "referee",
    actor: "Jordan (Sr)",
    actorRole: "Referee",
    action: "removed a flag: minor",
  });

  const [latest, ...rest] = await fileStore.listActivity();
  assert.deepEqual(
    [latest.kind, latest.actor, latest.actor_role, latest.team_number],
    ["referee", "Jordan (Sr)", "Referee", "9882K"],
    "the new entry is stored as given, its actor not split",
  );
  assert.equal(rest.length, 6);
  assert.ok(rest.every((a) => a.kind && a.team_number !== undefined), "every old entry still carries a kind");
});
