import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_PANELS,
  alreadyHas,
  backing,
  backingText,
  buildAwardPanels,
  buildMatrix,
  clearAfterAsking,
  clearQuestion,
  conductIn,
  conductKeyText,
  conductLine,
  conductText,
  decidedCount,
  decidedText,
  defaultDivision,
  detailFor,
  distinctTeams,
  giveAfterAsking,
  giveQuestion,
  hasText,
  hiddenNote,
  holdsText,
  JA_KEY,
  judgesText,
  loadView,
  nominateAsAdmin,
  nominationsIn,
  nominationsText,
  panelChips,
  panelShort,
  panelTagText,
  pickDivision,
  refereeLine,
  removeAfterAsking,
  removeQuestion,
  saveView,
  scoreParts,
  teamsByNumber,
  VIEW_KEY,
  winnersOf,
} from "../src/components/admin/awardsLogic";
import { withRanks } from "../src/components/admin/scoresLogic";
import { rankTeams } from "../src/lib/ranking";
import { rubrics } from "../src/lib/rubrics";
import {
  adminNom, awards, byteMe, divisions, gearGrinders, HS, labRats, MS, momentum, monitors, nom, nominations, panels, quiet, roboraptors, teams, torque, win, winners,
} from "./adminAwards.fixtures";

/* The Judge Advisor Awards board's decisions, run for real against
   src/components/admin/awardsLogic.ts and the real awards in config/event.json.
   How they are drawn is in adminAwards.runtime.test.tsx. */

const decided = winnersOf(winners, MS);
const msTeams = teams.filter((t) => t.division === MS);
const msNoms = nominationsIn(nominations, teams, MS);
const matrix = buildMatrix(awards, msNoms, decided, msTeams, panels);

/* ---- the division wall and the panel filter -------------------------------------------- */

test("a division's board holds only its own teams' nominations, and a panel narrows it to what that panel nominated", () => {
  assert.equal(msNoms.length, 18, "18 nominations: the High School one is not among them");
  assert.equal(distinctTeams(msNoms), 9);
  assert.deepEqual(nominationsIn(nominations, teams, HS).map((x) => x.judge), ["Dana Cruz"]);

  const p2 = nominationsIn(nominations, teams, MS, "p2");
  assert.ok(p2.every((x) => x.panel_id === "p2"));
  assert.equal(distinctTeams(p2), 5);
  assert.equal(distinctTeams(nominationsIn(nominations, teams, MS, "p3")), 4);
  assert.equal(nominationsIn(nominations, teams, MS, ALL_PANELS).length, 18, "no panel is all of them");
});

test("the panel chips count the teams each panel nominated: all panels 9, Panel 2 5, Panel 3 4", () => {
  assert.deepEqual(panelChips(panels.filter((p) => p.division === MS), msNoms), [
    { id: "", label: "All panels", count: 9 },
    { id: "p2", label: "Panel 2", count: 5 },
    { id: "p3", label: "Panel 3", count: 4 },
  ]);
});

test("the header's words: nominations for teams, and which panel a row's tag names", () => {
  assert.equal(nominationsText(18, 9), "18 nominations for 9 teams");
  assert.equal(nominationsText(1, 1), "1 nomination for 1 team");
  assert.equal(panelShort("Panel 2"), "P2");
  assert.equal(panelShort("Panel A"), "PA");
  assert.equal(panelShort("Blue room"), "Blue room", "a panel not named Panel N keeps its name");
  assert.equal(panelTagText(["p2"], panels), "P2");
  assert.equal(panelTagText(["p2", "p3"], panels), "P2/P3", "a team nominated by two panels says so");
  assert.equal(panelTagText([null], panels), "—", "a deleted panel has no name to show");
});

/* ---- the matrix ----------------------------------------------------------------------------- */

test("the matrix lists only teams with a nomination, most nominations first and then team number", () => {
  assert.deepEqual(matrix.rows.map((r) => [r.team.number, r.count]), [
    ["5150Z", 4], ["7700B", 3],
    ["4242F", 2], ["6060R", 2], ["8015M", 2], ["9882K", 2],
    ["1234A", 1], ["2088C", 1], ["3311X", 1],
  ]);
  assert.ok(!matrix.rows.some((r) => r.team.id === quiet.id), "a team nobody nominated is not a row");
  assert.ok(!matrix.rows.some((r) => r.team.id === monitors.id), "nor is another division's team");
});

test("the matrix has a column only for an award someone is nominated for, in the config's order, and names the rest as hidden", () => {
  assert.deepEqual(matrix.columns.map((c) => c.award.short), ["Exc", "Des", "Inn", "Thk", "Amz", "Bld", "Cre", "Jdg", "Ins", "Spt"]);
  assert.deepEqual(matrix.hidden.map((a) => a.label), ["Energy"]);
  assert.equal(hiddenNote(matrix.hidden, null), "Energy has no nominations yet, so its column is hidden.");
  assert.equal(hiddenNote([{ label: "Energy" }, { label: "Think" }], null), "Energy and Think have no nominations yet, so their columns are hidden.");
  assert.equal(hiddenNote([{ label: "A" }, { label: "B" }, { label: "C" }], "Panel 3"), "A, B and C have no nominations from Panel 3, so their columns are hidden.");
  assert.equal(hiddenNote([], null), "", "nothing hidden, nothing said");
  // A column the config lists wears its tick once the award is decided.
  assert.deepEqual(matrix.columns.filter((c) => c.decided).map((c) => c.award.id), ["design", "think", "amaze"]);
});

test("a cell is nothing, a nomination or the winner; a team that has won says so in place of its name", () => {
  const row = (number) => matrix.rows.find((r) => r.team.number === number);
  const cellsOf = (number) => Object.fromEntries(matrix.columns.map((c, i) => [c.award.id, row(number).cells[i]]).filter(([, s]) => s !== "none"));
  assert.deepEqual(cellsOf("5150Z"), { excellence: "nominated", innovate: "nominated", amaze: "winner" });
  assert.deepEqual(cellsOf("7700B"), { excellence: "nominated", design: "nominated" });
  assert.deepEqual(cellsOf("2088C"), { design: "winner" });
  assert.equal(holdsText(row("5150Z").has), "Has Amaze");
  assert.deepEqual(row("7700B").has, []);
  assert.equal(row("7700B").tag, "P2");
  assert.equal(row("5150Z").tag, "P3");
});

