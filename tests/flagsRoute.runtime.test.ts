import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

import type { Session } from "../src/lib/auth";
import { matchReference } from "../src/lib/match";
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
const HEAD_REFEREE: Session = { role: "referee", name: "Morgan", head: true };
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

const base = {
  kind: "minor",
  body: "",
  matchType: "Q",
  matchNumber: "23",
  field: "2",
};
/** SG6 exists in both rulesets, so a Minor with it records under either. */
const sg6 = { rules: ["SG6"] };

test("only the head referee and Judge Advisor can correct a filed flag", async () => {
  const t = await team();
  const created = await send("POST", REFEREE, { ...base, ...sg6, teamId: t.id });
  assert.equal(created.status, 200, created.body.error);
  const original = created.body.flag!;

  const denied = await send("PATCH", REFEREE, { id: original.id, ...base, ...sg6, body: "changed" });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.flag, undefined);
  assert.equal((await (await store()).listFlags(t.id))[0].body, original.body);

  const headed = await send("PATCH", HEAD_REFEREE, { id: original.id, ...base, ...sg6, body: "head correction" });
  assert.equal(headed.status, 200, headed.body.error);
  assert.equal(headed.body.flag?.body, "head correction");
  const [entry] = (await (await store()).listActivity()).filter((a) => a.action === "corrected a flag");
  assert.equal(entry.actor_role, "Head referee");

  const advised = await send("PATCH", ADMIN, { id: original.id, ...base, ...sg6, body: "advisor correction" });
  assert.equal(advised.status, 200, advised.body.error);
  assert.equal(advised.body.flag?.body, "advisor correction");
});

/** Save the event's setup straight into the store, as PUT /api/referee-setup would. */
async function setUp(ruleset: string, fieldCount = 3) {
  await (await store()).saveRefereeSetup({ ruleset, fieldCount, setBy: "Dana", setOn: "2026-09-09" });
}

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

  const { status, body } = await send("PATCH", ADMIN, {
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
  const { status, body } = await send("PATCH", ADMIN, { id: created.body.flag!.id, ...base, rules: ["GG17"] });
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
  const { status, body } = await send("PATCH", ADMIN, { id: legacy.id, ...base, body: "reworded", rule: "SG6" });
  assert.equal(status, 200, body.error);
  const log = (await db.listActivity()).find((a) => a.action === "corrected a flag");
  assert.ok(log);
  assert.doesNotMatch(log.detail ?? "", /ruleset:/);
  assert.match(log.detail ?? "", /body:/);
});

/* ---- the event's setup: program, match types and fields ---------------------- */

test("a new flag takes the event's program when the request names none", async () => {
  const t = await team();
  await setUp("v5rc");
  const { status, body } = await send("POST", REFEREE, { ...base, teamId: t.id, rules: ["GG17"] });
  assert.equal(status, 200, body.error);
  assert.equal(body.flag?.ruleset, "v5rc", "the setup's program, not VEX IQ");
  assert.equal(body.flag?.manual_version, "2.1");

  await setUp("viqrc");
  const iq = await send("POST", REFEREE, { ...base, teamId: t.id, rules: ["SG6"] });
  assert.equal(iq.body.flag?.ruleset, "viqrc");
});

test("naming a different program than the event's is a 400 that says which, and records nothing", async () => {
  const t = await team();
  await setUp("v5rc");
  const { status, body } = await send("POST", REFEREE, { ...base, teamId: t.id, ruleset: "viqrc", rules: ["SG6"] });
  assert.equal(status, 400);
  assert.equal(body.error, "This event is set to V5RC Override.");
  assert.deepEqual(await (await store()).listFlags(t.id), []);

  await setUp("viqrc");
  const other = await send("POST", REFEREE, { ...base, teamId: t.id, ruleset: "v5rc", rules: ["SG6"] });
  assert.equal(other.status, 400);
  assert.equal(other.body.error, "This event is set to VEX IQ.");

  const same = await send("POST", REFEREE, { ...base, teamId: t.id, ruleset: "viqrc", rules: ["SG6"] });
  assert.equal(same.status, 200, same.body.error);
});

