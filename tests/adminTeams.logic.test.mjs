import assert from "node:assert/strict";
import test from "node:test";

import {
  activeFilters,
  bookSlot,
  cancelBookingNow,
  discardQuestion,
  filterTeams,
  flagPills,
  interviewOf,
  isDirty,
  leaveAfterAsking,
  moveBooking,
  moveQuestion,
  notebookCounts,
  openInRefereeAfterAsking,
  panelCell,
  panelLeft,
  panelLoad,
  panelOptions,
  removeQuestion,
  removeTeamAfterAsking,
  requestBlocker,
  requestNow,
  RESETS,
  resetAfterAsking,
  resetQuestion,
  resetStatusAfterAsking,
  saveTeamAfterAsking,
  saveTimes,
  startDraft,
  strandedIds,
  teamPatch,
  timesRequestOf,
} from "../src/components/admin/teamsLogic";
import { formTimes, reachedSteps, readTimes, startTimes, timesLogLine } from "../src/lib/stepTimes";

/* The Judge Advisor Teams tab's decisions, run for real against
   src/components/admin/teamsLogic.ts. How they are drawn is in
   adminTeams.runtime.test.tsx. */

const team = (number, name, over = {}) => ({
  id: `t-${number}`, number, name, panel_id: null, division: "Middle School", category: "developing", pit: null, created_at: "2026-10-20T08:00:00Z", ...over,
});
const panel = (n, division) => ({ id: `p${n}`, name: `Panel ${n}`, division, judges: [], languages: ["en"], sort_order: n, slot_start_at: null, slot_minutes: 20, slot_count: 0 });
const panels = [panel(1, "High School"), panel(2, "Middle School"), panel(3, "Middle School"), panel(4, "Elementary School")];
const judge = (id, panel_id) => ({ id, name: id, note: null, panel_id, created_at: "2026-10-20T08:00:00Z" });
const conflict = (id, judge_id, t) => ({ id, panel_id: null, judge_id, team_id: t.id, judge_name: null, note: null, declared_by: "admin:Alex", created_at: "2026-10-20T09:00:00Z" });

const titans = team("9882K", "Torque Titans", { panel_id: "p2", pit: "B4" });

/** A fake in-page confirm that answers `answer` and remembers what it was asked. */
function asker(answer) {
  const asked = [];
  return { asked, ask: async (question, options) => (asked.push({ question, options }), answer) };
}
/** A fake `call` that remembers every request, and can be told to refuse. */
function caller(refusal) {
  const calls = [];
  return {
    calls,
    call: async (url, options) => {
      calls.push({ url, ...options });
      if (refusal) throw new Error(refusal);
      return {};
    },
  };
}

/* ---- Save changes: one PATCH ---------------------------------------------------------- */

test("nothing changed means no patch, and the editor is not dirty (Save stays disabled)", () => {
  const draft = startDraft(titans);
  assert.equal(teamPatch(titans, draft), null);
  assert.equal(isDirty(titans, draft), false);
  // Tidying that the server does anyway is not a change: 9882k is 9882K, "b 4" is B4, spaces in a name are not a rename.
  assert.equal(isDirty(titans, { ...draft, number: " 9882k ", pit: "b 4", name: " Torque Titans " }), false);
  // A team with no pit and no panel starts clean too.
  const bare = team("7700B", "Byte Me");
  assert.equal(isDirty(bare, startDraft(bare)), false);
  // A pit stored in the older free-text style is not dirty just for being shown as it is.
  const legacy = team("1101R", "Rookies", { pit: "Pit 12" });
  assert.equal(isDirty(legacy, startDraft(legacy)), false);
});

test("Save sends number, name, pit, division, notebook and panel together in ONE PATCH", async () => {
  const { calls, call } = caller();
  const draft = { number: "9882l", name: "Torque Titans II", pit: "c 7", division: "High School", category: "fully-developed", panelId: "p1" };
  const { ask, asked } = asker(true);
  assert.equal(await saveTeamAfterAsking(ask, call, titans, draft, panels), true);

  assert.equal(asked.length, 0, "the panel was picked in the same edit, so there is nothing to ask");
  assert.equal(calls.length, 1, "six fields, one request");
  assert.equal(calls[0].url, "/api/admin/teams");
  assert.equal(calls[0].method, "PATCH");
  // Tidied the way the server tidies, so what is sent is what will be stored.
  assert.deepEqual(calls[0].body, {
    teamId: titans.id, number: "9882L", name: "Torque Titans II", pit: "C7", division: "High School", category: "fully-developed", panelId: "p1",
  });
});

