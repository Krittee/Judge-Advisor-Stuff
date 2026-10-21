import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

import type { Session } from "../src/lib/auth";
import type { ConflictRow, JudgeRow, Panel, Team } from "../src/lib/types";

/* The judge roster and the conflicts that belong to it, driven through the
   REAL route handlers against the real file store -- the same harness as
   requestWorkflow.runtime.test.ts (see the long comment there for why the
   request scope is built by hand). */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-judge-routes-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "judge-routes-test-secret-0123456789";
delete process.env.DATABASE_URL;
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

const ES = "Elementary School";

const ADMIN: Session = { role: "admin", name: "Judge Advisor" };
const QUEUER: Session = { role: "queuer", name: "Desk" };
const REFEREE: Session = { role: "referee", name: "Ref" };
const judgeOf = (panel: Panel): Session => ({
  role: "judge",
  name: "Amy",
  panelId: panel.id,
  panelName: panel.name,
});

/* ---- the harness ------------------------------------------------------- */

async function inRequestScope<T>(session: Session | null, fn: () => Promise<T>): Promise<T> {
  const [{ workAsyncStorage }, { workUnitAsyncStorage }, { RequestCookies }, { RequestCookiesAdapter }] =
    await Promise.all([
      import("next/dist/server/app-render/work-async-storage.external"),
      import("next/dist/server/app-render/work-unit-async-storage.external"),
      import("next/dist/server/web/spec-extension/cookies"),
      import("next/dist/server/web/spec-extension/adapters/request-cookies"),
    ]);

  const headers = new Headers();
  if (session) {
    const token = await new SignJWT({ ...session })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET));
    headers.set("cookie", `jq_session=${token}`);
  }
  const cookies = RequestCookiesAdapter.seal(new RequestCookies(headers));
  return workAsyncStorage.run({ route: "/api/test" } as never, () =>
    workUnitAsyncStorage.run({ type: "request", phase: "render", cookies } as never, fn),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Reply = { status: number; body: any };
type Handlers = Record<string, (request: Request) => Promise<Response>>;

/** Call one exported handler of a route as `session`, and read what came back. */
async function hit(
  load: () => Promise<unknown>,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  session: Session | null,
  path: string,
  body?: unknown,
): Promise<Reply> {
  const handlers = (await load()) as Handlers;
  const request = new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await inRequestScope(session, () => handlers[method](request));
  return { status: res.status, body: await res.json() };
}

const judgesRoute = () => import("../src/app/api/admin/judges/route");
const conflictsRoute = () => import("../src/app/api/conflicts/route");
const panelsRoute = () => import("../src/app/api/admin/panels/route");
const teamsRoute = () => import("../src/app/api/admin/teams/route");
const notesRoute = () => import("../src/app/api/notes/route");

const roster = (session: Session | null, method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown, query = "") =>
  hit(judgesRoute, method, session, `/api/admin/judges${query}`, body);
const conflictsApi = (session: Session | null, method: "GET" | "POST" | "DELETE", body?: unknown, query = "") =>
  hit(conflictsRoute, method, session, `/api/conflicts${query}`, body);

async function reassign(session: Session | null, requestId: string, panelId: string): Promise<Reply> {
  const { PATCH } = await import("../src/app/api/requests/[id]/route");
  const res = await inRequestScope(session, () =>
    PATCH(
      new Request(`http://localhost/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reassign", panelId }),
      }),
      { params: Promise.resolve({ id: requestId }) },
    ),
  );
  return { status: res.status, body: await res.json() };
}

/* ---- the fixture ------------------------------------------------------- */

const store = async () => (await import("../src/lib/db/file")).fileStore;

/**
 * Three panels in one division. 9882K is on Panel 1 with a walk-up request,
 * 7700B is on Panel 2, 1234 has no panel. Priya Nair is on the roster, on no
 * panel yet.
 */
async function world() {
  const db = await store();
  await db.resetAll();
  const mk = (n: number) =>
    db.createPanel({
      name: `Panel ${n}`,
      code: `RT${n}00${n}`,
      division: ES,
      judges: [],
      languages: [],
      sort_order: n,
      slot_start_at: null,
      slot_minutes: 20,
      slot_count: 0,
    });
  const [p1, p2, p3] = [await mk(1), await mk(2), await mk(3)];

  await db.upsertTeams(
    ["9882K", "7700B", "1234"].map((number) => ({ number, name: `Team ${number}`, pit: null, division: ES, category: "developing" })),
  );
  const teams = await db.listTeams();
  const team = (n: string) => teams.find((t) => t.number === n) as Team;
  await db.updateTeam(team("9882K").id, { panel_id: p1.id });
  await db.updateTeam(team("7700B").id, { panel_id: p2.id });

  const priya = await db.addJudge({ name: "Priya Nair" });
  return { db, p1, p2, p3, hawks: team("9882K"), bolts: team("7700B"), loose: team("1234"), priya };
}
type World = Awaited<ReturnType<typeof world>>;

const live = (w: World, team: Team, panel: Panel) =>
  w.db.createRequest({ teamId: team.id, panelId: panel.id, kind: "queue", createdBy: "team", language: "en" });
const conflictWith = (w: World, judge: JudgeRow, team: Team) =>
  w.db.addConflict({ judgeId: judge.id, teamId: team.id, note: null, declaredBy: "admin:JA" });
const teamNow = async (w: World, team: Team) => (await w.db.listTeams()).find((t) => t.id === team.id) as Team;
const judgeNow = async (w: World, judge: JudgeRow) => (await w.db.listJudges()).find((j) => j.id === judge.id) as JudgeRow;
const actions = async (w: World) => (await w.db.listActivity()).map((a) => a.action);

/* ===== the spec's route test ============================================ */

test("a judge on Panel 2 with a conflict on 9882K: reassign to Panel 2 is refused, and moving the judge to Panel 3 lifts it", async () => {
  const w = await world();
  await w.db.updateJudge(w.priya.id, { panel_id: w.p2.id });
  await conflictWith(w, w.priya, w.hawks);
  const request = await live(w, w.hawks, w.p1);

  const refused = await reassign(ADMIN, request.id, w.p2.id);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /Panel 2 has a declared conflict of interest with this team/);
  assert.equal((await w.db.findRequest(request.id))?.panel_id, w.p1.id, "nothing moved");

  const moved = await roster(ADMIN, "PATCH", { id: w.priya.id, panelId: w.p3.id });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.judge.panel_id, w.p3.id);

  const lifted = await reassign(ADMIN, request.id, w.p2.id);
  assert.equal(lifted.status, 200, "Panel 2 has no conflicted judge any more");
  assert.equal((await w.db.findRequest(request.id))?.panel_id, w.p2.id);
  assert.equal((await teamNow(w, w.hawks)).panel_id, w.p2.id, "the team follows its request");

  const followed = await reassign(ADMIN, request.id, w.p3.id);
  assert.equal(followed.status, 409, "and the block went to Panel 3 with her");
});

test("assigning a team by hand, and the judge console's own team, honour a judge's conflict too", async () => {
  const w = await world();
  await w.db.updateJudge(w.priya.id, { panel_id: w.p2.id });
  await conflictWith(w, w.priya, w.hawks);

  const assign = (panelId: string) => hit(teamsRoute, "PATCH", ADMIN, "/api/admin/teams", { teamId: w.hawks.id, panelId });
  const refused = await assign(w.p2.id);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /declared conflict of interest/);
  assert.equal((await assign(w.p3.id)).status, 200, "another panel is fine");

  // Judge console: the team is on Priya's panel by some other route; she still cannot read its notes.
  await w.db.updateTeam(w.hawks.id, { panel_id: w.p2.id });
  const notes = await hit(notesRoute, "GET", judgeOf(w.p2), `/api/notes?teamId=${w.hawks.id}`);
  assert.equal(notes.status, 403);
  assert.match(notes.body.error, /declared conflict of interest/, "the conflict is the reason given, not the vaguer one");
  const other = await hit(notesRoute, "GET", judgeOf(w.p3), `/api/notes?teamId=${w.hawks.id}`);
  assert.doesNotMatch(other.body.error, /declared conflict/, "a panel without the judge is not told of her conflict");
});

/* ===== /api/admin/judges ================================================ */

test("the roster is the Judge Advisor's alone: everyone else is refused and nothing is written", async () => {
  const w = await world();
  const strangers: (Session | null)[] = [null, judgeOf(w.p2), QUEUER, REFEREE];

  for (const session of strangers) {
    const who = session?.role ?? "nobody";
    const attempts = [
      await roster(session, "GET"),
      await roster(session, "POST", { name: "Dana Ruiz" }),
      await roster(session, "PATCH", { id: w.priya.id, name: "Renamed", panelId: w.p2.id }),
      await roster(session, "DELETE", undefined, `?id=${w.priya.id}`),
    ];
    for (const a of attempts) assert.equal(a.status, 403, `${who} must be refused`);
  }
  assert.deepEqual(
    (await w.db.listJudges()).map((j) => [j.name, j.panel_id]),
    [["Priya Nair", null]],
    "the roster is exactly as it was",
  );

  assert.equal((await roster(ADMIN, "GET")).status, 200);
});

test("the roster: add, rename, note, move and remove, with a clear 409 for a taken name", async () => {
  const w = await world();

  const added = await roster(ADMIN, "POST", { name: "  Dana Ruiz ", note: "coaches 9882K" });
  assert.equal(added.status, 200);
  assert.equal(added.body.judge.name, "Dana Ruiz");
  assert.equal(added.body.judge.note, "coaches 9882K");
  const dana = added.body.judge as JudgeRow;

  const dup = await roster(ADMIN, "POST", { name: "DANA ruiz" });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /already on the roster/);
  assert.equal((await roster(ADMIN, "POST", { name: "   " })).status, 400);

  const patched = await roster(ADMIN, "PATCH", { id: dana.id, name: "Dana R.", note: "", panelId: w.p2.id });
  assert.deepEqual(
    [patched.status, patched.body.judge.name, patched.body.judge.note, patched.body.judge.panel_id, patched.body.takenOff],
    [200, "Dana R.", null, w.p2.id, []],
  );
  assert.deepEqual((await w.db.listPanels()).find((p) => p.id === w.p2.id)?.judges, ["Dana R."], "the panel's judges follow the roster");

  assert.equal((await roster(ADMIN, "PATCH", { id: dana.id, name: "priya nair" })).status, 409);
  assert.equal((await roster(ADMIN, "PATCH", { id: dana.id, panelId: "00000000-0000-4000-8000-000000000000" })).status, 404);
  assert.equal((await roster(ADMIN, "PATCH", { id: "00000000-0000-4000-8000-000000000000", name: "X" })).status, 404);
  assert.equal((await roster(ADMIN, "PATCH", { name: "no id" })).status, 400);

  const off = await roster(ADMIN, "PATCH", { id: dana.id, panelId: null });
  assert.equal(off.body.judge.panel_id, null, "a null panel takes her off it");

  const gone = await roster(ADMIN, "DELETE", undefined, `?id=${dana.id}`);
  assert.deepEqual([gone.status, gone.body.removed, gone.body.conflictsRemoved], [200, true, 0]);
  assert.equal((await roster(ADMIN, "DELETE", undefined, `?id=${dana.id}`)).body.removed, false);
});

test("dryRun reports which teams would come off the panel and writes nothing; the real move takes them off", async () => {
  const w = await world();
  const tidy = await w.db.addJudge({ name: "Sam Okafor" });
  await conflictWith(w, w.priya, w.bolts); //  assigned to Panel 2
  await conflictWith(w, w.priya, w.loose); //  no panel, but a live request on Panel 2: not "taken off", nothing changes for it
  const waiting = await live(w, w.loose, w.p2);
  const before = await actions(w);

  const dry = await roster(ADMIN, "PATCH", { id: w.priya.id, panelId: w.p2.id, dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.dryRun, true);
  assert.deepEqual(dry.body.takenOff, ["7700B"], "only the team whose panel would be cleared; 1234's request is the Floor's to flag");
  assert.equal((await judgeNow(w, w.priya)).panel_id, null, "the judge did not move");
  assert.equal((await teamNow(w, w.bolts)).panel_id, w.p2.id, "no team came off");
  assert.deepEqual(await actions(w), before, "and nothing was logged");

  const real = await roster(ADMIN, "PATCH", { id: w.priya.id, panelId: w.p2.id });
  assert.equal(real.status, 200);
  assert.deepEqual(real.body.takenOff, ["7700B"]);
  assert.equal((await judgeNow(w, w.priya)).panel_id, w.p2.id);
  assert.equal((await teamNow(w, w.bolts)).panel_id, null, "7700B came off Panel 2 and needs a panel");
  assert.equal(
    (await w.db.findRequest(waiting.id))?.panel_id,
    w.p2.id,
    "a request already in flight stays where it is until the Judge Advisor moves it, as when a conflict is declared",
  );
  assert.equal((await teamNow(w, w.loose)).panel_id, null, "and its team was not touched, so it is not reported");

  // A judge without a conflict on anything brings nothing with them.
  const calm = await roster(ADMIN, "PATCH", { id: tidy.id, panelId: w.p2.id, dryRun: true });
  assert.deepEqual(calm.body.takenOff, []);
  // Moving to a panel that holds none of her teams takes nobody off; neither does staying put.
  assert.deepEqual((await roster(ADMIN, "PATCH", { id: w.priya.id, panelId: w.p3.id, dryRun: true })).body.takenOff, []);
  assert.deepEqual((await roster(ADMIN, "PATCH", { id: w.priya.id, panelId: w.p2.id })).body.takenOff, []);
});

/** Every team's panel, by number. */
const panelsOf = async (w: World) => Object.fromEntries((await w.db.listTeams()).map((t) => [t.number, t.panel_id]));
/** The numbers of the teams that had a panel before and have none now. */
const lost = (before: Record<string, string | null>, after: Record<string, string | null>) =>
  Object.keys(before).filter((n) => before[n] && !after[n]).sort();

test("takenOff is exactly the teams that lose their panel, the same on the judges PATCH, POST /api/conflicts and the panels PATCH", async () => {
  // Priya conflicts with all three teams, and Panel 2 is the one she joins. 7700B is assigned to Panel 2 and comes off it.
  // 9882K is assigned to Panel 1 and 1234 to nobody, but both have a live request on Panel 2: neither's panel changes.
  const conflictAll = async (w: World) => {
    for (const team of [w.hawks, w.bolts, w.loose]) await conflictWith(w, w.priya, team);
  };
  const ways: {
    name: string;
    setup: (w: World) => Promise<unknown>;
    run: (w: World, dryRun: boolean) => Promise<Reply>;
    hasDryRun: boolean;
  }[] = [
    {
      name: "judges PATCH",
      setup: conflictAll,
      run: (w, dryRun) => roster(ADMIN, "PATCH", { id: w.priya.id, panelId: w.p2.id, dryRun }),
      hasDryRun: true,
    },
    {
      name: "panels PATCH",
      setup: conflictAll,
      run: (w, dryRun) => hit(panelsRoute, "PATCH", ADMIN, "/api/admin/panels", { id: w.p2.id, judges: "Priya Nair", dryRun }),
      hasDryRun: true,
    },
    {
      name: "POST /api/conflicts",
      setup: (w) => w.db.updateJudge(w.priya.id, { panel_id: w.p2.id }),
      run: (w) => conflictsApi(ADMIN, "POST", { judgeId: w.priya.id, teamNumbers: "9882K, 7700B, 1234" }),
      hasDryRun: false,
    },
  ];

  for (const way of ways) {
    const w = await world();
    await live(w, w.hawks, w.p2);
    await live(w, w.loose, w.p2);
    await way.setup(w);
    const before = await panelsOf(w);
    assert.deepEqual(before, { "9882K": w.p1.id, "7700B": w.p2.id, "1234": null }, way.name);
    const requestsBefore = (await w.db.listRequests()).map((r) => [r.id, r.team_id, r.panel_id, r.status]);

    if (way.hasDryRun) {
      const dry = await way.run(w, true);
      assert.deepEqual(dry.body.takenOff, ["7700B"], `${way.name}: the dry run names only the team that would lose its panel`);
      assert.deepEqual(await panelsOf(w), before, `${way.name}: and writes nothing`);
    }

    const res = await way.run(w, false);
    assert.equal(res.status, 200, way.name);
    const after = await panelsOf(w);
    assert.deepEqual(res.body.takenOff, ["7700B"], way.name);
    assert.deepEqual(res.body.takenOff, lost(before, after), `${way.name}: what it reports is what changed`);
    assert.equal(after["9882K"], w.p1.id, `${way.name}: assigned elsewhere, so untouched`);
    assert.deepEqual(
      (await w.db.listRequests()).map((r) => [r.id, r.team_id, r.panel_id, r.status]),
      requestsBefore,
      `${way.name}: the live requests stay where they are`,
    );
  }
});

/* ===== POST /api/conflicts, the roster way ============================== */

test("recording a judge's conflicts: every number under one heading, and the judge's panel gives up what it held", async () => {
  const w = await world();
  await w.db.updateJudge(w.priya.id, { panel_id: w.p1.id }); // 9882K is on Panel 1

  const res = await conflictsApi(ADMIN, "POST", { judgeId: w.priya.id, teamNumbers: "9882K, 1234, 5555, 9882K", note: "ignored: two teams" });
  assert.equal(res.status, 200);
  assert.equal(res.body.judge.id, w.priya.id);
  assert.deepEqual(res.body.recorded, ["9882K", "1234"]);
  assert.deepEqual(res.body.unchanged, []);
  assert.deepEqual(res.body.notFound, ["5555"]);
  assert.deepEqual(res.body.takenOff, ["9882K"], "only the team Panel 1 held comes off");
  assert.equal((await teamNow(w, w.hawks)).panel_id, null);

  const rows = (await w.db.listConflicts()).filter((c) => c.judge_id === w.priya.id);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((c) => c.panel_id === null && c.judge_name === null), "a judge's conflict names the judge by id and writes no label");
  assert.ok(rows.every((c) => c.note === null), "a note belongs to one team, not to a list");
  assert.ok(rows.every((c) => c.declared_by === "admin:Judge Advisor"));

  const again = await conflictsApi(ADMIN, "POST", { judgeId: w.priya.id, teamNumbers: ["9882K", "7700B"] });
  assert.deepEqual([again.body.recorded, again.body.unchanged, again.body.takenOff], [["7700B"], ["9882K"], []]);

  const noted = await conflictsApi(ADMIN, "POST", { judgeId: w.priya.id, teamNumbers: "  ", note: "x" });
  assert.equal(noted.status, 400);
});

test("a note is kept when exactly one team is given", async () => {
  const w = await world();
  const res = await conflictsApi(ADMIN, "POST", { judgeId: w.priya.id, teamNumbers: "9882K", note: "  coaches them  " });
  assert.equal(res.status, 200);
  assert.equal((await w.db.listConflicts())[0].note, "coaches them");
});

test("a judge with no panel yet blocks nothing: no team comes off, and the block appears when they are put on a panel", async () => {
  const w = await world();
  const res = await conflictsApi(ADMIN, "POST", { judgeId: w.priya.id, teamNumbers: "9882K" });
  assert.deepEqual([res.body.recorded, res.body.takenOff], [["9882K"], []]);
  assert.equal((await teamNow(w, w.hawks)).panel_id, w.p1.id, "still on Panel 1");

  const dry = await roster(ADMIN, "PATCH", { id: w.priya.id, panelId: w.p1.id, dryRun: true });
  assert.deepEqual(dry.body.takenOff, ["9882K"], "putting her on Panel 1 is what would take it off");
});

test("a bad list is refused whole, an unknown judge is a 404, and a judge may record only for their own panel", async () => {
  const w = await world();
  await w.db.updateJudge(w.priya.id, { panel_id: w.p2.id });

  const spaced = await conflictsApi(ADMIN, "POST", { judgeId: w.priya.id, teamNumbers: "9882 K, 1234" });
  assert.equal(spaced.status, 400);
  assert.match(spaced.body.error, /Nothing was recorded/);
  assert.deepEqual(await w.db.listConflicts(), [], "not even the good number was kept");

  assert.equal((await conflictsApi(ADMIN, "POST", { judgeId: "nobody", teamNumbers: "1234" })).status, 404);

  assert.equal((await conflictsApi(judgeOf(w.p3), "POST", { judgeId: w.priya.id, teamNumbers: "1234" })).status, 403, "Panel 3 cannot record for Panel 2's judge");
  assert.equal((await conflictsApi(QUEUER, "POST", { judgeId: w.priya.id, teamNumbers: "1234" })).status, 403);
  assert.equal((await conflictsApi(null, "POST", { judgeId: w.priya.id, teamNumbers: "1234" })).status, 403);
  assert.deepEqual(await w.db.listConflicts(), []);

  await w.db.updateJudge(w.priya.id, { note: "coaches 9882K" });
  const own = await conflictsApi(judgeOf(w.p2), "POST", { judgeId: w.priya.id, teamNumbers: "1234" });
  assert.equal(own.status, 200, "a judge on Panel 2 may record for a colleague on Panel 2");
  assert.equal(own.body.judge.note, null, "but is not handed the Judge Advisor's note about her");
  const admin = await conflictsApi(ADMIN, "POST", { judgeId: w.priya.id, teamNumbers: "7700B" });
  assert.equal(admin.body.judge.note, "coaches 9882K");
});

test("only the Judge Advisor withdraws a conflict, and Panel 2 can judge the team again", async () => {
  const w = await world();
  await w.db.updateJudge(w.priya.id, { panel_id: w.p2.id });
  const c = await conflictWith(w, w.priya, w.hawks);
  const request = await live(w, w.hawks, w.p1);

  assert.equal((await conflictsApi(judgeOf(w.p2), "DELETE", undefined, `?id=${c.id}`)).status, 403);
  assert.equal((await reassign(ADMIN, request.id, w.p2.id)).status, 409);

  const res = await conflictsApi(ADMIN, "DELETE", undefined, `?id=${c.id}`);
  assert.deepEqual([res.status, res.body.removed], [200, true]);
  assert.equal((await reassign(ADMIN, request.id, w.p2.id)).status, 200);
});

test("the older whole-panel body still works, and a team a judge already blocks counts as already declared", async () => {
  const w = await world();

  const bulk = await conflictsApi(ADMIN, "POST", { panelId: w.p2.id, teamNumbers: "7700B, 5555", judgeName: "Old Name" });
  assert.deepEqual(
    [bulk.body.recorded, bulk.body.unchanged, bulk.body.notFound, bulk.body.unassigned, bulk.body.panel],
    [["7700B"], [], ["5555"], ["7700B"], "Panel 2"],
  );
  const legacy = (await w.db.listConflicts())[0];
  assert.deepEqual([legacy.panel_id, legacy.judge_id, legacy.judge_name], [w.p2.id, null, "Old Name"]);

  const single = await conflictsApi(ADMIN, "POST", { teamId: w.hawks.id, panelId: w.p1.id, judgeName: "Old", note: "n" });
  assert.deepEqual([single.status, single.body.unassigned, single.body.conflict.panel_id], [200, true, w.p1.id]);

  // A judge on Panel 3 already blocks 1234 there, so asking for the panel is nothing new.
  await w.db.updateJudge(w.priya.id, { panel_id: w.p3.id });
  await conflictWith(w, w.priya, w.loose);
  const again = await conflictsApi(ADMIN, "POST", { panelId: w.p3.id, teamNumbers: "1234" });
  assert.deepEqual([again.body.recorded, again.body.unchanged], [[], ["1234"]]);
});

test("a judge session reads only the conflicts that block their own panel", async () => {
  const w = await world();
  const sam = await w.db.addJudge({ name: "Sam Okafor" });
  await w.db.updateJudge(w.priya.id, { panel_id: w.p2.id });
  await w.db.updateJudge(sam.id, { panel_id: w.p3.id });
  const mine = await conflictWith(w, w.priya, w.hawks);
  await conflictWith(w, sam, w.bolts);

  assert.deepEqual((await conflictsApi(judgeOf(w.p2), "GET")).body.conflicts.map((c: ConflictRow) => c.id), [mine.id]);
  assert.equal((await conflictsApi(ADMIN, "GET")).body.conflicts.length, 2);
  assert.equal((await conflictsApi(QUEUER, "GET")).status, 403);

  await w.db.updateJudge(w.priya.id, { panel_id: null });
  assert.deepEqual((await conflictsApi(judgeOf(w.p2), "GET")).body.conflicts, [], "she left Panel 2, and so did what Panel 2 may see of her");
});

/* ===== the state each role is sent ====================================== */

test("AppState.judges goes to the Judge Advisor only; a judge sees just the conflicts on their panel and not the team", async () => {
  const w = await world();
  const { loadState } = await import("../src/lib/server-state");
  await w.db.updateJudge(w.priya.id, { panel_id: w.p2.id });
  const c = await conflictWith(w, w.priya, w.hawks);
  await w.db.updateTeam(w.hawks.id, { panel_id: w.p2.id });

  const admin = await loadState(ADMIN);
  assert.deepEqual(admin.judges.map((j) => j.name), ["Priya Nair"]);
  assert.equal(admin.conflicts.length, 1);

  for (const session of [null, QUEUER, REFEREE, judgeOf(w.p2), judgeOf(w.p3)]) {
    assert.deepEqual((await loadState(session)).judges, [], `${session?.role ?? "nobody"} is sent no roster`);
  }
  for (const session of [null, QUEUER, REFEREE]) {
    assert.deepEqual((await loadState(session)).conflicts, [], "nor any conflicts");
  }

  const inside = await loadState(judgeOf(w.p2));
  assert.deepEqual(inside.conflicts.map((x) => x.id), [c.id]);
  assert.ok(!inside.teams.some((t) => t.id === w.hawks.id), "a conflicted team is not there to be worked on");
  const outside = await loadState(judgeOf(w.p3));
  assert.deepEqual(outside.conflicts, [], "another panel sees nothing of it");
  assert.ok(outside.teams.some((t) => t.id === w.hawks.id));

  // Take the judge off the panel and the team is back for Panel 2.
  await w.db.updateJudge(w.priya.id, { panel_id: null });
  assert.ok((await loadState(judgeOf(w.p2))).teams.some((t) => t.id === w.hawks.id));
});

/* ===== the Panels tab's judges field ==================================== */

test("saving a panel's judges finds or adds each name on the roster, reports takenOff, and honours dryRun", async () => {
  const w = await world();
  await conflictWith(w, w.priya, w.bolts); // 7700B is on Panel 2

  const save = (body: Record<string, unknown>, session: Session | null = ADMIN) =>
    hit(panelsRoute, "PATCH", session, "/api/admin/panels", { id: w.p2.id, ...body });

  assert.equal((await save({ judges: "Priya Nair" }, judgeOf(w.p2))).status, 403);
  assert.equal((await save({ judges: "Priya Nair" }, QUEUER)).status, 403);

  const dry = await save({ judges: "priya nair, Newcomer", dryRun: true });
  assert.deepEqual([dry.status, dry.body.takenOff, dry.body.dryRun], [200, ["7700B"], true]);
  assert.deepEqual((await w.db.listJudges()).map((j) => j.name), ["Priya Nair"], "no one was added");
  assert.equal((await teamNow(w, w.bolts)).panel_id, w.p2.id);

  const real = await save({ judges: "priya nair, Newcomer" });
  assert.equal(real.status, 200);
  assert.deepEqual(real.body.takenOff, ["7700B"]);
  assert.deepEqual(real.body.panel.judges, ["Priya Nair", "Newcomer"], "found by name ignoring case, the other added");
  assert.equal((await w.db.listJudges()).length, 2, "Priya was not added a second time");
  assert.equal((await teamNow(w, w.bolts)).panel_id, null);

  const without = await save({ name: "Panel Two" });
  assert.deepEqual([without.status, without.body.takenOff, without.body.panel.judges], [200, [], ["Priya Nair", "Newcomer"]]);

  const cleared = await save({ judges: "" });
  assert.deepEqual(cleared.body.panel.judges, []);
  assert.equal((await w.db.listJudges()).length, 2, "they left the panel, not the roster");

  assert.equal((await hit(panelsRoute, "PATCH", ADMIN, "/api/admin/panels", { id: "00000000-0000-4000-8000-000000000000", judges: "A", dryRun: true })).status, 404);
});

/* ===== the activity log ================================================= */

test("roster and conflict changes are logged with who, which judge, and which teams", async () => {
  const w = await world();
  const dana = (await roster(ADMIN, "POST", { name: "Dana Ruiz" })).body.judge as JudgeRow;
  await roster(ADMIN, "PATCH", { id: dana.id, name: "Dana R." });
  await roster(ADMIN, "PATCH", { id: dana.id, panelId: w.p1.id });
  await conflictsApi(ADMIN, "POST", { judgeId: dana.id, teamNumbers: "9882K, 7700B" });
  const [c] = (await w.db.listConflicts()).filter((x) => x.team_id === w.hawks.id);
  await conflictsApi(ADMIN, "DELETE", undefined, `?id=${c.id}`);
  await roster(ADMIN, "DELETE", undefined, `?id=${dana.id}`);

  const log = await w.db.listActivity();
  const entry = (action: string) => log.find((a) => a.action === action);
  assert.equal(entry("added a judge")?.detail, "Dana Ruiz");
  assert.equal(entry("renamed a judge")?.detail, "Dana Ruiz → Dana R.");
  assert.equal(entry("moved a judge")?.detail, "Dana R. → Panel 1");
  assert.match(entry("declared conflicts of interest")?.detail ?? "", /^Dana R\. \(Panel 1\) · 9882K, 7700B · taken off the panel: 9882K$/);
  assert.match(entry("withdrew a conflict of interest")?.detail ?? "", /^Team 9882K · Dana R\.$/);
  assert.match(entry("removed a judge")?.detail ?? "", /^Dana R\. · 1 conflict withdrawn with them$/);
  assert.ok(log.every((a) => a.actor === "Judge Advisor" && a.actor_role === "Judge Advisor"), "who is recorded: the name and the role");
  assert.deepEqual(log.map((a) => [a.action, a.kind]).sort(), [
    ["added a judge", "setup"],
    ["declared conflicts of interest", "conflict"],
    ["moved a judge", "setup"],
    ["removed a judge", "setup"],
    ["renamed a judge", "setup"],
    ["withdrew a conflict of interest", "conflict"],
  ]);
});

test("removing a judge removes their conflicts and says how many", async () => {
  const w = await world();
  const sam = await w.db.addJudge({ name: "Sam Okafor" });
  await w.db.updateJudge(w.priya.id, { panel_id: w.p2.id });
  await conflictWith(w, w.priya, w.hawks);
  await conflictWith(w, w.priya, w.bolts);
  const stays = await conflictWith(w, sam, w.hawks);

  const res = await roster(ADMIN, "DELETE", undefined, `?id=${w.priya.id}`);
  assert.deepEqual([res.body.removed, res.body.conflictsRemoved], [true, 2]);
  assert.deepEqual((await w.db.listConflicts()).map((c) => c.id), [stays.id]);
  assert.ok(!(await actions(w)).includes("withdrew a conflict of interest"), "removal is logged as the judge's, once");
});

/* ===== the Panels tab's Delete panel and Delete all ===================== */

test("Delete panel through the route leaves its judges on the roster with no panel, and keeps their conflicts", async () => {
  const w = await world();
  const sam = await w.db.addJudge({ name: "Sam Okafor" });
  await w.db.updateJudge(w.priya.id, { panel_id: w.p2.id });
  await w.db.updateJudge(sam.id, { panel_id: w.p2.id });
  const keeps = await conflictWith(w, w.priya, w.hawks);
  const legacy = await w.db.addConflict({ panelId: w.p2.id, teamId: w.loose.id, judgeName: null, note: null, declaredBy: "admin:JA" });

  assert.equal((await hit(panelsRoute, "DELETE", QUEUER, `/api/admin/panels?id=${w.p2.id}`)).status, 403, "the Judge Advisor's alone");
  assert.equal((await w.db.listPanels()).length, 3);

  const res = await hit(panelsRoute, "DELETE", ADMIN, `/api/admin/panels?id=${w.p2.id}`);
  assert.deepEqual([res.status, res.body.deleted], [200, 1]);

  assert.deepEqual((await w.db.listPanels()).map((p) => p.id), [w.p1.id, w.p3.id], "only that panel went");
  const judges = await w.db.listJudges();
  assert.deepEqual(judges.map((j) => j.name).sort(), ["Priya Nair", "Sam Okafor"], "the judges are still on the roster");
  assert.deepEqual(judges.map((j) => j.panel_id), [null, null], "on no panel");
  const left = (await w.db.listConflicts()).map((c) => c.id);
  assert.ok(left.includes(keeps.id), "a judge's conflict stays with the judge");
  assert.ok(!left.includes(legacy.id), "a whole-panel conflict named a panel that is gone");
  // With no panel the judge blocks nobody until they are put on one again.
  const reassign = await roster(ADMIN, "PATCH", { id: w.priya.id, panelId: w.p3.id, dryRun: true });
  assert.deepEqual(reassign.body.takenOff, [], "no team is held by Panel 3 that Priya's conflict names");
  assert.ok((await actions(w)).every((a) => a !== "removed a judge"), "no judge was removed");
});

test("Delete all panels through the route clears the panels and leaves every judge on the roster, on none", async () => {
  const w = await world();
  await w.db.updateJudge(w.priya.id, { panel_id: w.p1.id });
  const keeps = await conflictWith(w, w.priya, w.bolts);

  const res = await hit(panelsRoute, "DELETE", ADMIN, "/api/admin/panels?all=true");
  assert.deepEqual([res.status, res.body.deleted], [200, 3]);
  assert.deepEqual(await w.db.listPanels(), []);
  assert.deepEqual((await w.db.listJudges()).map((j) => [j.name, j.panel_id]), [["Priya Nair", null]]);
  assert.deepEqual((await w.db.listConflicts()).map((c) => c.id), [keeps.id]);
  assert.equal((await teamNow(w, w.hawks)).panel_id, null, "teams stay, unassigned");
});