test("an alliance in the request is accepted and nothing alliance-like is stored, returned or logged", async () => {
  const t = await team();
  await setUp("viqrc");
  const db = await store();

  // An older client may still send one; neither a pick nor garbage is a 400.
  for (const [matchType, alliance] of [["Q", "red"], ["SKD", "blue"], ["F", "green"]]) {
    const { status, body } = await send("POST", REFEREE, { ...base, ...sg6, teamId: t.id, matchType, matchNumber: "1", alliance });
    assert.equal(status, 200, `${matchType} with alliance ${alliance}: ${body.error}`);
    assert.equal(body.flag?.match_type, matchType);
    assert.doesNotMatch(JSON.stringify(body), /alliance|"red"|"blue"/i, "the response carries no alliance");
  }

  const stored = await db.listFlags(t.id);
  assert.equal(stored.length, 3);
  for (const f of stored) assert.equal("alliance" in f, false, "the stored flag has no alliance");
  for (const a of await db.listActivity()) {
    assert.doesNotMatch(`${a.action} ${a.detail ?? ""}`, /alliance|\bred\b|\bblue\b/i, "the log says nothing of one");
  }
  const q = (await db.listActivity()).find((a) => a.detail?.includes("Q1"));
  assert.equal(q?.detail, "Team 1852B · Q1 · Field 2");

  // A correction that sends one changes nothing, and the log says so.
  const fix = await send("PATCH", ADMIN, { id: stored[0].id, ...base, ...sg6, matchType: stored[0].match_type, matchNumber: "1", alliance: "blue" });
  assert.equal(fix.status, 200, fix.body.error);
  assert.equal("alliance" in fix.body.flag!, false);
  const [entry] = (await db.listActivity()).filter((a) => a.action === "corrected a flag");
  assert.equal(entry.detail, "Team 1852B · nothing changed");
});

test("\"QF 2-1\" round-trips: stored as 2-1, read back, and logged as QF 2-1", async () => {
  const t = await team();
  await setUp("v5rc");
  const { status, body } = await send("POST", REFEREE, {
    ...base,
    teamId: t.id,
    matchType: "QF",
    matchNumber: "2 1",
    field: "2",
    rules: ["GG17"],
  });
  assert.equal(status, 200, body.error);
  assert.equal(body.flag?.match_type, "QF");
  assert.equal(body.flag?.match_number, "2-1");

  const [stored] = await (await store()).listFlags(t.id);
  assert.equal(matchReference(stored.match_type, stored.match_number), "QF 2-1");
  const log = (await (await store()).listActivity()).find((a) => a.action === "flagged minor");
  assert.equal(log?.detail, "Team 1852B · QF 2-1 · Field 2");

  // A correction can move it to another match in the bracket, and says so.
  const moved = await send("PATCH", ADMIN, { id: stored.id, ...base, matchType: "QF", matchNumber: "2-2", rules: ["GG17"] });
  assert.equal(moved.status, 200, moved.body.error);
  assert.equal(moved.body.flag?.match_number, "2-2");
  const [latest] = (await (await store()).listActivity()).filter((a) => a.action === "corrected a flag");
  assert.match(latest.detail ?? "", /match: "QF 2-1" → "QF 2-2"/);
});

test("a type or number shape from the other program is a 400 on each", async () => {
  const t = await team();
  await setUp("viqrc");
  const qf = await send("POST", REFEREE, { ...base, teamId: t.id, matchType: "QF", matchNumber: "2-1" });
  assert.equal(qf.status, 400, "QF is V5RC-only");

  await setUp("v5rc");
  const plain = await send("POST", REFEREE, { ...base, teamId: t.id, matchType: "F", matchNumber: "3", rules: ["GG17"] });
  assert.equal(plain.status, 400, "a V5RC Final is a bracket and a match");
  const half = await send("POST", REFEREE, { ...base, teamId: t.id, matchType: "QF", matchNumber: "2", rules: ["GG17"] });
  assert.equal(half.status, 400);
  assert.deepEqual(await (await store()).listFlags(t.id), []);
});