test("a panel's matrix is that panel's nominations only, and loses the combined view's extras", () => {
  const p3 = buildMatrix(awards, nominationsIn(nominations, teams, MS, "p3"), decided, msTeams, panels, "p3");
  assert.deepEqual(p3.rows.map((r) => r.team.number), ["5150Z", "4242F", "2088C", "3311X"]);
  assert.ok(!p3.columns.some((c) => c.award.id === "inspire"), "Panel 2's award has no column under Panel 3");
  assert.equal(hiddenNote(p3.hidden, "Panel 3").startsWith("Create"), true);
});

test("a winner nobody nominates any more keeps its row and its tick: the judge withdrew after it was decided", () => {
  // Inspire went to Momentum; both judges then withdrew. Nothing else nominates Momentum.
  const left = nominations.filter((x) => x.team_id !== momentum.id);
  const won = winnersOf([...winners, win("inspire", momentum)], MS);
  const m = buildMatrix(awards, nominationsIn(left, teams, MS), won, msTeams, panels);
  const row = m.rows.find((r) => r.team.number === "8015M");
  assert.ok(row, "the row is still there");
  assert.equal(row.count, 0);
  assert.equal(row.cells[m.columns.findIndex((c) => c.award.id === "inspire")], "winner");
  assert.ok(m.columns.some((c) => c.award.id === "inspire" && c.decided), "and so is the column, ticked");
  assert.equal(row.tag, "P2", "its panel is the team's own, with no nomination to read it from");
  assert.equal(m.rows.at(-1).team.number, "8015M", "sorted last: the fewest nominations");
  // Under a single panel it is that panel's nominations only: the winner is not that panel's.
  const p2 = buildMatrix(awards, nominationsIn(left, teams, MS, "p2"), won, msTeams, panels, "p2");
  assert.ok(!p2.rows.some((r) => r.team.number === "8015M"));
});

/* ---- by award ----------------------------------------------------------------------------------- */

test("By award lists every award in the config's order, nominated or not, with how many nominees and whether it is decided", () => {
  const lists = buildAwardPanels(awards, msNoms, decided, msTeams, panels);
  assert.deepEqual(lists.map((l) => l.award.id), awards.map((a) => a.id));
  const status = Object.fromEntries(lists.map((l) => [l.award.id, l.status]));
  assert.equal(status.excellence, "2 nominees");
  assert.equal(status.design, "Decided");
  assert.equal(status.amaze, "Decided");
  assert.equal(status.create, "1 nominee");
  assert.equal(status.energy, "Open");
  assert.deepEqual(lists.find((l) => l.award.id === "energy").nominees, []);
});

test("a nominee row carries the team, the judges who nominated it, its panel and whether it won; the winner is listed first", () => {
  const lists = buildAwardPanels(awards, msNoms, decided, msTeams, panels);
  const of = (id) => lists.find((l) => l.award.id === id).nominees;
  assert.deepEqual(of("excellence").map((x) => [x.team.number, x.judges, x.tag, x.winner]), [["7700B", 2, "P2", false], ["5150Z", 1, "P3", false]]);
  assert.equal(judgesText(2), "2 judges");
  assert.equal(judgesText(1), "1 judge");
  assert.deepEqual(of("design").map((x) => [x.team.number, x.winner]), [["2088C", true], ["7700B", false]]);
  assert.deepEqual(of("amaze").map((x) => [x.team.number, x.judges, x.winner]), [["5150Z", 2, true]]);
});

test("a nominee that already holds another award is cautioned for it; the award being looked at does not count", () => {
  const lists = buildAwardPanels(awards, msNoms, decided, msTeams, panels);
  const of = (id) => lists.find((l) => l.award.id === id).nominees;
  assert.deepEqual(of("excellence").find((x) => x.team.number === "5150Z").has.map((a) => a.label), ["Amaze"]);
  assert.deepEqual(of("innovate").find((x) => x.team.number === "5150Z").has.map((a) => a.label), ["Amaze"]);
  assert.deepEqual(of("amaze").find((x) => x.team.number === "5150Z").has, [], "the award it won is not 'another' award");
  assert.deepEqual(of("excellence").find((x) => x.team.number === "7700B").has, []);
  assert.equal(hasText(of("excellence").find((x) => x.team.number === "5150Z").has), "Already has Amaze");
});

test("already has: the awards a team holds in its division, in the config's order, except the one asked about", () => {
  const two = winnersOf([...winners, win("excellence", gearGrinders)], MS);
  assert.deepEqual(alreadyHas(awards, two, gearGrinders.id).map((a) => a.label), ["Excellence", "Amaze"]);
  assert.deepEqual(alreadyHas(awards, two, gearGrinders.id, "amaze").map((a) => a.label), ["Excellence"]);
  assert.deepEqual(alreadyHas(awards, two, byteMe.id), []);
  assert.equal(hasText(alreadyHas(awards, two, gearGrinders.id)), "Already has Excellence, Amaze");
  // Another division's winners are another wall.
  assert.deepEqual(alreadyHas(awards, winnersOf([win("amaze", monitors)], MS), monitors.id), []);
});

test("a withdrawn winner is listed under its award with no judges, so it can be seen and cleared", () => {
  const left = nominations.filter((x) => x.team_id !== labRats.id);
  const lists = buildAwardPanels(awards, nominationsIn(left, teams, MS), decided, msTeams, panels);
  const design = lists.find((l) => l.award.id === "design");
  assert.deepEqual(design.nominees.map((x) => [x.team.number, x.judges, x.winner]), [["2088C", 0, true], ["7700B", 1, false]]);
  assert.equal(design.status, "Decided");
  assert.equal(judgesText(0), "Withdrawn");
});

