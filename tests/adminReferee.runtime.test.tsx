import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { AdminFrame } from "../src/components/admin/AdminFrame";
import { CorrectSheet, RefereeBoard } from "../src/components/admin/RefereeTab";
import { goBack, pickTeam, startNav, type RefereeNav } from "../src/components/admin/refereeLogic";
import { SeverityButtons } from "../src/components/referee/SeverityButtons";
import type { FlagKind } from "../src/components/Flags";
import { matchTypes } from "../src/lib/presets";
import { commonFieldRules } from "../src/lib/rules";
import { pillClass } from "../src/components/admin/refereeLogic";
import type { FlagRow, PublicPanel, Team } from "../src/lib/types";

/* The Judge Advisor Referee tab, rendered to markup. Behaviour that needs a
   browser (the sheet opening, a tap) has no DOM harness here; the decisions
   behind it run as plain functions in adminReferee.logic.test.mjs and the
   wiring is read from source below. */

const noop = () => {};

const kinds: FlagKind[] = [
  { id: "good", label: "Good conduct", short: "Good", color: "emerald", severity: 0, requiresRule: false },
  { id: "warning", label: "Warning", short: "Warning", color: "amber", severity: 1, requiresRule: false },
  { id: "minor", label: "Minor violation", short: "Minor", color: "orange", severity: 2, requiresRule: true },
  { id: "major", label: "Major violation", short: "Major", color: "rose", severity: 3, requiresRule: true },
  { id: "dq", label: "Disqualified", short: "DQ", color: "black", severity: 4, requiresRule: true },
];

const panels = [{ id: "p2", name: "Panel 2", division: "Middle School" }] as unknown as PublicPanel[];
const team = (number: string, name: string, over: Partial<Team> = {}): Team => ({
  id: `t-${number}`, number, name, panel_id: null, division: "Middle School", category: "developing", pit: null, created_at: "2026-10-20T08:00:00Z", ...over,
});
const rookies = team("1101R", "Rookies");
const titans = team("9882K", "Torque Titans", { panel_id: "p2", pit: "14" });
const nuts = team("6036D", "Nuts & Bolts");
const breakers = team("1108", "Circuit Breakers");
const gremlins = team("2011A", "Gear Gremlins");
const teams = [rookies, titans, nuts, breakers, gremlins];

let n = 0;
const flag = (t: Team, kind: string, over: Partial<FlagRow> = {}): FlagRow => ({
  id: `f${++n}`, team_id: t.id, kind, body: "", author: "Jordan Lee", match_type: "Q", match_number: "1", field: "1", rule: null,
  ruleset: "v5rc", manual_version: null, match_affecting: false, created_at: "2026-10-20T10:00:00.000Z", ...over,
});
const at = (hhmm: string) => `2026-10-20T${hhmm}:00.000Z`;

// The Referee mocks, as data.
const q12 = flag(titans, "warning", { rule: "GG17", match_number: "12", field: "1", created_at: at("09:58") });
const q19 = flag(titans, "minor", { rule: "GG17", match_number: "19", field: "2", match_affecting: true, body: "pinned for 7s", created_at: at("10:42") });
const mock = [
  flag(rookies, "dq", { rule: "SG6", match_number: "30", created_at: at("11:10") }),
  flag(rookies, "good", { match_number: "31", created_at: at("11:20") }),
  q12,
  q19,
  flag(nuts, "minor", { rule: "SG9", match_number: "4", created_at: at("10:00") }),
  flag(breakers, "warning", { match_number: "2", created_at: at("09:00") }),
  flag(breakers, "warning", { match_number: "9", created_at: at("09:30") }),
  flag(breakers, "warning", { match_number: "15", created_at: at("10:30") }),
  flag(gremlins, "good", { match_number: "7", created_at: at("10:15") }),
];

function board(over: { flags?: FlagRow[]; nav?: RefereeNav; focus?: string | null } = {}) {
  return renderToStaticMarkup(
    <RefereeBoard
      flags={over.flags ?? mock}
      kinds={kinds}
      teams={teams}
      panels={panels}
      nav={over.nav ?? startNav(over.focus ?? null)}
      focusTeamId={over.focus ?? null}
      onPick={noop}
      onBack={noop}
      onEdit={noop}
      onRemove={noop}
    />,
  );
}
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
const rows = (markup: string) => [...markup.matchAll(/<button type="button" class="ja-rf-jr"([^>]*)><span class="ja-rf-c1"><b>(.*?)<\/b>/g)].map((m) => ({ number: m[2], current: m[1].includes('aria-current="true"') }));
const detail = (markup: string) => markup.match(/<section class="ja-rf-det"[\s\S]*?<\/section>/)?.[0] ?? "";

