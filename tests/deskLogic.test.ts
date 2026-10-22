import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  busyText,
  cancelBookingAfterAsking,
  cancelBookingPrompt,
  lookupState,
  nextFreeStart,
  slotGrid,
  slotKind,
  teamList,
} from "../src/components/desk/deskLogic";
import { formatClock } from "../src/components/ui";
import type { PublicPanel, RequestRow, Slot, Team } from "../src/lib/types";

/* The queue desk's decisions, run for real against
   src/components/desk/deskLogic.ts. How they are drawn is in
   deskPage.runtime.test.tsx. */

const team = (number: string, panel_id: string | null = "p2"): Team =>
  ({ id: `t-${number}`, number, name: `Team ${number}`, panel_id, division: "MS", category: "developing", pit: null, created_at: "" }) as Team;
const panel = { id: "p2", name: "Panel 2" } as PublicPanel;
const row = (status: RequestRow["status"]) => ({ id: "r1", team_id: "t-7700B", status }) as RequestRow;
const roster = ["7700B", "9882K", "4410C", "8123N"];

const look = (number: string, over: Partial<Parameters<typeof lookupState>[0]> = {}) =>
  lookupState({
    number,
    team: roster.includes(number) ? team(number) : null,
    panel,
    existing: null,
    roster: roster.map((number) => ({ number, name: `Team ${number}` })),
    ...over,
  });

/* ---- the five cases --------------------------------------------------------------- */

test("a team with a panel and nothing live is ready", () => {
  assert.deepEqual(look("7700B"), { kind: "ready" });
});

test("a live request means waiting, whatever its status; a booking means booked", () => {
  for (const status of ["requested", "acknowledged", "interviewing"] as const) {
    const request = row(status);
    assert.deepEqual(look("7700B", { existing: request }), { kind: "waiting", request });
  }
  const booking = row("scheduled");
  assert.deepEqual(look("7700B", { existing: booking }), { kind: "booked", booking });
});

test("a team with no panel is no-panel, unless it already has something", () => {
  assert.deepEqual(look("8123N", { panel: null }), { kind: "no-panel" });
  assert.equal(look("8123N", { panel: null, existing: row("requested") }).kind, "waiting");
});

test("not found only for a complete-looking number that no roster number could still grow into", () => {
  assert.deepEqual(look("0420Z"), { kind: "not-found" });
  assert.deepEqual(look("7701"), { kind: "not-found" });
  assert.deepEqual(look(""), { kind: "none" }, "an empty box says nothing");
  assert.deepEqual(look("77"), { kind: "none" }, "too short to be complete");
  assert.deepEqual(look("770"), { kind: "none" }, "still on its way to 7700B");
  assert.deepEqual(look("0420Z", { roster: [] }), { kind: "none" }, "before the roster has arrived");
  const otters = [{ number: "1241", name: "Orbit Otters" }, { number: "9882K", name: "Torque Titans" }];
  assert.deepEqual(look("OTTER", { roster: otters }), { kind: "none" }, "a name match is for the list to find, not an error");
  assert.deepEqual(look("9882K", { team: null, roster: otters.slice(0, 1) }), { kind: "not-found" }, "a number that is nobody's still is");
  assert.deepEqual(look("OTTERX", { roster: otters }), { kind: "not-found" });
});

test("the busy text is panelLoad's numbers, or 'free now'", () => {
  assert.equal(busyText({ waiting: 2, interviewing: 0, longestWait: 6 }), "2 waiting");
  assert.equal(busyText({ waiting: 0, interviewing: 1, longestWait: 0 }), "1 in interview");
  assert.equal(busyText({ waiting: 2, interviewing: 1, longestWait: 6 }), "2 waiting · 1 in interview");
  assert.equal(busyText({ waiting: 0, interviewing: 0, longestWait: 0 }), "free now");
});

/* ---- slots ------------------------------------------------------------------------- */

const NOW = Date.parse("2026-10-22T10:00:00.000Z");
const min = (m: number) => new Date(NOW + m * 60_000).toISOString();
const slot = (from: number, over: Partial<Slot> = {}): Slot => ({
  panelId: "p2", start: min(from), end: min(from + 20), takenBy: null, blocked: false, ...over,
});
const held = (teamId: string): Slot["takenBy"] => ({ teamId, teamNumber: "1111A", status: "scheduled" });
const ctx = { teamId: "t-me", currentStart: null, now: NOW };

test("next free is the first open slot still ahead, skipping past, taken and too-close ones", () => {
  const slots = [slot(-60), slot(-20, { takenBy: held("x") }), slot(0, { blocked: true }), slot(20, { takenBy: held("x") }), slot(40), slot(60)];
  assert.equal(nextFreeStart(slots, NOW), min(40));
  assert.equal(nextFreeStart([slot(-60), slot(0, { blocked: true })], NOW), null, "none left: omit it");
  assert.equal(nextFreeStart([], NOW), null);
});

