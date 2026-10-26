import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* Saving the migration is best-effort. On a disk that cannot be written the
   store must carry on from memory with the roster, and must NOT read the
   failed save as a corrupt file and set the user's real file aside. */
const DIR = join(tmpdir(), `judge-queue-judge-readonly-${process.pid}-${Date.now()}`);
const FILE = join(DIR, "state.json");
process.env.DATA_FILE = FILE;
process.env.SEED_DEMO = "false";

const at = "2026-10-20T08:00:00.000Z";
mkdirSync(DIR, { recursive: true });
writeFileSync(
  FILE,
  JSON.stringify({
    panels: [
      { id: "pA", name: "Panel A", code: "ALPHA1", division: "Elementary School", judges: ["Dana Ruiz"], languages: [], sort_order: 1, slot_start_at: null, slot_minutes: 20, slot_count: 0, created_at: at },
    ],
    teams: [],
    requests: [],
    notes: [],
    scores: [],
    conflicts: [],
    flags: [],
    activity: [],
  }),
);
chmodSync(DIR, 0o555); // can read the file, cannot create anything beside it

// Root ignores permissions, so there is nothing to show there.
const canBlock = process.getuid?.() !== 0;

test("an unwritable disk keeps the file, and the roster is served from memory", { skip: !canBlock && "running as root" }, async () => {
  const { fileStore } = await import("../src/lib/db/file");
  assert.deepEqual((await fileStore.listJudges()).map((j) => j.name), ["Dana Ruiz"]);
  assert.deepEqual((await fileStore.listPanels())[0].judges, ["Dana Ruiz"]);

  chmodSync(DIR, 0o755); // so the temp dir can be cleaned up and inspected
  assert.ok(existsSync(FILE), "the original file is still there");
  assert.deepEqual(readdirSync(DIR).filter((f) => f.includes("corrupt")), [], "and was not set aside as corrupt");
});
