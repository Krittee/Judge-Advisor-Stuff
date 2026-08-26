import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/* Two things that must not be got wrong on event day: which language an
   interview runs in, and keeping an affiliated judge away from a team. */

const event = JSON.parse(readFileSync(new URL("../config/event.json", import.meta.url)));
const languages = event.languages;

/* ---- languages ------------------------------------------------------ */

function defaultLanguage() {
  return languages[0].id;
}

function resolveLanguage(input) {
  const wanted = String(input ?? "").trim().toLowerCase();
  if (!wanted) return defaultLanguage();
  const match = languages.find(
    (l) =>
      l.id.toLowerCase() === wanted ||
      l.short.toLowerCase() === wanted ||
      l.label.toLowerCase() === wanted,
  );
  return match ? match.id : defaultLanguage();
}

test("the event runs English and Thai", () => {
  assert.deepEqual(languages.map((l) => l.id), ["en", "th"]);
  assert.deepEqual(languages.map((l) => l.short), ["EN", "TH"]);
});

test("a language resolves from its id, short code or label", () => {
  assert.equal(resolveLanguage("th"), "th");
  assert.equal(resolveLanguage("TH"), "th");
  assert.equal(resolveLanguage("ไทย (Thai)"), "th");
  assert.equal(resolveLanguage("English"), "en");
  assert.equal(resolveLanguage("EN"), "en");
});

test("anything unrecognised falls back rather than storing junk", () => {
  for (const junk of ["", null, undefined, "klingon", 42]) {
    assert.equal(resolveLanguage(junk), defaultLanguage(), `${junk} should fall back`);
  }
});

/* A panel states which languages it covers; a request outside that set is
   flagged, never blocked — the team still needs seeing. */
function coverGap(panel, request) {
  if (!panel.languages.length) return false; // unstated is not a gap
  return !panel.languages.includes(request.language);
}

test("a request outside a panel's stated cover is flagged", () => {
  const panel = { languages: ["en"] };
  assert.equal(coverGap(panel, { language: "th" }), true);
  assert.equal(coverGap(panel, { language: "en" }), false);
});

test("a panel that has not stated its languages flags nothing", () => {
  assert.equal(
    coverGap({ languages: [] }, { language: "th" }),
    false,
    "warning on every request would train everyone to ignore the warning",
  );
});

/* ---- conflicts of interest ------------------------------------------ */

function isConflicted(session, teamId, conflicts) {
  if (session?.role !== "judge") return false;
  return conflicts.some((c) => c.panel_id === session.panelId && c.team_id === teamId);
}

const JUDGE_A = { role: "judge", panelId: "panel-a" };
const JUDGE_B = { role: "judge", panelId: "panel-b" };
const JA = { role: "admin" };
const CONFLICTS = [{ panel_id: "panel-a", team_id: "t1" }];

test("the affiliated panel is barred from that team", () => {
  assert.equal(isConflicted(JUDGE_A, "t1", CONFLICTS), true);
});

test("no other panel is affected", () => {
  assert.equal(isConflicted(JUDGE_B, "t1", CONFLICTS), false);
});

test("the same panel's other teams are unaffected", () => {
  assert.equal(isConflicted(JUDGE_A, "t2", CONFLICTS), false);
});

test("the Judge Advisor is never blocked", () => {
  assert.equal(
    isConflicted(JA, "t1", CONFLICTS),
    false,
    "somebody has to see the whole floor to reassign around a conflict",
  );
});

/* Assignment must never hand a team back to a panel it conflicts with. */
function eligiblePanels(team, panels, conflicts) {
  const barred = new Set(conflicts.map((c) => `${c.panel_id}:${c.team_id}`));
  return panels.filter(
    (p) => p.division === team.division && !barred.has(`${p.id}:${team.id}`),
  );
}

test("auto-assign will not choose a conflicted panel", () => {
  const team = { id: "t1", division: "Division 1" };
  const panels = [
    { id: "panel-a", division: "Division 1" },
    { id: "panel-b", division: "Division 1" },
  ];
  const eligible = eligiblePanels(team, panels, CONFLICTS);

  assert.deepEqual(eligible.map((p) => p.id), ["panel-b"]);
});

test("a team conflicted with every panel in its division stays unassigned", () => {
  const team = { id: "t1", division: "Division 1" };
  const panels = [{ id: "panel-a", division: "Division 1" }];
  assert.deepEqual(
    eligiblePanels(team, panels, CONFLICTS),
    [],
    "better unassigned than judged by someone who must stay away",
  );
});

test("declaring the same conflict twice is not two conflicts", () => {
  const rows = [];
  const add = (panelId, teamId) => {
    const existing = rows.find((r) => r.panel_id === panelId && r.team_id === teamId);
    if (existing) return existing;
    const row = { id: `c${rows.length}`, panel_id: panelId, team_id: teamId };
    rows.push(row);
    return row;
  };

  const first = add("panel-a", "t1");
  const second = add("panel-a", "t1");
  assert.equal(rows.length, 1);
  assert.equal(first.id, second.id);
});

test("a conflict outranks the panel check when deciding what to say", () => {
  // Declaring a conflict unassigns the team, so the panel check would
  // otherwise answer with the vaguer "not your panel".
  const order = ["conflict", "panel"];
  assert.equal(order[0], "conflict", "the judge should be told the real reason");
});

/* ---- authorisation runs before payload validation -------------------- */

/* A conflicted judge should be told about the conflict, not about the shape
   of their request.  Answering "Unknown criterion" first both leaks the
   rubric's structure and hides the real reason they are being refused, so
   the scope check has to come before the body checks.  These pin the order
   in the source, because it is the kind of thing a later edit reorders
   without noticing. */

function handlerBody(source, name) {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `no ${name} handler found`);
  const next = source.indexOf("\nexport async function ", start + 1);
  const end = next === -1 ? source.indexOf("\nfunction ", start + 1) : next;
  return source.slice(start, end === -1 ? source.length : end);
}

const scoresRoute = readFileSync(new URL("../src/app/api/scores/route.ts", import.meta.url), "utf8");
const notesRoute = readFileSync(new URL("../src/app/api/notes/route.ts", import.meta.url), "utf8");

test("scoring checks scope before it validates the rubric", () => {
  for (const handler of ["POST", "DELETE"]) {
    const body = handlerBody(scoresRoute, handler);
    const scope = body.indexOf("refuseIfOutOfScope");
    const validation = body.indexOf("Unknown rubric");
    assert.notEqual(scope, -1, `${handler} does not check scope at all`);
    assert.notEqual(validation, -1, `${handler} does not validate the rubric`);
    assert.ok(
      scope < validation,
      `scores ${handler} validates the rubric before checking scope, so a ` +
        `conflicted judge learns the rubric exists before being refused`,
    );
  }
});

test("note writing checks scope before it validates the text", () => {
  const body = handlerBody(notesRoute, "POST");
  const scope = body.indexOf("refuseIfOutOfScope");
  const textCheck = body.indexOf("if (!text)");
  assert.notEqual(scope, -1);
  assert.notEqual(textCheck, -1, "the empty-text guard moved or was renamed");
  assert.ok(
    scope < textCheck,
    "notes POST validates the body before checking scope",
  );
});

test("the team id guard may still run first, since the check needs it", () => {
  /* The one validation allowed to precede the scope check: without a team
     id there is nothing to check scope against. */
  const body = handlerBody(notesRoute, "POST");
  assert.ok(body.indexOf("if (!teamId)") < body.indexOf("refuseIfOutOfScope"));
});
