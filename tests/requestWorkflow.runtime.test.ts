import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

import type { Session } from "../src/lib/auth";
import type { Panel, RequestRow, Team } from "../src/lib/types";

/* Request-workflow integrity: BUG-006, 011, 016, 018 and the queue-desk /
   anonymous cancel decisions, driven through the REAL route handlers
   (PATCH /api/requests/[id], POST /api/requests) against the real file
   store -- not a copy of their logic.

   The handlers call getSession(), which reads cookies() and so needs a
   Next request scope. tests/authHardening.test.ts works around that by
   checking route source; here the scope is built by hand instead: Next's
   own AsyncLocalStorages are entered with a request store whose cookie jar
   holds a session token signed with the test secret. That leans on Next
   15.5 internals (dist paths, the store shape), which is acceptable for a
   test that is pinned to the lockfile; if a Next upgrade moves them, this
   is the one file to repair.

   Env and the global are set before anything imports the store or Next,
   because file.ts resolves DATA_FILE once at load, and Next's request
   storage checks for a global AsyncLocalStorage when it is first loaded. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-workflow-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "request-workflow-test-secret-0123456789";
delete process.env.DATABASE_URL;
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

const ES = "Elementary School";
const STALE = /changed on another screen/;

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
  return workAsyncStorage.run({ route: "/api/requests" } as never, () =>
    workUnitAsyncStorage.run({ type: "request", phase: "render", cookies } as never, fn),
  );
}

type Reply = { status: number; body: { error?: string; request?: RequestRow } };

const json = (method: string, url: string, body: unknown) =>
  new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function patch(session: Session | null, id: string, body: Record<string, unknown>): Promise<Reply> {
  const { PATCH } = await import("../src/app/api/requests/[id]/route");
  const res = await inRequestScope(session, () =>
    PATCH(json("PATCH", `http://localhost/api/requests/${id}`, body), { params: Promise.resolve({ id }) }),
  );
  return { status: res.status, body: await res.json() };
}

async function post(session: Session | null, body: Record<string, unknown>): Promise<Reply> {
  const { POST } = await import("../src/app/api/requests/route");
  const res = await inRequestScope(session, () => POST(json("POST", "http://localhost/api/requests", body)));
  return { status: res.status, body: await res.json() };
}

/* ---- the fixture ------------------------------------------------------- */

const store = async () => (await import("../src/lib/db/file")).fileStore;

/** Slot k of a panel built by `world()`: slots 0-8 are over, 9 onward are still to come. */
function slotOf(panel: Panel, k: number) {
  const start = new Date(new Date(panel.slot_start_at!).getTime() + k * panel.slot_minutes * 60_000);
  const end = new Date(start.getTime() + panel.slot_minutes * 60_000);
  return { slotStart: start.toISOString(), slotEnd: end.toISOString() };
}

/**
 * Two panels in one division, one team on each, nothing else.
 *
 * The panels' slot grids start three hours and five minutes ago, so slots
 * 0-8 have ended and 9+ have not (and none ends exactly now, where the
 * `end <= now` boundary would make the test flaky).
 */
async function world() {
  const db = await store();
  await db.resetAll();
  const start = new Date(Date.now() - (3 * 60 + 5) * 60_000).toISOString();
  const mk = (name: string, code: string) =>
    db.createPanel({
      name,
      code,
      division: ES,
      judges: [],
      languages: [],
      sort_order: 1,
      slot_start_at: start,
      slot_minutes: 20,
      slot_count: 18,
    });
  const [panelA, panelB] = [await mk("Panel A", "WFA001"), await mk("Panel B", "WFB001")];

  await db.upsertTeams(
    ["1001", "1002"].map((number) => ({ number, name: `Team ${number}`, pit: null, division: ES, category: "developing" })),
  );
  const teams = await db.listTeams();
  const team = (n: string) => teams.find((t) => t.number === n) as Team;
  await db.updateTeam(team("1001").id, { panel_id: panelA.id });
  await db.updateTeam(team("1002").id, { panel_id: panelB.id });
  return { db, panelA, panelB, t1: team("1001"), t2: team("1002") };
}

type World = Awaited<ReturnType<typeof world>>;

