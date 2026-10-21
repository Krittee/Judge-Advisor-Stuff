import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ScoreRowItem, ScoresBoard, ScoresTab } from "../src/components/admin/ScoresTab";
import { NO_SCORE_FILTERS, withRanks, worstConduct, type ScoreFilters } from "../src/components/admin/scoresLogic";
import { TeamsBoard } from "../src/components/admin/TeamsTab";
import { startDraft } from "../src/components/admin/teamsLogic";
import { TeamSheet } from "../src/components/judge/TeamSheet";
import { rankTeams } from "../src/lib/ranking";
import { rubrics } from "../src/lib/rubrics";
import type { AppState, FlagRow, ScoreRow, Team, TeamCategoryView } from "../src/lib/types";

/* The Judge Advisor Scores tab, rendered to markup. Behaviour that needs a
   browser (a click opening the sheet, the dialog, the sticky bar) has no DOM
   harness here; the decisions behind it run as plain functions in
   adminScores.logic.test.mjs, the row's handlers are called straight off its
   element tree below, and the page's wiring is read from source at the foot. */

const noop = () => {};
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
const page = read("src/app/admin/page.tsx");
const css = read("src/app/globals.css");

const rubricList = rubrics();
const notebook = rubricList.find((r) => r.id === "notebook")!;
const interview = rubricList.find((r) => r.id === "interview")!;
const categoryViews: TeamCategoryView[] = [
  { id: "developing", label: "Developing", color: "amber", excludesRubrics: [] },
  { id: "fully-developed", label: "Fully Developed", color: "violet", excludesRubrics: [] },
  { id: "ungraded", label: "Ungraded", color: "zinc", excludesRubrics: ["notebook"] },
];
const flagKinds = [
  { id: "good", label: "Good conduct", short: "Good", color: "emerald", severity: 0, requiresRule: false },
  { id: "warning", label: "Warning", short: "Warning", color: "amber", severity: 1, requiresRule: false },
  { id: "dq", label: "Disqualified", short: "DQ", color: "black", severity: 4, requiresRule: true },
];
const panels = [
  { id: "p2", name: "Panel 2" },
  { id: "p4", name: "Panel 4" },
] as AppState["panels"];

const team = (number: string, name: string, over: Partial<Team> = {}): Team => ({
  id: `t-${number}`, number, name, panel_id: "p2", division: "Middle School", category: "developing", pit: null, created_at: "2026-10-20T08:00:00Z", ...over,
});
/** Every criterion of a rubric marked by `mark(sectionIndex)` (each team's notebook is out of 64, its interview out of 12). */
function marked(t: Team, rubric: (typeof rubricList)[number], mark: (section: number) => number): ScoreRow {
  const values: Record<string, number> = {};
  rubric.sections.forEach((s, si) => s.criteria.forEach((c) => (values[c.id] = mark(si))));
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  return { id: `s-${t.number}-${rubric.id}`, team_id: t.id, rubric_id: rubric.id, values, total, scored_by: "Sam", panel_id: t.panel_id, updated_at: "2026-10-20T09:00:00Z" };
}
let n = 0;
const flag = (t: Team, kind: string): FlagRow => ({
  id: `f${++n}`, team_id: t.id, kind, body: "", author: "Jordan Lee", match_type: "Q", match_number: "1", field: "1", rule: null,
  ruleset: "v5rc", manual_version: null, match_affecting: false, created_at: "2026-10-20T10:00:00.000Z",
});

const sparky = team("5150Z", "Sparky", { division: "High School", panel_id: "p4" });
const velocity = team("8080V", "Velocity");
const breakers = team("1108", "Circuit Breakers", { division: "Elementary School", panel_id: "p4" });
const gremlins = team("2011A", "Gear Gremlins", { category: "fully-developed" });
const rangers = team("4410C", "Robo Rangers", { category: "ungraded", division: "Elementary School" });
const pi = team("3141P", "Pi Squad", { division: "High School" });
const teams = [pi, rangers, gremlins, breakers, velocity, sparky];
const scores: ScoreRow[] = [
  marked(sparky, notebook, () => 4), marked(sparky, interview, () => 2),
  // Velocity beats Circuit Breakers on the first notebook section, loses on the third and ties the rest; the interviews are equal.
  marked(velocity, notebook, (si) => [4, 2, 2, 2, 2][si]), marked(velocity, interview, () => 1),
  marked(breakers, notebook, (si) => [1, 2, 3, 2, 2][si]), marked(breakers, interview, () => 1),
  marked(gremlins, notebook, () => 1), marked(gremlins, interview, () => 1),
  marked(rangers, interview, () => 2),
];
const flags = [flag(breakers, "good"), flag(breakers, "warning"), flag(breakers, "warning"), flag(pi, "dq"), flag(pi, "warning")];

const rows = withRanks(rankTeams(teams, scores, rubricList, categoryViews));
const slice = { categories: categoryViews, divisions: ["High School", "Middle School", "Elementary School"], panels, flags, flagKinds } as Pick<
  AppState,
  "categories" | "divisions" | "panels" | "flags" | "flagKinds"
>;
const idOf = (number: string) => rows.find((r) => r.team.number === number)!.team.id;

function board(
  over: { filters?: ScoreFilters; picked?: string[]; compareOpen?: boolean; filtersOpen?: boolean; notes?: Record<string, number | "error"> } = {},
) {
  return renderToStaticMarkup(
    <ScoresBoard
      rows={rows}
      filters={over.filters ?? NO_SCORE_FILTERS}
      onFilters={noop}
      filtersOpen={over.filtersOpen}
      onFiltersOpen={noop}
      picked={(over.picked ?? []).map(idOf)}
      compareOpen={over.compareOpen}
      onToggle={noop}
      onClear={noop}
      onCompare={noop}
      onBack={noop}
      state={slice}
      rubricList={rubricList}
      notes={over.notes ?? {}}
      onOpenTeam={noop}
      onOpenFlags={noop}
    />,
  );
}