test("the phone's section bar says '9 flags' on Referee, and the rail marks Referee current with its count", () => {
  const router = {} as React.ContextType<typeof AppRouterContext>;
  const frame = (flags: number) =>
    renderToStaticMarkup(
      <AppRouterContext.Provider value={router}>
        <AdminFrame name="Alex Morgan" online tab="flags" onTab={noop} counts={{ flags }}>
          <p>the tab</p>
        </AdminFrame>
      </AppRouterContext.Provider>,
    );
  const bar = (m: string) => m.match(/<div class="ja-sbar">[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(bar(frame(9)), /<b>Referee<\/b><span class="ja-rc">9 flags<\/span>/);
  assert.match(bar(frame(1)), /<span class="ja-rc">1 flag<\/span>/);
  assert.doesNotMatch(bar(frame(0)), /ja-rc/, "nothing at zero");
  assert.match(frame(9), /<button type="button" class="ja-ri" aria-current="page">[\s\S]*?<span>Referee<\/span><span class="ja-rc">9<\/span>/);
});

/* ---- the strip and the caption --------------------------------------------------- */

test("the count strip has the five severities, worst first, each with its dot, count and both labels", () => {
  const m = board();
  const strip = m.match(/<section class="ja-cs ja-rf-cs" aria-label="Flags by severity">[\s\S]*?<\/section>/)?.[0] ?? "";
  const cells = [...strip.matchAll(/<div><b>(\d+)<\/b><span><i aria-hidden="true" class="ja-rf-dot ([^"]+)"><\/i><em class="ja-rf-long">(.*?)<\/em><em class="ja-rf-short">(.*?)<\/em>/g)];
  assert.deepEqual(
    cells.map((c) => [c[1], c[2], c[3], c[4]]),
    [
      ["1", "bg-ink", "Disqualified", "DQ"],
      ["0", "bg-danger", "Major violation", "Major"],
      ["2", "bg-waiting", "Minor violation", "Minor"],
      ["4", "bg-caution", "Warning", "Warning"],
      ["2", "bg-done", "Good conduct", "Good"],
    ],
  );
  assert.match(m, /<p class="ja-rf-cap">Recorded by referees on their own page\. Judges see these against the teams they are judging; teams and the queue desk do not\.<\/p>/);
});

test("with no flags the strip shows zeros and the page says no referee has flagged anything", () => {
  const m = board({ flags: [] });
  assert.match(m, /<p class="ja-empty">No referee has flagged anything yet\.<\/p>/);
  assert.doesNotMatch(m, /ja-rf-cols|ja-rf-jr/);
  assert.equal([...m.matchAll(/<div><b>0<\/b>/g)].length, 5);
  assert.match(m, /Recorded by referees on their own page/);
});

/* ---- the flagged teams ----------------------------------------------------------- */

test("the left column lists one row per flagged team, worst first then most flags, with the worst pill and the count", () => {
  const m = board();
  assert.deepEqual(rows(m).map((r) => r.number), ["1101R", "9882K", "6036D", "1108", "2011A"]);
  const list = m.match(/<nav class="ja-rf-tl" aria-label="Flagged teams">[\s\S]*?<\/nav>/)?.[0] ?? "";
  assert.match(list, /<h2>Flagged teams<\/h2><span>5<\/span>/);
  const pills = [...list.matchAll(/<span class="ja-sp ([^"]+)" title="([^"]+)">(.*?)<\/span>/g)].map((x) => [x[3], x[1]]);
  assert.deepEqual(pills, [
    ["DQ", "bg-ink text-canvas"],
    ["Minor", "bg-waiting text-waiting-ink"],
    ["Minor", "bg-waiting text-waiting-ink"],
    ["Warning", "bg-caution text-waiting-ink"],
    ["Good", "bg-done text-done-ink"],
  ]);
  assert.deepEqual([...list.matchAll(/<\/svg>(\d+)<span class="sr-only"> (flags?)<\/span>/g)].map((x) => [x[1], x[2]]), [["2", "flags"], ["2", "flags"], ["1", "flag"], ["3", "flags"], ["1", "flag"]]);
  // Real buttons, not links to nowhere.
  assert.equal([...list.matchAll(/<button type="button" class="ja-rf-jr"/g)].length, 5);
});

test("the first row is selected by default, and its team's history is the right pane", () => {
  const m = board();
  assert.deepEqual(rows(m).map((r) => r.current), [true, false, false, false, false]);
  assert.match(detail(m), /<h2 id="[^"]+"><b>1101R<\/b><span>Rookies<\/span><\/h2>/);
});

test("arriving from Scores selects that team instead; the others are not current", () => {
  const m = board({ focus: titans.id });
  assert.deepEqual(rows(m).map((r) => [r.number, r.current]), [["1101R", false], ["9882K", true], ["6036D", false], ["1108", false], ["2011A", false]]);
  assert.match(detail(m), /<h2 id="[^"]+"><b>9882K<\/b><span>Torque Titans<\/span><\/h2>/);
  // The trip is marked in the list too (a phone rings it).
  assert.match(m, /<li class="ja-rf-fx"><button type="button" class="ja-rf-jr" aria-current="true"><span class="ja-rf-c1"><b>9882K<\/b>/);
  // Without it no row is marked.
  assert.doesNotMatch(board(), /ja-rf-fx/);
  // A picked team beats the trip.
  const picked = board({ focus: titans.id, nav: pickTeam(startNav(titans.id), gremlins.id) });
  assert.deepEqual(rows(picked).filter((r) => r.current).map((r) => r.number), ["2011A"]);
  assert.doesNotMatch(picked, /ja-rf-fx/, "the ring goes with the selection");
});

/* ---- the team's pane ------------------------------------------------------------- */

test("the pane has the team's number and name, its tags, and a summary pill per severity", () => {
  const d = detail(board({ focus: titans.id }));
  assert.match(d, /<b>9882K<\/b><span>Torque Titans<\/span>/);
  assert.deepEqual([...d.matchAll(/<span class="jg-ptag">(.*?)<\/span>/g)].map((x) => x[1]), ["MS", "Pit 14", "Panel 2"]);
  assert.deepEqual([...d.matchAll(/<span class="ja-sp [^"]+" title="[^"]+">(\w+ ×\d+)<\/span>/g)].map((x) => x[1]), ["Minor ×1", "Warning ×1"]);
});

test("the repeat box reads 'Repeated. GG17 twice: Q12 (Warning), Q19 (Minor)', and only a repeat has one", () => {
  const d = detail(board({ focus: titans.id }));
  const box = d.match(/<div class="jg-caution" role="note">[\s\S]*?<\/div><\/div>/)?.[0] ?? "";
  assert.ok(box, "the caution box is there");
  assert.equal(text(box), "Repeated. GG17 twice: Q12 (Warning), Q19 (Minor)");
  assert.match(box, /<b>Repeated\.<\/b>/);
  assert.doesNotMatch(detail(board({ focus: nuts.id })), /jg-caution/, "one flag on a rule is not a repeat");
  assert.doesNotMatch(detail(board({ focus: breakers.id })), /jg-caution/, "three Warnings with no rule are not a repeat");
});

test("History is newest first, a timeline with a dot in the severity colour on each flag", () => {
  const d = detail(board({ focus: titans.id }));
  assert.match(d, /<h3 class="ja-sec">History<\/h3><span>newest first<\/span>/);
  const entries = d.split('<li class="ja-rf-tle">').slice(1);
  assert.equal(entries.length, 2);
  assert.match(entries[0], /<b>Q19<\/b>/);
  assert.match(entries[1], /<b>Q12<\/b>/);
  assert.match(entries[0], /<i aria-hidden="true" class="ja-rf-mk bg-waiting">/);
  assert.match(entries[1], /<i aria-hidden="true" class="ja-rf-mk bg-caution">/);
  // The time is on the left.
  assert.match(entries[0], /^<span class="ja-rf-tt"[^>]*>[^<]*\d:\d\d/);
});

test("a history card has the pill, match and field, rule chips, the Repeated tag, Match affecting, the note, the referee and Edit / Remove", () => {
  const d = detail(board({ focus: titans.id }));
  const [newer, older] = d.split('<li class="ja-rf-tle">').slice(1);
  assert.match(newer, /<span class="ja-sp bg-waiting text-waiting-ink" title="Minor violation">Minor<\/span>/);
  assert.match(newer, /<span class="ja-rf-mf"><b>Q19<\/b><span> · Field 2<\/span><\/span>/);
  assert.match(newer, /<span class="ja-rf-ru" title="[^"]*GG17[^"]*">GG17<\/span><span class="ja-pill">[\s\S]*?Repeated<\/span>/);
  assert.match(newer, /<span class="jg-ptag ja-rf-ma">Match affecting<\/span>/);
  assert.match(newer, /<p class="ja-rf-bn">“pinned for 7s”<\/p>/);
  assert.match(newer, /<span class="ja-rf-fwho">Jordan Lee<\/span>/);
  assert.match(newer, /aria-label="Edit flag: 9882K, Q19, Minor">Edit<\/button>/);
  assert.match(newer, /aria-label="Remove flag: 9882K, Q19, Minor">Remove<\/button>/);
  // The older flag was the first time: no Repeated, no Match affecting, no note.
  assert.doesNotMatch(older, /Repeated|Match affecting|ja-rf-bn/);
  assert.match(older, /<b>Q12<\/b><span> · Field 1<\/span>/);
  // Edit and Remove open dialogs: say so.
  assert.equal([...d.matchAll(/class="jg-quiet ja-rf-q" aria-haspopup="dialog"/g)].length, 4);
});

/* ---- the phone: list, team, back --------------------------------------------------- */

test("a phone starts on the list, opens a team on a tap, and the back button returns to the list", () => {
  const view = (nav: RefereeNav, focus: string | null = null) => board({ nav, focus }).match(/<div class="ja-rf" data-view="(\w+)">/)?.[1];

  let nav = startNav(null);
  assert.equal(view(nav), "list");

  nav = pickTeam(nav, nuts.id);
  assert.equal(view(nav), "team");
  assert.deepEqual(rows(board({ nav })).filter((r) => r.current).map((r) => r.number), ["6036D"]);
  assert.match(detail(board({ nav })), /<b>6036D<\/b><span>Nuts &amp; Bolts<\/span>/);
  // The history has a back button, named for where it goes.
  assert.match(detail(board({ nav })), /<button type="button" class="ja-rf-back">[\s\S]*?<\/svg>Flagged teams<\/button>/);

  nav = goBack(nav);
  assert.equal(view(nav), "list");
  assert.deepEqual(rows(board({ nav })).filter((r) => r.current).map((r) => r.number), ["6036D"], "the team stays marked in the list");

  // Arriving from Scores opens that team directly.
  assert.equal(view(startNav(titans.id), titans.id), "team");
});

test("the phone shows one screen at a time and the wide layout shows both, by CSS", () => {
  const css = read("src/app/globals.css");
  const block = css.slice(css.indexOf("/* Referee (design/admin-redesign"), css.indexOf("/* Teams (design/admin-redesign"));
  assert.match(block, /@media \(max-width: 1023\.98px\) \{[^}]*\.ja-rf\[data-view="team"\] \.ja-rf-top, \.ja-rf\[data-view="team"\] \.ja-rf-tl \{ display: none; \}/);
  assert.match(block, /\.ja-rf\[data-view="list"\] \.ja-rf-det \{ display: none; \}/);
  // From 1024px nothing is hidden by the view, and the back button goes.
  const wide = block.slice(block.lastIndexOf("@media (min-width: 1024px)"));
  assert.match(wide, /\.ja-rf-cols \{ display: flex; align-items: flex-start; gap: 20px; \}/);
  assert.match(wide, /\.ja-rf-tl \{[^}]*width: 340px/);
  assert.match(wide, /\.ja-rf-back \{ display: none; \}/);
  assert.doesNotMatch(wide, /data-view/);
});

/* ---- the Correct flag sheet -------------------------------------------------------- */

function sheet(over: { flag?: FlagRow | null; fieldCount?: number; admin?: string | null } = {}) {
  return renderToStaticMarkup(
    <CorrectSheet
      flag={over.flag === undefined ? q19 : over.flag}
      team={titans}
      kinds={kinds}
      fieldCount={over.fieldCount ?? 3}
      adminName={over.admin === undefined ? "Alex Morgan" : over.admin}
      onSave={async () => {}}
      onClose={noop}
    />,
  );
}

test("the sheet is a closed native dialog until there is a flag, titled 'Correct flag · <team>'", () => {
  const closed = sheet({ flag: null });
  assert.match(closed, /^<dialog class="ja-sheet ja-rfs" aria-modal="true" aria-labelledby="[^"]+"><\/dialog>$/);
  const m = sheet();
  assert.match(m, /^<dialog class="ja-sheet ja-rfs" aria-modal="true" aria-labelledby="([^"]+)">/);
  assert.match(m, /<h2 id="([^"]+)">Correct flag · 9882K<\/h2>/);
  assert.match(m, /<button type="button" class="ja-x" aria-label="Close">/);
  assert.doesNotMatch(m, /^<dialog[^>]* open/, "opened by showModal(), never rendered open");
});

