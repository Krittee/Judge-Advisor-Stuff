import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { canCancel } from "../src/lib/auth";
import { ACTION_FROM, STATUSES, TERMINAL_STATUSES, canTransition } from "../src/lib/status";

/* Mirrors the scope rules in src/lib/auth.ts and the division wall in the
   stores. These are the rules that decide who can see and touch what, so
   they are worth pinning down separately from the UI that displays them.
   (canCancel is the exception: it is the real function, imported, because
   its rule has been changed on purpose and a copy would just agree with
   itself.) */

const JA = { role: "admin", name: "Krittee" };
const JUDGE_A = { role: "judge", name: "Dana", panelId: "panel-a", panelName: "Panel A" };
const JUDGE_C = { role: "judge", name: "Alex", panelId: "panel-c", panelName: "Panel C" };
const QUEUER = { role: "queuer", name: "Desk" };
const TEAM = null;

const canAdvance = (s) => s?.role === "admin" || s?.role === "judge";
const canReadNotes = (s) => s?.role === "admin" || s?.role === "judge";
const canAdminister = (s) => s?.role === "admin";

function mayActOnPanel(s, panelId) {
  if (s?.role === "admin") return true;
  if (s?.role === "judge") return panelId !== null && panelId === s.panelId;
  return false;
}

test("only the Judge Advisor administers", () => {
  assert.ok(canAdminister(JA));
  for (const s of [JUDGE_A, QUEUER, TEAM]) assert.ok(!canAdminister(s));
});

test("the queue desk can never advance an interview or read notes", () => {
  assert.ok(!canAdvance(QUEUER));
  assert.ok(!canReadNotes(QUEUER));
  assert.ok(!mayActOnPanel(QUEUER, "panel-a"));
});

test("a team with no login can never advance or read notes", () => {
  assert.ok(!canAdvance(TEAM));
  assert.ok(!canReadNotes(TEAM));
  assert.ok(!mayActOnPanel(TEAM, "panel-a"));
});

test("a judge acts on their own panel and no other", () => {
  assert.ok(canAdvance(JUDGE_A), "judges do drive the colour flow");
  assert.ok(mayActOnPanel(JUDGE_A, "panel-a"));
  assert.ok(!mayActOnPanel(JUDGE_A, "panel-c"), "another panel is off limits");
  assert.ok(!mayActOnPanel(JUDGE_C, "panel-a"));
});

test("an unassigned team is Judge Advisor territory only", () => {
  assert.ok(mayActOnPanel(JA, null));
  assert.ok(!mayActOnPanel(JUDGE_A, null), "a judge cannot claim a team nobody owns");
});

test("the Judge Advisor may act on any panel", () => {
  for (const p of ["panel-a", "panel-c", null]) assert.ok(mayActOnPanel(JA, p));
});

test("the queue desk can cancel an early request, and nothing the judges have taken", () => {
  assert.ok(canCancel(QUEUER, "requested"));
  assert.ok(canCancel(QUEUER, "scheduled"));
  for (const s of ["acknowledged", "interviewing", "completed", "cancelled"]) {
    assert.ok(!canCancel(QUEUER, s), `queuer must not cancel a ${s} interview`);
  }
});

/* Regression: the public team page has always shown a "Cancel this
   request" / "Cancel this booking" button to every visitor with no
   login, but canCancel(null, ...) used to return false unconditionally
   -- the button 403'd every single time, for every team, since the
   app's first commit. Creating a request needs no login (POST
   /api/requests is open to everyone), so cancelling the one a team just
   created cannot need one either. A team's own request is always
   createdBy "team", so the null-session branch never has to consult it. */
test("a team with no login can cancel their own request while it is still early, same as the queue desk", () => {
  assert.ok(canCancel(TEAM, "requested"), "a team must be able to cancel their own live request");
  assert.ok(canCancel(TEAM, "scheduled"), "a team must be able to give up their own booking");
  for (const s of ["acknowledged", "interviewing", "completed"]) {
    assert.ok(!canCancel(TEAM, s), `a team must not cancel a ${s} interview out from under a judge`);
  }
});

/* Product decision D1: the queue desk works ANY request that is still
   early, whoever created it. canCancel used to require the request's
   createdBy to start with "queuer:", which made the desk's cancel,
   reschedule and "ready now" buttons 403 for every booking a team made
   from its own phone -- the very teams that walk up to the desk. */
