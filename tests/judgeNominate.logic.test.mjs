import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPending,
  isMine,
  myAwards,
  myReason,
  nominationKey,
  nominationSummary,
  pickFinished,
  sendNomination,
  withSaved,
  withoutMine,
} from "../src/components/judge/nominations";

/* What the judge console does with awards, run for real against
   src/components/judge/nominations.ts. How it is drawn is in
   judgeNominate.runtime.test.tsx. */

const me = { judge: "Sam Rivera", panelId: "p2" };
const awards = [
  { id: "excellence", label: "Excellence", short: "Exc", blurb: "…" },
  { id: "design", label: "Design", short: "Des", blurb: "…" },
  { id: "think", label: "Think", short: "Thk", blurb: "…" },
];

const row = (award, team, judge = "Sam Rivera", over = {}) => ({
  id: `${award}-${team}-${judge}`,
  award_id: award,
  team_id: team,
  panel_id: "p2",
  judge,
  reason: null,
  created_at: "2026-10-17T03:00:00Z",
  updated_at: "2026-10-17T03:00:00Z",
  ...over,
});

/* ---- whose it is ---------------------------------------------------------- */

test("a nomination is mine on the name as the roster compares it, and the panel", () => {
  assert.equal(isMine(row("design", "t1"), me), true);
  assert.equal(isMine(row("design", "t1", "Priya Nair"), me), false, "a co-judge's");
  assert.equal(isMine(row("design", "t1", "sam rivera"), me), true, "the API matches the name in any case");
  assert.equal(isMine(row("design", "t1", " Sam Rivera "), me), true, "and trimmed");
  assert.equal(isMine(row("design", "t1"), { ...me, judge: "SAM RIVERA" }), true, "whichever way the sign-in typed it");
  assert.equal(isMine(row("design", "t1", "Sam Rivers"), me), false, "a different name is a different judge");
  assert.equal(isMine(row("design", "t1", "Sam Rivera", { panel_id: "p3" }), me), false, "another panel's Sam");
  assert.equal(isMine(row("design", "t1", "Sam Rivera", { panel_id: null }), me), false, "a deleted panel's");
});

test("the pressed chips are my awards for that team, and nobody else's", () => {
  const list = [
    row("excellence", "t1"),
    row("design", "t1", "Priya Nair"),
    row("think", "t2"),
    row("excellence", "t1", "Sam Rivera", { panel_id: "p3" }),
  ];
  assert.deepEqual([...myAwards(list, "t1", me)], ["excellence"]);
  assert.deepEqual([...myAwards(list, "t2", me)], ["think"]);
  assert.deepEqual([...myAwards(list, "t9", me)], []);
});

test("the Judge Advisor's nominations are nobody's chips: not mine, not in the Done row's summary, whatever panel they carry", () => {
  // The API never sends one to a judge (it has no panel); this is what the screen does if one ever arrived, even carrying this judge's name and panel.
  const ja = row("excellence", "t1", "Sam Rivera", { role: "admin", reason: "Judge Advisor's pick" });
  const jaOther = row("design", "t1", "Alex Morgan", { role: "admin", panel_id: null });
  const list = [ja, jaOther, row("design", "t1", "Priya Nair", { role: "judge" })];
  assert.equal(isMine(ja, me), false);
  assert.deepEqual([...myAwards(list, "t1", me)], [], "no pressed chip");
  assert.equal(myReason(list, "excellence", "t1", me), "", "and no reason to show in the box");
  assert.equal(nominationSummary(list, awards, "t1", me), "Design", "only Priya's, a judge's");
  assert.equal(nominationSummary([ja, jaOther], awards, "t1", me), "", "nothing to list");
  // A tap on a chip is a new nomination of the judge's own, beside the Judge Advisor's row, which a withdrawal leaves.
  assert.equal(applyPending([ja], [{ awardId: "excellence", teamId: "t1", on: true }], me).length, 2);
  assert.deepEqual(withoutMine([ja], "excellence", "t1", me), [ja]);
});

