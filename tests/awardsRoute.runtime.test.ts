import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

import type { Session } from "../src/lib/auth";
import type { Panel, Team } from "../src/lib/types";

/* The awards routes -- /api/awards and /api/awards/winners -- driven through
   the REAL route handlers against the real file store, with the same hand-built
   request scope as judgeRoutes.runtime.test.ts (see requestWorkflow.runtime.test.ts
   for why). What is pinned: who may nominate what, what each role is allowed to
   read, who decides the winners, and that none of it reaches /api/state. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-awards-routes-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "awards-routes-test-secret-0123456789";
delete process.env.DATABASE_URL;
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

const ES = "Elementary School";
const MS = "Middle School";

const ADMIN: Session = { role: "admin", name: "Alex" };
const QUEUER: Session = { role: "queuer", name: "Desk" };
const REFEREE: Session = { role: "referee", name: "Ref" };
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
type Reply = { status: number; body: any };
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
  return { status: res.status, body: await res.json() };
}

const awardsRoute = () => import("../src/app/api/awards/route");
const winnersRoute = () => import("../src/app/api/awards/winners/route");
const stateRoute = () => import("../src/app/api/state/route");

const awardsApi = (session: Session | null, method: "GET" | "POST" | "DELETE", body?: unknown, query = "") =>
  hit(awardsRoute, method, session, `/api/awards${query}`, body);
const winnersApi = (session: Session | null, method: "PUT" | "DELETE", body?: unknown) =>
  hit(winnersRoute, method, session, "/api/awards/winners", body);

/* ---- the fixture ------------------------------------------------------- */

/**
 * Panel 1 and Panel 2 judge Elementary, Panel 3 Middle School.
 *   hawks  9882K  ES  Panel 1  interviewed
 *   bolts  7700B  ES  Panel 1  interviewed
 *   rookie 6666   ES  Panel 1  not interviewed yet
 *   busy   4444   ES  Panel 1  an interview under way, none finished
 *   comets 1234   ES  Panel 2  interviewed
 *   drift  5555   ES  no panel interviewed (before it lost its panel)
 *   storm  2088C  MS  Panel 3  interviewed
 */
async function world() {
  const db = (await import("../src/lib/db/file")).fileStore;
  await db.resetAll();
  const mk = (n: number, division: string) =>
    db.createPanel({
      name: `Panel ${n}`,
      code: `AW${n}00${n}`,
      division,
      judges: [],
      languages: [],
      sort_order: n,
      slot_start_at: null,
      slot_minutes: 20,
      slot_count: 0,
    });
  const [p1, p2, p3] = [await mk(1, ES), await mk(2, ES), await mk(3, MS)];

  const spec: [string, string, string][] = [
    ["9882K", "Hawks", ES],
    ["7700B", "Bolts", ES],
    ["6666", "Rookies", ES],
    ["4444", "Busy", ES],
    ["1234", "Comets", ES],
    ["5555", "Drifters", ES],
    ["2088C", "Storm", MS],
  ];
  await db.upsertTeams(spec.map(([number, name, division]) => ({ number, name, pit: null, division, category: "developing" })));
  const teams = await db.listTeams();
  const team = (n: string) => teams.find((t) => t.number === n) as Team;
  const [hawks, bolts, rookie, busy, comets, drift, storm] = ["9882K", "7700B", "6666", "4444", "1234", "5555", "2088C"].map(team);
  for (const [t, p] of [[hawks, p1], [bolts, p1], [rookie, p1], [busy, p1], [comets, p2], [storm, p3]] as [Team, Panel][]) {
    await db.updateTeam(t.id, { panel_id: p.id });
  }

  const request = (t: Team, p: Panel | null) =>
    db.createRequest({ teamId: t.id, panelId: (p ?? p1).id, kind: "queue", createdBy: "team", language: "en" });
  for (const [t, p] of [[hawks, p1], [bolts, p1], [comets, p2], [drift, p2], [storm, p3]] as [Team, Panel][]) {
    await db.updateRequest((await request(t, p)).id, { status: "completed" });
  }
  await db.updateRequest((await request(busy, p1)).id, { status: "interviewing" });

  return { db, p1, p2, p3, hawks, bolts, rookie, busy, comets, drift, storm };
}
type World = Awaited<ReturnType<typeof world>>;

