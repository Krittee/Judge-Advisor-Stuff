import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

import type { Session } from "../src/lib/auth";
import type { Panel, Team } from "../src/lib/types";

/* The Awards Desk's /api/awards/released -- read, send one, send all ready, recall --
   driven through the REAL route handler against the real file store, with the same
   hand-built request scope as awardsRoute.runtime.test.ts. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-awards-released-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "awards-released-test-secret-0123456789";
delete process.env.DATABASE_URL;
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

const ES = "Elementary School";
const MS = "Middle School";
const ONLY_JA = "Only the Judge Advisor can send awards to Marketing.";

const ADMIN: Session = { role: "admin", name: "Alex" };
const MARKETING: Session = { role: "marketing", name: "Pim" };
const QUEUER: Session = { role: "queuer", name: "Desk" };
const REFEREE: Session = { role: "referee", name: "Ref" };
const COORDINATOR: Session = { role: "coordinator", name: "Coco" };
const judgeOf = (panel: Panel, name = "Amy"): Session => ({
  role: "judge",
  name,
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
  return workAsyncStorage.run({ route: "/api/test" } as never, () =>
    workUnitAsyncStorage.run({ type: "request", phase: "render", cookies } as never, fn),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Reply = { status: number; body: any; headers: Headers };
type Handlers = Record<string, (request: Request) => Promise<Response>>;

async function hit(
  load: () => Promise<unknown>,
  method: "GET" | "POST" | "PUT" | "DELETE",
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

const releasedRoute = () => import("../src/app/api/awards/released/route");
const stateRoute = () => import("../src/app/api/state/route");
const released = (session: Session | null, method: "GET" | "POST" | "PUT" | "DELETE", body?: unknown) =>
  hit(releasedRoute, method, session, "/api/awards/released", body);
const send = (session: Session | null, awardId: string, division: string) => released(session, "PUT", { awardId, division });
const recall = (session: Session | null, awardId: string, division: string) => released(session, "DELETE", { awardId, division });

/* ---- the fixture ------------------------------------------------------- */

async function world() {
  const db = (await import("../src/lib/db/file")).fileStore;
  await db.resetAll();
  const panel = await db.createPanel({
    name: "Panel 1",
    code: "AW1001",
    division: ES,
    judges: [],
    languages: [],
    sort_order: 1,
    slot_start_at: null,
    slot_minutes: 20,
    slot_count: 0,
  });
  const spec: [string, string, string][] = [
    ["9882K", "Hawks", ES],
    ["7700B", "Bolts", ES],
    ["1234", "Comets", ES],
    ["2088C", "Storm", MS],
  ];
  await db.upsertTeams(spec.map(([number, name, division]) => ({ number, name, pit: null, division, category: "developing" })));
  const teams = await db.listTeams();
  const team = (n: string) => teams.find((t) => t.number === n) as Team;
  const [hawks, bolts, comets, storm] = ["9882K", "7700B", "1234", "2088C"].map(team);
  return { db, panel, hawks, bolts, comets, storm };
}
type World = Awaited<ReturnType<typeof world>>;

const win = (w: World, awardId: string, team: Team, places = 1) =>
  w.db.setWinner({ awardId, division: team.division, teamId: team.id, decidedBy: "Alex", places });
const judgesWin = (w: World, team: Team) => win(w, "judges", team, 2);
const logs = async (w: World) =>
  (await w.db.listActivity()).filter((a) => a.kind === "award").map((a) => `${a.action} | ${a.detail}`).sort();

/* ===== who may ============================================================ */

test("only the Judge Advisor sends, recalls or sends all; marketing and admin read; everyone else is 403", async () => {
  const w = await world();
  await win(w, "excellence", w.hawks);
  const judge = judgeOf(w.panel);

  for (const [who, session] of [["judge", judge], ["queuer", QUEUER], ["referee", REFEREE], ["coordinator", COORDINATOR], ["marketing", MARKETING], ["nobody", null]] as [string, Session | null][]) {
    for (const reply of [await send(session, "excellence", ES), await recall(session, "excellence", ES), await released(session, "POST")]) {
      assert.equal(reply.status, 403, `${who} writes`);
      assert.equal(reply.body.error, ONLY_JA, who);
    }
  }
  assert.deepEqual(await w.db.listReleases(), [], "nothing was written");

  for (const [who, session] of [["judge", judge], ["queuer", QUEUER], ["referee", REFEREE], ["coordinator", COORDINATOR], ["nobody", null]] as [string, Session | null][]) {
    assert.equal((await released(session, "GET")).status, 403, `${who} reads`);
  }
  assert.equal((await released(ADMIN, "GET")).status, 200);
  assert.equal((await released(MARKETING, "GET")).status, 200);
});

/* ===== sending ============================================================ */

