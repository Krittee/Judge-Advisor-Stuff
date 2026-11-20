import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AwardLists } from "../src/components/admin/AwardsTab";
import { BlendedBoard, BlendedLists, blendedMatrix } from "../src/components/admin/BlendedAwards";
import {
  ALL_PANELS, buildAwardPanels, heldByTeam, nominationsIn, noWinnersOf, winnersOf, type BlendedSel, type View,
} from "../src/components/admin/awardsLogic";
import { withRanks } from "../src/components/admin/scoresLogic";
import { WHOLE_EVENT } from "../src/lib/eventSetup";
import { rankTeams } from "../src/lib/ranking";
import { rubrics } from "../src/lib/rubrics";
import type { AppState, AwardsAdminView, ReleasedView } from "../src/lib/types";
import { at, awards, breakers, byteMe, gearGrinders, hexAppeal, labRats, monitors, nom, panels, quiet, release, roboraptors, team, teams, torque, win } from "./adminAwards.fixtures";

/* The Judge Advisor Awards board in a blended event (VEX IQ · Blended: Excellence and Design per division, nine awards for the whole event), rendered to markup.
   Taps are checked off the element tree (BlendedLists has no hooks), the tab's wiring from source at the foot. */

const noop = () => {};
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
const tab = read("src/components/admin/AwardsTab.tsx");
const css = read("src/app/globals.css");

const ES = "Elementary School";
const MS = "Middle School";
const setup = { program: "VEX IQ", format: "blended" as const };
const es = (number: string, name: string, over = {}) => team(number, name, { division: ES, ...over });
const levers = es("41111A", "Little Levers");
const bolts = es("12021B", "Blue Bolts", { panel_id: "p3" });
const pixel = es("2020P", "Pixel Pals", { panel_id: "p3" });
const titans = es("3030T", "Tiny Titans");
const all = [...teams, levers, bolts, pixel, titans];
const state = { teams: all, panels, divisions: ["Elementary School", MS, "High School", "Blended"], flags: [], flagKinds: [] as AppState["flagKinds"], eventSetup: null };

const nominations = [
  nom(levers, "excellence", "p2", "Sam Rivera"),
  nom(bolts, "excellence", "p3", "Lena Ortiz"),
  nom(byteMe, "excellence", "p2", "Sam Rivera"),
  nom(breakers, "excellence", "p2", "Priya Nair"),
  nom(pixel, "design", "p3", "Lena Ortiz"),
  nom(titans, "design", "p2", "Sam Rivera"),
  nom(labRats, "design", "p3", "Lena Ortiz"),
  nom(gearGrinders, "innovate", "p3", "Lena Ortiz"),
  nom(titans, "innovate", "p2", "Sam Rivera"),
  nom(monitors, "innovate", "p4", "Dana Cruz"),
  nom(byteMe, "energy", "p2", "Sam Rivera"),
  nom(titans, "energy", "p2", "Priya Nair"),
];
// Twelve of 13 decided: everything but Energy, with Create marked "No winner".
const winners = [
  win("excellence", levers), win("excellence", byteMe), win("design", pixel), win("design", labRats),
  win("innovate", gearGrinders, WHOLE_EVENT), win("think", breakers, WHOLE_EVENT), win("amaze", gearGrinders, WHOLE_EVENT), win("build", torque, WHOLE_EVENT),
  win("inspire", hexAppeal, WHOLE_EVENT), win("sportsmanship", torque, WHOLE_EVENT), win("judges", hexAppeal, WHOLE_EVENT), win("judges", roboraptors, WHOLE_EVENT),
];
const noWinners = [{ award_id: "create", division: WHOLE_EVENT, decided_by: "Alex Morgan", decided_at: "2026-10-20T15:00:00Z" }];
const data: AwardsAdminView = { awards, nominations, winners, noWinners };

// Sent: Design · MS, Think and Sportsmanship. Innovate was recalled after Marketing was given Tiny Titans.
const releases = [
  release("design", labRats, { division: MS, sent_at: at(10, 31) }),
  release("think", breakers, { division: WHOLE_EVENT, sent_at: at(10, 33) }),
  release("sportsmanship", torque, { division: WHOLE_EVENT, sent_at: at(10, 44) }),
  release("innovate", titans, { division: WHOLE_EVENT, status: "recalled", sent_at: at(10, 20), changed_at: at(10, 51) }),
];
const released = { releases } as unknown as ReleasedView;
const noReleases = { releases: [] } as unknown as ReleasedView;

