import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/** A data file written before Awards Desk releases existed still loads, with none. */
const dir = join(tmpdir(), `judge-queue-releases-migration-${process.pid}-${Date.now()}`);
mkdirSync(dir, { recursive: true });
const file = join(dir, "state.json");
process.env.DATA_FILE = file;
process.env.SEED_DEMO = "false";
writeFileSync(file, JSON.stringify({ panels: [], teams: [], requests: [], notes: [], scores: [], conflicts: [], flags: [], activity: [] }));

test("a data file without awardReleases loads and lists none", async () => {
  const { fileStore } = await import("../src/lib/db/file");
  assert.deepEqual(await fileStore.listReleases(), []);
});
