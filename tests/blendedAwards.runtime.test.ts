import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

import type { Session } from "../src/lib/auth";
import type { Team } from "../src/lib/types";

/* Winners, No winner and the Awards Desk under a saved event setup (Blended keys
   some awards by "Whole event"), through the REAL route handlers and file store,
   with the same hand-built request scope as awardsReleased.runtime.test.ts. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-blended-awards-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "blended-awards-test-secret-0123456789";
delete process.env.DATABASE_URL;
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

const ES = "Elementary School";
const MS = "Middle School";
const WHOLE = "Whole event";

const ADMIN: Session = { role: "admin", name: "Alex" };
const MARKETING: Session = { role: "marketing", name: "Pim" };

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Reply = { status: number; body: any; headers: Headers };
type Handlers = Record<string, (request: Request) => Promise<Response>>;

async function hit(
  load: () => Promise<unknown>,
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
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
  return { status: res.status, body: await res.json(), headers: res.headers };
}
const route = (name: string) => () => import(`../src/app/api/awards/${name}/route`);
const call = (name: string, method: "GET" | "POST" | "PUT" | "DELETE", session: Session | null, body?: unknown) =>
  hit(route(name), method, session, `/api/awards/${name}`, body);
const released = (session: Session | null, method: "GET" | "POST" | "PUT" | "DELETE", body?: unknown) =>
  call("released", method, session, body);
const winner = (awardId: string, division: string, teamId: string) => call("winners", "PUT", ADMIN, { awardId, division, teamId });
const noWinner = (awardId: string, division: string) => call("no-winner", "PUT", ADMIN, { awardId, division });
const awardsRoute = () => import("../src/app/api/awards/route");

/* ---- the fixture ------------------------------------------------------- */

type Setup = { program: string; format: "standard" | "blended" } | null;

async function world(setup: Setup) {
  const db = (await import("../src/lib/db/file")).fileStore;
  await db.resetAll();
  if (setup) await db.saveEventSetup({ ...setup, setBy: "Alex" });
  const spec: [string, string][] = [["1A", ES], ["2A", ES], ["3B", MS], ["4B", MS]];
  await db.upsertTeams(spec.map(([number, division]) => ({ number, name: number, pit: null, division, category: "developing" })));
  const teams = await db.listTeams();
  const team = (n: string) => teams.find((t) => t.number === n) as Team;
  const [a1, a2, b3, b4] = ["1A", "2A", "3B", "4B"].map(team);
  // Nominate every team for every award, as the Judge Advisor may.
  for (const t of teams) {
    for (const awardId of ["excellence", "design", "innovate", "think", "judges"]) {
      await db.nominateAsAdmin({ awardId, teamId: t.id, judge: "Alex", reason: null });
    }
  }
  return { db, a1, a2, b3, b4 };
}

const IQ_BLENDED: Setup = { program: "VEX IQ", format: "blended" };
const IQ_STANDARD: Setup = { program: "VEX IQ", format: "standard" };

/* ===== winners ============================================================ */

test("blended: Excellence is decided per division, so two Excellence winners stand", async () => {
  const w = await world(IQ_BLENDED);
  assert.equal((await winner("excellence", ES, w.a1.id)).status, 200);
  assert.equal((await winner("excellence", MS, w.b3.id)).status, 200);
  const all = await hit(awardsRoute, "GET", ADMIN, "/api/awards");
  assert.equal(all.body.winners.filter((x: { award_id: string }) => x.award_id === "excellence").length, 2);
});

test("blended: a whole-event award is keyed Whole event, any team, one place; a per-division one refuses it", async () => {
  const w = await world(IQ_BLENDED);
  const wrong = await winner("innovate", ES, w.a1.id);
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /whole event/);

  assert.equal((await winner("innovate", WHOLE, w.b3.id)).status, 200);
  assert.equal((await winner("innovate", WHOLE, w.a1.id)).status, 200);
  const held = (await w.db.listWinners()).filter((x) => x.award_id === "innovate");
  assert.deepEqual(held.map((x) => [x.division, x.team_id]), [[WHOLE, w.a1.id]]);

  const each = await winner("excellence", WHOLE, w.a1.id);
  assert.equal(each.status, 400);
  assert.match(each.body.error, /each division/);
});

test("blended: the Judges Award has two places in Whole event, across divisions", async () => {
  const w = await world(IQ_BLENDED);
  assert.equal((await winner("judges", WHOLE, w.a1.id)).status, 200);
  assert.equal((await winner("judges", WHOLE, w.b3.id)).status, 200);
  const third = await winner("judges", WHOLE, w.a2.id);
  assert.deepEqual([third.status, third.body.error], [409, "Judges already has its 2 winners in Whole event. Clear one first."]);
});