const rows = withRanks(rankTeams(all, [], rubrics(), [{ id: "developing", label: "Developing", color: "amber", excludesRubrics: [] }]));

function board(over: { released?: ReleasedView | null; data?: AwardsAdminView; from?: string; panelId?: string; view?: View; sel?: BlendedSel | null; wide?: boolean; busy?: boolean } = {}) {
  return renderToStaticMarkup(
    <BlendedBoard
      data={over.data ?? data}
      released={over.released === undefined ? released : over.released}
      state={state}
      setup={setup}
      rows={rows}
      rubricList={rubrics()}
      from={over.from}
      onFrom={noop}
      panelId={over.panelId}
      onPanel={noop}
      view={over.view ?? "award"}
      onView={noop}
      sel={over.sel === undefined ? null : over.sel}
      onSelect={noop}
      wide={over.wide}
      busy={over.busy}
      onGive={noop}
      onClear={noop}
      onMarkNoWinner={noop}
      onClearNoWinner={noop}
      onNominate={noop}
      onRemove={noop}
    />,
  );
}

const block = (markup: string, award: string) => markup.match(new RegExp(`<section class="ja-aw-ap[^"]*" aria-label="${award} Award">([\\s\\S]*?)</section>`))?.[1] ?? "";
/** One half of a per-division block: from its opening tag to the next half or the end of the block. */
const half = (markup: string, award: string, key: string) => {
  const start = markup.indexOf(`<div class="ja-aw-half" role="group" aria-label="${award} · ${key}">`);
  if (start < 0) return "";
  const ends = [markup.indexOf('<div class="ja-aw-half"', start + 1), markup.indexOf("</section>", start)].filter((i) => i > 0);
  return markup.slice(start, Math.min(...ends));
};
const aside = (markup: string) => markup.match(/<aside [\s\S]*?<\/aside>/)?.[0] ?? "";
const nominee = (markup: string) => [...markup.matchAll(/<button type="button" class="ja-aw-nr[^"]*"[^>]*aria-label="(\d+\w) /g)].map((m) => m[1]);

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

test("the meta line names the setup, the panel, 12 of 13 decided and how many are sent, over every key", () => {
  const m = board();
  assert.match(m, /<p class="ja-aw-meta">VEX IQ · Blended · all panels · <b>12 of 13<\/b> decided · \d+ nominations for \d+ teams · 3 sent to Marketing<\/p>/);
  assert.match(m, /Winners stay private to you until the ceremony/);
  assert.match(board({ panelId: "p3" }), /VEX IQ · Blended · Panel 3 · <b>12 of 13<\/b> decided/);
  assert.doesNotMatch(board({ released: null }), /sent to Marketing/);
});

test("Nominees from replaces Division: All, ES and MS, with All pressed, and the panel chips and Matrix | By award stay", () => {
  const m = board();
  assert.doesNotMatch(m, />Division</);
  const group = m.match(/<span id="[^"]+" class="ja-aw-cl">Nominees from<\/span>([\s\S]*?)<\/div><\/div>/)![1];
  const chips = [...group.matchAll(/<button type="button" class="ja-aw-chip" aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)].map((c) => `${c[1]} ${text(c[2])}`);
  assert.deepEqual(chips, ["true All", "false ESElementary School", "false MSMiddle School"]);
  assert.match(group, /title="Elementary School"/);
  assert.match(board({ from: MS }), /aria-pressed="true" title="Middle School"/);
  assert.match(m, /<span id="[^"]+" class="ja-aw-cl">Panel<\/span>/);
  assert.match(m, /aria-pressed="true">By award<\/button>/);
  assert.match(m, /Send all ready \(\d+\)/);
});

test("Send all ready counts what is ready in every key: the decided, unsent halves and whole-event awards", () => {
  // Ready: Excellence ES, Excellence MS, Design ES, Innovate (recalled, decided), Amaze, Build, Create (No winner), Judges, Inspire. Sent ones are not.
  assert.match(board(), /Send all ready \(9\)/);
});

