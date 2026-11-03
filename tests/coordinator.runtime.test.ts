import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

import type { Session } from "../src/lib/auth";
import type { AppState, Panel, Team } from "../src/lib/types";

/* The coordinator walks the pits and may do exactly four things: set a team's
   interview language, request a judge now, book a slot, and see the board.
   Everything else must be refused, so this drives the REAL route handlers
   against the real file store -- the same harness as requestWorkflow.runtime.test.ts
   (Next's own AsyncLocalStorages entered with a signed session cookie), so a
   Next upgrade that moves those internals breaks both files in the same way.
   Env and the global are set before anything imports the store or Next. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-coordinator-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "coordinator-test-secret-0123456789";
delete process.env.DATABASE_URL;
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

const ES = "Elementary School";

const COORD: Session = { role: "coordinator", name: "Pat" };
const ADMIN: Session = { role: "admin", name: "Judge Advisor" };
const QUEUER: Session = { role: "queuer", name: "Desk" };
const REFEREE: Session = { role: "referee", name: "Ref" };
const HEAD_REFEREE: Session = { role: "referee", name: "Head", head: true };
const judgeOf = (panel: Panel): Session => ({ role: "judge", name: "Amy", panelId: panel.id, panelName: panel.name });

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
    const panel = session.role === "judge"
      ? await (await import("../src/lib/db/file")).fileStore.findPanelById(session.panelId)
      : null;
    if (session.role === "judge") assert.ok(panel);
    const judgeClaims = panel ? {
      panelAuth: createHmac("sha256", process.env.SESSION_SECRET!)
        .update(panel.id).update("\0").update(panel.code.toUpperCase()).digest("hex"),
      judgeDay: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    } : {};
    const token = await new SignJWT({ ...session, ...judgeClaims })
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each route has its own reply shape
type Reply = { status: number; body: any };
type Handler = (request: Request, context?: unknown) => Promise<Response>;

/** Call one exported handler of an API route, as `session`. A missing handler is a test failure. */
async function call(session: Session | null, route: string, method: string, body: unknown = {}, query = ""): Promise<Reply> {
  const routeModule = (await import(`../src/app/api/${route}/route`)) as Record<string, Handler | undefined>;
  const handler = routeModule[method];
  assert.ok(handler, `${route} has no ${method}`);
  const id = (body as { id?: string }).id ?? "x";
  const request = new Request(`http://localhost/api/${route}${query}`, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  const res = await inRequestScope(session, () => handler(request, { params: Promise.resolve({ id }) }));
  return { status: res.status, body: await res.json() };
}

/* ---- the fixture ------------------------------------------------------- */

const store = async () => (await import("../src/lib/db/file")).fileStore;

function slotOf(panel: Panel, k: number) {
  const start = new Date(new Date(panel.slot_start_at!).getTime() + k * panel.slot_minutes * 60_000);
  const end = new Date(start.getTime() + panel.slot_minutes * 60_000);
  return { slotStart: start.toISOString(), slotEnd: end.toISOString() };
}

/** Two panels in one division with one team each; slots 0-8 are over, 9 onward are still to come. */
async function world() {
  const db = await store();
  await db.resetAll();
  const start = new Date(Date.now() - (3 * 60 + 5) * 60_000).toISOString();
  const mk = (name: string, code: string) =>
    db.createPanel({
      name, code, division: ES, judges: [], languages: [], sort_order: 1,
      slot_start_at: start, slot_minutes: 20, slot_count: 18,
    });
  const [panelA, panelB] = [await mk("Panel A", "COA001"), await mk("Panel B", "COB001")];
  await db.upsertTeams(
    ["1001", "1002"].map((number) => ({ number, name: `Team ${number}`, pit: "Pit 3", division: ES, category: "developing" })),
  );
  const teams = await db.listTeams();
  const team = (n: string) => teams.find((t) => t.number === n) as Team;
  await db.updateTeam(team("1001").id, { panel_id: panelA.id });
  await db.updateTeam(team("1002").id, { panel_id: panelB.id });
  return { db, panelA, panelB, t1: team("1001"), t2: team("1002") };
}

type World = Awaited<ReturnType<typeof world>>;

/** Everything the store holds that a refused call could have touched. */
async function snapshot({ db }: World) {
  return JSON.stringify([
    await db.listTeams(), await db.listPanels(), await db.listRequests(), await db.listActivity(),
    await db.listJudges(), await db.listConflicts(), await db.listFlags(), await db.listNotes(),
    await db.listScores(), await db.listNominations(), await db.listWinners(), await db.getRefereeSetup(),
  ]);
}

const teamNow = async (w: World, id: string) => (await w.db.listTeams()).find((t) => t.id === id) as Team;

/* ===== 1. set a team's interview language =============================== */

test("a coordinator sets a team's language, then changes it, then clears it; only `languages` moves", async () => {
  const w = await world();
  const before = await teamNow(w, w.t1.id);
  const hostile = { number: "9999", name: "Renamed", pit: "Pit 99", division: "High School", category: "fully-developed", panel_id: null };

  for (const [sent, stored] of [[["en", "th"], ["en", "th"]], [["th"], ["th"]], [[], []]] as const) {
    const reply = await call(COORD, "team-language", "PATCH", { teamId: w.t1.id, languages: sent, ...hostile });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body.team.languages, stored);

    const after = await teamNow(w, w.t1.id);
    assert.deepEqual(after.languages, stored);
    for (const field of ["number", "name", "pit", "division", "category", "panel_id"] as const) {
      assert.equal(after[field], before[field], `${field} was changed through the language route`);
    }
  }
});

