import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Session } from "../src/lib/auth";
import type { Team } from "../src/lib/types";
import { ADMIN, COORDINATOR, ES, MARKETING, MS, QUEUER, REFEREE, hit, inRequestScope, judgeOf, world } from "./routeHarness";

/* /api/event-setup and what the saved setup changes elsewhere (state, panels, teams,
   requests, the team lock), driven through the REAL route handlers against the real file
   store, with the same hand-built request scope as awardsReleased.runtime.test.ts. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-event-setup-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "event-setup-test-secret-0123456789";
delete process.env.DATABASE_URL;

const HS = "High School";
const WHOLE = "Whole event";

const setupRoute = () => import("../src/app/api/event-setup/route");
const stateRoute = () => import("../src/app/api/state/route");
const panelsRoute = () => import("../src/app/api/admin/panels/route");
const teamsRoute = () => import("../src/app/api/admin/teams/route");
const setup = (session: Session | null, body?: unknown) => hit(setupRoute, "PUT", session, "/api/event-setup", body);
const state = (session: Session | null) => hit(stateRoute, "GET", session, "/api/state");
const addPanel = (body: unknown) => hit(panelsRoute, "POST", ADMIN, "/api/admin/panels", body);
const patchTeam = (body: unknown) => hit(teamsRoute, "PATCH", ADMIN, "/api/admin/teams", body);
const deleteTeam = (teamId: string) => hit(teamsRoute, "DELETE", ADMIN, `/api/admin/teams?teamId=${teamId}`);

const VEXIQ_BLENDED = { program: "VEX IQ", format: "blended" };
const VEXIQ_STANDARD = { program: "VEX IQ", format: "standard" };
const setupLogs = async (db: typeof import("../src/lib/db/file").fileStore) =>
  (await db.listActivity()).filter((a) => a.action.startsWith("Event setup")).map((a) => `${a.action} | ${a.detail}`).sort();

const panelIn = (db: Awaited<ReturnType<typeof world>>["db"], name: string, division: string, code: string) =>
  db.createPanel({ name, code, division, judges: [], languages: [], sort_order: 1, slot_start_at: null, slot_minutes: 20, slot_count: 0 });

const sentRow = (db: Awaited<ReturnType<typeof world>>["db"], team: Team, division: string, awardId = "excellence") =>
  db.sendRelease({ awardId, division, snapshot: { teams: [{ id: team.id, number: team.number, name: team.name }], no_winner: false }, previous: null, changedAt: null, sentBy: "Alex" });

/* ===== the route ========================================================== */

test("only the Judge Advisor sets up; a bad program or format is 400", async () => {
  const { db } = await world();
  for (const session of [QUEUER, REFEREE, COORDINATOR, judgeOf(await panelIn(db, "P", ES, "ES1001")), MARKETING, null]) {
    const reply = await setup(session, VEXIQ_BLENDED);
    assert.equal(reply.status, 403);
    assert.equal(reply.body.error, "Only the Judge Advisor can set up the event.");
  }
  const bad = await setup(ADMIN, { program: "FLL", format: "blended" });
  assert.deepEqual([bad.status, bad.body.error], [400, "Pick a program: VEX IQ or V5RC."]);
  const noFormat = await setup(ADMIN, { program: "V5RC", format: "mixed" });
  assert.deepEqual([noFormat.status, noFormat.body.error], [400, "Pick Standard or Blended."]);
  assert.equal(await db.getEventSetup(), null);
});

test("saving VEX IQ blended: admin state, marketing state, anonymous state and the log", async () => {
  const { db } = await world();
  const saved = await setup(ADMIN, VEXIQ_BLENDED);
  assert.equal(saved.status, 200);
  assert.deepEqual([saved.body.setup.program, saved.body.setup.format, saved.body.setup.set_by], ["VEX IQ", "blended", "Alex"]);

  const admin = await state(ADMIN);
  assert.equal(admin.body.eventSetup.program, "VEX IQ");
  assert.equal(admin.body.eventSetup.set_by, "Alex");
  assert.deepEqual(admin.body.divisions, [ES, MS], "no High School, no Blended");
  assert.equal((await state(MARKETING)).body.eventSetup.set_by, "");
  assert.equal((await state(null)).body.eventSetup, null);
  assert.deepEqual(await setupLogs(db), ["Event setup: VEX IQ · Blended | null"]);
});