const amy = (w: World) => judgeOf(w.p1, "Amy");
const ben = (w: World) => judgeOf(w.p1, "Ben");
const cleo = (w: World) => judgeOf(w.p2, "Cleo");
const nominate = (session: Session | null, award: string, team: Team, reason?: string) =>
  awardsApi(session, "POST", { awardId: award, teamId: team.id, ...(reason === undefined ? {} : { reason }) });
// The log is stamped to the millisecond and listActivity keeps rows of one millisecond in the order they were
// written (oldest first) inside a newest-first list, so the order of quick successive writes is not something to
// assert: compare the lines as a set, sorted. `sameLines` sorts the expected side the same way.
const sameLines = <T extends string | string[]>(lines: T[]): T[] => [...lines].sort((a, b) => String(a).localeCompare(String(b)));
const logged = async (w: World) =>
  sameLines((await w.db.listActivity()).filter((a) => a.kind === "award").map((a) => a.action));

/* ===== nominating ======================================================== */

test("a judge nominates a team they interviewed; asking again is harmless; the reason is added, changed and cleared", async () => {
  const w = await world();

  const first = await nominate(amy(w), "excellence", w.hawks);
  assert.equal(first.status, 200);
  assert.deepEqual(
    [first.body.nomination.award_id, first.body.nomination.team_id, first.body.nomination.panel_id, first.body.nomination.judge, first.body.nomination.reason],
    ["excellence", w.hawks.id, w.p1.id, "Amy", null],
    "the judge is the session's name and the panel is theirs, not anything the request says",
  );

  const again = await nominate(amy(w), "excellence", w.hawks);
  assert.equal(again.body.nomination.id, first.body.nomination.id, "the same nomination");

  const added = await nominate(amy(w), "excellence", w.hawks, "  Brilliant notebook  ");
  assert.equal(added.body.nomination.reason, "Brilliant notebook", "trimmed");
  assert.equal((await nominate(amy(w), "excellence", w.hawks)).body.nomination.reason, "Brilliant notebook", "a tap with no reason leaves it");
  assert.equal((await nominate(amy(w), "excellence", w.hawks, "Brilliant notebook")).status, 200);
  assert.equal((await nominate(amy(w), "excellence", w.hawks, "x".repeat(600))).body.nomination.reason.length, 500, "cut at 500, as notes are cut at theirs");
  assert.equal((await nominate(amy(w), "excellence", w.hawks, "   ")).body.nomination.reason, null, "an empty reason clears it");

  assert.equal((await w.db.listNominations()).length, 1, "all of that was one nomination");
  assert.deepEqual(
    await logged(w),
    sameLines([
      "nominated 9882K for Excellence",
      "changed the reason for 9882K's Excellence nomination",
      "changed the reason for 9882K's Excellence nomination",
      "changed the reason for 9882K's Excellence nomination",
    ]),
    "a repeat tap writes nothing and so logs nothing; each real change is one line",
  );
  const [entry] = (await w.db.listActivity()).slice(-1);
  assert.deepEqual([entry.kind, entry.actor, entry.actor_role, entry.team_id, entry.team_number], ["award", "Amy", "Panel 1", w.hawks.id, "9882K"]);
});

test("two judges on a panel nominating the same team are two nominations", async () => {
  const w = await world();
  await nominate(amy(w), "design", w.hawks);
  await nominate(ben(w), "design", w.hawks);
  assert.deepEqual(
    (await w.db.listNominations()).map((n) => n.judge).sort(),
    ["Amy", "Ben"],
  );
});

