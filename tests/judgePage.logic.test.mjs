import assert from "node:assert/strict";
import test from "node:test";

import {
  clockParts,
  completedBeforeSlots,
  dueText,
  flagDetail,
  leadFlag,
  nowIndex,
  primaryAction,
  rubricShort,
  sectionMax,
  teamMeta,
} from "../src/components/judge/logic";
import { formatMinutes } from "../src/components/ui";
import { minutesSince, waitingAlert } from "../src/lib/judgeQueue";

/* The judge console's decisions, run for real against
   src/components/judge/logic.ts. How they are drawn is in
   judgePage.runtime.test.tsx. */

const NOW = Date.parse("2026-10-17T10:36:00Z");
const at = (min) => new Date(NOW + min * 60_000).toISOString();

/* ---- the primary action --------------------------------------------------- */

test("the primary action names the step and the status it moves the team to", () => {
  assert.deepEqual(primaryAction("requested"), { to: "acknowledged", label: "On our way" });
  assert.deepEqual(primaryAction("scheduled"), { to: "acknowledged", label: "On our way" });
  assert.deepEqual(primaryAction("acknowledged"), { to: "interviewing", label: "Start interview" });
  assert.deepEqual(primaryAction("interviewing"), { to: "completed", label: "Finish interview" });
  assert.equal(primaryAction("completed"), null);
  assert.equal(primaryAction("cancelled"), null);
});

/* ---- waits and slots ------------------------------------------------------ */

test("a wait is whole minutes, rounded, never negative, and reads like the alert row's", () => {
  assert.equal(minutesSince(at(-6), NOW), 6);
  assert.equal(minutesSince(new Date(NOW - 89_000).toISOString(), NOW), 1, "89 s rounds to 1");
  assert.equal(minutesSince(at(5), NOW), 0, "a clock a little ahead is not a negative wait");
  // The alert row is built on the same helper, so it cannot round differently from the cards.
  const waiting = { team: { number: "9882K" }, request: { requested_at: new Date(NOW - 89_000).toISOString() } };
  assert.equal(waitingAlert([waiting], NOW)[0].minutes, minutesSince(waiting.request.requested_at, NOW));
  assert.equal(formatMinutes(0), "just now");
  assert.equal(formatMinutes(1), "1 min");
  assert.equal(formatMinutes(59), "59 min");
  assert.equal(formatMinutes(60), "1h");
  assert.equal(formatMinutes(65), "1h 5m");
});

test("a booked slot says in N min inside the last ten minutes, due now once started, nothing before", () => {
  assert.equal(dueText(null, NOW), null);
  assert.equal(dueText(at(24), NOW), null, "a long way off");
  assert.equal(dueText(at(11), NOW), null, "just outside the window");
  assert.equal(dueText(at(10), NOW), "in 10 min");
  assert.equal(dueText(at(4), NOW), "in 4 min");
  assert.equal(dueText(new Date(NOW + 30_000).toISOString(), NOW), "in 1 min", "rounds up: never in 0 min");
  assert.equal(dueText(at(0), NOW), "due now");
  assert.equal(dueText(at(-5), NOW), "due now");
});

/* ---- Today's timeline ----------------------------------------------------- */

test("the now rule goes before the first slot yet to start, and at the end when all have", () => {
  const slots = [{ start: at(-40) }, { start: at(-20) }, { start: at(4) }, { start: at(24) }];
  assert.equal(nowIndex(slots, NOW), 2);
  assert.equal(nowIndex(slots, NOW - 60 * 60_000), 0, "before the day starts it leads the timeline");
  assert.equal(nowIndex(slots, NOW + 60 * 60_000), 4, "after the last slot it closes it");
  assert.equal(nowIndex([{ start: at(0) }], NOW), 1, "a slot starting right now has started");
  assert.equal(nowIndex([], NOW), 0);
});