test("free text is understood and unrecognised words are dropped", async () => {
  const w = await world();
  assert.deepEqual((await call(COORD, "team-language", "PATCH", { teamId: w.t1.id, languages: "both" })).body.team.languages, ["en", "th"]);
  assert.deepEqual((await call(COORD, "team-language", "PATCH", { teamId: w.t1.id, languages: "Thai, Klingon" })).body.team.languages, ["th"]);
});

test("setting a language is logged as the Coordinator, and an unchanged value is not", async () => {
  const w = await world();
  await call(COORD, "team-language", "PATCH", { teamId: w.t1.id, languages: ["en", "th"] });
  await call(COORD, "team-language", "PATCH", { teamId: w.t1.id, languages: ["en", "th"] }); // same again
  await call(COORD, "team-language", "PATCH", { teamId: w.t1.id, languages: [] });

  const log = await w.db.listActivity();
  assert.equal(log.length, 2);
  assert.ok(log.every((e) => e.actor_role === "Coordinator" && e.actor === "Pat" && e.kind === "setup" && e.team_id === w.t1.id));
  const details = log.map((e) => e.detail).sort();
  assert.deepEqual(details, ["Team 1001 · EN + TH", "Team 1001 · not stated"]);
  assert.ok(log.every((e) => e.action === "set interview language"));
});

test("the Judge Advisor can set a language too; nobody else can, and nothing changes", async () => {
  const w = await world();
  assert.equal((await call(ADMIN, "team-language", "PATCH", { teamId: w.t1.id, languages: ["th"] })).status, 200);
  const held = await snapshot(w);
  for (const session of [QUEUER, judgeOf(w.panelA), REFEREE, HEAD_REFEREE, null]) {
    const reply = await call(session, "team-language", "PATCH", { teamId: w.t1.id, languages: ["en"] });
    assert.equal(reply.status, 403, JSON.stringify(session));
    assert.match(reply.body.error, /Only a coordinator or the Judge Advisor/);
  }
  assert.equal(await snapshot(w), held);
});

test("a language request needs a team that exists", async () => {
  await world();
  assert.equal((await call(COORD, "team-language", "PATCH", { languages: ["en"] })).status, 400);
  assert.equal((await call(COORD, "team-language", "PATCH", { teamId: "nope", languages: ["en"] })).status, 404);
});

test("the language route answers PATCH and nothing else", async () => {
  const routeModule = await import("../src/app/api/team-language/route");
  for (const method of ["GET", "POST", "PUT", "DELETE"]) {
    assert.equal((routeModule as Record<string, unknown>)[method], undefined, method);
  }
  assert.equal(typeof routeModule.PATCH, "function");
});