test("a judge is one judge however the name is typed: \"Dana\" then \"dana\" is one nomination, and either can change or withdraw it", async () => {
  const w = await world();
  const first = await nominate(judgeOf(w.p1, "Dana"), "excellence", w.hawks);
  const again = await nominate(judgeOf(w.p1, "dana"), "excellence", w.hawks);
  assert.deepEqual([first.status, again.status], [200, 200]);
  assert.equal(again.body.nomination.id, first.body.nomination.id, "the same nomination, not a second one");
  assert.equal(again.body.nomination.judge, "Dana", "it keeps the spelling it was made with");

  const read = await awardsApi(judgeOf(w.p1, "DANA"), "GET");
  assert.deepEqual(read.body.nominations.map((n: { judge: string }) => n.judge), ["Dana"], "one nomination, not two");

  const reason = await nominate(judgeOf(w.p1, " dana "), "excellence", w.hawks, "Lovely notebook");
  assert.equal(reason.body.nomination.id, first.body.nomination.id, "a reason from the variant name changes the one row");
  assert.deepEqual((await w.db.listNominations()).map((n) => [n.judge, n.reason]), [["Dana", "Lovely notebook"]]);
  assert.deepEqual(
    await logged(w),
    sameLines(["nominated 9882K for Excellence", "changed the reason for 9882K's Excellence nomination"]),
    "the second tap was a repeat, not a second nomination",
  );

  // Another judge is still another judge, and the variant name withdraws only Dana's.
  await nominate(ben(w), "excellence", w.hawks);
  const gone = await awardsApi(judgeOf(w.p1, "dana"), "DELETE", { awardId: "excellence", teamId: w.hawks.id });
  assert.deepEqual([gone.status, gone.body], [200, { ok: true, removed: true }]);
  assert.deepEqual((await w.db.listNominations()).map((n) => n.judge), ["Ben"]);
});

test("a judge cannot nominate a team on another panel, one not yet interviewed, a conflicted one, or for an award that does not exist", async () => {
  const w = await world();
  const priya = await w.db.addJudge({ name: "Priya Nair" });
  await w.db.updateJudge(priya.id, { panel_id: w.p1.id });
  await w.db.addConflict({ judgeId: priya.id, teamId: w.bolts.id, note: null, declaredBy: "admin:JA" });

  const other = await nominate(amy(w), "excellence", w.comets);
  assert.equal(other.status, 403);
  assert.match(other.body.error, /not assigned to your judge panel/);
  assert.equal((await nominate(amy(w), "excellence", w.drift)).status, 403, "a team with no panel is nobody's to nominate");
  assert.equal((await nominate(amy(w), "excellence", w.storm)).status, 403, "nor is another division's");

  const early = await nominate(amy(w), "excellence", w.rookie);
  assert.equal(early.status, 409);
  assert.match(early.body.error, /has not finished an interview/);
  assert.equal((await nominate(amy(w), "excellence", w.busy)).status, 409, "an interview under way is not a finished one");

  const conflicted = await nominate(amy(w), "excellence", w.bolts);
  assert.equal(conflicted.status, 403);
  assert.match(conflicted.body.error, /declared conflict of interest/, "the conflict is the reason given");

  const unknown = await nominate(amy(w), "pizza", w.hawks);
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /award does not exist/);
  assert.equal((await awardsApi(amy(w), "POST", { awardId: "excellence", teamId: "no-such-team" })).status, 404);
  assert.equal((await awardsApi(amy(w), "POST", { awardId: "excellence" })).status, 400);
  assert.equal((await awardsApi(amy(w), "POST", { teamId: w.hawks.id })).status, 400);

  assert.deepEqual(await w.db.listNominations(), [], "none of those wrote anything");
  assert.deepEqual(await logged(w), []);
});

test("only a judge nominates or withdraws: the Judge Advisor, the desk, a referee and a visitor are all refused", async () => {
  const w = await world();
  await nominate(amy(w), "excellence", w.hawks);

  for (const session of [ADMIN, QUEUER, REFEREE, null]) {
    const who = session?.role ?? "nobody";
    assert.equal((await nominate(session, "design", w.hawks)).status, 403, `${who} must not nominate`);
    assert.equal((await awardsApi(session, "DELETE", { awardId: "excellence", teamId: w.hawks.id })).status, 403, `${who} must not withdraw`);
  }
  assert.deepEqual(
    (await w.db.listNominations()).map((n) => [n.award_id, n.judge]),
    [["excellence", "Amy"]],
    "exactly as it was",
  );
});