/* ---- decided --------------------------------------------------------------------------------------- */

test("the decided counts are per division, over the awards the config lists", () => {
  assert.equal(decidedCount(winners, awards, MS), 3);
  assert.equal(decidedText(winners, awards, MS), "3/11");
  assert.equal(decidedText(winners, awards, HS), "0/11");
  const more = [...winners, win("excellence", monitors), win("energy", monitors)];
  assert.equal(decidedText(more, awards, HS), "2/11");
  assert.equal(decidedText(more, awards, MS), "3/11", "High School's winners are not Middle School's");
  // An award the config no longer lists has no row on the board to be decided in.
  assert.equal(decidedCount([...winners, { ...win("retired", gearGrinders), award_id: "retired" }], awards, MS), 3);
  assert.equal(decidedText(winners, [], MS), "0/0");
});

test("the board opens on the first division with a nomination, and keeps the one chosen while it exists", () => {
  assert.equal(defaultDivision(divisions, nominations, teams), MS, "Elementary School has none; Middle School has");
  assert.equal(defaultDivision(divisions, [], teams), "Elementary School", "nothing nominated: the first");
  assert.equal(defaultDivision([], [], []), "");
  assert.equal(pickDivision(HS, divisions, nominations, teams), HS);
  assert.equal(pickDivision("Gone", divisions, nominations, teams), MS, "a chosen division the event no longer has falls back");
  assert.equal(pickDivision(null, divisions, nominations, teams), MS);
});

/* ---- the side panel ---------------------------------------------------------------------------------- */

const everything = { awards, nominations, winners, teams, panels };

test("the side panel gathers why each panel nominated the team, judge by judge", () => {
  const d = detailFor({ awardId: "excellence", teamId: byteMe.id }, everything);
  assert.equal(d.award.label, "Excellence");
  const idOf = (t, awardId, judge) => nominations.find((x) => x.team_id === t.id && x.award_id === awardId && x.judge === judge).id;
  assert.deepEqual(d.reasons, [{
    key: "p2",
    panel: "Panel 2",
    judges: [
      { id: idOf(byteMe, "excellence", "Priya Nair"), judge: "Priya Nair", reason: "Every entry names who did the work." },
      { id: idOf(byteMe, "excellence", "Sam Rivera"), judge: "Sam Rivera", reason: "Top notebook, and strong in every match." },
    ],
  }]);
  assert.deepEqual(d.alsoFor.map((a) => a.label), ["Design"]);
  assert.deepEqual(d.has, []);
  assert.equal(d.isWinner, false);
  assert.equal(d.current, null);
  // A judge who gave no reason is still listed.
  const none = detailFor({ awardId: "design", teamId: byteMe.id }, everything);
  assert.deepEqual(none.reasons[0].judges, [{ id: idOf(byteMe, "design", "Sam Rivera"), judge: "Sam Rivera", reason: null }]);
});

test("the other nominees are those of this division for this award, with the caution each carries", () => {
  const d = detailFor({ awardId: "excellence", teamId: byteMe.id }, everything);
  assert.deepEqual(d.others.map((o) => [o.team.number, o.judges, o.winner, o.has.map((a) => a.label)]), [["5150Z", 1, false, ["Amaze"]]]);
  // High School's Excellence nominee is not Middle School's rival.
  assert.ok(!d.others.some((o) => o.team.id === monitors.id));
});

test("opening the winner says so, and opening a rival says who holds the award now", () => {
  const won = detailFor({ awardId: "design", teamId: labRats.id }, everything);
  assert.equal(won.isWinner, true);
  assert.equal(won.current, null);
  const rival = detailFor({ awardId: "design", teamId: byteMe.id }, everything);
  assert.equal(rival.isWinner, false);
  assert.equal(rival.current.number, "2088C");
  assert.deepEqual(rival.others.map((o) => [o.team.number, o.winner]), [["2088C", true]]);
  // Someone else's nomination for the same team in another award is a caution, not a block.
  const holds = detailFor({ awardId: "excellence", teamId: gearGrinders.id }, everything);
  assert.deepEqual(holds.has.map((a) => a.label), ["Amaze"]);
});

test("a nominee is nominated while a judge, the Judge Advisor or enough Good conduct flags still back it, and not once the last is gone", () => {
  const sel = { awardId: "design", teamId: byteMe.id };
  assert.equal(detailFor(sel, everything).nominated, true, "Sam's");
  const left = nominations.filter((x) => !(x.team_id === byteMe.id && x.award_id === "design"));
  const none = detailFor(sel, { ...everything, nominations: left, winners: [] });
  assert.deepEqual([none.nominated, none.isWinner, none.reasons], [false, false, []], "the server would refuse to give it");
  assert.equal(detailFor(sel, { ...everything, nominations: [...left, adminNom(byteMe, "design")] }).nominated, true, "the Judge Advisor's alone is enough");
  // Referees' Good conduct nominates for Sportsmanship only.
  const conduct = [1, 2].map((i) => ({ id: `f${i}`, team_id: quiet.id, kind: "good", body: "", author: "Ref", match_type: "Q", match_number: String(i) }));
  assert.equal(detailFor({ awardId: "sportsmanship", teamId: quiet.id }, { ...everything, flags: conduct }).nominated, true);
  assert.equal(detailFor({ awardId: "design", teamId: quiet.id }, { ...everything, flags: conduct }).nominated, false, "not for any other award");
  // A winner nobody nominates is still the winner, whatever `nominated` says.
  const withdrawn = detailFor({ awardId: "design", teamId: labRats.id }, { ...everything, nominations: nominations.filter((x) => x.team_id !== labRats.id) });
  assert.deepEqual([withdrawn.nominated, withdrawn.isWinner], [false, true]);
});

