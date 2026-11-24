import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Session } from "../src/lib/auth";
import { ADMIN, COORDINATOR, ES, MARKETING, QUEUER, REFEREE, hit, judgeOf, world } from "./routeHarness";

/* /api/review-marks and the reviewMarks in /api/state, driven through the REAL route handler and
   loadState against the real file store. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-review-marks-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "review-marks-test-secret-0123456789";
delete process.env.DATABASE_URL;

const route = () => import("../src/app/api/review-marks/route");
const put = (s: Session | null, body?: unknown) => hit(route, "PUT", s, "/api/review-marks", body);
const del = (s: Session | null, body?: unknown) => hit(route, "DELETE", s, "/api/review-marks", body);
type World = Awaited<ReturnType<typeof world>>;

const panelIn = (db: World["db"], name: string, code: string) =>
  db.createPanel({ name, code, division: ES, judges: [], languages: [], sort_order: 1, slot_start_at: null, slot_minutes: 20, slot_count: 0 });

/** Two panels, a team on each (1001A on mine, 2002B on theirs) and one unassigned (3003C). */
async function setup() {
  const w = await world([["1001A", "Mine", ES], ["2002B", "Theirs", ES], ["3003C", "Loose", ES]]);
  const mine = await panelIn(w.db, "Mine", "RM1001");
  const theirs = await panelIn(w.db, "Theirs", "RM2002");
  await w.db.updateTeam(w.team("1001A").id, { panel_id: mine.id });
  await w.db.updateTeam(w.team("2002B").id, { panel_id: theirs.id });
  return { ...w, amy: judgeOf(mine, "Amy"), ben: judgeOf(mine, "Ben"), theirJudge: judgeOf(theirs, "Cat"), id: (n: string) => w.team(n).id };
}

test("a judge sets, edits and clears a mark on their own panel's team", async () => {
  const { db, amy, id } = await setup();
  const teamId = id("1001A");

  const set = await put(amy, { teamId, reason: "  Rubric 3 looks off  " });
  assert.equal(set.status, 200);
  assert.deepEqual([set.body.mark.team_id, set.body.mark.reason, set.body.mark.set_by, set.body.mark.set_by_role], [teamId, "Rubric 3 looks off", "Amy", "judge"]);

  assert.equal((await put(amy, { teamId, reason: "" })).body.mark.reason, null, "an empty reason is stored as null");
  assert.equal((await put(judgeOf((await db.listPanels())[0], "  amy "), { teamId })).status, 200, "the same judge by name, any case");
  assert.equal((await db.listReviewMarks()).length, 1, "one mark per team");

  const cleared = await del(amy, { teamId });
  assert.deepEqual([cleared.status, cleared.body.removed], [200, true]);
  assert.deepEqual(await db.listReviewMarks(), []);
  assert.deepEqual((await del(amy, { teamId })).body, { ok: true, removed: false }, "clearing nothing is harmless");

  const log = (await db.listActivity()).map((a) => a.action);
  assert.ok(log.includes("marked 1001A for review") && log.includes("changed the review mark on 1001A") && log.includes("cleared the review mark on 1001A"));
});

test("a judge cannot touch another panel's or an unassigned team", async () => {
  const { db, amy, id } = await setup();
  for (const n of ["2002B", "3003C"]) {
    assert.equal((await put(amy, { teamId: id(n) })).status, 403);
    assert.equal((await del(amy, { teamId: id(n) })).status, 403);
  }
  assert.deepEqual(await db.listReviewMarks(), []);
});

test("a judge cannot mark a team their panel has a conflict with", async () => {
  const { db, amy, id } = await setup();
  const priya = await db.addJudge({ name: "Priya Nair" });
  await db.updateJudge(priya.id, { panel_id: (amy as { panelId: string }).panelId });
  await db.addConflict({ judgeId: priya.id, teamId: id("1001A"), note: null, declaredBy: "admin:JA" });
  const refused = await put(amy, { teamId: id("1001A") });
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /declared conflict of interest/);
  assert.equal((await del(amy, { teamId: id("1001A") })).status, 403);
  assert.equal((await put(ADMIN, { teamId: id("1001A") })).status, 200, "the Judge Advisor is not blocked");
  await db.clearReviewMark(id("1001A"));
  assert.deepEqual(await db.listReviewMarks(), []);
});

