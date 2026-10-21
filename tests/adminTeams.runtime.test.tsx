import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { EventDataPanel } from "../src/components/admin/EventData";
import { pillClass } from "../src/components/admin/refereeLogic";
import { TeamsBoard, TeamsTab } from "../src/components/admin/TeamsTab";
import { startDraft, type TeamDraft } from "../src/components/admin/teamsLogic";
import type { AppState, ConflictRow, FlagRow, JudgeRow, PublicPanel, RequestRow, Team } from "../src/lib/types";

/* The Judge Advisor Teams tab, rendered to markup. Behaviour that needs a
   browser (the drawer opening on a click, the sheet, Escape) has no DOM
   harness here; the decisions behind it run as plain functions in
   adminTeams.logic.test.mjs and the wiring is read from source at the foot. */

const noop = () => {};
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");

const panel = (n: number, division: string): PublicPanel => ({
  id: `p${n}`, name: `Panel ${n}`, division, judges: [], languages: ["en"], sort_order: n, slot_start_at: null, slot_minutes: 20, slot_count: 0,
});
const panels = [panel(1, "High School"), panel(2, "Middle School"), panel(3, "Middle School"), panel(4, "Elementary School")];
const judge = (id: string, panel_id: string | null): JudgeRow => ({ id, name: id, note: null, panel_id, created_at: "2026-10-20T08:00:00Z" });
const roster = [judge("j2", "p2"), judge("j3", "p3")];

const team = (number: string, name: string, over: Partial<Team> = {}): Team => ({
  id: `t-${number}`, number, name, panel_id: null, division: "Middle School", category: "developing", pit: null, created_at: "2026-10-20T08:00:00Z", ...over,
});
// The Teams mock, as data.
const titans = team("9882K", "Torque Titans", { panel_id: "p2", pit: "B4" });
const byteMe = team("7700B", "Byte Me", { pit: "C2" });
const sparky = team("5150Z", "Sparky", { pit: "C7", category: "fully-developed" });
const gremlins = team("2011A", "Gear Gremlins", { panel_id: "p2", pit: "A3" });
const rangers = team("4410C", "Robo Rangers", { panel_id: "p2", pit: "A9", category: "ungraded" });
const pi = team("3141P", "Pi Squad", { panel_id: "p1", division: "High School", pit: "D1" });
const teams = [titans, byteMe, sparky, gremlins, rangers, pi];

const conflict = (id: string, judge_id: string, t: Team): ConflictRow => ({
  id, panel_id: null, judge_id, team_id: t.id, judge_name: null, note: null, declared_by: "admin:Alex", created_at: "2026-10-20T09:00:00Z",
});
// Sparky may meet neither Middle School panel; Byte Me may not meet Panel 3.
const conflicts = [conflict("c1", "j2", sparky), conflict("c2", "j3", sparky), conflict("c3", "j3", byteMe)];

const request = (t: Team, status: RequestRow["status"], over: Partial<RequestRow> = {}): RequestRow =>
  ({ id: `r-${t.number}`, team_id: t.id, panel_id: t.panel_id, status, kind: "queue", slot_start: null, ...over }) as RequestRow;
const requests = [
  request(titans, "requested"),
  request(gremlins, "interviewing"),
  request(rangers, "scheduled", { kind: "slot", slot_start: "2026-10-20T11:00:00.000Z" }),
];

const flagKinds = [
  { id: "good", label: "Good conduct", short: "Good", color: "emerald", severity: 0, requiresRule: false },
  { id: "warning", label: "Warning", short: "Warning", color: "amber", severity: 1, requiresRule: false },
  { id: "minor", label: "Minor violation", short: "Minor", color: "orange", severity: 2, requiresRule: true },
  { id: "dq", label: "Disqualified", short: "DQ", color: "black", severity: 4, requiresRule: true },
];
let n = 0;
const flag = (t: Team, kind: string): FlagRow => ({
  id: `f${++n}`, team_id: t.id, kind, body: "", author: "Jordan Lee", match_type: "Q", match_number: "1", field: "1", rule: null,
  ruleset: "v5rc", manual_version: null, match_affecting: false, created_at: "2026-10-20T10:00:00.000Z",
});
const flags = [flag(titans, "warning"), flag(titans, "minor"), flag(pi, "dq")];

const slice = {
  teams,
  panels,
  requests,
  conflicts,
  judges: roster,
  flags,
  flagKinds,
  divisions: ["High School", "Middle School", "Elementary School"],
  categories: [
    { id: "developing", label: "Developing", color: "sky" },
    { id: "fully-developed", label: "Fully Developed", color: "emerald" },
    { id: "ungraded", label: "Ungraded", color: "zinc" },
  ],
} as unknown as AppState;