test("the panel opens on a winner nobody nominates any more, with nothing to quote", () => {
  const left = nominations.filter((x) => x.team_id !== labRats.id);
  const d = detailFor({ awardId: "design", teamId: labRats.id }, { ...everything, nominations: left });
  assert.equal(d.isWinner, true);
  assert.deepEqual(d.reasons, []);
  assert.deepEqual(d.alsoFor, []);
  // And the other team sees the withdrawn winner among its rivals.
  const other = detailFor({ awardId: "design", teamId: byteMe.id }, { ...everything, nominations: left });
  assert.deepEqual(other.others.map((o) => [o.team.number, o.judges, o.winner]), [["2088C", 0, true]]);
});

test("a nominee whose team or award has gone has no panel", () => {
  assert.equal(detailFor({ awardId: "excellence", teamId: "t-gone" }, everything), null);
  assert.equal(detailFor({ awardId: "retired", teamId: byteMe.id }, everything), null);
});

test("two panels that nominated the same team are two sections, in the roster's order, and a deleted panel is named so", () => {
  const both = [...nominations, nom(byteMe, "excellence", "p3", "Ken Ito", "Saw them at the pits."), nom(byteMe, "excellence", null, "Old Judge")];
  const d = detailFor({ awardId: "excellence", teamId: byteMe.id }, { ...everything, nominations: both });
  assert.deepEqual(d.reasons.map((r) => r.panel), ["Panel 2", "Panel 3", "a removed panel"]);
});

test("judges who differ only by case or spacing are one judge: old rows written before the store matched names count once", () => {
  const dupes = [
    nom(byteMe, "excellence", "p2", "Sam Rivera", "First reason"),
    nom(byteMe, "excellence", "p2", " sam rivera", "Second reason"),
    nom(byteMe, "design", "p2", "Sam Rivera"),
    nom(roboraptors, "excellence", "p2", "Sam Rivera"),
    nom(roboraptors, "excellence", "p2", "Priya Nair"),
    nom(roboraptors, "excellence", "p2", "PRIYA NAIR"),
  ];
  const nominees = (id) => buildAwardPanels(awards, dupes, new Map(), msTeams, panels).find((l) => l.award.id === id).nominees;
  assert.deepEqual(nominees("excellence").map((x) => [x.team.number, x.judges]), [["6060R", 2], ["7700B", 1]], "1 judge, and 2 judges");

  const m = buildMatrix(awards, dupes, new Map(), msTeams, panels);
  assert.deepEqual(m.rows.map((r) => [r.team.number, r.count]), [["6060R", 2], ["7700B", 2]], "Excellence and Design once each, not three");

  const d = detailFor({ awardId: "excellence", teamId: byteMe.id }, { ...everything, nominations: dupes });
  assert.deepEqual(d.reasons[0].judges, [{ id: dupes[0].id, judge: "Sam Rivera", reason: "First reason" }], "one line for the judge");
  assert.deepEqual(d.others.map((o) => [o.team.number, o.judges]), [["6060R", 2]]);

  // Different people with different names, and the same name on different panels, stay apart.
  const apart = [nom(byteMe, "excellence", "p2", "Sam"), nom(byteMe, "excellence", "p2", "Sam Rivera"), nom(byteMe, "excellence", "p3", "sam")];
  assert.equal(buildAwardPanels(awards, apart, new Map(), msTeams, panels).find((l) => l.award.id === "excellence").nominees[0].judges, 3);
});

test("referee flags: Good conduct and the worst of the rest, or none", () => {
  const kinds = [
    { id: "good", label: "Good conduct", short: "Good", color: "emerald", severity: 0, requiresRule: false },
    { id: "warning", label: "Warning", short: "Warning", color: "amber", severity: 1, requiresRule: false },
    { id: "major", label: "Major violation", short: "Major", color: "rose", severity: 3, requiresRule: true },
  ];
  const flag = (kind) => ({ team_id: byteMe.id, kind });
  assert.deepEqual(refereeLine([], kinds), { good: null, caution: null });
  assert.deepEqual(refereeLine([flag("good"), flag("good"), flag("good")], kinds), { good: "Good conduct ×3", caution: null });
  assert.deepEqual(refereeLine([flag("good"), flag("warning"), flag("warning"), flag("major")], kinds), { good: "Good conduct ×1", caution: "Major violation ×1" });
  assert.deepEqual(refereeLine([flag("warning")], kinds), { good: null, caution: "Warning ×1" }, "a flag of a kind the config dropped says nothing");
});

test("the panel's scores come from the Scores tab's own rows: each rubric, then the total", () => {
  const rubricList = rubrics();
  const notebook = rubricList.find((r) => r.id === "notebook");
  const interview = rubricList.find((r) => r.id === "interview");
  const marked = (t, rubric, mark) => {
    const values = {};
    rubric.sections.forEach((s) => s.criteria.forEach((c) => (values[c.id] = mark)));
    return { id: `s-${rubric.id}`, team_id: t.id, rubric_id: rubric.id, values, total: Object.values(values).reduce((a, b) => a + b, 0), scored_by: "Sam", panel_id: t.panel_id, updated_at: "2026-10-20T09:00:00Z" };
  };
  const categories = [{ id: "developing", excludesRubrics: [] }, { id: "ungraded", excludesRubrics: ["notebook"] }];
  const rows = withRanks(rankTeams([byteMe, { ...momentum, category: "ungraded" }, roboraptors], [marked(byteMe, notebook, 2), marked(byteMe, interview, 1), marked(momentum, interview, 2)], rubricList, categories));
  const of = (t) => rows.find((r) => r.team.id === t.id);

  const full = scoreParts(of(byteMe), rubricList);
  assert.deepEqual(full.parts.map((p) => p.label), [notebook.name, interview.name]);
  assert.match(full.parts[0].text, /^\d+\/\d+$/);
  assert.equal(full.total, `${of(byteMe).total}/${of(byteMe).max}`);
  // An Ungraded team's notebook is out of scope, not zero: no part for it.
  assert.deepEqual(scoreParts(of(momentum), rubricList).parts.map((p) => p.label), [interview.name]);
  // Unscored: nothing totalled.
  assert.equal(scoreParts(of(roboraptors), rubricList).total, null);
  assert.deepEqual(scoreParts(of(roboraptors), rubricList).parts.map((p) => p.text), ["not scored", "not scored"]);
  // Before the scores arrive there is no row, and no line.
  assert.equal(scoreParts(undefined, rubricList), null);
});