test("saving the same setup again is 200 and writes and logs nothing", async () => {
  const { db } = await world();
  await setup(ADMIN, VEXIQ_BLENDED);
  const first = await db.getEventSetup();
  const again = await setup(ADMIN, VEXIQ_BLENDED);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.setup, first);
  assert.equal((await setupLogs(db)).length, 1);
  assert.deepEqual(await db.getEventSetup(), first);

  await setup(ADMIN, VEXIQ_STANDARD);
  assert.deepEqual(await setupLogs(db), ["Event setup: VEX IQ · Blended | null", "Event setup: VEX IQ · Standard | was VEX IQ · Blended"].sort());
});

test("a winner, a No winner or a sent release blocks it; a recalled one does not and is gone after", async () => {
  const { db, team } = await world();
  const hawks = team("9882K");
  const CLEAR = "Clear the awards first.";

  await db.setWinner({ awardId: "excellence", division: ES, teamId: hawks.id, decidedBy: "Alex", places: 1 });
  let reply = await setup(ADMIN, VEXIQ_BLENDED);
  assert.deepEqual([reply.status, reply.body.error], [409, CLEAR]);
  await db.clearWinner("excellence", ES);

  await db.setNoWinner({ awardId: "design", division: ES, decidedBy: "Alex" });
  reply = await setup(ADMIN, VEXIQ_BLENDED);
  assert.deepEqual([reply.status, reply.body.error], [409, CLEAR]);
  await db.clearNoWinner("design", ES);

  await sentRow(db, hawks, ES);
  reply = await setup(ADMIN, VEXIQ_BLENDED);
  assert.deepEqual([reply.status, reply.body.error], [409, CLEAR]);
  assert.equal(await db.getEventSetup(), null);

  await db.recallRelease("excellence", ES);
  assert.equal((await setup(ADMIN, VEXIQ_BLENDED)).status, 200);
  assert.deepEqual(await db.listReleases(), [], "the recalled row went with the save");
});

test("teams or panels outside the program are 409 and listed", async () => {
  const { db, team } = await world([["1111A", "Kids", "Elementary School"], ["2222B", "Teens", HS]]);
  const kids = team("1111A");
  let reply = await setup(ADMIN, { program: "V5RC", format: "standard" });
  assert.equal(reply.status, 409);
  assert.equal(reply.body.error, "Move or remove the teams and panels outside V5RC first.");
  assert.deepEqual(reply.body.outside.teams, [{ id: kids.id, number: "1111A", division: ES }]);
  assert.deepEqual(reply.body.outside.panels, []);

  // Review Focus 2: a Whole event panel exists only while blended.
  await db.upsertTeams([{ number: "1111A", name: "Kids", pit: null, division: MS, category: "developing" }]);
  await db.deleteTeam(team("2222B").id);
  assert.equal((await setup(ADMIN, VEXIQ_BLENDED)).status, 200);
  const made = await addPanel({ name: "All", code: "WH1001" });
  assert.equal(made.body.panel.division, WHOLE);
  reply = await setup(ADMIN, VEXIQ_STANDARD);
  assert.equal(reply.status, 409);
  assert.deepEqual(reply.body.outside.panels, [{ id: made.body.panel.id, name: "All", division: WHOLE }]);
  assert.deepEqual(reply.body.outside.teams, []);
});

/* ===== what the setup changes elsewhere =================================== */