function board(
  over: {
    wide?: boolean;
    picked?: Team | null;
    draft?: Partial<TeamDraft>;
    q?: string;
    division?: string;
    category?: string;
    state?: Partial<AppState>;
    filtersOpen?: boolean;
    error?: string | null;
  } = {},
) {
  const picked = over.picked ?? null;
  return renderToStaticMarkup(
    <TeamsBoard
      state={{ ...slice, ...over.state }}
      wide={over.wide ?? true}
      filters={{ q: over.q ?? "", division: over.division ?? "", category: over.category ?? "" }}
      onFilters={noop}
      filtersOpen={over.filtersOpen}
      onFiltersOpen={noop}
      perPanel={12}
      onPerPanel={noop}
      onAutoAssign={noop}
      pickedId={picked?.id ?? null}
      onPick={noop}
      draft={picked ? { ...startDraft(picked), ...over.draft } : null}
      onDraft={noop}
      error={over.error}
      onSave={noop}
      onClose={noop}
      onResetStatus={noop}
      onRemove={noop}
      onOpenFlags={noop}
    />,
  );
}
const rowOf = (markup: string, number: string) => markup.match(new RegExp(`<tr[^>]*>(?:(?!</tr>)[\\s\\S])*?>${number}</button>[\\s\\S]*?</tr>`))?.[0] ?? "";
const drawer = (markup: string) => markup.match(/<aside class="ja-tm-dr"[\s\S]*?<\/aside>/)?.[0] ?? "";
const sheet = (markup: string) => markup.match(/<dialog class="ja-sheet ja-tm-sheet"[\s\S]*?<\/dialog>/)?.[0] ?? "";
const selectOf = (markup: string, id: string) => markup.match(new RegExp(`<select id="[^"]*-${id}"[\\s\\S]*?</select>`))?.[0] ?? "";
const optionsOf = (select: string) => [...select.matchAll(/<option value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)].map((m) => [m[1], text(m[2])]);

/* ---- the table ---------------------------------------------------------------------------- */

test("the table has the mock's nine columns, and every row is a button that names the team", () => {
  const m = board();
  assert.match(m, /<caption class="sr-only">Teams<\/caption>/);
  assert.deepEqual(
    [...m.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/g)].map((x) => x[1]),
    ["Team", "Name", "Pit", "Notebook", "Div", "Panel", "Booked", "Interview", "Flags"],
  );
  for (const t of teams) {
    assert.match(m, new RegExp(`<button type="button" class="ja-tm-rb" aria-label="Edit ${t.number} ${t.name}">${t.number}</button>`));
  }
  assert.doesNotMatch(m, /<aside/, "no team picked: no drawer");
  assert.doesNotMatch(m, /aria-current="true"/);
});

test("a row carries pit, notebook, division, panel, booked time, status pill and flag pills in severity colours", () => {
  const m = board();
  const row = rowOf(m, "9882K");
  assert.match(text(row), /9882KTorque TitansB4DevelopingMSPanel 2—RequestingMinor ×1Warning ×1/);
  assert.match(row, /<span class="jg-sc jg-s-requested">Requesting<\/span>/);
  // The Referee tab's pill, not caution: each severity wears the colours the config gives it.
  assert.ok(row.includes(`class="ja-sp ${pillClass("orange")}"`), "Minor is the config's orange");
  assert.ok(row.includes(`class="ja-sp ${pillClass("amber")}"`));
  assert.ok(rowOf(m, "3141P").includes(`class="ja-sp ${pillClass("black")}" title="Disqualified">DQ ×1</span>`));
  // A booked slot shows its time and the Booked pill; a team with nothing shows dashes.
  assert.match(rowOf(m, "4410C"), /ja-tm-bk">\d{1,2}:\d{2}[^<]*<\/span>[\s\S]*jg-s-scheduled">Booked/);
  assert.match(text(rowOf(m, "5150Z")), /5150ZSparkyC7Fully DevelopedMS/);
  assert.doesNotMatch(rowOf(m, "5150Z"), /jg-sc|ja-sp/);
});