test("only what changed is sent, so a pit can be saved while the panel it sits on is conflicted", async () => {
  const { calls, call } = caller();
  assert.equal(await saveTeamAfterAsking(asker(true).ask, call, titans, { ...startDraft(titans), pit: "D1" }, panels), true);
  assert.deepEqual(calls[0].body, { teamId: titans.id, pit: "D1" });
  assert.ok(!("panelId" in calls[0].body), "an untouched panel is not re-checked by the server");
});

test("no panel is sent as null, and a cleared pit as null", async () => {
  const { calls, call } = caller();
  await saveTeamAfterAsking(asker(true).ask, call, titans, { ...startDraft(titans), panelId: "", pit: "" }, panels);
  assert.deepEqual(calls[0].body, { teamId: titans.id, pit: null, panelId: null });
});

test("Save with nothing changed sends nothing", async () => {
  const { calls, call } = caller();
  assert.equal(await saveTeamAfterAsking(asker(true).ask, call, titans, startDraft(titans), panels), false);
  assert.equal(calls.length, 0);
});

test("the server's refusal is thrown, for the editor to show", async () => {
  const { call } = caller("Team 7700B already exists.");
  await assert.rejects(saveTeamAfterAsking(asker(true).ask, call, titans, { ...startDraft(titans), number: "7700B" }, panels), /Team 7700B already exists\./);
});

/* ---- Division: editable, and asks before it takes a team off its panel ---------------------- */

// Titans (Middle School, on Panel 2) moved to High School: Panel 2 cannot judge High School.
const toHigh = { ...startDraft(titans), division: "High School" };

test("a division move that takes the team off its panel asks first, in real names, and a no sends nothing", async () => {
  const no = asker(false);
  const { calls, call } = caller();
  assert.equal(await saveTeamAfterAsking(no.ask, call, titans, toHigh, panels), false);
  assert.deepEqual(no.asked, [{
    question: "Move 9882K to High School? It comes off Panel 2 (Middle School) and will need a panel.",
    options: { confirmLabel: "Move team" },
  }]);
  assert.equal(moveQuestion(titans, "High School", panels[1]), no.asked[0].question);
  assert.equal(calls.length, 0, "declined: nothing is sent");
});

test("a yes sends division in the one PATCH, and no panelId: the server's rule clears the panel", async () => {
  const yes = asker(true);
  const { calls, call } = caller();
  assert.equal(await saveTeamAfterAsking(yes.ask, call, titans, { ...toHigh, pit: "D1" }, panels), true);
  assert.equal(yes.asked.length, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { teamId: titans.id, division: "High School", pit: "D1" });
  assert.ok(!("panelId" in calls[0].body), "the client asks and sends; the server decides what comes off");
});

test("a compatible move saves without asking: to a blended division, or with no panel to lose", async () => {
  const blended = "Blended";
  const withBlend = [...panels, panel(5, blended)];
  const yes = asker(true);
  const { calls, call } = caller();
  // The team's Panel 2 is Middle School; a Blended team clears the wall against any panel.
  assert.equal(await saveTeamAfterAsking(yes.ask, call, titans, { ...startDraft(titans), division: blended }, withBlend), true);
  assert.equal(yes.asked.length, 0);
  assert.deepEqual(calls[0].body, { teamId: titans.id, division: blended });
  // No panel held, nothing to take off.
  const byte = team("7700B", "Byte Me");
  assert.equal(await saveTeamAfterAsking(yes.ask, call, byte, { ...startDraft(byte), division: "High School" }, panels), true);
  assert.equal(yes.asked.length, 0);
  assert.deepEqual(calls[1].body, { teamId: byte.id, division: "High School" });
});

test("changing division AND the panel in the same edit does not ask; the new panel goes with it", async () => {
  const yes = asker(true);
  const { calls, call } = caller();
  assert.equal(await saveTeamAfterAsking(yes.ask, call, titans, { ...toHigh, panelId: "p1" }, panels), true);
  assert.equal(yes.asked.length, 0);
  assert.deepEqual(calls[0].body, { teamId: titans.id, division: "High School", panelId: "p1" });
  // Choosing "— none —" in the same edit is a choice too.
  await saveTeamAfterAsking(yes.ask, call, titans, { ...toHigh, panelId: "" }, panels);
  assert.equal(yes.asked.length, 0);
  assert.deepEqual(calls[1].body, { teamId: titans.id, division: "High School", panelId: null });
});

