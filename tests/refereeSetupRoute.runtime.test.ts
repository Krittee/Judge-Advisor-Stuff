import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

import type { Session } from "../src/lib/auth";
import type { RefereeSetup } from "../src/lib/types";

/* PUT /api/referee-setup, driven through the REAL route handler against the
   real file store, with the request scope built by hand the way
   tests/flagsRoute.runtime.test.ts does it (see the note there). Env is set
   before anything imports the store, because file.ts resolves DATA_FILE once. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-referee-setup-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "referee-setup-test-secret-0123456789abcdef";
delete process.env.DATABASE_URL;
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

const REFEREE: Session = { role: "referee", name: "Dana" };
const ADMIN: Session = { role: "admin", name: "Judge Advisor" };
const JUDGE: Session = { role: "judge", name: "Sam", panelId: "p1", panelName: "Panel A" };
const QUEUER: Session = { role: "queuer", name: "Front Desk" };

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
  return workAsyncStorage.run({ route: "/api/referee-setup" } as never, () =>
    workUnitAsyncStorage.run({ type: "request", phase: "render", cookies } as never, fn),
  );
}

type Reply = { status: number; body: { error?: string; setup?: RefereeSetup } };

async function put(session: Session | null, body: unknown): Promise<Reply> {
  const route = await import("../src/app/api/referee-setup/route");
  const request = new Request("http://localhost/api/referee-setup", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await inRequestScope(session, () => route.PUT(request));
  return { status: res.status, body: await res.json() };
}

const store = async () => (await import("../src/lib/db/file")).fileStore;
const good = { ruleset: "v5rc", field_count: 3, today: "2026-09-09" };

async function fresh() {
  const db = await store();
  await db.resetAll();
  return db;
}

test("a referee and the Judge Advisor may save the setup; a judge, the desk and an anonymous caller may not", async () => {
  const db = await fresh();

  for (const [who, session] of [
    ["judge", JUDGE],
    ["queuer", QUEUER],
    ["anonymous", null],
  ] as const) {
    const { status, body } = await put(session, good);
    assert.equal(status, 403, `${who} must be refused`);
    assert.ok(body.error);
    assert.equal(await db.getRefereeSetup(), null, `${who} must not have saved anything`);
    assert.deepEqual(await db.listActivity(), [], `${who} must not have logged anything`);
  }

  const referee = await put(REFEREE, good);
  assert.equal(referee.status, 200, referee.body.error);
  const admin = await put(ADMIN, { ...good, ruleset: "viqrc" });
  assert.equal(admin.status, 200, admin.body.error);
  assert.equal((await db.getRefereeSetup())?.ruleset, "viqrc");
});

test("the setup is stored with who set it, the client's own date and a server timestamp", async () => {
  const db = await fresh();
  const { status, body } = await put(REFEREE, good);
  assert.equal(status, 200, body.error);

  assert.equal(body.setup?.ruleset, "v5rc");
  assert.equal(body.setup?.field_count, 3);
  assert.equal(body.setup?.set_by, "Dana", "the session's name, not anything in the body");
  assert.equal(body.setup?.set_on, "2026-09-09", "the day the client said it was, not the server's");
  assert.ok(Math.abs(Date.parse(body.setup!.updated_at) - Date.now()) < 60_000, "updated_at is the server's clock");
  assert.deepEqual(await db.getRefereeSetup(), body.setup);

  // set_by and set_on cannot be claimed by the client.
  const forged = await put(ADMIN, { ...good, set_by: "Someone Else", setBy: "Someone Else", set_on: "1999-01-01" });
  assert.equal(forged.body.setup?.set_by, "Judge Advisor");
  assert.equal(forged.body.setup?.set_on, "2026-09-09");
});

test("a bad program, field count or date is a 400 that saves nothing", async () => {
  const db = await fresh();
  const cases: [string, Record<string, unknown>][] = [
    ["a ruleset that does not exist", { ruleset: "vexu" }],
    ["no ruleset", { ruleset: undefined }],
    ["zero fields", { field_count: 0 }],
    ["21 fields", { field_count: 21 }],
    ["1.5 fields", { field_count: 1.5 }],
    ["fields as text", { field_count: "3" }],
    ["no field count", { field_count: undefined }],
    ["a date in the wrong shape", { today: "09/09/2026" }],
    ["a date with a time", { today: "2026-09-09T10:00:00Z" }],
    ["a day that does not exist", { today: "2026-02-30" }],
    ["no date", { today: undefined }],
  ];
  for (const [what, change] of cases) {
    const { status, body } = await put(REFEREE, { ...good, ...change });
    assert.equal(status, 400, what);
    assert.ok(body.error, what);
    assert.equal(await db.getRefereeSetup(), null, `${what} must not save`);
  }
  assert.equal((await put(REFEREE, null)).status, 400, "a body that is not an object is a bad request, not a crash");
  assert.deepEqual(await db.listActivity(), []);

  // The edges are fine.
  assert.equal((await put(REFEREE, { ...good, field_count: 1 })).status, 200);
  assert.equal((await put(REFEREE, { ...good, field_count: 20 })).status, 200);
});

test("every save is logged to Activity, saying what it replaced", async () => {
  const db = await fresh();
  await put(REFEREE, good);
  await put(ADMIN, { ruleset: "viqrc", field_count: 1, today: "2026-09-10" });

  // Found by what they say, not by position: two saves in the same millisecond have no fixed order.
  const log = (await db.listActivity()).filter((a) => a.action.startsWith("Referee setup"));
  assert.equal(log.length, 2);
  const first = log.find((a) => a.action === "Referee setup: V5RC, 3 fields");
  const latest = log.find((a) => a.action === "Referee setup: VIQRC, 1 field");
  assert.ok(first && latest);
  assert.deepEqual([first.kind, first.actor, first.actor_role], ["setup", "Dana", "Referee"]);
  assert.equal(first.detail, null, "the first save replaced nothing");
  assert.deepEqual([latest.kind, latest.actor, latest.actor_role], ["setup", "Judge Advisor", "Judge Advisor"]);
  assert.equal(latest.detail, "was V5RC, 3 fields");
});

test("the setup is part of the state everyone polls (minus who set it, for anonymous), and the match types follow its program", async () => {
  const db = await fresh();
  const { loadState } = await import("../src/lib/server-state");
  const ids = (state: Awaited<ReturnType<typeof loadState>>) => state.matchTypes.map((t) => t.id);

  const before = await loadState(null);
  assert.equal(before.refereeSetup, null);
  assert.deepEqual(ids(before), ["P", "Q", "F", "SKD", "SKA"], "no setup: VEX IQ's, as flags default to");

  await put(REFEREE, good);
  const setup = await db.getRefereeSetup();
  for (const viewer of [null, REFEREE, ADMIN, JUDGE, QUEUER]) {
    const state = await loadState(viewer);
    const expected = viewer ? setup : { ...setup!, set_by: "" };
    assert.deepEqual(state.refereeSetup, expected, `${viewer?.role ?? "anonymous"} sees the setup`);
    assert.deepEqual(ids(state), ["P", "Q", "R16", "QF", "SF", "F", "SKD", "SKA"]);
  }
});