/* ===== 2. request a judge now, 3. book a slot ============================ */

test("a coordinator can request a judge now and book a slot, recorded as coordinator:Pat", async () => {
  const w = await world();
  const queued = await call(COORD, "requests", "POST", { teamNumber: "1001", kind: "queue", message: "Needs a Thai-speaking judge" });
  assert.equal(queued.status, 200);
  assert.equal(queued.body.request.kind, "queue");
  assert.equal(queued.body.request.status, "requested");
  assert.equal(queued.body.request.created_by, "coordinator:Pat");

  const booked = await call(COORD, "requests", "POST", { teamNumber: "1002", kind: "slot", ...slotOf(w.panelB, 12) });
  assert.equal(booked.status, 200);
  assert.equal(booked.body.request.kind, "slot");
  assert.equal(booked.body.request.status, "scheduled");
  assert.equal(booked.body.request.created_by, "coordinator:Pat");
});

test("the booking language: the team's first, else the default; an explicit one wins", async () => {
  const w = await world();
  const ask = async (languages: string[], language?: unknown) => {
    await w.db.resetDay();
    await w.db.updateTeam(w.t1.id, { languages });
    const reply = await call(COORD, "requests", "POST", { teamNumber: "1001", kind: "queue", language });
    assert.equal(reply.status, 200);
    return reply.body.request.language;
  };
  assert.equal(await ask(["th"]), "th");
  assert.equal(await ask(["en", "th"]), "en");
  assert.equal(await ask([]), "en", "the event default");
  assert.equal(await ask(["en"], "th"), "th", "an explicit language wins");
  assert.equal(await ask(["th"], ""), "th", "a blank one is not an answer");
  assert.equal(await ask(["th"], "klingon"), "th", "nor is one we do not know");
});

/* ===== 4. see the board ================================================== */

test("a coordinator sees every team, slot and request, with messages, and none of the private lists", async () => {
  const w = await world();
  await w.db.createRequest({ teamId: w.t1.id, panelId: w.panelA.id, kind: "queue", message: "Needs a ramp", createdBy: "team", language: "en" });
  await w.db.createRequest({ teamId: w.t2.id, panelId: w.panelB.id, kind: "slot", createdBy: "team", language: "en", ...slotOf(w.panelB, 12) });
  // Private data that exists, so "empty" below means withheld rather than absent.
  const judge = await w.db.addJudge({ name: "Judge Joe" });
  await w.db.addConflict({ judgeId: judge.id, teamId: w.t1.id, note: "cousin", declaredBy: "admin:JA" });
  await w.db.createFlag({
    teamId: w.t1.id, kind: "warning", body: "x", author: "Ref", matchType: "Q", matchNumber: "1", field: "1",
    rule: null, ruleset: null, manualVersion: null, matchAffecting: false,
  });

  const reply = await call(COORD, "state", "GET");
  assert.equal(reply.status, 200);
  const state = reply.body as AppState;
  assert.deepEqual(state.teams.map((t) => t.number).sort(), ["1001", "1002"]);
  assert.equal(state.panels.length, 2);
  assert.equal(state.requests.length, 2);
  assert.ok(state.requests.some((r) => r.message === "Needs a ramp"));
  assert.ok(state.requests.some((r) => r.kind === "slot" && r.slot_start));
  assert.deepEqual([state.conflicts, state.judges, state.flags], [[], [], []]);

  assert.equal(state.viewer.role, "coordinator");
  assert.equal(state.viewer.name, "Pat");
  assert.equal(state.viewer.canSetTeamLanguage, true);
  for (const can of ["canAdminister", "canAdvance", "canReadNotes", "canFlag", "canReadFlags"] as const) {
    assert.equal(state.viewer[can], false, can);
  }
  // Only the coordinator and the Judge Advisor are offered the language control.
  for (const [session, expected] of [[ADMIN, true], [QUEUER, false], [REFEREE, false], [null, false]] as const) {
    assert.equal((await call(session, "state", "GET")).body.viewer.canSetTeamLanguage, expected);
  }
});

/* ===== everything else is refused ======================================== */

