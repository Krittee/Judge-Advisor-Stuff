import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { AdminFrame } from "../src/components/admin/AdminFrame";
import { JudgeDialog, PanelsBoard, SlotsDialog, TakeOffDialog } from "../src/components/admin/PanelsTab";
import { slotsSummary, takeOffLines } from "../src/components/admin/panelsLogic";
import type { AppState, ConflictRow, JudgeRow, PublicPanel, Team } from "../src/lib/types";

/* The Judge Advisor Panels tab, rendered to markup. Behaviour that needs a
   browser (the select changing, a dialog opening, a tap) has no DOM harness
   here; the decisions behind it run as plain functions in
   adminPanels.logic.test.mjs, the store behind them in
   judgeRoutes.runtime.test.ts, and the wiring is read from source at the foot. */

const noop = () => {};
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");

const languages = [
  { id: "en", label: "English", short: "EN" },
  { id: "th", label: "ไทย", short: "TH" },
];
const panel = (n: number, division: string, over: Partial<PublicPanel> = {}): PublicPanel => ({
  id: `p${n}`, name: `Panel ${n}`, division, judges: [], languages: ["en"], sort_order: n, slot_start_at: null, slot_minutes: 20, slot_count: 0, ...over,
});
// The Panels mock, as data: Panel 3 has booking slots off, Panel 4 is in Elementary School.
const panels = [
  panel(1, "High School", { slot_count: 8, slot_start_at: "2026-10-20T10:00:00.000Z" }),
  panel(2, "Middle School", { languages: ["en", "th"], slot_count: 8, slot_start_at: "2026-10-20T10:00:00.000Z" }),
  panel(3, "Middle School"),
  panel(4, "Elementary School", { languages: ["en", "th"], slot_count: 10, slot_minutes: 15, slot_start_at: "2026-10-20T10:20:00.000Z" }),
];
const codes = { p1: "K7Q2PX", p2: "4MZ9TB", p3: "R2D8WN", p4: "H5J3LC" };

const judge = (id: string, name: string, panel_id: string | null): JudgeRow => ({ id, name, note: null, panel_id, created_at: "2026-10-20T08:00:00Z" });
const jordan = judge("j-jordan", "Jordan Kim", null);
const alex = judge("j-alex", "Alex Wong", null);
const dana = judge("j-dana", "Dana Ruiz", "p1");
const sam = judge("j-sam", "Sam Okafor", "p1");
const priya = judge("j-priya", "Priya Nair", "p2");
const lee = judge("j-lee", "Lee Chen", "p2");
const tom = judge("j-tom", "Tom Baker", "p3");
const ana = judge("j-ana", "Ana Silva", "p3");
const mei = judge("j-mei", "Mei Tan", "p4");
const raj = judge("j-raj", "Raj Patel", "p4");
const roster = [jordan, alex, dana, sam, priya, lee, tom, ana, mei, raj];

const team = (number: string, name: string, panel_id: string | null): Team => ({
  id: `t-${number}`, number, name, panel_id, division: "Middle School", category: "developing", pit: null, created_at: "2026-10-20T08:00:00Z",
});
const titans = team("9882K", "Torque Titans", "p3");
const byteMe = team("7700B", "Byte Me", "p3");
const teams = [titans, byteMe, ...Array.from({ length: 10 }, (_, i) => team(`10${i}0A`, `Team ${i}`, "p1")), team("5150Z", "Sparky", null)];

const conflict = (id: string, judge_id: string, t: Team, note: string | null = null): ConflictRow => ({
  id, panel_id: null, judge_id, team_id: t.id, judge_name: null, note, declared_by: "admin:Alex", created_at: "2026-10-20T09:00:00Z",
});
// Priya has two conflicts and Jordan one, as in the mock; Alex has none.
const conflicts = [conflict("c1", priya.id, titans, "coaches this team"), conflict("c2", priya.id, byteMe), conflict("c3", jordan.id, titans)];

