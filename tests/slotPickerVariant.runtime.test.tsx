import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { PanelBusyLine, SlotPicker } from "../src/components/SlotPicker";
import { formatClock } from "../src/components/ui";
import type { PublicPanel, RequestRow, Team } from "../src/lib/types";

/* The team page restyles SlotPicker with a `variant` and PanelBusyLine with
   `plain`; the queue desk uses both without. These pin the desk's output
   exactly -- the markup below was captured from the picker before the
   variant existed -- so a change to the team page cannot reach /queue. */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const noop = () => {};

// 10-minute slots in 2099, so none has passed and nothing depends on the clock.
const START = Date.parse("2099-01-01T10:00:00.000Z");
const at = (i: number) => new Date(START + i * 10 * 60_000).toISOString();
const time = (i: number) => formatClock(at(i));

const panel: PublicPanel = {
  id: "p1", name: "Panel 1", division: "Middle School", judges: [], languages: [], sort_order: 1,
  slot_start_at: at(0), slot_minutes: 10, slot_count: 8,
};
const teams = [{ id: "ta", number: "1111A" }, { id: "tt", number: "9882K" }] as Team[];
const held = (id: string, team_id: string, status: RequestRow["status"], i: number) =>
  ({ id, team_id, panel_id: "p1", status, kind: "slot", slot_start: at(i), slot_end: at(i + 1) }) as RequestRow;
// 1111A holds the 3rd slot; 9882K (the team being booked) has a finished one at the 6th. That leaves
// slots 1 and 8 free, 3 taken, 6 theirs, and the four beside those two too close.
const requests = [held("r1", "ta", "scheduled", 2), held("r2", "tt", "completed", 5)];

/* ---- the desk's picker, as it was -------------------------------------------------- */

const TOO_CLOSE = "Too close to another team&#x27;s booking on this panel — judges need 20 minutes to walk between interviews";
const LEGEND =
  '<span class="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-faint">' +
  '<span class="flex items-center gap-1"><span class="h-2 w-2 rounded-sm bg-surface-2"></span> free</span>' +
  '<span class="flex items-center gap-1"><span class="h-2 w-2 rounded-sm bg-line-strong"></span> taken</span>' +
  '<span class="flex items-center gap-1"><span class="h-2 w-2 rounded-sm bg-done/60"></span> yours</span></span>';
const header = (line: string) => `<div class="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs"><span class="text-ink-subtle">${line}</span>${LEGEND}</div>`;
const GRID = '<div class="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(104px,1fr))]">';
const free = (i: number, disabled = false) =>
  `<button${disabled ? ' disabled=""' : ""} class="rounded-xl bg-surface px-2 py-2.5 text-center ring-1 ring-inset ring-line transition hover:bg-accent hover:text-white disabled:opacity-40"><div class="text-sm font-semibold">${time(i)}</div><div class="text-[11px] opacity-70">free</div></button>`;
const tooClose = (i: number) =>
  `<div class="rounded-xl bg-surface px-2 py-2.5 text-center ring-1 ring-inset ring-line" title="${TOO_CLOSE}"><div class="text-sm text-ink-faint line-through">${time(i)}</div><div class="text-[11px] text-ink-faint">too close</div></div>`;
const taken = (i: number) =>
  `<div class="rounded-xl bg-surface px-2 py-2.5 text-center ring-1 ring-inset ring-line" title="Taken by team 1111A — Scheduled"><div class="text-sm font-medium text-ink-faint line-through">${time(i)}</div><div class="flex items-center justify-center gap-1 text-[11px] text-ink-subtle"><span class="h-1.5 w-1.5 rounded-full bg-booked-quiet"></span>1111A</div></div>`;
const yours = (i: number) =>
  `<div class="rounded-xl bg-done/20 px-2 py-2.5 text-center ring-1 ring-inset ring-done/50"><div class="text-sm font-semibold text-done-quiet">${time(i)}</div><div class="text-[11px] text-done-quiet">yours</div></div>`;

