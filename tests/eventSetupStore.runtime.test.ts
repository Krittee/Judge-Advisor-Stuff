import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Panel, Team } from "../src/lib/types";

/* The saved event setup in the file store: the row itself, what saving does to
   recalled releases, and the format-aware division wall. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-event-setup-store-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
delete process.env.DATABASE_URL;

const ES = "Elementary School";
const MS = "IQ Middle School";
const HS = "High School";

async function fresh() {
  const db = (await import("../src/lib/db/file")).fileStore;
  await db.resetAll();
  return db;
}
const panel = (db: Awaited<ReturnType<typeof fresh>>, code: string, division: string): Promise<Panel> =>
  db.createPanel({ name: code, code, division, judges: [], languages: [], sort_order: 1, slot_start_at: null, slot_minutes: 20, slot_count: 0 });
const blank = (number: string, division: string | null = null) => ({ number, name: null, pit: null, division, category: null, languages: null });
const team = async (db: Awaited<ReturnType<typeof fresh>>, number: string) => (await db.listTeams()).find((t) => t.number === number) as Team;
const snapshot = { teams: [], no_winner: true };
const release = (awardId: string, division: string) => ({ awardId, division, snapshot, previous: null, changedAt: null, sentBy: "Alex" });

test("the setup is null until saved, then one record read back as saved", async () => {
  const db = await fresh();
  assert.equal(await db.getEventSetup(), null);
  const saved = await db.saveEventSetup({ program: "VEX IQ", format: "blended", setBy: "Alex" });
  assert.deepEqual({ ...saved, updated_at: undefined }, { program: "VEX IQ", format: "blended", set_by: "Alex", updated_at: undefined });
  assert.equal(new Date(saved.updated_at).toISOString(), saved.updated_at);
  assert.deepEqual(await db.getEventSetup(), saved);
});

test("saving deletes every recalled release and keeps the sent ones", async () => {
  const db = await fresh();
  await db.sendRelease(release("excellence", ES));
  await db.sendRelease(release("design", ES));
  await db.recallRelease("design", ES);
  await db.saveEventSetup({ program: "V5RC", format: "standard", setBy: "Alex" });
  assert.deepEqual((await db.listReleases()).map((r) => `${r.award_id}:${r.status}`), ["excellence:sent"]);
});

test("a day reset keeps the setup; a full wipe clears it", async () => {
  const db = await fresh();
  const saved = await db.saveEventSetup({ program: "V5RC", format: "standard", setBy: "Alex" });
  await db.resetDay();
  assert.deepEqual(await db.getEventSetup(), saved);
  await db.resetAll();
  assert.equal(await db.getEventSetup(), null);
});

test("a new team with no division gets the program's first division, else the config's", async () => {
  const db = await fresh();
  await db.saveEventSetup({ program: "V5RC", format: "standard", setBy: "Alex" });
  await db.upsertTeams([blank("100A")]);
  assert.equal((await team(db, "100A")).division, "V5RC Middle School");

  await db.resetAll();
  await db.upsertTeams([blank("100A")]);
  assert.equal((await team(db, "100A")).division, ES);
});

test("blended: an import moving a team to another division keeps its panel; standard drops it", async () => {
  for (const format of ["blended", null] as const) {
    const db = await fresh();
    if (format) await db.saveEventSetup({ program: "VEX IQ", format, setBy: "Alex" });
    const hs = await panel(db, "HS1001", HS);
    await db.upsertTeams([blank("100A", ES)]);
    const t = await team(db, "100A");
    await db.updateTeam(t.id, { panel_id: hs.id });
    await db.upsertTeams([blank("100A", MS)]);
    assert.equal((await team(db, "100A")).panel_id, format ? hs.id : null, String(format));
  }
});

test("blended: auto-assign puts a Middle School team on a High School panel; standard assigns nothing", async () => {
  for (const format of ["blended", null] as const) {
    const db = await fresh();
    if (format) await db.saveEventSetup({ program: "VEX IQ", format, setBy: "Alex" });
    const hs = await panel(db, "HS1001", HS);
    await db.upsertTeams([blank("200B", MS)]);
    if (format) {
      assert.equal(await db.autoAssignTeams(10, false, ES), 1);
      assert.equal((await team(db, "200B")).panel_id, hs.id);
    } else {
      await assert.rejects(() => db.autoAssignTeams(10, false, ES), /No judge panels in Elementary School/);
      assert.equal((await team(db, "200B")).panel_id, null);
    }
  }
});

test("blended: moving a panel's division keeps its team; standard releases it", async () => {
  for (const format of ["blended", null] as const) {
    const db = await fresh();
    if (format) await db.saveEventSetup({ program: "VEX IQ", format, setBy: "Alex" });
    const hs = await panel(db, "HS1001", HS);
    await db.upsertTeams([blank("100A", ES)]);
    await db.updateTeam((await team(db, "100A")).id, { panel_id: hs.id });
    await db.updatePanel(hs.id, { division: MS });
    assert.equal((await team(db, "100A")).panel_id, format ? hs.id : null, String(format));
  }
});