/* ---- giving and clearing: asked first when it takes the award from someone ---------------------------------- */

const asker = (answer) => {
  const asked = [];
  return { asked, ask: async (question, options) => (asked.push({ question, options }), answer) };
};
const caller = () => {
  const calls = [];
  return { calls, call: async (url, options) => (calls.push({ url, ...options }), {}) };
};
const design = awards.find((a) => a.id === "design");

test("giving an award nobody holds sends at once, asking nothing, with the team's own division", async () => {
  const yes = asker(true);
  const sent = caller();
  assert.equal(await giveAfterAsking(yes.ask, sent.call, { award: design, team: byteMe, current: null }), true);
  assert.deepEqual(yes.asked, []);
  assert.deepEqual(sent.calls, [{ url: "/api/awards/winners", method: "PUT", body: { awardId: "design", division: MS, teamId: byteMe.id } }]);
});

test("replacing a winner asks first, in the words 'Give Design to 7700B instead of 2088C?', and sends nothing on a no", async () => {
  assert.equal(giveQuestion(design, byteMe, labRats), "Give Design to 7700B instead of 2088C?");
  const no = asker(false);
  const declined = caller();
  assert.equal(await giveAfterAsking(no.ask, declined.call, { award: design, team: byteMe, current: labRats }), false);
  assert.deepEqual(no.asked, [{ question: "Give Design to 7700B instead of 2088C?", options: { confirmLabel: "Replace winner" } }]);
  assert.deepEqual(declined.calls, [], "declined: the winner stays");

  const yes = asker(true);
  const sent = caller();
  assert.equal(await giveAfterAsking(yes.ask, sent.call, { award: design, team: byteMe, current: labRats }), true);
  assert.equal(sent.calls.length, 1);
  assert.equal(sent.calls[0].body.teamId, byteMe.id);
});

test("a team that already has another award is not refused: the caution is the screen's, and the award is given", async () => {
  const d = detailFor({ awardId: "excellence", teamId: gearGrinders.id }, everything);
  assert.equal(d.has.length, 1);
  const yes = asker(true);
  const sent = caller();
  assert.equal(await giveAfterAsking(yes.ask, sent.call, { award: d.award, team: d.team, current: d.current }), true);
  assert.deepEqual(yes.asked, [], "no question: nobody holds Excellence");
  assert.equal(sent.calls[0].body.awardId, "excellence");
});

test("clearing a winner asks first and sends nothing on a no", async () => {
  assert.equal(clearQuestion(design, labRats), "Clear Design? 2088C will no longer be the winner.");
  const no = asker(false);
  const declined = caller();
  assert.equal(await clearAfterAsking(no.ask, declined.call, { award: design, team: labRats }), false);
  assert.deepEqual(no.asked, [{ question: "Clear Design? 2088C will no longer be the winner.", options: { confirmLabel: "Clear winner" } }]);
  assert.deepEqual(declined.calls, []);

  const sent = caller();
  assert.equal(await clearAfterAsking(asker(true).ask, sent.call, { award: design, team: labRats }), true);
  assert.deepEqual(sent.calls, [{ url: "/api/awards/winners", method: "DELETE", body: { awardId: "design", division: MS } }]);
});

/* ---- the Judge Advisor's own nominations ------------------------------------------------------------------------------ */

// Quiet Ones: nobody nominated them. Byte Me has two judges for Excellence. Alex puts both up.
const jaQuiet = adminNom(quiet, "excellence", "A team that deserves a look.");
const jaByte = adminNom(byteMe, "excellence");
const withJa = [...nominations, jaQuiet, jaByte];

test("a Judge Advisor nomination counts like a judge's: the matrix row, the cell, the nominee, the sort and the header count", () => {
  const m = buildMatrix(awards, nominationsIn(withJa, teams, MS), decided, msTeams, panels);
  const row = (n) => m.rows.find((r) => r.team.number === n);
  assert.equal(row("1111Q").count, 1, "a team only the Judge Advisor put up has a row");
  assert.equal(row("1111Q").cells[m.columns.findIndex((c) => c.award.id === "excellence")], "nominated");
  assert.equal(row("7700B").count, 4, "Excellence x2 and Design from judges, and the Judge Advisor's Excellence");
  assert.equal(row("1111Q").tag, "P2", "with no panel of its own to name, the row wears the team's panel");
  assert.equal(nominationsIn(withJa, teams, MS).length, 20, "two more for the header's N nominations");

  const excellence = buildAwardPanels(awards, nominationsIn(withJa, teams, MS), decided, msTeams, panels).find((l) => l.award.id === "excellence");
  assert.deepEqual(excellence.nominees.map((n) => [n.team.number, n.judges, n.ja]), [["7700B", 2, 1], ["1111Q", 0, 1], ["5150Z", 1, 0]], "most nominations first (the Judge Advisor's is one, level with a single judge's), then team number");
  assert.deepEqual([...excellence.ja].sort(), [byteMe.id, quiet.id].sort(), "the teams the Add team picker marks as added");
  assert.equal(excellence.status, "3 nominees");
});

test("a Judge Advisor nomination reads \"1 judge · JA\" or \"JA\" on screen and in full words for a screen reader", () => {
  assert.deepEqual(backing(1, 0, 1), { judges: "1 judge · JA", conduct: null });
  assert.deepEqual(backing(2, 0, 1), { judges: "2 judges · JA", conduct: null });
  assert.deepEqual(backing(0, 0, 1), { judges: "JA", conduct: null }, "nobody else: not 'Withdrawn'");
  assert.deepEqual(backing(0, 3, 1), { judges: "JA", conduct: "Good conduct ×3" });
  assert.deepEqual(backing(0, 0, 0), { judges: "Withdrawn", conduct: null }, "unchanged without it");
  assert.equal(backingText(1, 0, 1), "1 judge · Judge Advisor");
  assert.equal(backingText(0, 0, 1), "Judge Advisor");
  assert.equal(backingText(1, 2), "1 judge, Good conduct ×2");
});