test("Nominees from filters nominee rows only: with MS picked an ES winner still shows, an ES non-winner nominee does not", () => {
  const everyone = board();
  const ms = board({ from: MS });
  const exc = block(ms, "Excellence");
  assert.ok(nominee(everyone).includes("12021B"));
  assert.ok(!nominee(exc).includes("12021B"), "Blue Bolts (ES, not the winner) is filtered");
  assert.ok(nominee(exc).includes("41111A"), "Little Levers (ES) won, so it stays");
  assert.ok(nominee(exc).includes("1234A") && nominee(exc).includes("7700B"), "MS nominees stay");
  // Decisions and Send controls always show.
  assert.match(half(ms, "Excellence", ES), /Send to Marketing/);
  assert.match(half(ms, "Excellence", ES), /Winner/);
  // A whole-event block drops its ES non-winners too, and keeps the Send state.
  assert.ok(!nominee(block(ms, "Innovate")).includes("3030T"));
  assert.match(block(ms, "Innovate"), /Send again/);
});

/* ---- by award ------------------------------------------------------------------------------------------ */

test("a per-division award is one block with two halves, each with its own Send to Marketing", () => {
  const m = board();
  const exc = block(m, "Excellence");
  assert.match(exc, /<h2[^>]*>Excellence<\/h2>/);
  assert.match(exc, /Given once per division/);
  assert.equal(exc.split('class="ja-aw-half"').length - 1, 2);
  for (const key of [ES, MS]) {
    const h = half(m, "Excellence", key);
    assert.match(h, new RegExp(`<h3 class="ja-aw-hn">${key}`));
    assert.match(h, new RegExp(`aria-label="Send Excellence · ${key} to Marketing"[^>]*>Send to Marketing`));
    assert.match(h, /Decided/);
  }
  assert.ok(nominee(half(m, "Excellence", ES)).includes("41111A") && !nominee(half(m, "Excellence", ES)).includes("7700B"), "each half has its own division's teams");
  assert.ok(nominee(half(m, "Excellence", MS)).includes("7700B") && !nominee(half(m, "Excellence", MS)).includes("41111A"));
  // Design is sent in MS only: its own Sent time and lock, and an enabled Send in ES.
  assert.match(half(m, "Design", MS), /Sent 10:31/);
  assert.match(half(m, "Design", MS), /Locked: sent to Marketing/);
  assert.match(half(m, "Design", MS), /aria-label="Recall Design · Middle School from Marketing"/);
  assert.match(half(m, "Design", ES), /Send to Marketing/);
  assert.doesNotMatch(half(m, "Design", ES), /Locked|Sent 10/);
});

test("a half with no winner says what it needs instead of Send", () => {
  const open = board({ data: { ...data, winners: winners.filter((w) => !(w.award_id === "excellence" && w.division === MS)) } });
  const h = half(open, "Excellence", MS);
  assert.match(h, /Pick a winner to send/);
  assert.doesNotMatch(h, /Send to Marketing/);
  assert.match(half(open, "Excellence", ES), /Send to Marketing/, "the other half is not held up");
});

test("a whole-event award is one full-width block, labelled Whole event, with nominees from both divisions and their tags", () => {
  const m = board();
  const inn = block(m, "Innovate");
  assert.match(inn, /<span class="ja-aw-scope">Whole event<\/span>/);
  assert.doesNotMatch(inn, /ja-aw-half/);
  assert.match(inn, /aria-label="3030T Tiny Titans, ES,[^"]*Innovate/);
  assert.match(inn, /aria-label="5150Z Gear Grinders, MS,[^"]*Innovate/);
  assert.match(inn, /<span class="ja-aw-ptag ja-aw-dv" title="Elementary School">ES<\/span>/);
  assert.match(inn, /<span class="ja-aw-ptag ja-aw-dv" title="Middle School">MS<\/span>/);
  // The blocks come in the config's order, one column.
  assert.deepEqual([...m.matchAll(/<section class="ja-aw-ap[^"]*" aria-label="(\w+) Award">/g)].map((x) => x[1]), awards.map((a) => a.label));
  assert.match(m, /<div class="ja-aw-stack">/);
  // Judges: two places for the whole event.
  assert.match(block(m, "Judges"), /Whole event/);
  assert.equal([...block(m, "Judges").matchAll(/ja-aw-win/g)].length >= 2, true);
  assert.match(block(board({ data: { ...data, winners: winners.filter((w) => !(w.award_id === "judges" && w.team_id === roboraptors.id)) }, released: noReleases }), "Judges"), /Pick both winners to send/);
});

