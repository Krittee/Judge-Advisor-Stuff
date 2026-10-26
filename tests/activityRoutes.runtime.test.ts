import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

import type { Session } from "../src/lib/auth";
import type { Panel, Team } from "../src/lib/types";

/* What the routes write to the activity log: each entry's kind, the actor's
   plain name and role, the team number it joins, and the things that used to
   leave no trace at all. Driven through the REAL route handlers against the
   real file store -- the same harness as judgeRoutes.runtime.test.ts (see
   requestWorkflow.runtime.test.ts for why the request scope is built by hand). */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-activity-routes-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "activity-routes-test-secret-0123456789";
delete process.env.DATABASE_URL;
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

const ES = "Elementary School";

const ADMIN: Session = { role: "admin", name: "Alex" };
const QUEUER: Session = { role: "queuer", name: "Desk" };

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
type Handlers = Record<string, (request: Request, context?: unknown) => Promise<Response>>;

async function hit(
  load: () => Promise<unknown>,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  session: Session | null,
  path: string,
  body?: unknown,
  context?: unknown,
): Promise<Reply> {
  const handlers = (await load()) as Handlers;
  const request = new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await inRequestScope(session, () => handlers[method](request, context));
  return { status: res.status, body: await res.json() };
}

const panelsRoute = () => import("../src/app/api/admin/panels/route");
const teamsRoute = () => import("../src/app/api/admin/teams/route");
const flagsRoute = () => import("../src/app/api/flags/route");
const conflictsRoute = () => import("../src/app/api/conflicts/route");
const requestsRoute = () => import("../src/app/api/requests/route");
const requestRoute = () => import("../src/app/api/requests/[id]/route");

const panels = (session: Session | null, method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown, query = "") =>
  hit(panelsRoute, method, session, `/api/admin/panels${query}`, body);
const teams = (session: Session | null, method: "POST" | "PATCH" | "DELETE", body?: unknown, query = "") =>
  hit(teamsRoute, method, session, `/api/admin/teams${query}`, body);
const patchRequest = (session: Session | null, id: string, body: unknown) =>
  hit(requestRoute, "PATCH", session, `/api/requests/${id}`, body, { params: Promise.resolve({ id }) });

const store = async () => (await import("../src/lib/db/file")).fileStore;

/** A clean event: Panel 1 (ES) holding team 9882K. */
async function world() {
  const db = await store();
  await db.resetAll();
  const p1 = await db.createPanel({
    name: "Panel 1",
    code: "AR1001",
    division: ES,
    judges: [],
    languages: [],
    sort_order: 1,
    slot_start_at: null,
    slot_minutes: 20,
    slot_count: 0,
  });
  await db.upsertTeams([{ number: "9882K", name: "Hawks", pit: null, division: ES, category: "developing" }]);
  const hawks = (await db.listTeams())[0] as Team;
  await db.updateTeam(hawks.id, { panel_id: p1.id });
  return { db, p1, hawks: { ...hawks, panel_id: p1.id } as Team };
}

/** Every entry, oldest first, as [kind, action] pairs unless asked for whole rows. */
const log = async (db: Awaited<ReturnType<typeof store>>) => (await db.listActivity()).reverse();
const lines = async (db: Awaited<ReturnType<typeof store>>) => (await log(db)).map((a) => [a.kind, a.action]);

/* ===== kind, name, role, team number ==================================== */

test("an entry carries its kind, the actor's plain name and role, and the number of the team it names", async () => {
  const { db } = await world();

  const made = await hit(requestsRoute, "POST", QUEUER, "/api/requests", { teamNumber: "9882K" });
  assert.equal(made.status, 200);
  const requestId = made.body.request.id as string;
  assert.equal((await patchRequest(QUEUER, requestId, { action: "cancel" })).status, 200);
  assert.equal((await patchRequest(ADMIN, requestId, { action: "reopen" })).status, 200);

  const [joined, cancelled, reopened] = await log(db);
  assert.deepEqual(
    [joined.kind, joined.actor, joined.actor_role, joined.team_number, joined.request_id],
    ["request", "Desk", "Front desk", "9882K", requestId],
  );
  assert.deepEqual([cancelled.kind, cancelled.actor, cancelled.actor_role], ["request", "Desk", "Front desk"]);
  assert.deepEqual(
    [reopened.kind, reopened.actor, reopened.actor_role, reopened.team_number],
    ["request", "Alex", "Judge Advisor", "9882K"],
  );

  // An entry that names no team joins no number.
  await panels(ADMIN, "POST", { name: "Panel 2", division: ES });
  const added = (await db.listActivity()).find((a) => a.action === "added a panel");
  assert.deepEqual([added?.team_id, added?.team_number, added?.actor, added?.actor_role], [null, null, "Alex", "Judge Advisor"]);
});

