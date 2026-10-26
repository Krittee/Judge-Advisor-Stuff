import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { panelBlocks } from "../src/lib/roster";

/* A state file written before the judge roster existed: every panel carries
   its judges as a list of names, a conflict belongs to a panel alone, and
   there is no `judges` key at all. Loading it must move the names onto the
   roster once -- deduped ignoring case, in the panels' own order -- without
   losing or changing the meaning of a single conflict.

   The file is written before the store is imported, because file.ts
   resolves DATA_FILE once, at load. */
const FILE = join(tmpdir(), `judge-queue-judge-migration-${process.pid}-${Date.now()}.json`);
process.env.DATA_FILE = FILE;
process.env.SEED_DEMO = "false";

const at = "2026-10-20T08:00:00.000Z";
const ES = "Elementary School";
const panel = (id: string, name: string, code: string, sort_order: number, judges: string[]) => ({
  id, name, code, division: ES, judges, languages: ["en"], sort_order,
  slot_start_at: null, slot_minutes: 20, slot_count: 0, created_at: at,
});

writeFileSync(
  FILE,
  JSON.stringify({
    // Panel B first in the file, but Panel A first in the event: the roster follows the event.
    panels: [
      panel("pB", "Panel B", "BRAVO2", 2, ["SAM OKAFOR", "Priya Nair", "dana ruiz", "   "]),
      panel("pA", "Panel A", "ALPHA1", 1, [" Dana Ruiz ", "Sam Okafor"]),
      panel("pC", "Panel C", "CHARLIE3", 3, []),
    ],
    teams: [
      { id: "t1", number: "9882K", name: "Iron Hawks", panel_id: "pA", division: ES, category: "developing", pit: null, created_at: at },
    ],
    requests: [],
    notes: [],
    scores: [],
    conflicts: [
      { id: "c1", panel_id: "pA", team_id: "t1", judge_name: "Dana Ruiz", note: "coaches them", declared_by: "admin:JA", created_at: at },
    ],
    flags: [],
    activity: [],
  }),
);

/** The store, loaded on first use: it reads DATA_FILE and the fixture above when imported. */
const open = async () => (await import("../src/lib/db/file")).fileStore;

/** The state file as the store last wrote it (writes are batched for 200 ms). */
async function onDisk() {
  await sleep(450);
  return JSON.parse(readFileSync(FILE, "utf8")) as {
    panels: Record<string, unknown>[];
    judges: { id: string; name: string; panel_id: string | null }[];
    conflicts: Record<string, unknown>[];
  };
}

test("every name on a panel's old judges list is on the roster, once, in the event's panel order", async () => {
  const db = await open();
  const judges = await db.listJudges();
  assert.deepEqual(
    judges.map((j) => [j.name, j.panel_id]),
    [["Dana Ruiz", "pA"], ["Sam Okafor", "pA"], ["Priya Nair", "pB"]],
    "Dana and Sam are on both lists in other spellings; each stays on the first panel that listed them, and blanks are skipped",
  );
  assert.ok(judges.every((j) => j.note === null && !Number.isNaN(Date.parse(j.created_at))));
});

test("panels read their judges from the roster", async () => {
  const db = await open();
  assert.deepEqual(
    (await db.listPanels()).map((p) => [p.name, p.judges]),
    [["Panel A", ["Dana Ruiz", "Sam Okafor"]], ["Panel B", ["Priya Nair"]], ["Panel C", []]],
  );
  assert.deepEqual((await db.findPanelByCode("bravo2"))?.judges, ["Priya Nair"]);
});

test("the conflict that was there is still there, still whole-panel, still blocking its panel", async () => {
  const db = await open();
  const [c] = await db.listConflicts();
  assert.deepEqual(
    { ...c },
    { id: "c1", panel_id: "pA", judge_id: null, team_id: "t1", judge_name: "Dana Ruiz", note: "coaches them", declared_by: "admin:JA", created_at: at },
  );
  assert.deepEqual(panelBlocks(await db.listConflicts(), await db.listJudges()), [
    { panel_id: "pA", team_id: "t1", conflict_id: "c1" },
  ]);
});

test("once saved, the old lists are gone from disk, so a judge removed later cannot come back from them", async () => {
  const db = await open();
  const sam = (await db.listJudges()).find((j) => j.name === "Sam Okafor")!;
  assert.equal(await db.removeJudge(sam.id), true);

  const data = await onDisk();
  assert.ok(data.panels.every((p) => !("judges" in p)), "no panel keeps a judges list of its own");
  assert.deepEqual(data.judges.map((j) => j.name), ["Dana Ruiz", "Priya Nair"], "and Sam stays removed");
  assert.equal(data.conflicts.length, 1, "the conflict survived the whole round trip");
});