const base = {
  panels,
  teams,
  judges: roster,
  conflicts,
  languages,
  divisions: ["High School", "Middle School", "Elementary School"],
};
type Over = Partial<Omit<Parameters<typeof PanelsBoard>[0], "state">>;
function board(over: Over & { state?: Partial<typeof base> } = {}) {
  const { state, ...rest } = over;
  return renderToStaticMarkup(
    <PanelsBoard
      state={{ ...base, ...state } as unknown as AppState}
      codes={codes}
      onView={noop}
      onMenu={noop}
      onArm={noop}
      onDisarm={noop}
      onDeleteAll={noop}
      onNewJudge={noop}
      onMove={noop}
      onOpenConflicts={noop}
      onRename={noop}
      onRemove={noop}
      onToggleLanguage={noop}
      onEditSlots={noop}
      onDivision={noop}
      onDeletePanel={noop}
      onAddPanel={async () => true}
      onPresets={noop}
      {...rest}
    />,
  );
}
const roster_ = (m: string) => m.match(/<section class="ja-pn-roster"[\s\S]*?<\/section>(?=<p class="ja-pn-hint">)/)?.[0] ?? "";
const groupOf = (m: string, label: string) =>
  [...roster_(m).matchAll(/<section class="ja-pn-grp"[\s\S]*?<\/section>/g)].map((x) => x[0]).find((g) => g.includes(`>${label}</h3>`)) ?? "";
const rowOf = (m: string, name: string) => [...m.matchAll(/<li class="ja-pn-jr"[\s\S]*?<\/li>/g)].map((x) => x[0]).find((r) => r.includes(`>${name}</span>`)) ?? "";
const cardOf = (m: string, name: string) => [...m.matchAll(/<article class="ja-pn-card"[\s\S]*?<\/article>/g)].map((x) => x[0]).find((c) => c.includes(`>${name}</h3>`)) ?? "";
const selectedOf = (row: string) => row.match(/<option value="([^"]*)" selected="">/)?.[1];

/* ---- the roster -------------------------------------------------------------- */