/* ===== what was logged before: kind and role only ======================= */

test("the Judge Advisor's status override is one request entry, and withdrawing a conflict is one conflict entry", async () => {
  const { db, p1, hawks } = await world();
  const request = await db.createRequest({ teamId: hawks.id, panelId: p1.id, kind: "queue", createdBy: "team", language: "en" });

  const set = await patchRequest(ADMIN, request.id, { action: "set-status", status: "completed" });
  assert.equal(set.status, 200);
  const [override] = await log(db);
  assert.deepEqual(
    [await lines(db), override.actor, override.actor_role, override.team_number],
    [[["request", "→ Interview complete"]], "Alex", "Judge Advisor", "9882K"],
  );

  await db.resetDay();
  const judge = await db.addJudge({ name: "Dana Ruiz" });
  const conflict = await db.addConflict({ judgeId: judge.id, teamId: hawks.id, note: null, declaredBy: "admin:Alex" });
  const gone = await hit(conflictsRoute, "DELETE", ADMIN, `/api/conflicts?id=${conflict.id}`);
  assert.equal(gone.status, 200);
  assert.deepEqual(await lines(db), [["conflict", "withdrew a conflict of interest"]]);
  assert.equal((await log(db))[0].team_number, "9882K");
});

/* ===== removing a flag ================================================== */

test("removing a flag is logged once, as a referee entry naming the team; nothing is logged when nothing went", async () => {
  const { db, hawks } = await world();
  const flag = await db.createFlag({
    teamId: hawks.id,
    kind: "minor",
    body: "",
    author: "Jordan",
    matchType: "Q",
    matchNumber: "19",
    field: "2",
    rule: "SG6",
    ruleset: "viqrc",
    manualVersion: null,
    matchAffecting: false,
  });
  const remove = (session: Session | null, id: string) => hit(flagsRoute, "DELETE", session, `/api/flags?id=${id}`);

  assert.equal((await remove(QUEUER, flag.id)).status, 403);
  assert.deepEqual(await lines(db), [], "a refused removal leaves no trace");

  assert.equal((await remove(ADMIN, flag.id)).body.removed, true);
  const entries = await log(db);
  assert.deepEqual(entries.map((a) => [a.kind, a.action]), [["referee", "removed a flag: minor"]]);
  assert.match(entries[0].detail ?? "", /^Team 9882K · /);
  assert.deepEqual([entries[0].actor, entries[0].actor_role, entries[0].team_number], ["Alex", "Judge Advisor", "9882K"]);

  assert.equal((await remove(ADMIN, flag.id)).body.removed, false);
  assert.equal((await log(db)).length, 1, "removing what is already gone logs nothing");
});

/* ===== panels =========================================================== */

