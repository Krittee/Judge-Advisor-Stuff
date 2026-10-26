import assert from "node:assert/strict";
import test from "node:test";

import {
  NO_PANEL,
  allowedPanels,
  buildColumns,
  cardAction,
  chipLabel,
  chipSpeech,
  columnKey,
  conflictNote,
  coverTags,
  defaultColumnKey,
  gapNote,
  loadLine,
  orderCards,
  sinceFor,
  teamCount,
  uncoveredLanguages,
} from "../src/components/admin/floorLogic";
import { hasLanguageGap } from "../src/components/Language";

/* The Judge Advisor Floor's decisions, run for real against
   src/components/admin/floorLogic.ts. How they are drawn is in
   adminPage.runtime.test.tsx. */

const NOW = new Date(2026, 9, 17, 12, 36).getTime();
const at = (min) => new Date(NOW + min * 60_000).toISOString();

const languages = [
  { id: "en", label: "English", short: "EN" },
  { id: "th", label: "ไทย (Thai)", short: "TH" },
];

const panel = (n, division, langs, judges = []) => ({
  id: `p${n}`,
  name: `Panel ${n}`,
  division,
  judges,
  languages: langs,
  sort_order: n,
  slot_start_at: null,
  slot_minutes: 20,
  slot_count: 0,
});
const p1 = panel(1, "High School", ["en"], ["Dana Ruiz", "Sam Okafor"]);
const p2 = panel(2, "Middle School", ["en", "th"], ["Priya Nair", "Lee Chen"]);
const p3 = panel(3, "Middle School", ["en"], ["Tom Baker", "Ana Silva"]);
const p4 = panel(4, "Elementary School", ["en", "th"]);
const panels = [p1, p2, p3, p4];

const team = (number, panelId, division = "Middle School") => ({
  id: `t-${number}`,
  number,
  name: `Team ${number}`,
  panel_id: panelId,
  division,
  category: "developing",
  pit: null,
  created_at: at(-600),
});
const req = (t, status, over = {}) => ({
  id: `r-${t.number}`,
  team_id: t.id,
  panel_id: t.panel_id,
  status,
  kind: "queue",
  language: "en",
  slot_start: null,
  slot_end: null,
  message: null,
  created_by: null,
  acknowledged_by: null,
  interviewer: null,
  outcome: null,
  requested_at: at(-5),
  acknowledged_at: null,
  started_at: null,
  finished_at: null,
  cancelled_at: null,
  updated_at: at(-1),
  ...over,
});
const card = (t, status, over) => ({ team: t, request: req(t, status, over) });

/* ---- card order ----------------------------------------------------------- */

test("a column lists interviewing, then on the way, then requesting longest wait first, then booked by slot", () => {
  const cards = [
    card(team("1000A", "p2"), "scheduled", { slot_start: at(44) }),
    card(team("2000A", "p2"), "requested", { requested_at: at(-2) }),
    card(team("3000A", "p2"), "acknowledged", { requested_at: at(-30) }),
    card(team("4000A", "p2"), "requested", { requested_at: at(-8) }),
    card(team("5000A", "p2"), "scheduled", { slot_start: at(24) }),
    card(team("6000A", "p2"), "interviewing", { requested_at: at(-20) }),
  ];
  assert.deepEqual(
    orderCards(cards).map((c) => c.team.number),
    ["6000A", "3000A", "4000A", "2000A", "5000A", "1000A"],
  );
  // The input is not reordered in place.
  assert.equal(cards[0].team.number, "1000A");
});

test("teams that tie fall back to team number, so the order never shuffles between polls", () => {
  const same = { requested_at: at(-5) };
  const cards = [card(team("9882K", "p2"), "requested", same), card(team("2011A", "p2"), "requested", same)];
  assert.deepEqual(orderCards(cards).map((c) => c.team.number), ["2011A", "9882K"]);
  assert.deepEqual(orderCards([...cards].reverse()).map((c) => c.team.number), ["2011A", "9882K"]);
});

