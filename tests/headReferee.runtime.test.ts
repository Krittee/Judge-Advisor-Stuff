import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

import type { Session } from "../src/lib/auth";

/* The head referee: one more access code that signs in as a referee with a
   flag. resolveCode and getSession are the real functions; getSession reads
   cookies(), so the request scope is built by hand the way
   tests/refereeSetupRoute.runtime.test.ts does it. Env is set before anything
   imports the store, because file.ts resolves DATA_FILE once. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-head-referee-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "head-referee-test-secret-0123456789abcdef";
delete process.env.DATABASE_URL;
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

const auth = () => import("../src/lib/auth");

/** Run `fn` with these env vars set (undefined deletes), then put them back. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T> | T) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const apply = (v: Record<string, string | undefined>) => {
    for (const [k, value] of Object.entries(v)) {
      if (value === undefined) delete process.env[k];
      else process.env[k] = value;
    }
  };
  apply(vars);
  try {
    return await fn();
  } finally {
    apply(saved);
  }
}

/** Nothing configured: a laptop running `next dev`, so the published defaults apply. */
const DEV = {
  NODE_ENV: "development",
  DATABASE_URL: undefined,
  ADMIN_CODE: undefined,
  QUEUER_CODE: undefined,
  REFEREE_CODE: undefined,
  HEAD_REFEREE_CODE: undefined,
};

/* ---- resolveCode ---------------------------------------------------------- */

test("the head referee's code signs in a referee with the head flag; the shared code does not", async () => {
  const { resolveCode } = await auth();
  await withEnv(DEV, async () => {
    assert.deepEqual(await resolveCode("HREF01", "Dana"), { role: "referee", name: "Dana", head: true });
    assert.deepEqual(await resolveCode("REF001", "Dana"), { role: "referee", name: "Dana" });
    assert.ok(!("head" in (await resolveCode("REF001", "Dana"))!), "no head key at all on a plain referee");
    // Codes are typed on a phone: case and stray spaces do not matter, for either.
    assert.equal(((await resolveCode(" href01 ", "Dana")) as { head?: true }).head, true);
    assert.equal(await resolveCode("HREF02", "Dana"), null);
  });
});

test("both codes come from the environment when set, and the dev default stops working", async () => {
  const { resolveCode } = await auth();
  await withEnv({ ...DEV, REFEREE_CODE: "TESTREF", HEAD_REFEREE_CODE: "TESTHEAD" }, async () => {
    assert.deepEqual(await resolveCode("TESTHEAD", "Dana"), { role: "referee", name: "Dana", head: true });
    assert.deepEqual(await resolveCode("TESTREF", "Dana"), { role: "referee", name: "Dana" });
    assert.equal(await resolveCode("HREF01", "Dana"), null, "the published default is not an extra way in");
  });
});

test("if the head code is set equal to the shared one, it stays a plain referee's -- nobody is promoted", async () => {
  const { resolveCode } = await auth();
  await withEnv({ ...DEV, REFEREE_CODE: "SAME99", HEAD_REFEREE_CODE: "SAME99" }, async () => {
    assert.deepEqual(await resolveCode("SAME99", "Dana"), { role: "referee", name: "Dana" });
  });
});

test("an earlier role keeps a code that the head code collides with", async () => {
  const { resolveCode } = await auth();
  await withEnv({ ...DEV, ADMIN_CODE: "CLASH1", QUEUER_CODE: "CLASH2", HEAD_REFEREE_CODE: "CLASH1" }, async () => {
    assert.deepEqual(await resolveCode("CLASH1", "Alex"), { role: "admin", name: "Alex" });
  });
  await withEnv({ ...DEV, QUEUER_CODE: "CLASH2", HEAD_REFEREE_CODE: "CLASH2" }, async () => {
    assert.deepEqual(await resolveCode("CLASH2", "Sam"), { role: "queuer", name: "Sam" });
  });
});

test("in production HREF01 is a published code and the head role has no fallback", async () => {
  const { resolveCode } = await auth();
  const quiet = console.error;
  console.error = () => {};
  try {
    await withEnv({ ...DEV, NODE_ENV: "production", HEAD_REFEREE_CODE: "HREF01" }, async () => {
      assert.equal(await resolveCode("HREF01", "Dana"), null, "set on purpose, still refused");
    });
    await withEnv({ ...DEV, NODE_ENV: "production" }, async () => {
      assert.equal(await resolveCode("HREF01", "Dana"), null, "unset: no default in production");
    });
    await withEnv({ ...DEV, NODE_ENV: "production", HEAD_REFEREE_CODE: "Zq8mXk" }, async () => {
      assert.deepEqual(await resolveCode("zq8mxk", "Dana"), { role: "referee", name: "Dana", head: true });
    });
  } finally {
    console.error = quiet;
  }
});

/* ---- the session cookie --------------------------------------------------- */

