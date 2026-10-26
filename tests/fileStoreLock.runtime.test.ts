import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

/**
 * The file store's lock (BUG-028). A second copy pointed at the same data
 * file must be refused, not allowed to write a second in-memory snapshot
 * over the first. The second copy runs in its own process, because the lock
 * is per process and the same pid is always allowed.
 *
 * DATA_FILE is named before the store is imported, because file.ts resolves
 * it once at load. Node's test runner gives each test file its own process.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const dataFile = join(tmpdir(), `judge-queue-lock-${process.pid}-${Date.now()}.json`);
process.env.DATA_FILE = dataFile;
process.env.SEED_DEMO = "false";

/** Start a fresh node process on `file`, make one store call there, and report what happened. */
function otherCopy(file: string) {
  // CommonJS, because file.ts compiles to CommonJS here: an ESM import would not see its named exports.
  const script = `
    const { fileStore } = require(${JSON.stringify(join(root, "src/lib/db/file.ts"))});
    fileStore.listTeams().then(
      () => console.log("OPENED " + process.pid),
      (e) => console.log("REFUSED " + e.message),
    );
  `;
  const run = spawnSync(process.execPath, ["--import", "tsx", "-e", script], {
    cwd: root,
    env: { ...process.env, DATA_FILE: file, SEED_DEMO: "false" },
    encoding: "utf8",
  });
  return run.stdout + run.stderr;
}

test("a second copy on the same data file is refused and does not take the lock", async () => {
  const { fileStore } = await import("../src/lib/db/file");
  await fileStore.resetAll(); // this process now holds the lock

  const out = otherCopy(dataFile);
  assert.match(
    out,
    /REFUSED Another copy of the app is already using .+ \(pid \d+\)\. Stop it first, or point DATA_FILE somewhere else\./,
  );
  assert.ok(out.includes(`(pid ${process.pid})`), "the message names the copy that holds the file");
  assert.equal(
    JSON.parse(readFileSync(`${dataFile}.lock`, "utf8")).pid,
    process.pid,
    "the refused copy must leave the lock with its owner",
  );
});

test("a lock left by a dead process, or one with an old heartbeat, is taken over", () => {
  // spawnSync reports the pid of a process that has already exited: no such process now.
  const deadPid = spawnSync(process.execPath, ["-e", ""]).pid!;
  const file = join(tmpdir(), `judge-queue-lock-stale-${process.pid}-${Date.now()}.json`);

  writeFileSync(`${file}.lock`, JSON.stringify({ pid: deadPid, heartbeat: Date.now() }));
  assert.match(otherCopy(file), /OPENED \d+/, "a dead pid does not block a start, even with a fresh heartbeat");

  // Our parent is alive but has been silent past the staleness threshold.
  writeFileSync(`${file}.lock`, JSON.stringify({ pid: process.ppid, heartbeat: Date.now() - 60_000 }));
  assert.match(otherCopy(file), /OPENED \d+/, "a silent copy's lock is stale and is taken over");
});

test("the same process may load the store again, as a hot reload does", async () => {
  // tsx ignores a query string on import, so drop file.ts from the require cache and load it afresh.
  const requireFile = createRequire(import.meta.url);
  const path = requireFile.resolve("../src/lib/db/file.ts");
  const { fileStore: first } = await import("../src/lib/db/file");
  // A reload that finds the process already holding the file would never claim the lock again;
  // forget what it holds so this one starts cold, over the lock this pid left behind.
  delete (globalThis as { __judgeQueueFileStore?: unknown }).__judgeQueueFileStore;
  delete requireFile.cache[path];
  const reloaded = requireFile(path) as typeof import("../src/lib/db/file");
  assert.notEqual(reloaded.fileStore, first, "the reload must be a new module instance, or this proves nothing");

  // A fresh instance in this same pid: its first call must not refuse itself.
  await reloaded.fileStore.resetAll();
  assert.deepEqual(await reloaded.fileStore.listTeams(), []);
});