test("a panel picked for the old division, then a division it can't judge: counts as not picked, asks about the held panel, sends division only", async () => {
  // Titans (MS, Panel 2): pick Panel 4 (Elementary), then move to High School. Panel 4 can't judge High School and drops from the select.
  const yes = asker(true);
  const { calls, call } = caller();
  assert.equal(await saveTeamAfterAsking(yes.ask, call, titans, { ...toHigh, panelId: "p4" }, panels), true);
  assert.deepEqual(yes.asked.map((a) => a.question), ["Move 9882K to High School? It comes off Panel 2 (Middle School) and will need a panel."]);
  assert.deepEqual(calls[0].body, { teamId: titans.id, division: "High School" });
  // Declining still sends nothing.
  const no = asker(false);
  assert.equal(await saveTeamAfterAsking(no.ask, call, titans, { ...toHigh, panelId: "p4" }, panels), false);
  assert.equal(calls.length, 1);
});

test("a panel picked that suits the new division is still sent, with no ask", async () => {
  const yes = asker(true);
  const { calls, call } = caller();
  assert.equal(await saveTeamAfterAsking(yes.ask, call, titans, { ...toHigh, panelId: "p1" }, panels), true);
  assert.equal(yes.asked.length, 0);
  assert.deepEqual(calls[0].body, { teamId: titans.id, division: "High School", panelId: "p1" });
});

test("an incompatible panel picked while the held panel suits the new division: no ask, division only", async () => {
  const withBlend = [...panels, panel(5, "Blended")];
  const onBlend = team("1101", "Blend Team", { panel_id: "p5" });
  const yes = asker(true);
  const { calls, call } = caller();
  // The held Blended panel judges anyone, so nothing comes off; Panel 4 (Elementary) can't judge High School, so it is dropped.
  assert.equal(await saveTeamAfterAsking(yes.ask, call, onBlend, { ...startDraft(onBlend), division: "High School", panelId: "p4" }, withBlend), true);
  assert.equal(yes.asked.length, 0);
  assert.deepEqual(calls[0].body, { teamId: onBlend.id, division: "High School" });
});

test("panelLeft names the held panel only when the division changes to one it cannot judge", () => {
  assert.equal(panelLeft(titans, "High School", panels)?.id, "p2");
  assert.equal(panelLeft(titans, "Middle School", panels), null, "same division");
  assert.equal(panelLeft(team("7700B", "Byte Me"), "High School", panels), null, "no panel held");
  assert.equal(panelLeft(titans, "Blended", panels), null, "a blended division is compatible with any panel");
});

test("changing division re-filters the panel select to the new division, and the held panel drops out when it no longer fits", () => {
  const ids = (division) => panelOptions(titans, panels, [], [], division).map((o) => o.id);
  assert.deepEqual(ids(undefined), ["p2", "p3"], "as the team is");
  assert.deepEqual(ids("High School"), ["p1"], "Panel 2 is Middle School: gone");
  assert.deepEqual(ids("Elementary School"), ["p4"]);
  assert.deepEqual(ids("Middle School"), ["p2", "p3"], "back where it was");
  // Conflicts still apply to the new division's panels.
  const t = team("2011A", "Gear Gremlins", { panel_id: "p1", division: "High School" });
  assert.deepEqual(panelOptions(t, panels, [conflict("c1", "j-p2", t)], [judge("j-p2", "p2")], "Middle School").map((o) => o.id), ["p3"]);
});

/* ---- closing with unsaved changes ------------------------------------------------------ */

test("closing a clean editor does not ask", async () => {
  const { ask, asked } = asker(false);
  assert.equal(await leaveAfterAsking(ask, titans, startDraft(titans)), true);
  assert.equal(asked.length, 0);
});

