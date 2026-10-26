import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/* `next dev` evaluates the server modules again whenever it compiles a
   route for the first time (the log prints "[store] using JSON file" each
   time). If each evaluation kept its own in-memory copy, a route compiled
   a moment after a write would reload the file before the 200 ms save had
   landed, miss the write, and -- on its next save -- erase it. Reproduced
   in the browser: a judge added, the next route compiled, "that judge is
   not on the roster", and the judge gone from the file on the next write.

   So the store's process-wide state is shared by every evaluation of
   file.ts. The copies here are real second evaluations: `require`, after
   dropping the module from the require cache (a dynamic import would hand
   back the first instance). */
const FILE = join(tmpdir(), `judge-queue-shared-${process.pid}-${Date.now()}.json`);
process.env.DATA_FILE = FILE;
process.env.SEED_DEMO = "false";

function freshCopy() {
  const path = require.resolve("../src/lib/db/file");
  delete require.cache[path];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("../src/lib/db/file") as typeof import("../src/lib/db/file")).fileStore;
}

const SIGNALS = ["exit", "SIGINT", "SIGTERM", "SIGHUP"] as const;

test("a second evaluation of the module adds no second heartbeat and no second set of shutdown hooks", async () => {
  const intervals: number[] = [];
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
    intervals.push(ms ?? 0);
    return (realSetInterval as (...a: unknown[]) => unknown)(fn, ms, ...rest);
  }) as unknown as typeof setInterval;

  try {
    const one = freshCopy();
    await one.listTeams(); // first use in this process: claims the lock, installs the hooks
    const hooks = SIGNALS.map((s) => process.listenerCount(s));
    assert.equal(intervals.filter((ms) => ms === 5_000).length, 1, "the lock heartbeat");

    for (let i = 0; i < 3; i++) {
      const again = freshCopy();
      assert.notEqual(again, one, "a real second evaluation");
      await again.listTeams();
    }
    assert.deepEqual(SIGNALS.map((s) => process.listenerCount(s)), hooks, "no duplicate process hooks");
    assert.equal(intervals.filter((ms) => ms === 5_000).length, 1, "and still one heartbeat");
  } finally {
    globalThis.setInterval = realSetInterval;
  }
});

test("a write through one copy is visible through another at once, without waiting for the save", async () => {
  const one = freshCopy();
  const two = freshCopy();
  assert.notEqual(one, two, "two real copies of the module");

  const zed = await one.addJudge({ name: "Zed Testjudge" });
  assert.deepEqual((await two.listJudges()).map((j) => j.id), [zed.id], "the other copy has it before any save could land");

  // The id handed out by one is accepted by the other.
  const conflict = await two.addConflict({ judgeId: zed.id, teamId: "t1", note: null, declaredBy: "admin:JA" });
  assert.equal(conflict.judge_id, zed.id);
  assert.equal((await one.listConflicts()).length, 1, "and what the other wrote is visible back");
});

test("a write through the second copy does not erase the first copy's earlier write once both have saved", async () => {
  const one = freshCopy();
  const two = freshCopy();

  await one.addJudge({ name: "Alpha Judge" });
  await two.addJudge({ name: "Beta Judge" });
  await sleep(450); // past the 200 ms debounce

  const onDisk = JSON.parse(readFileSync(FILE, "utf8")) as { judges: { name: string }[] };
  const names = onDisk.judges.map((j) => j.name);
  assert.ok(names.includes("Alpha Judge") && names.includes("Beta Judge"), `the file lost a write: ${names}`);
  assert.ok(names.includes("Zed Testjudge"), "and the earlier test's judge, too");
});
