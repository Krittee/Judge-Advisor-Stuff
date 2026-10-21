import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { formatClock } from "../src/components/ui";
import { BoardView } from "../src/components/board/BoardView";
import type { AppState, PublicPanel, RequestRow, Team } from "../src/lib/types";

/* The Live board, rendered to markup: the waiting block, the wide requesting
   tile, Hide completed, no motion, the empty roster. The order and the marker
   are board.logic.test.mjs; the pit floor is pitMap.runtime.test.tsx. */

const NOW = Date.now();
const ago = (mins: number) => new Date(NOW - mins * 60_000 - 5_000).toISOString();
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
const noop = () => {};

const categories = [
  { id: "developing", label: "Developing", color: "amber", excludesRubrics: [] },
  { id: "fully-developed", label: "Fully Developed", color: "violet", excludesRubrics: [] },
  { id: "ungraded", label: "Ungraded", color: "zinc", excludesRubrics: [] },
];

const team = (number: string, over: Partial<Team> = {}): Team => ({
  id: `t-${number}`, number, name: `Team ${number}`, panel_id: "p1", division: "Middle School",
  category: "developing", pit: null, created_at: "2026-10-20T08:00:00Z", ...over,
});

const panel: PublicPanel = {
  id: "p1", name: "Panel 1", division: "Middle School", judges: ["Dana Ruiz", "Chris Lin"], languages: [],
  sort_order: 1, slot_start_at: null, slot_minutes: 20, slot_count: 0,
};

const req = (teamNumber: string, over: Partial<RequestRow>): RequestRow => ({
  id: `r-${teamNumber}`, team_id: `t-${teamNumber}`, panel_id: "p1", status: "requested", kind: "queue", language: "en",
  slot_start: null, slot_end: null, message: null, created_by: null, acknowledged_by: null, interviewer: null, outcome: null,
  requested_at: ago(11), acknowledged_at: null, started_at: null, finished_at: null, cancelled_at: null, updated_at: ago(11), ...over,
});

function appState(teams: Team[], requests: RequestRow[], panels: PublicPanel[] = [panel]): AppState {
  return {
    panels, teams, requests, divisions: ["Elementary School", "Middle School"], categories,
    pitFloor: { columns: "left-to-right", rows: "top-to-bottom" },
    viewer: { role: "team" },
  } as unknown as AppState;
}

function board(state: AppState, over: { hideDone?: boolean; view?: "queue" | "pits"; online?: boolean } = {}) {
  return renderToStaticMarkup(
    <BoardView
      state={state}
      online={over.online ?? true}
      view={over.view ?? "queue"}
      hideDone={over.hideDone ?? false}
      onView={noop}
      onHideDone={noop}
    />,
  );
}

const day = appState(
  [team("1101"), team("9882K"), team("5090Z"), team("2742P"), team("1307"), team("3821")],
  [
    req("1101", { status: "requested", requested_at: ago(11) }),
    req("9882K", { status: "requested", requested_at: ago(1) }),
    req("5090Z", { status: "interviewing", started_at: ago(9) }),
    req("2742P", { status: "scheduled", kind: "slot", slot_start: "2099-01-01T12:40:00.000Z" }),
    req("1307", { status: "completed", finished_at: ago(30) }),
  ],
);