test("my reason is the one on my own row, and empty when there is none", () => {
  const list = [row("design", "t1", "Sam Rivera", { reason: "Tidy notebook" }), row("design", "t1", "Priya Nair", { reason: "Hers" })];
  assert.equal(myReason(list, "design", "t1", me), "Tidy notebook");
  assert.equal(myReason(list, "excellence", "t1", me), "");
  assert.equal(myReason([row("design", "t1")], "design", "t1", me), "", "a null reason reads as empty");
});

/* ---- the Done row's line -------------------------------------------------- */

test("the summary lists the panel's awards in config order, with ×2 for two judges", () => {
  const list = [
    row("design", "t1", "Priya Nair"),
    row("excellence", "t1", "Sam Rivera"),
    row("excellence", "t1", "Priya Nair"),
    row("think", "t2"),
  ];
  assert.equal(nominationSummary(list, awards, "t1", me), "Excellence ×2 · Design", "config order, not the order nominated");
  assert.equal(nominationSummary(list, awards, "t2", me), "Think");
  assert.equal(nominationSummary(list, awards, "t3", me), "", "nothing nominated");
});

test("the summary ignores other panels and awards the config no longer lists", () => {
  const list = [row("design", "t1", "Lena Ortiz", { panel_id: "p3" }), row("gone", "t1"), row("design", "t1")];
  assert.equal(nominationSummary(list, awards, "t1", me), "Design", "one judge on this panel");
  assert.equal(nominationSummary([row("gone", "t1")], awards, "t1", me), "");
});

test("a judge who nominates twice still counts once, however the name is cased or spaced", () => {
  const dup = [row("design", "t1"), row("design", "t1", "Sam Rivera", { id: "again" })];
  assert.equal(nominationSummary(dup, awards, "t1", me), "Design");
  const variants = [row("design", "t1"), row("design", "t1", "sam rivera "), row("design", "t1", " SAM RIVERA")];
  assert.equal(nominationSummary(variants, awards, "t1", me), "Design", "one judge, not ×3");
  assert.equal(nominationSummary([...variants, row("design", "t1", "Priya Nair")], awards, "t1", me), "Design ×2", "×2 only for two different judges");
});

test("my chip, reason and withdrawal follow the name across case, for a row made under another spelling", () => {
  const theirs = [row("design", "t1", "sam rivera", { reason: "Tidy notebook" })];
  assert.deepEqual([...myAwards(theirs, "t1", me)], ["design"], "pressed");
  assert.equal(myReason(theirs, "design", "t1", me), "Tidy notebook");
  assert.deepEqual(withoutMine(theirs, "design", "t1", me), [], "and mine to withdraw");
  assert.deepEqual(applyPending(theirs, [{ awardId: "design", teamId: "t1", on: false }], me), [], "unpressed at once");
  const saved = row("design", "t1", "Sam Rivera", { reason: "Neat" });
  assert.deepEqual(withSaved(theirs, saved), [saved], "the server's row replaces it, not joins it");
});

/* ---- a tap answers at once, and a failed one puts the chip back ----------- */

test("a tap in the air is laid over the server's list, and gone once it is not in the air", () => {
  const server = [row("design", "t1")];
  const on = applyPending(server, [{ awardId: "excellence", teamId: "t1", on: true }], me);
  assert.deepEqual([...myAwards(on, "t1", me)].sort(), ["design", "excellence"], "pressed before the server answers");
  assert.equal(on.find((n) => n.award_id === "excellence").id, `pending:${nominationKey("excellence", "t1")}`);

  const off = applyPending(server, [{ awardId: "design", teamId: "t1", on: false }], me);
  assert.deepEqual([...myAwards(off, "t1", me)], [], "unpressed before the server answers");

  // A failed write is simply no longer pending: the chip is as the server has it.
  assert.deepEqual(applyPending(server, [], me), server);
  assert.deepEqual([...myAwards(applyPending(server, [], me), "t1", me)], ["design"]);
});

