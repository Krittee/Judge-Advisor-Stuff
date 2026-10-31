import assert from "node:assert/strict";
import test from "node:test";

import {
  canRecord,
  conflictGroups,
  judgeConflictCount,
  judgeOptionGroups,
  judgeStatus,
  panelTag,
  recordConflicts,
  resultLines,
  strandedTeams,
  withdrawAfterAsking,
  withdrawQuestion,
} from "../src/components/admin/conflictsLogic";
import { divisionTag } from "../src/components/admin/floorLogic";
import { createConfirmer } from "../src/components/ConfirmDialog";
import { panelBlocks } from "../src/lib/roster";

/* The Conflicts tab's decisions, run for real against
   src/components/admin/conflictsLogic.ts. How they are drawn is in
   adminConflicts.runtime.test.tsx. */

const panel = (n, division) => ({ id: `p${n}`, name: `Panel ${n}`, division, judges: [], languages: ["en"], sort_order: n });
const p1 = panel(1, "High School");
const p2 = panel(2, "Middle School");
const p3 = panel(3, "Middle School");
const p4 = panel(4, "Elementary School");
const panels = [p1, p2, p3, p4];

const judge = (id, name, panel_id) => ({ id, name, note: null, panel_id, created_at: "2026-10-20T08:00:00Z" });
const dana = judge("j-dana", "Dana Ruiz", "p1");
const priya = judge("j-priya", "Priya Nair", "p2");
const lee = judge("j-lee", "Lee Chen", "p2");
const tom = judge("j-tom", "Tom Baker", "p3");
const jordan = judge("j-jordan", "Jordan Kim", null);
const roster = [dana, priya, lee, tom, jordan];

const team = (number, panel_id, division = "Middle School") => ({
  id: `t-${number}`, number, name: `Team ${number}`, panel_id, division, category: "developing", pit: null, created_at: "2026-10-20T08:00:00Z",
});
const titans = team("9882K", "p5");
const byteMe = team("7700B", null);
const sparky = team("5150Z", null);
const breakers = team("1234X", "p3");
const rivets = team("2468E", "p4", "Elementary School");
const teams = [titans, byteMe, sparky, breakers, rivets];

const byJudge = (id, judge_id, t, note = null) => ({ id, panel_id: null, judge_id, team_id: t.id, judge_name: null, note, declared_by: "admin:Alex", created_at: "2026-10-20T09:00:00Z" });
const byPanel = (id, panel_id, t) => ({ id, panel_id, judge_id: null, team_id: t.id, judge_name: "Priya Nair", note: null, declared_by: "admin:Alex", created_at: "2026-10-20T09:00:00Z" });

/* ---- the count ------------------------------------------------------------- */

test("the rail's conflict count is the judges' conflicts; the older whole-panel entries are not counted", () => {
  const conflicts = [byJudge("c1", priya.id, titans), byJudge("c2", priya.id, byteMe), byPanel("c3", "p4", rivets)];
  assert.equal(judgeConflictCount(conflicts), 2);
  assert.equal(judgeConflictCount([byPanel("c3", "p4", rivets)]), 0);
  assert.equal(judgeConflictCount([]), 0);
  // A row from before the roster has no judge_id at all.
  assert.equal(judgeConflictCount([{ id: "c9", panel_id: "p1", team_id: "t" }]), 0);
});

/* ---- tags ------------------------------------------------------------------ */

test("a division is a short tag: initials, a number kept whole, one word left alone", () => {
  assert.equal(divisionTag("Middle School"), "MS");
  assert.equal(divisionTag("Elementary School"), "ES");
  assert.equal(divisionTag("High School"), "HS");
  assert.equal(divisionTag("Division 1"), "D1");
  assert.equal(divisionTag("Division 12"), "D12");
  assert.equal(divisionTag("Blended"), "BLN");
  assert.equal(divisionTag("blended"), "BLN");
  assert.equal(divisionTag("  BLENDED "), "BLN");
  assert.equal(divisionTag("Open"), "Open");
  assert.equal(divisionTag("  Middle   School "), "MS");
  assert.equal(panelTag(p2), "Panel 2 · MS");
});

/* ---- the list, grouped by judge -------------------------------------------- */

