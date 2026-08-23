import assert from "node:assert/strict";
import test from "node:test";

/* Mirrors the scope rules in src/lib/auth.ts and the division wall in the
   stores. These are the rules that decide who can see and touch what, so
   they are worth pinning down separately from the UI that displays them. */

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

function canCancel(s, status) {
  if (s?.role === "admin" || s?.role === "judge") return true;
  if (s?.role === "queuer") return status === "requested" || status === "scheduled";
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

test("the queue desk can undo its own entry only before judges see it", () => {
  assert.ok(canCancel(QUEUER, "requested"));
  assert.ok(canCancel(QUEUER, "scheduled"));
  for (const s of ["acknowledged", "interviewing", "completed"]) {
    assert.ok(!canCancel(QUEUER, s), `queuer must not cancel a ${s} interview`);
  }
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
