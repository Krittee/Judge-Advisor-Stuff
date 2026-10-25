import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AwardLists, AwardsBoard, MatrixView, NomineePanel, ViewToggle } from "../src/components/admin/AwardsTab";
import { buildAwardPanels, buildMatrix, detailFor, hiddenNote, nominationsIn, winnersOf, type Detail, type Sel, type View } from "../src/components/admin/awardsLogic";
import { withRanks } from "../src/components/admin/scoresLogic";
import { rankTeams } from "../src/lib/ranking";
import { rubrics } from "../src/lib/rubrics";
import type { AppState, AwardsAdminView, FlagRow } from "../src/lib/types";
import {
  adminNom, awards, byteMe, divisions, gearGrinders, labRats, MS, nominations, panels, quiet, teams, torque, winners, HS,
} from "./adminAwards.fixtures";

/* The Judge Advisor Awards board, rendered to markup. Behaviour that needs a
   browser (a tap, the dialog, the matrix's sideways scroll) has no DOM harness
   here; the decisions behind it run as plain functions in
   adminAwards.logic.test.mjs, the toggle's, the cells' and the buttons'
   handlers are called straight off their element trees, and the tab's and the
   page's wiring is read from source at the foot. */

const noop = () => {};
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
const tab = read("src/components/admin/AwardsTab.tsx");
const page = read("src/app/admin/page.tsx");
const css = read("src/app/globals.css");

const rubricList = rubrics();
const notebook = rubricList.find((r) => r.id === "notebook")!;
const interview = rubricList.find((r) => r.id === "interview")!;
const flagKinds: AppState["flagKinds"] = [
  { id: "good", label: "Good conduct", short: "Good", color: "emerald", severity: 0, requiresRule: false },
  { id: "warning", label: "Warning", short: "Warning", color: "amber", severity: 1, requiresRule: false },
];
let flagId = 0;
const flag = (team: { id: string }, kind: string, over: Partial<FlagRow> = {}): FlagRow => ({
  id: `f${++flagId}`, team_id: team.id, kind, body: "", author: "Jordan Lee", match_type: "Q", match_number: "1", field: "1", rule: null,
  ruleset: "v5rc", manual_version: null, match_affecting: false, created_at: "2026-10-20T10:00:00.000Z", ...over,
});

/** Every criterion marked `mark`; byteMe is the only team scored. */
const marked = (rubric: typeof notebook, mark: number) => {
  const values: Record<string, number> = {};
  rubric.sections.forEach((s) => s.criteria.forEach((c) => (values[c.id] = mark)));
  return { id: `s-${rubric.id}`, team_id: byteMe.id, rubric_id: rubric.id, values, total: Object.values(values).reduce((a, b) => a + b, 0), scored_by: "Sam", panel_id: "p2", updated_at: "2026-10-20T09:00:00Z" };
};
const categories = [{ id: "developing", label: "Developing", color: "amber", excludesRubrics: [] }];
const rows = withRanks(rankTeams(teams, [marked(notebook, 2), marked(interview, 1)], rubricList, categories));

const data: AwardsAdminView = { awards, nominations, winners };
// One Good conduct flag is below the two that count as a Sportsmanship nomination, so these flags change nothing on the board.
const state = { teams, panels, divisions, flags: [flag(byteMe, "good")], flagKinds };
/** Quiet Ones: three Good conduct flags and no judge. Torque Titans: two, beside a judge's Sportsmanship nomination. Byte Me: one. */
const conductFlags = [
  flag(quiet, "good", { author: "Ana Cruz", match_number: "3", body: "Lent the other alliance a cable." }),
  flag(quiet, "good", { author: "Jordan Lee", match_number: "9", body: "" }),
  flag(quiet, "good", { author: "Ana Cruz", match_type: "QF", match_number: "2-1", body: "Cheered for both teams." }),
  flag(torque, "good", { author: "Ana Cruz", match_number: "4", body: "Reset the field for the next match." }),
  flag(torque, "good", { author: "Jordan Lee", match_number: "11" }),
  flag(byteMe, "good"),
];
const excellence7700B: Sel = { awardId: "excellence", teamId: byteMe.id };

function board(over: { data?: AwardsAdminView; division?: string; panelId?: string; view?: View; sel?: Sel | null; wide?: boolean; busy?: boolean; rows?: typeof rows; flags?: FlagRow[] } = {}) {
  return renderToStaticMarkup(
    <AwardsBoard
      data={over.data ?? data}
      state={over.flags ? { ...state, flags: over.flags } : state}
      rows={over.rows ?? rows}
      rubricList={rubricList}
      division={over.division ?? MS}
      onDivision={noop}
      panelId={over.panelId}
      onPanel={noop}
      view={over.view ?? "matrix"}
      onView={noop}
      sel={over.sel === undefined ? null : over.sel}
      onSelect={noop}
      wide={over.wide}
      busy={over.busy}
      onGive={noop}
      onClear={noop}
      onNominate={noop}
      onRemove={noop}
    />,
  );
}

const aside = (markup: string) => markup.match(/<aside [\s\S]*?<\/aside>/)?.[0] ?? "";
const bodyRows = (markup: string) => [...markup.matchAll(/<tr><th scope="row" class="ja-aw-tm"><b>(.*?)<\/b>/g)].map((m) => m[1]);
const sections = (markup: string) => [...markup.matchAll(/<section class="ja-aw-ap[^"]*" aria-label="([^"]+)">([\s\S]*?)<\/section>/g)].map((m) => ({ name: m[1], body: m[2] }));

/** Every element in a tree a hook-free component returned. */
function walk(node: ReactNode, out: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) node.forEach((c) => walk(c, out));
  else if (node && typeof node === "object" && "props" in node) {
    const el = node as ReactElement<Record<string, unknown>>;
    out.push(el);
    walk(el.props.children as ReactNode, out);
  }
  return out;
}
const click = (el: ReactElement<Record<string, unknown>>) => (el.props.onClick as () => void)();

/* ---- the title and the filters ---------------------------------------------------- */

test("the header names the division and panel, how many awards are decided, and the nominations; winners are private", () => {
  const m = board();
  assert.match(m, /<h2 class="ja-aw-h">Awards<\/h2>/);
  assert.match(m, /<p class="ja-aw-meta">Middle School · all panels · <b>3 of 11<\/b> decided · 18 nominations for 9 teams<\/p>/);
  assert.match(m, /<p class="ja-aw-priv">[\s\S]*Winners stay private to you until the ceremony<\/p>/);
  // A panel's view says whose nominations these are.
  assert.match(board({ panelId: "p3" }), /Middle School · Panel 3 · <b>3 of 11<\/b> decided · 8 nominations for 4 teams/);
});

test("the division chips each count what they have decided; the panel chips count the teams each nominated; the pressed ones are the board's", () => {
  const m = board();
  const group = (name: string) => m.match(new RegExp(`<div class="ja-aw-fg" role="group" aria-labelledby="[^"]+"><span id="[^"]+" class="ja-aw-cl">${name}</span>([\\s\\S]*?)</div></div>`))![1];
  const chips = (g: string) => [...g.matchAll(/<button type="button" class="ja-aw-chip" aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)].map((c) => `${c[1]} ${text(c[2])}`);
  assert.deepEqual(chips(group("Division")), [
    "false ESElementary School0/11 decided",
    "true MSMiddle School3/11 decided",
    "false HSHigh School0/11 decided",
    "false BlendedBlended0/11 decided",
  ]);
  assert.deepEqual(chips(group("Panel")), ["true All panels9 teams", "false Panel 25 teams", "false Panel 34 teams"]);
  assert.deepEqual(chips(group("Panel")).length, 3);
  assert.deepEqual(chips(group("Panel")).map((c) => c.split(" ")[0]), ["true", "false", "false"]);
  assert.match(board({ panelId: "p3" }), /aria-pressed="true"[^>]*>Panel 3<span class="ja-aw-fn">4/);
  // Another division: its own panels, and its own count.
  assert.deepEqual(chips(group("Panel")).length, 3);
  const hs = board({ division: HS });
  assert.match(hs, /aria-pressed="true" title="High School"><span aria-hidden="true">HS<\/span>/);
  assert.match(hs, /Panel 4<span class="ja-aw-fn">1/);
  assert.doesNotMatch(hs, /Panel 2<span/, "Middle School's panels are not High School's");
  // A division with no panel has no panel filter to offer.
  assert.doesNotMatch(board({ division: "Blended" }), /class="ja-aw-cl">Panel</);
});

/* ---- the matrix ------------------------------------------------------------------------------ */