test("closing with unsaved changes asks first, and stays when the answer is no", async () => {
  const dirty = { ...startDraft(titans), name: "Torque Titans II" };
  const no = asker(false);
  assert.equal(await leaveAfterAsking(no.ask, titans, dirty), false);
  assert.deepEqual(no.asked, [{ question: "Discard your changes to team 9882K?", options: { confirmLabel: "Discard changes", danger: true } }]);
  assert.equal(discardQuestion(titans), "Discard your changes to team 9882K?");

  assert.equal(await leaveAfterAsking(asker(true).ask, titans, dirty), true);
});

test("Open in Referee hands over the team to focus -- after asking, if there is anything to lose", async () => {
  const opened = [];
  const open = (id) => opened.push(id);

  assert.equal(await openInRefereeAfterAsking(asker(false).ask, titans, startDraft(titans), open), true);
  assert.deepEqual(opened, [titans.id], "the Referee tab is told which team to select");

  const dirty = { ...startDraft(titans), pit: "D1" };
  assert.equal(await openInRefereeAfterAsking(asker(false).ask, titans, dirty, open), false);
  assert.deepEqual(opened, [titans.id], "declined: nowhere to go");
  assert.equal(await openInRefereeAfterAsking(asker(true).ask, titans, dirty, open), true);
  assert.deepEqual(opened, [titans.id, titans.id]);
});

/* ---- the status override --------------------------------------------------------------- */

const live = { id: "r1", status: "interviewing" };
const finished = { id: "r2", status: "completed" };

test("the status override asks first and sends nothing when declined", async () => {
  const { ask, asked } = asker(false);
  const { calls, call } = caller();
  assert.equal(await resetStatusAfterAsking(ask, call, titans, live, "requested"), false);
  assert.equal(calls.length, 0);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].question, resetQuestion(titans, "requested"));
  assert.match(asked[0].question, /9882K/);
  assert.match(asked[0].question, /overrides what the judges set/i);
});

test("the override uses reopen, cancel or set-status exactly as the old control did, with `from`", async () => {
  const send = async (request, status) => {
    const { calls, call } = caller();
    assert.equal(await resetStatusAfterAsking(asker(true).ask, call, titans, request, status), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `/api/requests/${request.id}`);
    assert.equal(calls[0].method, "PATCH");
    return calls[0].body;
  };
  // A finished request set back to requested is reopened (clears the stale timestamps).
  assert.deepEqual(await send(finished, "requested"), { action: "reopen", from: "completed" });
  // A live one cannot be reopened: set-status, with the status.
  assert.deepEqual(await send(live, "requested"), { action: "set-status", from: "interviewing", status: "requested" });
  // An open one set to cancelled is cancelled (stamps cancelled_at); a finished one is set.
  assert.deepEqual(await send(live, "cancelled"), { action: "cancel", from: "interviewing" });
  assert.deepEqual(await send(finished, "cancelled"), { action: "set-status", from: "completed", status: "cancelled" });
  assert.deepEqual(await send(live, "completed"), { action: "set-status", from: "interviewing", status: "completed" });
});

/* ---- Remove team ------------------------------------------------------------------------ */

test("Remove team asks first, with the same words, and sends nothing when declined", async () => {
  const no = asker(false);
  const { calls, call } = caller();
  assert.equal(await removeTeamAfterAsking(no.ask, call, titans), false);
  assert.equal(calls.length, 0, "declined: nothing is removed");
  assert.deepEqual(no.asked, [{ question: "Remove team 9882K and all its requests?", options: { confirmLabel: "Remove team", danger: true } }]);
  assert.equal(removeQuestion(titans), "Remove team 9882K and all its requests?");

  assert.equal(await removeTeamAfterAsking(asker(true).ask, call, titans), true);
  assert.deepEqual(calls, [{ url: `/api/admin/teams?teamId=${titans.id}`, method: "DELETE" }]);
});

/* ---- the two resets --------------------------------------------------------------------- */

test("Reset the day and Wipe everything still ask first, in the words they always used", async () => {
  assert.equal(RESETS.resetDay.question, "Clear today's requests, notes, scores and activity?\n\nTeams, panels and event-wide referee history are kept.");
  assert.equal(RESETS.resetDay.confirmLabel, "Clear today");
  assert.equal(
    RESETS.resetAll.question,
    "Delete the ENTIRE EVENT — teams, panels, requests, notes, scores and referee history?\n\nUse this before importing a new event. This cannot be undone.",
  );
  assert.equal(RESETS.resetAll.confirmLabel, "Wipe everything");

  for (const action of ["resetDay", "resetAll"]) {
    const no = asker(false);
    const declined = caller();
    assert.equal(await resetAfterAsking(no.ask, declined.call, action), false);
    assert.equal(declined.calls.length, 0, `${action} declined: nothing sent`);
    assert.deepEqual(no.asked, [{ question: RESETS[action].question, options: { confirmLabel: RESETS[action].confirmLabel, danger: true } }]);

    const yes = caller();
    assert.equal(await resetAfterAsking(asker(true).ask, yes.call, action), true);
    assert.deepEqual(yes.calls, [{ url: "/api/admin/teams", method: "PATCH", body: { action } }]);
  }
});

