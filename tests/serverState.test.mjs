import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/* loadState's judge scoping, mirrored in plain JS -- src/lib/server-state.ts
   reaches for node:fs (via the store) so it cannot be imported directly
   here, the same reason the other backend tests mirror their source
   instead of executing it. This focuses on the piece that matters: what
   a judge session sees when its panel does, and does not, still exist. */

function scope(session, panels, teams, requests, conflicts) {
  const isJudge = session?.role === "judge";
  const judgePanel = isJudge ? panels.find((p) => p.id === session.panelId) : undefined;
  const judgeSessionValid = !isJudge || Boolean(judgePanel);
  const division = judgePanel ? judgePanel.division : null;

  const barred = new Set(
    isJudge && judgeSessionValid
      ? conflicts.filter((c) => c.panel_id === session.panelId).map((c) => c.team_id)
      : [],
  );

  const visiblePanels = !judgeSessionValid
    ? []
    : division
      ? panels.filter((p) => p.division === division)
      : panels;
  const visibleTeams = !judgeSessionValid
    ? []
    : (division ? teams.filter((t) => t.division === division) : teams).filter(
        (t) => !barred.has(t.id),
      );
  const visiblePanelIds = new Set(visiblePanels.map((p) => p.id));
  const visibleTeamIds = new Set(visibleTeams.map((t) => t.id));
  const visibleRequests = !judgeSessionValid
    ? []
    : (
        division
          ? requests.filter((r) => visibleTeamIds.has(r.team_id) || visiblePanelIds.has(r.panel_id ?? ""))
          : requests
      ).filter((r) => !barred.has(r.team_id));

  return { visiblePanels, visibleTeams, visibleRequests, judgeSessionValid, division };
}

const panelA = { id: "panel-a", division: "Elementary School" };
const panelB = { id: "panel-b", division: "Middle School" };
const teamA = { id: "team-a", panel_id: "panel-a", division: "Elementary School" };
const teamB = { id: "team-b", panel_id: "panel-b", division: "Middle School" };
const requestA = { id: "req-a", team_id: "team-a", panel_id: "panel-a" };
const requestB = { id: "req-b", team_id: "team-b", panel_id: "panel-b" };

test("a judge with a real panel sees only their own division", () => {
  const session = { role: "judge", panelId: "panel-a" };
  const out = scope(session, [panelA, panelB], [teamA, teamB], [requestA, requestB], []);
  assert.equal(out.judgeSessionValid, true);
  assert.deepEqual(out.visiblePanels, [panelA]);
  assert.deepEqual(out.visibleTeams, [teamA]);
  assert.deepEqual(out.visibleRequests, [requestA]);
});

/* Regression (BUG-008): panels.find() returning undefined for a deleted
   panel used to leave `division` as null -- the exact value a NON-judge
   caller has -- so the judge fell through to the "no restriction" branch
   of every `division ? X : Y` and received every panel, every team and
   every request in the event, for as long as their cookie stayed valid
   (up to 16 hours). Deleting or rotating a panel must revoke visibility,
   not broaden it. */
test("a judge whose panel was deleted sees nothing at all, not everything", () => {
  const session = { role: "judge", panelId: "panel-deleted" };
  const out = scope(session, [panelA, panelB], [teamA, teamB], [requestA, requestB], []);
  assert.equal(out.judgeSessionValid, false, "a session naming a nonexistent panel must not read as valid");
  assert.deepEqual(out.visiblePanels, [], "a stale judge session must not fall back to every panel");
  assert.deepEqual(out.visibleTeams, [], "a stale judge session must not fall back to every team");
  assert.deepEqual(out.visibleRequests, [], "a stale judge session must not fall back to every request");
});

test("admin and anonymous callers are unaffected -- only a judge session is scoped at all", () => {
  const admin = scope({ role: "admin" }, [panelA, panelB], [teamA, teamB], [requestA, requestB], []);
  assert.deepEqual(admin.visiblePanels, [panelA, panelB]);
  assert.deepEqual(admin.visibleTeams, [teamA, teamB]);

  const anon = scope(null, [panelA, panelB], [teamA, teamB], [requestA, requestB], []);
  assert.deepEqual(anon.visiblePanels, [panelA, panelB]);
  assert.deepEqual(anon.visibleTeams, [teamA, teamB]);
});

test("the real loadState fails closed for a judge whose panel cannot be resolved", () => {
  const src = readFileSync(new URL("../src/lib/server-state.ts", import.meta.url), "utf8");
  assert.ok(
    src.includes("const judgeSessionValid = !isJudge || Boolean(judgePanel);"),
    "loadState no longer distinguishes a judge with no resolvable panel from an unscoped caller",
  );
  assert.match(
    src,
    /const visiblePanels = !judgeSessionValid\s*\n\s*\? \[\]/,
    "visiblePanels no longer fails closed when the judge's panel cannot be resolved",
  );
  assert.match(
    src,
    /const visibleTeams = !judgeSessionValid\s*\n\s*\? \[\]/,
    "visibleTeams no longer fails closed when the judge's panel cannot be resolved",
  );
  assert.match(
    src,
    /const visibleRequests = !judgeSessionValid\s*\n\s*\? \[\]/,
    "visibleRequests no longer fails closed when the judge's panel cannot be resolved",
  );
  assert.ok(
    src.includes("divisions: !judgeSessionValid ? [] :"),
    "divisions no longer fails closed when the judge's panel cannot be resolved",
  );
});