test("a tap that changes nothing adds nothing, and never touches a co-judge's row", () => {
  const server = [row("design", "t1"), row("think", "t1", "Priya Nair")];
  assert.equal(applyPending(server, [{ awardId: "design", teamId: "t1", on: true }], me), server, "already pressed");
  assert.equal(applyPending(server, [{ awardId: "think", teamId: "t1", on: false }], me), server, "not mine to remove");
  // Pressed beside a co-judge's: two judges, one of them mine and pending.
  const both = applyPending(server, [{ awardId: "think", teamId: "t1", on: true }], me);
  assert.equal(nominationSummary(both, awards, "t1", me), "Design · Think ×2");
});

test("the server's reply replaces my row, and a withdrawal removes only mine", () => {
  const server = [row("design", "t1"), row("design", "t1", "Priya Nair")];
  const saved = row("design", "t1", "Sam Rivera", { id: "server-id", reason: "Tidy" });
  const next = withSaved(server, saved);
  assert.equal(next.length, 2, "replaced, not appended");
  assert.equal(myReason(next, "design", "t1", me), "Tidy");
  assert.equal(withSaved(server, row("think", "t1")).length, 3, "a new nomination is added");

  const gone = withoutMine(server, "design", "t1", me);
  assert.deepEqual(gone.map((n) => n.judge), ["Priya Nair"]);
});

/* ---- the writes ----------------------------------------------------------- */

function recorder(reply = {}) {
  const sent = [];
  const send = async (url, options = {}) => {
    sent.push([url, options.method, options.body]);
    return reply;
  };
  return { sent, send };
}

test("a chip tap on POSTs the nomination and withdrawing DELETEs it, with no reason unless one is given", async () => {
  const saved = row("design", "t1");
  const { sent, send } = recorder({ nomination: saved });
  assert.equal(await sendNomination(send, { teamId: "t1", awardId: "design", on: true }), saved);
  assert.deepEqual(sent[0], ["/api/awards", "POST", { awardId: "design", teamId: "t1" }], "no reason key: the stored reason stays");

  assert.equal(await sendNomination(send, { teamId: "t1", awardId: "design", on: false }), null);
  assert.deepEqual(sent[1], ["/api/awards", "DELETE", { awardId: "design", teamId: "t1" }]);
});

test("a reason rides on the POST, and an empty one is sent so it clears the stored one", async () => {
  const { sent, send } = recorder({ nomination: row("design", "t1") });
  await sendNomination(send, { teamId: "t1", awardId: "design", on: true, reason: "Tidy notebook" });
  await sendNomination(send, { teamId: "t1", awardId: "design", on: true, reason: "" });
  assert.deepEqual(sent[0][2], { awardId: "design", teamId: "t1", reason: "Tidy notebook" });
  assert.deepEqual(sent[1][2], { awardId: "design", teamId: "t1", reason: "" });
});

test("the API's refusal comes back as the error, for the banner", async () => {
  const send = async () => {
    throw new Error("Team 7700B has not finished an interview yet. Nominate it once you have met it.");
  };
  await assert.rejects(sendNomination(send, { teamId: "t1", awardId: "design", on: true }), /has not finished an interview/);
});

/* ---- which team the hero slot shows ---------------------------------------- */

const team = (n) => ({ id: `t-${n}`, number: n, name: n, panel_id: "p2", division: "Middle School", category: "developing", pit: null, created_at: "" });
const at = (iso) => `2026-10-17T${iso}:00Z`;
const req = (t, status, over = {}) => ({
  id: `r-${t.number}-${status}`,
  team_id: t.id,
  panel_id: "p2",
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
  requested_at: at("03:40"),
  acknowledged_at: null,
  started_at: null,
  finished_at: null,
  cancelled_at: null,
  updated_at: at("03:40"),
  ...over,
});
const card = (t, request = null) => ({ team: t, request, score: { total: 0, max: 76, scored: false } });

