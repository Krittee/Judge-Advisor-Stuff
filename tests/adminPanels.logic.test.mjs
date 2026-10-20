import assert from "node:assert/strict";
import test from "node:test";

import {
  addJudge,
  changeDivisionAfterAsking,
  conflictsLabel,
  deleteAllPanels,
  deletedAllNotice,
  deletePanelAfterAsking,
  deletePanelQuestion,
  divisionQuestion,
  judgeConflicts,
  moveJudge,
  moveJudgeShowing,
  panelJudges,
  panelValue,
  removeJudgeAfterAsking,
  removeJudgeQuestion,
  rosterGroups,
  slotBody,
  slotsHeader,
  slotsSummary,
  startSlotDraft,
  takeOffCopy,
  takeOffLines,
  teamsByPanel,
  toLocalInput,
} from "../src/components/admin/panelsLogic";
import { formatClock } from "../src/components/ui";
import { createConfirmer } from "../src/components/ConfirmDialog";

/* The Panels tab's decisions, run for real against
   src/components/admin/panelsLogic.ts. How they are drawn is in
   adminPanels.runtime.test.tsx; the store behind them is in
   judgeRoutes.runtime.test.ts. */

const panel = (n, division, extra = {}) => ({
  id: `p${n}`, name: `Panel ${n}`, division, judges: [], languages: ["en"], sort_order: n,
  slot_start_at: null, slot_minutes: 20, slot_count: 0, ...extra,
});
const p1 = panel(1, "High School");
const p2 = panel(2, "Middle School");
const p3 = panel(3, "Middle School");
const p4 = panel(4, "Elementary School");
const panels = [p1, p2, p3, p4];

const judge = (id, name, panel_id) => ({ id, name, note: null, panel_id, created_at: "2026-10-20T08:00:00Z" });
const jordan = judge("j-jordan", "Jordan Kim", null);
const alex = judge("j-alex", "Alex Wong", null);
const dana = judge("j-dana", "Dana Ruiz", "p1");
const sam = judge("j-sam", "Sam Okafor", "p1");
const priya = judge("j-priya", "Priya Nair", "p2");
const lee = judge("j-lee", "Lee Chen", "p2");
const tom = judge("j-tom", "Tom Baker", "p3");
const mei = judge("j-mei", "Mei Tan", "p4");
// The roster in the order it was typed in, not the order of the panels.
const roster = [jordan, priya, dana, tom, alex, lee, sam, mei];

const team = (number, name) => ({ id: `t-${number}`, number, name, panel_id: "p3", division: "Middle School" });
const titans = team("9882K", "Torque Titans");
const byteMe = team("7700B", "Byte Me");
const teams = [titans, byteMe, { ...team("1234X", "Circuit Breakers"), panel_id: null }];
const conflict = (id, judge_id, t, note = null) => ({ id, panel_id: null, judge_id, team_id: t.id, judge_name: null, note });

