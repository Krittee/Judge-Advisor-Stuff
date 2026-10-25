import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

import type { Session } from "../src/lib/auth";
import type { Panel, RequestRow, Team } from "../src/lib/types";

/* The Judge Advisor's step-time correction: PATCH /api/requests/[id] with
   action "set-times", driven through the REAL route handler against the real
   file store. The rules themselves (which steps, which day, which order) are
   src/lib/stepTimes.ts, run on their own in adminTeams.logic.test.mjs; this
   file is who may use it, what the route answers, and what the store keeps.

   The request scope is built by hand exactly as requestWorkflow.runtime.test.ts
   does (Next's own AsyncLocalStorages entered with a cookie jar holding a signed
   session); if a Next upgrade moves those internals, repair both files. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-times-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "request-times-test-secret-0123456789";
delete process.env.DATABASE_URL;
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

const ES = "Elementary School";
const STALE = /changed on another screen/;

const ADMIN: Session = { role: "admin", name: "Judge Advisor" };
const QUEUER: Session = { role: "queuer", name: "Desk" };
const REFEREE: Session = { role: "referee", name: "Ref" };
const judgeOf = (panel: Panel): Session => ({ role: "judge", name: "Amy", panelId: panel.id, panelName: panel.name });

async function inRequestScope<T>(session: Session | null, fn: () => Promise<T>): Promise<T> {
  const [{ workAsyncStorage }, { workUnitAsyncStorage }, { RequestCookies }, { RequestCookiesAdapter }] = await Promise.all([
    import("next/dist/server/app-render/work-async-storage.external"),
    import("next/dist/server/app-render/work-unit-async-storage.external"),
    import("next/dist/server/web/spec-extension/cookies"),
    import("next/dist/server/web/spec-extension/adapters/request-cookies"),
  ]);

  const headers = new Headers();
  if (session) {
    const panel = session.role === "judge" ? await (await import("../src/lib/db/file")).fileStore.findPanelById(session.panelId) : null;
    if (session.role === "judge") assert.ok(panel);
    const judgeClaims = panel
      ? {
          panelAuth: createHmac("sha256", process.env.SESSION_SECRET!).update(panel.id).update("\0").update(panel.code.toUpperCase()).digest("hex"),
          judgeDay: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
        }
      : {};
    const token = await new SignJWT({ ...session, ...judgeClaims })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET));
    headers.set("cookie", `jq_session=${token}`);
  }
  const cookies = RequestCookiesAdapter.seal(new RequestCookies(headers));
  return workAsyncStorage.run({ route: "/api/requests" } as never, () =>
    workUnitAsyncStorage.run({ type: "request", phase: "render", cookies } as never, fn),
  );
}

type Reply = { status: number; body: { error?: string; request?: RequestRow } };

async function patch(session: Session | null, id: string, body: Record<string, unknown>): Promise<Reply> {
  const { PATCH } = await import("../src/app/api/requests/[id]/route");
  const res = await inRequestScope(session, () =>
    PATCH(new Request(`http://localhost/api/requests/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
      params: Promise.resolve({ id }),
    }),
  );
  return { status: res.status, body: await res.json() };
}

const setTimes = (session: Session | null, id: string, times: unknown, from?: string) =>
  patch(session, id, { action: "set-times", ...(from ? { from } : {}), times });

/* ---- the fixture ------------------------------------------------------- */

const store = async () => (await import("../src/lib/db/file")).fileStore;
const reload = async (id: string) => (await (await store()).findRequest(id)) as RequestRow;

/* One interview on 2026-10-20, Bangkok time (UTC+7): asked 10:00, on the way
   10:05, started 10:10, finished 10:40. */
const DAY = { requested_at: "2026-10-20T03:00:00.000Z", acknowledged_at: "2026-10-20T03:05:00.000Z", started_at: "2026-10-20T03:10:00.000Z", finished_at: "2026-10-20T03:40:00.000Z" };

async function world() {
  const db = await store();
  await db.resetAll();
  const panel = await db.createPanel({
    name: "Panel A",
    code: "TMA001",
    division: ES,
    judges: [],
    languages: [],
    sort_order: 1,
    slot_start_at: new Date(Date.now() + 3_600_000).toISOString(),
    slot_minutes: 20,
    slot_count: 6,
  });
  await db.upsertTeams([{ number: "1001", name: "Team 1001", pit: null, division: ES, category: "developing" }]);
  const team = (await db.listTeams())[0] as Team;
  await db.updateTeam(team.id, { panel_id: panel.id });
  return { db, panel, team };
}