test("only the desk and Judge Advisor can create requests", async () => {
  const w = await world();
  for (const session of [null, judgeOf(w.panelA), REFEREE]) {
    const reply = await post(session, { teamNumber: "1001", kind: "queue", message: "private note" });
    assert.equal(reply.status, 403);
    assert.equal(reply.body.request, undefined);
  }
  assert.equal((await w.db.listRequests()).length, 0);
  assert.equal((await post(QUEUER, { teamNumber: "1001", kind: "queue" })).status, 200);
  assert.equal((await post(ADMIN, { teamNumber: "1002", kind: "queue" })).status, 200);
});

test("public visitors cannot change a booking or read its private fields in a mutation response", async () => {
  const w = await world();
  const held = await booking(w, 12);
  for (const body of [
    { action: "cancel" },
    { action: "ready-now" },
    { action: "reschedule", ...slotOf(w.panelA, 13) },
  ]) {
    const reply = await patch(null, held.id, body);
    assert.equal(reply.status, 403);
    assert.equal(reply.body.request, undefined);
    assert.ok(!JSON.stringify(reply.body).includes("created_by"));
    assert.equal((await patch(judgeOf(w.panelA), held.id, body)).status, 403);
  }
  assert.equal((await reload(w.db, held.id)).status, "scheduled");
});

test("judges can advance status but cannot reopen a completed interview", async () => {
  const w = await world();
  const request = await liveRequest(w, "completed");
  assert.equal((await patch(judgeOf(w.panelA), request.id, { action: "reopen" })).status, 403);
  assert.equal((await reload(w.db, request.id)).status, "completed");
});

/** A walk-up request for t1, moved on to `status` (as the judges would have). */
async function liveRequest({ db, panelA, t1 }: World, status: RequestRow["status"] = "requested") {
  const req = await db.createRequest({
    teamId: t1.id,
    panelId: panelA.id,
    kind: "queue",
    createdBy: "team",
    language: "en",
  });
  return status === "requested"
    ? req
    : db.updateRequest(req.id, {
        status,
        acknowledged_at: "2026-09-01T10:00:00.000Z",
        started_at: status === "acknowledged" ? null : "2026-09-01T10:05:00.000Z",
        finished_at: status === "completed" ? "2026-09-01T10:25:00.000Z" : null,
      });
}

/** A booking for t1 at slot k of panel A, created by whoever `createdBy` names. */
async function booking({ db, panelA, t1 }: World, k: number, createdBy = "team") {
  return db.createRequest({
    teamId: t1.id,
    panelId: panelA.id,
    kind: "slot",
    createdBy,
    language: "en",
    ...slotOf(panelA, k),
  });
}

const reload = async (db: World["db"], id: string) => (await db.findRequest(id)) as RequestRow;

/* ===== BUG-011: compare-and-set, `from`, and the transition table ========= */

test("two screens advancing one request: the stale one is refused instead of advancing it a second time", async () => {
  const w = await world();
  const req = await liveRequest(w);
  const judge = judgeOf(w.panelA);

  // Both screens drew the card as "requested".
  const first = await patch(judge, req.id, { action: "advance", from: "requested" });
  assert.equal(first.status, 200);
  assert.equal(first.body.request?.status, "acknowledged");

  const second = await patch(judge, req.id, { action: "advance", from: "requested" });
  assert.equal(second.status, 409);
  assert.match(second.body.error ?? "", STALE);
  assert.equal(
    (await reload(w.db, req.id)).status,
    "acknowledged",
    "the second screen's click advanced it again, straight past 'on our way'",
  );
});

test("the route hands the store the status it read: a screen that wins between read and write is a 409, not overwritten", async () => {
  const w = await world();
  const req = await liveRequest(w);

  // Another screen lands its change after the route has read "requested"
  // but before its own write. Simulated by doing that change at the moment
  // the route calls the store.
  const real = w.db.updateRequest;
  w.db.updateRequest = async (id, p, ifStatus) => {
    await real(id, { status: "interviewing" });
    return real(id, p, ifStatus);
  };
  try {
    const reply = await patch(ADMIN, req.id, { action: "advance" }); // no `from`: only ifStatus can catch this
    assert.equal(reply.status, 409);
    assert.match(reply.body.error ?? "", STALE);
  } finally {
    w.db.updateRequest = real;
  }
  assert.equal((await reload(w.db, req.id)).status, "interviewing", "the other screen's change was overwritten");
});

