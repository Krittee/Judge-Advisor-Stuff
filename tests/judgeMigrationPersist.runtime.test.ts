import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* The migration mints the roster's ids, so it must be saved the moment it
   runs. Otherwise every fresh copy of the store -- each Next route compiles
   its own, and a restart before the first write is another -- migrates the
   same file again with NEW ids, and a judge id the browser got from one copy
   is unknown to the next ("unknown judge" on the first POST after a route
   compiles). */
const FILE = join(tmpdir(), `judge-queue-judge-persist-${process.pid}-${Date.now()}.json`);
process.env.DATA_FILE = FILE;
process.env.SEED_DEMO = "false";

const at = "2026-10-20T08:00:00.000Z";
const legacy = {
  panels: [
    { id: "pA", name: "Panel A", code: "ALPHA1", division: "Elementary School", judges: ["Dana Ruiz", "Sam Okafor"], languages: [], sort_order: 1, slot_start_at: null, slot_minutes: 20, slot_count: 0, created_at: at },
  ],
  teams: [],
  requests: [],
  notes: [],
  scores: [],
  conflicts: [],
  flags: [],
  activity: [],
};
writeFileSync(FILE, JSON.stringify(legacy));

/**
 * A cold start: a process that has not read the file yet, as after a restart.
 * (Two copies of the module in ONE process share one in-memory copy -- see
 * fileStoreShared.runtime.test.ts -- so a copy that reads the file afresh
 * needs the process's entry dropped as well.) `require`, not `import()`:
 * deleting the cache entry makes the next require evaluate the module afresh,
 * whereas a dynamic import hands back the same instance.
 */
function freshStore() {
  delete (globalThis as { __judgeQueueFileStore?: unknown }).__judgeQueueFileStore;
  const path = require.resolve("../src/lib/db/file");
  delete require.cache[path];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("../src/lib/db/file") as typeof import("../src/lib/db/file")).fileStore;
}

test("the migrated roster is on disk as soon as the file is read, before any write", async () => {
  const first = freshStore();
  const judges = await first.listJudges();
  assert.deepEqual(judges.map((j) => j.name), ["Dana Ruiz", "Sam Okafor"]);

  const onDisk = JSON.parse(readFileSync(FILE, "utf8"));
  assert.deepEqual(onDisk.judges.map((j: { id: string }) => j.id), judges.map((j) => j.id), "the same ids, saved");
  assert.ok(onDisk.panels.every((p: object) => !("judges" in p)), "and the old lists are gone from the file");
});

test("a restart before anything is written reads the same judge ids, so an id the browser holds is still known", async () => {
  const before = await freshStore().listJudges();
  const second = freshStore();
  assert.notEqual(second, freshStore(), "each call is a different copy of the module");
  // (That third copy was only there to prove the point; `second` still has its own.)
  const after = await second.listJudges();
  assert.deepEqual(after.map((j) => j.id), before.map((j) => j.id));
  assert.ok(after.length === 2, "and nobody was added by the second read");

  const dana = after[0];
  const conflict = await second.addConflict({ judgeId: dana.id, teamId: "t1", note: null, declaredBy: "admin:JA" });
  assert.equal(conflict.judge_id, dana.id, "the id from the first copy is accepted by the next");
});