test("a requesting tile is wide, shows the wait as '11 min', and comes first", () => {
  const markup = board(day);
  assert.match(markup, /<li class="bd-tile bd-s-req bd-tile--big/);
  assert.match(text(markup), /11 min/);
  assert.match(text(markup), /1 min/);
  assert.ok(markup.indexOf("1101") < markup.indexOf("9882K"), "the longest wait comes first");
  assert.ok(markup.indexOf("9882K") < markup.indexOf("5090Z"), "requesting comes before interviewing");
  assert.ok(markup.indexOf("5090Z") < markup.indexOf("2742P"), "interviewing comes before booked");
  assert.ok(markup.indexOf("2742P") < markup.indexOf("3821"), "booked comes before not yet");
  assert.ok(markup.indexOf("3821") < markup.indexOf("1307"), "not yet comes before complete");
});

test("the waiting block shows the count; at zero it reads 'Nobody waiting'", () => {
  assert.match(board(day), /<p class="bd-wait"><b>2<\/b><span>waiting for a judge<\/span><\/p>/);
  const quiet = board(appState([team("1307")], [req("1307", { status: "completed" })]));
  assert.match(quiet, /<p class="bd-wait bd-wait--none">Nobody waiting<\/p>/);
  assert.doesNotMatch(text(quiet), /waiting for a judge/);
});

test("the tallies count interviews and completions", () => {
  assert.match(board(day), /<li class="bd-t-int"><b>1<\/b><span>in interview<\/span><\/li><li class="bd-t-done"><b>1<\/b><span>complete<\/span><\/li>/);
});

test("Hide completed removes complete tiles and leaves the rest", () => {
  assert.match(board(day), /1307/);
  const hidden = board(day, { hideDone: true });
  assert.doesNotMatch(hidden, /1307/);
  assert.match(hidden, /1101/);
  assert.match(hidden, /5 of 6 teams|5 of 6/);
});

test("each team once, with its status word, the booked clock time and the notebook marker", () => {
  const markup = board(day);
  for (const n of ["1101", "9882K", "5090Z", "2742P", "1307", "3821"]) {
    assert.equal((markup.match(new RegExp(`<span class="bd-n">${n}</span>`, "g")) ?? []).length, 1, `${n} is not drawn exactly once`);
  }
  assert.match(markup, /Interviewing/);
  assert.match(markup, /Booked/);
  assert.match(markup, /Not yet/);
  assert.match(markup, /Complete/);
  assert.match(markup, /Requesting a judge/);
  assert.match(markup, /role="img" aria-label="Developing"/);
  assert.match(markup, /bd-nb--d/, "Developing is the half marker");
});

test("teams with no panel are an Unassigned group; the panel names its division and judges", () => {
  const markup = board(appState([team("3007", { panel_id: null }), team("1101")], []));
  assert.match(markup, /<h2 id="bd-pn-unassigned">Unassigned<\/h2>/);
  assert.match(markup, /No panel yet/);
  assert.match(text(markup), /Dana Ruiz · Chris Lin/);
  assert.match(text(markup), /Middle School/);
  assert.match(text(markup), /1 team/);
});

test("a panel with no judges says NA", () => {
  assert.match(board(appState([team("1101")], [], [{ ...panel, judges: [] }])), /<span class="bd-na">NA<\/span>/);
});

test("a 6-character number carries --num-len so it fits its tile", () => {
  const markup = board(appState([team("33445B")], [req("33445B", { status: "interviewing", started_at: ago(4) })]));
  assert.match(markup, /--num-len:6/);
});

test("the empty roster says so", () => {
  const markup = board(appState([], [], []));
  assert.match(markup, /No teams imported yet\. Sign in as Judge Advisor to add them\./);
  assert.doesNotMatch(board(day), /No teams imported yet/);
});

test("the toggle is a real button group with aria-pressed, and the view follows it", () => {
  const queue = board(day);
  assert.match(queue, /<div class="bd-seg" role="group" aria-label="Board view"><button type="button" aria-pressed="true">By panel<\/button><button type="button" aria-pressed="false">Pit floor<\/button>/);
  const pits = board(day, { view: "pits" });
  assert.match(pits, /aria-pressed="true">Pit floor/);
  assert.doesNotMatch(pits, /bd-panel/);
});

test("Fullscreen and the theme toggle are there; console links are staff-only", () => {
  const markup = board(day);
  assert.match(text(markup), /Fullscreen/);
  assert.match(markup, /class="theme-toggle"/);
  assert.doesNotMatch(markup, /aria-label="Switch view"/, "a team sees no console links");
  const admin = renderToStaticMarkup(
    <BoardView
      state={{ ...day, viewer: { ...day.viewer, role: "admin" } }}
      online
      view="queue"
      hideDone={false}
      onView={noop}
      onHideDone={noop}
    />,
  );
  assert.match(admin, /aria-label="Switch view"/);
});

test("the key names the statuses, the three markers and the divisions", () => {
  const key = board(day);
  for (const label of ["Requesting a judge", "Judges on the way", "Booked slot", "Not yet in the queue", "Fully Developed", "Developing", "Ungraded", "Elementary School"]) {
    assert.ok(key.includes(label), `the key is missing ${label}`);
  }
});

test("no motion: no pulse-waiting or animation anywhere, even for a slot that is due now, or offline", () => {
  const due = appState(
    [team("2742P"), team("1101")],
    [
      req("2742P", { status: "scheduled", kind: "slot", slot_start: new Date(NOW - 5 * 60_000).toISOString() }),
      req("1101", { status: "requested" }),
    ],
  );
  for (const markup of [board(due), board(day), board(due, { online: false }), board(due, { view: "pits" })]) {
    assert.doesNotMatch(markup, /pulse-waiting|animate|animation/);
  }
  assert.match(board(due), /bd-live--off|Live/);
  assert.match(board(due, { online: false }), /Reconnecting/);
});

test("a booked tile's reserve for its clock leaves the number its full phone size", () => {
  // Team 1157 booked for 9:20 PM. The reserve is a count of characters of the time's own font size
  // (--bd-tf: 15px on a phone), so it cannot outgrow the tile the way a 1920-wide pixel figure did.
  const slot = new Date(2099, 0, 1, 21, 20).toISOString();
  const markup = board(appState([team("1157")], [req("1157", { status: "scheduled", kind: "slot", slot_start: slot })]));
  const rc = Number(/--bd-rc:(\d+)/.exec(markup)?.[1]);
  assert.equal(rc, formatClock(slot).length + 1);
  // A phone live tile spans two of four columns of a 343px page: 168px, less 20px padding and 2px border.
  const content = (343 - 3 * 6) / 4 * 2 + 6 - 22;
  const room = (content - rc * 0.55 * 15) / (4 * 0.62);
  assert.ok(room >= 22, `the number would shrink to ${room.toFixed(1)}px, below the 22px other live tiles keep on a phone`);
  // 5- and 6-character numbers beside the same clock stay legible too.
  assert.ok((content - rc * 0.55 * 15) / (6 * 0.62) >= 18);
});