test("a completed interview cannot be cancelled by the Judge Advisor", async () => {
  const w = await world();
  const req = await liveRequest(w, "completed");

  const reply = await patch(ADMIN, req.id, { action: "cancel" });
  assert.equal(reply.status, 409);
  const after = await reload(w.db, req.id);
  assert.equal(after.status, "completed");
  assert.equal(after.cancelled_at, null);
});

test("an open request can still be cancelled at every stage before it finishes", async () => {
  for (const status of ["requested", "acknowledged", "interviewing"] as const) {
    const w = await world();
    const req = await liveRequest(w, status);
    const reply = await patch(ADMIN, req.id, { action: "cancel", from: status });
    assert.equal(reply.status, 200, status);
    assert.equal(reply.body.request?.status, "cancelled");
    assert.ok(reply.body.request?.cancelled_at);
  }
});

test("reopen works only on a finished request: a live one is refused and left alone", async () => {
  const w = await world();
  const live = await liveRequest(w, "acknowledged");

  const refused = await patch(ADMIN, live.id, { action: "reopen" });
  assert.equal(refused.status, 409);
  const unchanged = await reload(w.db, live.id);
  assert.equal(unchanged.status, "acknowledged");
  assert.ok(unchanged.acknowledged_at, "a refused reopen must not wipe the timestamps");

  for (const status of ["completed", "cancelled"] as const) {
    const fresh = await world();
    const done = await liveRequest(fresh, "completed");
    if (status === "cancelled") {
      await fresh.db.updateRequest(done.id, { status, finished_at: null, cancelled_at: "2026-09-01T10:30:00.000Z" });
    }
    const reopened = await patch(ADMIN, done.id, { action: "reopen" });
    assert.equal(reopened.status, 200, status);
    assert.equal(reopened.body.request?.status, "requested");
    assert.equal(reopened.body.request?.finished_at, null);
    assert.equal(reopened.body.request?.cancelled_at, null);
  }
});

test("the Judge Advisor's reset to 'requested' on a live request clears the stale timestamps, so the board times the wait from the request", async () => {
  const w = await world();
  const req = await liveRequest(w, "interviewing");

  const reply = await patch(ADMIN, req.id, { action: "set-status", status: "requested", from: "interviewing" });
  assert.equal(reply.status, 200);
  const after = await reload(w.db, req.id);
  assert.equal(after.status, "requested");
  assert.equal(after.acknowledged_at, null);
  assert.equal(after.started_at, null);
});

/* ===== BUG-006: reassign moves the request first, the team only after ===== */

test("reassign: when the request cannot move, the team stays on its panel too", async () => {
  const w = await world();
  const mine = await booking(w, 12);
  // Someone on panel B already holds that very time, so the move is refused.
  await w.db.createRequest({
    teamId: w.t2.id,
    panelId: w.panelB.id,
    kind: "slot",
    createdBy: "team",
    language: "en",
    ...slotOf(w.panelB, 12),
  });

  const reply = await patch(ADMIN, mine.id, { action: "reassign", panelId: w.panelB.id });
  assert.equal(reply.status, 409);

  assert.equal((await reload(w.db, mine.id)).panel_id, w.panelA.id);
  const team = (await w.db.listTeams()).find((t) => t.id === w.t1.id);
  assert.equal(team?.panel_id, w.panelA.id, "the team was moved to panel B although its request stayed on panel A");
});

test("reassign: when it succeeds, the request and the team both move", async () => {
  const w = await world();
  const mine = await booking(w, 12);

  const reply = await patch(ADMIN, mine.id, { action: "reassign", panelId: w.panelB.id });
  assert.equal(reply.status, 200);
  assert.equal((await reload(w.db, mine.id)).panel_id, w.panelB.id);
  assert.equal((await w.db.listTeams()).find((t) => t.id === w.t1.id)?.panel_id, w.panelB.id);
});

test("reassign: a second move from the old panel is refused even when status has not changed", async () => {
  const w = await world();
  const mine = await liveRequest(w);
  await w.db.reassignRequest(mine.id, w.panelA.id, w.panelB.id, mine.status);

  await assert.rejects(
    () => w.db.reassignRequest(mine.id, w.panelA.id, w.panelA.id, mine.status),
    (e: unknown) => (e as { status?: number }).status === 409,
  );
  assert.equal((await reload(w.db, mine.id)).panel_id, w.panelB.id);
  assert.equal((await w.db.listTeams()).find((t) => t.id === w.t1.id)?.panel_id, w.panelB.id);
});