type World = Awaited<ReturnType<typeof world>>;

async function interview({ db, panel, team }: World, patchOver: Partial<RequestRow> = {}) {
  const req = await db.createRequest({ teamId: team.id, panelId: panel.id, kind: "queue", createdBy: "team", language: "en" });
  return db.updateRequest(req.id, { status: "completed", ...DAY, ...patchOver });
}

/* ---- who may -------------------------------------------------------------- */

test("the Judge Advisor corrects a step time: the store keeps it, the status stays, and Activity says what moved", async () => {
  const w = await world();
  const req = await interview(w);

  const reply = await setTimes(ADMIN, req.id, { finished_at: "2026-10-20T03:32:00.000Z" }, "completed");
  assert.equal(reply.status, 200, reply.body.error);
  assert.equal(reply.body.request?.finished_at, "2026-10-20T03:32:00.000Z");

  const kept = await reload(req.id);
  assert.equal(kept.finished_at, "2026-10-20T03:32:00.000Z");
  assert.equal(kept.status, "completed", "times only: the status is not touched");
  for (const field of ["requested_at", "acknowledged_at", "started_at"] as const) assert.equal(kept[field], DAY[field], `${field} was not named`);

  const line = (await w.db.listActivity()).find((a) => a.request_id === req.id);
  assert.equal(line?.action, "corrected times: finished 10:40 → 10:32");
  assert.equal(line?.actor_role, "Judge Advisor");
});

test("several steps in one save, each named in the Activity line", async () => {
  const w = await world();
  const req = await interview(w);
  const reply = await setTimes(ADMIN, req.id, { started_at: "2026-10-20T03:12:00.000Z", finished_at: "2026-10-20T03:45:00.000Z" });
  assert.equal(reply.status, 200, reply.body.error);
  const line = (await w.db.listActivity()).find((a) => a.request_id === req.id);
  assert.equal(line?.action, "corrected times: started 10:10 → 10:12, finished 10:40 → 10:45");
});

test("a judge (even on the request's own panel), the desk, a referee and a visitor are refused, and nothing changes", async () => {
  const w = await world();
  const req = await interview(w);
  for (const session of [judgeOf(w.panel), QUEUER, REFEREE, null]) {
    const reply = await setTimes(session, req.id, { finished_at: "2026-10-20T03:32:00.000Z" });
    assert.equal(reply.status, 403, session?.role ?? "visitor");
    assert.equal(reply.body.request, undefined);
  }
  assert.equal((await reload(req.id)).finished_at, DAY.finished_at);
  assert.equal((await w.db.listActivity()).filter((a) => a.request_id === req.id).length, 0);
});

/* ---- what is refused ------------------------------------------------------ */