test("one column per panel in the panels' own order, each holding that panel's live requests in card order", () => {
  const a = team("2011A", "p2");
  const b = team("9882K", "p2");
  const c = team("5150Z", "p3");
  const done = team("1111X", "p3");
  const requests = [
    req(b, "requested"),
    req(a, "interviewing"),
    req(c, "requested"),
    req(done, "completed"), // finished: not in flight
  ];
  const columns = buildColumns(panels, [a, b, c, done], requests);
  assert.deepEqual(columns.map((col) => col.panel?.id), ["p1", "p2", "p3", "p4"]);
  assert.deepEqual(columns.map((col) => col.cards.map((x) => x.team.number)), [[], ["2011A", "9882K"], ["5150Z"], []]);
});

test("a team whose request has no panel any more is not lost: it gets a last column of its own", () => {
  const a = team("2011A", "p2");
  const orphan = team("7700B", null);
  const stale = team("8800C", "gone");
  const columns = buildColumns(panels, [a, orphan, stale], [req(a, "requested"), req(orphan, "requested"), req(stale, "acknowledged")]);
  assert.equal(columns.length, 5);
  const last = columns.at(-1);
  assert.equal(last.panel, null);
  assert.equal(columnKey(last), NO_PANEL);
  assert.deepEqual(last.cards.map((x) => x.team.number), ["8800C", "7700B"], "on the way before requesting");
  // No orphans, no extra column.
  assert.equal(buildColumns(panels, [a], [req(a, "requested")]).length, 4);
});

test("a booked team that has also asked for a judge is on the board once, as requesting", () => {
  const a = team("2011A", "p2");
  const columns = buildColumns(panels, [a], [req(a, "scheduled", { id: "r-booked", slot_start: at(30) }), req(a, "requested")]);
  assert.equal(columns[1].cards.length, 1);
  assert.equal(columns[1].cards[0].request.status, "requested");
});

/* ---- the load line -------------------------------------------------------- */

test("the load line says how many are waiting and who the panel is with, going to, or that it is free", () => {
  const w = (n) => card(team(n, "p2"), "requested");
  const withTeam = card(team("2011A", "p2"), "interviewing");
  const goingTo = card(team("3141P", "p2"), "acknowledged");

  assert.equal(loadLine([withTeam, w("9882K"), w("7700B")]).text, "2 waiting · with 2011A");
  assert.equal(loadLine([goingTo]).text, "none waiting · going to 3141P");
  assert.equal(loadLine([w("5150Z")]).text, "1 waiting · panel free");
  assert.equal(loadLine([]).text, "none waiting · panel free");
  assert.equal(loadLine([card(team("4410C", "p2"), "scheduled", { slot_start: at(20) })]).text, "none waiting · panel free", "a booking is not a team the panel is with");
  // In the room beats on the way.
  assert.equal(loadLine([goingTo, withTeam]).status, "with 2011A");
  assert.deepEqual(
    (({ waiting, waitingText, status }) => ({ waiting, waitingText, status }))(loadLine([w("9882K")])),
    { waiting: 1, waitingText: "1 waiting", status: "panel free" },
  );
});

/* ---- the language gap ----------------------------------------------------- */

test("a request in a language its panel does not cover is a gap; an unstated cover never is", () => {
  assert.equal(hasLanguageGap(["en"], "th"), true);
  assert.equal(hasLanguageGap(["en"], "en"), false);
  assert.equal(hasLanguageGap([], "th"), false, "a panel that has not said what it covers is not warned about");
  assert.equal(hasLanguageGap(["en"], undefined), false);
  assert.equal(hasLanguageGap(["en"], ""), false);
});

