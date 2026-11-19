import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

import type { Session } from "../src/lib/auth";

/* The marketing role: reads the Awards Desk, nothing else. Driven through the
   real route handlers against the real file store, with the same hand-built
   request scope as awardsRoute.runtime.test.ts. What is pinned: the code signs
   in (and production refuses the published one), every route answers marketing
   with 403, /api/state hands it exactly the public payload, and every can*
   helper denies it. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-marketing-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "marketing-test-secret-0123456789";
delete process.env.DATABASE_URL;
delete process.env.MARKETING_CODE;
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

const MARKETING: Session = { role: "marketing", name: "Marketing" };

/** `writable` is the "action" phase, where cookies().set() works: sign-in needs it, nothing else does. */
async function inRequestScope<T>(session: Session | null, fn: () => Promise<T>, writable = false): Promise<T> {
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
  const store = writable
    ? { type: "request", phase: "action", cookies, userspaceMutableCookies: new RequestCookies(headers) }
    : { type: "request", phase: "render", cookies };
  return workAsyncStorage.run({ route: "/api/test" } as never, () =>
    workUnitAsyncStorage.run(store as never, fn),
  );
}

type Handlers = Record<string, (request: Request) => Promise<Response>>;

async function hit(load: () => Promise<unknown>, method: string, session: Session | null, path: string, body?: unknown) {
  const handlers = (await load()) as Handlers;
  const request = new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
  });
  const res = await inRequestScope(session, () => handlers[method](request), method === "POST" && path === "/api/session");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: (await res.json()) as any };
}

const signIn = (body: unknown) =>
  hit(() => import("../src/app/api/session/route"), "POST", null, "/api/session", body);

/* ---- signing in -------------------------------------------------------- */

test("marketing signs in with MKTG01 in development, with or without a name", async () => {
  const bare = await signIn({ code: "mktg01" });
  assert.equal(bare.status, 200);
  assert.deepEqual(bare.body.session, { role: "marketing", name: "Marketing" });

  const named = await signIn({ code: "MKTG01", name: "Pim" });
  assert.equal(named.status, 200);
  assert.deepEqual(named.body.session, { role: "marketing", name: "Pim" });
});

test("production refuses the published marketing code", async () => {
  const env = process.env as Record<string, string | undefined>;
  const before = { NODE_ENV: env.NODE_ENV, MARKETING_CODE: env.MARKETING_CODE };
  env.NODE_ENV = "production";
  env.MARKETING_CODE = "MKTG01";
  try {
    const { resolveCode } = await import("../src/lib/auth");
    assert.equal(await resolveCode("MKTG01", ""), null);
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
});

/* ---- every write and every private read is refused ---------------------- */

test("marketing is refused by every write and every private read", async () => {
  const awards = () => import("../src/app/api/awards/route");
  const winners = () => import("../src/app/api/awards/winners/route");
  const noWinner = () => import("../src/app/api/awards/no-winner/route");
  const requests = () => import("../src/app/api/requests/route");
  const notes = () => import("../src/app/api/notes/route");
  const scores = () => import("../src/app/api/scores/route");
  const flags = () => import("../src/app/api/flags/route");
  const conflicts = () => import("../src/app/api/conflicts/route");
  const activity = () => import("../src/app/api/admin/activity/route");
  const adminTeams = () => import("../src/app/api/admin/teams/route");
  const teamLanguage = () => import("../src/app/api/team-language/route");
  const refereeSetup = () => import("../src/app/api/referee-setup/route");

  const cases: [() => Promise<unknown>, string, string][] = [
    [awards, "GET", "/api/awards"],
    [awards, "POST", "/api/awards"],
    [winners, "PUT", "/api/awards/winners"],
    [winners, "DELETE", "/api/awards/winners"],
    [noWinner, "PUT", "/api/awards/no-winner"],
    [noWinner, "DELETE", "/api/awards/no-winner"],
    [requests, "POST", "/api/requests"],
    [notes, "GET", "/api/notes"],
    [scores, "GET", "/api/scores"],
    [flags, "GET", "/api/flags"],
    [conflicts, "GET", "/api/conflicts"],
    [activity, "GET", "/api/admin/activity"],
    [adminTeams, "PATCH", "/api/admin/teams"],
    [teamLanguage, "PATCH", "/api/team-language"],
    [refereeSetup, "PUT", "/api/referee-setup"],
  ];
  for (const [load, method, path] of cases) {
    const res = await hit(load, method, MARKETING, path, {});
    assert.equal(res.status, 403, `${method} ${path} answered marketing ${res.status}, not 403`);
  }
});

/* ---- /api/state --------------------------------------------------------- */

test("marketing gets exactly what the public gets from /api/state", async () => {
  const db = (await import("../src/lib/db/file")).fileStore;
  await db.resetAll();
  const panel = await db.createPanel({
    name: "Panel 1",
    code: "MK1001",
    division: "Elementary School",
    judges: [],
    languages: [],
    sort_order: 1,
    slot_start_at: null,
    slot_minutes: 20,
    slot_count: 0,
  });
  await db.upsertTeams([{ number: "9882K", name: "Hawks", pit: null, division: "Elementary School", category: "developing" }]);
  const [team] = await db.listTeams();
  await db.updateTeam(team.id, { panel_id: panel.id });
  const created = await db.createRequest({
    teamId: team.id,
    panelId: panel.id,
    kind: "queue",
    createdBy: "queuer:Desk",
    language: "en",
  });
  await db.updateRequest(created.id, { status: "completed" });
  await db.saveRefereeSetup({ ruleset: "", fieldCount: 2, setBy: "Head Ref", setOn: "2026-11-19" });

  const { loadState } = await import("../src/lib/server-state");
  const strip = <T extends { viewer: unknown; serverTime: string }>({ viewer, serverTime, ...rest }: T) => {
    void viewer;
    void serverTime;
    return rest;
  };
  const staff = await loadState({ role: "queuer", name: "Desk" });
  assert.equal(staff.requests[0].created_by, "queuer:Desk", "the fixture must carry a staff name for this test to mean anything");

  const marketing = await loadState(MARKETING);
  const anonymous = await loadState(null);
  assert.deepEqual(strip(marketing), strip(anonymous));
  assert.equal(marketing.requests[0].created_by, null);
  assert.equal(marketing.refereeSetup?.set_by, "", "the head referee's name stays off marketing's payload");

  assert.equal(marketing.viewer.role, "marketing");
  for (const [key, value] of Object.entries(marketing.viewer)) {
    if (key.startsWith("can")) assert.equal(value, false, `viewer.${key}`);
  }
});

/* ---- the helpers --------------------------------------------------------- */

test("every can* helper denies marketing", async () => {
  const a = await import("../src/lib/auth");
  assert.equal(a.canAdvance(MARKETING), false);
  assert.equal(a.canReadNotes(MARKETING), false);
  assert.equal(a.canAdminister(MARKETING), false);
  assert.equal(a.canSetUpRefereeing(MARKETING), false);
  assert.equal(a.canRemoveFlag(MARKETING), false);
  assert.equal(a.canSetTeamLanguage(MARKETING), false);
  assert.equal(a.canFlag(MARKETING), false);
  assert.equal(a.canReadFlags(MARKETING), false);
  assert.equal(a.mayActOnPanel(MARKETING, "x"), false);
  assert.equal(a.canCancel(MARKETING, "requested"), false);
});