/** A fake server: records every request, answers from a script. */
function server(answers = {}) {
  const sent = [];
  const send = async (url, options = {}) => {
    sent.push({ url, method: options.method ?? "POST", body: options.body });
    if (answers.fail) throw new Error(answers.fail);
    const dry = options.body?.dryRun === true;
    return dry ? { judge: {}, takenOff: answers.takenOff ?? [], dryRun: true } : (answers.reply ?? { ok: true });
  };
  return { send, sent };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

/* ---- the roster -------------------------------------------------------------- */

test("the roster is grouped: not on a panel first, then one group per panel in panel order", () => {
  const groups = rosterGroups(roster, panels);
  assert.deepEqual(
    groups.map((g) => [g.label, g.judges.map((j) => j.name)]),
    [
      ["Not on a panel", ["Jordan Kim", "Alex Wong"]],
      ["Panel 1 · HS", ["Dana Ruiz", "Sam Okafor"]],
      ["Panel 2 · MS", ["Priya Nair", "Lee Chen"]],
      ["Panel 3 · MS", ["Tom Baker"]],
      ["Panel 4 · ES", ["Mei Tan"]],
    ],
    "judges keep the roster's own order inside a group, whatever order they were added in",
  );
  // The panels' order is the order they come in, not the judges'.
  assert.deepEqual(rosterGroups(roster, [p4, p3, p2, p1]).map((g) => g.label), ["Not on a panel", "Panel 4 · ES", "Panel 3 · MS", "Panel 2 · MS", "Panel 1 · HS"]);
});

test("a group with nobody in it is left out, and a judge whose panel is gone is not on a panel", () => {
  assert.deepEqual(rosterGroups([dana, mei], panels).map((g) => g.label), ["Panel 1 · HS", "Panel 4 · ES"], "no empty Not on a panel, no empty Panel 2");
  assert.deepEqual(rosterGroups([], panels), []);
  const orphan = judge("j-x", "Gone Girl", "p-deleted");
  assert.deepEqual(rosterGroups([orphan], panels).map((g) => [g.label, g.judges[0].name]), [["Not on a panel", "Gone Girl"]]);
  assert.equal(panelValue(orphan, panels), "", "and its select reads — none —");
  assert.equal(panelValue(dana, panels), "p1");
  assert.equal(panelValue(jordan, panels), "");
});

test("a judge's conflicts are counted by judge, not by panel", () => {
  const rows = [conflict("c1", priya.id, titans), conflict("c2", priya.id, byteMe), conflict("c3", jordan.id, titans), { ...conflict("c4", null, titans), panel_id: "p2", judge_id: null }];
  assert.equal(judgeConflicts(priya.id, rows), 2);
  assert.equal(judgeConflicts(jordan.id, rows), 1);
  assert.equal(judgeConflicts(alex.id, rows), 0);
  assert.deepEqual([conflictsLabel(0), conflictsLabel(1), conflictsLabel(2)], ["0 conflicts", "1 conflict", "2 conflicts"]);
});

test("a panel card reads its judges and teams off the roster and the teams", () => {
  assert.deepEqual(panelJudges("p2", roster), ["Priya Nair", "Lee Chen"]);
  assert.deepEqual(panelJudges("p9", roster), []);
  const held = teamsByPanel([...teams, { panel_id: "p3" }, { panel_id: "p1" }]);
  assert.deepEqual([held.get("p3"), held.get("p1"), held.get("p2")], [3, 1, undefined]);
});

/* ---- moving a judge ---------------------------------------------------------- */

test("moving a judge looks first (dryRun), asks when teams would come off, and saves only on a yes", async () => {
  const api = server({ takenOff: ["9882K", "7700B"] });
  const asked = [];
  const confirm = createConfirmer(() => {});
  const moved = moveJudge(api.send, jordan, "p3", async (takenOff) => {
    asked.push(takenOff);
    return confirm.ask("Add Jordan Kim to Panel 3?");
  });
  await tick();
  assert.deepEqual(api.sent.map((s) => [s.method, s.url, s.body.dryRun]), [["PATCH", "/api/admin/judges", true]], "only the look so far");
  assert.deepEqual(api.sent[0].body, { id: "j-jordan", panelId: "p3", dryRun: true });
  assert.deepEqual(asked, [["9882K", "7700B"]], "the question is asked about exactly the teams the server reported");
  confirm.settle(true);
  assert.equal(await moved, true);
  assert.deepEqual(api.sent.map((s) => s.body.dryRun), [true, undefined], "then the real move");
  assert.deepEqual(api.sent[1].body, { id: "j-jordan", panelId: "p3" });
});

test("cancelling the question sends nothing: only the dry run went out", async () => {
  const api = server({ takenOff: ["9882K"] });
  const moved = await moveJudge(api.send, jordan, "p3", async () => false);
  assert.equal(moved, false);
  assert.equal(api.sent.length, 1);
  assert.equal(api.sent[0].body.dryRun, true);
});

test("with nothing to take off a move saves at once, without a question", async () => {
  const api = server({ takenOff: [] });
  const asked = [];
  const moved = await moveJudge(api.send, priya, "p3", async (t) => (asked.push(t), true));
  assert.equal(moved, true);
  assert.deepEqual(asked, [], "no confirm");
  assert.deepEqual(api.sent.map((s) => s.body.dryRun), [true, undefined]);
  assert.deepEqual(api.sent[1].body, { id: "j-priya", panelId: "p3" });
});

test("moving to — none — also looks first, then saves a null panel with no question", async () => {
  const api = server({ takenOff: [] });
  const asked = [];
  assert.equal(await moveJudge(api.send, priya, "", async (t) => (asked.push(t), true)), true);
  assert.deepEqual(asked, []);
  assert.deepEqual(api.sent.map((s) => s.body), [{ id: "j-priya", panelId: null, dryRun: true }, { id: "j-priya", panelId: null }]);
});

test("choosing the panel the judge is already on sends nothing", async () => {
  const api = server();
  assert.equal(await moveJudge(api.send, priya, "p2", async () => true), false);
  assert.equal(await moveJudge(api.send, jordan, "", async () => true), false);
  assert.deepEqual(api.sent, []);
});

test("a refused move throws what the server said and the select still goes back", async () => {
  const shown = [];
  const api = server({ fail: "That panel no longer exists." });
  await assert.rejects(
    moveJudgeShowing(api.send, jordan, "p3", async () => true, (p) => shown.push(p), async () => {}),
    /That panel no longer exists/,
  );
  assert.deepEqual(shown, [{ judgeId: "j-jordan", panelId: "p3" }, null]);
});

test("the select shows where the judge is going while the question is open, and snaps back on Cancel", async () => {
  const shown = [];
  const api = server({ takenOff: ["9882K"] });
  const confirm = createConfirmer(() => {});
  const after = [];
  const moving = moveJudgeShowing(api.send, jordan, "p3", (t) => confirm.ask(`Add Jordan Kim? ${t}`), (p) => shown.push(p), async () => void after.push("refresh"));
  await tick();
  assert.deepEqual(shown, [{ judgeId: "j-jordan", panelId: "p3" }], "the select reads Panel 3 while the question is open");
  confirm.settle(false);
  assert.equal(await moving, false);
  assert.deepEqual(shown, [{ judgeId: "j-jordan", panelId: "p3" }, null], "Cancel: back to where the judge is");
  assert.deepEqual(after, [], "nothing to redraw");
  assert.equal(api.sent.length, 1, "and nothing but the dry run was sent");
});

test("a finished move redraws the roster before the select lets go of its new value", async () => {
  const order = [];
  const api = server({ takenOff: [] });
  await moveJudgeShowing(api.send, jordan, "p3", async () => true, (p) => order.push(p ? "show" : "clear"), async () => void order.push("refresh"));
  assert.deepEqual(order, ["show", "refresh", "clear"]);
});

test("the take-off question names the teams with their names and the judge's own notes", () => {
  const rows = [conflict("c1", jordan.id, titans, "coaches this team"), conflict("c2", jordan.id, byteMe), conflict("c3", priya.id, byteMe, "someone else's note")];
  assert.deepEqual(takeOffLines(jordan.id, ["9882K", "7700B", "0000Z"], teams, rows), [
    { number: "9882K", name: "Torque Titans", note: "coaches this team" },
    { number: "7700B", name: "Byte Me", note: null },
    { number: "0000Z", name: null, note: null },
  ]);
});

test("the take-off words match the mock, with the judge's name where the mock says she, and singular for one team", () => {
  const two = takeOffCopy("Priya Nair", "Panel 3", 2);
  assert.equal(two.title, "Add Priya Nair to Panel 3?");
  assert.equal(two.lead, "Priya Nair has conflicts with 2 teams on Panel 3. Adding Priya Nair takes them off it.");
  assert.equal(two.caution, "They’ll need another panel.");
  assert.equal(two.confirm, "Add and take teams off");
  const one = takeOffCopy("Jordan Kim", "Panel 3", 1);
  assert.equal(one.lead, "Jordan Kim has a conflict with 1 team on Panel 3. Adding Jordan Kim takes that team off it.");
  assert.equal(one.caution, "That team will need another panel.");
  assert.doesNotMatch(`${two.lead} ${one.lead} ${two.caution} ${one.caution}`, /\b(she|her|he|his|him)\b/i, "the roster does not record pronouns");
});

/* ---- remove from roster ------------------------------------------------------ */

test("Remove from roster asks first, and says how many conflicts go with the judge", async () => {
  assert.equal(removeJudgeQuestion("Alex Wong", 0), "Remove Alex Wong from the roster?");
  assert.equal(removeJudgeQuestion("Jordan Kim", 1), "Remove Jordan Kim from the roster?\n\nRemoving Jordan Kim also withdraws 1 conflict.");
  assert.match(removeJudgeQuestion("Priya Nair", 2), /Removing Priya Nair also withdraws 2 conflicts\.$/);

  const api = server();
  const asked = [];
  const confirm = createConfirmer((p) => p && asked.push(p));
  const removed = removeJudgeAfterAsking(confirm.ask, api.send, jordan, 1);
  await tick();
  assert.equal(asked.length, 1);
  assert.deepEqual([asked[0].confirmLabel, asked[0].danger], ["Remove from roster", true]);
  assert.match(asked[0].question, /also withdraws 1 conflict\./);
  assert.deepEqual(api.sent, [], "nothing is sent while the question is open");
  confirm.settle(true);
  assert.equal(await removed, true);
  assert.deepEqual(api.sent.map((s) => [s.method, s.url]), [["DELETE", "/api/admin/judges?id=j-jordan"]]);
});

test("declining Remove from roster sends nothing", async () => {
  const api = server();
  const confirm = createConfirmer(() => {});
  const removed = removeJudgeAfterAsking(confirm.ask, api.send, jordan, 1);
  await tick();
  confirm.settle(false);
  assert.equal(await removed, false);
  assert.deepEqual(api.sent, []);
});

test("+ New judge sends a name and a note and nothing else: no panel, so the judge starts on — none —", async () => {
  const api = server({ reply: { judge: { ...alex, name: "Priya Nair" } } });
  const made = await addJudge(api.send, "  Priya Nair ", " volunteer ");
  assert.equal(made.name, "Priya Nair");
  assert.deepEqual(api.sent.map((s) => [s.method, s.url, s.body]), [["POST", "/api/admin/judges", { name: "Priya Nair", note: "volunteer" }]]);
  assert.ok(!("panelId" in api.sent[0].body));
});

/* ---- panels ------------------------------------------------------------------ */

test("a division change asks first, in today's words, and saves only on a yes", async () => {
  assert.equal(
    divisionQuestion("Panel 3", "High School"),
    "Move Panel 3 to High School?\n\nIts current teams stay in their own division and become unassigned, so you will need to give them to another panel.",
  );
  const log = [];
  const asked = [];
  const confirm = createConfirmer((p) => p && asked.push(p));
  const changed = changeDivisionAfterAsking(confirm.ask, "Panel 3", "High School", async () => void log.push("save"));
  await tick();
  assert.deepEqual([asked[0].confirmLabel, asked[0].danger], ["Move division", true]);
  assert.deepEqual(log, [], "nothing is saved while the question is open");
  confirm.settle(true);
  assert.equal(await changed, true);
  assert.deepEqual(log, ["save"]);

  const no = createConfirmer(() => {});
  const declined = changeDivisionAfterAsking(no.ask, "Panel 3", "High School", async () => void log.push("save again"));
  await tick();
  no.settle(false);
  assert.equal(await declined, false);
  assert.deepEqual(log, ["save"]);
});

test("Delete panel asks first and deletes only the panel: one DELETE by id, nothing for judges or conflicts", async () => {
  assert.equal(deletePanelQuestion("Panel 3"), "Delete Panel 3? Its teams become unassigned.");
  const api = server();
  const asked = [];
  const confirm = createConfirmer((p) => p && asked.push(p));
  const deleted = deletePanelAfterAsking(confirm.ask, api.send, p3);
  await tick();
  assert.deepEqual([asked[0].question, asked[0].confirmLabel, asked[0].danger], ["Delete Panel 3? Its teams become unassigned.", "Delete panel", true]);
  assert.deepEqual(api.sent, []);
  confirm.settle(true);
  assert.equal(await deleted, true);
  assert.deepEqual(api.sent.map((s) => [s.method, s.url]), [["DELETE", "/api/admin/panels?id=p3"]]);

  const declined = server();
  const no = createConfirmer(() => {});
  const gone = deletePanelAfterAsking(no.ask, declined.send, p3);
  await tick();
  no.settle(false);
  assert.equal(await gone, false);
  assert.deepEqual(declined.sent, []);
});

test("Delete all is one DELETE ?all=true, and the notice says teams and judges stay", async () => {
  const api = server({ reply: { ok: true, deleted: 4 } });
  const res = await deleteAllPanels(api.send);
  assert.equal(res.deleted, 4);
  assert.deepEqual(api.sent.map((s) => [s.method, s.url]), [["DELETE", "/api/admin/panels?all=true"]]);
  assert.equal(deletedAllNotice(4), "Deleted 4 panels. Teams are still here, now unassigned. Judges are still on the roster.");
  assert.match(deletedAllNotice(1), /^Deleted 1 panel\. /);
});

/* ---- booking slots ----------------------------------------------------------- */

test("the slot summary and the dialog's header", () => {
  const on = panel(1, "High School", { slot_count: 8, slot_minutes: 20, slot_start_at: "2026-10-20T10:00:00.000Z" });
  assert.equal(slotsSummary(on), `8 slots from ${formatClock(on.slot_start_at)} · 20 min`);
  assert.equal(slotsSummary({ ...on, slot_count: 1 }), `1 slot from ${formatClock(on.slot_start_at)} · 20 min`);
  assert.equal(slotsSummary({ ...on, slot_start_at: null }), "8 slots · 20 min", "no start to show");
  assert.equal(slotsSummary(panel(3, "Middle School")), "Booking slots off");
  assert.equal(slotsHeader(on), "Booking slots (8)");
  assert.equal(slotsHeader(panel(3, "Middle School")), "Booking slots (off)");
});

test("the slot fields start from the panel and save as the PATCH the old grid sent", () => {
  const on = panel(1, "High School", { slot_count: 8, slot_minutes: 20, slot_start_at: "2026-10-20T10:00:00.000Z" });
  const draft = startSlotDraft(on);
  assert.deepEqual([draft.minutes, draft.count], [20, 8]);
  assert.equal(draft.start, toLocalInput(on.slot_start_at));
  assert.match(draft.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "datetime-local wants wall time, no Z");
  assert.equal(new Date(draft.start).toISOString(), "2026-10-20T10:00:00.000Z", "and it is the same moment");
  assert.deepEqual(slotBody(draft), { slotCount: 8, slotMinutes: 20, slotStartAt: "2026-10-20T10:00:00.000Z" });
  assert.deepEqual(slotBody({ start: "", minutes: 15, count: 0 }), { slotCount: 0, slotMinutes: 15, slotStartAt: null }, "0 for walk-up queue only");
  assert.equal(toLocalInput(null), "");
});