test("the panel's uncovered languages are the requested ones it leaves out, once each, in first-seen order", () => {
  const cards = [
    card(team("5150Z", "p3"), "requested", { language: "th" }),
    card(team("1234X", "p3"), "scheduled", { language: "th", slot_start: at(40) }),
    card(team("9090Q", "p3"), "requested", { language: "en" }),
    card(team("2222Q", "p3"), "acknowledged", { language: "fr" }),
  ];
  assert.deepEqual(uncoveredLanguages(p3, cards), ["th", "fr"], "booked requests count too");
  assert.deepEqual(uncoveredLanguages(p2, cards), ["fr"], "Panel 2 covers Thai");
  assert.deepEqual(uncoveredLanguages({ languages: [] }, cards), []);
  assert.deepEqual(uncoveredLanguages(null, cards), [], "the no-panel column has no cover to be short of");
  assert.deepEqual(uncoveredLanguages(p3, []), []);
});

test("the warning names the panel's cover and what the team asked for; one language reads 'only'", () => {
  assert.equal(gapNote(p3, languages, "th"), "Panel 3 interviews in English only — this team asked for ไทย (Thai).");
  assert.equal(gapNote(p2, languages, "fr"), "Panel 2 interviews in English, ไทย (Thai) — this team asked for fr.");
  assert.deepEqual(coverTags(p3, languages), [{ id: "en", text: "EN only" }]);
  assert.deepEqual(coverTags(p2, languages), [{ id: "en", text: "EN" }, { id: "th", text: "TH" }]);
  assert.deepEqual(coverTags({ languages: [] }, languages), []);
});

/* ---- where an interview may be moved ------------------------------------- */

test("a team can be moved to its own division's panels, and keeps its current panel in the list", () => {
  const t = team("9882K", "p2");
  assert.deepEqual(allowedPanels(t, "p2", panels, []).map((p) => p.id), ["p2", "p3"], "High School and Elementary School panels are out");
  // From a panel in another division (it was reassigned by hand) the current one still stays.
  assert.deepEqual(allowedPanels(t, "p1", panels, []).map((p) => p.id), ["p1", "p2", "p3"]);
});

test("a panel declared conflicted with the team is not offered, and neither is the current panel once it is blocked", () => {
  const t = team("9882K", "p2");
  const conflicts = [{ id: "c1", panel_id: "p3", judge_id: null, team_id: t.id }, { id: "c2", panel_id: "p2", judge_id: null, team_id: "someone-else" }];
  assert.deepEqual(allowedPanels(t, "p2", panels, conflicts).map((p) => p.id), ["p2"], "p3 is blocked; p2's conflict is with someone else");
  assert.deepEqual(
    allowedPanels(t, "p3", panels, conflicts).map((p) => p.id),
    ["p2"],
    "the interview is on Panel 3, which a conflict now blocks: it has to leave, so Panel 3 is not a place to move it",
  );
  assert.deepEqual(allowedPanels(t, "p3", panels, [...conflicts, { id: "c3", panel_id: "p2", judge_id: null, team_id: t.id }]), [], "nowhere left");
});

test("a live request on a panel a conflict now blocks gets the 'move it' note, whether the block is the panel's or a judge's", () => {
  const t = team("1101A", "p2");
  const whole = [{ id: "c1", panel_id: "p2", judge_id: null, team_id: t.id }];
  assert.equal(conflictNote(p2, t, whole), "Panel 2 has a conflict with 1101A — move it");

  const byJudge = [{ id: "c2", panel_id: null, judge_id: "j1", team_id: t.id }];
  assert.equal(conflictNote(p2, t, byJudge, [{ id: "j1", panel_id: "p2" }]), "Panel 2 has a conflict with 1101A — move it");
  assert.equal(conflictNote(p2, t, byJudge, [{ id: "j1", panel_id: "p3" }]), null, "the judge is on another panel: nothing blocks Panel 2");
  assert.equal(conflictNote(p2, t, byJudge, [{ id: "j1", panel_id: null }]), null, "a judge with no panel blocks nobody yet");

  assert.equal(conflictNote(p2, t, [{ id: "c3", panel_id: "p2", judge_id: null, team_id: "someone-else" }]), null, "a conflict with another team");
  assert.equal(conflictNote(p2, t, []), null);
  assert.equal(conflictNote(null, t, whole), null, "a request whose panel was deleted has no panel to blame");
});