test("a field above the event's field count is a 400; the count is the ceiling, not a suggestion", async () => {
  const t = await team();
  await setUp("viqrc", 3);
  const over = await send("POST", REFEREE, { ...base, ...sg6, teamId: t.id, field: "4" });
  assert.equal(over.status, 400);
  assert.equal(over.body.error, "Pick the field — 1 to 3.");
  const prefixed = await send("POST", REFEREE, { ...base, ...sg6, teamId: t.id, field: "ES2" });
  assert.equal(prefixed.status, 400, "the division prefix is gone");

  const last = await send("POST", REFEREE, { ...base, ...sg6, teamId: t.id, field: "3" });
  assert.equal(last.status, 200, last.body.error);
  assert.equal(last.body.flag?.field, "3");

  // A correction is held to it as well.
  const fix = await send("PATCH", ADMIN, { id: last.body.flag!.id, ...base, ...sg6, field: "4" });
  assert.equal(fix.status, 400);
});

test("with no setup saved a new flag still records: VEX IQ, and fields up to 20", async () => {
  const t = await team();
  const ok = await send("POST", REFEREE, { ...base, ...sg6, teamId: t.id, field: "20" });
  assert.equal(ok.status, 200, ok.body.error);
  assert.equal(ok.body.flag?.ruleset, "viqrc");
  const over = await send("POST", REFEREE, { ...base, ...sg6, teamId: t.id, field: "21" });
  assert.equal(over.body.error, "Pick the field — 1 to 20.");
});

/* A correction as the form sends it: everything the flag holds, untouched. */
function unchanged(f: FlagRow): Record<string, unknown> {
  return {
    id: f.id,
    kind: f.kind,
    body: f.body,
    matchType: f.match_type,
    matchNumber: f.match_number,
    field: f.field ?? "",
    ruleset: f.ruleset ?? "viqrc",
    rules: f.rule ? f.rule.split(",") : [],
    matchAffecting: f.match_affecting,
  };
}

test("legacy flags (SK, an HS2 field) survive a correction that changes none of them", async () => {
  const t = await team();
  await setUp("v5rc", 3);
  const db = await store();
  const old = {
    teamId: t.id,
    kind: "warning",
    body: "old",
    author: "Dana",
    rule: null,
    ruleset: null,
    manualVersion: null,
    matchAffecting: false,
  };
  const skills = await db.createFlag({ ...old, matchType: "SK", matchNumber: "3", field: "HS2" });
  const quals = await db.createFlag({ ...old, matchType: "Q", matchNumber: "23", field: "ES2" });

  for (const flag of [skills, quals]) {
    const { status, body } = await send("PATCH", ADMIN, { ...unchanged(flag), body: "reworded" });
    assert.equal(status, 200, body.error);
    assert.equal(body.flag?.body, "reworded");
    assert.equal(body.flag?.match_type, flag.match_type, "the legacy type is kept");
    assert.equal(body.flag?.match_number, flag.match_number);
    assert.equal(body.flag?.field, flag.field, "the prefixed field is kept");
    assert.equal(body.flag?.ruleset, "viqrc", "a flag keeps its own program, not the event's");
  }
  const log = (await db.listActivity()).filter((a) => a.action === "corrected a flag");
  for (const entry of log) {
    assert.doesNotMatch(entry.detail ?? "", /field|match:/, "only the body changed");
  }
});

test("a legacy flag can be given a real field, and the log says what changed", async () => {
  const t = await team();
  await setUp("viqrc", 3);
  const db = await store();
  const legacyQuals = () =>
    db.createFlag({
      teamId: t.id,
      kind: "warning",
      body: "",
      author: "Dana",
      matchType: "Q",
      matchNumber: "23",
      field: "HS2",
      rule: null,
      ruleset: null,
      manualVersion: null,
      matchAffecting: false,
    });
  const quals = await legacyQuals();

  const { status, body } = await send("PATCH", ADMIN, { ...unchanged(quals), field: "2" });
  assert.equal(status, 200, body.error);
  assert.equal(body.flag?.field, "2");
  const [entry] = (await db.listActivity()).filter((a) => a.action === "corrected a flag");
  assert.match(entry.detail ?? "", /field: "HS2" → "2"/);

  // Only the value it already holds is exempt: another prefixed field is not a pick.
  const other = await legacyQuals();
  assert.equal((await send("PATCH", ADMIN, { ...unchanged(other), field: "ES3" })).status, 400);
});