const desk = (disabled = false) =>
  `<div>${header("2 of 8 slots open")}${GRID}${free(0, disabled)}${tooClose(1)}${taken(2)}${tooClose(3)}${tooClose(4)}${yours(5)}${tooClose(6)}${free(7, disabled)}</div></div>`;

function picker(extra: Partial<Parameters<typeof SlotPicker>[0]> = {}) {
  return renderToStaticMarkup(<SlotPicker panel={panel} requests={requests} teams={teams} teamId="tt" onPick={noop} {...extra} />);
}

test("the queue desk's SlotPicker renders exactly what it always has", () => {
  assert.equal(picker(), desk());
  assert.equal(picker({ disabled: true }), desk(true));
});

test("its empty states are unchanged too: no slots set up, and every slot gone", () => {
  assert.equal(
    renderToStaticMarkup(<SlotPicker panel={{ ...panel, slot_start_at: null, slot_count: 0 }} requests={[]} teams={teams} teamId={null} onPick={noop} />),
    '<div class="rounded-xl bg-caution/12 px-4 py-3 text-sm text-caution-quiet ring-1 ring-inset ring-caution/35"><strong>Panel 1 has no bookable times set up yet.</strong><p class="mt-1 text-caution-quiet/80">Use <strong>Interview now</strong> instead, or ask the Judge Advisor to add times: Admin → Panels → Panel 1 → Booking slots.</p></div>',
  );
  const past = (i: number) => new Date(Date.parse("2000-01-01T10:00:00.000Z") + i * 10 * 60_000).toISOString();
  const markup = renderToStaticMarkup(<SlotPicker panel={{ ...panel, slot_start_at: past(0), slot_count: 2 }} requests={[]} teams={teams} teamId={null} onPick={noop} />);
  assert.equal(
    markup,
    `<div>${header("No slots left today — the rest have already passed")}${GRID}` +
      `<div class="rounded-xl bg-surface px-2 py-2.5 text-center ring-1 ring-inset ring-line"><div class="text-sm text-ink-faint line-through">${formatClock(past(0))}</div><div class="text-[11px] text-ink-faint">gone</div></div>` +
      `<div class="rounded-xl bg-surface px-2 py-2.5 text-center ring-1 ring-inset ring-line"><div class="text-sm text-ink-faint line-through">${formatClock(past(1))}</div><div class="text-[11px] text-ink-faint">gone</div></div></div></div>`,
  );
});

test("the busy line keeps its colours on the desk, and drops them only when asked", () => {
  const free = { waiting: 0, interviewing: 0, longestWait: 0 };
  const busy = { waiting: 2, interviewing: 1, longestWait: 6 };
  assert.equal(renderToStaticMarkup(<PanelBusyLine load={free} />), '<span class="text-done-quiet">Panel is free right now</span>');
  assert.equal(renderToStaticMarkup(<PanelBusyLine load={busy} />), '<span class="text-caution-quiet">1 in interview · 2 already waiting (longest 6 min)</span>');
  assert.equal(renderToStaticMarkup(<PanelBusyLine load={free} plain />), "<span>Panel is free right now</span>");
  assert.equal(renderToStaticMarkup(<PanelBusyLine load={busy} plain />), "<span>1 in interview · 2 already waiting (longest 6 min)</span>");
});