/* ---- the panel select ------------------------------------------------------------------- */

test("the panel select offers only panels that may judge the team: its division, and no conflict", () => {
  const byte = team("7700B", "Byte Me");
  const roster = [judge("j-p3", "p3")];
  const conflicts = [conflict("c1", "j-p3", byte)];

  // Panel 1 (High School) and Panel 4 (Elementary) are the wrong side of the wall; Panel 3 has a conflicted judge.
  assert.deepEqual(panelOptions(byte, panels, conflicts, roster).map((o) => o.id), ["p2"]);
  // No conflict, still only the two Middle School panels.
  assert.deepEqual(panelOptions(byte, panels, [], []).map((o) => o.id), ["p2", "p3"]);
  // The judge moves and the block follows.
  assert.deepEqual(panelOptions(byte, panels, conflicts, [judge("j-p3", "p2")]).map((o) => o.id), ["p3"]);
});

test("the panel the team already holds stays in its own select, marked when it is now blocked", () => {
  const held = team("2011A", "Gear Gremlins", { panel_id: "p3" });
  const options = panelOptions(held, panels, [conflict("c1", "j-p3", held)], [judge("j-p3", "p3")]);
  assert.deepEqual(options, [
    { id: "p2", name: "Panel 2", blocked: false },
    { id: "p3", name: "Panel 3", blocked: true },
  ]);
});

/* ---- the Panel column ------------------------------------------------------------------- */

test("a panel, 'Unassigned', or 'no panel left' when every panel that may judge the team is blocked", () => {
  const sparky = team("5150Z", "Sparky");
  const byte = team("7700B", "Byte Me");
  const roster = [judge("j2", "p2"), judge("j3", "p3")];
  const conflicts = [conflict("c1", "j2", sparky), conflict("c2", "j3", sparky), conflict("c3", "j3", byte)];
  const stranded = strandedIds([titans, sparky, byte], panels, conflicts, roster);

  assert.deepEqual([...stranded], [sparky.id], "blocked from both Middle School panels");
  assert.deepEqual(panelCell(sparky, panels, stranded), { kind: "none-left" });
  assert.deepEqual(panelCell(byte, panels, stranded), { kind: "unassigned" }, "Panel 2 is still open to it");
  assert.deepEqual(panelCell(titans, panels, stranded), { kind: "panel", name: "Panel 2" });
  // A team that holds a panel is never 'no panel left', and a division with no panels is just unassigned.
  const only = team("1108", "Circuit Breakers", { division: "Elementary School" });
  assert.deepEqual(panelCell(only, [], strandedIds([only], [], [], [])), { kind: "unassigned" });
});

/* ---- the toolbar ------------------------------------------------------------------------ */

test("the filter matches a number or a name, within the division and the notebook type", () => {
  const all = [titans, team("7700B", "Byte Me"), team("1108", "Circuit Breakers", { division: "Elementary School", category: "fully-developed" })];
  const f = (over) => filterTeams(all, { q: "", division: "", category: "", ...over }).map((t) => t.number);
  assert.deepEqual(f({}), ["9882K", "7700B", "1108"]);
  assert.deepEqual(f({ q: " byte" }), ["7700B"]);
  assert.deepEqual(f({ q: "98" }), ["9882K"]);
  assert.deepEqual(f({ division: "Elementary School" }), ["1108"]);
  assert.deepEqual(f({ category: "developing" }), ["9882K", "7700B"]);
  assert.deepEqual(f({ q: "r", division: "Middle School" }), ["9882K"]);
  assert.equal(activeFilters({ q: "x", division: "", category: "" }), 0, "the search box is not a filter");
  assert.equal(activeFilters({ q: "", division: "Middle School", category: "developing" }), 2);
});

