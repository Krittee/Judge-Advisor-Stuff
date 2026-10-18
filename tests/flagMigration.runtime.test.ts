import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/**
 * A state file written before rulesets existed must still load, and its
 * flags must come back as VEX IQ ones with nothing match affecting. The same
 * goes for one written before the referee setup: there is no setup. A file
 * from the build that briefly recorded an alliance loads too, and drops it.
 *
 * The data file is named before the store is imported because file.ts
 * resolves DATA_FILE once, at load; node's test runner gives each test file
 * its own process, so that resolution is ours alone.
 */
const dir = join(tmpdir(), `judge-queue-flag-migration-${process.pid}-${Date.now()}`);
mkdirSync(dir, { recursive: true });
const file = join(dir, "state.json");
process.env.DATA_FILE = file;
process.env.SEED_DEMO = "false";

const teamId = "00000000-0000-4000-8000-000000000001";
writeFileSync(
  file,
  JSON.stringify({
    panels: [],
    teams: [
      { id: teamId, number: "1852B", name: "Old team", pit: null, division: "Elementary School", category: "developing", panel_id: null },
    ],
    requests: [],
    notes: [],
    scores: [],
    conflicts: [],
    // Written by an older build: rule is present, the ruleset fields are not.
    flags: [
      {
        id: "f1",
        team_id: teamId,
        kind: "minor",
        body: "Possessed two Bean Bags.",
        author: "Head Referee",
        match_type: "Q",
        match_number: "23",
        field: "ES2",
        rule: "SG6",
        created_at: "2026-09-09T10:00:00.000Z",
      },
      // Written by the dev build that briefly recorded an alliance.
      {
        id: "f2",
        team_id: teamId,
        kind: "minor",
        body: "Stale alliance key.",
        author: "Head Referee",
        match_type: "Q",
        match_number: "24",
        alliance: "blue",
        field: "2",
        rule: "SG6",
        created_at: "2026-09-09T11:00:00.000Z",
      },
    ],
    activity: [],
  }),
);

test("a flag from before rulesets loads as a VEX IQ flag that is not match affecting", async () => {
  const { fileStore } = await import("../src/lib/db/file");
  const flag = (await fileStore.listFlags()).find((f) => f.id === "f1");
  assert.ok(flag, "the old flag was lost on load");
  assert.equal(flag.rule, "SG6", "its rule must survive untouched");
  assert.equal(flag.ruleset, null, "null is how a legacy flag says it is IQ");
  assert.equal(flag.manual_version, null);
  assert.equal(flag.match_affecting, false);
});

test("a flag from before the setup keeps its legacy match and field untouched, and there is no setup", async () => {
  const { fileStore } = await import("../src/lib/db/file");
  const flag = (await fileStore.listFlags()).find((f) => f.id === "f1");
  assert.ok(flag);
  assert.equal(flag.match_type, "Q");
  assert.equal(flag.field, "ES2", "a prefixed field is kept, not rewritten");
  assert.equal(await fileStore.getRefereeSetup(), null, "an old file has no referee setup");
});

test("a stale alliance key on a stored flag is dropped on load, and nothing else on it is", async () => {
  const { fileStore } = await import("../src/lib/db/file");
  const flags = await fileStore.listFlags();
  assert.equal(flags.length, 2);
  for (const f of flags) {
    assert.equal("alliance" in f, false, `flag ${f.id} still carries an alliance`);
  }
  const stale = flags.find((f) => f.id === "f2");
  assert.ok(stale);
  assert.equal(stale.match_number, "24");
  assert.equal(stale.field, "2");
  assert.equal(stale.rule, "SG6");
});