test("a queuer can cancel an early request whoever created it", () => {
  for (const createdBy of ["team", "admin:Krittee", "queuer:Someone Else", null]) {
    for (const status of ["requested", "scheduled"]) {
      // The request's creator is not an input to canCancel; passing one anyway
      // makes a version that goes back to consulting it fail here.
      assert.ok(canCancel(QUEUER, status, createdBy), `a queuer must cancel a ${status} request made by ${createdBy}`);
    }
  }
});

test("only the roles that touch interviews may cancel at all", () => {
  const REFEREE = { role: "referee", name: "Ref" };
  assert.ok(!canCancel(REFEREE, "requested"), "a referee has no part in the queue");
  assert.ok(canCancel(JA, "completed"), "the Judge Advisor's reach is unchanged here (the transition table narrows it)");
  assert.ok(canCancel(JUDGE_A, "interviewing"));
});

/* ---- the status transition table (BUG-011) ------------------------- */

test("cancel is allowed from every status that is still open, and from no finished one", () => {
  for (const s of STATUSES) {
    assert.equal(canTransition("cancel", s), !TERMINAL_STATUSES.includes(s), `cancel from ${s}`);
  }
  assert.ok(!canTransition("cancel", "completed"), "a completed interview must not be cancellable");
  assert.ok(!canTransition("cancel", "cancelled"));
});

test("reopen is allowed only from a finished status", () => {
  for (const s of STATUSES) {
    assert.equal(canTransition("reopen", s), TERMINAL_STATUSES.includes(s), `reopen from ${s}`);
  }
  for (const s of ["scheduled", "requested", "acknowledged", "interviewing"]) {
    assert.ok(!canTransition("reopen", s), `reopen must not accept a ${s} request`);
  }
});

test("ready-now is allowed only from a scheduled booking", () => {
  for (const s of STATUSES) assert.equal(canTransition("ready-now", s), s === "scheduled", `ready-now from ${s}`);
});

test("actions the table does not name are not restricted by it", () => {
  for (const action of ["advance", "set-status", "reassign", "reschedule"]) {
    assert.equal(ACTION_FROM[action], undefined, `${action} unexpectedly entered the table`);
    for (const s of STATUSES) assert.ok(canTransition(action, s), `${action} from ${s}`);
  }
});