test("times out of order are a 400 that names the pair, and equal times are fine", async () => {
  const w = await world();
  const req = await interview(w);
  const before = async (times: Record<string, string>, message: RegExp) => {
    const reply = await setTimes(ADMIN, req.id, times);
    assert.equal(reply.status, 400, JSON.stringify(times));
    assert.match(reply.body.error ?? "", message);
  };
  await before({ finished_at: "2026-10-20T03:05:00.000Z" }, /Finished \(10:05\) can't be before Started \(10:10\)/);
  await before({ started_at: "2026-10-20T03:50:00.000Z" }, /Finished \(10:40\) can't be before Started \(10:50\)/);
  await before({ acknowledged_at: "2026-10-20T02:55:00.000Z", requested_at: "2026-10-20T03:30:00.000Z" }, /On the way \(09:55\) can't be before Requested \(10:30\)/);
  const kept = await reload(req.id);
  for (const field of Object.keys(DAY) as (keyof typeof DAY)[]) assert.equal(kept[field], DAY[field], `refusals left ${field} as it was`);

  assert.equal((await setTimes(ADMIN, req.id, { finished_at: DAY.started_at })).status, 200, "finishing the minute it started is in order");
});

test("a request already out of order can still have an unrelated time corrected", async () => {
  const w = await world();
  // On the way after Started: what a status step-back leaves behind.
  const req = await interview(w, { acknowledged_at: "2026-10-20T03:20:00.000Z" });
  assert.equal((await setTimes(ADMIN, req.id, { finished_at: "2026-10-20T03:45:00.000Z" })).status, 200);
  assert.equal((await setTimes(ADMIN, req.id, { started_at: "2026-10-20T03:30:00.000Z" })).status, 200, "this one repairs the pair");
});

test("a step the request has not reached is a 400: a waiting request has only its Requested time", async () => {
  const w = await world();
  const req = await w.db.createRequest({ teamId: w.team.id, panelId: w.panel.id, kind: "queue", createdBy: "team", language: "en" });
  await w.db.updateRequest(req.id, { requested_at: DAY.requested_at });
  for (const field of ["acknowledged_at", "started_at", "finished_at", "cancelled_at"]) {
    const reply = await setTimes(ADMIN, req.id, { [field]: "2026-10-20T03:32:00.000Z" });
    assert.equal(reply.status, 400, field);
    assert.match(reply.body.error ?? "", /has not reached/);
  }
  assert.equal((await setTimes(ADMIN, req.id, { requested_at: "2026-10-20T03:01:00.000Z" })).status, 200);
});

test("a booking has no Requested time to correct (that is when it was booked)", async () => {
  const w = await world();
  const slot = new Date(Date.now() + 3_600_000);
  const booked = await w.db.createRequest({
    teamId: w.team.id, panelId: w.panel.id, kind: "slot", createdBy: "team", language: "en",
    slotStart: slot.toISOString(), slotEnd: new Date(slot.getTime() + 20 * 60_000).toISOString(),
  });
  const reply = await setTimes(ADMIN, booked.id, { requested_at: new Date().toISOString() });
  assert.equal(reply.status, 400);
  assert.match(reply.body.error ?? "", /has not reached "Requested"/);
});

test("a time on another day is a 400, and the day is Bangkok's: 00:30 there is the evening before in UTC", async () => {
  const w = await world();
  const req = await interview(w);
  const other = await setTimes(ADMIN, req.id, { finished_at: "2026-10-21T03:32:00.000Z" });
  assert.equal(other.status, 400);
  assert.match(other.body.error ?? "", /own day \(2026-10-20, Bangkok time\)/);

  const late = await setTimes(ADMIN, req.id, { finished_at: "2026-10-20T17:30:00.000Z" }); // 00:30 on the 21st in Bangkok
  assert.equal(late.status, 400);

  const early = await setTimes(ADMIN, req.id, { requested_at: "2026-10-19T17:30:00.000Z" }); // 00:30 on the 20th in Bangkok
  assert.equal(early.status, 200, early.body.error);
});

test("a stale screen is a 409 and writes nothing", async () => {
  const w = await world();
  const req = await interview(w);
  const reply = await setTimes(ADMIN, req.id, { finished_at: "2026-10-20T03:32:00.000Z" }, "interviewing");
  assert.equal(reply.status, 409);
  assert.match(reply.body.error ?? "", STALE);
  assert.equal((await reload(req.id)).finished_at, DAY.finished_at);
});

test("nothing to change, an unknown step and a time that is not a time are each a 400", async () => {
  const w = await world();
  const req = await interview(w);
  for (const times of [undefined, null, {}, [], "10:32", { status: "requested" }, { finished_at: "ten thirty" }, { finished_at: null }, { finished_at: 1 }]) {
    const reply = await setTimes(ADMIN, req.id, times);
    assert.equal(reply.status, 400, JSON.stringify(times));
  }
  assert.equal((await reload(req.id)).status, "completed");
});

test("a cancelled request's Cancelled time is corrected too, never earlier than the steps it reached", async () => {
  const w = await world();
  const req = await interview(w, { status: "cancelled", finished_at: null, started_at: null, cancelled_at: "2026-10-20T03:20:00.000Z" });
  assert.equal((await setTimes(ADMIN, req.id, { cancelled_at: "2026-10-20T03:01:00.000Z" })).status, 400, "before it was acknowledged");
  const ok = await setTimes(ADMIN, req.id, { cancelled_at: "2026-10-20T03:25:00.000Z" });
  assert.equal(ok.status, 200, ok.body.error);
  assert.equal((await reload(req.id)).status, "cancelled");
});