test("the roster has the mock's heading and groups: Not on a panel first, then Panel 1 … 4, each with its count", () => {
  const m = board();
  assert.match(roster_(m), /<h2 id="[^"]+">Judges · 10<\/h2>/);
  assert.match(roster_(m), /<button type="button" class="ja-pn-gh" aria-haspopup="dialog"><svg[^>]*>[\s\S]*?<\/svg>New judge<\/button>/);
  assert.deepEqual(
    [...roster_(m).matchAll(/<h3 id="[^"]+">(.*?)<\/h3><span>(.*?)<\/span>/g)].map((x) => [x[1], x[2]]),
    [["Not on a panel", "(2)"], ["Panel 1 · HS", "(2)"], ["Panel 2 · MS", "(2)"], ["Panel 3 · MS", "(2)"], ["Panel 4 · ES", "(2)"]],
  );
  assert.deepEqual(
    [...groupOf(m, "Panel 2 · MS").matchAll(/<span class="ja-pn-jt"[^>]*>(.*?)<\/span>/g)].map((x) => x[1]),
    ["Priya Nair", "Lee Chen"],
  );
});

test("a judge on no panel comes first; moving them out of the group is what a pending move shows", () => {
  const m = board();
  assert.deepEqual([...groupOf(m, "Not on a panel").matchAll(/<span class="ja-pn-jt"[^>]*>(.*?)<\/span>/g)].map((x) => x[1]), ["Jordan Kim", "Alex Wong"]);
  // Nobody not on a panel and no one on Panel 2: neither group is drawn.
  const few = board({ state: { judges: [dana, mei] } });
  assert.deepEqual([...roster_(few).matchAll(/<h3 id="[^"]+">(.*?)<\/h3>/g)].map((x) => x[1]), ["Panel 1 · HS", "Panel 4 · ES"]);
  assert.match(text(roster_(board({ state: { judges: [] } }))), /Nobody on the roster yet\./);
});

test("a row has the name, a neutral N conflicts pill that opens Conflicts, and a labelled Panel select", () => {
  const m = board();
  const priyaRow = rowOf(m, "Priya Nair");
  assert.match(priyaRow, /<button type="button" class="ja-pn-cp" aria-label="2 conflicts: open Priya Nair in Conflicts">2 conflicts<\/button>/);
  assert.match(rowOf(m, "Jordan Kim"), />1 conflict<\/button>/);
  assert.doesNotMatch(rowOf(m, "Alex Wong"), /ja-pn-cp/, "no conflicts, no pill");
  assert.match(rowOf(m, "Alex Wong"), /<li class="ja-pn-jr" data-nc="true">/);
  // Neutral: a plain outline pill, not the caution one that means a language or conflict warning.
  assert.doesNotMatch(priyaRow, /ja-pill/);

  const select = priyaRow.match(/<select[\s\S]*?<\/select>/)?.[0] ?? "";
  assert.match(priyaRow, /<label class="sr-only" for="ja-pn-rs-j-priya">Panel for Priya Nair<\/label>/);
  assert.match(select, /^<select id="ja-pn-rs-j-priya" class="ja-pn-ssel">/);
  assert.deepEqual([...select.matchAll(/<option value="([^"]*)"[^>]*>(.*?)<\/option>/g)].map((x) => [x[1], x[2]]), [
    ["", "— none —"], ["p1", "Panel 1"], ["p2", "Panel 2"], ["p3", "Panel 3"], ["p4", "Panel 4"],
  ]);
  assert.equal(selectedOf(priyaRow), "p2");
  assert.equal(selectedOf(rowOf(m, "Jordan Kim")), "", "— none —");
});

test("while a move is in the air its select shows the target; with nothing pending it shows where the judge is", () => {
  const moving = board({ pending: { judgeId: jordan.id, panelId: "p3" } });
  assert.equal(selectedOf(rowOf(moving, "Jordan Kim")), "p3", "the question is open on Panel 3");
  assert.equal(selectedOf(rowOf(moving, "Priya Nair")), "p2", "and nobody else's select moved");
  // Cancel clears the pending move: the select is back on — none —.
  assert.equal(selectedOf(rowOf(board({ pending: null }), "Jordan Kim")), "");
});

test("each row has a labelled ⋯ that opens Rename and Remove from roster", () => {
  const m = board();
  assert.match(rowOf(m, "Dana Ruiz"), /<button type="button" id="ja-pn-more-j-dana" class="ja-more ja-pn-more" aria-label="More actions for Dana Ruiz: rename, remove from roster" aria-haspopup="dialog" aria-expanded="false">/);
  assert.doesNotMatch(m, /Remove from roster/, "closed: no menu");
  const open = rowOf(board({ menu: dana.id }), "Dana Ruiz");
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /<div class="ja-pop" role="dialog" aria-label="Actions for Dana Ruiz"><button type="button" class="ja-pi" autofocus="">Rename<\/button><button type="button" class="ja-pi ja-danger">Remove from roster<\/button><\/div>/);
  assert.equal(board({ menu: dana.id }).match(/class="ja-pop"/g)?.length, 1, "one menu at a time");
});

/* ---- the cards --------------------------------------------------------------- */

test("a card has the name, division tag and team count, then the code large with Copy", () => {
  const m = board();
  assert.equal(m.match(/<article class="ja-pn-card"/g)?.length, 4);
  const card = cardOf(m, "Panel 1");
  assert.match(card, /<header class="ja-pn-ch"><h3 id="[^"]+">Panel 1<\/h3><span class="jg-ptag" title="High School"><span aria-hidden="true">HS<\/span><span class="sr-only">High School<\/span><\/span><span class="ja-pn-tc">10 teams<\/span><\/header>/);
  assert.match(card, /<span class="ja-pn-cl">Judge sign-in code<\/span><code class="ja-pn-cv">K7Q2PX<\/code>/);
  assert.match(card, /<button type="button" class="ja-pn-gh ja-pn-cpy" aria-label="Copy code K7Q2PX for Panel 1"><svg[\s\S]*?<\/svg>Copy<\/button>/);
  assert.match(text(cardOf(m, "Panel 3")), /2 teams/);
});

test("Judges is read-only and set from the roster; a panel with none says No judges yet in caution", () => {
  const m = board();
  assert.match(cardOf(m, "Panel 2"), /<span class="ja-sec">Judges<span>· set from the roster<\/span><\/span><p>Priya Nair, Lee Chen<\/p>/);
  assert.doesNotMatch(cardOf(m, "Panel 2"), /<input/, "no judges field: the roster is where they are set");
  const lonely = board({ state: { judges: roster.filter((j) => j.panel_id !== "p3") } });
  assert.match(cardOf(lonely, "Panel 3"), /<p><span class="ja-pill"><svg[\s\S]*?<\/svg>No judges yet<\/span><\/p>/);
  assert.doesNotMatch(cardOf(lonely, "Panel 2"), /No judges yet/);
});

test("the language toggles are pressed buttons; with none on it says Not stated", () => {
  const m = board();
  const group = cardOf(m, "Panel 2").match(/<div class="ja-pn-lts"[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(group, /role="group" aria-labelledby="[^"]+-lg"/);
  assert.deepEqual(
    [...group.matchAll(/<button type="button" class="ja-pn-lt" aria-pressed="(\w+)">(?:<svg[\s\S]*?<\/svg>)?<span lang="(\w+)">(.*?)<\/span>/g)].map((x) => [x[1], x[2], x[3]]),
    [["true", "en", "English"], ["true", "th", "ไทย"]],
  );
  assert.doesNotMatch(cardOf(m, "Panel 2"), /Not stated/);
  assert.match(cardOf(m, "Panel 1").match(/<div class="ja-pn-lts"[\s\S]*?<\/div>/)?.[0] ?? "", /aria-pressed="false"><span lang="th">/);

  const none = board({ state: { panels: [panel(1, "High School", { languages: [] })] } });
  assert.match(none, /<p class="ja-hint">Not stated — no request will be flagged\.<\/p>/);
});

test("the slots line summarises the grid and Edit opens the fields; off says so", () => {
  const m = board();
  assert.match(cardOf(m, "Panel 1"), new RegExp(`<div class="ja-pn-bsl"><span>${slotsSummary(panels[0]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</span><button type="button" class="ja-pn-edit" aria-haspopup="dialog" aria-label="Edit booking slots for Panel 1">Edit</button></div>`));
  assert.match(text(cardOf(m, "Panel 1")), /8 slots from .+ · 20 min/);
  assert.match(text(cardOf(m, "Panel 4")), /10 slots from .+ · 15 min/);
  assert.match(cardOf(m, "Panel 3"), /<div class="ja-pn-bsl" data-off="true"><span>Booking slots off<\/span>/);
});

test("the division select lists the divisions with the panel's own chosen; Delete panel is a labelled danger button", () => {
  const card = cardOf(board(), "Panel 3");
  const select = card.match(/<select[\s\S]*?<\/select>/)?.[0] ?? "";
  assert.deepEqual([...select.matchAll(/<option value="([^"]+)"( selected="")?>/g)].map((x) => [x[1], !!x[2]]), [
    ["High School", false], ["Middle School", true], ["Elementary School", false],
  ]);
  assert.match(card, /<label for="[^"]+-dv">Division<\/label>/);
  assert.match(card, /<button type="button" class="ja-pn-del" aria-haspopup="dialog" aria-label="Delete Panel 3"><svg[\s\S]*?<\/svg>Delete panel<\/button>/);
});

test("a card with no code yet (still loading) disables Copy rather than copying nothing", () => {
  const m = board({ codes: {} });
  assert.match(cardOf(m, "Panel 1"), /<code class="ja-pn-cv">—<\/code><\/div><button[^>]*disabled="" aria-label="Copy code for Panel 1"/);
});

/* ---- Add panel, presets, Delete all ------------------------------------------ */

test("Add panel is name and division only: the judges come from the roster", () => {
  const form = board().match(/<form class="ja-pn-add"[\s\S]*?<\/form>/)?.[0] ?? "";
  assert.match(form, /aria-label="Add panel"/);
  assert.match(form, /<label class="ja-lab" for="[^"]+-n">Panel name<\/label><input[^>]*placeholder="Panel D"/);
  assert.match(form, /<label class="ja-lab" for="[^"]+-d">Division<\/label>/);
  assert.match(form, /<button type="submit" class="ja-prim ja-pn-addb" disabled="">Add panel<\/button>/, "waits for a name");
  assert.doesNotMatch(board(), /Judges \(comma separated\)|Judge names, comma separated/);
});

test("Add preset panels keeps its caption", () => {
  const m = board();
  assert.match(m, /<button type="button" class="ja-pn-gh">Add preset panels<\/button>/);
  assert.match(m, /<p>Creates anything in <code>config\/event\.json<\/code> that is missing\. Never overwrites a panel you already have\.<\/p>/);
});

test("Delete all panels is one quiet danger button until it is armed", () => {
  const m = board();
  const box = m.match(/<div class="ja-pn-fbox ja-pn-dgr">[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(box, /<button type="button" class="ja-pn-dbtn">Delete all panels<\/button><p>Clears all 4 panels so you can start over\. Teams are kept\.<\/p>/);
  assert.doesNotMatch(box, /Every judge code stops working|Cancel/, "the warning waits for the first click");
});

test("armed, it states what happens and offers Cancel (focused, first) and Delete all", () => {
  const box = board({ armed: true }).match(/<div class="ja-pn-fbox ja-pn-dgr">[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(box, /<p role="alert">Every judge code stops working immediately\. Your teams stay, unassigned\.<\/p>/);
  assert.ok(box.indexOf(">Cancel</button>") < box.indexOf("Delete all 4 panels"), "Cancel sits where the first click was");
  assert.match(box, /<button type="button" class="ja-pn-gh" autofocus="">Cancel<\/button><button type="button" class="ja-pn-dbtn">Delete all 4 panels<\/button>/);
  assert.doesNotMatch(box, /Delete all panels</, "the arming button is gone");
  assert.match(text(board({ armed: true, busy: true })), /Deleting…/);
});

test("with no panels there is no Delete all, an empty message, and presets are still offered", () => {
  const m = board({ state: { panels: [] } });
  assert.doesNotMatch(m, /Delete all|ja-pn-dgr/);
  assert.match(text(m), /No judge panels yet\. Add one below, or load your presets — judges sign in with a panel&#x27;s code\./);
  assert.match(m, /Add preset panels/);
});

/* ---- the phone's switch ------------------------------------------------------ */

test("a phone has a Judges | Panels switch with counts, and the board says which one it is on", () => {
  const m = board({ view: "panels" });
  assert.match(m, /^<div class="ja-pn" data-view="panels">/);
  const seg = m.match(/<div class="ja-pn-seg"[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(seg, /role="group" aria-label="Show"/);
  assert.match(seg, /aria-pressed="false"><span>Judges<\/span><small>10<\/small><\/button><button type="button" aria-pressed="true"><span>Panels<\/span><small>4<\/small>/);
  assert.match(board(), /^<div class="ja-pn" data-view="judges">/);
  assert.match(text(board()), /Pick a panel for each judge\. A judge sits on one panel at most\./);
  // The pinned New judge for the Judges view.
  assert.match(board(), /<div class="ja-pin ja-pn-pin"><button type="button" class="ja-prim" aria-haspopup="dialog"><svg[\s\S]*?<\/svg>New judge<\/button><\/div>/);
});

test("the phone's bar says how many panels", () => {
  const bar = (n: number) =>
    renderToStaticMarkup(
      <AppRouterContext.Provider value={{} as React.ContextType<typeof AppRouterContext>}>
        <AdminFrame name="Alex" online tab="panels" onTab={noop} counts={{ panels: n }}>
          <p>x</p>
        </AdminFrame>
      </AppRouterContext.Provider>,
    ).match(/<div class="ja-sbar">[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(bar(4), /<b>Panels<\/b><span class="ja-rc">4 panels<\/span>/);
  assert.match(bar(1), /<span class="ja-rc">1 panel<\/span>/);
  assert.doesNotMatch(bar(0), /ja-rc/);
});

/* ---- the dialogs ------------------------------------------------------------- */

const takeOff = (names: string[] = ["9882K", "7700B"]) => ({
  judge: priya,
  panelName: "Panel 3",
  lines: takeOffLines(priya.id, names, teams, conflicts),
});

test("the add-judge question is the mock's: title, the teams with their notes, a caution, Cancel then the accent button", () => {
  const d = renderToStaticMarkup(<TakeOffDialog info={takeOff()} onAnswer={noop} />);
  assert.match(d, /^<dialog class="ja-sheet ja-pn-cfm" aria-modal="true" aria-labelledby="([^"]+)" aria-describedby="([^"]+)">/);
  assert.match(d, /<h2 id="[^"]+">Add Priya Nair to Panel 3\?<\/h2>/);
  assert.match(text(d), /Priya Nair has conflicts with 2 teams on Panel 3\. Adding Priya Nair takes them off it\./);
  const list = d.match(/<ul class="ja-pn-cfl"[\s\S]*?<\/ul>/)?.[0] ?? "";
  assert.match(list, /aria-label="Teams that come off Panel 3"/);
  assert.match(list, /<b>9882K<\/b><span>Torque Titans<\/span><\/p><p class="ja-pn-r2">“coaches this team”<\/p>/);
  assert.match(list, /<b>7700B<\/b><span>Byte Me<\/span><\/p><\/li>/, "no note, no quotes");
  assert.match(d, /<div class="jg-caution" role="note"><svg[\s\S]*?<\/svg><p>They’ll need another panel\.<\/p><\/div>/);
  // Cancel first, so it takes the focus; the destructive-ish answer is the accent primary.
  assert.ok(d.indexOf(">Cancel</button>") < d.indexOf("Add and take teams off"));
  assert.match(d, /<button type="button" class="ja-pn-gh ja-pn-cfc" data-autofocus="true">Cancel<\/button>/);
  assert.match(d, /<button type="button" class="ja-prim ja-pn-cfo">Add and take teams off<\/button>/);
  assert.equal(d.match(/data-autofocus/g)?.length, 1, "Cancel is the one that takes the focus");
});

test("the add-judge question is shut (and empty) until a move reports teams", () => {
  const d = renderToStaticMarkup(<TakeOffDialog info={null} onAnswer={noop} />);
  assert.doesNotMatch(d, /<dialog[^>]* open/);
  assert.doesNotMatch(d, /<h2|Cancel/);
});

test("New judge asks for a name and an optional note, and says it adds to the roster on no panel", () => {
  const d = renderToStaticMarkup(<JudgeDialog mode={{ kind: "new" }} onSubmit={async () => {}} onClose={noop} />);
  assert.match(d, /<h2 id="[^"]+">New judge<\/h2>/);
  assert.match(d, /<label class="ja-lab" for="[^"]+-name">Judge’s name<\/label><input[^>]*placeholder="e\.g\. Priya Nair" data-autofocus="true"/);
  assert.match(d, /About them <span class="ja-op">\(optional\)<\/span>/);
  assert.match(text(d), /Added to the roster on no panel\. Pick their panel from the list\./);
  assert.match(d, /<button type="submit" class="ja-prim" disabled="">Add judge<\/button>/, "waits for a name");
  assert.match(d, /<button type="button" class="ja-x" aria-label="Close">/);
});

test("Rename starts on the judge's name and has no note", () => {
  const d = renderToStaticMarkup(<JudgeDialog mode={{ kind: "rename", judge: priya }} onSubmit={async () => {}} onClose={noop} />);
  assert.match(d, /<h2 id="[^"]+">Rename judge<\/h2>/);
  assert.match(d, /value="Priya Nair"/);
  assert.doesNotMatch(d, /About them/);
  assert.match(d, />Save name<\/button>/);
  assert.doesNotMatch(renderToStaticMarkup(<JudgeDialog mode={null} onSubmit={async () => {}} onClose={noop} />), /<form/);
});

test("the slot dialog keeps the grid fields, the Booking slots (N) header and the walk-up caption", () => {
  const d = renderToStaticMarkup(<SlotsDialog panel={panels[0]} onSave={async () => {}} onClose={noop} />);
  assert.match(text(d), /Booking slots \(8\) · Panel 1/);
  assert.match(d, /<label class="ja-lab" for="[^"]+-start">First slot starts<\/label><input[^>]*type="datetime-local"/);
  assert.match(d, /Minutes each<\/label><input[^>]*type="number" min="3" max="120" value="20"/);
  assert.match(d, /How many<\/label><input[^>]*type="number" min="0" max="60" value="8"/);
  assert.match(d, /<p class="ja-hint">Set “how many” to 0 for walk-up queue only\.<\/p>/);
  assert.match(d, />Save slot grid<\/button>/);
  assert.match(text(renderToStaticMarkup(<SlotsDialog panel={panels[2]} onSave={async () => {}} onClose={noop} />)), /Booking slots \(off\) · Panel 3/);
});

/* ---- the wiring, read from source -------------------------------------------- */

const tab = read("src/components/admin/PanelsTab.tsx");
const logic = read("src/components/admin/panelsLogic.ts");
const page = read("src/app/admin/page.tsx");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

test("the page renders the Panels tab from its own file, in the wide layout, and the old Panels code is gone", () => {
  assert.ok(page.includes('import { PanelsTab } from "@/components/admin/PanelsTab"'));
  assert.match(page, /<PanelsTab\s+state=\{state\}\s+refresh=\{refresh\}\s+onError=\{setError\}\s+onOpenConflicts=\{\(judgeId\) => \{\s*setFocusJudge\(judgeId\);\s*setTab\("conflicts"\);/);
  assert.match(page, /tab === "panels" \|\| tab === "flags"/, "Panels is in the ja-pad tabs");
  for (const gone of ["function PanelsTab", "function PanelCard", "function DeleteAllPanels", "toLocalInput", "Judges (comma separated)", "saveJudgesAfterAsking"]) {
    assert.ok(!page.includes(gone), `${gone} left page.tsx`);
  }
});

test("a judge's conflicts pill is the link: it hands the page that judge, and leaving Conflicts drops the mark", () => {
  assert.ok(tab.includes("onClick={() => onOpenConflicts(j.id)}"));
  assert.match(page, /<ConflictsTab state=\{state\} refresh=\{refresh\} onError=\{setError\} focusJudgeId=\{focusJudge\} \/>/);
  assert.match(page, /if \(id !== tab\) setFocusJudge\(null\);/);
});

test("every move goes through moveJudgeShowing, which looks first; the tab sends no judge PATCH of its own for a move", () => {
  assert.ok(tab.includes("moveJudgeShowing("));
  assert.match(logic, /body: \{ \.\.\.body, dryRun: true \}/);
  // The only PATCHes the tab sends itself: rename (name only), a panel's fields.
  assert.equal(code(tab).match(/"\/api\/admin\/judges", \{ method: "PATCH"/g)?.length, 1);
  assert.match(tab, /body: \{ id: form\.judge\.id, name \}/);
  assert.ok(!/panelId/.test(code(tab).slice(code(tab).indexOf("async function saveJudge"), code(tab).indexOf("function closeForm"))), "rename sends no panel");
  // The select is controlled, so a move that is cancelled goes back to the judge's own panel.
  assert.ok(tab.includes("pending?.judgeId === j.id ? pending.panelId : panelValue(j, panels)"));
  assert.match(tab, /setPending,\s*async \(\) => \{\s*await refresh\(\);/);
});

test("every question goes through ask() in the logic, or the take-off dialog; there is no window.confirm", () => {
  for (const [name, re] of [
    ["move division", /await ask\(divisionQuestion\(panelName, division\), \{ confirmLabel: "Move division", danger: true \}\)/],
    ["delete panel", /await ask\(deletePanelQuestion\(panel\.name\), \{ confirmLabel: "Delete panel", danger: true \}\)/],
    ["remove judge", /await ask\(removeJudgeQuestion\(judge\.name, conflicts\), \{ confirmLabel: "Remove from roster", danger: true \}\)/],
  ] as const) {
    assert.match(logic, re, `${name} does not ask through ask()`);
  }
  assert.ok(tab.includes("const { ask, dialog } = useConfirm();") && tab.includes("{dialog}"));
  assert.ok(tab.includes("changeDivisionAfterAsking(ask, panel.name, division,"));
  assert.ok(tab.includes("deletePanelAfterAsking(ask, call, panel)"));
  assert.ok(tab.includes("removeJudgeAfterAsking(ask, call, judge,"));
  assert.ok(!/(?:^|[^\w$.])confirm\s*\(|window\.confirm/.test(code(tab) + code(logic)), "never window.confirm");
  // The division is read from the event as it happens: the select snaps back while the question is open.
  assert.ok(tab.includes("onChange={(e) => onDivision(panel, e.target.value)}"));
});

test("the take-off dialog answers No for Escape, the backdrop and Cancel, and Yes only from its one button", () => {
  assert.ok(tab.includes("<Modal open={info !== null} onClose={() => onAnswer(false)}"));
  assert.equal(tab.match(/onAnswer\(true\)/g)?.length, 1);
  assert.match(tab, /onClose=\{\(\) => \{\s*if \(open\) onClose\(\);/, "Escape closes the native dialog and tells the tab");
  assert.match(tab, /if \(e\.target === e\.currentTarget\) onClose\(\);/);
  assert.ok(tab.includes("el.showModal();") && tab.includes('querySelector<HTMLElement>("[data-autofocus]")?.focus()'));
  // Answering clears the question and settles the promise the move is waiting on.
  assert.match(tab, /function answerTakeOff\(ok: boolean\) \{\s*takeOff\?\.answer\(ok\);\s*setTakeOff\(null\);/);
});

test("no keydown handler on this tab opens a question: the one there closes the menu and nothing else", () => {
  const handlers = code(tab).match(/addEventListener\("keydown"/g) ?? [];
  assert.equal(handlers.length, 1);
  const onKey = code(tab).slice(code(tab).indexOf("const onKey = "), code(tab).indexOf("const onDown = "));
  assert.match(onKey, /setMenu\(null\)/);
  assert.doesNotMatch(onKey, /ask\(|showModal|setTakeOff|setForm/, "an Escape that opened a dialog would be cancelled by the browser's own Escape unless it called preventDefault first");
  assert.doesNotMatch(code(tab), /onKeyDown/);
});

test("Delete all is two clicks: the first only arms, the second is the only caller, and it disarms itself", () => {
  const board = code(tab).slice(code(tab).indexOf("{armed ? ("), code(tab).indexOf("{/* On a phone's Judges view"));
  const [armedBranch, unarmedBranch] = board.split(") : (");
  assert.ok(armedBranch.includes("onClick={onDeleteAll}") && !armedBranch.includes("onClick={onArm}"));
  assert.ok(unarmedBranch.includes("onClick={onArm}") && !unarmedBranch.includes("onDeleteAll"));
  assert.equal(code(tab).match(/deleteAllPanels\(call\)/g)?.length, 1);
  assert.ok(tab.includes("onArm={() => setArmed(true)}") && tab.includes("onDeleteAll={deleteAll}"));
  // A glance must not leave a live Delete all button sitting there.
  assert.match(tab, /const t = setTimeout\(\(\) => setArmed\(false\), 8000\);/);
});

test("the tab decides no conflict: it asks the server (dryRun) and reads the roster's own panel_id for judges only", () => {
  const both = code(tab) + code(logic);
  assert.doesNotMatch(both, /\bc\.panel_id\b|conflicts?\.(?:some|find)\([^)]*panel_id/, "tests/panelBlocks.test.ts' rule: only roster.ts reads a conflict's panel");
  assert.doesNotMatch(both, /panelBlocks|isPanelBlocked|blockedTeams/, "no block worked out here");
});

/* ---- styles ------------------------------------------------------------------ */

const css = read("src/app/globals.css");
// Up to the next feature's block: later steps append theirs after Panels'.
const blockStart = css.indexOf("/* Panels (design/admin-redesign");
const blockEnd = css.indexOf("/* @ja-block", blockStart);
const block = css.slice(blockStart, blockEnd < 0 ? undefined : blockEnd);

test("the Panels styles are page-scoped, use tokens for both themes, and have no animation", () => {
  assert.ok(block.length > 1000);
  assert.doesNotMatch(block, /@keyframes|animation|transition/);
  assert.doesNotMatch(block, /oklch\(|#[0-9a-f]{3,6}\b/i, "colours come from the tokens, so light works too");
  assert.match(css, /\.ja-pill \{[^}]*var\(--caution\)[^}]*var\(--caution-quiet\)/s, "No judges yet wears the caution colours");
});

test("phone targets are 44px; from 1024px the roster is 380px beside the cards and the phone's switch is gone", () => {
  for (const sel of [".ja-pn-gh", ".ja-pn-ssel", ".ja-pn-lt", ".ja-pn-del", ".ja-pn-dbtn", ".ja-pn-edit"]) {
    const rule = block.match(new RegExp(`\\n${sel.replace(".", "\\.")} \\{[^}]*\\}`))?.[0] ?? "";
    assert.match(rule, /(?:min-)?(?:height|width): 44px/, `${sel} is a 44px target on a phone`);
  }
  assert.match(block, /\.ja-pn-cp::before \{[^}]*inset: -11px/, "the 22px pill's tap area grows to 44px");
  assert.match(block, /\.ja-pn-seg button \{[^}]*height: 52px/);
  const wide = block.slice(block.lastIndexOf("@media (min-width: 1024px)"));
  assert.match(wide, /\.ja-pn-cols \{ display: grid; grid-template-columns: 380px minmax\(0, 1fr\)/);
  assert.match(wide, /\.ja-pn-seg, \.ja-pn-hint, \.ja-pn-pin \{ display: none; \}/);
  assert.match(wide, /\.ja-pn-grid \{ grid-template-columns: repeat\(auto-fit, minmax\(280px, 1fr\)\)/, "two columns of cards at 1280");
  // A phone shows the roster or the cards, never both.
  assert.match(block, /\.ja-pn\[data-view="judges"\] \.ja-pn-right, \.ja-pn\[data-view="judges"\] \.ja-pn-foot \{ display: none; \}/);
  assert.match(block, /\.ja-pn\[data-view="panels"\] \.ja-pn-roster[^{]*\{ display: none; \}/);
});

test("the take-off question is a centred card on a phone too, and Add and take teams off is the accent primary", () => {
  assert.match(block, /\.ja-sheet\.ja-pn-cfm \{[^}]*margin: auto/);
  assert.match(css, /\.ja-prim \{[^}]*background: var\(--accent\)/);
});