test("a team of a division outside the setup is a nominee of the whole-event awards only", () => {
  const m = board();
  assert.ok(nominee(block(m, "Innovate")).includes("9000H"));
  assert.ok(!nominee(block(m, "Excellence")).includes("9000H"));
  assert.match(block(m, "Innovate"), /title="High School">HS<\/span>/);
  // Not one of the chips, so it shows under All only.
  assert.ok(!nominee(block(board({ from: ES }), "Innovate")).includes("9000H"));
});

test("Already has reads across every key, and names the scope: Excellence · Middle School", () => {
  const m = board();
  const energy = block(m, "Energy");
  assert.match(text(energy), /Already has Excellence · Middle School/);
  assert.match(energy, /<p class="ja-aw-rwarn">/);
  // 3030T holds nothing.
  assert.equal([...energy.matchAll(/ja-aw-rwarn/g)].length, 1);
  // A whole-event winner is held under Whole event.
  assert.match(text(block(m, "Innovate")), /Already has Amaze · Whole event/);
});

test("a recalled whole-event award says Recalled, shows what Marketing had and keeps Mark no winner on", () => {
  const inn = block(board(), "Innovate");
  assert.match(inn, /<span class="ja-aw-cst">Recalled<\/span>/);
  assert.match(text(inn), /Marketing had 3030T Tiny Titans/);
  assert.match(inn, /aria-label="Send Innovate to Marketing again"/);
  const mark = inn.match(/<button[^>]*aria-label="Mark no winner for Innovate"[^>]*>/)![0];
  assert.doesNotMatch(mark, /disabled/);
});

test("a sent award wears the lock, and Mark no winner is off with the reason", () => {
  const think = block(board(), "Think");
  assert.match(think, /Locked: sent to Marketing/);
  assert.match(think, /Sent 10:33/);
  const mark = think.match(/<button[^>]*aria-label="Mark no winner for Think"[^>]*>/)![0];
  assert.match(mark, /disabled=""/);
  assert.match(mark, /title="Recall it from Marketing first\."/);
  // Per half too.
  const dm = half(board(), "Design", MS).match(/<button[^>]*aria-label="Mark no winner for Design · Middle School"[^>]*>/)![0];
  assert.match(dm, /disabled=""/);
  assert.match(dm, /title="Recall it from Marketing first\."/);
  // Create is "No winner": Clear, not Mark.
  assert.match(block(board(), "Create"), /aria-label="Clear No winner on Create"/);
});

const listProps = (over: Partial<Parameters<typeof BlendedLists>[0]> = {}): Parameters<typeof BlendedLists>[0] => ({
  awards, divisions: [ES, MS], winners, noWinners, releases, released: true, from: "", teams: all, addable: true, sel: null, onSelect: noop, busy: false,
  lists: new Map([ES, MS, WHOLE_EVENT].map((k) => [k, new Map(buildAwardPanels(awards, nominationsIn(nominations, all, k), winnersOf(winners, k), all.filter((t) => k === WHOLE_EVENT || t.division === k), panels, ALL_PANELS, new Map(), noWinnersOf(noWinners, k), heldByTeam(winners)).map((p) => [p.award.id, p]))])),
  onSend: noop, onRecall: noop, onMarkNoWinner: noop, onClearNoWinner: noop, onNominate: noop,
  ...over,
});