async function inRequestScope<T>(
  cookie: string | null,
  fn: () => Promise<T>,
  onSetCookie?: (setCookies: string[]) => void,
): Promise<T> {
  const [{ workAsyncStorage }, { workUnitAsyncStorage }, { RequestCookies }, adapters] = await Promise.all([
    import("next/dist/server/app-render/work-async-storage.external"),
    import("next/dist/server/app-render/work-unit-async-storage.external"),
    import("next/dist/server/web/spec-extension/cookies"),
    import("next/dist/server/web/spec-extension/adapters/request-cookies"),
  ]);
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  const store = {
    type: "request",
    // The phase in which a route handler may set cookies, as createSession does.
    phase: "action",
    cookies: adapters.RequestCookiesAdapter.seal(new RequestCookies(headers)),
    userspaceMutableCookies: adapters.MutableRequestCookiesAdapter.wrap(new RequestCookies(headers), (c) => onSetCookie?.(c)),
  };
  return workAsyncStorage.run({ route: "/api/session" } as never, () =>
    workUnitAsyncStorage.run(store as never, fn),
  );
}

/** createSession, then getSession on the cookie it set: the whole round trip. */
async function roundTrip(session: Session): Promise<Session | null> {
  const { createSession, getSession } = await auth();
  const set: string[] = [];
  await inRequestScope(null, () => createSession(session), (c) => set.push(...c));
  const token = /jq_session=([^;]+)/.exec(set.join(";"))?.[1];
  assert.ok(token, "createSession set the cookie");
  return inRequestScope(`jq_session=${token}`, () => getSession());
}

async function signed(payload: Record<string, unknown>, secret = process.env.SESSION_SECRET!) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));
}

async function sessionOf(payload: Record<string, unknown>, secret?: string) {
  const { getSession } = await auth();
  return inRequestScope(`jq_session=${await signed(payload, secret)}`, () => getSession());
}

test("the head flag survives the cookie, and a referee without it comes back without it", async () => {
  assert.deepEqual(await roundTrip({ role: "referee", name: "Dana", head: true }), {
    role: "referee",
    name: "Dana",
    head: true,
  });
  assert.deepEqual(await roundTrip({ role: "referee", name: "Kim" }), { role: "referee", name: "Kim" });
  // The other roles are untouched.
  assert.deepEqual(await roundTrip({ role: "admin", name: "Alex" }), { role: "admin", name: "Alex" });
  assert.deepEqual(await roundTrip({ role: "queuer", name: "Sam" }), { role: "queuer", name: "Sam" });
});

test("a token with no head claim is a normal referee", async () => {
  assert.deepEqual(await sessionOf({ role: "referee", name: "Kim" }), { role: "referee", name: "Kim" });
});

test("only a literal true grants head: a garbled claim, or one on another role, does not", async () => {
  for (const head of ["true", 1, "1", null, false, {}, ["true"]]) {
    assert.deepEqual(
      await sessionOf({ role: "referee", name: "Kim", head }),
      { role: "referee", name: "Kim" },
      `head: ${JSON.stringify(head)}`,
    );
  }
  assert.deepEqual(await sessionOf({ role: "admin", name: "Alex", head: true }), { role: "admin", name: "Alex" });
  assert.deepEqual(await sessionOf({ role: "queuer", name: "Sam", head: true }), { role: "queuer", name: "Sam" });
  assert.deepEqual(
    await sessionOf({ role: "judge", name: "Sam", panelId: "p1", panelName: "Panel A", head: true }),
    { role: "judge", name: "Sam", panelId: "p1", panelName: "Panel A" },
  );
});

test("a head claim in a token signed with another secret grants nothing", async () => {
  assert.equal(await sessionOf({ role: "referee", name: "Kim", head: true }, "some-other-secret-0123456789abcdef"), null);
});

/* ---- who may set up refereeing -------------------------------------------- */

test("canSetUpRefereeing: the head referee and the Judge Advisor, nobody else", async () => {
  const { canSetUpRefereeing, canFlag } = await auth();
  const head: Session = { role: "referee", name: "Dana", head: true };
  assert.equal(canSetUpRefereeing(head), true);
  assert.equal(canSetUpRefereeing({ role: "admin", name: "Alex" }), true);
  assert.equal(canSetUpRefereeing({ role: "referee", name: "Kim" }), false);
  assert.equal(canSetUpRefereeing({ role: "judge", name: "Sam", panelId: "p1", panelName: "Panel A" }), false);
  assert.equal(canSetUpRefereeing({ role: "queuer", name: "Sam" }), false);
  assert.equal(canSetUpRefereeing(null), false);
  // A referee in every other respect: the head still flags, and no one else gained that.
  assert.equal(canFlag(head), true);
  assert.equal(canFlag({ role: "admin", name: "Alex" }), false);
});

test("actorLabel is unchanged for the head referee, so created_by and declared_by read as before", async () => {
  const { actorLabel } = await auth();
  assert.equal(actorLabel({ role: "referee", name: "Dana", head: true }), "referee:Dana");
  assert.equal(actorLabel({ role: "referee", name: "Dana" }), "referee:Dana");
});
