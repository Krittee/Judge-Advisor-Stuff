import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/**
 * A state file written before rulesets existed must still load, and its
 * flags must come back as VEX IQ ones with nothing match affecting.
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
    ],
    activity: [],
  }),
);

test("a flag from before rulesets loads as a VEX IQ flag that is not match affecting", async () => {
  const { fileStore } = await import("../src/lib/db/file");
  const [flag] = await fileStore.listFlags();
  assert.ok(flag, "the old flag was lost on load");
  assert.equal(flag.rule, "SG6", "its rule must survive untouched");
  assert.equal(flag.ruleset, null, "null is how a legacy flag says it is IQ");
  assert.equal(flag.manual_version, null);
  assert.equal(flag.match_affecting, false);
});