test("the matrix: nominated teams only, most nominations first, one column per nominated award, and a tick under the decided ones", () => {
  const m = board();
  assert.equal(m.includes("<table"), true);
  assert.equal(m.includes("ja-aw-aps"), false);
  assert.deepEqual(bodyRows(m), ["5150Z", "7700B", "4242F", "6060R", "8015M", "9882K", "1234A", "2088C", "3311X"]);
  const head = m.match(/<thead>[\s\S]*?<\/thead>/)![0];
  assert.deepEqual([...head.matchAll(/<abbr class="ja-aw-hl" title="([^"]+)">(.*?)<\/abbr>/g)].map((a) => `${a[2]}=${a[1]}`), [
    "Exc=Excellence", "Des=Design", "Inn=Innovate", "Thk=Think", "Amz=Amaze", "Bld=Build", "Cre=Create", "Jdg=Judges", "Ins=Inspire", "Spt=Sportsmanship",
  ]);
  // Design, Think and Amaze are decided: three ticks, and the other seven columns have none.
  assert.equal(head.match(/role="img" aria-label="decided"/g)?.length, 3);
  assert.match(head, /<abbr class="ja-aw-hl" title="Design">Des<\/abbr><span class="ja-aw-hk"><svg[^>]*aria-label="decided"/);
  assert.match(head, /<abbr class="ja-aw-hl" title="Excellence">Exc<\/abbr><span class="ja-aw-hk"><\/span>/);
  // The table says how many columns it has, so its box can scroll when they do not fit.
  assert.match(m, /<table style="--n:10">/);
});