test("reassign: a concurrent move after the route reads the request returns 409", async () => {
  const w = await world();
  const mine = await liveRequest(w);
  const real = w.db.reassignRequest;
  w.db.reassignRequest = async (id, oldPanel, newPanel, status) => {
    await real(id, oldPanel, newPanel, status);
    return real(id, oldPanel, newPanel, status);
  };
  try {
    const reply = await patch(ADMIN, mine.id, { action: "reassign", panelId: w.panelB.id });
    assert.equal(reply.status, 409);
  } finally {
    w.db.reassignRequest = real;
  }
  assert.equal((await reload(w.db, mine.id)).panel_id, w.panelB.id);
  assert.equal((await w.db.listTeams()).find((t) => t.id === w.t1.id)?.panel_id, w.panelB.id);
});

/* ===== BUG-016: "ready now" converts the booking in one write ============= */

test("ready-now turns the booking into a queue request in place: same row, slot cleared, nothing cancelled", async () => {
  const w = await world();
  const held = await booking(w, 12);
  const before = Date.now();

  const reply = await patch(QUEUER, held.id, { action: "ready-now", from: "scheduled", language: "en", message: " by pit 4 " });
  assert.equal(reply.status, 200);

  const row = reply.body.request as RequestRow;
  assert.equal(row.id, held.id);
  assert.equal(row.kind, "queue");
  assert.equal(row.status, "requested");
  assert.equal(row.slot_start, null);
  assert.equal(row.slot_end, null);
  assert.ok(new Date(row.requested_at).getTime() >= before, "the wait should be timed from now, not from when it was booked");
  assert.equal(row.message, "by pit 4");

  const mine = (await w.db.listRequests()).filter((r) => r.team_id === w.t1.id);
  assert.deepEqual(mine.map((r) => r.status), ["requested"], "the team must hold exactly one live request");
});

test("ready-now keeps the booking when it cannot go through", async () => {
  const w = await world();
  const held = await booking(w, 12);

  // Refused for a caller who may not touch it, and for a stale screen.
  assert.equal((await patch(REFEREE, held.id, { action: "ready-now" })).status, 403);
  const stale = await patch(QUEUER, held.id, { action: "ready-now", from: "requested" });
  assert.equal(stale.status, 409);

  const row = await reload(w.db, held.id);
  assert.equal(row.status, "scheduled");
  assert.equal(row.kind, "slot");
  assert.equal(row.slot_start, slotOf(w.panelA, 12).slotStart);
});

test("ready-now is for bookings only", async () => {
  const w = await world();
  const walkUp = await liveRequest(w);
  const reply = await patch(QUEUER, walkUp.id, { action: "ready-now" });
  assert.equal(reply.status, 409);
  assert.equal((await reload(w.db, walkUp.id)).status, "requested");
});

test("ready-now cannot resurrect a booking another screen has just cancelled", async () => {
  const w = await world();
  const held = await booking(w, 12);

  // Another desk screen cancels after this screen read the booking.
  const real = w.db.updateRequest;
  w.db.updateRequest = async (id, p, ifStatus) => {
    await real(id, { status: "cancelled", cancelled_at: new Date().toISOString() });
    return real(id, p, ifStatus);
  };
  try {
    const reply = await patch(QUEUER, held.id, { action: "ready-now" });
    assert.equal(reply.status, 409);
  } finally {
    w.db.updateRequest = real;
  }
  assert.equal((await reload(w.db, held.id)).status, "cancelled");
});

test("ready-now does not re-run the walking-gap check against the slot it is giving up", async () => {
  const w = await world();
  const held = await booking(w, 12);
  // A state the gap rule exists to prevent, but that a Postgres insert race
  // or an older version of the app can leave behind: a neighbour 10 minutes
  // away on the same panel. Written straight to the row, as no API could.
  const neighbour = await w.db.createRequest({
    teamId: w.t2.id,
    panelId: w.panelA.id,
    kind: "slot",
    createdBy: "team",
    language: "en",
    ...slotOf(w.panelA, 14),
  });
  const slot = new Date(slotOf(w.panelA, 12).slotStart).getTime();
  (await w.db.listRequests()).find((r) => r.id === neighbour.id)!.slot_start = new Date(slot + 10 * 60_000).toISOString();

  const reply = await patch(QUEUER, held.id, { action: "ready-now" });
  assert.equal(reply.status, 200, reply.body.error);
});

/* ===== D1: the queue desk works any early request ========================= */