test("the queue page does not ask for the team variant or the plain busy line", () => {
  const queue = read("src/app/queue/page.tsx");
  const pickers = [...queue.matchAll(/<SlotPicker[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.equal(pickers.length, 2, "the desk draws a picker for a new booking and for a reschedule");
  for (const jsx of pickers) assert.doesNotMatch(jsx, /variant/, "the desk's picker is the default one");
  for (const jsx of queue.match(/<PanelBusyLine[^>]*>/g) ?? []) assert.doesNotMatch(jsx, /plain/);
});

/* ---- the team variant --------------------------------------------------------------- */

const tiles = (markup: string) =>
  [...markup.matchAll(/<button type="button" class="(tp-slot[^"]*)"( disabled="")?( title="[^"]*")?[^>]*><b>([^<]*)<\/b><small>([^<]*)<\/small><\/button>/g)].map((m) => ({
    cls: m[1], disabled: Boolean(m[2]), title: m[3]?.slice(8, -1), time: m[4], label: m[5],
  }));

test("team variant: the same five cases in the same order, as buttons", () => {
  const m = picker({ variant: "team" });
  assert.deepEqual(
    tiles(m).map((t) => [t.time, t.label, t.disabled]),
    [[time(0), "Open", false], [time(1), "Too close", true], [time(2), "Taken", true], [time(3), "Too close", true], [time(4), "Too close", true], [time(5), "Yours", true], [time(6), "Too close", true], [time(7), "Open", false]],
  );
  assert.deepEqual(tiles(m).map((t) => t.cls), ["tp-slot", "tp-slot tp-slot--off", "tp-slot tp-slot--off", "tp-slot tp-slot--off", "tp-slot tp-slot--off", "tp-slot tp-slot--off tp-slot--mine", "tp-slot tp-slot--off", "tp-slot"]);
  assert.equal(tiles(m)[1].title, TOO_CLOSE, "a blocked slot keeps its existing title");
  assert.equal(tiles(m)[2].title, "Taken by team 1111A — Scheduled");
  assert.match(m, /<div class="tp-slots" role="group" aria-label="Times with Panel 1, 10 minutes each">/);
  assert.doesNotMatch(m, /rounded-xl|text-center|slots open/, "none of the desk's markup, legend or count line");
});

test("team variant: a slot that is over is 'Gone', not taken", () => {
  const pastPanel = { ...panel, slot_start_at: "2000-01-01T10:00:00.000Z", slot_count: 2 };
  const m = renderToStaticMarkup(<SlotPicker variant="team" panel={pastPanel} requests={[]} teams={teams} teamId={null} onPick={noop} />);
  assert.deepEqual(tiles(m).map((t) => t.label), ["Gone", "Gone"]);
});

test("team variant: busy disables the open slots but does not dress them as taken", () => {
  const t = tiles(picker({ variant: "team", disabled: true }));
  assert.deepEqual(t.filter((x) => x.label === "Open").map((x) => [x.disabled, x.cls]), [[true, "tp-slot"], [true, "tp-slot"]]);
});

test("team variant: when nothing is left it says why, in SlotPicker's own words", () => {
  const all = [0, 1].map((i) => held(`h${i}`, "ta", "scheduled", i));
  const m = renderToStaticMarkup(<SlotPicker variant="team" panel={{ ...panel, slot_count: 2 }} requests={all} teams={teams} teamId="tt" onPick={noop} />);
  assert.match(m, /<p class="tp-slots-note">All 2 slots are taken — nothing left to book<\/p>/);
  assert.deepEqual(tiles(m).map((t) => t.label), ["Taken", "Taken"]);
});

test("team variant: no slots set up keeps the 'Interview now' message", () => {
  const m = renderToStaticMarkup(<SlotPicker variant="team" panel={{ ...panel, slot_start_at: null, slot_count: 0 }} requests={[]} teams={teams} teamId={null} onPick={noop} />);
  assert.equal(m, '<div class="tp-slots-none"><strong>Panel 1 has no bookable times set up yet.</strong><p>Use <strong>Interview now</strong> instead, or ask the Judge Advisor to add times: Admin → Panels → Panel 1 → Booking slots.</p></div>');
});

test("the team page asks for the variant and the picker's own rules still decide the tiles", () => {
  const view = read("src/components/team/TeamView.tsx");
  assert.match(view, /<SlotPicker\s+variant="team"/);
  assert.match(view, /onPick=\{\(slot\) => p\.onBook\(slot, language\)\}/);
  const picker = read("src/components/SlotPicker.tsx");
  assert.ok(picker.includes("buildSlots(panel, requests, teams, excludeRequestId)"), "the slots still come from buildSlots");
});
