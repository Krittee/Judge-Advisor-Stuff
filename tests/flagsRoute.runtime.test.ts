import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

import type { Session } from "../src/lib/auth";
import type { FlagRow } from "../src/lib/types";

/* POST and PATCH /api/flags with rulesets, several rules and match
   affecting, driven through the REAL route handlers against the real file
   store -- not a copy of their logic. The request scope is built by hand
   the same way tests/requestWorkflow.runtime.test.ts does it (see the long
   note there): getSession() reads cookies(), which needs a Next request
   store holding a signed session cookie. Env is set before anything imports
   the store, because file.ts resolves DATA_FILE once at load. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-flags-route-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "flags-route-test-secret-0123456789abcdef";
delete process.env.DATABASE_URL;
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

const REFEREE: Session = { role: "referee", name: "Dana" };
const ADMIN: Session = { role: "admin", name: "Judge Advisor" };

async function inRequestScope<T>(session: Session, fn: () => Promise<T>): Promise<T> {
  const [{ workAsyncStorage }, { workUnitAsyncStorage }, { RequestCookies }, { RequestCookiesAdapter }] =
    await Promise.all([
      import("next/dist/server/app-render/work-async-storage.external"),
      import("next/dist/server/app-render/work-unit-async-storage.external"),
      import("next/dist/server/web/spec-extension/cookies"),
      import("next/dist/server/web/spec-extension/adapters/request-cookies"),
    ]);
  const token = await new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  const headers = new Headers({ cookie: `jq_session=${token}` });
  const cookies = RequestCookiesAdapter.seal(new RequestCookies(headers));
  return workAsyncStorage.run({ route: "/api/flags" } as never, () =>
    workUnitAsyncStorage.run({ type: "request", phase: "render", cookies } as never, fn),
  );
}

type Reply = { status: number; body: { error?: string; flag?: FlagRow } };

async function send(method: "POST" | "PATCH", session: Session, body: Record<string, unknown>): Promise<Reply> {
  const route = await import("../src/app/api/flags/route");
  const request = new Request("http://localhost/api/flags", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await inRequestScope(session, () => route[method](request));
  return { status: res.status, body: await res.json() };
}

const store = async () => (await import("../src/lib/db/file")).fileStore;

async function team() {
  const db = await store();
  await db.resetAll();
  await db.upsertTeams([
    { number: "1852B", name: "Team", pit: null, division: "Elementary School", category: "developing" },
  ]);
  return (await db.findTeamByNumber("1852B"))!;
}

const base = { kind: "minor", body: "", matchType: "Q", matchNumber: "23", field: "ES2" };

test("a V5RC flag with several rules is stored with its ruleset, rules and match affecting", async () => {
  const t = await team();
  const { status, body } = await send("POST", REFEREE, {
    ...base,
    teamId: t.id,
    ruleset: "v5rc",
    rules: ["gg17", "SG9", "GG17"],
    matchAffecting: true,
  });
  assert.equal(status, 200, body.error);
  assert.equal(body.flag?.rule, "GG17,SG9");
  assert.equal(body.flag?.ruleset, "v5rc");
  assert.equal(body.flag?.manual_version, "2.1");
  assert.equal(body.flag?.match_affecting, true);

  const [stored] = await (await store()).listFlags(t.id);
  assert.equal(stored.rule, "GG17,SG9", "what the API answered is what was stored");
});

test("the manual version is set by the server: a forged one is ignored", async () => {
  const t = await team();
  const { body } = await send("POST", REFEREE, {
    ...base,
    teamId: t.id,
    ruleset: "v5rc",
    rules: ["SG6"],
    manualVersion: "9.9",
    manual_version: "9.9",
  });
  assert.equal(body.flag?.manual_version, "2.1");
});

test("an IQ-only rule under V5RC is a 400 and records nothing", async () => {
  const t = await team();
  const { status, body } = await send("POST", REFEREE, {
    ...base,
    teamId: t.id,
    ruleset: "v5rc",
    rules: ["RSC8"],
  });
  assert.equal(status, 400);
  assert.match(body.error ?? "", /RSC8/);
  assert.deepEqual(await (await store()).listFlags(t.id), [], "a refused flag must not be stored");

  const unknown = await send("POST", REFEREE, { ...base, teamId: t.id, ruleset: "vexu", rules: ["SG6"] });
  assert.equal(unknown.status, 400);
});

test("the old payload (no ruleset, a single `rule`) still records a VEX IQ flag", async () => {
  const t = await team();
  const { status, body } = await send("POST", REFEREE, { ...base, teamId: t.id, rule: "sg6" });
  assert.equal(status, 200, body.error);
  assert.equal(body.flag?.rule, "SG6");
  assert.equal(body.flag?.ruleset, "viqrc");
  assert.equal(body.flag?.manual_version, null);
  assert.equal(body.flag?.match_affecting, false);
});

test("Disqualified needs a rule, and match affecting is dropped for it", async () => {
  const t = await team();
  const none = await send("POST", REFEREE, { ...base, kind: "dq", teamId: t.id });
  assert.equal(none.status, 400, "DQ with no rule must be refused");

  const ok = await send("POST", REFEREE, {
    ...base,
    kind: "dq",
    teamId: t.id,
    ruleset: "v5rc",
    rules: ["GG6"],
    matchAffecting: true,
  });
  assert.equal(ok.status, 200, ok.body.error);
  assert.equal(ok.body.flag?.kind, "dq");
  assert.equal(ok.body.flag?.match_affecting, false, "only Minor and Major can be match affecting");
});

test("a correction changes rules, ruleset and match affecting, and the Activity log says so", async () => {
  const t = await team();
  const created = await send("POST", REFEREE, {
    ...base,
    teamId: t.id,
    ruleset: "v5rc",
    rules: ["SG6"],
  });
  const id = created.body.flag!.id;

  const { status, body } = await send("PATCH", REFEREE, {
    id,
    ...base,
    ruleset: "v5rc",
    rules: ["SG6", "GG17"],
    matchAffecting: true,
  });
  assert.equal(status, 200, body.error);
  assert.equal(body.flag?.rule, "SG6,GG17");
  assert.equal(body.flag?.match_affecting, true);

  const log = (await (await store()).listActivity()).find((a) => a.action === "corrected a flag");
  assert.ok(log, "the correction was not logged");
  assert.match(log.detail ?? "", /rules: "SG6" → "SG6,GG17"/);
  assert.match(log.detail ?? "", /match affecting: "no" → "yes"/);
  assert.doesNotMatch(log.detail ?? "", /ruleset:/, "the ruleset did not change");

  // Moving the flag to the other ruleset needs rules valid there, and is logged.
  const moved = await send("PATCH", ADMIN, { id, ...base, ruleset: "viqrc", rules: ["SG7"] });
  assert.equal(moved.status, 200, moved.body.error);
  assert.equal(moved.body.flag?.ruleset, "viqrc");
  assert.equal(moved.body.flag?.manual_version, null, "IQ records no edition");
  const [latest] = (await (await store()).listActivity()).filter((a) => a.action === "corrected a flag");
  assert.match(latest.detail ?? "", /ruleset: "v5rc" → "viqrc"/);

  const bad = await send("PATCH", ADMIN, { id, ...base, ruleset: "v5rc", rules: ["RSC8"] });
  assert.equal(bad.status, 400, "an IQ-only id must be refused on a correction too");
});

test("a correction that names no ruleset keeps the flag's own", async () => {
  const t = await team();
  const created = await send("POST", REFEREE, { ...base, teamId: t.id, ruleset: "v5rc", rules: ["GG17"] });
  const { status, body } = await send("PATCH", REFEREE, { id: created.body.flag!.id, ...base, rules: ["GG17"] });
  assert.equal(status, 200, body.error);
  assert.equal(body.flag?.ruleset, "v5rc", "an older client must not move a V5RC flag to IQ");
  assert.equal(body.flag?.manual_version, "2.1");
});

test("correcting a legacy flag (no ruleset) does not log a phantom ruleset change", async () => {
  const t = await team();
  const db = await store();
  const legacy = await db.createFlag({
    teamId: t.id,
    kind: "minor",
    body: "old",
    author: "Dana",
    matchType: "Q",
    matchNumber: "23",
    field: "ES2",
    rule: "SG6",
    ruleset: null,
    manualVersion: null,
    matchAffecting: false,
  });
  const { status, body } = await send("PATCH", REFEREE, { id: legacy.id, ...base, body: "reworded", rule: "SG6" });
  assert.equal(status, 200, body.error);
  const log = (await db.listActivity()).find((a) => a.action === "corrected a flag");
  assert.ok(log);
  assert.doesNotMatch(log.detail ?? "", /ruleset:/);
  assert.match(log.detail ?? "", /body:/);
});