test("panel add, edit, delete and delete-all each write one setup entry, and only when something happened", async () => {
  const { db } = await world();

  const made = await panels(ADMIN, "POST", { name: "Panel 2", division: ES });
  assert.equal(made.status, 200);
  const p2 = made.body.panel as Panel;
  assert.deepEqual(await lines(db), [["setup", "added a panel"]]);
  assert.equal((await log(db))[0].detail, `Panel 2 · ${ES}`);

  await db.resetDay();
  assert.equal((await panels(ADMIN, "PATCH", { id: p2.id, name: "Panel Two", slotMinutes: 15 })).status, 200);
  const edit = await log(db);
  assert.deepEqual(edit.map((a) => [a.kind, a.action, a.detail]), [["setup", "edited a panel", "Panel Two · name, slot minutes"]]);

  await db.resetDay();
  await panels(ADMIN, "PATCH", { id: p2.id, name: "Panel Two", slotMinutes: 15 });
  assert.deepEqual(await lines(db), [], "saving what is already there is not an edit");

  // The judges field is the roster's: it logs its own lines and is not also "an edit".
  await panels(ADMIN, "PATCH", { id: p2.id, judges: "Dana Ruiz" });
  assert.deepEqual(await lines(db), [["setup", "added a judge"]]);

  await db.resetDay();
  assert.equal((await panels(ADMIN, "DELETE", undefined, "?id=00000000-0000-4000-8000-000000000000")).status, 200);
  assert.deepEqual(await lines(db), [], "deleting a panel that is not there logs nothing");
  await panels(ADMIN, "DELETE", undefined, `?id=${p2.id}`);
  assert.deepEqual(await lines(db), [["setup", "deleted a panel"]]);
  assert.equal((await log(db))[0].detail, "Panel Two");

  await db.resetDay();
  assert.equal((await panels(ADMIN, "PUT")).body.created, 0, "this fixture has no preset panels");
  assert.deepEqual(await lines(db), [], "seeding nothing logs nothing");
  await panels(ADMIN, "DELETE", undefined, "?all=true");
  assert.deepEqual(await lines(db), [["setup", "deleted all panels"]]);
  assert.equal((await log(db))[0].detail, "1 panel");
  await panels(ADMIN, "DELETE", undefined, "?all=true");
  assert.equal((await log(db)).length, 1, "with no panels left there is nothing to delete or log");

  for (const a of await log(db)) assert.deepEqual([a.actor, a.actor_role], ["Alex", "Judge Advisor"]);
});

/* ===== teams ============================================================ */

test("team import, edit and remove each write one setup entry; the team's number rides along", async () => {
  const { db, hawks } = await world();

  const imported = await teams(ADMIN, "POST", { text: "9882K, Hawks\n1111, Alpha\n2222, Beta" });
  assert.equal(imported.status, 200);
  assert.deepEqual(await lines(db), [["setup", "imported teams"]]);
  assert.equal((await log(db))[0].detail, "3 teams · 2 new");

  await db.resetDay();
  assert.equal((await teams(ADMIN, "PATCH", { teamId: hawks.id, name: "Falcons", pit: "A4" })).status, 200);
  const edit = await log(db);
  assert.deepEqual(edit.map((a) => [a.kind, a.action, a.detail, a.team_number]), [
    ["setup", "edited a team", "Team 9882K · pit, name", "9882K"],
  ]);

  await db.resetDay();
  await teams(ADMIN, "PATCH", { teamId: hawks.id, name: "Falcons" });
  assert.deepEqual(await lines(db), [], "saving what is already there is not an edit");

  await teams(ADMIN, "DELETE", undefined, `?teamId=${hawks.id}`);
  const removed = await log(db);
  assert.deepEqual(removed.map((a) => [a.kind, a.action, a.detail, a.team_id, a.team_number]), [
    ["setup", "removed a team", "Team 9882K · Falcons", null, null],
  ]);

  assert.equal((await teams(QUEUER, "POST", { text: "3333, Gamma" })).status, 403);
  assert.equal((await log(db)).length, 1, "a refused import leaves no trace");
});

/* ===== reset day, wipe ================================================== */

test("reset day and wipe clear the log, then write the first entry of what follows", async () => {
  const { db } = await world();
  for (const action of ["one", "two", "three"]) {
    await db.logActivity({ kind: "setup", actor: "Alex", actorRole: "Judge Advisor", action });
  }

  assert.equal((await teams(QUEUER, "PATCH", { action: "resetDay" })).status, 403);
  assert.equal((await log(db)).length, 3, "a refused reset changes nothing");

  assert.equal((await teams(ADMIN, "PATCH", { action: "resetDay" })).status, 200);
  const day = await log(db);
  assert.deepEqual(day.map((a) => [a.kind, a.action, a.actor, a.actor_role]), [
    ["setup", "reset the day", "Alex", "Judge Advisor"],
  ]);
  assert.equal((await db.listTeams()).length, 1, "the roster survives a day reset");

  assert.equal((await teams(ADMIN, "PATCH", { action: "resetAll" })).status, 200);
  const wipe = await log(db);
  assert.deepEqual(wipe.map((a) => [a.kind, a.action]), [["setup", "wiped everything"]]);
  assert.deepEqual([(await db.listTeams()).length, (await db.listPanels()).length], [0, 0]);
});