test("teams interviewed before the first slot collapse to one line, unless they hold a slot", () => {
  const t = (n) => ({ id: `t${n}`, number: n });
  const slot = (min, teamId) => ({ start: at(min), takenBy: teamId ? { teamId } : null });
  const done = (team, finished) => ({ team_id: team.id, status: "completed", finished_at: finished, updated_at: finished });
  const [a, b, c, d] = [t("8080V"), t("5150Z"), t("3333T"), t("1111A")];
  const slots = [slot(-60, d.id), slot(-40)];

  const early = completedBeforeSlots(
    slots,
    [done(a, at(-200)), done(b, at(-120)), done(c, at(-30)), done(d, at(-50))],
    [a, b, c, d],
  );
  // c finished after the grid opened; d is in the grid, so the timeline already shows it.
  assert.deepEqual(early.teams.map((x) => x.number), ["5150Z", "8080V"], "by team number");
  assert.equal(early.before, slots[0].start);

  assert.equal(completedBeforeSlots(slots, [done(c, at(-30))], [c]), null);
  assert.equal(completedBeforeSlots([], [done(a, at(-200))], [a]), null, "no grid, no timeline");
  const cancelled = { team_id: a.id, status: "cancelled", finished_at: at(-200), updated_at: at(-200) };
  assert.equal(completedBeforeSlots(slots, [cancelled], [a]), null, "only completed interviews count");
});

test("the time column splits the period off so the column stays narrow", () => {
  const { time, period } = clockParts("2026-10-17T10:40:00");
  assert.match(time, /^\d{1,2}:\d{2}$/);
  assert.ok(period === "" || /^[AP]M$/i.test(period), `a 12-hour locale gives AM/PM, a 24-hour one nothing (got "${period}")`);
});

/* ---- flags ---------------------------------------------------------------- */

const kinds = [
  { id: "good", severity: 0 },
  { id: "warning", severity: 1 },
  { id: "major", severity: 3 },
];
const flag = (over) => ({
  id: "f", team_id: "t", kind: "warning", body: "", author: "Jordan Lee",
  match_type: "Q", match_number: "19", rule: "GG17", created_at: "2026-10-17T10:00:00Z", ...over,
});

test("one line of a flag: the rules and the match, never the field or the author", () => {
  assert.equal(flagDetail(flag()), "GG17 · Q19");
  assert.equal(flagDetail(flag({ rule: "gg17, SG9,GG17" })), "GG17, SG9 · Q19");
  assert.equal(flagDetail(flag({ rule: null })), "Q19");
  assert.equal(flagDetail(flag({ match_type: null, match_number: null })), "GG17");
  assert.equal(flagDetail(flag({ rule: null, match_type: null, match_number: null })), "");
});

test("the flag on a card is the most serious, then the newest", () => {
  const warnOld = flag({ id: "w1", created_at: "2026-10-17T09:00:00Z" });
  const warnNew = flag({ id: "w2", created_at: "2026-10-17T10:00:00Z" });
  const major = flag({ id: "m", kind: "major", created_at: "2026-10-17T08:00:00Z" });
  assert.equal(leadFlag([warnOld, warnNew], kinds).id, "w2");
  assert.equal(leadFlag([warnNew, major, warnOld], kinds).id, "m");
  assert.equal(leadFlag([flag({ kind: "mystery" }), warnOld], kinds).id, "w1", "an unknown kind ranks last");
  assert.equal(leadFlag([], kinds), null);
});

/* ---- labels --------------------------------------------------------------- */

test("a team's line is its category and pit, whichever it has", () => {
  const categories = [{ id: "developing", label: "Developing" }];
  assert.equal(teamMeta({ category: "developing", pit: "22" }, categories), "Developing · Pit 22");
  assert.equal(teamMeta({ category: "developing", pit: null }, categories), "Developing");
  assert.equal(teamMeta({ category: "gone", pit: "22" }, categories), "Pit 22");
});

test("a rubric is named by its last word on a tight button, and a section's maximum follows the scale", () => {
  assert.equal(rubricShort({ name: "Engineering Notebook" }), "Notebook");
  assert.equal(rubricShort({ name: "Team Interview" }), "Interview");
  assert.equal(rubricShort({ name: "Notebook" }), "Notebook");
  const interview = { scale: [{ value: 0 }, { value: 1 }, { value: 2 }] };
  const notebook = { scale: [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }] };
  assert.equal(sectionMax(interview, 3), 6);
  assert.equal(sectionMax(notebook, 4), 16);
});