test("a row: the team number, its name (or what it has won), and a panel tag; a cell is a button saying what it is", () => {
  const m = board();
  const tr = (number: string) => m.match(new RegExp(`<tr><th scope="row" class="ja-aw-tm"><b>${number}</b>[\\s\\S]*?</tr>`))![0];
  assert.match(tr("7700B"), /<span class="ja-aw-sub">Byte Me<\/span><\/th><td class="ja-aw-pn"><span class="ja-aw-ptag">P2<\/span>/);
  assert.match(tr("5150Z"), /<span class="ja-aw-sub ja-aw-has">Has Amaze<\/span><\/th><td class="ja-aw-pn"><span class="ja-aw-ptag">P3<\/span>/, "in green, in place of its name");
  assert.deepEqual([...tr("7700B").matchAll(/aria-label="([^"]+)"/g)].map((c) => c[1]), ["7700B, Excellence: nominated", "7700B, Design: nominated"]);
  assert.deepEqual([...tr("5150Z").matchAll(/aria-label="([^"]+)"/g)].map((c) => c[1]), ["5150Z, Excellence: nominated", "5150Z, Innovate: nominated", "5150Z, Amaze: winner"]);
  // A nomination is a plain dot (no count), a winner a filled tick, and not nominated is an empty cell.
  assert.match(tr("7700B"), /<button type="button" class="ja-aw-cell" aria-pressed="false" aria-label="7700B, Excellence: nominated"><i class="ja-aw-mk" aria-hidden="true"><\/i><\/button>/);
  assert.match(tr("5150Z"), /<button type="button" class="ja-aw-cell ja-aw-won" aria-pressed="false" aria-label="5150Z, Amaze: winner"><svg/);
  assert.equal(tr("7700B").match(/<td><\/td>/g)?.length, 8, "ten columns, two of them nominations");
});

test("under the table a key, and a note naming the column that is hidden", () => {
  const m = board();
  const key = m.match(/<p class="ja-aw-key">[\s\S]*?<\/p>/)![0];
  assert.match(key, /nominated/);
  assert.match(key, /winner/);
  assert.match(text(key), /Only nominated teams are listed\. Energy has no nominations yet, so its column is hidden\.$/);
  // Under a panel, whose nominations there are none of.
  assert.match(text(board({ panelId: "p3" }).match(/<p class="ja-aw-key">[\s\S]*?<\/p>/)![0]), /Create, Inspire, Sportsmanship and Energy have no nominations from Panel 3, so their columns are hidden\.$/);
});

test("the selected cell is pressed and its award's column header is marked; nothing is when nothing is selected", () => {
  const m = board({ sel: excellence7700B });
  assert.match(m, /<th scope="col" class="ja-aw-on"><abbr class="ja-aw-hl" title="Excellence">/);
  assert.equal(m.match(/class="ja-aw-on"/g)?.length, 1);
  assert.deepEqual([...m.matchAll(/aria-pressed="true" aria-label="([^"]+)"/g)].map((c) => c[1]), ["7700B, Excellence: nominated"]);
  assert.doesNotMatch(board(), /ja-aw-on|aria-pressed="true" aria-label/);
  // The winner's cell can be the selected one too.
  assert.match(board({ sel: { awardId: "amaze", teamId: gearGrinders.id } }), /class="ja-aw-cell ja-aw-won" aria-pressed="true" aria-label="5150Z, Amaze: winner"/);
});

test("with nobody nominated the matrix says so instead of drawing an empty table", () => {
  const m = board({ data: { awards, nominations: [], winners: [] } });
  assert.doesNotMatch(m, /<table/);
  assert.match(m, /No nominations in Middle School yet\. Judges nominate the teams they have interviewed\./);
  assert.match(board({ division: "Blended" }), /No nominations in Blended yet/);
  assert.match(board({ panelId: "p3", data: { awards, nominations: nominations.filter((n) => n.panel_id !== "p3"), winners: [] } }), /No nominations in Middle School from Panel 3 yet/);
});

/* ---- by award ----------------------------------------------------------------------------------- */

test("By award: a panel per award in the config's order, every one shown, with how many nominees or Decided or Open", () => {
  const m = board({ view: "award" });
  assert.equal(m.includes("<table"), false);
  const all = sections(m);
  assert.deepEqual(all.map((s) => s.name), awards.map((a) => `${a.label} Award`));
  const status = (name: string) => all.find((s) => s.name === `${name} Award`)!.body.match(/<span class="ja-aw-cst[^"]*">(.*?)<\/span>/)![1];
  assert.deepEqual(["Excellence", "Design", "Create", "Energy"].map(status), ["2 nominees", "Decided", "1 nominee", "Open"]);
  assert.match(all.find((s) => s.name === "Design Award")!.body, /<header class="ja-aw-aph"><h2 title="[^"]+">Design<\/h2><span class="ja-aw-cst ja-aw-ok">Decided<\/span>/);
  assert.match(m, /<section class="ja-aw-ap ja-aw-dec" aria-label="Design Award">/);
  assert.match(all.find((s) => s.name === "Energy Award")!.body, /<p class="ja-aw-cnone">No nominations yet<\/p>/);
});

test("a nominee row: number, name, a caution when the team has another award, its panel, how many judges, and a Winner chip on the winner", () => {
  const m = board({ view: "award" });
  const rowsOf = (name: string) => [...sections(m).find((s) => s.name === `${name} Award`)!.body.matchAll(/<li><button[\s\S]*?<\/button><\/li>/g)].map((r) => r[0]);
  const [first, second] = rowsOf("Excellence");
  assert.match(first, /aria-label="7700B Byte Me, Excellence, 2 judges"><b>7700B<\/b><span class="ja-aw-nm">Byte Me<\/span><span class="ja-aw-ptag">P2<\/span><span class="ja-aw-jc">2 judges<\/span><\/button>/);
  assert.match(second, /aria-label="5150Z Gear Grinders, Excellence, 1 judge, Already has Amaze"><b>5150Z<\/b>/);
  assert.match(second, /<span class="ja-aw-cau" title="Already has Amaze"><svg/);
  assert.match(second, /<span class="ja-aw-jc">1 judge<\/span><\/button>/);
  const [winner] = rowsOf("Design");
  assert.match(winner, /<button type="button" class="ja-aw-nr ja-aw-won" aria-pressed="false" aria-label="2088C Lab Rats, Design, winner">/);
  assert.match(winner, /<span class="ja-aw-win"><svg[^>]*><path d="M5 12.5l4.5 4.5L19 7.5"><\/path><\/svg>Winner<\/span><\/button>/);
  assert.equal(rowsOf("Think")[0].includes("ja-aw-win"), true);
  assert.equal(rowsOf("Excellence").some((r) => r.includes("ja-aw-win")), false, "no winner, no chip");
});

test("the selected row is pressed in its own award's list only", () => {
  const m = board({ view: "award", sel: excellence7700B });
  assert.deepEqual([...m.matchAll(/aria-pressed="true" aria-label="([^"]+)"/g)].map((c) => c[1]), ["7700B Byte Me, Excellence, 2 judges"]);
  assert.equal(m.match(/aria-pressed="true" aria-label/g)?.length, 1, "one row, in one list");
});

/* ---- the toggle ------------------------------------------------------------------------------------ */

test("Matrix | By award is a pair of pressed/not-pressed buttons, and a press asks for the other view", () => {
  const m = renderToStaticMarkup(<ViewToggle view="matrix" onView={noop} />);
  assert.match(m, /<div class="ja-aw-seg" role="group" aria-label="View"><button type="button" aria-pressed="true">Matrix<\/button><button type="button" aria-pressed="false">By award<\/button><\/div>/);
  assert.match(renderToStaticMarkup(<ViewToggle view="award" onView={noop} />), /aria-pressed="false">Matrix<\/button><button type="button" aria-pressed="true">By award/);

  const asked: View[] = [];
  const buttons = walk(ViewToggle({ view: "matrix", onView: (v) => asked.push(v) })).filter((e) => e.type === "button");
  click(buttons[1]);
  click(buttons[0]);
  assert.deepEqual(asked, ["award", "matrix"]);
});

test("the toggle swaps the views: the matrix is a table, By award is a panel per award, and the board shows one at a time", () => {
  const matrix = board({ view: "matrix" });
  const lists = board({ view: "award" });
  assert.ok(matrix.includes('<div class="ja-aw-mx">') && !matrix.includes("ja-aw-ap"));
  assert.ok(lists.includes("ja-aw-aps") && !lists.includes("ja-aw-mx"));
  assert.match(matrix, /aria-pressed="true">Matrix<\/button>/);
  assert.match(lists, /aria-pressed="true">By award<\/button>/);
  // Same title, same filters, same panel region either way.
  const head = (m: string) => m.slice(0, m.indexOf('<div class="ja-aw-cols">'));
  assert.equal(head(matrix).replace(/aria-pressed="(true|false)">(Matrix|By award)/g, ""), head(lists).replace(/aria-pressed="(true|false)">(Matrix|By award)/g, ""));
});

test("both views open the same side panel on the same nominee", () => {
  const fromMatrix = board({ view: "matrix", sel: excellence7700B });
  const fromLists = board({ view: "award", sel: excellence7700B });
  assert.ok(aside(fromMatrix).length > 200);
  assert.equal(aside(fromMatrix), aside(fromLists), "one panel, whichever view opened it");

  // A tap in either view selects the same thing.
  const matrix = buildMatrix(awards, nominationsIn(nominations, teams, MS), winnersOf(winners, MS), teams.filter((t) => t.division === MS), panels);
  const picks: (Sel | null)[] = [];
  const cell = walk(MatrixView({ matrix, sel: null, note: "", none: "", onSelect: (s) => picks.push(s) })).find((e) => e.props["aria-label"] === "7700B, Excellence: nominated")!;
  click(cell);
  const lists = buildAwardPanels(awards, nominationsIn(nominations, teams, MS), winnersOf(winners, MS), teams.filter((t) => t.division === MS), panels);
  const row = walk(AwardLists({ lists, sel: null, onSelect: (s) => picks.push(s) })).find((e) => e.props["aria-label"] === "7700B Byte Me, Excellence, 2 judges")!;
  click(row);
  assert.deepEqual(picks, [excellence7700B, excellence7700B]);

  // Tapping the selected one again closes the panel.
  const again: (Sel | null)[] = [];
  click(walk(MatrixView({ matrix, sel: excellence7700B, note: "", none: "", onSelect: (s) => again.push(s) })).find((e) => e.props["aria-label"] === "7700B, Excellence: nominated")!);
  click(walk(AwardLists({ lists, sel: excellence7700B, onSelect: (s) => again.push(s) })).find((e) => e.props["aria-label"] === "7700B Byte Me, Excellence, 2 judges")!);
  assert.deepEqual(again, [null, null]);
});

/* ---- the side panel ------------------------------------------------------------------------------------- */

test("the side panel: the award and division, the team, its scores and band, and why the panel nominated it", () => {
  const p = aside(board({ sel: excellence7700B }));
  assert.match(p, /^<aside class="ja-aw-dr" aria-label="Excellence · 7700B">/);
  assert.match(p, /<p class="ja-aw-eyebrow">Excellence · Middle School<\/p>/);
  assert.match(p, /<h2 id="[^"]+">7700B<span>Byte Me<\/span><\/h2>/);
  const row = rows.find((r) => r.team.id === byteMe.id)!;
  assert.match(p, new RegExp(`<p class="ja-aw-dst"><span>${notebook.name} <b>\\d+/${notebook.max}</b></span><span>${interview.name} <b>\\d+/${interview.max}</b></span><span><b>${row.total}/${row.max}</b></span><span class="jg-band`));
  assert.match(p, /<h3 class="ja-aw-sec">Why Panel 2 nominated them<\/h3><ul class="ja-aw-qs"><li class="ja-aw-ql"><div class="ja-aw-qt"><b>Priya Nair<\/b>“Every entry names who did the work\.”<\/div><button type="button" class="ja-aw-lnk ja-aw-rm" aria-label="Remove Priya Nair&#x27;s nomination">Remove<\/button><\/li><li class="ja-aw-ql"><div class="ja-aw-qt"><b>Sam Rivera<\/b>“Top notebook, and strong in every match\.”<\/div><button[^>]*>Remove<\/button><\/li><\/ul>/);
  // Teams without scores yet have no line, rather than a wrong one.
  assert.doesNotMatch(aside(board({ sel: excellence7700B, rows: [] })), /ja-aw-dst/);
});

test("a judge who gave no reason is still listed, as 'No reason given'", () => {
  const p = aside(board({ sel: { awardId: "design", teamId: byteMe.id } }));
  assert.match(p, /<b>Sam Rivera<\/b><span class="ja-aw-q0">No reason given<\/span><\/div><button/);
});

test("also nominated for, and the referee flags: Good conduct in green, or 'No referee flags'", () => {
  const p = aside(board({ sel: excellence7700B }));
  assert.match(p, /<p class="ja-aw-also">Also nominated for Design · <span class="ja-aw-good">Good conduct ×1<\/span><\/p>/);
  const clean = aside(board({ sel: { awardId: "excellence", teamId: gearGrinders.id } }));
  assert.match(clean, /<p class="ja-aw-also">Also nominated for Innovate, Amaze · No referee flags<\/p>/);
  // The worst of the rest is the amber one.
  const warned = renderToStaticMarkup(
    <NomineePanel detail={detailFor(excellence7700B, { awards, nominations, winners, teams, panels })!} row={undefined} rubricList={rubricList} flags={[flag(byteMe, "good"), flag(byteMe, "warning"), flag(byteMe, "warning")]} flagKinds={flagKinds} titleId="t" busy={false} onGive={noop} onClear={noop} onNominate={noop} onRemove={noop} />,
  );
  assert.match(warned, /<span class="ja-aw-good">Good conduct ×1<\/span>, <span class="ja-aw-caut">Warning ×2<\/span>/);
});

test("the other nominees for the award, each with how many judges and the caution if it already has another award", () => {
  const p = aside(board({ sel: excellence7700B }));
  assert.match(p, /<h3 class="ja-aw-sec">Other Excellence nominee<\/h3>/);
  assert.match(p, /<div class="ja-aw-oth"><div><p><b>5150Z<\/b> Gear Grinders · 1 judge<\/p><p class="ja-aw-warnl"><svg[^>]*>[\s\S]*?<\/svg>Already has Amaze<\/p><\/div><\/div>/);
  // A rival that holds the award wears the Winner chip, so a replacement shows who it takes it from.
  const design = aside(board({ sel: { awardId: "design", teamId: byteMe.id } }));
  assert.match(design, /<b>2088C<\/b> Lab Rats · 1 judge<\/p><\/div><span class="ja-aw-win">/);
  // A lone nominee has no one to list.
  assert.doesNotMatch(aside(board({ sel: { awardId: "amaze", teamId: gearGrinders.id } })), /Other Amaze/);
});

test("the button gives the award, and the line under it says it can be changed; a team that already has another award still gets it, with a caution beside it", () => {
  const p = aside(board({ sel: excellence7700B }));
  assert.match(p, /<button type="button" class="ja-aw-prim">Give Excellence to 7700B<\/button><p class="ja-aw-note">You can change it until the ceremony\.<\/p>/);
  assert.doesNotMatch(p.split("<h3")[0], /ja-aw-warnl/, "7700B holds nothing else, so no caution under its name");
  const holds = aside(board({ sel: { awardId: "excellence", teamId: gearGrinders.id } }));
  assert.match(holds, /<p class="ja-aw-warnl"><svg[^>]*>[\s\S]*?<\/svg>Already has Amaze<\/p>/, "the caution is on the nominee itself");
  assert.match(holds, /<button type="button" class="ja-aw-prim">Give Excellence to 5150Z<\/button>/, "and the button is not off for it");
  // While a write is in the air, the button waits.
  assert.match(aside(board({ sel: excellence7700B, busy: true })), /<button type="button" class="ja-aw-prim" disabled="">Saving…<\/button>/);
});

test("on the winner the button is a green Winner chip and a quiet Clear winner link", () => {
  const p = aside(board({ sel: { awardId: "design", teamId: labRats.id } }));
  assert.match(p, /<div class="ja-aw-held"><span class="ja-aw-win"><svg[\s\S]*?<\/svg>Winner<\/span><button type="button" class="ja-aw-lnk">Clear winner<\/button><\/div>/);
  assert.doesNotMatch(p, /ja-aw-prim|You can change it/);
});

test("the buttons hand the picked nominee to the board: Give with the detail, Clear with the detail", () => {
  const given: Detail[] = [];
  const cleared: Detail[] = [];
  const mine = detailFor({ awardId: "design", teamId: byteMe.id }, { awards, nominations, winners, teams, panels })!;
  const give = walk(NomineePanel({ detail: mine, row: undefined, rubricList, flags: [], flagKinds, titleId: "t", busy: false, onGive: (d) => given.push(d), onClear: (d) => cleared.push(d), onNominate: noop, onRemove: noop })).find((e) => e.props.className === "ja-aw-prim")!;
  click(give);
  assert.equal(given[0].team.number, "7700B");
  assert.equal(given[0].current?.number, "2088C", "what it would replace is in the detail");
  const held = detailFor({ awardId: "design", teamId: labRats.id }, { awards, nominations, winners, teams, panels })!;
  const clear = walk(NomineePanel({ detail: held, row: undefined, rubricList, flags: [], flagKinds, titleId: "t", busy: false, onGive: noop, onClear: (d) => cleared.push(d), onNominate: noop, onRemove: noop })).find((e) => e.props.className === "ja-aw-lnk")!;
  click(clear);
  assert.equal(cleared[0].team.number, "2088C");
  assert.equal(cleared[0].isWinner, true);
});

test("before anything is picked the column holds a hint, not a panel", () => {
  const m = board();
  assert.match(aside(m), /^<aside class="ja-aw-dr ja-aw-dr0" aria-label="Nominee"><p>Pick a nomination to see who made it, and why\.<\/p><\/aside>$/);
});

/* ---- a winner nobody nominates any more ------------------------------------------------------------------ */

test("a judge can withdraw after a winner is set: the winner keeps its row, its tick and its panel, and nothing breaks", () => {
  const left = { awards, nominations: nominations.filter((n) => n.team_id !== labRats.id), winners };
  const matrix = board({ data: left });
  assert.ok(bodyRows(matrix).includes("2088C"), "the row is still there");
  assert.match(matrix, /aria-label="2088C, Design: winner"/);
  assert.match(matrix, /<span class="ja-aw-sub ja-aw-has">Has Design<\/span>/);
  // By award it is listed with no judges left, still the winner.
  const lists = board({ data: left, view: "award" });
  assert.match(lists, /aria-label="2088C Lab Rats, Design, winner"[\s\S]*?<span class="ja-aw-jc">Withdrawn<\/span><span class="ja-aw-win">/);
  // Its panel opens with nothing to quote, and can still be cleared.
  const p = aside(board({ data: left, sel: { awardId: "design", teamId: labRats.id } }));
  assert.match(p, /No judge is nominating 2088C for Design any more\./);
  assert.match(p, /Clear winner/);
  // The header's tally does not count nominations that are gone.
  assert.match(matrix, /<b>3 of 11<\/b> decided · 17 nominations for 8 teams/);
});

test("a nominee nobody nominates any more (the last nomination removed, or withdrawn elsewhere) offers no Give, only a way back; the winner keeps its Clear", () => {
  // 7700B's Design nomination was Sam's alone; once it is gone the panel is still open on it.
  const gone = { awards, nominations: nominations.filter((n) => !(n.team_id === byteMe.id && n.award_id === "design")), winners: winners.filter((w) => w.award_id !== "design") };
  const sel = { awardId: "design", teamId: byteMe.id };
  const p = aside(board({ data: gone, sel }));
  assert.match(p, /No judge is nominating 7700B for Design any more\./);
  assert.doesNotMatch(p, /ja-aw-prim|Give Design|You can change it/, "the server would refuse it: not nominated");
  assert.match(p, /<button type="button" class="ja-aw-lnk">Nominate for Design<\/button>/);
  assert.match(aside(board({ data: gone, sel, busy: true })), /class="ja-aw-lnk" disabled="">Nominate for Design/);

  // The way back nominates it as the Judge Advisor, through the same handler as Also nominate for….
  const nominated: [string, string][] = [];
  const detail = detailFor(sel, { awards, nominations: gone.nominations, winners: gone.winners, teams, panels })!;
  const back = walk(NomineePanel({ detail, row: undefined, rubricList, flags: [], flagKinds, titleId: "t", busy: false, onGive: noop, onClear: noop, onNominate: (a, t) => nominated.push([a, t]), onRemove: noop })).find((e) => e.props.className === "ja-aw-lnk")!;
  click(back);
  assert.deepEqual(nominated, [["design", byteMe.id]]);

  // Still nominated by anyone (a judge, the Judge Advisor, or referees' Good conduct): Give is there.
  assert.match(aside(board({ sel })), /Give Design to 7700B/);
  const jaOnly = { ...gone, nominations: [...gone.nominations, adminNom(byteMe, "design")] };
  assert.match(aside(board({ data: jaOnly, sel })), /Give Design to 7700B/);
  assert.match(aside(board({ sel: { awardId: "sportsmanship", teamId: quiet.id }, flags: conductFlags })), /Give Sportsmanship to 1111Q/);
  // The winner nobody nominates is unchanged: the chip and Clear winner, and no way back to offer.
  const held = aside(board({ data: { awards, nominations: nominations.filter((n) => n.team_id !== labRats.id), winners }, sel: { awardId: "design", teamId: labRats.id } }));
  assert.match(held, /Clear winner/);
  assert.doesNotMatch(held, /Nominate for|ja-aw-prim/);
});

test("a selection whose team or nomination has gone shows no panel and does not crash", () => {
  assert.match(aside(board({ sel: { awardId: "excellence", teamId: "t-gone" } })), /ja-aw-dr0/);
  assert.match(aside(board({ sel: { awardId: "retired", teamId: byteMe.id } })), /ja-aw-dr0/);
});

test("no awards in the config, or no divisions, is said plainly", () => {
  assert.match(board({ data: { awards: [], nominations: [], winners: [] } }), /No awards are set up/);
  const none = renderToStaticMarkup(
    <AwardsBoard data={data} state={{ ...state, divisions: [] }} rows={[]} rubricList={rubricList} division="" onDivision={noop} onPanel={noop} view="matrix" onView={noop} sel={null} onSelect={noop} onGive={noop} onClear={noop} onNominate={noop} onRemove={noop} />,
  );
  assert.match(none, /No divisions yet/);
});

/* ---- Good conduct from referees: two flags are a nomination for Sportsmanship, drawn in green ---------------------- */

const sportsmanship = (teamId: string): Sel => ({ awardId: "sportsmanship", teamId });

test("the matrix: a team referees flagged for Good conduct twice has a row and a green dot under Sportsmanship, and the key says what the dot is", () => {
  const m = board({ flags: conductFlags });
  const tr = (number: string) => m.match(new RegExp(`<tr><th scope="row" class="ja-aw-tm"><b>${number}</b>[\\s\\S]*?</tr>`))![0];
  assert.ok(bodyRows(m).includes("1111Q"), "Quiet Ones: no judge, still a row");
  assert.match(tr("1111Q"), /<span class="ja-aw-sub">Quiet Ones<\/span><\/th><td class="ja-aw-pn"><span class="ja-aw-ptag">P2<\/span>/);
  assert.deepEqual([...tr("1111Q").matchAll(/aria-label="([^"]+)"/g)].map((c) => c[1]), ["1111Q, Sportsmanship: nominated by referees (Good conduct ×3)"]);
  assert.match(tr("1111Q"), /<button type="button" class="ja-aw-cell" aria-pressed="false" aria-label="1111Q, Sportsmanship: nominated by referees \(Good conduct ×3\)"><i class="ja-aw-mk ja-aw-gd" aria-hidden="true"><\/i><\/button>/);
  // A judge's nomination keeps the plain ink dot, whatever the referees say.
  assert.match(tr("9882K"), /aria-label="9882K, Sportsmanship: nominated"><i class="ja-aw-mk" aria-hidden="true"><\/i><\/button>/);
  // One flag is not a nomination: Byte Me gets no cell of it.
  assert.doesNotMatch(tr("7700B"), /Sportsmanship/);
  // The key gains a third entry: the green dot.
  const key = m.match(/<p class="ja-aw-key">[\s\S]*?<\/p>/)![0];
  assert.match(key, /<\/b>winner<\/span><span><b class="ja-aw-cell" aria-hidden="true"><i class="ja-aw-mk ja-aw-gd"><\/i><\/b>Good conduct ×2\+<\/span><span>Only nominated teams/);
  // Without two flags nothing is drawn green on the board itself.
  assert.equal(board().match(/ja-aw-mk ja-aw-gd/g)?.length, 1, "only the key's");
  assert.equal(m.match(/ja-aw-mk ja-aw-gd/g)?.length, 2, "the key's and Quiet Ones'");
});

test("the Sportsmanship column appears when only referees put someone up, and the winner of it is a tick", () => {
  const judged = nominations.filter((n) => n.award_id !== "sportsmanship");
  const flagged = board({ data: { awards, nominations: judged, winners }, flags: conductFlags });
  assert.match(flagged, /<abbr class="ja-aw-hl" title="Sportsmanship">Spt<\/abbr>/);
  assert.match(text(flagged.match(/<p class="ja-aw-key">[\s\S]*?<\/p>/)![0]), /Only nominated teams are listed\. Energy has no nominations yet, so its column is hidden\.$/, "Sportsmanship's column is not among the hidden");
  const bare = board({ data: { awards, nominations: judged, winners }, flags: [] });
  assert.doesNotMatch(bare, /<abbr class="ja-aw-hl" title="Sportsmanship">/);
  assert.match(text(bare.match(/<p class="ja-aw-key">[\s\S]*?<\/p>/)![0]), /Sportsmanship and Energy have no nominations yet, so their columns are hidden\.$/);

  const won = board({ data: { awards, nominations, winners: [...winners, { award_id: "sportsmanship", division: MS, team_id: quiet.id, decided_by: "Alex Morgan", decided_at: "2026-10-20T15:00:00Z" }] }, flags: conductFlags });
  assert.match(won, /<button type="button" class="ja-aw-cell ja-aw-won" aria-pressed="false" aria-label="1111Q, Sportsmanship: winner"><svg/);
  assert.match(won, /<span class="ja-aw-sub ja-aw-has">Has Sportsmanship<\/span>/);
});

test("the header and the All panels chip count each Good conduct team once; a panel's own view leaves them out", () => {
  const m = board({ flags: conductFlags });
  assert.match(m, /<p class="ja-aw-meta">Middle School · all panels · <b>3 of 11<\/b> decided · 20 nominations for 10 teams<\/p>/, "18 by judges, and one each for Quiet Ones and Torque Titans");
  assert.match(m, /aria-pressed="true">All panels<span class="ja-aw-fn">10<span class="sr-only"> teams<\/span><\/span>/);
  assert.match(m, /Panel 2<span class="ja-aw-fn">5</, "a panel's chip is what that panel nominated");
  const p2 = board({ flags: conductFlags, panelId: "p2" });
  assert.match(p2, /Middle School · Panel 2 · <b>3 of 11<\/b> decided · 10 nominations for 5 teams/);
  assert.ok(!bodyRows(p2).includes("1111Q"));
  assert.match(board({ flags: [flag(byteMe, "good")] }), /18 nominations for 9 teams/, "one flag changes nothing");
  assert.match(board({ flags: conductFlags, data: { awards, nominations, winners: [] } }), /<b>0 of 11<\/b> decided/, "the decided counts are the winners', not the flags'");
});

test("the matrix sorts a Good conduct team as one nomination", () => {
  const rowsOf = bodyRows(board({ flags: conductFlags }));
  assert.deepEqual(rowsOf, ["5150Z", "7700B", "4242F", "6060R", "8015M", "9882K", "1111Q", "1234A", "2088C", "3311X"], "after the two-nomination teams, among the one-nomination ones by number");
});

test("By award: a Good conduct team's row says so in green in place of judges, a team with both says both, and the status counts it", () => {
  const m = board({ view: "award", flags: conductFlags });
  const spt = sections(m).find((s) => s.name === "Sportsmanship Award")!.body;
  assert.match(spt, /<span class="ja-aw-cst">2 nominees<\/span>/);
  const rowsOf = [...spt.matchAll(/<li><button[\s\S]*?<\/button><\/li>/g)].map((r) => r[0]);
  assert.equal(rowsOf.length, 2);
  assert.match(rowsOf[0], /aria-label="9882K Torque Titans, Sportsmanship, 1 judge, Good conduct ×2"><b>9882K<\/b>/);
  assert.match(rowsOf[0], /<span class="ja-aw-jc">1 judge, <span class="ja-aw-good">Good conduct ×2<\/span><\/span>/);
  assert.match(rowsOf[1], /aria-label="1111Q Quiet Ones, Sportsmanship, Good conduct ×3"><b>1111Q<\/b><span class="ja-aw-nm">Quiet Ones<\/span><span class="ja-aw-ptag">P2<\/span><span class="ja-aw-jc"><span class="ja-aw-good">Good conduct ×3<\/span><\/span><\/button>/);
  assert.doesNotMatch(rowsOf[1], /judge/, "no judges to count");
  // No other award carries it.
  assert.doesNotMatch(sections(m).filter((s) => s.name !== "Sportsmanship Award").map((s) => s.body).join(""), /Good conduct/);
  // Without two flags Sportsmanship is the judge's alone.
  assert.match(sections(board({ view: "award" })).find((s) => s.name === "Sportsmanship Award")!.body, /<span class="ja-aw-cst">1 nominee<\/span>/);
});

test("the side panel for a Good conduct team lists each flag with who saw it, the match and the note, in place of the judges' reasons", () => {
  const p = aside(board({ sel: sportsmanship(quiet.id), flags: conductFlags }));
  assert.match(p, /<h2 id="[^"]+">1111Q<span>Quiet Ones<\/span><\/h2>/);
  assert.match(p, /<h3 class="ja-aw-sec ja-aw-good">Good conduct from referees<\/h3><ul class="ja-aw-qs ja-aw-gc">/);
  const items = [...p.matchAll(/<li><b>([^<]*)<\/b>(.*?)<\/li>/g)].map((m) => [m[1], text(m[2])]);
  assert.deepEqual(items, [
    ["Ana Cruz · Q3", "“Lent the other alliance a cable.”"],
    ["Jordan Lee · Q9", "No note"],
    ["Ana Cruz · QF 2-1", "“Cheered for both teams.”"],
  ]);
  assert.doesNotMatch(p, /Why Panel|No judge is nominating/, "no judge, and no complaint about it");
  assert.match(p, /<p class="ja-aw-also"><span class="ja-aw-good">Good conduct ×3<\/span><\/p>/, "nothing else to be nominated for; the flags the line already shows");
  // The award can be given.
  assert.match(p, /<button type="button" class="ja-aw-prim">Give Sportsmanship to 1111Q<\/button><p class="ja-aw-note">You can change it until the ceremony\.<\/p>/);
  // Its rival is the judge's nominee, with both sorts of backing.
  assert.match(p, /<h3 class="ja-aw-sec">Other Sportsmanship nominee<\/h3><div class="ja-aw-oth"><div><p><b>9882K<\/b> Torque Titans · 1 judge, <span class="ja-aw-good">Good conduct ×2<\/span><\/p>/);
});

test("a team with a judge's nomination and the referees' flags gets both sections; another award's panel for it gets only the judges'", () => {
  const p = aside(board({ sel: sportsmanship(torque.id), flags: conductFlags }));
  assert.match(p, /<h3 class="ja-aw-sec">Why Panel 2 nominated them<\/h3><ul class="ja-aw-qs"><li class="ja-aw-ql"><div class="ja-aw-qt"><b>Priya Nair<\/b><span class="ja-aw-q0">No reason given<\/span><\/div><button[^>]*>Remove<\/button><\/li><\/ul><h3 class="ja-aw-sec ja-aw-good">Good conduct from referees<\/h3>/);
  assert.doesNotMatch(p.split("Good conduct from referees")[1].split("</ul>")[0], /Remove/, "a Good conduct flag is not a nomination: nothing to remove");
  assert.deepEqual([...p.matchAll(/<ul class="ja-aw-qs ja-aw-gc">([\s\S]*?)<\/ul>/g)].map((m) => text(m[1])), ["Ana Cruz · Q4“Reset the field for the next match.”Jordan Lee · Q11No note"]);
  assert.match(p, /<b>1111Q<\/b> Quiet Ones · <span class="ja-aw-good">Good conduct ×3<\/span><\/p>/, "the flag-only rival has no judges to count");
  assert.match(p, /Give Sportsmanship to 9882K/);

  const build = aside(board({ sel: { awardId: "build", teamId: torque.id }, flags: conductFlags }));
  assert.doesNotMatch(build, /Good conduct from referees|ja-aw-gc/, "Good conduct counts for Sportsmanship alone");
  assert.match(build, /Also nominated for Sportsmanship · <span class="ja-aw-good">Good conduct ×2<\/span>/);
  // One flag lists nothing.
  assert.doesNotMatch(aside(board({ sel: sportsmanship(torque.id), flags: [flag(torque, "good")] })), /Good conduct from referees/);
});

test("the Give button hands a Good conduct nominee to the board like any other", () => {
  const given: Detail[] = [];
  const d = detailFor(sportsmanship(quiet.id), { awards, nominations, winners, teams, panels, flags: conductFlags })!;
  const give = walk(NomineePanel({ detail: d, row: undefined, rubricList, flags: conductFlags.filter((f) => f.team_id === quiet.id), flagKinds, titleId: "t", busy: false, onGive: (x) => given.push(x), onClear: noop, onNominate: noop, onRemove: noop })).find((e) => e.props.className === "ja-aw-prim")!;
  click(give);
  assert.deepEqual([given[0].team.number, given[0].award.id, given[0].current], ["1111Q", "sportsmanship", null]);
  // And the cell opens its panel.
  const m = buildMatrix(awards, nominationsIn(nominations, teams, MS), winnersOf(winners, MS), teams.filter((t) => t.division === MS), panels, "", new Map([[quiet.id, 3]]));
  const picks: (Sel | null)[] = [];
  click(walk(MatrixView({ matrix: m, sel: null, note: "", none: "", onSelect: (s) => picks.push(s) })).find((e) => e.props["aria-label"] === "1111Q, Sportsmanship: nominated by referees (Good conduct ×3)")!);
  assert.deepEqual(picks, [sportsmanship(quiet.id)]);
});

/* ---- the Judge Advisor nominates and removes --------------------------------------------------------------------- */

// Quiet Ones: no judge nominated them, the Judge Advisor does. Byte Me: two judges and the Judge Advisor, all for Excellence.
const jaQuiet = adminNom(quiet, "excellence", "Deserves a look.");
const jaByte = adminNom(byteMe, "excellence");
const withJa: AwardsAdminView = { awards, nominations: [...nominations, jaQuiet, jaByte], winners };
const select = (markup: string, label: string) => markup.match(new RegExp(`<select class="ja-in ja-sel" aria-label="${label}"[^>]*>([\\s\\S]*?)</select>`));
const options = (selectMarkup: string) => [...selectMarkup.matchAll(/<option value="([^"]*)"( disabled="")?[^>]*>(.*?)<\/option>/g)].map((o) => `${o[1]}|${o[2] ? "off|" : ""}${o[3]}`);

test("By award: each award has an Add team picker of the division's teams in number order; one already added is marked and off", () => {
  const m = board({ view: "award", data: withJa });
  const excellence = sections(m).find((x) => x.name === "Excellence Award")!.body;
  const picker = select(excellence, "Add team to Excellence")!;
  assert.ok(picker, "a picker in every award's list");
  assert.deepEqual(options(picker[1]).slice(0, 4), ["|Add team…", "t-1111Q|off|1111Q Quiet Ones · added", "t-1234A|1234A Circuit Breakers", "t-2088C|2088C Lab Rats"]);
  assert.ok(options(picker[1]).includes("t-7700B|off|7700B Byte Me · added"), "the Judge Advisor already added Byte Me for Excellence");
  assert.ok(!picker[1].includes("t-9000H"), "High School's team is not Middle School's to add");
  assert.equal(options(picker[1]).length, 1 + 10, "the placeholder and the ten Middle School teams");
  // It marks only this award: Design is open to every team, Quiet Ones included.
  const design = select(sections(m).find((x) => x.name === "Design Award")!.body, "Add team to Design")!;
  assert.ok(options(design[1]).includes("t-1111Q|1111Q Quiet Ones"));
  assert.equal(sections(m).every((x) => select(x.body, `Add team to ${x.name.replace(" Award", "")}`)), true, "one per award, even an empty one");
  // The picker has the console's own select look, is not drawn in the matrix, and is off while a write is in the air.
  assert.match(excellence, /<div class="ja-aw-add"><div class="ja-selw"><select class="ja-in ja-sel"/);
  assert.doesNotMatch(board({ data: withJa }), /Add team/);
  assert.match(board({ view: "award", data: withJa, busy: true }), /aria-label="Add team to Excellence" disabled=""/);
});

test("Add team is for All panels: a panel's view has no picker, since the Judge Advisor's nomination belongs to no panel", () => {
  assert.doesNotMatch(board({ view: "award", data: withJa, panelId: "p2" }), /Add team|Judge Advisor|JA\b/);
});

test("choosing a team in the picker hands the award and the team to the board; choosing the placeholder sends nothing", () => {
  const added: [string, string][] = [];
  const lists = buildAwardPanels(awards, nominationsIn(withJa.nominations, teams, MS), winnersOf(winners, MS), teams.filter((t) => t.division === MS), panels);
  const picker = walk(AwardLists({ lists, sel: null, onSelect: noop, add: { teams: teams.filter((t) => t.division === MS), busy: false, onAdd: (a, t) => added.push([a, t]) } })).find((e) => e.props["aria-label"] === "Add team to Design")!;
  const change = picker.props.onChange as (e: { target: { value: string } }) => void;
  change({ target: { value: "" } });
  change({ target: { value: quiet.id } });
  assert.deepEqual(added, [["design", quiet.id]]);
  // Without `add` (a panel's view) the list has no picker at all.
  assert.equal(walk(AwardLists({ lists, sel: null, onSelect: noop })).some((e) => e.type === "select"), false);
});

test("the Judge Advisor's nomination counts on the board: the header, the row's words, the aria-label in full, and a team only they put up has a row", () => {
  assert.match(board({ data: withJa }), /Middle School · all panels · <b>3 of 11<\/b> decided · 20 nominations for 10 teams/);
  const m = board({ view: "award", data: withJa });
  const rowsOf = (name: string) => [...sections(m).find((x) => x.name === `${name} Award`)!.body.matchAll(/<li><button[\s\S]*?<\/button><\/li>/g)].map((r) => r[0]);
  const [first, second, third] = rowsOf("Excellence");
  assert.match(first, /aria-label="7700B Byte Me, Excellence, 2 judges · Judge Advisor"/);
  assert.match(first, /<span class="ja-aw-jc">2 judges · JA<\/span>/);
  assert.match(second, /aria-label="1111Q Quiet Ones, Excellence, Judge Advisor"/, "level with a single judge's, then by number");
  assert.match(second, /<span class="ja-aw-ptag">P2<\/span><span class="ja-aw-jc">JA<\/span>/, "its team's panel, since the Judge Advisor has none");
  assert.match(third, /5150Z/);
  assert.ok(bodyRows(board({ data: withJa })).includes("1111Q"), "and a row in the matrix");
  assert.doesNotMatch(board({ view: "award" }), /JA\b/, "nothing of it without one");
});

test("the side panel: Also nominate for… lists the awards the Judge Advisor has not nominated the team for, and choosing one hands it to the board", () => {
  const p = aside(board({ data: withJa, sel: excellence7700B }));
  const picker = select(p, "Also nominate 7700B for")!;
  const labels = options(picker[1]);
  assert.equal(labels[0], "|Also nominate for…");
  assert.ok(!labels.some((l) => l.endsWith("|Excellence")), "Excellence is the Judge Advisor's already");
  assert.ok(labels.includes("design|Design"));
  assert.equal(labels.length, 1 + awards.length - 1);
  // A team the Judge Advisor has nominated for every award has nothing to offer, and no picker.
  const everyAward = { ...withJa, nominations: [...nominations, ...awards.map((a) => adminNom(byteMe, a.id))] };
  assert.doesNotMatch(aside(board({ data: everyAward, sel: excellence7700B })), /<select/);
  // A nomination for an award a judge already made is still offered: the Judge Advisor's is its own.
  assert.ok(options(select(aside(board({ sel: excellence7700B })), "Also nominate 7700B for")![1]).includes("excellence|Excellence"));

  const picked: [string, string][] = [];
  const detail = detailFor(excellence7700B, { awards, nominations: withJa.nominations, winners, teams, panels })!;
  const el = walk(NomineePanel({ detail, row: undefined, rubricList, flags: [], flagKinds, titleId: "t", busy: false, onGive: noop, onClear: noop, onNominate: (a, t) => picked.push([a, t]), onRemove: noop })).find((e) => e.props["aria-label"] === "Also nominate 7700B for")!;
  (el.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "" } });
  (el.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "design" } });
  assert.deepEqual(picked, [["design", byteMe.id]]);
});

test("the side panel: every judge's line and the Judge Advisor's has a Remove; Good conduct from referees has none", () => {
  const p = aside(board({ data: withJa, sel: excellence7700B }));
  assert.match(p, /<h3 class="ja-aw-sec">Why the Judge Advisor nominated them<\/h3><ul class="ja-aw-qs"><li class="ja-aw-ql"><div class="ja-aw-qt"><b>Alex Morgan<\/b><span class="ja-aw-q0">No reason given<\/span><\/div><button type="button" class="ja-aw-lnk ja-aw-rm" aria-label="Remove the Judge Advisor&#x27;s nomination">Remove<\/button>/);
  assert.equal(p.match(/>Remove<\/button>/g)?.length, 3, "Priya, Sam and the Judge Advisor");
  assert.match(p, /aria-label="Remove Sam Rivera&#x27;s nomination"/);
  assert.match(aside(board({ data: withJa, sel: excellence7700B, busy: true })), /class="ja-aw-lnk ja-aw-rm" disabled=""/);

  const conductOnly = aside(board({ sel: sportsmanship(quiet.id), flags: conductFlags }));
  assert.doesNotMatch(conductOnly, /Remove/, "a Good conduct nominee has no row to remove");

  // The Judge Advisor alone: a section and a Remove, and no panel section.
  const only = aside(board({ data: withJa, sel: { awardId: "excellence", teamId: quiet.id } }));
  assert.match(only, /Why the Judge Advisor nominated them/);
  assert.match(only, /“Deserves a look\.”/);
  assert.doesNotMatch(only, /Why Panel/);
});

test("Remove hands the board the panel's detail and the nomination: its id, and whose it is for the question", () => {
  const removed: { detail: Detail; line: { id: string; by: string } }[] = [];
  const detail = detailFor(excellence7700B, { awards, nominations: withJa.nominations, winners, teams, panels })!;
  const buttons = walk(NomineePanel({ detail, row: undefined, rubricList, flags: [], flagKinds, titleId: "t", busy: false, onGive: noop, onClear: noop, onNominate: noop, onRemove: (d, line) => removed.push({ detail: d, line }) })).filter((e) => e.props.className === "ja-aw-lnk ja-aw-rm");
  assert.equal(buttons.length, 3);
  buttons.forEach(click);
  assert.deepEqual(
    removed.map((r) => [r.line.by, r.line.id]),
    [["Priya Nair", nominations.find((n) => n.judge === "Priya Nair" && n.award_id === "excellence" && n.team_id === byteMe.id)!.id], ["Sam Rivera", nominations.find((n) => n.judge === "Sam Rivera" && n.award_id === "excellence" && n.team_id === byteMe.id)!.id], ["the Judge Advisor", jaByte.id]],
  );
  assert.equal(removed[0].detail.team.number, "7700B");
});

/* ---- the phone --------------------------------------------------------------------------------------------- */

test("on a phone the panel is a bottom sheet over the board, not a column: a native dialog, shut until a nominee is picked", () => {
  const closed = board({ wide: false });
  assert.doesNotMatch(closed, /<aside/);
  assert.match(closed, /<dialog class="ja-sheet ja-aw-sheet" aria-modal="true" aria-labelledby="[^"]+"><\/dialog>/);

  const open = board({ wide: false, sel: excellence7700B });
  const dialog = open.match(/<dialog[\s\S]*?<\/dialog>/)![0];
  assert.match(dialog, /^<dialog class="ja-sheet ja-aw-sheet" aria-modal="true" aria-labelledby="([^"]+)">/);
  const id = dialog.match(/aria-labelledby="([^"]+)"/)![1];
  assert.match(dialog, new RegExp(`<h2 id="${id}">7700B<span>Byte Me</span></h2>`), "the sheet is named by the team");
  assert.match(dialog, /<div class="jg-grab" aria-hidden="true"><\/div><button type="button" class="ja-x ja-aw-sx" aria-label="Close">/);
  assert.match(dialog, /Give Excellence to 7700B/);
  // The same panel as the column's, inside the sheet's own wrapper.
  assert.equal(text(dialog.replace(/^[\s\S]*?<div class="ja-aw-dr">/, "").replace(/<\/div><\/dialog>$/, "")), text(aside(board({ sel: excellence7700B })).replace(/^<aside[^>]*>/, "").replace(/<\/aside>$/, "")));
});