test("Panel shows the panel, a caution 'Unassigned' pill, or a danger 'no panel left' pill", () => {
  const m = board();
  assert.match(rowOf(m, "9882K"), /<td>Panel 2<\/td>/);
  assert.match(rowOf(m, "7700B"), /<span class="ja-pill">Unassigned<\/span>/, "Panel 2 is still open to Byte Me");
  assert.match(rowOf(m, "5150Z"), /<span class="ja-tm-dp">no panel left<\/span>/, "both Middle School panels are blocked from Sparky");
  assert.doesNotMatch(rowOf(m, "5150Z"), /Unassigned/);
  assert.doesNotMatch(m.replace(rowOf(m, "5150Z"), ""), /no panel left/, "only the stranded team");
});

test("the selected row has aria-current and the accent tint class; nothing else does", () => {
  const m = board({ picked: titans });
  assert.match(m, /<tr class="ja-tm-sel">/);
  assert.equal(m.match(/aria-current="true"/g)?.length, 1, "only the row's button");
  assert.match(rowOf(m, "9882K"), /aria-current="true"/);
  assert.doesNotMatch(rowOf(m, "7700B"), /aria-current/);
});

test("no team matches: the empty state points at Import", () => {
  const m = board({ q: "zzzz" });
  assert.match(m, /No teams match\. Use the Import tab to add your roster\./);
  assert.doesNotMatch(m, /<table/);
});

/* ---- the toolbar -------------------------------------------------------------------------- */

test("filter box, Division and Notebook selects, Max per panel 1-40 and the helper line", () => {
  const m = board();
  assert.match(m, /<input id="[^"]*-q" class="ja-in" type="text" autoComplete="off" placeholder="Filter by number or name" value=""/);
  assert.deepEqual(optionsOf(selectOf(m, "dv")), [["", "All divisions"], ["High School", "High School"], ["Middle School", "Middle School"], ["Elementary School", "Elementary School"]]);
  assert.deepEqual(optionsOf(selectOf(m, "nb")).map((o) => o[1]), ["All notebooks", "Developing", "Fully Developed", "Ungraded"]);
  assert.match(m, /type="number" min="1" max="40" value="12"/);
  assert.match(m, /Select a team to edit its number, name, pit, panel and notebook\./);
  assert.match(text(m), /6 teams · 4 panels/);
});