test("an award without its winners is 409; a single winner or No winner sends; the reply and the log say so", async () => {
  const w = await world();
  const open = await send(ADMIN, "excellence", ES);
  assert.equal(open.status, 409);
  assert.equal(open.body.error, `Excellence in ${ES} is not decided yet. Pick its winner (or both for the Judges Award) or mark it No winner first.`);

  assert.equal((await send(ADMIN, "", ES)).status, 400);
  assert.equal((await send(ADMIN, "excellence", "")).status, 400);
  assert.equal((await send(ADMIN, "nonsense", ES)).status, 400);

  await win(w, "excellence", w.hawks);
  const sent = await send(ADMIN, "excellence", ES);
  assert.equal(sent.status, 200);
  const r = sent.body.release;
  assert.deepEqual([r.award_id, r.division, r.status, r.sent_by, r.no_winner, r.previous, r.changed_at], ["excellence", ES, "sent", "Alex", false, null, null]);
  assert.deepEqual(r.teams, [{ id: w.hawks.id, number: "9882K", name: "Hawks" }]);

  await w.db.setNoWinner({ awardId: "design", division: ES, decidedBy: "Alex" });
  const none = await send(ADMIN, "design", ES);
  assert.deepEqual([none.status, none.body.release.no_winner, none.body.release.teams], [200, true, []]);

  assert.deepEqual(await logs(w), [`sent Design to Marketing | ${ES} · No winner`, `sent Excellence to Marketing | ${ES} · 9882K`]);
  const [entry] = (await w.db.listActivity()).filter((a) => a.action === "sent Excellence to Marketing");
  assert.deepEqual([entry.actor, entry.team_id], ["Alex", w.hawks.id]);
});

test("the Judges Award needs both places: one is 409, two sends both teams", async () => {
  const w = await world();
  await judgesWin(w, w.hawks);
  assert.equal((await send(ADMIN, "judges", ES)).status, 409);
  await judgesWin(w, w.bolts);
  const sent = await send(ADMIN, "judges", ES);
  assert.equal(sent.status, 200);
  assert.deepEqual(sent.body.release.teams.map((t: { number: string }) => t.number), ["7700B", "9882K"]);
  assert.deepEqual(await logs(w), [`sent Judges to Marketing | ${ES} · 7700B and 9882K`]);
});

test("sending a sent award again changes nothing and logs nothing", async () => {
  const w = await world();
  await win(w, "excellence", w.hawks);
  const first = await send(ADMIN, "excellence", ES);
  const again = await send(ADMIN, "excellence", ES);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.release, first.body.release);
  assert.equal((await logs(w)).length, 1);
  assert.equal((await w.db.listReleases()).length, 1);
});

/* ===== recalling ========================================================== */

test("recall then re-send the same teams: status sent, previous and changed_at untouched", async () => {
  const w = await world();
  await judgesWin(w, w.hawks);
  await judgesWin(w, w.bolts);
  await send(ADMIN, "judges", ES);

  const gone = await recall(ADMIN, "judges", ES);
  assert.deepEqual([gone.status, gone.body.release.status], [200, "recalled"]);
  assert.deepEqual(await logs(w), [`recalled Judges from Marketing | ${ES}`, `sent Judges to Marketing | ${ES} · 7700B and 9882K`]);

  // Same two teams, set again in the other order.
  await w.db.clearWinner("judges", ES);
  await judgesWin(w, w.bolts);
  await judgesWin(w, w.hawks);
  const back = await send(ADMIN, "judges", ES);
  assert.deepEqual([back.status, back.body.release.status, back.body.release.previous, back.body.release.changed_at], [200, "sent", null, null]);
  assert.ok(!(await logs(w)).some((l) => l.includes("· was")));
});

test("recall then send a different team: previous is the old snapshot, changed_at set; a third change makes previous the one just replaced", async () => {
  const w = await world();
  await win(w, "excellence", w.hawks);
  await send(ADMIN, "excellence", ES);
  await recall(ADMIN, "excellence", ES);

  await win(w, "excellence", w.bolts);
  const second = await send(ADMIN, "excellence", ES);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.release.teams.map((t: { number: string }) => t.number), ["7700B"]);
  assert.deepEqual(second.body.release.previous.teams.map((t: { number: string }) => t.number), ["9882K"]);
  assert.equal(second.body.release.previous.no_winner, false);
  assert.ok(second.body.release.changed_at);
  assert.ok((await logs(w)).includes(`sent Excellence to Marketing | ${ES} · 7700B · was 9882K`));

  await recall(ADMIN, "excellence", ES);
  await win(w, "excellence", w.comets);
  const third = await send(ADMIN, "excellence", ES);
  assert.deepEqual(third.body.release.previous.teams.map((t: { number: string }) => t.number), ["7700B"]);
  assert.ok((await logs(w)).includes(`sent Excellence to Marketing | ${ES} · 1234 · was 7700B`));
});