test("it offers the match types the flag's ruleset offers, the event's fields, and the common rules", () => {
  const m = sheet();
  const types = m.match(/aria-labelledby="[^"]+-m-type-l"[^>]*>([\s\S]*?)<\/div><\/div>/)?.[1] ?? "";
  assert.deepEqual(
    [...types.matchAll(/aria-label="[^"]+ \((\w+)\)"[^>]*>(\w+)<\/button>/g)].map((x) => x[1]),
    matchTypes("v5rc").filter((t) => t.group === "teamwork").map((t) => t.id),
  );
  // Fields are 1..the event's count, no more.
  const fields = m.match(/id="[^"]+-m-field-l"[^>]*>Field<\/div>([\s\S]*?)<\/div><\/div>/)?.[1] ?? "";
  assert.deepEqual([...fields.matchAll(/<button[^>]*>(\w+)<\/button>/g)].map((x) => x[1]), ["1", "2", "3"]);
  assert.deepEqual([...sheet({ fieldCount: 5 }).matchAll(/class="w-12 h-12[^"]*">(\d+)<\/button>/g)].map((x) => x[1]), ["1", "2", "3", "4", "5"]);
  // Rule chips: the ruleset's shortcuts, GG17 (on the flag) pressed.
  const chips = [...m.matchAll(/<button type="button" class="ja-rf-chip" aria-pressed="(true|false)"[^>]*>(\w+)<\/button>/g)];
  assert.deepEqual(chips.map((c) => c[2]), commonFieldRules("v5rc").map((r) => r.id));
  assert.deepEqual(chips.filter((c) => c[1] === "true").map((c) => c[2]), ["GG17"]);
  assert.match(m, /<span class="ja-rf-dl">All rules <em>· 109 in V5RC Override<\/em><\/span><span class="ja-rf-cnt">1 selected<\/span>/);
});

test("an IQ flag is offered IQ's types and rules, not V5RC's", () => {
  const iq = flag(titans, "warning", { ruleset: "viqrc", rule: null, match_type: "Q", match_number: "3", field: "1" });
  const m = sheet({ flag: iq });
  const types = m.match(/aria-labelledby="[^"]+-m-type-l"[^>]*>([\s\S]*?)<\/div><\/div>/)?.[1] ?? "";
  assert.deepEqual([...types.matchAll(/aria-label="[^"]+ \((\w+)\)"/g)].map((x) => x[1]), ["P", "Q", "F"]);
  assert.doesNotMatch(m, />R16<|>QF<|>GG17<\/button>/);
  assert.match(m, /All rules <em>· 81 in VEX IQ<\/em>/);
});

test("an old flag keeps its old field and match type, marked (old); nothing else off the list is offered", () => {
  const old = flag(titans, "warning", { ruleset: "viqrc", rule: null, match_type: "SK", match_number: "2", field: "HS2" });
  const m = sheet({ flag: old });
  assert.match(m, />HS2 \(old\)<\/button>/);
  assert.match(m, /Skills[^<]*<\/button>/);
  assert.match(m, /(Skills|SK)[^<]* \(old\)/);
  assert.doesNotMatch(sheet({ flag: q19 }), /\(old\)/);
});

test("the match-affecting switch is for Minor and Major, or once a rule is picked", () => {
  assert.match(sheet(), /<label class="ja-rf-row"><span>Match affecting<small>Minor and Major only<\/small><\/span><input type="checkbox" role="switch" class="ja-rf-sw" checked=""\/>/);
  const warning = flag(titans, "warning", { rule: null });
  assert.doesNotMatch(sheet({ flag: warning }), /ja-rf-row/, "a Warning with no rule has nothing to say about the match");
  assert.match(sheet({ flag: flag(titans, "warning", { rule: "GG17" }) }), /ja-rf-row/);
});

test("the note is there with its text, and the whole group locks while a save is in flight", () => {
  const m = sheet();
  assert.match(m, /<label class="ja-lab ja-rf-lab" for="([^"]+)-note"><span>Note<\/span><span class="ja-op">Optional<\/span><\/label><textarea id="\1-note" class="ja-rf-area" rows="2" maxLength="500">pinned for 7s<\/textarea>/);
  assert.match(m, /<fieldset class="ja-rf-fs">/);
  const body = read("src/components/admin/RefereeTab.tsx");
  assert.ok(body.includes("<fieldset disabled={busy}"));
});

test("there are five compact severity buttons, the flag's own pressed, none of them a submit", () => {
  const m = sheet();
  const group = m.match(/<div class="ja-sev5" role="group"[\s\S]*?<\/div><\/div>/)?.[0] ?? "";
  const buttons = [...group.matchAll(/<button type="(\w+)" aria-pressed="(true|false)"[^>]*>(?:<i[^>]*><\/i>)?([^<]+)<\/button>/g)];
  assert.deepEqual(buttons.map((b) => [b[3], b[2]]), [["Good", "false"], ["Warning", "false"], ["Minor", "true"], ["Major", "false"], ["DQ", "false"]]);
  assert.ok(buttons.every((b) => b[1] === "button"), "tapping one cannot submit the form");
  assert.match(group, /class="ja-sv bg-waiting text-waiting-ink[^"]*"/, "the chosen one is filled in its severity colour");
  assert.match(m, /<div class="ja-lab" id="[^"]+">Severity<\/div>/);
});

test("'Save correction' is the one submit, pinned under the fields, with who it is logged under", () => {
  const m = sheet();
  assert.equal([...m.matchAll(/type="submit"/g)].length, 1);
  assert.match(m, /<div class="ja-cf-foot ja-rf-foot"><button type="submit" class="ja-prim">Save correction<\/button><p class="ja-rf-log">Logged as a correction by Alex Morgan<\/p><\/div>/);
  assert.ok(m.indexOf('class="ja-cf-foot') > m.indexOf('class="ja-cf-scroll'), "after the scrolling fields");
  assert.match(sheet({ admin: null }), /Logged as a correction by the Judge Advisor/);
});

test("a correction that cannot be saved says why and keeps the button off", () => {
  const noRule = flag(titans, "minor", { rule: "GG17", match_type: "Q", match_number: "3", field: "1" });
  // The sheet starts as the flag is, so a valid one has no blocker...
  assert.doesNotMatch(sheet({ flag: noRule }), /ja-rf-need|disabled=""/);
  // ...and one whose match number is gone does (the field is empty).
  const bare = flag(titans, "warning", { match_number: null, match_type: null, field: null, rule: null });
  const m = sheet({ flag: bare });
  assert.match(m, /<p class="ja-rf-need" id="([^"]+)" role="status">Set the match and field first\.<\/p><button type="submit" class="ja-prim" disabled="" aria-describedby="\1">Save correction<\/button>/);
});

test("the All rules picker sits outside the form, so its search box cannot submit the correction", () => {
  const m = sheet();
  assert.ok(m.indexOf("</form>") < m.indexOf('class="fixed inset-0'), "the picker follows the form");
});

/* ---- compact severity buttons are the referee console's, not a copy ------------------ */

test("the compact variant is a prop of the referee console's SeverityButtons, which draws as it did without it", () => {
  const consoleMarkup = renderToStaticMarkup(<SeverityButtons kinds={kinds} value="minor" onChange={noop} />);
  assert.match(consoleMarkup, /id="rf-sev-l"/);
  assert.match(consoleMarkup, /class="rf-sev"/);
  assert.doesNotMatch(consoleMarkup, /ja-sv|ja-sev5/);
  assert.equal(consoleMarkup, renderToStaticMarkup(<SeverityButtons kinds={kinds} value="minor" onChange={noop} compact={false} />));
  assert.match(renderToStaticMarkup(<SeverityButtons kinds={kinds} value="minor" onChange={noop} compact />), /class="ja-sev5"/);
});

/* ---- the wiring (source) ------------------------------------------------------------ */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const tab = read("src/components/admin/RefereeTab.tsx");
const logic = read("src/components/admin/refereeLogic.ts");
const page = read("src/app/admin/page.tsx");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

test("severity buttons in the sheet only select; Save correction is the only thing that saves", () => {
  const body = code(tab.slice(tab.indexOf("function CorrectBody")));
  // The severity buttons change the draft and nothing else.
  assert.match(body, /<SeverityButtons compact kinds=\{kinds\} value=\{draft\.kind\} onChange=\{\(kind\) => set\(\{ kind \}\)\} \/>/);
  // The one send is saveCorrection, called from the form's submit, never from a field's handler.
  assert.equal(body.match(/saveCorrection\(/g)?.length, 1);
  assert.equal(body.match(/onSave\(/g)?.length ?? 0, 0, "the sheet never calls onSave itself");
  assert.match(body, /<form className="ja-sh-form" onSubmit=\{submit\}>/);
  assert.match(body, /async function submit\(e: React\.FormEvent\) \{\s*e\.preventDefault\(\);[\s\S]*?await saveCorrection\(/);
  assert.match(body, /<button type="submit" className="ja-prim"[^>]*>\s*\{busy \? "Saving…" : "Save correction"\}/);
  assert.ok(body.includes("await saveCorrection({ flag, draft, kinds, fieldCount, onSave });"), "onSave is only handed to saveCorrection");
  assert.match(logic, /export async function saveCorrection[\s\S]*?if \(correctionBlocker\(p\)\) return false;[\s\S]*?await p\.onSave\(/);
});

test("Remove goes through the confirm and only the confirm; the DELETE and PATCH are as they were", () => {
  const src = code(tab);
  assert.ok(src.includes("const { ask, dialog } = useConfirm();") && src.includes("{dialog}"));
  assert.ok(src.includes("removeAfterAsking(ask, async () => {"));
  assert.equal(src.match(/method: "DELETE"/g)?.length, 1, "one delete, inside the confirmed callback");
  assert.ok(src.indexOf('method: "DELETE"') > src.indexOf("removeAfterAsking(ask"));
  assert.ok(src.includes("`/api/flags?id=${flag.id}`"));
  assert.ok(src.includes('call(`/api/flags`, { method: "PATCH", body: { id, ...patch } })'));
  assert.ok(!src.includes("confirm("), "never window.confirm");
  assert.match(src, /onError\(\(e as Error\)\.message\);\s*throw e;/, "a failed save is shown on the page and rethrown for the sheet");
  assert.match(logic, /await ask\(REMOVE_QUESTION, \{ confirmLabel: "Remove flag", danger: true \}\)/);
});

test("the sheet is a native dialog opened with showModal(); Escape and the backdrop close it", () => {
  const src = code(tab);
  assert.ok(src.includes("el.showModal()") && src.includes("el.close()"));
  assert.match(src, /onClose=\{\(\) => \{\s*if \(open\) onClose\(\);/);
  assert.match(src, /if \(e\.target === e\.currentTarget\) onClose\(\);/);
  assert.match(src, /aria-label="Close" onClick=\{onClose\}/);
  assert.ok(src.includes("<MatchFields") && src.includes("<AllRulesPicker") && src.includes("<SeverityButtons"), "the referee console's own controls");
  assert.ok(!/<select|<RulePicker/.test(src));
});

test("Scores' conduct trip: the page hands the tab its focus team and the admin's name, and clears it on leaving", () => {
  assert.ok(page.includes("<RefereeTab"));
  assert.match(page, /focusTeamId=\{focusFlagTeam\}\s*adminName=\{session\?\.name\}/);
  assert.match(page, /if \(id !== tab\) setFocusFlagTeam\(null\);\s*setTab\(id\);/);
  assert.match(page, /setFocusFlagTeam\(team\.id\);\s*setTab\("flags"\);/);
  assert.ok(!page.includes("function FlagsTab(") && !page.includes("<FlagList"), "the old tab and its inline editor are gone from the page");
  // The tab opens on the focused team and scrolls its row into view.
  assert.ok(tab.includes("useState<RefereeNav>(() => startNav(focusTeamId))"));
  assert.ok(tab.includes('scrollIntoView?.({ block: "nearest" })'));
  assert.match(tab, /\[focusTeamId\]/);
});

test("the Referee styles are page-scoped, use tokens for both themes, and have no animation", () => {
  const css = read("src/app/globals.css");
  const block = css.slice(css.indexOf("/* Referee (design/admin-redesign"), css.indexOf("/* Teams (design/admin-redesign"));
  assert.ok(block.length > 1000);
  assert.doesNotMatch(block, /@keyframes|animation|transition/, "no playful motion");
  assert.doesNotMatch(block, /oklch\(|#[0-9a-f]{3,6}\b|\brgb\(/i, "colours come from the tokens, so light works too");
  assert.match(block, /\.ja-rf-jr\[aria-current="true"\]::before \{[^}]*width: 3px; background: var\(--accent\)/, "the selected row has the accent bar");
  assert.match(block, /\.ja-rf-jr\[aria-current="true"\] \{ background: var\(--ja-accent-t\)/);
  assert.match(block, /\.ja-rf-chip\[aria-pressed="true"\] \{[^}]*background: var\(--accent\)/, "a chosen rule is accent");
  assert.match(block, /\.ja-sv\[aria-pressed="true"\] \{[^}]*var\(--accent\)/, "a chosen severity is ringed in accent");
  assert.match(block, /\.ja-rf-sw:checked::after \{[^}]*background: var\(--accent\)/);
  // The save button is the shared accent primary.
  assert.match(css, /\.ja-prim \{[^}]*background: var\(--accent\)/);
  // Touch targets: 44px on a phone.
  assert.match(block, /\.ja-rf-jr \{[^}]*min-height: 60px/);
  assert.match(block, /\.ja-rf-chip \{[^}]*height: 44px/);
  assert.match(block, /\.ja-sv \{[^}]*height: 44px/);
  assert.match(block, /\.ja-rf-back \{[^}]*min-height: 44px/);
  assert.match(block, /\.ja-rf-sw \{[^}]*height: 44px/);
  assert.match(css, /\.jg-quiet \{[^}]*min-height: 44px/, "Edit and Remove are 44px");
  // From 1024px the sheet is a centred dialog.
  assert.match(block, /\.ja-rfs \{[^}]*margin: auto;/);
  // Caution is for Repeated and nothing else here.
  assert.doesNotMatch(block, /--caution/);
});

/* ---- colour: the Major pill ---------------------------------------------------------- */

/* oklch -> linear sRGB -> WCAG contrast, so the pills can be checked against the real tokens. */
function linear(oklch: string): [number, number, number] {
  const m = oklch.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)/);
  if (!m) throw new Error(`not an oklch colour: ${oklch}`);
  const [L, C, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * s),
  ];
}
const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(linear(a)), luminance(linear(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function tokens(theme: "dark" | "light"): Record<string, string> {
  const css = read("src/app/globals.css");
  const start = theme === "light" ? css.indexOf(':root[data-theme="light"] {') : css.indexOf(":root,\n:root[data-theme=\"dark\"] {");
  const block = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(oklch\([^)]+\))/g)].map((m) => [m[1], m[2]]));
}

test("every severity pill reads at 4.5:1 or better, in both themes -- the Major one included", () => {
  const configured = JSON.parse(read("config/event.json")).refereeFlags as { id: string; color: string }[];
  assert.deepEqual(configured.map((k) => k.id), ["good", "warning", "minor", "major", "dq"]);
  for (const theme of ["dark", "light"] as const) {
    const t = tokens(theme);
    for (const { id, color } of configured) {
      const [, fill, ink] = pillClass(color).match(/\bbg-([\w-]+) text-([\w-]+)\b/) ?? [];
      assert.ok(fill && ink, `${id}: a pill is a fill and an ink`);
      assert.doesNotMatch(pillClass(color), /text-white|\btext-\[#/, `${id}: the ink is a token, never white`);
      const ratio = contrast(t[fill], t[ink]);
      assert.ok(ratio >= 4.5, `${id} pill in ${theme}: ${ratio.toFixed(2)}:1 (${fill} with ${ink})`);
    }
  }
});

test("the contrast check does catch the failure it guards against: white on a lighter red is 3.5:1", () => {
  // The Referee mock's Major fill with white text, as the spec measured it.
  const lighterRed = "oklch(0.640 0.200 18)";
  const white = "oklch(0.985 0.010 18)";
  assert.ok(contrast(lighterRed, white) < 4.5);
  assert.ok(contrast(lighterRed, "oklch(0.165 0.012 265)") >= 4.5, "dark ink is what that red needs");
  // The app's own Major fill is deeper, so its near-white ink clears the bar.
  const dark = tokens("dark");
  assert.ok(contrast(dark.danger, dark["danger-ink"]) >= 4.5);
  assert.ok(contrast(dark.danger, dark.canvas) < 4.5, "dark ink on the app's red would be worse, so the pair stays");
});