test("auto-assign counts the filtered unassigned teams and is disabled at 0", () => {
  const button = (markup: string) => markup.match(/<button[^>]*class="ja-tm-ghost"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  // Byte Me and Sparky have no panel.
  assert.match(button(board()), /Auto-assign 2 unassigned/);
  assert.doesNotMatch(button(board()), /disabled/);
  assert.match(button(board()), /title="Assigns within each division and skips conflicted panels\."/);
  assert.match(button(board({ division: "High School" })), /Auto-assign 0 unassigned/);
  assert.match(button(board({ division: "High School" })), /disabled/);
});

test("notebook count chips, per-panel load chips, and Unassigned N in caution", () => {
  const m = board();
  const notebook = m.match(/<div class="ja-tm-chr" role="group" aria-label="Notebook counts">[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(text(notebook), /NotebookDeveloping4Fully Developed1Ungraded1/);
  const load = m.match(/<div class="ja-tm-chr" role="group" aria-label="Panel load">[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(text(load), /PanelsPanel 1 · HS · 1Panel 2 · MS · 3Panel 3 · MS · 0Panel 4 · ES · 0Unassigned2/);
  assert.match(load, /<span class="ja-tm-ch ja-tm-un">Unassigned<b>2<\/b><\/span>/);
  // A division narrows the panel chips; nothing unassigned, no warning chip.
  const high = board({ division: "High School" });
  assert.doesNotMatch(high, /ja-tm-un/);
  assert.doesNotMatch(text(high.match(/aria-label="Panel load">[\s\S]*?<\/div>/)?.[0] ?? ""), /Panel 2/);
});

/* ---- the drawer --------------------------------------------------------------------------- */

test("picking a row opens the drawer, titled 'Edit team · number name', beside the table", () => {
  const m = board({ picked: titans });
  const d = drawer(m);
  assert.ok(d, "a drawer");
  assert.match(d, /aria-label="Edit team · 9882K Torque Titans"/);
  assert.match(d, /<p class="ja-sec">Edit team<\/p><h2><b>9882K<\/b><span>Torque Titans<\/span><\/h2>/);
  assert.match(d, /aria-label="Close team drawer"/);
  assert.ok(m.indexOf('class="ja-tm-main"') < m.indexOf(d), "the table is still there, the drawer beside it");
  assert.match(m, /<table/);
});

test("the drawer edits number, pit, name, division, notebook and panel, and shows the booked time read-only", () => {
  const d = drawer(board({ picked: rangers }));
  assert.match(d, /<label class="ja-lab" for="[^"]*-num">Team number<\/label><input id="[^"]*-num" class="ja-in" type="text"[^>]* value="4410C"/);
  assert.match(d, /<label class="ja-lab" for="[^"]*-pit">Pit<\/label><input[^>]* value="A9"/);
  assert.match(d, /<label class="ja-lab" for="[^"]*-name">Name<\/label><input[^>]* value="Robo Rangers"/);
  assert.match(d, /Pits read as a letter and a number \(A1\), which places a team on the board&#x27;s floor plan\./);
  // Division is a select of the configured divisions, on the team's own.
  assert.match(d, /<label class="ja-lab" for="[^"]*-division">Division<\/label>/);
  const dv = selectOf(d, "division");
  assert.deepEqual(optionsOf(dv).map((o) => o[1]), ["High School", "Middle School", "Elementary School"]);
  assert.match(dv, /<option value="Middle School" selected="">Middle School<\/option>/);
  assert.match(d, /<span class="ja-lab">Booked<\/span><span class="ja-tm-bk">\d{1,2}:\d{2}/);
  const nb = selectOf(d, "category");
  assert.deepEqual(optionsOf(nb).map((o) => o[1]), ["Developing", "Fully Developed", "Ungraded"]);
  assert.match(nb, /<option value="ungraded" selected="">Ungraded<\/option>/);
});

test("the panel select hides blocked panels and other divisions' panels, and offers '— none —'", () => {
  // Byte Me (Middle School): Panel 1 is High School, Panel 4 Elementary, Panel 3 has a conflicted judge.
  const byteOptions = optionsOf(selectOf(drawer(board({ picked: byteMe })), "pn"));
  assert.deepEqual(byteOptions, [["", "— none —"], ["p2", "Panel 2"]]);
  assert.match(drawer(board({ picked: byteMe })), /MS panels without a conflict/);
  // Sparky is blocked from both: nothing to pick but none.
  assert.deepEqual(optionsOf(selectOf(drawer(board({ picked: sparky })), "pn")), [["", "— none —"]]);
  // Pi Squad (High School) is offered Panel 1 only.
  assert.deepEqual(optionsOf(selectOf(drawer(board({ picked: pi })), "pn")), [["", "— none —"], ["p1", "Panel 1"]]);
  assert.match(drawer(board({ picked: pi })), /HS panels without a conflict/);
});

test("changing the division in the draft re-filters the panel select and its hint to the new division", () => {
  // Torque Titans (Middle School, Panel 2) being moved to High School: Panel 2 no longer fits, Panel 1 does.
  const d = drawer(board({ picked: titans, draft: { division: "High School" } }));
  assert.match(selectOf(d, "division"), /<option value="High School" selected="">High School<\/option>/);
  assert.deepEqual(optionsOf(selectOf(d, "pn")), [["", "— none —"], ["p1", "Panel 1"]]);
  assert.match(selectOf(d, "pn"), /<option value="" selected="">— none —<\/option>/, "the held panel is no longer shown as the choice");
  assert.match(d, /HS panels without a conflict/);
  assert.doesNotMatch(d, /MS panels without a conflict/);
  // Save is enabled by the division alone.
  assert.match(d, /<button type="submit" class="ja-prim">Save changes<\/button>/);
  // Moved back, it is as it was.
  assert.deepEqual(optionsOf(selectOf(drawer(board({ picked: titans, draft: { division: "Middle School" } })), "pn")).map((o) => o[0]), ["", "p2", "p3"]);
});

test("every id in the rendered markup is unique, and each label points at exactly one control (toolbar and drawer share a page)", () => {
  const views: [string, string][] = [
    ["wide, drawer open", board({ picked: titans })],
    ["wide, nothing picked", board()],
    ["phone, editor sheet open", board({ wide: false, picked: titans })],
    ["phone, filters sheet open", board({ wide: false, filtersOpen: true })],
  ];
  for (const [view, markup] of views) {
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(dupes, [], `${view}: duplicate ids`);
    for (const [, target] of markup.matchAll(/\sfor="([^"]+)"/g)) {
      assert.equal(ids.filter((id) => id === target).length, 1, `${view}: a label points at ${target}`);
    }
  }
  // The two Notebook selects in the wide layout are different controls with their own labels.
  const wide = board({ picked: titans });
  assert.match(selectOf(wide, "nb"), /All notebooks/);
  assert.match(selectOf(wide, "category"), /Fully Developed/);
});

test("the panel the team holds is selected, and says so if it is now conflicted", () => {
  const gone = board({ picked: titans, state: { conflicts: [conflict("c9", "j2", titans)] } });
  const select = selectOf(drawer(gone), "pn");
  assert.match(select, /<option value="p2" selected="">Panel 2 — conflicted<\/option>/);
  assert.deepEqual(optionsOf(select).map((o) => o[0]), ["", "p2", "p3"]);
});

test("Save changes is disabled until something is changed, and enabled once it is", () => {
  const save = (markup: string) => markup.match(/<button type="submit" class="ja-prim"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(save(drawer(board({ picked: titans }))), /disabled=""[^>]*>Save changes</);
  assert.match(save(drawer(board({ picked: titans, draft: { pit: "D1" } }))), /^<button type="submit" class="ja-prim">Save changes<\/button>$/);
  // Tidying alone is not a change.
  assert.match(save(drawer(board({ picked: titans, draft: { number: "9882k" } }))), /disabled=""/);
  // The server's refusal sits above the button.
  assert.match(drawer(board({ picked: titans, error: "Team 7700B already exists." })), /<p class="ja-err" role="alert">Team 7700B already exists\.<\/p><button type="submit"/);
});

test("Interview: the status pill, a labelled 'Reset to…' select with the five targets, and the caution box", () => {
  const d = drawer(board({ picked: titans }));
  assert.match(d, /<h3 class="ja-lab">Interview<\/h3>/);
  assert.match(d, /<span class="jg-sc jg-s-requested">Requesting<\/span>/);
  assert.match(d, /<label class="sr-only" for="[^"]*-rs">Reset interview status to<\/label>/);
  const rs = selectOf(d, "rs");
  assert.match(rs, /value=""/);
  assert.deepEqual(optionsOf(rs).map((o) => o[1]), ["Reset to…", "Requesting a judge", "Judges on their way", "Interview in progress", "Interview complete", "Cancelled"]);
  assert.match(d, /<div class="jg-caution" role="note">[\s\S]*Overrides what judges set\. Use when a status is stuck\./);
  // A team with no request has nothing to reset.
  const none = drawer(board({ picked: byteMe }));
  assert.doesNotMatch(none, /Reset to|Overrides what judges set/);
  assert.match(none, /No interview requested yet\./);
});

test("Flags: severity pills and 'Open in Referee' only when the team has flags", () => {
  const d = drawer(board({ picked: titans }));
  assert.match(d, /<h3 class="ja-lab">Flags<\/h3><div class="ja-tm-flr">/);
  assert.ok(d.includes(`class="ja-sp ${pillClass("orange")}"`) && d.includes(`class="ja-sp ${pillClass("amber")}"`));
  assert.match(d, /<button type="button" class="ja-tm-od">Open in Referee<svg/);
  const none = drawer(board({ picked: byteMe }));
  assert.doesNotMatch(none, /Open in Referee/);
  assert.match(none, /No flags recorded\./);
});

test("Remove team is a danger-quiet button with its hint; the drawer scrolls and Save is pinned below it", () => {
  const d = drawer(board({ picked: titans }));
  assert.match(d, /<button type="button" class="ja-tm-rmb"><svg[\s\S]*?<\/svg>Remove team<\/button><p class="ja-hint">Asks first\. Removes 9882K and all its requests\.<\/p>/);
  assert.ok(d.indexOf('class="ja-tm-drb"') < d.indexOf('class="ja-tm-drf"'), "Save is pinned under the scrolling fields");
});

/* ---- a phone ------------------------------------------------------------------------------ */

test("on a phone the rows are compact two-line buttons, and the roster is a list, not a table", () => {
  const m = board({ wide: false });
  assert.doesNotMatch(m, /<table/);
  assert.match(m, /<ul class="ja-tm-ll" aria-label="Teams">/);
  const row = m.match(/<button type="button" class="ja-tm-lrow" aria-label="Edit 9882K Torque Titans">[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(text(row), /9882KTorque TitansPit B4 · Developing · MS · Panel 2Requesting/);
  assert.match(row, /jg-s-requested/);
  assert.match(text(m.match(/aria-label="Edit 7700B Byte Me"[\s\S]*?<\/button>/)?.[0] ?? ""), /Pit C2 · Developing · MS · unassigned/);
  assert.match(text(m.match(/aria-label="Edit 5150Z Sparky"[\s\S]*?<\/button>/)?.[0] ?? ""), /Pit C7 · Fully Developed · MS · no panel left/);
});

test("a phone's Filters button carries a badge of how many selects are set; the selects live in a sheet", () => {
  const button = (markup: string) => markup.match(/<button type="button" class="ja-tm-fb"[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(button(board({ wide: false })), /aria-haspopup="dialog" aria-label="Filters">/);
  assert.doesNotMatch(button(board({ wide: false })), /ja-tm-fc|data-on/);
  const on = button(board({ wide: false, division: "Middle School", category: "ungraded" }));
  assert.match(on, /aria-label="Filters, 2 on" data-on="true"/);
  assert.match(on, /<span class="ja-tm-fc" aria-hidden="true">2<\/span>/);
  // Not on the toolbar: Division and Notebook are inside the (closed) sheet.
  assert.doesNotMatch(board({ wide: false }), /<select/);
  const open = board({ wide: false, filtersOpen: true, division: "Middle School" });
  assert.match(open, /<dialog class="ja-sheet ja-tm-fsheet"[\s\S]*<h2 id="[^"]*">Filters<\/h2>/);
  assert.deepEqual(optionsOf(selectOf(open, "dv")).map((o) => o[1]).slice(0, 2), ["All divisions", "High School"]);
  assert.match(open, /Show 5 teams/);
  assert.match(open, /Clear filters/);
});

test("on a phone the editor is a native dialog sheet, shut until a team is picked", () => {
  assert.match(sheet(board({ wide: false })), /^<dialog class="ja-sheet ja-tm-sheet" aria-modal="true" aria-labelledby="[^"]+"><\/dialog>$/);
  const open = sheet(board({ wide: false, picked: titans }));
  assert.match(open, /aria-labelledby="[^"]+"/);
  assert.match(open, /<div class="jg-grab" aria-hidden="true"><\/div>/);
  assert.match(open, /<h2 id="[^"]+"><span class="sr-only">Edit team · <\/span>9882K <span>Torque Titans<\/span><\/h2>/);
  assert.match(open, /<button type="button" class="ja-x" aria-label="Close">/);
  assert.match(open, /Remove team/);
  assert.match(open, /<button type="submit" class="ja-prim" disabled="">Save changes<\/button>/);
  assert.doesNotMatch(board({ wide: false, picked: titans }), /<aside/, "a sheet, not a drawer");
});

test("TeamsTab on a phone starts with the list, Filters, Event data closed and no editor", () => {
  const m = renderToStaticMarkup(<TeamsTab state={slice} refresh={async () => {}} onError={noop} onOpenFlags={noop} />);
  assert.match(m, /<ul class="ja-tm-ll"/);
  assert.match(m, /Auto-assign 2 unassigned/);
  assert.match(m, /<button type="button" class="ja-ev-b" aria-expanded="false"/);
  assert.doesNotMatch(m, /<aside|Save changes/);
});

/* ---- Event data --------------------------------------------------------------------------- */

const panelView = (over: Partial<Parameters<typeof EventDataPanel>[0]> = {}) =>
  renderToStaticMarkup(<EventDataPanel health={{ ok: true, storage: "postgres", location: "db.example.com", persistent: true }} open={false} onToggle={noop} onReset={noop} {...over} />);

test("Event data is closed by default: a summary row and nothing else", () => {
  const m = panelView();
  assert.match(m, /<button type="button" class="ja-ev-b" aria-expanded="false" aria-controls="[^"]+">[\s\S]*<span class="ja-ev-t">Event data<\/span><span class="ja-ev-s">Storage and resets<\/span>/);
  assert.doesNotMatch(m, /Danger zone|Reset the day|Wipe everything|Saved to/);
  assert.doesNotMatch(m, /data-down/);
  // And TeamsTab mounts it closed before storage has even answered.
  assert.match(panelView({ health: null }), /aria-expanded="false"/);
});

test("opened, it shows where the data is going and the two resets, which ask first", () => {
  const m = panelView({ open: true });
  assert.match(m, /aria-expanded="true"/);
  assert.match(m, /Saved to the database/);
  assert.match(m, /Storing into <b>db\.example\.com<\/b>/);
  assert.match(m, /<h3>Danger zone<\/h3>/);
  assert.match(m, /<button type="button" class="ja-dbtn">Reset the day<\/button>/);
  assert.match(m, /<button type="button" class="ja-dbtn">Wipe everything<\/button>/);
  assert.match(m, /Both ask you to confirm first\./);
  assert.doesNotMatch(m, /DATABASE_URL/);
  // On a local file it says so, and warns about hosting.
  const local = panelView({ open: true, health: { ok: true, location: "./.data/store.json", persistent: false } });
  assert.match(local, /Saved to a local file/);
  assert.match(local, /<code>DATABASE_URL<\/code>/);
});

test("when storage is not reachable the CLOSED row turns danger and says so", () => {
  const m = panelView({ health: { ok: false, error: "connection refused" } });
  assert.match(m, /<section class="ja-ev" data-down="true"/);
  assert.match(m, /aria-expanded="false"/);
  assert.match(m, /<span class="ja-ev-s">Storage is not reachable<\/span>/);
  assert.doesNotMatch(m, /Storage and resets/);
  assert.doesNotMatch(m, /connection refused/, "the details wait behind the click");
  // Open it for the details.
  const open = panelView({ open: true, health: { ok: false, error: "connection refused" } });
  assert.match(open, /<p class="ja-err" role="alert"><b>Storage is not reachable\.<\/b> connection refused<\/p>/);
  assert.match(open, /Reset the day/, "the resets are still there");
});

/* ---- wiring, read from source ------------------------------------------------------------- */

const tab = read("src/components/admin/TeamsTab.tsx");
const page = read("src/app/admin/page.tsx");

test("the page renders the Teams tab from its own file, in the wide layout, and Open in Referee sends the team the way Scores does", () => {
  assert.ok(page.includes('import { TeamsTab } from "@/components/admin/TeamsTab"'));
  assert.match(page, /<TeamsTab\s+state=\{state\}\s+refresh=\{refresh\}\s+onError=\{setError\}\s+onOpenFlags=\{\(teamId\) => \{\s*setFocusFlagTeam\(teamId\);\s*setTab\("flags"\);/);
  assert.match(page, /tab === "teams"( \|\| tab === "\w+")* \? "ja-pad"/, "Teams is among the tabs in the wide padding");
  for (const gone of ["function TeamsTab", "function EditableCell", "function StorageHealth", "function DangerZone", "resetRequestStatus", "RESETTABLE_STATUSES"]) {
    assert.ok(!page.includes(gone), `${gone} left page.tsx`);
  }
});

test("every write goes through a logic function that asks first; nothing is sent from the markup", () => {
  assert.ok(tab.includes("await saveTeamAfterAsking(ask, call, team, draft, state.panels)"), "Save is one saveTeamAfterAsking, which asks before a division move takes the panel off");
  assert.ok(tab.includes("resetStatusAfterAsking(ask, call, team, request, status)"));
  assert.ok(tab.includes("removeTeamAfterAsking(ask, call, team)"));
  assert.ok(tab.includes("openInRefereeAfterAsking(ask, team, draft, onOpenFlags)"));
  // The one call the tab makes itself is auto-assign, as before.
  assert.equal(tab.match(/\bcall[<(]/g)?.length, 1);
  assert.match(tab, /body: \{ action: "autoAssign", perPanel, division: filters\.division \|\| undefined \}/);
  assert.ok(!/\bconfirm\(/.test(tab) && !tab.includes("window.confirm"), "never window.confirm");
});

test("closing the drawer, picking another row and Escape all go through the unsaved-changes question", () => {
  assert.match(tab, /async function close\(\)[\s\S]*?leaveAfterAsking\(ask, team, draft\)/);
  assert.match(tab, /async function pick\(id: string\)[\s\S]*?leaveAfterAsking\(ask, team, draft\)/);
  assert.match(tab, /e\.key !== "Escape" \|\| !wide \|\| !team[\s\S]*?void close\(\)/);
  // A dialog's own Escape (the confirm's, the sheet's) is not the drawer's.
  assert.ok(tab.includes('closest("dialog")'));
  // The sheet asks too: Escape and the backdrop go to onClose, which is close().
  assert.match(tab, /onCancel=\{\(e\) => \{\s*e\.preventDefault\(\);\s*onClose\(\);/);
  assert.match(tab, /if \(e\.target === e\.currentTarget\) onClose\(\)/);
  assert.ok(tab.includes("onClose={close}"));
});

test("the panel choice is the Floor's rule, not a new conflict check", () => {
  const logic = read("src/components/admin/teamsLogic.ts");
  assert.ok(logic.includes("allowedPanels({ ...team, division }, held, panels, conflicts, judges)"));
  assert.ok(logic.includes("divisionsCompatible(division, held.division)"), "the client only asks; the same compatibility the server uses");
  assert.ok(logic.includes("strandedTeams(teams, panels, panelBlocks(conflicts, judges))"));
  assert.ok(!/panel_id ===|\.panel_id\s*===/.test(logic.replace(/team\.panel_id \?\? ""/g, "")), "no panel_id comparison of its own");
  assert.ok(!/c\.panel_id|conflicts?\.(?:some|find)/.test(tab + logic), "no read of a conflict's panel_id");
});

test("touch targets, a real button for everything, labelled icon buttons", () => {
  assert.ok(!/<div[^>]*onClick|<span[^>]*onClick/.test(tab), "no clickable div or span");
  assert.match(tab, /aria-label="Close team drawer"/);
  assert.match(tab, /aria-label="Close"/);
  const css = read("src/app/globals.css");
  const block = css.slice(css.indexOf("/* Teams (design/admin-redesign"));
  assert.match(block, /\.ja-tm-lrow \{[^}]*min-height: 68px/);
  assert.match(block, /\.ja-tm-fb \{[^}]*height: 44px/);
  assert.match(block, /\.ja-tm-ghost \{[^}]*height: 44px/);
  assert.match(block, /\.ja-tm \.ja-in \{ height: 44px/);
  assert.match(block, /\.ja-tm-rmb \{[^}]*height: 44px/);
  assert.match(block, /\.ja-tm-od \{[^}]*min-height: 44px/);
  assert.match(block, /\.ja-dbtn \{[^}]*height: 44px/);
});

/* ---- styles ------------------------------------------------------------------------------- */

test("the Teams styles are page-scoped, use tokens for both themes, and have no animation", () => {
  const css = read("src/app/globals.css");
  const block = css.slice(css.indexOf("/* Teams (design/admin-redesign"));
  assert.ok(block.length > 3000);
  assert.ok(css.indexOf("/* Teams (design/admin-redesign") > css.indexOf("/* Referee (design/admin-redesign"), "after the earlier blocks");
  assert.doesNotMatch(block, /@keyframes|animation|transition/, "no playful motion");
  assert.doesNotMatch(block, /oklch\(|#[0-9a-f]{3,6}\b|\brgb\(/i, "colours come from the tokens, so light works too");
  // The selected row: accent bar and tint, as the rail and the Referee tab.
  assert.match(block, /\.ja-tm-tw tbody tr\.ja-tm-sel td \{ background: var\(--ja-accent-t\)/);
  assert.match(block, /\.ja-tm-tw tbody tr\.ja-tm-sel td:first-child \{ box-shadow: inset 3px 0 0 var\(--accent\)/);
  assert.match(block, /\.ja-tm-lrow\[aria-current="true"\] \{[^}]*var\(--ja-accent-t\)[^}]*inset 3px 0 0 var\(--accent\)/);
  // Caution is 'Unassigned'; danger is 'no panel left' and storage that is down.
  assert.match(block, /\.ja-tm-ch\.ja-tm-un \{[^}]*--caution/);
  assert.match(block, /\.ja-tm-dp \{[^}]*--danger\) 14%[^}]*var\(--danger-quiet\)/);
  assert.match(block, /\.ja-ev\[data-down="true"\] \{[^}]*--danger\) 45%[^}]*--danger\) 14%/);
  assert.match(block, /\.ja-ev\[data-down="true"\] \.ja-ev-s, \.ja-ev\[data-down="true"\] \.ja-ev-b svg \{ color: var\(--danger-quiet\)/);
  // The save button is the shared accent primary.
  assert.match(css, /\.ja-prim \{[^}]*background: var\(--accent\)/);
  // From 1024px the drawer is ~368px, sticky and flush to the page's right edge; the table is not covered.
  const wide = block.slice(block.indexOf("@media (min-width: 1024px)"));
  assert.match(wide, /\.ja-tm \{[^}]*flex-direction: row/);
  assert.match(wide, /\.ja-tm-dr \{[^}]*position: sticky[^}]*width: 368px[^}]*margin: -12px -20px -16px 0/);
  assert.match(wide, /\.ja-tm-drb \{[^}]*overflow-y: auto/);
  assert.match(wide, /\.ja-tm-od \{ min-height: 32px/, "32px is plenty with a mouse");
  assert.match(block, /@media \(min-width: 1024px\) and \(max-width: 1279\.98px\) \{\s*\.ja-tm\[data-open="true"\] \.ja-tm-lo \{ display: none; \}/);
  // Closed by default means the body is not in the page (it is not merely hidden).
  assert.ok(read("src/components/admin/EventData.tsx").includes("{open ? ("));
});