test("a blended Whole event panel's judge sees every team", async () => {
  const { db } = await world();
  await setup(ADMIN, VEXIQ_BLENDED);
  const panel = await panelIn(db, "All", WHOLE, "WH2002");
  const reply = await state(judgeOf(panel));
  assert.deepEqual(reply.body.teams.map((t: Team) => t.number).sort(), ["2088C", "9882K"]);
});

test("panel and team divisions outside the program fall back; with no setup nothing changes", async () => {
  await world();
  assert.equal((await state(ADMIN)).body.eventSetup, null);
  const before = (await state(ADMIN)).body.divisions;
  assert.equal((await addPanel({ name: "B", code: "NB1001", division: "Blended" })).body.panel.division, "Blended");
  assert.equal((await addPanel({ name: "H", code: "NB1002", division: HS })).body.panel.division, HS);
  assert.deepEqual((await state(ADMIN)).body.divisions, before);

  const w = await world();
  await setup(ADMIN, VEXIQ_BLENDED);
  assert.equal((await addPanel({ name: "X", code: "BL1001", division: HS })).body.panel.division, WHOLE);
  const hawks = w.team("9882K");
  const moved = await patchTeam({ teamId: hawks.id, division: HS });
  assert.equal(moved.body.team.division, ES, "a team falls back to the first division");

  await w.db.deleteAllPanels(); // a Whole event panel only fits a blended event
  await setup(ADMIN, VEXIQ_STANDARD);
  assert.equal((await addPanel({ name: "Y", code: "ST1001", division: HS })).body.panel.division, ES);
});

test("assigning an ES team to an MS panel: 200 blended, 409 standard", async () => {
  const w = await world();
  const msPanel = await panelIn(w.db, "MS panel", MS, "MS1001");
  const hawks = w.team("9882K");
  await setup(ADMIN, VEXIQ_STANDARD);
  assert.equal((await patchTeam({ teamId: hawks.id, panelId: msPanel.id })).status, 409);
  await setup(ADMIN, VEXIQ_BLENDED);
  assert.equal((await patchTeam({ teamId: hawks.id, panelId: msPanel.id })).status, 200);
});

test("reassigning a request across divisions is allowed when blended", async () => {
  const w = await world();
  const esPanel = await panelIn(w.db, "ES panel", ES, "ES2001");
  const msPanel = await panelIn(w.db, "MS panel", MS, "MS2001");
  const hawks = w.team("9882K");
  const req = await w.db.createRequest({ teamId: hawks.id, panelId: esPanel.id, kind: "queue", createdBy: "Desk", language: "en" });
  const reassign = async () => {
    const handlers = (await import("../src/app/api/requests/[id]/route")) as unknown as Record<string, (r: Request, c: unknown) => Promise<Response>>;
    const request = new Request(`http://localhost/api/requests/${req.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reassign", panelId: msPanel.id }) });
    return (await inRequestScope(ADMIN, () => handlers.PATCH(request, { params: Promise.resolve({ id: req.id }) }))).status;
  };
  await setup(ADMIN, VEXIQ_STANDARD);
  assert.equal(await reassign(), 409);
  await setup(ADMIN, VEXIQ_BLENDED);
  assert.equal(await reassign(), 200);
});

test("the team lock: a Whole event sent release does not stop a division move, but does stop a delete", async () => {
  const w = await world();
  const hawks = w.team("9882K");
  const storm = w.team("2088C");
  await setup(ADMIN, VEXIQ_BLENDED);

  await sentRow(w.db, hawks, WHOLE);
  assert.equal((await patchTeam({ teamId: hawks.id, division: MS })).status, 200);
  const del = await deleteTeam(hawks.id);
  assert.deepEqual([del.status, del.body.error], [409, "Recall Excellence from Marketing first."]);

  await sentRow(w.db, storm, MS, "design");
  const moved = await patchTeam({ teamId: storm.id, division: ES });
  assert.deepEqual([moved.status, moved.body.error], [409, "Recall Design from Marketing first."]);
});