test("a panel's view leaves the Judge Advisor's nominations out: they belong to All panels", () => {
  assert.equal(nominationsIn(withJa, teams, MS, "p2").some((n) => n.role === "admin"), false);
  assert.equal(nominationsIn(withJa, teams, MS, "p3").some((n) => n.role === "admin"), false);
  assert.equal(nominationsIn(withJa, teams, MS).filter((n) => n.role === "admin").length, 2);
  const chips = panelChips(panels.filter((p) => p.division === MS), nominationsIn(withJa, teams, MS));
  assert.deepEqual(chips.map((c) => [c.label, c.count]), [["All panels", 10], ["Panel 2", 5], ["Panel 3", 4]], "All panels gains Quiet Ones; Byte Me was already counted");
});

test("the side panel lists the Judge Advisor's nomination last, as its own section, and every line carries the nomination's id", () => {
  const d = detailFor({ awardId: "excellence", teamId: byteMe.id }, { ...everything, nominations: withJa });
  assert.deepEqual(d.reasons.map((r) => [r.key, r.panel]), [["p2", "Panel 2"], [JA_KEY, "the Judge Advisor"]]);
  assert.deepEqual(d.reasons[1].judges, [{ id: jaByte.id, judge: "Alex Morgan", reason: null }]);
  assert.deepEqual(d.reasons[0].judges.map((j) => j.id), nominations.filter((x) => x.team_id === byteMe.id && x.award_id === "excellence").map((x) => x.id).reverse(), "Priya, then Sam");

  const only = detailFor({ awardId: "excellence", teamId: quiet.id }, { ...everything, nominations: withJa });
  assert.deepEqual(only.reasons.map((r) => r.key), [JA_KEY], "no panel section for a team no judge nominated");
  assert.deepEqual(only.reasons[0].judges[0].reason, "A team that deserves a look.");

  // The other nominees count the Judge Advisor too.
  assert.deepEqual(d.others.map((o) => [o.team.number, o.judges, o.ja]), [["1111Q", 0, 1], ["5150Z", 1, 0]]);
});

test("\"Also nominate for…\" offers every award the Judge Advisor has not nominated the team for, this one included when only judges did", () => {
  const open = detailFor({ awardId: "excellence", teamId: byteMe.id }, everything);
  assert.equal(open.addable.length, awards.length, "judges' nominations do not use up the Judge Advisor's");
  const d = detailFor({ awardId: "excellence", teamId: byteMe.id }, { ...everything, nominations: withJa });
  assert.deepEqual(d.addable.map((a) => a.id), awards.map((a) => a.id).filter((id) => id !== "excellence"));
  assert.equal(d.alsoFor.some((a) => a.id === "excellence"), false);
  assert.deepEqual(d.alsoFor.map((a) => a.id), ["design"]);
});

test("two Judge Advisor rows for the same name are one, as two judges' rows are; the Judge Advisor and a judge of the same name are two", () => {
  const dupes = [adminNom(byteMe, "design", null, "Alex Morgan"), adminNom(byteMe, "design", null, " alex morgan"), nom(byteMe, "design", null, "Alex Morgan")];
  const list = buildAwardPanels(awards, dupes, new Map(), msTeams, panels).find((l) => l.award.id === "design");
  assert.deepEqual(list.nominees.map((n) => [n.judges, n.ja]), [[1, 1]]);
});

test("the Add team picker lists the division's teams by number", () => {
  assert.deepEqual(teamsByNumber([torque, byteMe, quiet, labRats]).map((t) => t.number), ["1111Q", "2088C", "7700B", "9882K"]);
  assert.deepEqual(teamsByNumber(msTeams).length, msTeams.length);
});

test("the Judge Advisor nominates through POST /api/awards with just the award and the team, and no question is asked", async () => {
  const sent = caller();
  assert.equal(await nominateAsAdmin(sent.call, { awardId: "design", teamId: quiet.id, extra: "ignored" }), true);
  assert.deepEqual(sent.calls, [{ url: "/api/awards", method: "POST", body: { awardId: "design", teamId: quiet.id } }]);
});

test("removing a nomination asks first, by name, and sends only the id; nothing is sent on a no", async () => {
  const excellence = awards.find((a) => a.id === "excellence");
  assert.equal(removeQuestion("Priya Nair", excellence, byteMe), "Remove Priya Nair's Excellence nomination for 7700B?");
  assert.equal(removeQuestion("the Judge Advisor", excellence, byteMe), "Remove the Judge Advisor's Excellence nomination for 7700B?");

  const no = asker(false);
  const declined = caller();
  assert.equal(await removeAfterAsking(no.ask, declined.call, { id: "n6", by: "Priya Nair", award: excellence, team: byteMe }), false);
  assert.deepEqual(no.asked, [{ question: "Remove Priya Nair's Excellence nomination for 7700B?", options: { confirmLabel: "Remove nomination", danger: true } }]);
  assert.deepEqual(declined.calls, []);

  const sent = caller();
  assert.equal(await removeAfterAsking(asker(true).ask, sent.call, { id: "n6", by: "Priya Nair", award: excellence, team: byteMe }), true);
  assert.deepEqual(sent.calls, [{ url: "/api/awards", method: "DELETE", body: { id: "n6" } }]);
});

/* ---- the view that is remembered ---------------------------------------------------------------------------------- */