/* ===== withdrawing ======================================================= */

test("withdrawing removes only your own nomination, and says whether there was one", async () => {
  const w = await world();
  await nominate(amy(w), "excellence", w.hawks);
  await nominate(ben(w), "excellence", w.hawks);
  await nominate(cleo(w), "excellence", w.comets);

  // Cleo, on another panel, naming Amy's team and award: nothing of hers matches.
  const notHers = await awardsApi(cleo(w), "DELETE", { awardId: "excellence", teamId: w.hawks.id });
  assert.deepEqual(notHers.body, { ok: true, removed: false });
  assert.equal((await w.db.listNominations()).length, 3);

  const mine = await awardsApi(amy(w), "DELETE", { awardId: "excellence", teamId: w.hawks.id });
  assert.deepEqual([mine.status, mine.body], [200, { ok: true, removed: true }]);
  assert.deepEqual(
    (await w.db.listNominations()).map((n) => n.judge).sort(),
    ["Ben", "Cleo"],
    "Ben's nomination of the same team and award is still there",
  );

  const twice = await awardsApi(amy(w), "DELETE", { awardId: "excellence", teamId: w.hawks.id });
  assert.deepEqual(twice.body, { ok: true, removed: false });

  // The query string works too, for a client that cannot send a body with DELETE.
  const viaQuery = await awardsApi(ben(w), "DELETE", undefined, `?awardId=excellence&teamId=${w.hawks.id}`);
  assert.deepEqual(viaQuery.body, { ok: true, removed: true });

  // An id that matches nothing is nothing to withdraw, not a failure.
  assert.deepEqual((await awardsApi(amy(w), "DELETE", { awardId: "excellence", teamId: "not-a-uuid" })).body, { ok: true, removed: false });
  assert.equal((await awardsApi(amy(w), "DELETE", { awardId: "excellence" })).status, 400);

  assert.deepEqual(await logged(w), sameLines([
    "nominated 9882K for Excellence",
    "nominated 9882K for Excellence",
    "nominated 1234 for Excellence",
    "withdrew 9882K from Excellence",
    "withdrew 9882K from Excellence",
  ]), "only a real withdrawal is logged");
});

/* ===== reading =========================================================== */

test("a judge reads their own panel's nominations: no winners field at all, and nothing from another panel", async () => {
  const w = await world();
  await nominate(amy(w), "excellence", w.hawks, "Great");
  await nominate(ben(w), "design", w.bolts);
  await nominate(cleo(w), "excellence", w.comets, "Cleo's secret");
  await nominate(judgeOf(w.p3, "Dev"), "excellence", w.storm);
  await w.db.setWinner({ awardId: "excellence", division: ES, teamId: w.hawks.id, decidedBy: "Alex" });

  const reply = await awardsApi(amy(w), "GET");
  assert.equal(reply.status, 200);
  assert.deepEqual(Object.keys(reply.body).sort(), ["awards", "nominations"], "no winners key, not even an empty one");
  assert.deepEqual(
    reply.body.nominations.map((n: { judge: string }) => n.judge).sort(),
    ["Amy", "Ben"],
    "her panel's, her colleague's included",
  );
  assert.equal(reply.body.awards.length, 11);
  assert.deepEqual(Object.keys(reply.body.awards[0]).sort(), ["blurb", "id", "label", "short"]);
  const text = JSON.stringify(reply.body);
  assert.doesNotMatch(text, /winner|decided_by|\bCleo\b|\bDev\b|2088C/i);
  assert.ok(!text.includes(w.comets.id) && !text.includes(w.storm.id), "no other panel's team shows up");

  const theirs = await awardsApi(cleo(w), "GET");
  assert.deepEqual(theirs.body.nominations.map((n: { judge: string }) => n.judge), ["Cleo"]);

  // A team the panel has since been barred from drops out of what they read.
  const priya = await w.db.addJudge({ name: "Priya Nair" });
  await w.db.updateJudge(priya.id, { panel_id: w.p1.id });
  await w.db.addConflict({ judgeId: priya.id, teamId: w.bolts.id, note: null, declaredBy: "admin:JA" });
  assert.deepEqual(
    (await awardsApi(amy(w), "GET")).body.nominations.map((n: { team_id: string }) => n.team_id),
    [w.hawks.id],
  );
});