const li = (markup: string, number: string) =>
  [...markup.matchAll(/<li class="ja-sc-row[^"]*">[\s\S]*?<\/li>/g)].map((m) => m[0]).find((l) => l.includes(`<b>${number}</b>`)) ?? "";
const rowsIn = (markup: string) => [...markup.matchAll(/<li class="ja-sc-row[^"]*">/g)].length;
const listNumbers = (markup: string) => [...markup.matchAll(/<li class="ja-sc-row[^"]*">[\s\S]*?<span class="ja-sc-rn">(.*?)<\/span>[\s\S]*?<b>(.*?)<\/b>/g)].map((m) => `${m[2]}:${m[1]}`);
const compare = (markup: string) => markup.match(/<section class="ja-sc-cmp"[\s\S]*?<\/section>/)?.[0] ?? "";
const trOf = (markup: string, label: string) =>
  [...markup.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]).find((r) => r.includes(`<th scope="row">${label}</th>`)) ?? "";
const tds = (tr: string) => [...tr.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => m[1]);

/* ---- the title and the list --------------------------------------------------- */

test("the title row counts what is shown and what is scored, with the band legend", () => {
  const m = board();
  assert.match(m, /<h2 class="ja-sc-h">Scores<\/h2>/);
  assert.match(m, /Showing 6 teams<span class="ja-sc-sc"> · <b>5 of 6<\/b> scored<\/span>/);
  assert.match(m, /<div class="ja-sc-leg" role="group" aria-label="Score bands">/);
  const legend = m.match(/<div class="ja-sc-leg"[\s\S]*?<\/div>/)![0];
  assert.deepEqual([...legend.matchAll(/ring-inset [^"]*">(.*?)<\/span>/g)].map((x) => x[1]), ["Top ≥85%", "Strong ≥70%", "Middle ≥50%", "Emerging"]);
});

test("the list is rankTeams' order: scored by points, unscored last as — and 'not scored'", () => {
  const m = board();
  assert.deepEqual(listNumbers(m), ["5150Z:1", "8080V:2", "1108:3", "2011A:4", "4410C:5", "3141P:—"]);
  assert.equal(rowsIn(m), 6);
  // Each total is shown with its own denominator: the Ungraded team's is out of the interview alone.
  assert.match(li(m, "5150Z"), /<b class="ja-sc-tot">[\d]+<small>\/76<\/small><\/b>/);
  assert.match(li(m, "4410C"), /<b class="ja-sc-tot">12<small>\/12<\/small><\/b>/);
  // Banded on its own denominator: 12/12 is Top.
  assert.match(li(m, "4410C"), /jg-band[^>]*>Top<\/span>/);
});

test("filters narrow the list but keep the event-wide rank numbers", () => {
  const dev = board({ filters: { category: "developing", division: "" } });
  assert.deepEqual(listNumbers(dev), ["5150Z:1", "8080V:2", "1108:3", "3141P:—"]);
  assert.match(dev, /Showing 4 teams/);
  assert.match(dev, /<b>5 of 6<\/b> scored/, "the scored count is the whole event's");

  const fully = board({ filters: { category: "fully-developed", division: "" } });
  assert.deepEqual(listNumbers(fully), ["2011A:4"], "4 means 4th overall even when it is the only row");
  assert.match(fully, /Showing 1 team</);

  const elementary = board({ filters: { category: "", division: "Elementary School" } });
  assert.deepEqual(listNumbers(elementary), ["1108:3", "4410C:5"]);

  const none = board({ filters: { category: "ungraded", division: "High School" } });
  assert.equal(rowsIn(none), 0);
  assert.match(none, /No teams match these filters\./);
});

test("the filter chips: All and each choice, pressed state, the division's tag with its full name for a screen reader", () => {
  const m = board({ filters: { category: "ungraded", division: "" } });
  const bar = m.match(/<div class="ja-sc-fbar">[\s\S]*?<\/div><\/div><\/div>/)![0];
  assert.match(bar, /role="group" aria-labelledby="[^"]+"><span id="[^"]+" class="ja-sc-cl">Notebook<\/span>/);
  assert.match(bar, />Division<\/span>/);
  const chip = (label: string) => bar.match(new RegExp(`<button type="button" class="ja-sc-chip" aria-pressed="(true|false)"[^>]*>(?:<span aria-hidden="true">[^<]*</span><span class="sr-only">)?${label}`))?.[1];
  assert.equal(chip("All"), "false", "All is not pressed while a notebook is picked");
  assert.equal(chip("Ungraded"), "true");
  assert.equal(chip("Developing"), "false");
  assert.equal(chip("Fully Developed"), "false");
  assert.match(bar, /title="Elementary School"><span aria-hidden="true">ES<\/span><span class="sr-only">Elementary School<\/span>/);
  assert.match(board(), /class="ja-sc-chip" aria-pressed="true">All<\/button>/, "All is pressed with no filter on");
});

/* ---- ticking two --------------------------------------------------------------- */

test("a third checkbox is disabled while two are ticked, with the reason as its title; the ticked two stay free", () => {
  const m = board({ picked: ["8080V", "1108"] });
  const box = (number: string) => li(m, number).match(/<input[^>]*>/)![0];
  for (const number of ["5150Z", "2011A", "4410C"]) {
    assert.match(box(number), /disabled=""/, `${number} is off`);
    assert.match(box(number), /title="Compare two at a time"/);
    assert.doesNotMatch(box(number), /checked/);
  }
  for (const number of ["8080V", "1108"]) {
    assert.match(box(number), /checked=""/);
    assert.doesNotMatch(box(number), /disabled/, `${number} can be un-ticked`);
  }
  // Un-ticking one frees the rest.
  const one = board({ picked: ["8080V"] });
  assert.doesNotMatch(li(one, "5150Z").match(/<input[^>]*>/)![0], /disabled/);
});

test("every row has a labelled checkbox", () => {
  const m = board();
  assert.match(li(m, "1108"), /<input type="checkbox" class="ja-sc-cin"[^>]* aria-label="Compare 1108"/);
  assert.match(li(m, "5150Z"), /aria-label="Compare 5150Z"/);
});

test("with fewer than two ticked the hint shows and there is no compare panel; with two it is the other way round", () => {
  for (const picked of [[], ["8080V"]]) {
    const m = board({ picked });
    assert.match(m, /<p class="ja-sc-hint">Tick two teams to compare them<\/p>/);
    assert.equal(compare(m), "");
    assert.doesNotMatch(m, /ja-sc-pbar/, "no pinned bar until two are ticked");
  }
  const two = board({ picked: ["8080V", "1108"] });
  assert.doesNotMatch(two, /ja-sc-hint/);
  assert.notEqual(compare(two), "");
});

test("the list header counts the ticks, and Clear is off until there is one", () => {
  assert.match(board(), /<b>0 selected<\/b><span> · Compare<\/span><\/p><button type="button" class="ja-sc-lnk" disabled="">Clear<\/button>/);
  assert.match(board({ picked: ["8080V", "1108"] }), /<b>2 selected<\/b><span> · Compare<\/span><\/p><button type="button" class="ja-sc-lnk">Clear<\/button>/);
});

test("an unscored row is muted and its checkbox is off, but its row still opens (the sheet is where it gets scored)", () => {
  const row = li(board(), "3141P");
  assert.match(row, /^<li class="ja-sc-row ja-sc-un">/);
  assert.match(row.match(/<input[^>]*>/)![0], /disabled=""/);
  assert.match(row, /title="Not scored yet, so there is nothing to compare"/);
  assert.match(row, /<span class="ja-sc-rn">—<\/span>/);
  assert.match(row, /<span class="ja-sc-ns">not scored<\/span>/);
  assert.doesNotMatch(row, /jg-band/, "no band for a team nobody has scored");
  assert.match(row, /<button type="button" class="ja-sc-main">/, "still a button");
  assert.doesNotMatch(li(board(), "5150Z"), /ja-sc-un/);
  assert.match(li(board({ picked: ["8080V"] }), "8080V"), /^<li class="ja-sc-row ja-sc-on">/);
});

/* ---- conduct ------------------------------------------------------------------- */

test("the worst conduct pill is on the row, so a disqualification shows without opening anything", () => {
  const m = board();
  // Pi Squad is unscored and still shows it: DQ outranks the Warning beside it.
  const pill = li(m, "3141P").match(/<span class="ja-sp [^"]*"[^>]*>(.*?)<\/span>/)!;
  assert.equal(pill[1], "DQ ×1");
  assert.doesNotMatch(li(m, "3141P"), /Warning/);
  // Circuit Breakers: the Warnings (×2) beat the Good conduct.
  assert.equal(li(m, "1108").match(/<span class="ja-sp [^"]*"[^>]*>(.*?)<\/span>/)![1], "Warning ×2");
  assert.equal(li(m, "1108").match(/ja-sp/g)?.length, 1, "one pill, the worst");
  // Nobody flagged: no pill.
  assert.doesNotMatch(li(m, "5150Z"), /ja-sp/);
  // It is the Referee tab's own pill and the Referee tab's own order.
  const tab = read("src/components/admin/ScoresTab.tsx");
  assert.ok(tab.includes('import { Pill } from "./RefereeTab"'));
  assert.ok(!tab.includes("pillClass"), "no copy of the pill's colours");
  assert.ok(read("src/components/admin/scoresLogic.ts").includes("kindCounts(flags, kinds)[0]"));
  assert.equal(worstConduct([flag(pi, "dq"), flag(pi, "warning")], flagKinds)?.kind.id, "dq");
});

/* ---- the compare panel ----------------------------------------------------------- */

test("the panel names both teams, their rank and panel, and the total with band and a one-decimal percent", () => {
  const m = compare(board({ picked: ["8080V", "1108"] }));
  assert.match(m, /<caption class="sr-only">8080V Velocity compared with 1108 Circuit Breakers<\/caption>/);
  assert.match(m, /<h2 id="[^"]+" class="sr-only">Compare 8080V and 1108<\/h2>/);
  const heads = [...m.matchAll(/<th scope="col"><span class="ja-sc-tn">(.*?)<\/span><span class="ja-sc-tnm">(.*?)<\/span><span class="ja-sc-tmt">(.*?)<\/span>/g)].map((x) => x.slice(1));
  assert.deepEqual(heads, [
    ["8080V", "Velocity", "Rank 2 · Panel 2"],
    ["1108", "Circuit Breakers", "Rank 3 · Panel 4"],
  ]);
  const [a, b] = tds(trOf(m, "Total"));
  const total = (r: ReturnType<typeof withRanks>[number]) => `${r.total}/${r.max}`;
  const row = (number: string) => rows.find((r) => r.team.number === number)!;
  assert.equal(text(a).replace(/\(higher\)|\s/g, "").startsWith(total(row("8080V"))), true, a);
  assert.match(a, /jg-band/);
  assert.match(a, new RegExp(`<span class="ja-sc-pc">${((row("8080V").total / row("8080V").max) * 100).toFixed(1)}%</span>`));
  assert.match(b, new RegExp(`<span class="ja-sc-pc">${((row("1108").total / row("1108").max) * 100).toFixed(1)}%</span>`));
  assert.match(a, /\.\d%<\/span>/, "one decimal");
});

test("the left column is the higher-ranked team, whichever was ticked first", () => {
  const heads = (m: string) => [...compare(m).matchAll(/<span class="ja-sc-tn">(.*?)<\/span>/g)].map((x) => x[1]);
  assert.deepEqual(heads(board({ picked: ["1108", "8080V"] })), ["8080V", "1108"]);
  assert.deepEqual(heads(board({ picked: ["8080V", "1108"] })), ["8080V", "1108"]);
  assert.match(board({ picked: ["1108", "8080V"] }), /<span>8080V · 1108<\/span>/, "and the pinned bar names them the same way");
});

test("each rubric has its own line and one line per section, in the config's order", () => {
  const m = compare(board({ picked: ["8080V", "1108"] }));
  const labels = [...m.matchAll(/<tr[^>]*><th scope="row">(.*?)<\/th>/g)].map((x) => x[1]);
  assert.deepEqual(labels, [
    "Total",
    notebook.name, ...notebook.sections.map((s) => s.name),
    interview.name, ...interview.sections.map((s) => s.name),
    "Notes",
    "Conduct",
  ].map((s) => s.replace(/&/g, "&amp;")));
  assert.match(m, new RegExp(`<tr class="ja-sc-grp"><th scope="row">${notebook.name}</th>`));
});

test("section subtotals read as the stored values add up", () => {
  const m = compare(board({ picked: ["8080V", "1108"] }));
  const first = notebook.sections[0];
  const top = notebook.scale[notebook.scale.length - 1].value;
  const [a, b] = tds(trOf(m, first.name)).map(text);
  // Velocity marked the first section 4 a criterion, Circuit Breakers 1.
  assert.match(a, new RegExp(`^${4 * first.criteria.length}/${first.criteria.length * top}`));
  assert.match(b, new RegExp(`^${first.criteria.length}/${first.criteria.length * top}`));
  // The rubric line is the stored total: the sections add up to it.
  const sectionSum = (cell: number) => notebook.sections.reduce((sum, s) => sum + Number(text(tds(trOf(m, s.name))[cell]).match(/^\d+/)![0]), 0);
  const stored = (number: string) => rows.find((r) => r.team.number === number)!.perRubric.find((s) => s.rubric_id === "notebook")!.total;
  assert.equal(sectionSum(0), stored("8080V"));
  assert.equal(sectionSum(1), stored("1108"));
  assert.match(text(tds(trOf(m, notebook.name))[0]), new RegExp(`^${stored("8080V")}/${notebook.max}`));
});

test("the higher value in a row is bold and a tie is bold on neither side", () => {
  const m = compare(board({ picked: ["8080V", "1108"] }));
  const bold = (tr: string) => tds(tr).map((td) => td.includes('<b class="ja-sc-v ja-sc-hi">'));
  const [s1, s2, s3] = notebook.sections;
  assert.deepEqual(bold(trOf(m, s1.name)), [true, false], "Velocity is ahead on the first section");
  assert.deepEqual(bold(trOf(m, s2.name)), [false, false], "the second is a tie");
  assert.deepEqual(bold(trOf(m, s3.name)), [false, true], "Circuit Breakers is ahead on the third");
  assert.deepEqual(bold(trOf(m, notebook.name)), [true, false], "and Velocity on the notebook as a whole");
  assert.deepEqual(bold(trOf(m, interview.name)), [false, false], "equal interviews");
  assert.deepEqual(bold(trOf(m, interview.sections[0].name)), [false, false]);
  // The unbolded side is still a plain value.
  assert.match(tds(trOf(m, s1.name))[1], /^<span class="ja-sc-v">/);
  // Bold is also said to a screen reader, once.
  assert.match(tds(trOf(m, s1.name))[0], /<span class="sr-only"> \(higher\)<\/span>/);
});

test("the total row bolds the higher points, not the higher share", () => {
  const m = compare(board({ picked: ["4410C", "8080V"] }));
  // The columns run in rank order: 8080V, then 4410C. 4410C's 12 of 12 is the bigger share; 8080V's points are higher.
  const [a, b] = tds(trOf(m, "Total"));
  assert.match(a, /<b class="ja-sc-v ja-sc-hi">/);
  assert.doesNotMatch(b, /ja-sc-hi/);
});

test("a rubric out of scope reads 'excluded' for that team, on its line and on each of its sections", () => {
  const m = compare(board({ picked: ["4410C", "8080V"] }));
  for (const label of [notebook.name, ...notebook.sections.map((s) => s.name)]) {
    const [a, b] = tds(trOf(m, label)); // 8080V, then 4410C (Ungraded)
    assert.equal(text(b), "excluded", label);
    assert.doesNotMatch(a, /excluded/);
    assert.doesNotMatch(a + b, /ja-sc-hi/, "nothing to compare, nothing bold");
  }
  assert.doesNotMatch(trOf(m, interview.name), /excluded/);
});

test("notes: the count from /api/notes, with a button that opens the team sheet", () => {
  const m = compare(board({ picked: ["8080V", "1108"], notes: { [idOf("8080V")]: 3, [idOf("1108")]: 1 } }));
  const [a, b] = tds(trOf(m, "Notes"));
  assert.match(a, /<span class="ja-sc-nct">3 notes<\/span><button type="button" class="ja-sc-olink" aria-label="Open team sheet for 8080V Velocity">Open team sheet<\/button>/);
  assert.match(b, /<span class="ja-sc-nct">1 note<\/span>/);
  assert.match(tds(trOf(compare(board({ picked: ["8080V", "1108"] })), "Notes"))[0], /<span class="ja-sc-nct">…<\/span>/, "while it loads");
  assert.match(tds(trOf(compare(board({ picked: ["8080V", "1108"], notes: { [idOf("8080V")]: "error" } })), "Notes"))[0], /unavailable/);
  assert.match(tds(trOf(compare(board({ picked: ["8080V", "1108"], notes: { [idOf("8080V")]: 0 } })), "Notes"))[0], />No notes</);
  const tab = read("src/components/admin/ScoresTab.tsx");
  assert.ok(tab.includes("`/api/notes?teamId=${id}`"), "the existing endpoint");
  assert.ok(tab.includes("onClick={() => onOpenTeam(r.team)}"));
});

test("conduct: severity pills that open the Referee section, or None", () => {
  const m = compare(board({ picked: ["8080V", "1108"] }));
  const [a, b] = tds(trOf(m, "Conduct"));
  assert.match(a, /<span class="ja-sc-none">None<\/span>/);
  assert.match(b, /<button type="button" class="ja-sc-cbtn" aria-label="Open referee flags for 1108 Circuit Breakers: Warning ×2, Good ×1">/);
  assert.deepEqual([...b.matchAll(/<span class="ja-sp [^"]*"[^>]*>(.*?)<\/span>/g)].map((x) => x[1]), ["Warning ×2", "Good ×1"]);
  const tab = read("src/components/admin/ScoresTab.tsx");
  assert.ok(tab.includes("onClick={() => onOpenFlags(r.team)}"));
});

/* ---- a row opens the team sheet --------------------------------------------------- */

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

test("clicking a row calls onOpen with that team; its checkbox toggles it and does not open it", () => {
  const row = rows.find((r) => r.team.number === "8080V")!;
  const opened: string[] = [];
  const toggled: string[] = [];
  const tree = walk(ScoreRowItem({ row, on: false, blocker: null, conduct: null, onToggle: (id) => toggled.push(id), onOpen: (t) => opened.push(t.number) }));
  const main = tree.find((e) => e.type === "button" && String(e.props.className).includes("ja-sc-main"))!;
  (main.props.onClick as () => void)();
  assert.deepEqual(opened, ["8080V"]);
  assert.deepEqual(toggled, []);

  const box = tree.find((e) => e.type === "input")!;
  (box.props.onChange as () => void)();
  assert.deepEqual(toggled, [row.team.id]);
  assert.deepEqual(opened, ["8080V"], "ticking does not open the sheet");
  assert.equal(box.props.disabled, false);

  // The checkbox is not inside the button: one control per element.
  assert.ok(!walk(main.props.children as ReactNode).some((e) => e.type === "input"));

  const off = walk(ScoreRowItem({ row, on: false, blocker: "Compare two at a time", conduct: null, onToggle: noop, onOpen: noop })).find((e) => e.type === "input")!;
  assert.equal(off.props.disabled, true);
});

test("an unscored row's button still opens it", () => {
  const row = rows.find((r) => r.team.number === "3141P")!;
  const opened: string[] = [];
  const tree = walk(ScoreRowItem({ row, on: false, blocker: "Not scored yet", conduct: null, onToggle: noop, onOpen: (t) => opened.push(t.number) }));
  (tree.find((e) => e.type === "button")!.props.onClick as () => void)();
  assert.deepEqual(opened, ["3141P"]);
});

/* ---- the phone ----------------------------------------------------------------------- */

test("a phone: a Filters button with a badge only while a filter is on, and a sheet that is shut until it is opened", () => {
  const none = board();
  assert.match(none, /<button type="button" class="ja-sc-fb" aria-haspopup="dialog" aria-label="Filters">/);
  assert.doesNotMatch(none, /ja-sc-fc/);
  assert.match(none, /<dialog class="ja-sheet ja-sc-fsheet" aria-modal="true" aria-labelledby="[^"]+"><\/dialog>/);

  const one = board({ filters: { category: "ungraded", division: "" } });
  assert.match(one, /aria-label="Filters, 1 on" data-on="true"/);
  assert.match(one, /<span class="ja-sc-fc" aria-hidden="true">1<\/span>/);
  assert.match(board({ filters: { category: "ungraded", division: "High School" } }), /<span class="ja-sc-fc" aria-hidden="true">2<\/span>/);

  const open = board({ filtersOpen: true, filters: { category: "ungraded", division: "" } });
  const sheet = open.match(/<dialog class="ja-sheet ja-sc-fsheet"[\s\S]*?<\/dialog>/)![0];
  assert.match(sheet, /<h2 id="[^"]+">Filters<\/h2>/);
  assert.match(sheet, /aria-label="Close"/);
  assert.match(sheet, /Notebook<\/span>[\s\S]*Division<\/span>/);
  assert.match(sheet, />Show 1 team<\/button>/, "the filtered count");
  assert.match(sheet, />Clear filters<\/button>/);
});

test("a phone: two ticked pin the 'Compare' bar, which opens the compare screen with a back button", () => {
  const list = board({ picked: ["8080V", "1108"] });
  assert.match(list, /<div class="ja-sc" data-view="list">/);
  assert.match(list, /<div class="ja-sc-pbar" role="region" aria-label="Compare selection"><p class="ja-sc-sel"><b>2 selected<\/b><span>8080V · 1108<\/span><\/p><button type="button" class="ja-sc-quiet">Clear<\/button><button type="button" class="ja-sc-cmpb">Compare<\/button>/);
  const screen = board({ picked: ["8080V", "1108"], compareOpen: true });
  assert.match(screen, /<div class="ja-sc" data-view="compare">/);
  assert.match(compare(screen), /<button type="button" class="ja-sc-back">[\s\S]*Ranked teams<\/button>/);
  // One ticked: Compare is not offered, whatever was open.
  assert.match(board({ picked: ["8080V"], compareOpen: true }), /data-view="list"/);
});

test("the pinned bar sits at the bottom of the screen however few rows there are, and never over the last row", () => {
  const block = css.slice(css.indexOf("/* @ja-block scores */"));
  // The page column fills .ja-main and .ja-sc fills the column, so the bar's auto top margin pushes it to the bottom of a short page ...
  assert.match(block, /\.ja-pad:has\(> \.ja-sc\) \{[^}]*display: flex;[^}]*min-height: 100%;[^}]*flex-direction: column;[^}]*padding-bottom: 0;/);
  assert.match(block, /\.ja-sc \{[^}]*flex: 1;/);
  assert.match(block, /\.ja-sc-pbar \{[^}]*position: sticky; bottom: 0;[^}]*margin: auto -16px 0;/);
  // ... and sticky holds it there when the list is long. It follows the list in the page, with room left under the last row.
  const m = board({ picked: ["8080V", "1108"] });
  assert.ok(m.indexOf('class="ja-sc-pbar"') > m.indexOf("</section></div>"), "the bar comes after the list and the panel");
  assert.match(block, /\.ja-sc-cols \{[^}]*padding-bottom: 12px/);
  assert.doesNotMatch(block.slice(0, block.indexOf("@media (min-width: 1024px)")), /\.ja-sc \{[^}]*padding-bottom/, "no padding under the bar for it to float above");
});

test("the phone's bar only sits on a phone and the list/compare swap is phone-only", () => {
  const block = css.slice(css.indexOf("/* @ja-block scores */"));
  assert.match(block, /\.ja-sc-pbar \{[^}]*position: sticky; bottom: 0/);
  assert.match(block, /@media \(max-width: 1023\.98px\) \{[\s\S]*data-view="compare"\] :is\(\.ja-sc-top, \.ja-sc-hint, \.ja-sc-list, \.ja-sc-pbar\) \{ display: none/);
  assert.match(block, /@media \(min-width: 1024px\) \{[\s\S]*\.ja-sc-pbar, \.ja-sc-back \{ display: none; \}/);
  assert.match(block, /\.ja-sc-fbar \{ display: none; \}[\s\S]*@media \(min-width: 1024px\) \{[\s\S]*\.ja-sc-fbar \{ display: flex/, "the chips are wide-only; the phone has the Filters button");
});

/* ---- the tab around the board ---------------------------------------------------------- */

test("ScoresTab shows the error alone, or Loading… before the first answer, and otherwise the board", () => {
  const props = { ranked: rankTeams(teams, scores, rubricList, categoryViews), state: slice, rubricList, sheetId: null, onOpenTeam: noop, onOpenFlags: noop };
  assert.match(renderToStaticMarkup(<ScoresTab {...props} loaded error="Network is down" />), /Network is down/);
  assert.doesNotMatch(renderToStaticMarkup(<ScoresTab {...props} loaded error="x" />), /ja-sc-row/);
  const loading = renderToStaticMarkup(<ScoresTab {...props} loaded={false} error={null} />);
  assert.match(loading, /Loading…/);
  assert.doesNotMatch(loading, /ja-sc-row/);
  const m = renderToStaticMarkup(<ScoresTab {...props} loaded error={null} />);
  assert.equal(rowsIn(m), 6);
  assert.match(m, /Tick two teams to compare them/, "first load: nothing ticked");
});

test("an event with no teams says so", () => {
  const empty = renderToStaticMarkup(
    <ScoresBoard rows={[]} filters={NO_SCORE_FILTERS} onFilters={noop} onFiltersOpen={noop} picked={[]} onToggle={noop} onClear={noop} onCompare={noop} onBack={noop} state={slice} rubricList={rubricList} notes={{}} onOpenTeam={noop} onOpenFlags={noop} />,
  );
  assert.match(empty, /No teams to score yet\./);
});

/* ---- every "Notes" on the console opens the judge console's team sheet ------------------ */

const tabs = ["ScoresTab", "FloorTab", "TeamsTab"];

test("the page opens one TeamSheet, inside the frame, from Scores, Floor's Notes and the Teams drawer", () => {
  assert.ok(page.includes('import { TeamSheet } from "@/components/judge/TeamSheet"'));
  assert.equal(page.match(/<TeamSheet\b/g)?.length, 1, "one sheet for the whole console");
  assert.ok(page.indexOf("<AdminFrame") < page.indexOf("<TeamSheet") && page.indexOf("<TeamSheet") < page.indexOf("</AdminFrame>"), "inside .admin, where its colour tokens are");
  // The three entry points set the one id.
  assert.match(page, /<FloorTab [^>]*onNotes=\{\(team\) => setSheetId\(team\.id\)\}/);
  assert.match(page, /<ScoresTab[\s\S]*?onOpenTeam=\{\(team\) => setSheetId\(team\.id\)\}/);
  assert.match(page, /<TeamsTab[\s\S]*?onOpenSheet=\{setSheetId\}/);
  // And it reads the team from the live state, so a rename shows while it is open.
  assert.ok(page.includes("state.teams.find((t) => t.id === sheetId)"));
  assert.match(page, /request=\{sheetTeam \? liveRequestFor\(sheetTeam\.id, state\.requests\) : null\}/);
  assert.ok(page.includes("ask={ask}"), "its Clear scores confirm is the console's own ask()");
  assert.match(page, /onClose=\{\(\) => \{\s*setSheetId\(null\);/);
  for (const tab of tabs) assert.ok(page.includes(`<${tab}`), tab);
});

test("Floor's Notes still calls onNotes, and nothing on the console renders the old drawer", () => {
  const floor = read("src/components/admin/FloorTab.tsx");
  assert.ok(floor.includes("onNotes(team)"));
  assert.ok(!floor.includes("NotesDrawer"));
  assert.ok(!page.includes("NotesDrawer"));
  assert.ok(!page.includes("setNotesFor"));
});

test("the Teams drawer's flags area has an 'Open team sheet' button, with flags or without", () => {
  const withFlags = renderTeams(titans, [flag(titans, "warning")]);
  assert.match(withFlags, /<button type="button" class="ja-tm-od">Open in Referee<svg/);
  assert.match(withFlags, /<button type="button" class="ja-tm-od ja-tm-ts">Open team sheet<\/button>/);
  const without = renderTeams(titans, []);
  assert.match(without, /No flags recorded\./);
  assert.match(without, /<button type="button" class="ja-tm-od ja-tm-ts">Open team sheet<\/button>/, "notes and scores are there to read whether or not there are flags");
  assert.doesNotMatch(without, /Open in Referee/);
  // A phone's sheet carries the same fields.
  assert.match(renderTeams(titans, [], false), /Open team sheet/);

  const tab = read("src/components/admin/TeamsTab.tsx");
  assert.ok(tab.includes("onOpenSheet={() => team && onOpenSheet(team.id)}"));
  assert.ok(tab.includes('<button type="button" className="ja-tm-od ja-tm-ts" onClick={onOpenSheet}>'));
});

const titans = team("9882K", "Torque Titans", { pit: "B4" });
function renderTeams(t: Team, f: FlagRow[], wide = true) {
  const m = renderToStaticMarkup(
    <TeamsBoard
      state={{ teams: [t], panels: [], requests: [], conflicts: [], judges: [], flags: f, flagKinds, divisions: ["Middle School"], categories: categoryViews } as never}
      wide={wide}
      filters={{ q: "", division: "", category: "" }}
      onFilters={noop}
      onFiltersOpen={noop}
      perPanel={12}
      onPerPanel={noop}
      onAutoAssign={noop}
      pickedId={t.id}
      onPick={noop}
      draft={startDraft(t)}
      onDraft={noop}
      onSave={noop}
      onClose={noop}
      onResetStatus={noop}
      onRemove={noop}
      onOpenFlags={noop}
      onOpenSheet={noop}
    />,
  );
  return m.match(wide ? /<aside class="ja-tm-dr"[\s\S]*?<\/aside>/ : /<dialog class="ja-sheet ja-tm-sheet"[\s\S]*?<\/dialog>/)![0];
}

/* ---- the judge console's sheet is the one both consoles share, and /judge is unchanged ---- */

test("the team sheet for a judge renders exactly as it did before it was shared", () => {
  const t = team("9882K", "Torque Titans", { pit: "B4" });
  const warning: FlagRow = { ...flag(t, "warning"), body: "Reset another team's field.", match_number: "19", rule: "GG17", ruleset: "viqrc", created_at: "2026-10-17T12:00:00.000Z" };
  const markup = renderToStaticMarkup(
    <TeamSheet
      team={t}
      request={{ id: "r1", team_id: t.id, status: "requested", language: "en" } as never}
      categories={[{ id: "developing", label: "Developing", color: "sky", excludesRubrics: [] }]}
      languages={[{ id: "en", label: "English", short: "EN" }]}
      flags={[warning]}
      flagKinds={flagKinds}
      ask={async () => true}
      onClose={noop}
    />,
  ).replace(/«R\d+»/g, "ID");
  // Captured from the sheet as it stood before the Judge Advisor console began to use it; TeamSheet.tsx changed in comments only.
  assert.equal(
    markup,
    `<dialog class="jg-sheet" aria-modal="true" aria-labelledby="ID"><div class="jg-grab" aria-hidden="true"></div><div class="jg-sh-top"><div class="jg-sh-h"><div class="jg-sh-id"><h2 id="ID">9882K</h2><p class="jg-nm">Torque Titans</p><p class="jg-sub">Developing · EN · Pit B4</p></div><button type="button" class="jg-x" aria-label="Close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button></div><p class="jg-priv">Private to judges and the Judge Advisor.</p><div class="jg-seg" role="group" aria-label="Team sheet sections"><button type="button" aria-pressed="true"><span>Notes</span><small>no notes</small></button></div></div><div class="jg-sh-scroll"><div class="jg-caution" role="note"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19L12 3.5zM12 10v4.5M12 17.2v.01"></path></svg><div><p><b>Warning</b> · GG17 · Q19 — reported by Jordan Lee</p><p class="jg-fb">Reset another team&#x27;s field.</p></div></div><p class="jg-none">No notes yet.</p></div><div class="jg-sh-foot"><label class="sr-only" for="jg-note">Add a note</label><textarea id="jg-note" class="jg-ta" rows="3" placeholder="Add a note for the panel…"></textarea><button type="button" class="jg-prim" disabled="">Save note</button></div></dialog>`,
  );
});

test("the judge console still mounts the same TeamSheet, and the Judge Advisor's page passes it only the props the judge's does", () => {
  const judgePage = read("src/app/judge/page.tsx");
  const sheetProps = (src: string) => [...(src.match(/<TeamSheet\s[\s\S]*?\/>/)?.[0] ?? "").matchAll(/^\s+(\w+)=/gm)].map((m) => m[1]).sort();
  assert.deepEqual(sheetProps(page), sheetProps(judgePage), "no admin-only prop, no judge-only chrome");
  assert.ok(judgePage.includes('import { TeamSheet } from "@/components/judge/TeamSheet"'));
  // The sheet's own file is not forked: it still comes from one place and has no admin branch.
  const sheet = read("src/components/judge/TeamSheet.tsx");
  assert.ok(!/admin|advisor/i.test(sheet.replace(/Judge Advisor/g, "")), "TeamSheet has no console-specific branch");
  assert.equal(existsSync(new URL("../src/components/admin/TeamSheet.tsx", import.meta.url)), false, "no copy of it for the admin console");
});

test("the sheet's rules are bare .jg-* ones, so they apply under .admin as under .judge; both define the tokens it reads", () => {
  const judgeBlock = css.slice(css.indexOf("\n.judge {"), css.indexOf("@keyframes si-bar"));
  for (const selector of [".jg-sheet {", ".jg-sheet[open]", ".jg-sh-top {", ".jg-seg {", ".jg-sh-scroll {", ".jg-caution {", ".jg-sh-foot {", ".jg-ta {", ".jg-sx {", ".jg-cr {", ".jg-sv {", ".jg-sf {", ".jg-band {", ".jg-prim {", ".jg-quiet {"]) {
    assert.ok(judgeBlock.includes(`\n${selector}`), `${selector} is a bare rule`);
  }
  assert.doesNotMatch(judgeBlock, /\.judge[\s>+~]+[^{]*\.jg-/, "no sheet rule hangs off .judge");
  assert.doesNotMatch(judgeBlock, /\.judge\s+\.jg-|\.judge\s*>\s*\.jg-/);

  const declared = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
  const admin = css.slice(css.indexOf("\n.admin {"), css.indexOf("\n.admin {") + 900);
  const judge = css.slice(css.indexOf("\n.judge {"), css.indexOf("\n.judge {") + 900);
  for (const token of ["--jg-field", "--jg-field-line", "--jg-ring"]) {
    assert.ok(declared(admin, token), `.admin defines ${token}`);
    assert.equal(declared(admin, token), declared(judge, token), `${token} is the same on both consoles`);
  }
  // Light theme: both override the two colours the same way.
  const light = (scope: string) => css.slice(css.indexOf(`:root[data-theme="light"] ${scope} {`), css.indexOf(`:root[data-theme="light"] ${scope} {`) + 300);
  for (const token of ["--jg-field", "--jg-field-line"]) assert.equal(declared(light(".admin"), token), declared(light(".judge"), token));
  const note = css.slice(css.indexOf("Judge console (\"Up next\""), css.indexOf("\n.judge {"));
  assert.ok(note.includes("mount the sheet inside one of the two"), "the sharing is written down above the sheet's rules");
});

/* ---- what was deleted ---------------------------------------------------------------------- */

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.(tsx?|mjs)$/.test(f) ? [p] : [];
  });
}

test("NotesDrawer and the Rankings table are gone, and nothing imports them", () => {
  const root = new URL("..", import.meta.url).pathname;
  assert.equal(existsSync(join(root, "src/components/Rankings.tsx")), false);
  assert.ok(!read("src/components/judging.tsx").includes("NotesDrawer"));
  assert.ok(read("src/components/judging.tsx").includes("export function SignOutButton"), "the sign-out button the consoles share stays");
  for (const file of sources(join(root, "src"))) {
    const src = readFileSync(file, "utf8");
    assert.ok(!/\bNotesDrawer\b/.test(src), `${file} still names NotesDrawer`);
    assert.ok(!/components\/Rankings|from "\.\/Rankings"/.test(src), `${file} still imports Rankings`);
  }
});

/* ---- the page ------------------------------------------------------------------------------- */

test("Scores keeps its rules: score polling only while open, the conduct link, ranking by rankTeams", () => {
  assert.ok(page.includes('useScores({ enabled: tab === "scores" })'));
  assert.ok(page.includes('tab === "scores" ? rankTeams('), "ranked only while Scores is open");
  assert.match(page, /<ScoresTab[\s\S]*?onOpenFlags=\{\(team\) => \{\s*setFocusFlagTeam\(team\.id\);\s*setTab\("flags"\);/);
  assert.match(page, /tab === "scores" \? \(\s*<ScoresTab/);
  assert.match(page, /tab === "scores"( \|\| tab === "\w+")* \? "ja-pad"|\|\| tab === "scores" \? "ja-pad"/, "Scores is among the tabs in the wide padding");
  const tab = read("src/components/admin/ScoresTab.tsx");
  assert.ok(!tab.includes("rankTeams("), "the tab never reorders what rankTeams gave it");
  assert.ok(!/\.sort\(/.test(tab + read("src/components/admin/scoresLogic.ts")), "nothing here sorts");
  assert.ok(!tab.includes("window.confirm") && !/\bconfirm\(/.test(tab));
});

test("the phone bar says how many are scored on Scores, and nowhere else", () => {
  assert.match(page, /scoredNote=\{tab === "scores" && scoreData\.loaded && !scoreData\.error \? scoredText\(ranked\) : undefined\}/);
  const frame = read("src/components/admin/AdminFrame.tsx");
  assert.match(frame, /tab === "scores" && scoredNote \? \(\s*<span className="ja-rc">\{scoredNote\}<\/span>/);
});

/* ---- styles ---------------------------------------------------------------------------------- */

test("the Scores block: its own prefix, after the import block, tokens only, no motion, 44px taps on a phone", () => {
  const start = css.indexOf("/* @ja-block scores */");
  assert.ok(start > css.indexOf("/* @ja-block import */"), "appended after the existing blocks");
  // Activity (step 10) is appended after it.
  const end = css.indexOf("/* @ja-block activity */");
  assert.ok(end > start, "Activity follows it");
  const block = css.slice(start, end);
  assert.ok(!/@ja-block (?!scores)/.test(block), "the scores block runs up to the next one");
  assert.doesNotMatch(block, /transition|animation|@keyframes/, "no motion");
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|oklch\(|rgb\(|hsl\(/i, "tokens only, so the light theme follows");
  assert.doesNotMatch(block, /overflow-x/, "no sideways-scrolling row");
  assert.match(block, /\.ja-sc-fb \{[^}]*height: 44px/);
  assert.match(block, /\.ja-sc-fsheet \.ja-sc-chip \{ height: 44px/);
  assert.match(block, /\.ja-sc-cmpb \{[^}]*height: 48px/);
  assert.match(block, /\.ja-sc-ck \{[^}]*min-height: 60px/, "the checkbox's tap area is the row");
  assert.match(block, /\.ja-sc-main \{[^}]*min-height: 60px/);
  assert.match(block, /\.ja-sc-olink \{[^}]*min-height: 44px/);
  assert.match(block, /\.ja-sc-cols \{ display: grid; grid-template-columns: 440px minmax\(0, 1fr\)/, "a ~440px list beside the compare panel");
  assert.match(block, /\.ja-sc-cin:focus-visible \+ \.ja-sc-box \{ outline: 2px solid var\(--accent\)/, "the checkbox shows its focus on the visible box");
  // Chips use the accent for the selected one, as the Teams and Referee chips do.
  assert.match(block, /\.ja-sc-chip\[aria-pressed="true"\] \{[^}]*background: var\(--accent\)/);
});
