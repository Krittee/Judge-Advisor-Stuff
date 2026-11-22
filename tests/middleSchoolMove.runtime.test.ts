import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Session } from "../src/lib/auth";
import { ADMIN, COORDINATOR, ES, MARKETING, MS, hit, judgeOf, world } from "./routeHarness";

/* /api/admin/middle-school, driven through the REAL route handler against the real file store. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-ms-move-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "ms-move-test-secret-0123456789";
delete process.env.DATABASE_URL;

const OLD = "Middle School";
const V5 = "V5RC Middle School";
const route = () => import("../src/app/api/admin/middle-school/route");
const move = (session: Session | null, body?: unknown) => hit(route, "POST", session, "/api/admin/middle-school", body);
type World = Awaited<ReturnType<typeof world>>;

/** A world with two plain "Middle School" teams and one Elementary one. */
const legacy = () =>
  world([["1001A", "Old one", OLD], ["1002B", "Old two", " middle school "], ["3003C", "Kids", ES]]);
const panelIn = (db: World["db"], name: string, division: string, code: string) =>
  db.createPanel({ name, code, division, judges: [], languages: [], sort_order: 1, slot_start_at: null, slot_minutes: 20, slot_count: 0 });
const snap = (id: string, number: string, division: string) => ({ teams: [{ id, number, name: number, division }], no_winner: false });
const moveLogs = async (db: World["db"]) => (await db.listActivity()).filter((a) => a.action.startsWith("Moved")).map((a) => `${a.kind} | ${a.action} | ${a.detail}`);

test("only the Judge Advisor moves; anyone else is 403", async () => {
  const { db } = await legacy();
  for (const session of [judgeOf(await panelIn(db, "P", OLD, "MV1001")), COORDINATOR, MARKETING, null]) {
    const reply = await move(session, { to: MS });
    assert.equal(reply.status, 403);
    assert.equal(reply.body.error, "Only the Judge Advisor can move Middle School teams.");
  }
  assert.deepEqual((await db.listTeams()).map((t) => t.division).sort(), [" middle school ", ES, OLD].sort());
});

test("a target that is not one of the two Middle School divisions is 400", async () => {
  await legacy();
  for (const to of [ES, OLD, "", "Nowhere Middle School"]) {
    const reply = await move(ADMIN, { to });
    assert.deepEqual([reply.status, reply.body.error], [400, "Pick IQ Middle School or V5RC Middle School."]);
  }
  assert.equal((await move(ADMIN, undefined)).status, 400);
});

test("a target outside the saved setup's program is 400 and names the right one", async () => {
  const { db } = await legacy();
  await db.saveEventSetup({ program: "VEX IQ", format: "standard", setBy: "Dana" });
  const reply = await move(ADMIN, { to: V5 });
  assert.deepEqual([reply.status, reply.body.error], [400, `${V5} is not in VEX IQ. Pick ${MS}.`]);
  assert.equal((await move(ADMIN, { to: MS })).status, 200);
});

test("an award decided under both Middle Schools is 409 and nothing moves", async () => {
  const { db, team } = await legacy();
  const a = team("1001A");
  await db.setWinner({ awardId: "excellence", division: OLD, teamId: a.id, decidedBy: "Alex", places: 1 });
  await db.setNoWinner({ awardId: "design", division: OLD, decidedBy: "Alex" });
  await db.setNoWinner({ awardId: "excellence", division: MS, decidedBy: "Alex" });
  await db.setNoWinner({ awardId: "design", division: MS, decidedBy: "Alex" });
  const reply = await move(ADMIN, { to: MS });
  assert.deepEqual([reply.status, reply.body.error], [409, `Excellence, Design already decided in ${MS}. Clear one of the two first.`]);
  assert.deepEqual((await db.listTeams()).filter((t) => t.number !== "3003C").map((t) => t.division), [OLD, " middle school "]);
  assert.deepEqual(await moveLogs(db), []);
});

test("with no plain Middle School data it is { moved: null } and logs nothing", async () => {
  const { db } = await world();
  const empty = await move(ADMIN, { to: MS });
  assert.deepEqual([empty.status, empty.body], [200, { moved: null }]);
  assert.deepEqual(await moveLogs(db), []);
});

test("a full move re-keys teams, panels and awards, keeps a sent release sent, and logs once", async () => {
  const { db, team } = await legacy();
  const [a, b] = [team("1001A"), team("1002B")];
  await panelIn(db, "Old", OLD, "MV2001");
  await panelIn(db, "Kids", ES, "MV2002");
  await db.setWinner({ awardId: "excellence", division: OLD, teamId: a.id, decidedBy: "Alex", places: 1 });
  await db.setNoWinner({ awardId: "design", division: OLD, decidedBy: "Alex" });
  await db.sendRelease({ awardId: "think", division: OLD, snapshot: snap(b.id, "1002B", OLD), previous: null, changedAt: null, sentBy: "Alex" });

  const reply = await move(ADMIN, { to: V5 });
  assert.deepEqual([reply.status, reply.body.moved], [200, { teams: 2, panels: 1, winners: 1, noWinners: 1, releases: 1 }]);

  assert.deepEqual((await db.listTeams()).map((t) => [t.number, t.division]).sort(), [["1001A", V5], ["1002B", V5], ["3003C", ES]]);
  assert.deepEqual((await db.listPanels()).map((p) => [p.name, p.division]).sort(), [["Kids", ES], ["Old", V5]]);
  assert.deepEqual((await db.listWinners()).map((w) => w.division), [V5]);
  assert.deepEqual((await db.listNoWinners()).map((n) => n.division), [V5]);
  const [release] = await db.listReleases();
  assert.deepEqual([release.division, release.status, release.teams[0].division], [V5, "sent", V5]);
  assert.deepEqual(await moveLogs(db), [`setup | Moved "Middle School" to ${V5} | 2 teams, 1 panel, 3 award records`]);

  const again = await move(ADMIN, { to: V5 });
  assert.deepEqual([again.status, again.body], [200, { moved: null }]);
  assert.equal((await moveLogs(db)).length, 1);
});