test("the view is remembered in the browser, and a browser that will not say falls back to the matrix", () => {
  const store = () => {
    const kept = new Map();
    return { kept, getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => void kept.set(k, v) };
  };
  const s = store();
  assert.equal(loadView(s), "matrix", "nothing saved");
  saveView("award", s);
  assert.equal(s.kept.get(VIEW_KEY), "award");
  assert.equal(loadView(s), "award");
  saveView("matrix", s);
  assert.equal(loadView(s), "matrix");
  s.kept.set(VIEW_KEY, "something else");
  assert.equal(loadView(s), "matrix", "a value nobody saved is not a view");

  const blocked = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.equal(loadView(blocked), "matrix");
  assert.doesNotThrow(() => saveView("award", blocked));
  // No window at all (the tests run in Node): the default store throws inside the try.
  assert.equal(loadView(), "matrix");
  assert.doesNotThrow(() => saveView("award"));
});

/* ---- Good conduct from referees: two flags are a nomination for Sportsmanship ------------------------------------ */

let flagId = 0;
const flag = (t, kind, over = {}) => ({
  id: `f${++flagId}`, team_id: t.id, kind, body: "", author: "Jordan Lee", match_type: "Q", match_number: "7", field: "1", rule: null, ruleset: "v5rc",
  manual_version: null, match_affecting: false, created_at: "2026-10-20T10:00:00.000Z", ...over,
});
const good = (t, n) => Array.from({ length: n }, () => flag(t, "good"));
/** Quiet Ones: three Good conduct flags and no judge. Torque Titans: two, and a judge's Sportsmanship nomination. Byte Me: one, which is not enough. Hall Monitors (High School): two. */
const flags = [...good(quiet, 3), ...good(torque, 2), ...good(byteMe, 1), flag(roboraptors, "warning"), flag(roboraptors, "warning"), ...good(monitors, 2)];
const conduct = conductIn(flags, teams, MS);
const noJudgeSportsmanship = nominationsIn(nominations.filter((x) => !(x.award_id === "sportsmanship")), teams, MS);

test("the teams Good conduct puts up are those of this division with two flags or more, and none under a panel", () => {
  assert.deepEqual([...conduct], [[quiet.id, 3], [torque.id, 2]], "Byte Me has one, Roboraptors only Warnings, Hall Monitors another division");
  assert.deepEqual([...conductIn(flags, teams, HS)], [[monitors.id, 2]]);
  assert.deepEqual([...conductIn(flags, teams, MS, "p2")], [], "no panel nominated them, so a panel's view has none");
  assert.deepEqual([...conductIn([], teams, MS)], []);
});

test("the words: Good conduct x3, the key's x2+, and what backs a nominee", () => {
  assert.equal(conductText(3), "Good conduct ×3");
  assert.equal(conductKeyText, "Good conduct ×2+");
  assert.deepEqual(backing(2, 0), { judges: "2 judges", conduct: null });
  assert.deepEqual(backing(0, 3), { judges: null, conduct: "Good conduct ×3" }, "flags alone: no judges to count, and none said");
  assert.deepEqual(backing(1, 2), { judges: "1 judge", conduct: "Good conduct ×2" });
  assert.deepEqual(backing(0, 0), { judges: "Withdrawn", conduct: null }, "a winner nobody backs any more");
  assert.equal(backingText(1, 2), "1 judge, Good conduct ×2");
  assert.equal(backingText(0, 3), "Good conduct ×3");
  assert.equal(conductLine({ author: "Jordan Lee", match_type: "Q", match_number: "23" }), "Jordan Lee · Q23");
  assert.equal(conductLine({ author: "Jordan Lee", match_type: null, match_number: null }), "Jordan Lee", "a flag from before matches were recorded");
});

test("the header and the All panels chip count each Good conduct team once, alongside the judges' nominations", () => {
  assert.equal(distinctTeams(msNoms, conduct.keys()), 10, "Quiet Ones is new; Torque Titans was already counted");
  assert.deepEqual(panelChips(panels.filter((p) => p.division === MS), msNoms, conduct).map((c) => c.count), [10, 5, 4], "a panel's chip is what that panel nominated");
  assert.equal(distinctTeams(msNoms), 9, "without flags nothing changes");
});

test("the matrix gets a row for a Good conduct team and a green-dot cell, and the Sportsmanship column when only referees put someone up", () => {
  const m = buildMatrix(awards, noJudgeSportsmanship, decided, msTeams, panels, ALL_PANELS, conduct);
  const row = (number) => m.rows.find((r) => r.team.number === number);
  const cellsOf = (number) => Object.fromEntries(m.columns.map((c, i) => [c.award.id, row(number).cells[i]]).filter(([, s]) => s !== "none"));
  assert.ok(m.columns.some((c) => c.award.id === "sportsmanship"), "the column is there though no judge nominated for it");
  assert.equal(m.hidden.some((a) => a.id === "sportsmanship"), false);
  assert.deepEqual(cellsOf("1111Q"), { sportsmanship: "conduct" }, "Quiet Ones: no judge, only the referees");
  assert.deepEqual(cellsOf("9882K"), { build: "nominated", sportsmanship: "conduct" }, "Torque Titans with the judge's Sportsmanship nomination taken away");
  assert.deepEqual([row("1111Q").conduct, row("9882K").conduct, row("7700B").conduct], [3, 2, 0]);
  assert.ok(!m.rows.some((r) => r.team.id === monitors.id), "another division's flags are not this board's");
  // Without the flags nothing is added, and the column goes with the nomination.
  const plain = buildMatrix(awards, noJudgeSportsmanship, decided, msTeams, panels);
  assert.ok(!plain.rows.some((r) => r.team.number === "1111Q"));
  assert.ok(plain.hidden.some((a) => a.id === "sportsmanship"));
});