test("blended: No winner takes Whole event for a whole-event award and refuses a division", async () => {
  await world(IQ_BLENDED);
  assert.equal((await noWinner("think", WHOLE)).status, 200);
  assert.equal((await noWinner("think", MS)).status, 400);
});

test("blended: send, lock, recall, change the winner and send again marks the change", async () => {
  const w = await world(IQ_BLENDED);
  await winner("innovate", WHOLE, w.b3.id);
  const sent = await released(ADMIN, "PUT", { awardId: "innovate", division: WHOLE });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.release.division, WHOLE);

  const locked = await winner("innovate", WHOLE, w.a1.id);
  assert.deepEqual([locked.status, locked.body.error], [409, "Recall it from Marketing first."]);

  assert.equal((await released(ADMIN, "DELETE", { awardId: "innovate", division: WHOLE })).status, 200);
  await winner("innovate", WHOLE, w.a1.id);
  const again = await released(ADMIN, "PUT", { awardId: "innovate", division: WHOLE });
  assert.equal(again.status, 200);
  assert.ok(again.body.release.previous);
  assert.ok(again.body.release.changed_at);
});

test("blended: send all ready walks 13 pairs, then reports them already sent", async () => {
  const w = await world(IQ_BLENDED);
  const { awards } = await import("../src/lib/presets");
  const { awardPairs } = await import("../src/lib/eventSetup");
  for (const { award, division } of awardPairs(awards(), [ES, MS], "blended")) {
    const team = division === MS ? w.b3 : w.a1;
    const second = division === MS ? w.b4 : w.a2;
    await w.db.setWinner({ awardId: award.id, division, teamId: team.id, decidedBy: "Alex", places: award.places });
    if (award.places > 1) await w.db.setWinner({ awardId: award.id, division, teamId: second.id, decidedBy: "Alex", places: award.places });
  }
  const first = await released(ADMIN, "POST");
  assert.equal(first.body.sent.length, 13);
  assert.equal(first.body.skipped?.length ?? 0, 0);
  const second = await released(ADMIN, "POST");
  assert.equal(second.body.sent.length, 0);
  assert.deepEqual([second.body.skipped.length, new Set(second.body.skipped.map((s: { reason: string }) => s.reason))], [13, new Set(["already sent"])]);
});

/* ===== the desk's reply =================================================== */

test("blended: the desk reads setup, sections and one All tab", async () => {
  await world(IQ_BLENDED);
  const { body } = await released(MARKETING, "GET");
  assert.deepEqual(body.setup, { program: "VEX IQ", format: "blended" });
  assert.deepEqual(body.sections.map((s: { key: string }) => s.key), [ES, MS, WHOLE]);
  assert.deepEqual(body.sections[0].awardIds, ["excellence", "design"]);
  assert.equal(body.sections[2].awardIds.length, 9);
  assert.deepEqual(body.programs, [{ label: "All", divisions: [ES, MS] }]);
});

test("standard: an award is per division, Whole event is refused, every section has every award", async () => {
  const w = await world(IQ_STANDARD);
  assert.equal((await winner("innovate", ES, w.a1.id)).status, 200);
  assert.equal((await winner("innovate", WHOLE, w.a1.id)).status, 400);
  const { body } = await released(ADMIN, "GET");
  assert.deepEqual(body.setup, { program: "VEX IQ", format: "standard" });
  assert.deepEqual(body.sections.map((s: { awardIds: string[] }) => s.awardIds.length), [11, 11]);
});

test("no setup: the desk carries no setup or sections, one All tab, and Whole event is the old team-not-in-division 400", async () => {
  const w = await world(null);
  const { body } = await released(ADMIN, "GET");
  assert.ok(!("setup" in body) && !("sections" in body));
  assert.deepEqual(body.programs, [{ label: "All", divisions: body.divisions }]);
  const refused = await winner("innovate", WHOLE, w.a1.id);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /Awards are decided division by division/);
});

test("no setup: a Middle School send shows once, in one All tab (not under both VEX IQ and V5RC)", async () => {
  const w = await world(null);
  await winner("innovate", MS, w.b3.id);
  assert.equal((await released(ADMIN, "PUT", { awardId: "innovate", division: MS })).status, 200);
  const { body } = await released(MARKETING, "GET");
  assert.deepEqual(body.programs.map((p: { label: string }) => p.label), ["All"]);
  assert.equal(body.programs.flatMap((p: { divisions: string[] }) => p.divisions).filter((d: string) => d === MS).length, 1);
});
