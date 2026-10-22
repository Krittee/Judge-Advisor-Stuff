import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { PanelBusyLine, SlotPicker } from "../src/components/SlotPicker";
import { formatClock } from "../src/components/ui";
import type { PublicPanel, RequestRow, Team } from "../src/lib/types";

/* SlotPicker is the team page's picker (tiles styled under .teampage); the queue
   desk draws its own grid (components/desk/DeskSlots.tsx, deskGrid.runtime.test.tsx).
   PanelBusyLine is plain text: the team page shows it on a status panel. */

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

const TOO_CLOSE = "Too close to another team&#x27;s booking on this panel — judges need 20 minutes to walk between interviews";

function picker(extra: Partial<Parameters<typeof SlotPicker>[0]> = {}) {
  return renderToStaticMarkup(<SlotPicker panel={panel} requests={requests} teams={teams} teamId="tt" onPick={noop} {...extra} />);
}

test("the busy line is plain text, with no colour of its own", () => {
  const free = { waiting: 0, interviewing: 0, longestWait: 0 };
  const busy = { waiting: 2, interviewing: 1, longestWait: 6 };
  assert.equal(renderToStaticMarkup(<PanelBusyLine load={free} />), "<span>Panel is free right now</span>");
  assert.equal(renderToStaticMarkup(<PanelBusyLine load={busy} />), "<span>1 in interview · 2 already waiting (longest 6 min)</span>");
});

test("the queue desk no longer draws SlotPicker or the busy line: it has its own grid", () => {
  const queue = (read("src/app/queue/page.tsx") + read("src/components/desk/DeskView.tsx")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(queue, /<SlotPicker|PanelBusyLine/);
  const picker = read("src/components/SlotPicker.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(picker, /SlotButton|Legend|variant|plain/, "the desk's default branch is gone");
});

/* ---- the team variant --------------------------------------------------------------- */

const tiles = (markup: string) =>
  [...markup.matchAll(/<button type="button" class="(tp-slot[^"]*)"( disabled="")?( title="[^"]*")?[^>]*><b>([^<]*)<\/b><small>([^<]*)<\/small><\/button>/g)].map((m) => ({
    cls: m[1], disabled: Boolean(m[2]), title: m[3]?.slice(8, -1), time: m[4], label: m[5],
  }));

test("team tiles: the same five cases in the same order, as buttons", () => {
  const m = picker();
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

test("team tiles: a slot that is over is 'Gone', not taken", () => {
  const pastPanel = { ...panel, slot_start_at: "2000-01-01T10:00:00.000Z", slot_count: 2 };
  const m = renderToStaticMarkup(<SlotPicker panel={pastPanel} requests={[]} teams={teams} teamId={null} onPick={noop} />);
  assert.deepEqual(tiles(m).map((t) => t.label), ["Gone", "Gone"]);
});

test("team tiles: busy disables the open slots but does not dress them as taken", () => {
  const t = tiles(picker({ disabled: true }));
  assert.deepEqual(t.filter((x) => x.label === "Open").map((x) => [x.disabled, x.cls]), [[true, "tp-slot"], [true, "tp-slot"]]);
});

test("team tiles: when nothing is left it says why, in SlotPicker's own words", () => {
  const all = [0, 1].map((i) => held(`h${i}`, "ta", "scheduled", i));
  const m = renderToStaticMarkup(<SlotPicker panel={{ ...panel, slot_count: 2 }} requests={all} teams={teams} teamId="tt" onPick={noop} />);
  assert.match(m, /<p class="tp-slots-note">All 2 slots are taken — nothing left to book<\/p>/);
  assert.deepEqual(tiles(m).map((t) => t.label), ["Taken", "Taken"]);
});

test("team tiles: no slots set up says so plainly, with no staff wording", () => {
  const m = renderToStaticMarkup(<SlotPicker panel={{ ...panel, slot_start_at: null, slot_count: 0 }} requests={[]} teams={teams} teamId={null} onPick={noop} />);
  assert.equal(m, '<p class="tp-slots-none">No times to book with Panel 1. Ask for a judge now instead.</p>');
});

test("the team page draws the picker and the picker's own rules still decide the tiles", () => {
  const view = read("src/components/team/TeamView.tsx");
  assert.match(view, /<SlotPicker\s+panel=/);
  assert.match(view, /onPick=\{\(slot\) => p\.onBook\(slot, language\)\}/);
  const picker = read("src/components/SlotPicker.tsx");
  assert.ok(picker.includes("buildSlots(panel, requests, teams, excludeRequestId)"), "the slots still come from buildSlots");
});
