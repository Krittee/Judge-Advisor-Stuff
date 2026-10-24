import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_PANELS,
  alreadyHas,
  buildAwardPanels,
  buildMatrix,
  clearAfterAsking,
  clearQuestion,
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
  judgesText,
  loadView,
  nominationsIn,
  nominationsText,
  panelChips,
  panelShort,
  panelTagText,
  pickDivision,
  refereeLine,
  saveView,
  scoreParts,
  VIEW_KEY,
  winnersOf,
} from "../src/components/admin/awardsLogic";
import { withRanks } from "../src/components/admin/scoresLogic";
import { rankTeams } from "../src/lib/ranking";
import { rubrics } from "../src/lib/rubrics";
import {
  awards, byteMe, divisions, gearGrinders, HS, labRats, MS, momentum, monitors, nom, nominations, panels, quiet, roboraptors, teams, win, winners,
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
  assert.deepEqual(d.reasons, [{
    key: "p2",
    panel: "Panel 2",
    judges: [
      { judge: "Priya Nair", reason: "Every entry names who did the work." },
      { judge: "Sam Rivera", reason: "Top notebook, and strong in every match." },
    ],
  }]);
  assert.deepEqual(d.alsoFor.map((a) => a.label), ["Design"]);
  assert.deepEqual(d.has, []);
  assert.equal(d.isWinner, false);
  assert.equal(d.current, null);
  // A judge who gave no reason is still listed.
  const none = detailFor({ awardId: "design", teamId: byteMe.id }, everything);
  assert.deepEqual(none.reasons[0].judges, [{ judge: "Sam Rivera", reason: null }]);
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