test("the Judge Advisor reads every nomination from every panel, and the winners", async () => {
  const w = await world();
  await nominate(amy(w), "excellence", w.hawks, "Great");
  await nominate(cleo(w), "excellence", w.comets);
  await nominate(judgeOf(w.p3, "Dev"), "design", w.storm);
  await winnersApi(ADMIN, "PUT", { awardId: "excellence", division: ES, teamId: w.hawks.id });

  const reply = await awardsApi(ADMIN, "GET");
  assert.equal(reply.status, 200);
  assert.deepEqual(Object.keys(reply.body).sort(), ["awards", "nominations", "winners"]);
  assert.deepEqual(reply.body.awards.map((a: { id: string }) => a.id).slice(0, 3), ["excellence", "design", "innovate"]);
  assert.deepEqual(reply.body.nominations.map((n: { judge: string }) => n.judge).sort(), ["Amy", "Cleo", "Dev"]);
  assert.deepEqual(
    reply.body.winners.map((x: { award_id: string; division: string; team_id: string; decided_by: string }) => [x.award_id, x.division, x.team_id, x.decided_by]),
    [["excellence", ES, w.hawks.id, "Alex"]],
  );
});

test("nobody but a judge or the Judge Advisor reads the awards", async () => {
  const w = await world();
  await nominate(amy(w), "excellence", w.hawks, "SECRET-REASON");
  for (const session of [QUEUER, REFEREE, null]) {
    const reply = await awardsApi(session, "GET");
    assert.equal(reply.status, 403, `${session?.role ?? "nobody"} must be refused`);
    assert.deepEqual(reply.body, { error: "Not authorised." }, "and told nothing else");
  }
});

/* ===== winners =========================================================== */

test("only the Judge Advisor sets or clears a winner", async () => {
  const w = await world();
  await nominate(amy(w), "excellence", w.hawks);
  await winnersApi(ADMIN, "PUT", { awardId: "excellence", division: ES, teamId: w.hawks.id });
  const body = { awardId: "excellence", division: ES, teamId: w.hawks.id };

  for (const session of [amy(w), QUEUER, REFEREE, null]) {
    const who = session?.role ?? "nobody";
    assert.equal((await winnersApi(session, "PUT", { ...body, awardId: "design" })).status, 403, `${who} must not decide`);
    assert.equal((await winnersApi(session, "DELETE", body)).status, 403, `${who} must not clear`);
  }
  assert.deepEqual(
    (await w.db.listWinners()).map((x) => [x.award_id, x.team_id]),
    [["excellence", w.hawks.id]],
    "the winner is exactly as the Judge Advisor left it",
  );
});

test("a winner must be a nominee for that award, in that division, for an award that exists", async () => {
  const w = await world();
  await nominate(amy(w), "excellence", w.hawks);
  const put = (over: Record<string, unknown>) =>
    winnersApi(ADMIN, "PUT", { awardId: "excellence", division: ES, teamId: w.hawks.id, ...over });

  const notNominated = await put({ awardId: "design" });
  assert.equal(notNominated.status, 409);
  assert.match(notNominated.body.error, /has not been nominated for Design/);
  assert.equal((await put({ teamId: w.bolts.id })).status, 409, "nominated for nothing");

  const wrongDivision = await put({ division: MS });
  assert.equal(wrongDivision.status, 400);
  assert.match(wrongDivision.body.error, new RegExp(`in ${ES}, not ${MS}`));
  assert.equal((await put({ awardId: "pizza" })).status, 400);
  assert.equal((await put({ teamId: "no-such-team" })).status, 404);
  assert.equal((await put({ division: "" })).status, 400);
  assert.deepEqual(await w.db.listWinners(), [], "none of those decided anything");

  // A nominee of another division's panel, by the same rule: Storm is Middle School.
  await nominate(judgeOf(w.p3, "Dev"), "excellence", w.storm);
  assert.equal((await put({ teamId: w.storm.id })).status, 400, "Storm is not an Elementary team");
  assert.equal((await put({ teamId: w.storm.id, division: MS })).status, 200);
});