test("the list is only judges with conflicts, in roster order, each with the panel it blocks", () => {
  const conflicts = [
    byJudge("c1", jordan.id, breakers, "mentor"),
    byJudge("c2", priya.id, titans, "coaches this team"),
    byJudge("c3", priya.id, byteMe),
    byJudge("c4", lee.id, sparky),
  ];
  const { byJudge: groups, legacy } = conflictGroups(conflicts, roster, panels, teams);
  assert.deepEqual(groups.map((g) => g.judge.name), ["Priya Nair", "Lee Chen", "Jordan Kim"], "roster order, not the order recorded; Dana and Tom have none");
  assert.deepEqual(groups.map((g) => g.panel?.id ?? null), ["p2", "p2", null], "Jordan is on no panel, so blocks none");
  assert.deepEqual(groups[0].rows.map((r) => [r.team.number, r.conflict.note]), [["9882K", "coaches this team"], ["7700B", null]]);
  assert.deepEqual(legacy, []);
});

test("a judge who moves takes the group's panel with them; one with no panel blocks nothing", () => {
  const conflicts = [byJudge("c1", priya.id, titans)];
  const panelOf = (judges) => conflictGroups(conflicts, judges, panels, teams).byJudge[0].panel?.id ?? null;
  assert.equal(panelOf([priya]), "p2");
  assert.equal(panelOf([{ ...priya, panel_id: "p3" }]), "p3");
  assert.equal(panelOf([{ ...priya, panel_id: null }]), null);
});

test("older whole-panel entries are their own list, with the panel they block, after the judges", () => {
  const conflicts = [byPanel("c1", "p4", rivets), byJudge("c2", priya.id, titans)];
  const { byJudge: groups, legacy } = conflictGroups(conflicts, roster, panels, teams);
  assert.equal(groups.length, 1);
  assert.deepEqual(legacy.map((l) => [l.team.number, l.panel.id]), [["2468E", "p4"]]);
  assert.deepEqual(conflictGroups([], roster, panels, teams), { byJudge: [], legacy: [] });
});

test("a conflict whose team is gone still lists, with no team", () => {
  const { byJudge: groups } = conflictGroups([{ ...byJudge("c1", priya.id, titans), team_id: "gone" }], roster, panels, teams);
  assert.equal(groups[0].rows[0].team, undefined);
});

/* ---- stranded -------------------------------------------------------------- */

test("a team is stranded when every panel in its division is blocked from it, judged through panelBlocks", () => {
  const blocks = (conflicts, judges = roster) => panelBlocks(conflicts, judges);
  // Sparky is Middle School with no panel; Panels 2 and 3 are the Middle School panels.
  assert.deepEqual(strandedTeams(teams, panels, blocks([byJudge("c1", priya.id, sparky)])), [], "Panel 3 is still open");
  assert.deepEqual(
    strandedTeams(teams, panels, blocks([byJudge("c1", priya.id, sparky), byJudge("c2", tom.id, sparky)])).map((t) => t.number),
    ["5150Z"],
    "judges on both Middle School panels",
  );
  assert.deepEqual(
    strandedTeams(teams, panels, blocks([byJudge("c1", priya.id, sparky), byPanel("c2", "p3", sparky)])).map((t) => t.number),
    ["5150Z"],
    "an older whole-panel entry counts the same",
  );
  // Tom moves off Panel 3: the block goes with him.
  assert.deepEqual(
    strandedTeams(teams, panels, blocks([byJudge("c1", priya.id, sparky), byJudge("c2", tom.id, sparky)], [priya, { ...tom, panel_id: null }])),
    [],
  );
  // A judge on no panel blocks nobody; a team that has a panel is never stranded.
  assert.deepEqual(strandedTeams(teams, panels, blocks([byJudge("c1", jordan.id, sparky)])), []);
  assert.deepEqual(strandedTeams(teams, panels, blocks([byJudge("c1", priya.id, titans), byJudge("c2", tom.id, titans)])), []);
});

/* ---- the Judge select ------------------------------------------------------ */