test("the chips count notebook types over the filtered teams and panel load over all of them", () => {
  const t = [titans, team("7700B", "Byte Me", { panel_id: "p2" }), team("1108", "Circuit Breakers", { division: "Elementary School", panel_id: "p4", category: "ungraded" })];
  const categories = [{ id: "developing" }, { id: "ungraded" }];
  assert.deepEqual(notebookCounts(t, categories).map((c) => c.count), [2, 1]);
  assert.deepEqual(panelLoad(t, panels, "").map((l) => [l.panel.id, l.count]), [["p1", 0], ["p2", 2], ["p3", 0], ["p4", 1]]);
  assert.deepEqual(panelLoad(t, panels, "Middle School").map((l) => l.panel.id), ["p2", "p3"], "a division narrows the panels");
});

/* ---- the row ---------------------------------------------------------------------------- */

const request = (t, status, over = {}) => ({
  id: `r-${t.number}-${status}`, team_id: t.id, panel_id: t.panel_id, status, kind: "queue", slot_start: null, ...over,
});

test("a team's interview is its live request, else a finished one; the booked time is a slot's", () => {
  assert.deepEqual(interviewOf(titans.id, []), { request: null, bookedAt: null });
  const done = request(titans, "completed");
  const booked = request(titans, "scheduled", { kind: "slot", slot_start: "2026-10-20T11:00:00.000Z" });
  assert.equal(interviewOf(titans.id, [done]).request, done);
  assert.deepEqual(interviewOf(titans.id, [done, booked]), { request: booked, bookedAt: "2026-10-20T11:00:00.000Z" });
  assert.equal(interviewOf(titans.id, [request(titans, "cancelled")]).request, null, "a cancelled request is nothing to show");
  assert.equal(interviewOf(titans.id, [request(titans, "requested")]).bookedAt, null, "a walk-up has no booked time");
});

test("flag pills count a team's flags by severity, worst first, from the Referee tab's own helper", () => {
  const kinds = [
    { id: "good", label: "Good conduct", short: "Good", color: "emerald", severity: 0, requiresRule: false },
    { id: "warning", label: "Warning", short: "Warning", color: "amber", severity: 1, requiresRule: false },
    { id: "minor", label: "Minor violation", short: "Minor", color: "orange", severity: 2, requiresRule: true },
  ];
  const flag = (t, kind) => ({ id: `f-${t.id}-${kind}-${Math.random()}`, team_id: t.id, kind });
  const flags = [flag(titans, "warning"), flag(titans, "minor"), flag(titans, "warning"), flag(team("7700B", "Byte Me"), "good")];
  assert.deepEqual(flagPills(titans.id, flags, kinds).map(({ kind, count }) => [kind.short, count]), [["Minor", 1], ["Warning", 2]]);
  assert.deepEqual(flagPills("nobody", flags, kinds), []);
});

/* ---- asking for an interview, booking a time, moving or cancelling a booking ------------- */

test("Request now is the desk's walk-up request: one POST by team number, in the language chosen", async () => {
  const { calls, call } = caller();
  await requestNow(call, titans, "th");
  assert.deepEqual(calls, [{ url: "/api/requests", method: "POST", body: { teamNumber: "9882K", kind: "queue", language: "th" } }]);
});

test("Book a time is the desk's booking: the slot's own start and end, the team and the language", async () => {
  const { calls, call } = caller();
  await bookSlot(call, titans, { start: "2026-10-20T04:00:00.000Z", end: "2026-10-20T04:20:00.000Z" }, "en");
  assert.deepEqual(calls, [
    { url: "/api/requests", method: "POST", body: { teamNumber: "9882K", kind: "slot", language: "en", slotStart: "2026-10-20T04:00:00.000Z", slotEnd: "2026-10-20T04:20:00.000Z" } },
  ]);
});

test("Change time is the existing reschedule, saying which status the drawer was showing", async () => {
  const { calls, call } = caller();
  await moveBooking(call, { id: "r1", status: "scheduled" }, { start: "2026-10-20T04:20:00.000Z", end: "2026-10-20T04:40:00.000Z" });
  assert.deepEqual(calls, [
    { url: "/api/requests/r1", method: "PATCH", body: { action: "reschedule", from: "scheduled", slotStart: "2026-10-20T04:20:00.000Z", slotEnd: "2026-10-20T04:40:00.000Z" } },
  ]);
});