test("the route's panel-scope wall exempts a team with no login, the same way it exempts the queue desk", () => {
  const src = readFileSync(new URL("../src/app/api/requests/[id]/route.ts", import.meta.url), "utf8");
  assert.ok(
    /if \(session && session\.role !== "queuer" && !mayActOnPanel\(/.test(src),
    "the panel-scope check no longer exempts an anonymous (team) caller -- " +
      "without this, canCancel's null-session branch above can never actually be reached, " +
      "and the team page's cancel button is dead again",
  );
});

/* ---- the division wall ------------------------------------------- */

function eligiblePanels(team, panels) {
  return panels.filter((p) => p.division === team.division);
}

function autoAssign(teams, panels, perPanel) {
  const load = new Map(panels.map((p) => [p.id, 0]));
  for (const t of teams) {
    if (t.panel_id && load.has(t.panel_id)) load.set(t.panel_id, load.get(t.panel_id) + 1);
  }
  let assigned = 0;
  for (const team of teams.filter((t) => !t.panel_id)) {
    const target = eligiblePanels(team, panels)
      .map((p) => ({ id: p.id, count: load.get(p.id) ?? 0 }))
      .filter((p) => p.count < perPanel)
      .sort((a, b) => a.count - b.count)[0];
    if (!target) continue;
    load.set(target.id, target.count + 1);
    team.panel_id = target.id;
    assigned++;
  }
  return assigned;
}

const PANELS = [
  { id: "a", division: "Division 1" },
  { id: "b", division: "Division 1" },
  { id: "d", division: "Division 2" },
];

test("auto-assign never puts a team on a panel from the other division", () => {
  const teams = [
    { id: "1", division: "Division 1", panel_id: null },
    { id: "2", division: "Division 1", panel_id: null },
    { id: "3", division: "Division 2", panel_id: null },
    { id: "4", division: "Division 2", panel_id: null },
  ];
  autoAssign(teams, PANELS, 10);

  const byId = Object.fromEntries(PANELS.map((p) => [p.id, p]));
  for (const t of teams) {
    assert.ok(t.panel_id, `${t.id} should be assigned`);
    assert.equal(byId[t.panel_id].division, t.division, "assignment crossed the wall");
  }
});

test("a division with no panels leaves its teams unassigned rather than crossing over", () => {
  const teams = [{ id: "9", division: "Division 3", panel_id: null }];
  const assigned = autoAssign(teams, PANELS, 10);
  assert.equal(assigned, 0);
  assert.equal(teams[0].panel_id, null, "better unassigned than judged by the wrong division");
});

test("a full division does not spill into the other one", () => {
  const teams = [
    { id: "1", division: "Division 1", panel_id: null },
    { id: "2", division: "Division 1", panel_id: null },
    { id: "3", division: "Division 1", panel_id: null },
  ];
  autoAssign(teams, PANELS, 1); // 2 panels in Division 1, cap 1 each
  const placed = teams.filter((t) => t.panel_id);
  assert.equal(placed.length, 2);
  assert.ok(
    placed.every((t) => ["a", "b"].includes(t.panel_id)),
    "the Division 2 panel must stay empty",
  );
});

test("moving a panel across the wall releases its teams", () => {
  const panel = { id: "a", division: "Division 1" };
  const teams = [
    { id: "1", division: "Division 1", panel_id: "a" },
    { id: "2", division: "Division 1", panel_id: "a" },
    { id: "3", division: "Division 1", panel_id: "b" },
  ];

  const next = "Division 2";
  if (next !== panel.division) {
    for (const t of teams) if (t.panel_id === panel.id) t.panel_id = null;
    panel.division = next;
  }

  assert.equal(panel.division, "Division 2");
  assert.deepEqual(
    teams.map((t) => t.panel_id),
    [null, null, "b"],
    "its own teams are released; another panel's are untouched",
  );
  assert.ok(
    teams.every((t) => t.division === "Division 1"),
    "teams keep the division they compete in",
  );
});

/* ---- who receives declared conflicts of interest --------------------- */

/* A conflict names a judge and describes their connection to a team —
   "coaches this team", "parent of a member". That is information about a
   person, and the team page and the big board both poll the same state
   endpoint with no login at all. It goes only to the people who act on
   it. */

function conflictsFor(session, all, canReadNotes) {
  if (!canReadNotes) return [];
  if (session?.role === "judge") return all.filter((c) => c.panel_id === session.panelId);
  return all;
}

const CONFLICTS = [
  { id: "a", panel_id: "p1", team_id: "t1", judge_name: "Ann", note: "coaches them" },
  { id: "b", panel_id: "p2", team_id: "t2", judge_name: "Bo", note: "parent" },
];

test("an anonymous team viewer receives no conflicts at all", () => {
  assert.deepEqual(conflictsFor(null, CONFLICTS, false), []);
});

test("the queue desk receives no conflicts either", () => {
  /* The desk takes requests; it has no part in judging affiliations. */
  assert.deepEqual(conflictsFor({ role: "queuer" }, CONFLICTS, false), []);
});

test("a judge receives only their own panel's", () => {
  const got = conflictsFor({ role: "judge", panelId: "p1" }, CONFLICTS, true);
  assert.equal(got.length, 1);
  assert.equal(got[0].panel_id, "p1");
});

test("the Judge Advisor receives all of them", () => {
  assert.equal(conflictsFor({ role: "admin" }, CONFLICTS, true).length, 2);
});

test("no judge name or note can reach a viewer without notes access", () => {
  /* The fields that make this worth gating. */
  for (const session of [null, { role: "queuer" }]) {
    const got = conflictsFor(session, CONFLICTS, false);
    const text = JSON.stringify(got);
    assert.ok(!text.includes("Ann"), "a judge's name reached an unauthorised viewer");
    assert.ok(!text.includes("coaches"), "an affiliation note reached an unauthorised viewer");
  }
});

test("the payload builder actually gates on notes access", () => {
  const src = readFileSync(new URL("../src/lib/server-state.ts", import.meta.url), "utf8");
  assert.ok(
    /conflicts:\s*!canReadNotes\(session\)/.test(src),
    "server-state no longer gates conflicts on canReadNotes",
  );
});