test("the Judge Advisor decides, replaces and clears a winner, and each is logged", async () => {
  const w = await world();
  await nominate(amy(w), "excellence", w.hawks);
  await nominate(amy(w), "excellence", w.bolts);
  await nominate(amy(w), "design", w.hawks);
  const put = (awardId: string, team: Team, division = ES) => winnersApi(ADMIN, "PUT", { awardId, division, teamId: team.id });

  const first = await put("excellence", w.hawks);
  assert.equal(first.status, 200);
  assert.deepEqual(
    [first.body.winner.award_id, first.body.winner.division, first.body.winner.team_id, first.body.winner.decided_by],
    ["excellence", ES, w.hawks.id, "Alex"],
  );
  assert.equal((await put("excellence", w.hawks)).status, 200, "picking the same team again");
  assert.equal((await w.db.listWinners()).length, 1);

  // The caution is the screen's: a team that already has an award is still allowed another.
  assert.equal((await put("design", w.hawks)).status, 200, "already holding Excellence does not refuse Design");

  const replaced = await put("excellence", w.bolts);
  assert.equal(replaced.status, 200);
  assert.deepEqual(
    (await w.db.listWinners()).filter((x) => x.award_id === "excellence").map((x) => x.team_id),
    [w.bolts.id],
    "one winner per award per division",
  );

  const cleared = await winnersApi(ADMIN, "DELETE", { awardId: "excellence", division: ES });
  assert.deepEqual([cleared.status, cleared.body], [200, { ok: true, removed: true }]);
  assert.deepEqual((await winnersApi(ADMIN, "DELETE", { awardId: "excellence", division: ES })).body, { ok: true, removed: false });
  assert.equal((await winnersApi(ADMIN, "DELETE", { awardId: "excellence" })).status, 400);

  assert.deepEqual(
    sameLines((await w.db.listActivity()).filter((a) => a.kind === "award" && a.actor_role === "Judge Advisor").map((a) => [a.action, a.detail ?? "", a.team_number ?? ""])),
    sameLines([
      ["gave Excellence to 9882K", ES, "9882K"],
      ["gave Design to 9882K", ES, "9882K"],
      ["gave Excellence to 7700B", `${ES} · instead of 9882K`, "7700B"],
      ["cleared Excellence", `${ES} · was 7700B`, "7700B"],
    ]),
    "the same pick twice and clearing nothing log nothing",
  );
});

/** Referees flag a team `kind` once each time. */
const flagTeam = async (w: World, team: Team, kind: string, times = 1) => {
  for (let i = 0; i < times; i++) {
    await w.db.createFlag({ teamId: team.id, kind, body: "Helped a rival fix their robot", author: "Ref", matchType: "Q", matchNumber: String(i + 1), field: "1", rule: null, ruleset: null, manualVersion: null, matchAffecting: false });
  }
};