test("a slot is theirs, then taken, then too close, then open; one that is over is past", () => {
  assert.equal(slotKind(slot(20, { takenBy: held("t-me") }), ctx), "theirs");
  assert.equal(slotKind(slot(20, { takenBy: held("x") }), ctx), "taken");
  assert.equal(slotKind(slot(20, { blocked: true }), ctx), "too-close");
  assert.equal(slotKind(slot(20), ctx), "open");
  assert.equal(slotKind(slot(-30), ctx), "past");
  assert.equal(slotKind(slot(-30, { takenBy: held("x") }), ctx), "past", "a past slot is not drawn, whoever held it");
  // Taken and blocked at once: taken wins.
  assert.equal(slotKind(slot(20, { takenBy: held("x"), blocked: true }), ctx), "taken");
});

test("while rescheduling, the booking being moved is 'current' rather than theirs", () => {
  const mine = slot(20, { takenBy: held("t-me") });
  assert.equal(slotKind(mine, { ...ctx, currentStart: min(20) }), "current");
  assert.equal(slotKind(slot(40, { takenBy: held("t-me") }), { ...ctx, currentStart: min(20) }), "theirs", "their other booking stays theirs");
});

test("the grid has a row per hour, no past slots, and counts what is open of what is shown", () => {
  // 20-minute slots on the hour, from an hour ago to three hours ahead.
  const base = Date.parse("2099-01-01T10:00:00.000Z");
  const at = (i: number): Slot => ({ ...slot(0), start: new Date(base + i * 20 * 60_000).toISOString(), end: new Date(base + (i + 1) * 20 * 60_000).toISOString() });
  const slots = [at(0), at(1), at(2), at(3), at(4), at(5)];
  slots[3] = { ...slots[3], takenBy: held("x") };
  const grid = slotGrid(slots, 20, { teamId: null, currentStart: null, now: base + 45 * 60_000 });
  assert.equal(grid.shown, 4, "slots 0 and 1 are over");
  assert.equal(grid.open, 3);
  assert.equal(grid.columns, 3);
  assert.deepEqual(grid.rows.flatMap((r) => r.cells.map((c) => c.slot.start)), slots.slice(2).map((s) => s.start));
  assert.ok(grid.rows.length >= 2 && grid.rows.every((r) => r.cells.length <= 3), "at most three to an hour");
  const columns = grid.rows.flatMap((r) => r.cells.map((c) => c.column));
  assert.ok(columns.every((c) => c >= 0 && c < 3));
});

/* ---- cancelling a booking, asked first ------------------------------------------------ */

const booking = { slot_start: "2026-10-22T11:00:00.000Z" };

test("the question names the team and the time, and the buttons read 'Cancel booking' / 'Keep it'", async () => {
  const asked: [string, unknown][] = [];
  let sent = 0;
  const did = await cancelBookingAfterAsking(
    async (q, o) => {
      asked.push([q, o]);
      return false;
    },
    "4410C",
    booking,
    async () => {
      sent++;
    },
  );
  assert.equal(did, false);
  assert.equal(sent, 0, "a declined cancel sends nothing");
  assert.deepEqual(asked, [[`Cancel 4410C's ${formatClock(booking.slot_start)} booking?`, { confirmLabel: "Cancel booking", cancelLabel: "Keep it", danger: true }]]);
  assert.equal(cancelBookingPrompt("4410C", booking.slot_start), asked[0][0]);
});

test("on a yes the cancel is sent once, after the question; a failed send is the caller's to show", async () => {
  const order: string[] = [];
  assert.equal(
    await cancelBookingAfterAsking(async () => (order.push("asked"), true), "4410C", booking, async () => void order.push("sent")),
    true,
  );
  assert.deepEqual(order, ["asked", "sent"]);
  await assert.rejects(
    cancelBookingAfterAsking(async () => true, "4410C", booking, async () => {
      throw new Error("Request failed (500)");
    }),
    /Request failed \(500\)/,
  );
});

/* ---- the palette the chips wear (AA on every fill, both themes) ------------------------- */

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