test("the taps carry the key: a half sends its division, a whole-event block sends Whole event", () => {
  const calls: string[] = [];
  const els = walk(
    BlendedLists(listProps({
      onSend: (id, key) => calls.push(`send ${id} ${key}`), onRecall: (id, key) => calls.push(`recall ${id} ${key}`),
      onMarkNoWinner: (id, key) => calls.push(`mark ${id} ${key}`), onClearNoWinner: (id, key) => calls.push(`clear ${id} ${key}`),
    })),
  );
  const tap = (label: string) => click(els.find((e) => e.props["aria-label"] === label)!);
  tap(`Send Excellence · ${ES} to Marketing`);
  tap(`Send Excellence · ${MS} to Marketing`);
  tap(`Recall Design · ${MS} from Marketing`);
  tap("Send Innovate to Marketing again");
  tap("Recall Think from Marketing");
  tap("Mark no winner for Energy");
  tap("Clear No winner on Create");
  assert.deepEqual(calls, [
    `send excellence ${ES}`, `send excellence ${MS}`, `recall design ${MS}`, `send innovate ${WHOLE_EVENT}`, `recall think ${WHOLE_EVENT}`, `mark energy ${WHOLE_EVENT}`, `clear create ${WHOLE_EVENT}`,
  ]);
});

test("a nominee row opens the side panel with its key; a busy board turns the writes off", () => {
  const m = board({ busy: true });
  assert.ok([...m.matchAll(/<button type="button" class="ja-aw-snd"[^>]*disabled=""/g)].length >= 1);
  assert.match(m.match(/<button[^>]*aria-label="Mark no winner for Energy"[^>]*>/)![0], /disabled=""/);
  const calls: unknown[] = [];
  const els = walk(BlendedLists(listProps({ onSelect: (s) => calls.push(s) })));
  click(els.find((e) => String(e.props["aria-label"] ?? "").startsWith("12021B Blue Bolts, ES, Excellence"))!);
  click(els.find((e) => String(e.props["aria-label"] ?? "").startsWith("3030T Tiny Titans, ES, Innovate"))!);
  assert.deepEqual(calls, [{ awardId: "excellence", teamId: bolts.id, key: ES }, { awardId: "innovate", teamId: titans.id, key: WHOLE_EVENT }]);
});

test("Add team is for All panels: a panel's view has no picker", () => {
  assert.match(block(board(), "Energy"), /aria-label="Add team to Energy"/);
  assert.match(half(board(), "Excellence", ES), /aria-label="Add team to Excellence · Elementary School"/);
  assert.doesNotMatch(board({ panelId: "p3" }), /Add team/);
});

/* ---- the matrix ------------------------------------------------------------------------------------------ */

test("the matrix has a column per division for Excellence and Design, and a team of the other division has no button there", () => {
  const m = board({ view: "matrix" });
  const heads = [...m.matchAll(/<th scope="col"[^>]*aria-label="([^"]+)"/g)].map((h) => h[1]);
  assert.ok(heads.includes("Excellence ES") && heads.includes("Excellence MS"));
  assert.ok(heads.includes("Design ES") && heads.includes("Design MS"));
  assert.equal([...m.matchAll(/<abbr[^>]*>Inn<\/abbr>/g)].length, 1, "a whole-event award is one column, with no division on it");
  assert.ok(heads.indexOf("Excellence ES") < heads.indexOf("Excellence MS") && heads.indexOf("Design MS") > heads.indexOf("Design ES"), "config order");
  assert.ok(m.indexOf("Design MS") < m.indexOf(">Inn<"), "Design comes before Innovate");
  // Little Levers (ES) has a button under Excellence ES, nothing under Excellence MS.
  const row = m.match(/<tr><th scope="row" class="ja-aw-tm"><b>41111A<\/b>[\s\S]*?<\/tr>/)![0];
  assert.match(row, /aria-label="41111A, Excellence · Elementary School: winner"/);
  assert.doesNotMatch(row, /Excellence · Middle School/);
  assert.match(row, /<td><button[^>]*Excellence · Elementary School: winner[\s\S]*?<\/button><\/td><td><\/td>/);
  // Byte Me (MS) is the mirror image.
  const ms = m.match(/<tr><th scope="row" class="ja-aw-tm"><b>7700B<\/b>[\s\S]*?<\/tr>/)![0];
  assert.match(ms, /<td><\/td><td><button[^>]*Excellence · Middle School: winner/);
  // Rows carry the division tag; the HS team is a row too.
  assert.match(row, /title="Elementary School">ES<\/span>/);
  assert.match(m, /<b>9000H<\/b>/);
  // Tick and lock per key: Design MS is sent, Design ES is not.
  const lock = "Locked: sent to Marketing";
  const design = (k: string) => m.match(new RegExp(`<th scope="col"[^>]*aria-label="Design ${k}">[\\s\\S]*?</th>`))![0];
  assert.match(design("MS"), new RegExp(lock));
  assert.doesNotMatch(design("ES"), new RegExp(lock));
  assert.match(design("ES"), /aria-label="decided"/);
});