test("Sportsmanship also goes to a team referees flagged for Good conduct twice, with no judge nomination; one flag is not enough, and no other award takes it", async () => {
  const w = await world();
  const put = (awardId: string, team: Team) => winnersApi(ADMIN, "PUT", { awardId, division: ES, teamId: team.id });
  await flagTeam(w, w.hawks, "good", 2);
  await flagTeam(w, w.bolts, "good", 1);
  await flagTeam(w, w.comets, "warning", 2);
  await flagTeam(w, w.comets, "good", 1);
  assert.deepEqual(await w.db.listNominations(), [], "no judge nominated anyone");

  const flagged = await put("sportsmanship", w.hawks);
  assert.equal(flagged.status, 200, "two Good conduct flags");
  assert.deepEqual((await w.db.listWinners()).map((x) => [x.award_id, x.team_id]), [["sportsmanship", w.hawks.id]]);

  const once = await put("sportsmanship", w.bolts);
  assert.equal(once.status, 409, "one flag");
  assert.match(once.body.error, /has not been nominated for Sportsmanship/);
  assert.equal((await put("sportsmanship", w.comets)).status, 409, "a Warning does not count, and one Good conduct beside it is still one");
  assert.equal((await put("sportsmanship", w.rookie)).status, 409, "no flags, no nomination");

  for (const award of ["excellence", "design", "inspire"]) {
    assert.equal((await put(award, w.hawks)).status, 409, `Good conduct does not nominate for ${award}`);
  }
  assert.deepEqual((await w.db.listWinners()).map((x) => [x.award_id, x.team_id]), [["sportsmanship", w.hawks.id]], "nothing else was decided");
  assert.deepEqual(await logged(w), ["gave Sportsmanship to 9882K"]);

  // The flags are the team's own: another division's two flags do not open this one.
  await flagTeam(w, w.storm, "good", 2);
  assert.equal((await winnersApi(ADMIN, "PUT", { awardId: "sportsmanship", division: ES, teamId: w.storm.id })).status, 400, "the division check still comes first");
  assert.equal((await winnersApi(ADMIN, "PUT", { awardId: "sportsmanship", division: MS, teamId: w.storm.id })).status, 200);
});

test("Good conduct flags put no nomination in anyone's read: the judge's and the Judge Advisor's lists hold only what judges nominated", async () => {
  const w = await world();
  await flagTeam(w, w.hawks, "good", 3);
  await nominate(amy(w), "excellence", w.bolts);

  for (const session of [amy(w), ADMIN]) {
    const reply = await awardsApi(session, "GET");
    assert.deepEqual(reply.body.nominations.map((n: { award_id: string; team_id: string }) => [n.award_id, n.team_id]), [["excellence", w.bolts.id]]);
    assert.ok(!JSON.stringify(reply.body).includes(w.hawks.id), "the flagged team is not in it");
  }
});

test("a judge withdrawing a nomination does not undo a winner, and is told nothing of one", async () => {
  const w = await world();
  await nominate(amy(w), "excellence", w.hawks);
  await winnersApi(ADMIN, "PUT", { awardId: "excellence", division: ES, teamId: w.hawks.id });

  const reply = await awardsApi(amy(w), "DELETE", { awardId: "excellence", teamId: w.hawks.id });
  assert.deepEqual(reply.body, { ok: true, removed: true }, "the same answer as with no winner");
  assert.equal((await w.db.listWinners()).length, 1, "the Judge Advisor's decision stands");
});

/* ===== /api/state ======================================================== */

test("/api/state carries no nominations, no winners and no award list, whoever asks", async () => {
  const w = await world();
  await nominate(amy(w), "excellence", w.hawks, "SECRET-REASON");
  await nominate(cleo(w), "design", w.comets);
  await winnersApi(ADMIN, "PUT", { awardId: "excellence", division: ES, teamId: w.hawks.id });
  assert.equal((await w.db.listWinners()).length, 1, "there is something to leak");

  for (const session of [ADMIN, amy(w), QUEUER, REFEREE, null]) {
    const who = session?.role ?? "nobody";
    const state = await hit(stateRoute, "GET", session, "/api/state");
    assert.equal(state.status, 200, who);
    assert.ok(state.body.teams.length > 0, `${who}: the state is a real one, so the checks below mean something`);
    for (const key of ["awards", "nominations", "winners"]) {
      assert.ok(!(key in state.body), `${who}: /api/state has grown a ${key} field`);
    }
    const text = JSON.stringify(state.body);
    assert.doesNotMatch(text, /award_id|decided_by|decided_at|SECRET-REASON|excellence/i, `${who}: something of the awards is in /api/state`);
  }
});
