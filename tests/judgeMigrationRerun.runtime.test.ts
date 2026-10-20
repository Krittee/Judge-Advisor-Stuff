import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* The same migration meeting a file it has already half-seen: the roster
   exists AND a panel still carries an old judges list (an older build
   saved the file after this one did). Running it again must not duplicate
   anyone or drag a judge back to where the old list had them -- the roster
   is the truth -- and must still pick up a name the roster has not seen. */
const FILE = join(tmpdir(), `judge-queue-judge-rerun-${process.pid}-${Date.now()}.json`);
process.env.DATA_FILE = FILE;
process.env.SEED_DEMO = "false";

const at = "2026-10-20T08:00:00.000Z";
const ES = "Elementary School";
const panel = (id: string, name: string, code: string, sort_order: number, judges: string[]) => ({
  id, name, code, division: ES, judges, languages: [], sort_order,
  slot_start_at: null, slot_minutes: 20, slot_count: 0, created_at: at,
});

writeFileSync(
  FILE,
  JSON.stringify({
    panels: [panel("pA", "Panel A", "ALPHA1", 1, ["Dana Ruiz", "Sam Okafor"]), panel("pB", "Panel B", "BRAVO2", 2, [])],
    teams: [],
    requests: [],
    notes: [],
    scores: [],
    conflicts: [
      { id: "c1", panel_id: null, judge_id: "j-dana", team_id: "t1", judge_name: null, note: null, declared_by: "admin:JA", created_at: at },
    ],
    judges: [{ id: "j-dana", name: "dana ruiz", note: "kept", panel_id: "pB", created_at: at }],
    flags: [],
    activity: [],
  }),
);

/** The store, loaded on first use: it reads DATA_FILE and the fixture above when imported. */
const open = async () => (await import("../src/lib/db/file")).fileStore;

test("the roster wins: nobody is duplicated or moved back, and a name it has not seen is added", async () => {
  const db = await open();
  assert.deepEqual(
    (await db.listJudges()).map((j) => [j.id, j.name, j.panel_id, j.note]),
    [["j-dana", "dana ruiz", "pB", "kept"], [(await db.listJudges())[1].id, "Sam Okafor", "pA", null]],
  );
  assert.deepEqual((await db.listPanels()).map((p) => p.judges), [["Sam Okafor"], ["dana ruiz"]]);
});

test("a judge's conflict in the file is read as it was written", async () => {
  const db = await open();
  const [c] = await db.listConflicts();
  assert.equal(c.judge_id, "j-dana");
  assert.equal(c.panel_id, null);
});