/** OKLCH -> linear sRGB -> WCAG relative luminance. */
function luminance([L, C, H]: number[]) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  const [r, g, bl] = lin.map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}
const contrast = (x: number[], y: number[]) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};
function ruleBody(open: RegExp) {
  const at = css.search(open);
  assert.notEqual(at, -1, `${open} not found`);
  return css.slice(at, css.indexOf("\n}", at));
}
function token(body: string, name: string) {
  const m = new RegExp(`--${name}:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`).exec(body);
  assert.ok(m, `--${name} is not an oklch() in that block`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

for (const theme of ["dark", "light"]) {
  test(`${theme}: the ink on every desk status chip clears AA 4.5:1`, () => {
    const app = ruleBody(theme === "dark" ? /^:root,\n:root\[data-theme="dark"\] \{/m : /^:root\[data-theme="light"\] \{/m);
    const page = ruleBody(theme === "dark" ? /^\.desk \{/m : /^:root\[data-theme="light"\] \.desk \{/m);
    // The same pairs the .dk-s-* classes make.
    const pairs = {
      booked: [token(app, "booked-quiet"), token(page, "dk-booked-ink")],
      waiting: [token(app, "waiting"), token(app, "waiting-ink")],
      enroute: [token(app, "enroute"), token(app, "enroute-ink")],
      active: [token(app, "active"), token(app, "active-ink")],
      done: [token(app, "done"), token(app, "done-ink")],
    };
    for (const [name, [fill, ink]] of Object.entries(pairs)) {
      const ratio = contrast(fill, ink);
      assert.ok(ratio >= 4.5, `${theme}: ${name} ink on its fill is ${ratio.toFixed(2)}:1`);
    }
    // The desk's teal is defined for both themes, with the values the spec gives.
    assert.deepEqual(token(page, "dk-desk"), theme === "dark" ? [0.74, 0.11, 185] : [0.52, 0.105, 185]);
  });
}

test("each status class pairs the fill and the ink the test above measures", () => {
  const pairs = { booked: ["booked-quiet", "dk-booked-ink"], waiting: ["waiting", "waiting-ink"], enroute: ["enroute", "enroute-ink"], active: ["active", "active-ink"], done: ["done", "done-ink"] };
  for (const [tone, [fill, ink]] of Object.entries(pairs)) {
    assert.ok(css.includes(`.desk .dk-s-${tone} { --c: var(--${fill}); --ci: var(--${ink}); }`), `.dk-s-${tone} no longer uses --${fill} with --${ink}`);
  }
});

test("the desk's CSS sits after the judge console block and has no motion", () => {
  // It sits between the judge console's block and the Judge Advisor's, whose own tests read to the end of the file.
  const start = css.lastIndexOf("/* ----", css.indexOf('Queue desk ("Now / Book"'));
  assert.ok(start > css.indexOf('Judge console ("Up next"'), "after the judge console block");
  const block = css.slice(start, css.lastIndexOf("/* ----", css.indexOf('Judge Advisor console ("Panel board"')));
  assert.ok(block.length > 3000, "the desk block was not found");
  const bare = block.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(bare, /@keyframes|animation|transition|scroll-behavior/);
  const classes = new Set([...bare.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));
  const stray = [...classes].filter((c) => !/^(dk-|desk$|theme-toggle$|text-ink-faint$)/.test(c));
  assert.deepEqual(stray, [], "every class in the block is the desk's own");
});

/* ---- all teams --------------------------------------------------------------------- */

const named = (number: string, name: string): Team => ({ ...team(number), name });
const roll = [named("9882K", "Torque Titans"), named("100A", "Quantum Quokkas"), named("20B", "Byte Me"), named("1122A", "Bolt Brigade")];
const heldReq = (team_id: string, status: RequestRow["status"], id = `r-${team_id}`) => ({ id, team_id, status, slot_start: null }) as RequestRow;

test("teamList: every team in number order (100 after 20), empty box means all", () => {
  assert.deepEqual(teamList(roll, [], "").map((r) => r.team.number), ["20B", "100A", "1122A", "9882K"]);
  assert.deepEqual(teamList(roll, [], "  ").length, 4, "nothing real typed");
});

test("teamList: narrows by number prefix and by name, either case", () => {
  assert.deepEqual(teamList(roll, [], "11").map((r) => r.team.number), ["1122A"]);
  assert.deepEqual(teamList(roll, [], "1").map((r) => r.team.number), ["100A", "1122A"], "prefix, not substring");
  assert.deepEqual(teamList(roll, [], "quok").map((r) => r.team.number), ["100A"]);
  assert.deepEqual(teamList(roll, [], "QUOK").map((r) => r.team.number), ["100A"]);
  assert.deepEqual(teamList(roll, [], "1122a").map((r) => r.team.number), ["1122A"]);
  assert.deepEqual(teamList(roll, [], "BYTE").map((r) => r.team.number), ["20B"]);
  assert.deepEqual(teamList(roll, [], "zzz"), []);
});

test("teamList: pairs each team with its live request, else its booking, else null; does not reorder the input", () => {
  const live = heldReq("t-100A", "requested");
  const later = heldReq("t-20B", "scheduled");
  const done = heldReq("t-9882K", "completed");
  const input = [...roll];
  const rows = teamList(input, [done, later, live], "");
  assert.deepEqual(rows.map((r) => r.request?.id ?? null), [later.id, live.id, null, null]);
  assert.deepEqual(input, roll, "the roster passed in is left as it was");
});