const byteMe = team("7700B");
const pixel = team("3456P");
const titans = team("9882K");
const finishedReq = req(byteMe, "completed", { started_at: at("03:45"), finished_at: at("03:58") });
const none = new Set();

test("right after Finish, the finished team has the hero slot, with the time it finished", () => {
  const cards = [card(byteMe), card(pixel, req(pixel, "requested", { requested_at: at("03:55") }))];
  const got = pickFinished(cards, [finishedReq], byteMe.id, none);
  assert.equal(got.card.team.id, byteMe.id);
  assert.equal(got.at, at("03:58"));
});

test("a team already waiting when the interview finished stays below the card", () => {
  const cards = [
    card(byteMe),
    card(pixel, req(pixel, "requested", { requested_at: at("03:55") })),
    card(titans, req(titans, "acknowledged", { requested_at: at("03:30"), acknowledged_at: at("03:50") })),
  ];
  assert.ok(pickFinished(cards, [finishedReq], byteMe.id, none), "waiting and on-the-way teams from before do not take the slot");
  // A booking is not asking for a judge either.
  const booked = [card(byteMe), card(pixel, req(pixel, "scheduled", { kind: "slot", requested_at: at("04:10") }))];
  assert.ok(pickFinished(booked, [finishedReq], byteMe.id, none));
});

test("another team requesting a judge after the finish takes the hero slot back", () => {
  const cards = [card(byteMe), card(pixel, req(pixel, "requested", { requested_at: at("04:01") }))];
  assert.equal(pickFinished(cards, [finishedReq], byteMe.id, none), null);
});

test("answering or starting the next team takes the slot back, even one that was waiting before", () => {
  const onTheWay = [card(byteMe), card(pixel, req(pixel, "acknowledged", { requested_at: at("03:55"), acknowledged_at: at("04:00") }))];
  assert.equal(pickFinished(onTheWay, [finishedReq], byteMe.id, none), null);
  const started = [card(byteMe), card(pixel, req(pixel, "interviewing", { requested_at: at("03:55"), acknowledged_at: at("03:59"), started_at: at("04:05") }))];
  assert.equal(pickFinished(started, [finishedReq], byteMe.id, none), null);
});

test("Done collapses it for that team only, and the team being live again ends it", () => {
  const cards = [card(byteMe)];
  assert.equal(pickFinished(cards, [finishedReq], byteMe.id, new Set([byteMe.id])), null, "Done tapped");
  assert.ok(pickFinished(cards, [finishedReq], byteMe.id, new Set([titans.id])), "another team's Done is not this one's");
  const again = [card(byteMe, req(byteMe, "requested", { requested_at: at("04:20") }))];
  assert.equal(pickFinished(again, [finishedReq], byteMe.id, none), null, "queueing again");
});

test("with nothing finished, nothing completed, or the team off the panel there is no card", () => {
  const cards = [card(byteMe)];
  assert.equal(pickFinished(cards, [finishedReq], null, none), null, "no Finish tapped in this session");
  assert.equal(pickFinished(cards, [], byteMe.id, none), null, "no completed interview: the API would refuse the nomination");
  assert.equal(pickFinished([card(pixel)], [finishedReq], byteMe.id, none), null, "no longer on the panel (a conflict was declared)");
});

test("the newest completed interview sets the time and the line a request has to cross", () => {
  const first = req(byteMe, "completed", { id: "r-first", finished_at: at("02:00") });
  const cards = [card(byteMe), card(pixel, req(pixel, "requested", { requested_at: at("03:55") }))];
  assert.equal(pickFinished(cards, [first, finishedReq], byteMe.id, none).at, at("03:58"));
  // Against the old finish, a request from 03:55 would count as new and take the slot.
  assert.equal(pickFinished(cards, [first], byteMe.id, none), null);
});