const ACTIONS: [string, Record<string, unknown>][] = [
  ["advance", {}],
  ["set-status", { status: "acknowledged" }],
  ["cancel", {}],
  ["reschedule", {}],
  ["ready-now", {}],
  ["reassign", {}],
  ["reopen", {}],
  ["set-times", { times: {} }],
];

test("no action on an existing request is open to a coordinator, whether it is requested or scheduled", async () => {
  const w = await world();
  const requested = await w.db.createRequest({ teamId: w.t1.id, panelId: w.panelA.id, kind: "queue", createdBy: "team", language: "en" });
  const scheduled = await w.db.createRequest({ teamId: w.t2.id, panelId: w.panelB.id, kind: "slot", createdBy: "team", language: "en", ...slotOf(w.panelB, 12) });
  const held = await snapshot(w);

  for (const request of [requested, scheduled]) {
    for (const [action, extra] of ACTIONS) {
      const body = { action, ...extra, ...slotOf(w.panelB, 13), panelId: w.panelB.id, id: request.id };
      const reply = await call(COORD, "requests/[id]", "PATCH", body);
      assert.equal(reply.status, 403, `${action} on a ${request.status} request`);
      assert.equal(reply.body.request, undefined);
    }
  }
  assert.equal(await snapshot(w), held);
});

/** Every other handler a coordinator might reach for. The gates run before the body is read. */
const REFUSED: { route: string; method: string; body?: unknown; query?: string }[] = [
  ...["GET", "POST", "PATCH", "PUT", "DELETE"].map((method) => ({ route: "admin/panels", method })),
  ...["GET", "POST", "PATCH", "DELETE"].map((method) => ({ route: "admin/judges", method })),
  ...["POST", "PATCH", "DELETE"].map((method) => ({ route: "admin/teams", method, query: "?teamId=x" })),
  { route: "admin/teams", method: "PATCH", body: { action: "resetAll" } },
  { route: "admin/teams", method: "PATCH", body: { action: "resetDay" } },
  { route: "admin/teams", method: "PATCH", body: { teamId: "x", languages: ["th"] } },
  { route: "admin/activity", method: "GET" },
  ...["GET", "POST"].map((method) => ({ route: "notes", method })),
  ...["GET", "POST", "DELETE"].map((method) => ({ route: "scores", method })),
  ...["GET", "POST", "DELETE"].map((method) => ({ route: "conflicts", method })),
  ...["GET", "POST", "PATCH", "DELETE"].map((method) => ({ route: "flags", method })),
  ...["GET", "POST", "DELETE"].map((method) => ({ route: "awards", method })),
  ...["PUT", "DELETE"].map((method) => ({ route: "awards/winners", method })),
  { route: "referee-setup", method: "PUT", body: { ruleset: "viqrc", fieldCount: 3 } },
];

test("a coordinator is refused every admin, notes, scores, conflicts, flags, awards and referee-setup handler", async () => {
  const w = await world();
  const held = await snapshot(w);
  const unrefused: string[] = [];
  for (const { route, method, body, query } of REFUSED) {
    const reply = await call(COORD, route, method, body ?? { teamId: w.t1.id }, query);
    if (reply.status !== 403) unrefused.push(`${method} ${route} -> ${reply.status}`);
  }
  assert.deepEqual(unrefused, []);
  assert.equal(await snapshot(w), held);
});

test("the table above names every exported handler of those routes", async () => {
  const routes = [...new Set(REFUSED.map((r) => r.route))];
  for (const route of routes) {
    const routeModule = (await import(`../src/app/api/${route}/route`)) as Record<string, unknown>;
    const exported = Object.keys(routeModule).filter((k) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k)).sort();
    const listed = [...new Set(REFUSED.filter((r) => r.route === route).map((r) => r.method))].sort();
    assert.deepEqual(listed, exported, route);
  }
});

test("/api/health shows a coordinator no more than it shows the public", async () => {
  await world();
  const asCoordinator = await call(COORD, "health", "GET");
  assert.deepEqual(asCoordinator.body, { ok: true });
  assert.deepEqual(asCoordinator.body, (await call(null, "health", "GET")).body);
  assert.ok((await call(ADMIN, "health", "GET")).body.counts, "the Judge Advisor still gets the details");
});