test("Nominees from filters matrix rows too, but a team that holds an award stays", () => {
  const m = board({ view: "matrix", from: MS });
  const nums = [...m.matchAll(/<tr><th scope="row" class="ja-aw-tm"><b>(\w+)<\/b>/g)].map((x) => x[1]);
  assert.ok(!nums.includes("3030T"), "Tiny Titans (ES) holds nothing");
  assert.ok(nums.includes("41111A"), "Little Levers (ES) won Excellence");
  assert.ok(nums.includes("7700B"));
});

test("a selected matrix cell highlights its own column only", () => {
  const m = board({ view: "matrix", sel: { awardId: "excellence", teamId: byteMe.id, key: MS } });
  assert.match(m, /<th scope="col" class="ja-aw-on" aria-label="Excellence MS"/);
  assert.doesNotMatch(m, /ja-aw-on" aria-label="Excellence ES"/);
});

test("blendedMatrix merges one matrix per key: no cell for a team of the other division, config order, hidden awards listed", () => {
  const mx = blendedMatrix({ awards, nominations, winners, noWinners, teams: all, panels, flags: [], divisions: [ES, MS], panelId: ALL_PANELS });
  const cols = mx.columns.map((c) => `${c.award.id}${c.key ? `|${c.key}` : ""}`);
  assert.deepEqual(cols.slice(0, 4), [`excellence|${ES}`, `excellence|${MS}`, `design|${ES}`, `design|${MS}`]);
  const levers = mx.rows.find((r) => r.team.id === "t-41111A")!;
  assert.equal(levers.cells[1], "none");
  assert.equal(levers.cells[0], "winner");
  assert.ok(mx.hidden.every((a) => !cols.some((c) => c.startsWith(`${a.id}|`) || c === a.id)));
  assert.ok(!mx.rows.some((r) => r.team.id === quiet.id));
});

/* ---- the side panel ---------------------------------------------------------------------------------------- */

test("the side panel's eyebrow reads Award · key, and its other nominees wear their division tags", () => {
  const des = aside(board({ sel: { awardId: "design", teamId: pixel.id, key: ES } }));
  assert.match(des, /<p class="ja-aw-eyebrow">Design · Elementary School<\/p>/);
  assert.match(des, /<p class="ja-aw-eyebrow">/);
  assert.match(des, /title="Elementary School">ES<\/span>/);
  const inn = aside(board({ sel: { awardId: "innovate", teamId: titans.id, key: WHOLE_EVENT } }));
  assert.match(inn, /<p class="ja-aw-eyebrow">Innovate · Whole event<\/p>/);
  assert.match(inn, /<b>5150Z<\/b> Gear Grinders/);
  assert.match(inn, /title="Middle School">MS<\/span>/);
  // Nothing open: the quiet prompt.
  assert.match(aside(board()), /Pick a nomination to see who made it, and why\./);
});

test("on a phone the panel is a sheet, not a column", () => {
  const m = board({ wide: false, sel: { awardId: "design", teamId: pixel.id, key: ES } });
  assert.doesNotMatch(m, /<aside/);
  assert.match(m, /<dialog class="ja-sheet ja-aw-sheet"/);
});

/* ---- the wiring, read from source ----------------------------------------------------------------------------- */

test("the tab branches on a blended setup, and every Marketing write takes the key it is given", () => {
  const code = tab.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(code, /state\.eventSetup\?\.format === "blended"/);
  assert.match(code, /<BlendedBoard/);
  // One PUT and one DELETE of the release route, the key as `division`: shared by both boards.
  assert.match(code, /const sendAward = \(awardId: string, division: string\) =>\s*write\(async \(\) => \{\s*await call\("\/api\/awards\/released", \{ method: "PUT", body: \{ awardId, division \} \}\)/);
  assert.match(code, /onSend=\{\(awardId, key\) => sendAward\(awardId, key\)\}/);
  assert.match(code, /onRecall=\{\(awardId, key\) => recallAward\(awardId, key\)\}/);
  assert.match(code, /onMarkNoWinner=\{\(awardId, key\) => markNoWinner\(awardId, key\)\}/);
  assert.match(code, /onGive=\{\(d, key\) => write\(\(\) => giveAfterAsking\(ask, call, \{ award: d\.award, team: d\.team, current: d\.current, noWinner: d\.noWinner, division: key \}\)\)\}/);
  assert.match(code, /onClear=\{\(d, key\) => write\(\(\) => clearAfterAsking\(ask, call, \{ award: d\.award, team: d\.team, division: key \}\)\)\}/);
  // Send all ready walks every key and names it.
  assert.match(code, /readyToSend\(data\.awards, keys, data\.winners, data\.noWinners, releases, format\)/);
  assert.match(code, /eventNotReadyLines\(/);
  // Nominees from is component state, and the default is All.
  assert.match(code, /const \[from, setFrom\] = useState\(""\)/);
  assert.ok(!code.includes("window.confirm"));
});

test("the rail's Awards count is event-wide in a blended event, and unchanged otherwise", () => {
  const page = read("src/app/admin/page.tsx");
  assert.match(page, /\.\.\.\(awards\.data\?\.awards\.length \? \{ awards: decidedText\(awards\.data\.winners, awards\.data\.awards, division, awards\.data\.noWinners\) \} : \{\}\)/);
  assert.match(page, /eventDecidedText\(awards\.data\.winners, awards\.data\.awards, [^)]*, awards\.data\.noWinners, "blended"\)/);
});

test("the blended styles live in the Awards block: one column of blocks, halves side by side from 1024px, tokens only, no motion, 44px taps on a phone", () => {
  const block = css.slice(css.indexOf("/* @ja-block awards */"), css.indexOf("/* @ja-block activity */"));
  const phone = block.slice(0, block.indexOf("@media (min-width: 1024px)"));
  const wide = block.slice(block.indexOf("@media (min-width: 1024px)"));
  assert.doesNotMatch(block, /transition|animation/);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|oklch\(|rgb\(|hsl\(/i);
  assert.match(phone, /\.ja-aw-stack \{[^}]*flex-direction: column/);
  assert.match(phone, /\.ja-aw-halves \{[^}]*display: grid/);
  assert.match(wide, /\.ja-aw-halves \{[^}]*repeat\(var\(--n/);
  assert.match(phone, /\.ja-aw-from \.ja-aw-chip \{[^}]*flex: 1/, "three equal buttons on a phone");
  assert.match(phone, /\.ja-aw-scope \{[^}]*border-radius: 999px/);
  assert.match(block, /\.ja-aw-rwarn \{[^}]*color: var\(--caution-quiet\)/, "Already has is caution");
  assert.match(block, /\.ja-aw-rwarn \{[^}]*border-top: 1px solid color-mix\(in srgb, var\(--caution\) 40%, transparent\)/);
  assert.match(phone, /\.ja-aw-bl \.ja-aw-fr \{[^}]*order: -1/, "Send all ready comes first on a phone");
  assert.doesNotMatch(block, /\.ja-aw-(scope|dv)[^{]*\{[^}]*var\(--accent/, "the Whole event label and the division tag are neutral");
});

test("Standard markup is untouched: AwardLists renders its section, header and body exactly as before", () => {
  const lists = buildAwardPanels(awards, nominationsIn(nominations, teams, MS), winnersOf(winners, MS), teams.filter((t) => t.division === MS), panels);
  const m = renderToStaticMarkup(<AwardLists lists={lists} sel={null} onSelect={noop} />);
  assert.doesNotMatch(m, /ja-aw-half|ja-aw-scope|ja-aw-rwarn|ja-aw-dv|ja-aw-n1/);
  assert.match(m, /<section class="ja-aw-ap ja-aw-dec" aria-label="Design Award"><header class="ja-aw-aph"><h2 title="[^"]*">Design<\/h2><span class="ja-aw-cst ja-aw-ok">Decided<\/span><\/header>/);
});