/* ---- the wiring, read from source ---------------------------------------------------------------------------- */

test("replacing or clearing a winner asks through useConfirm; there is no window.confirm", () => {
  assert.ok(tab.includes("const { ask, dialog } = useConfirm();") && tab.includes("{dialog}"));
  assert.ok(tab.includes("giveAfterAsking(ask, call, { award: d.award, team: d.team, current: d.current })"));
  assert.ok(tab.includes("clearAfterAsking(ask, call, { award: d.award, team: d.team })"));
  assert.ok(!tab.includes("window.confirm") && !/(^|[^\w.])confirm\(/m.test(tab.replace(/\/\*[\s\S]*?\*\//g, "")));
  // The writes are the two routes the API already has, and only through the logic.
  assert.ok(!tab.replace(/\/\*[\s\S]*?\*\//g, "").includes("/api/awards"), "the markup sends nothing; awardsLogic does");
  const logic = read("src/components/admin/awardsLogic.ts");
  assert.ok(logic.includes('"/api/awards/winners", { method: "PUT"') && logic.includes('"/api/awards/winners", { method: "DELETE"'));
  assert.match(logic, /await ask\(giveQuestion\(award, team, current\), \{ confirmLabel: "Replace winner" \}\)/);
  assert.match(logic, /await ask\(clearQuestion\(award, team\), \{ confirmLabel: "Clear winner" \}\)/);
});

test("adding and removing a nomination go through the same one write at a time; Remove asks through useConfirm, Add does not", () => {
  const code = tab.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(code.includes("onNominate={(awardId, teamId) => write(() => nominateAsAdmin(call, { awardId, teamId }))}"));
  assert.ok(code.includes("onRemove={(d, line) => write(() => removeAfterAsking(ask, call, { ...line, award: d.award, team: d.team }))}"));
  assert.ok(!/(^|[^\w.])confirm\(/m.test(code) && !code.includes("window.confirm"));
  const logic = read("src/components/admin/awardsLogic.ts");
  assert.match(logic, /await ask\(removeQuestion\(pick\.by, pick\.award, pick\.team\), \{ confirmLabel: "Remove nomination", danger: true \}\)/);
  assert.ok(logic.includes('"/api/awards", { method: "POST"') && logic.includes('"/api/awards", { method: "DELETE", body: { id: pick.id } }'));
  const add = logic.slice(logic.indexOf("export async function nominateAsAdmin"), logic.indexOf("export const removeQuestion"));
  assert.ok(!add.includes("ask("), "adding is undone by Remove, so it does not ask");
});

test("one write at a time, the error goes to the page's banner, and the board is read again once it lands", () => {
  assert.match(tab, /if \(writing\.current\) return;\s*writing\.current = true;\s*setBusy\(true\);/);
  assert.match(tab, /if \(await job\(\)\) \{\s*onError\(null\);\s*await reload\(\);\s*\}/);
  assert.match(tab, /catch \(e\) \{\s*onError\(\(e as Error\)\.message\);/);
  assert.match(tab, /finally \{\s*writing\.current = false;\s*setBusy\(false\);/);
});

test("the chosen view is remembered, the selection survives a switch, and a new division starts clean", () => {
  assert.ok(tab.includes("useState<View>(loadView)"));
  assert.match(tab, /onView=\{\(next\) => \{\s*setView\(next\);\s*saveView\(next\);\s*\}\}/);
  assert.doesNotMatch(tab.match(/onView=\{\(next\) => \{[\s\S]*?\}\}/)![0], /setSel/, "switching view keeps the same nominee open");
  assert.match(tab, /onDivision=\{\(next\) => \{[^}]*setPanelId\(ALL_PANELS\);\s*setSel\(null\);\s*onDivision\(next\);/);
  assert.ok(!tab.includes("localStorage"), "the storage and its try/catch live in awardsLogic");
  const logic = read("src/components/admin/awardsLogic.ts");
  assert.match(logic, /export function loadView[\s\S]*?try \{[\s\S]*?\} catch \{/);
  assert.match(logic, /export function saveView[\s\S]*?try \{[\s\S]*?\} catch \{/);
});

test("the sheet follows the Sections sheet: showModal when a nominee is open, Escape and the backdrop close it, and a wide window has no sheet", () => {
  assert.match(tab, /if \(open && !el\.open\) el\.showModal\(\);\s*else if \(!open && el\.open\) el\.close\(\);/);
  assert.match(tab, /onClose=\{\(\) => \{\s*if \(open\) onClose\(\);\s*\}\}/);
  assert.match(tab, /if \(e\.target === e\.currentTarget\) onClose\(\);/);
  assert.ok(tab.includes('const WIDE = "(min-width: 1024px)";') && tab.includes("useSyncExternalStore"));
});

test("the page fetches the awards for every section once signed in, gives the rail its count, and mounts the tab", () => {
  assert.ok(page.includes("useAwards({ enabled: Boolean(session) })"));
  assert.match(page, /\.\.\.\(awards\.data\?\.awards\.length \? \{ awards: decidedText\(awards\.data\.winners, awards\.data\.awards, division\) \} : \{\}\)/);
  assert.ok(page.includes("pickDivision(awardDivision, state.divisions, awards.data?.nominations ?? [], state.teams)"));
  assert.match(page, /tab === "awards" \? \(\s*<AwardsTab\s+state=\{state\}\s+data=\{awards\.data\}\s+error=\{awards\.error\}\s+reload=\{awards\.reload\}\s+division=\{division\}\s+onDivision=\{setAwardDivision\}\s+onError=\{setError\}/);
  assert.match(page, /tab === "awards" \|\| tab === "scores"/, "Awards fills the width the rail leaves");
  const hook = read("src/components/admin/useAwards.ts");
  assert.ok(hook.includes('"/api/awards", { method: "GET" }') && hook.includes("15_000"));
  assert.ok(!read("src/components/useAppState.ts").includes("/api/awards"), "winners are not part of the state poll");
});

/* ---- styles --------------------------------------------------------------------------------------------------- */

test("the Awards block: its own prefix, between Scores and Activity, tokens only, no motion, 44px taps, and a cell 38 by 44", () => {
  const start = css.indexOf("/* @ja-block awards */");
  assert.ok(start > css.indexOf("/* @ja-block scores */"), "straight after the Scores block");
  const end = css.indexOf("/* @ja-block activity */");
  assert.ok(end > start, "and before Activity");
  const block = css.slice(start, end);
  assert.ok(!/@ja-block (?!awards)/.test(block), "the awards block runs up to the next one");
  assert.ok(css.slice(0, css.indexOf("/* @ja-block shell */")).includes(".ja-aw-"), "the shell comment lists the prefix");
  assert.doesNotMatch(block, /transition|animation|@keyframes/, "no motion");
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|oklch\(|rgb\(|hsl\(/i, "tokens only, so the light theme follows");
  assert.doesNotMatch(block, /\.judge|\.jg-[\w-]+\s*[{,]/, "none of the judge console's rules");
  assert.match(block, /\.ja-aw-cell \{[^}]*width: 38px; height: 44px/, "a matrix cell is 38 by 44");
  assert.match(block, /\.ja-aw-chip \{[^}]*height: 44px/);
  assert.match(block, /\.ja-aw-seg button \{[^}]*height: 44px/);
  assert.match(block, /\.ja-aw-nr \{[^}]*min-height: 52px/);
  assert.match(block, /\.ja-aw-lnk \{[^}]*min-height: 44px/);
  assert.match(block, /\.ja-aw-prim \{[^}]*height: 48px/);
  assert.match(block, /\.ja-aw-dr \{[^}]*width: 340px/, "a 340px side panel from 1024px");
  // Tints are color-mix in srgb.
  assert.match(block, /\.ja-aw-nr\.ja-aw-won \{ background: color-mix\(in srgb, var\(--done\) 14%, transparent\)/);
  assert.match(block, /\.ja-aw-ap\.ja-aw-dec \{ border-color: color-mix\(in srgb, var\(--done\) 55%, transparent\)/);
});

test("the Add team picker and the Remove link: the console's select, a 44px control, tokens only", () => {
  const block = css.slice(css.indexOf("/* @ja-block awards */"), css.indexOf("/* @ja-block activity */"));
  assert.match(block, /\.ja-aw-add \{[^}]*border-top: 1px solid var\(--line\)/);
  assert.match(block, /\.ja-aw-add \.ja-in, \.ja-aw-dr \.ja-selw \.ja-in \{ height: 44px; \}/, "a 44px select in the list and in the side panel");
  assert.match(block, /\.ja-aw-qs \.ja-aw-ql \{ display: flex;/);
  assert.match(block, /\.ja-aw-rm \{ flex: none;/);
  assert.ok(css.indexOf(".ja-selw {") < css.indexOf("/* @ja-block awards */"), "the select it reuses is the console's own");
});

test("colour is signal: green is a winner or a decided award, amber is a caution, accent is a button, a toggle or the selected cell, and the nomination dot has no hue", () => {
  const block = css.slice(css.indexOf("/* @ja-block awards */"), css.indexOf("/* @ja-block activity */"));
  assert.match(block, /\.ja-aw-mk \{[^}]*background: var\(--ink\)/, "a plain ink dot");
  assert.match(block, /\.ja-aw-cell\.ja-aw-won \{ background: var\(--done\); color: var\(--done-ink\)/);
  assert.match(block, /\.ja-aw-win \{[^}]*background: var\(--done\); color: var\(--done-ink\)/);
  assert.match(block, /\.ja-aw-hk \{[^}]*color: var\(--done-quiet\)/);
  assert.match(block, /\.ja-aw-cau \{[^}]*color: var\(--caution-quiet\)/);
  assert.match(block, /\.ja-aw-warnl \{[^}]*color: var\(--caution-quiet\)/);
  assert.match(block, /\.ja-aw-caut \{ color: var\(--caution-quiet\)/);
  assert.match(block, /\.ja-aw-cell\[aria-pressed="true"\] \{[^}]*box-shadow: inset 0 0 0 2px var\(--accent\)/, "the selected cell wears the accent ring");
  assert.match(block, /\.ja-aw-nr\[aria-pressed="true"\] \{[^}]*box-shadow: inset 3px 0 0 var\(--accent\)/, "and the selected row a left bar");
  assert.match(block, /\.ja-aw-seg button\[aria-pressed="true"\] \{[^}]*background: var\(--accent\)/);
  assert.match(block, /\.ja-aw-prim \{[^}]*background: var\(--accent\)/);
  assert.doesNotMatch(block, /\.ja-aw-mk[^{]*\{[^}]*var\(--(?:done|caution|waiting|danger)/, "no hue on a nomination");
  // The one exception is Good conduct from referees alone: a green dot, in the quiet green that reads on both themes, and a tinted card in the side panel.
  assert.match(block, /\.ja-aw-gd \{ background: var\(--done-quiet\); \}/);
  assert.match(block, /\.ja-aw-gc li \{ border-color: color-mix\(in srgb, var\(--done\) 55%, transparent\); background: color-mix\(in srgb, var\(--done\) 10%, transparent\); \}/);
  assert.match(block, /\.ja-aw-good \{ color: var\(--done-quiet\)/, "the text is the quiet green too");
});

test("only the matrix's box scrolls sideways, with the team column held in place; no scrollbar on a phone, a thin one for a mouse", () => {
  const block = css.slice(css.indexOf("/* @ja-block awards */"), css.indexOf("/* @ja-block activity */"));
  const phone = block.slice(0, block.indexOf("@media (min-width: 1024px)"));
  const wide = block.slice(block.indexOf("@media (min-width: 1024px)"));
  assert.match(phone, /\.ja-aw-mx \{[^}]*overflow-x: auto; scrollbar-width: none;/);
  assert.match(phone, /\.ja-aw-mx::-webkit-scrollbar \{ display: none; \}/);
  assert.match(phone, /\.ja-aw-mx table \{[^}]*min-width: calc\(168px \+ var\(--n\) \* 40px\);[^}]*table-layout: fixed/);
  assert.match(phone, /\.ja-aw-mx \.ja-aw-tm \{[^}]*position: sticky; left: 0;[^}]*background: var\(--surface\)/);
  assert.match(wide, /\.ja-aw-mx \{ overflow: auto; scrollbar-width: thin; \}/);
  assert.match(wide, /\.ja-aw-mx table \{ min-width: calc\(212px \+ var\(--n\) \* 40px\); \}/);
  // By award is one column on a phone and two from 1024px; the panel is a column only there.
  assert.match(phone, /\.ja-aw-aps \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(wide, /\.ja-aw-aps \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(phone, /\.ja-aw-cols \{[^}]*flex-direction: column/);
  assert.match(wide, /\.ja-aw-cols \{ flex-direction: row;/);
  assert.match(phone, /\.ja-aw-sheet \.ja-aw-dr \{[^}]*overflow-y: auto;[^}]*border: 0/);
  // The page itself never scrolls sideways: nothing in the block sets a width wider than its column.
  assert.doesNotMatch(phone, /\bwidth: (?:[4-9]\d\d|\d{4,})px/);
});

test("the award names, short names and the hidden-column words come from the config, not from the code", () => {
  // Names, short names and blurbs are read from the config, never typed into the board.
  for (const file of [tab, read("src/components/admin/awardsLogic.ts")]) {
    for (const a of awards) {
      assert.ok(!file.includes(`"${a.label}"`) && !file.includes(`"${a.short}"`), `${a.label} is typed into the code`);
    }
  }
  assert.match(hiddenNote([{ label: "Whatever" }], null), /^Whatever has no nominations yet/);
});