test("Cancel booking asks first with the desk's words, and a no sends nothing", async () => {
  const booking = { id: "r1", status: "scheduled", slot_start: "2026-10-20T04:00:00.000Z" };
  const no = asker(false);
  const idle = caller();
  assert.equal(await cancelBookingNow(no.ask, idle.call, titans, booking), false);
  assert.equal(idle.calls.length, 0);
  assert.match(no.asked[0].question, /^Cancel 9882K's .+ booking\?$/);
  assert.deepEqual(no.asked[0].options, { confirmLabel: "Cancel booking", cancelLabel: "Keep it", danger: true });

  const yes = asker(true);
  const sent = caller();
  assert.equal(await cancelBookingNow(yes.ask, sent.call, titans, booking), true);
  assert.deepEqual(sent.calls, [{ url: "/api/requests/r1", method: "PATCH", body: { action: "cancel", from: "scheduled" } }]);
  // The server's refusal is thrown, for the drawer to show above Save changes.
  await assert.rejects(cancelBookingNow(yes.ask, caller("That request is gone.").call, titans, booking), /That request is gone\./);
});

test("Request and Book are off without a panel the team holds, or while a panel change is unsaved, and say why", () => {
  const bare = team("7700B", "Byte Me");
  assert.match(requestBlocker(bare, startDraft(bare), null), /No judge panel yet/);
  assert.equal(requestBlocker(titans, startDraft(titans), panels[1]), null);
  assert.match(requestBlocker(titans, { ...startDraft(titans), panelId: "p3" }, panels[1]), /Save the panel change first/);
  assert.match(requestBlocker(bare, { ...startDraft(bare), panelId: "p2" }, null), /Save the panel change first/);
  // A panel the team holds that has since been deleted is no panel.
  assert.match(requestBlocker(titans, startDraft(titans), null), /No judge panel yet/);
});

/* ---- Times: step times of the team's current request -------------------------------------- */

// 2026-10-20 in Bangkok (UTC+7): asked 10:00, on the way 10:05, started 10:10, finished 10:40.
const DAY = { requested_at: "2026-10-20T03:00:00.000Z", acknowledged_at: "2026-10-20T03:05:00.000Z", started_at: "2026-10-20T03:10:00.000Z", finished_at: "2026-10-20T03:40:00.000Z" };
const timed = (status, over = {}) => ({
  ...request(titans, status), requested_at: DAY.requested_at, acknowledged_at: null, started_at: null, finished_at: null, cancelled_at: null, slot_end: null, ...over,
});
const NOON = new Date("2026-10-20T05:00:00.000Z").getTime();

test("Times shows a box for each step the request has reached, and reads them in Bangkok time", () => {
  assert.deepEqual(reachedSteps(timed("requested")), ["requested_at"]);
  assert.deepEqual(reachedSteps(timed("acknowledged", { acknowledged_at: DAY.acknowledged_at })), ["requested_at", "acknowledged_at"]);
  assert.deepEqual(reachedSteps(timed("completed", DAY)), ["requested_at", "acknowledged_at", "started_at", "finished_at"]);
  assert.deepEqual(startTimes(timed("completed", DAY)), { requested_at: "10:00", acknowledged_at: "10:05", started_at: "10:10", finished_at: "10:40" });
  // Cancelled after being acknowledged: the steps it reached, then when it was cancelled.
  assert.deepEqual(reachedSteps(timed("cancelled", { acknowledged_at: DAY.acknowledged_at, cancelled_at: "2026-10-20T03:20:00.000Z" })), ["requested_at", "acknowledged_at", "cancelled_at"]);
  // A booking has reached none: its requested_at is when it was booked, which is no step.
  const booked = timed("scheduled", { kind: "slot", slot_start: "2026-10-20T07:00:00.000Z" });
  assert.deepEqual(reachedSteps(booked), []);
  assert.deepEqual(reachedSteps({ ...booked, status: "acknowledged", acknowledged_at: DAY.acknowledged_at }), ["acknowledged_at"], "taken on early: still no Requested");
});

test("the Times request is the live one, else the team's latest from today, and nothing from another day", () => {
  const done = timed("completed", { ...DAY, id: "done" });
  const later = timed("cancelled", { id: "later", requested_at: "2026-10-20T04:00:00.000Z", cancelled_at: "2026-10-20T04:10:00.000Z" });
  const yesterday = timed("completed", { id: "old", requested_at: "2026-10-19T03:00:00.000Z", finished_at: "2026-10-19T03:40:00.000Z" });
  assert.equal(timesRequestOf(titans.id, [done, later, yesterday], NOON).id, "later", "the most recent of today, cancelled or not");
  assert.equal(timesRequestOf(titans.id, [yesterday], NOON), null);
  assert.equal(timesRequestOf(titans.id, [timed("requested", { id: "live" }), done], NOON).id, "live");
  assert.equal(timesRequestOf(titans.id, [{ ...later, team_id: "other" }], NOON), null, "another team's");
  // Today is Bangkok's: 00:30 on the 21st there is still the 20th in UTC.
  const lateNight = new Date("2026-10-20T17:30:00.000Z").getTime();
  assert.equal(timesRequestOf(titans.id, [done], lateNight), null);
});

test("an edited box becomes an ISO time on the request's own Bangkok day; unedited boxes are not sent", () => {
  const r = timed("completed", DAY);
  const start = startTimes(r);
  assert.deepEqual(formTimes(r, start), {}, "nothing edited, nothing to save");
  assert.deepEqual(formTimes(r, { ...start, finished_at: "10:32" }), { finished_at: "2026-10-20T03:32:00.000Z" });
  assert.deepEqual(formTimes(r, { ...start, requested_at: "00:30" }), { requested_at: "2026-10-19T17:30:00.000Z" }, "00:30 in Bangkok is the evening before in UTC, still the request's day");
  // A cleared or half-typed box is sent as null, so the reason can be given.
  assert.deepEqual(formTimes(r, { ...start, started_at: "" }), { started_at: null });
  // A booking that was taken on belongs to its slot's day, not the day it was made.
  const booked = timed("acknowledged", { kind: "slot", slot_start: "2026-10-22T03:00:00.000Z", requested_at: "2026-10-18T03:00:00.000Z", acknowledged_at: "2026-10-22T03:01:00.000Z" });
  assert.deepEqual(formTimes(booked, { acknowledged_at: "10:02" }), { acknowledged_at: "2026-10-22T03:02:00.000Z" });
});

test("what Save times would send is checked by the server's own rule, with a reason in words", () => {
  const r = timed("completed", DAY);
  const start = startTimes(r);
  const read = (over) => readTimes(r, formTimes(r, { ...start, ...over }));
  assert.deepEqual(read({ finished_at: "10:32" }), { times: { finished_at: "2026-10-20T03:32:00.000Z" } });
  assert.equal(read({ finished_at: "10:10" }).times?.finished_at, "2026-10-20T03:10:00.000Z", "equal to Started is in order");
  assert.equal(read({ finished_at: "10:05" }).error, "Finished (10:05) can't be before Started (10:10).");
  assert.equal(read({ requested_at: "10:07" }).error, "On the way (10:05) can't be before Requested (10:07).");
  assert.equal(read({ started_at: "" }).error, "Enter a time for Started.");
  assert.equal(readTimes(r, {}).error, "Change at least one time.");
  assert.match(readTimes(timed("requested"), { finished_at: DAY.finished_at }).error, /has not reached "Finished"/);
  assert.match(readTimes(r, { finished_at: "2026-10-21T03:40:00.000Z" }).error, /own day \(2026-10-20, Bangkok time\)/);
});

test("the Activity line says each step and the clock it moved from and to", () => {
  const r = timed("completed", DAY);
  assert.equal(timesLogLine(r, { finished_at: "2026-10-20T03:32:00.000Z" }), "corrected times: finished 10:40 → 10:32");
  assert.equal(timesLogLine(r, { acknowledged_at: "2026-10-20T03:06:00.000Z", started_at: "2026-10-20T03:12:00.000Z" }), "corrected times: on the way 10:05 → 10:06, started 10:10 → 10:12");
});

test("Save times is the set-times action on that request, from the status the drawer showed", async () => {
  const { calls, call } = caller();
  await saveTimes(call, { id: "r9", status: "completed" }, { finished_at: "2026-10-20T03:32:00.000Z" });
  assert.deepEqual(calls, [
    { url: "/api/requests/r9", method: "PATCH", body: { action: "set-times", from: "completed", times: { finished_at: "2026-10-20T03:32:00.000Z" } } },
  ]);
});