test("No winner to a team after recall counts as a change", async () => {
  const w = await world();
  await w.db.setNoWinner({ awardId: "excellence", division: ES, decidedBy: "Alex" });
  await send(ADMIN, "excellence", ES);
  await recall(ADMIN, "excellence", ES);
  await w.db.clearNoWinner("excellence", ES);
  await win(w, "excellence", w.hawks);
  const again = await send(ADMIN, "excellence", ES);
  assert.deepEqual(again.body.release.previous, { teams: [], no_winner: true });
  assert.ok(again.body.release.changed_at);
  assert.ok((await logs(w)).includes(`sent Excellence to Marketing | ${ES} · 9882K · was No winner`));
});

test("recalling what was never sent is 404; recalling twice is 200 and logs once", async () => {
  const w = await world();
  const none = await recall(ADMIN, "excellence", ES);
  assert.equal(none.status, 404);
  assert.equal(none.body.error, "Excellence has not been sent to Marketing.");
  assert.equal((await recall(ADMIN, "", ES)).status, 400);

  await win(w, "excellence", w.hawks);
  await send(ADMIN, "excellence", ES);
  await recall(ADMIN, "excellence", ES);
  const twice = await recall(ADMIN, "excellence", ES);
  assert.deepEqual([twice.status, twice.body.release.status], [200, "recalled"]);
  assert.equal((await logs(w)).filter((l) => l.startsWith("recalled")).length, 1);
});

/* ===== reading ============================================================ */

test("marketing never sees a recalled decision; admin still does", async () => {
  const w = await world();
  await win(w, "excellence", w.hawks);
  await send(ADMIN, "excellence", ES);
  await recall(ADMIN, "excellence", ES);

  const mk = (await released(MARKETING, "GET")).body.releases[0];
  assert.deepEqual([mk.status, mk.teams, mk.no_winner, mk.previous], ["recalled", [], false, null]);
  const ja = (await released(ADMIN, "GET")).body.releases[0];
  assert.deepEqual([ja.teams.map((t: { number: string }) => t.number), ja.no_winner], [["9882K"], false]);
});

test("send all ready sends every ready, unsent award and lists the rest as skipped with a reason", async () => {
  const w = await world();
  await win(w, "excellence", w.hawks);
  await win(w, "design", w.hawks);
  await win(w, "excellence", w.storm);
  await send(ADMIN, "design", ES); // already sent

  const all = await released(ADMIN, "POST");
  assert.equal(all.status, 200);
  assert.deepEqual(
    all.body.sent.map((r: { award_id: string; division: string }) => `${r.award_id}/${r.division}`),
    [`excellence/${ES}`, `excellence/${MS}`],
  );
  const skipped = all.body.skipped as { awardId: string; division: string; reason: string }[];
  assert.ok(skipped.some((s) => s.awardId === "design" && s.division === ES && s.reason === "already sent"));
  assert.ok(skipped.some((s) => s.awardId === "design" && s.division === MS && s.reason === "not ready"));
  const read = (await released(ADMIN, "GET")).body;
  assert.equal(all.body.sent.length + skipped.length, read.divisions.length * read.awards.length, "every division x award is sent or skipped");
  assert.equal((await logs(w)).filter((l) => l.startsWith("sent Excellence")).length, 2);

  const again = await released(ADMIN, "POST");
  assert.deepEqual(again.body.sent, []);
});

test("the released read carries award list, divisions and rows only", async () => {
  const w = await world();
  await win(w, "excellence", w.hawks);
  await send(ADMIN, "excellence", ES);
  for (const session of [ADMIN, MARKETING]) {
    const read = await released(session, "GET");
    assert.deepEqual(Object.keys(read.body).sort(), ["awards", "divisions", "releases"]);
    assert.equal(read.headers.get("cache-control"), "no-store");
    assert.deepEqual(Object.keys(read.body.awards[0]).sort(), ["id", "label", "order", "places"]);
    assert.deepEqual(read.body.awards.map((a: { order: number }) => a.order), read.body.awards.map((_: unknown, i: number) => i));
    assert.equal(read.body.awards.find((a: { id: string }) => a.id === "judges").places, 2);
    assert.ok(read.body.divisions.includes(ES) && read.body.divisions.includes(MS));
  }
});

/* ===== /api/state ========================================================= */

test("/api/state carries no releases, whoever asks", async () => {
  const w = await world();
  await win(w, "excellence", w.hawks);
  await send(ADMIN, "excellence", ES);
  for (const session of [ADMIN, MARKETING, null]) {
    const who = session?.role ?? "nobody";
    const state = await hit(stateRoute, "GET", session, "/api/state");
    assert.equal(state.status, 200, who);
    for (const key of Object.keys(state.body)) assert.ok(!/release/i.test(key), `${who}: ${key}`);
    assert.doesNotMatch(JSON.stringify(state.body), /released|sent_by|sent_at/i, who);
  }
});