test("a Blended panel may judge anyone, and a Blended team may go to any panel", () => {
  const blended = panel(5, "Blended", ["en"]);
  const all = [...panels, blended];
  assert.ok(allowedPanels(team("9882K", "p2"), "p2", all, []).some((p) => p.id === "p5"));
  assert.deepEqual(allowedPanels(team("0001B", "p2", "Blended"), "p2", all, []).map((p) => p.id), ["p1", "p2", "p3", "p4", "p5"]);
});

/* ---- the phone's default panel ------------------------------------------- */

test("the phone opens on the panel with the longest-waiting request, else the first panel", () => {
  const a = team("9882K", "p2");
  const b = team("5150Z", "p3");
  const c = team("7700B", "p2");
  const longest = buildColumns(panels, [a, b, c], [
    req(a, "requested", { requested_at: at(-4) }),
    req(b, "requested", { requested_at: at(-9) }),
    req(c, "requested", { requested_at: at(-6) }),
  ]);
  assert.equal(defaultColumnKey(longest), "p3");

  // Interviewing and booked teams are not waiting.
  const notWaiting = buildColumns(panels, [a, b], [req(a, "interviewing", { requested_at: at(-40) }), req(b, "scheduled", { slot_start: at(10) })]);
  assert.equal(defaultColumnKey(notWaiting), "p1");

  assert.equal(defaultColumnKey(buildColumns(panels, [], [])), "p1");
  assert.equal(defaultColumnKey([]), null);

  const orphan = team("8800C", null);
  assert.equal(defaultColumnKey(buildColumns(panels, [orphan], [req(orphan, "requested")])), NO_PANEL);
});

/* ---- small wording -------------------------------------------------------- */

test("chips and counts: Panel 2 is P2, a team count pluralises, the big button's last step is Finish", () => {
  assert.equal(chipLabel("Panel 2"), "P2");
  assert.equal(chipLabel("panel 12"), "P12");
  assert.equal(chipLabel("Judging Room"), "Judging Room");
  assert.equal(teamCount(1), "1 team");
  assert.equal(teamCount(0), "0 teams");
  assert.equal(teamCount(4), "4 teams");

  assert.deepEqual(cardAction("requested"), { to: "acknowledged", label: "On our way" });
  assert.deepEqual(cardAction("scheduled"), { to: "acknowledged", label: "On our way" });
  assert.deepEqual(cardAction("acknowledged"), { to: "interviewing", label: "Start interview" });
  assert.deepEqual(cardAction("interviewing"), { to: "completed", label: "Finish" });
  assert.equal(cardAction("completed"), null);
});

test("a card's clock starts when the wait, the walk over or the interview did", () => {
  const t = team("9882K", "p2");
  assert.equal(sinceFor(req(t, "requested", { requested_at: at(-8) })), at(-8));
  assert.equal(sinceFor(req(t, "acknowledged", { acknowledged_at: at(-3) })), at(-3));
  assert.equal(sinceFor(req(t, "acknowledged")), at(-1), "falls back to the last update");
  assert.equal(sinceFor(req(t, "interviewing", { started_at: at(-7) })), at(-7));
  assert.equal(sinceFor(req(t, "scheduled", { slot_start: at(20) })), null, "a booking shows its slot instead");
});

test("the phone chip is spoken as the panel, its teams, who is waiting and any language not covered", () => {
  const cards = [card(team("5150Z", "p3"), "requested", { language: "th" }), card(team("1234X", "p3"), "scheduled", { slot_start: at(40) })];
  assert.equal(chipSpeech({ panel: p3, cards }, languages), "Panel 3, 2 teams, 1 waiting, ไทย (Thai) not covered");
  assert.equal(chipSpeech({ panel: p1, cards: [] }, languages), "Panel 1, 0 teams");
});