test("a judge's nomination keeps the ink dot though the referees also put the team up; a winner keeps the tick", () => {
  const m = buildMatrix(awards, msNoms, decided, msTeams, panels, ALL_PANELS, conduct);
  const at = m.columns.findIndex((c) => c.award.id === "sportsmanship");
  assert.equal(m.rows.find((r) => r.team.number === "9882K").cells[at], "nominated");
  assert.equal(m.rows.find((r) => r.team.number === "1111Q").cells[at], "conduct");
  const won = buildMatrix(awards, msNoms, winnersOf([...winners, win("sportsmanship", quiet)], MS), msTeams, panels, ALL_PANELS, conduct);
  assert.equal(won.rows.find((r) => r.team.number === "1111Q").cells[at], "winner");
  assert.equal(holdsText(won.rows.find((r) => r.team.number === "1111Q").has), "Has Sportsmanship");
});

test("a flag-only nomination sorts like one nomination; one beside a judge's own Sportsmanship nomination adds nothing", () => {
  const m = buildMatrix(awards, msNoms, decided, msTeams, panels, ALL_PANELS, conduct);
  const count = (number) => m.rows.find((r) => r.team.number === number).count;
  assert.equal(count("1111Q"), 1);
  assert.equal(count("9882K"), 2, "Build and Sportsmanship by judges, already two");
  assert.deepEqual(m.rows.slice(-4).map((r) => r.team.number), ["1111Q", "1234A", "2088C", "3311X"], "with the other one-nomination teams, by team number");
  // A flag-only team beside a judge's other award is one more.
  const other = buildMatrix(awards, nominationsIn(nominations.filter((x) => x.award_id !== "sportsmanship"), teams, MS), decided, msTeams, panels, ALL_PANELS, conduct);
  assert.equal(other.rows.find((r) => r.team.number === "9882K").count, 2, "Build by a judge, and Good conduct as one more");
});

test("under a panel the matrix is that panel's nominations only: Good conduct belongs to no panel", () => {
  const p3 = buildMatrix(awards, nominationsIn(nominations, teams, MS, "p3"), decided, msTeams, panels, "p3", conductIn(flags, teams, MS, "p3"));
  assert.ok(!p3.rows.some((r) => r.team.number === "1111Q"));
  assert.ok(p3.hidden.some((a) => a.id === "sportsmanship"));
});

test("By award: Sportsmanship lists a Good conduct team with its flags and no judges, beside the judges' nominee; no other award does", () => {
  const lists = buildAwardPanels(awards, msNoms, decided, msTeams, panels, ALL_PANELS, conduct);
  const of = (id) => lists.find((l) => l.award.id === id);
  assert.deepEqual(of("sportsmanship").nominees.map((n) => [n.team.number, n.judges, n.conduct]), [["9882K", 1, 2], ["1111Q", 0, 3]], "the judge's nominee first, as for any award");
  assert.equal(of("sportsmanship").status, "2 nominees", "the header's count includes them");
  assert.equal(of("sportsmanship").nominees[1].tag, "P2", "its own panel, as for a winner nobody nominates");
  assert.equal(backingText(0, 3), "Good conduct ×3");
  for (const l of lists.filter((x) => x.award.id !== "sportsmanship")) assert.ok(l.nominees.every((n) => n.conduct === 0), l.award.label);
  assert.equal(of("energy").status, "Open");
  // With no flags, Sportsmanship is the judges' alone.
  const plain = buildAwardPanels(awards, msNoms, decided, msTeams, panels);
  assert.deepEqual(plain.find((l) => l.award.id === "sportsmanship").nominees.map((n) => [n.team.number, n.conduct]), [["9882K", 0]]);
  // Under a panel, none.
  assert.equal(buildAwardPanels(awards, nominationsIn(nominations, teams, MS, "p2"), decided, msTeams, panels, "p2", conductIn(flags, teams, MS, "p2")).find((l) => l.award.id === "sportsmanship").nominees.length, 1);
});

test("the side panel for a Good conduct nominee holds the flags themselves; for another award it holds none", () => {
  const f = [flag(quiet, "good", { author: "Ana Cruz", match_number: "3", body: "Lent them a cable." }), ...good(quiet, 1), flag(quiet, "warning")];
  const d = detailFor({ awardId: "sportsmanship", teamId: quiet.id }, { ...everything, flags: f });
  assert.deepEqual(d.reasons, [], "no judge");
  assert.deepEqual(d.conduct.map((x) => x.kind), ["good", "good"], "the Good conduct flags, not the Warning");
  assert.equal(d.conduct[0].author, "Ana Cruz");
  assert.equal(d.isWinner, false);
  assert.equal(d.has.length, 0);
  assert.deepEqual(detailFor({ awardId: "sportsmanship", teamId: quiet.id }, { ...everything, flags: [flag(quiet, "good")] }).conduct, [], "one flag is not a nomination");
  assert.deepEqual(detailFor({ awardId: "sportsmanship", teamId: quiet.id }, everything).conduct, [], "no flags passed");
  // Another award's panel for a team the judges nominated: no conduct section, but Sportsmanship is among its other nominations.
  const tt = detailFor({ awardId: "build", teamId: torque.id }, { ...everything, flags });
  assert.deepEqual(tt.conduct, []);
  assert.deepEqual(tt.alsoFor.map((a) => a.label), ["Sportsmanship"]);
});

test("the other Sportsmanship nominees include the Good conduct teams, with the flags that put them up", () => {
  const d = detailFor({ awardId: "sportsmanship", teamId: torque.id }, { ...everything, flags });
  assert.deepEqual(d.reasons.map((r) => r.panel), ["Panel 2"], "the judge's reason is still there");
  assert.equal(d.conduct.length, 2, "and the referees' flags beside it");
  assert.deepEqual(d.others.map((o) => [o.team.number, o.judges, o.conduct]), [["1111Q", 0, 3]]);
  // The other way round: the flag-only team sees the judges' nominee as a rival.
  const q = detailFor({ awardId: "sportsmanship", teamId: quiet.id }, { ...everything, flags });
  assert.deepEqual(q.others.map((o) => [o.team.number, o.judges, o.conduct]), [["9882K", 1, 2]]);
  // For another award the rivals carry no Good conduct.
  const build = detailFor({ awardId: "build", teamId: torque.id }, { ...everything, flags });
  assert.ok(build.others.every((o) => o.conduct === 0));
});