test("the queue desk can cancel, reschedule and ready-now a team-made booking", async () => {
  const w = await world();

  const cancelled = await booking(w, 12, "team");
  assert.equal((await patch(QUEUER, cancelled.id, { action: "cancel", from: "scheduled" })).status, 200);

  const moved = await booking(w, 12, "team");
  const target = slotOf(w.panelA, 13);
  assert.equal((await patch(QUEUER, moved.id, { action: "reschedule", ...target })).status, 200);
  assert.equal((await reload(w.db, moved.id)).slot_start, target.slotStart);

  assert.equal((await patch(QUEUER, moved.id, { action: "ready-now" })).status, 200);

  const queued = await w.db.createRequest({
    teamId: w.t2.id,
    panelId: w.panelB.id,
    kind: "queue",
    createdBy: "admin:Someone",
    language: "en",
  });
  assert.equal((await patch(QUEUER, queued.id, { action: "cancel" })).status, 200);
});

test("the queue desk still cannot touch a request judges have taken", async () => {
  const w = await world();
  const req = await liveRequest(w, "acknowledged");
  assert.equal((await patch(QUEUER, req.id, { action: "cancel" })).status, 403);
  assert.equal((await reload(w.db, req.id)).status, "acknowledged");
});

/* ===== Public visitors may only read status =============================== */

test("a team with no login cannot cancel an early request", async () => {
  const w = await world();
  const early = await liveRequest(w);
  assert.equal((await patch(null, early.id, { action: "cancel" })).status, 403);

  const w2 = await world();
  const underway = await liveRequest(w2, "acknowledged");
  assert.equal((await patch(null, underway.id, { action: "cancel" })).status, 403);
});

/* ===== BUG-018: a slot that is already over is refused ==================== */

test("booking a slot that has already ended is a 409; a slot still to come is accepted", async () => {
  const w = await world();

  const past = await post(QUEUER, { teamNumber: "1001", kind: "slot", ...slotOf(w.panelA, 3) });
  assert.equal(past.status, 409);
  assert.equal(past.body.error, "That slot has already passed.");
  assert.equal((await w.db.listRequests()).length, 0, "an expired booking was created anyway");

  const future = await post(QUEUER, { teamNumber: "1001", kind: "slot", ...slotOf(w.panelA, 12) });
  assert.equal(future.status, 200, future.body.error);
});

test("rescheduling onto a slot that has already ended is a 409 and leaves the booking where it was", async () => {
  const w = await world();
  const held = await booking(w, 12);

  const past = await patch(ADMIN, held.id, { action: "reschedule", ...slotOf(w.panelA, 3) });
  assert.equal(past.status, 409);
  assert.equal(past.body.error, "That slot has already passed.");
  assert.equal((await reload(w.db, held.id)).slot_start, slotOf(w.panelA, 12).slotStart);

  const future = await patch(ADMIN, held.id, { action: "reschedule", ...slotOf(w.panelA, 14) });
  assert.equal(future.status, 200, future.body.error);
});

/* ===== the screens: what they send (source-checked, like the other pages) = */

const root = new URL("..", import.meta.url).pathname;
const page = (path: string) => readFileSync(join(root, path), "utf8");

test("the judge and admin consoles say which status they were showing when a button was pressed", () => {
  assert.match(page("src/app/judge/page.tsx"), /body: \{ action, from: request\.status, \.\.\.extra \}/);
  // The Floor's writes moved out of the page with the Floor itself (src/components/admin/FloorTab.tsx).
  assert.match(page("src/components/admin/FloorTab.tsx"), /body: \{ action, from: request\.status, \.\.\.extra \}/);
  // ...and so does the Teams tab's status override (src/components/admin/teamsLogic.ts).
  assert.match(page("src/components/admin/teamsLogic.ts"), /body: \{ action, from: request\.status, \.\.\.\(action === "set-status"/);
});

test("'ready now' is one call on the desk screen, never cancel-then-create", () => {
  const desk = page("src/app/queue/page.tsx");
  const interviewNow = desk.slice(desk.indexOf("function interviewNow"), desk.indexOf("const bookSlot"));
  assert.match(desk, /action: "ready-now"/);
  assert.ok(interviewNow.includes("booking?.id"), "interviewNow no longer hands the booking to the single ready-now call");
  assert.ok(!interviewNow.includes('"cancel"'), "interviewNow cancels the booking again, then creates a request");
});