test("the Judge select groups by panel in panel order, then judges with no panel, and leaves empty groups out", () => {
  const groups = judgeOptionGroups(roster, panels);
  assert.deepEqual(
    groups.map((g) => [g.label, g.judges.map((j) => j.name)]),
    [
      ["Panel 1 · HS", ["Dana Ruiz"]],
      ["Panel 2 · MS", ["Priya Nair", "Lee Chen"]],
      ["Panel 3 · MS", ["Tom Baker"]],
      ["Not on a panel", ["Jordan Kim"]],
    ],
    "Panel 4 has no judges, so no group",
  );
  assert.deepEqual(judgeOptionGroups([], panels), []);
  // A judge pointing at a panel that no longer exists reads as not on a panel.
  assert.deepEqual(judgeOptionGroups([{ ...dana, panel_id: "gone" }], panels).map((g) => g.label), ["Not on a panel"]);
});

test("under the select: Blocks Panel N, or Not on a panel yet, and nothing before a judge is chosen", () => {
  assert.deepEqual(judgeStatus(priya.id, roster, panels), { blocks: true, text: "Blocks Panel 2" });
  assert.deepEqual(judgeStatus(jordan.id, roster, panels), { blocks: false, text: "Not on a panel yet" });
  assert.deepEqual(judgeStatus("new", roster, panels), { blocks: false, text: "Not on a panel yet" });
  assert.equal(judgeStatus("", roster, panels), null);
  assert.equal(judgeStatus("gone", roster, panels), null);
});

/* ---- the result box -------------------------------------------------------- */

test("a recording reports each number under one of four lines, each only when it has something to say", () => {
  const all = resultLines(
    { judge: priya, recorded: ["9882K", "7700B"], unchanged: ["5150Z"], notFound: ["0420Z"], takenOff: ["7700B"] },
    panels,
  );
  assert.deepEqual(
    all.map((l) => [l.kind, l.lead, l.numbers, l.tail ?? ""]),
    [
      ["ok", "Recorded for Priya Nair: ", ["9882K", "7700B"], ""],
      ["warn", "Priya Nair is on Panel 2, so ", ["7700B"], " comes off it and needs a panel"],
      ["mute", "Already recorded: ", ["5150Z"], ""],
      ["bad", "No team with that number — check these: ", ["0420Z"], ""],
    ],
  );
  const two = resultLines({ judge: priya, recorded: ["1", "2"], unchanged: [], notFound: [], takenOff: ["1", "2"] }, panels);
  assert.equal(two[1].tail, " come off it and need a panel");
  assert.deepEqual(resultLines({ judge: priya, recorded: [], unchanged: ["5150Z"], notFound: [], takenOff: [] }, panels).map((l) => l.kind), ["mute"]);
});

/* ---- recording ------------------------------------------------------------- */

/** A stand-in for `call` that records what it was asked and answers like the API. */
function fakeCall(over = {}) {
  const sent = [];
  const send = async (url, options = {}) => {
    sent.push([options.method ?? "POST", url, options.body]);
    if (over.fail?.(url)) throw new Error(over.fail(url));
    if (url === "/api/admin/judges") return { judge: judge("j-new", options.body.name, null) };
    return { judge: priya, recorded: ["9882K"], unchanged: [], notFound: [], takenOff: [] };
  };
  return { send, sent };
}
const form = { judge: priya.id, name: "", judgeNote: "", teamNumbers: "9882K", note: "  coaches this team " };

test("recording for a judge on the roster sends their id and the pasted list, and nothing else", async () => {
  const { send, sent } = fakeCall();
  const result = await recordConflicts(send, form);
  assert.deepEqual(sent, [["POST", "/api/conflicts", { judgeId: "j-priya", teamNumbers: "9882K", note: "coaches this team" }]]);
  assert.deepEqual(result.recorded, ["9882K"]);
});

test("+ New judge… creates the judge first, then records against the id the roster hands back", async () => {
  const { send, sent } = fakeCall();
  const heard = [];
  await recordConflicts(send, { ...form, judge: "new", name: "  Sam Okafor ", judgeNote: " parent volunteer " }, (j) => {
    heard.push([j.id, sent.length]);
  });
  assert.deepEqual(sent, [
    ["POST", "/api/admin/judges", { name: "Sam Okafor", note: "parent volunteer" }],
    ["POST", "/api/conflicts", { judgeId: "j-new", teamNumbers: "9882K", note: "coaches this team" }],
  ]);
  assert.deepEqual(heard, [["j-new", 1]], "the form hears about the new judge after the create and before the recording");
});