test("a judge cannot edit or clear another judge's mark, but the Judge Advisor can", async () => {
  const { db, amy, ben, id } = await setup();
  const teamId = id("1001A");
  await put(amy, { teamId, reason: "first" });

  for (const reply of [await put(ben, { teamId, reason: "mine now" }), await del(ben, { teamId })]) {
    assert.equal(reply.status, 403);
  }
  assert.deepEqual((await db.listReviewMarks()).map((m) => [m.set_by, m.reason]), [["Amy", "first"]]);

  const edited = await put(ADMIN, { teamId, reason: "JA note" });
  assert.deepEqual([edited.body.mark.set_by, edited.body.mark.set_by_role], ["Alex", "admin"], "whoever saves becomes set_by");
  assert.equal((await put(amy, { teamId })).status, 403, "and a judge cannot take back a Judge Advisor's mark");
  assert.equal((await del(amy, { teamId })).status, 403);
  assert.equal((await del(ADMIN, { teamId })).body.removed, true);

  await put(amy, { teamId });
  assert.equal((await del(ADMIN, { teamId })).body.removed, true, "the Judge Advisor clears a judge's");
});

test("the Judge Advisor marks a team on any panel, or none", async () => {
  const { db, id } = await setup();
  for (const n of ["1001A", "2002B", "3003C"]) assert.equal((await put(ADMIN, { teamId: id(n), reason: "look" })).status, 200);
  assert.equal((await db.listReviewMarks()).length, 3);
  for (const n of ["1001A", "2002B", "3003C"]) assert.equal((await del(ADMIN, { teamId: id(n) })).body.removed, true);
});

test("every other role and a signed-out caller is 403 for PUT and DELETE", async () => {
  const { db, id } = await setup();
  await put(ADMIN, { teamId: id("1001A") });
  for (const session of [QUEUER, REFEREE, { ...REFEREE, head: true } as Session, COORDINATOR, MARKETING, null]) {
    assert.equal((await put(session, { teamId: id("1001A"), reason: "x" })).status, 403);
    assert.equal((await del(session, { teamId: id("1001A") })).status, 403);
  }
  assert.equal((await db.listReviewMarks()).length, 1, "the mark is untouched");
});

test("an unknown team is 404; a missing team is 400", async () => {
  const { amy } = await setup();
  const ghost = "00000000-0000-4000-8000-000000000000";
  for (const session of [amy, ADMIN]) {
    assert.equal((await put(session, { teamId: ghost })).status, 404);
    assert.equal((await del(session, { teamId: ghost })).status, 404);
    assert.equal((await put(session, {})).status, 400);
    assert.equal((await del(session, {})).status, 400);
  }
});

test("the reason is trimmed; more than 140 characters, or not text, is 400", async () => {
  const { db, amy, id } = await setup();
  const teamId = id("1001A");
  assert.equal((await put(amy, { teamId, reason: "x".repeat(140) })).status, 200);
  for (const reason of ["x".repeat(141), 42, { a: 1 }]) {
    const reply = await put(amy, { teamId, reason });
    assert.equal(reply.status, 400);
  }
  assert.equal((await put(amy, { teamId, reason: ` ${"y".repeat(140)} ` })).status, 200, "trimmed before it is measured");
  assert.equal((await db.listReviewMarks())[0].reason, "y".repeat(140));
});

test("state: the Judge Advisor sees all, a judge only their own panel's, everyone else none", async () => {
  const { amy, theirJudge, id } = await setup();
  const { loadState } = await import("../src/lib/server-state");
  await put(ADMIN, { teamId: id("1001A"), reason: "a" });
  await put(ADMIN, { teamId: id("2002B"), reason: "b" });
  await put(ADMIN, { teamId: id("3003C"), reason: "c" });

  const ids = async (s: Session | null) => (await loadState(s)).reviewMarks.map((m) => m.team_id).sort();
  assert.deepEqual(await ids(ADMIN), [id("1001A"), id("2002B"), id("3003C")].sort());
  assert.deepEqual(await ids(amy), [id("1001A")]);
  assert.deepEqual(await ids(theirJudge), [id("2002B")]);
  for (const s of [QUEUER, REFEREE, { ...REFEREE, head: true } as Session, COORDINATOR, MARKETING, null]) {
    assert.deepEqual((await loadState(s)).reviewMarks, [], `${s?.role ?? "signed out"} sees none`);
  }
});

test("removing a team, or wiping the event, takes its mark; moving a team's division keeps it", async () => {
  const { db, id } = await setup();
  await put(ADMIN, { teamId: id("1001A") });
  await put(ADMIN, { teamId: id("2002B") });
  await db.deleteTeam(id("1001A"));
  assert.deepEqual((await db.listReviewMarks()).map((m) => m.team_id), [id("2002B")]);

  await db.moveDivision(ES, "V5RC Middle School");
  assert.equal((await db.listReviewMarks()).length, 1, "the mover re-keys divisions, not team ids");

  await db.resetAll();
  assert.deepEqual(await db.listReviewMarks(), []);
});