test("a new judge the roster refuses (a duplicate name) records nothing", async () => {
  const { send, sent } = fakeCall({ fail: (url) => (url === "/api/admin/judges" ? "A judge called Sam Okafor is already on the roster." : null) });
  await assert.rejects(recordConflicts(send, { ...form, judge: "new", name: "Sam Okafor" }), /already on the roster/);
  assert.equal(sent.length, 1, "the recording was never sent");
});

test("a recording that fails after the judge was created leaves the form on that judge, so a retry does not create them twice", async () => {
  const { send, sent } = fakeCall({ fail: (url) => (url === "/api/conflicts" ? "No team numbers found." : null) });
  let kept = null;
  await assert.rejects(recordConflicts(send, { ...form, judge: "new", name: "Sam Okafor" }, (j) => (kept = j.id)), /No team numbers/);
  assert.equal(kept, "j-new");
  assert.equal(sent.filter(([, url]) => url === "/api/admin/judges").length, 1);
});

test("Record needs a judge (with a name, if new) and at least one team number", () => {
  assert.equal(canRecord(form), true);
  assert.equal(canRecord({ ...form, judge: "" }), false, "no judge chosen");
  assert.equal(canRecord({ ...form, teamNumbers: " \n " }), false, "no numbers");
  assert.equal(canRecord({ ...form, judge: "new", name: "  " }), false, "a new judge needs a name");
  assert.equal(canRecord({ ...form, judge: "new", name: "Sam" }), true);
});

/* ---- Withdraw -------------------------------------------------------------- */

const row = (conflict, t, j, p) => ({ conflict, team: t, judge: j, panel: p });

test("Withdraw asks in the spec's words, naming the judge, the team and the panel that is freed", () => {
  const c = byJudge("c1", priya.id, titans);
  assert.equal(
    withdrawQuestion(row(c, titans, priya, p2), [c], roster),
    "Withdraw Priya Nair's conflict with 9882K? Panel 2 will be able to judge them again.",
  );
});

test("when another conflict still keeps the panel off the team, the question says so instead of promising", () => {
  const c1 = byJudge("c1", priya.id, titans);
  const c2 = byJudge("c2", lee.id, titans);
  assert.equal(
    withdrawQuestion(row(c1, titans, priya, p2), [c1, c2], roster),
    "Withdraw Priya Nair's conflict with 9882K? Panel 2 stays off them for another conflict.",
  );
  const old = byPanel("c3", "p2", titans);
  assert.match(withdrawQuestion(row(c1, titans, priya, p2), [c1, old], roster), /stays off them/);
});

test("a judge on no panel blocks nobody, so there is no promise to make; an older entry names the panel", () => {
  const c = byJudge("c1", jordan.id, breakers);
  assert.equal(withdrawQuestion(row(c, breakers, jordan, null), [c], roster), "Withdraw Jordan Kim's conflict with 1234X?");
  const old = byPanel("c2", "p4", rivets);
  assert.equal(
    withdrawQuestion(row(old, rivets, null, p4), [old], roster),
    "Withdraw the whole-panel conflict between Panel 4 and 2468E? Panel 4 will be able to judge them again.",
  );
});

test("Withdraw asks first: declining sends nothing, confirming sends once, and the confirm is the danger one", async () => {
  const shown = [];
  const sent = [];

  const yes = createConfirmer((p) => shown.push(p));
  const confirmed = withdrawAfterAsking(yes.ask, "Withdraw it?", async () => sent.push("delete"));
  assert.equal(shown.length, 1);
  assert.equal(shown[0].question, "Withdraw it?");
  assert.equal(shown[0].confirmLabel, "Withdraw");
  assert.equal(shown[0].danger, true);
  assert.deepEqual(sent, [], "nothing is sent while the question is open");
  yes.settle(true);
  assert.equal(await confirmed, true);
  assert.deepEqual(sent, ["delete"]);

  const no = createConfirmer(() => {});
  const declined = withdrawAfterAsking(no.ask, "Withdraw it?", async () => sent.push("delete again"));
  no.settle(false);
  assert.equal(await declined, false);
  assert.deepEqual(sent, ["delete"], "declining sends nothing");
});
