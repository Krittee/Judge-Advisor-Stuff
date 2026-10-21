import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ActivityBoard, ActivityTab, EventRow } from "../src/components/admin/ActivityTab";
import { NO_FILTERS, NO_POLL, type ActivityFilters, type Poll } from "../src/components/admin/activityLogic";
import type { ActivityRow, AppState, Team } from "../src/lib/types";

/* The Judge Advisor Activity tab, rendered to markup. Behaviour that needs a
   browser (the polling timer, the sticky headers, the dialog) has no DOM
   harness here; the decisions behind it run as plain functions in
   adminActivity.logic.test.mjs, the chip's handler is called straight off its
   element tree, and the page's wiring is read from source at the foot. */

const noop = () => {};
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("src/app/admin/page.tsx");
const css = read("src/app/globals.css");

/** 21 Oct 2026 at h:m, in the machine's own zone: the timeline reads the viewer's clock. */
const at = (h: number, m: number) => new Date(2026, 9, 21, h, m).toISOString();

const flagKinds: AppState["flagKinds"] = [
  { id: "good", label: "Good conduct", short: "Good", color: "emerald", severity: 0, requiresRule: false },
  { id: "warning", label: "Warning", short: "Warning", color: "amber", severity: 1, requiresRule: false },
  { id: "minor", label: "Minor violation", short: "Minor", color: "orange", severity: 2, requiresRule: true },
  { id: "major", label: "Major violation", short: "Major", color: "rose", severity: 3, requiresRule: true },
  { id: "dq", label: "Disqualified", short: "DQ", color: "black", severity: 4, requiresRule: true },
];
const team = (number: string, name: string): Team => ({
  id: `t-${number}`, number, name, panel_id: "p2", division: "Middle School", category: "developing", pit: null, created_at: "2026-10-20T08:00:00Z",
});
const teams = [team("2011A", "Gear Gremlins"), team("9882K", "Torque Titans"), team("6036D", "Nuts & Bolts")];

let n = 0;
const entry = (kind: ActivityRow["kind"], time: string, over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: `a${++n}`, request_id: null, team_id: null, kind, actor: "Alex Morgan", actor_role: "Judge Advisor", action: "did something", detail: null, created_at: time, team_number: null, ...over,
});
const forTeam = (number: string) => ({ team_id: `t-${number}`, team_number: number });

/** Newest first. 11:00 holds five, 10:00 two, 09:00 one. */
const log: ActivityRow[] = [
  entry("request", at(11, 42), { actor: "Priya Nair", actor_role: "Panel 2", action: "→ Interview in progress", detail: "Gear Gremlins", ...forTeam("2011A") }),
  entry("request", at(11, 40), { actor: "Front desk", actor_role: "Front desk", action: "joined queue", detail: "Torque Titans · EN", ...forTeam("9882K") }),
  entry("referee", at(11, 38), { actor: "Jordan Lee", actor_role: "Referee", action: "flagged minor", detail: "Q19 · GG17", ...forTeam("9882K") }),
  entry("referee", at(11, 12), { action: "corrected a flag: warning → major", detail: "Q22", ...forTeam("6036D") }),
  entry("request", at(11, 5), { actor: "team", actor_role: "Team", action: "booked slot", detail: "11:00", team_id: "t-gone", team_number: "4410C" }),
  entry("conflict", at(10, 42), { action: "declared conflicts of interest", detail: "Priya Nair: 9882K, 7700B" }),
  entry("setup", at(10, 15), { action: "Referee setup: V5RC", detail: "3 fields" }),
  entry("setup", at(9, 55), { action: "imported teams", detail: "46 teams · 12 new" }),
];
const loaded: Poll = { rows: log, updatedAt: at(11, 43), error: null };

function board(over: { poll?: Partial<Poll>; filters?: Partial<ActivityFilters>; whoOpen?: boolean; teams?: Team[] } = {}) {
  return renderToStaticMarkup(
    <ActivityBoard
      poll={{ ...loaded, ...over.poll }}
      state={{ teams: over.teams ?? teams, flagKinds }}
      filters={{ ...NO_FILTERS, ...over.filters }}
      onFilters={noop}
      whoOpen={over.whoOpen}
      onWhoOpen={noop}
      onOpenSheet={noop}
    />,
  );
}

const events = (markup: string) => [...markup.matchAll(/<li class="ja-ac-ev">[\s\S]*?<\/li>/g)].map((m) => m[0]);
const times = (markup: string) => events(markup).map((e) => e.match(/<b class="ja-ac-tm">(.*?)<\/b>/)![1]);
const ev = (markup: string, time: string) => events(markup).find((e) => e.includes(`<b class="ja-ac-tm">${time}</b>`)) ?? "";
const headers = (markup: string) => [...markup.matchAll(/<h3 [^>]*class="ja-ac-hh"><b>(.*?)<\/b><span>· (.*?)<\/span><\/h3>/g)].map((m) => `${m[1]} · ${m[2]}`);
const dot = (event: string) => event.match(/<i class="ja-ac-dd ([^"]*)"/)![1];

/* ---- the title and the toolbar ---------------------------------------------------- */

test("the title row says when the log was last read and how often it refreshes", () => {
  const m = board();
  assert.match(m, /<h2 class="ja-ac-h">Activity<\/h2>/);
  assert.match(m, /<p class="ja-ac-upd">Updated 11:43 · refreshes every 10 s<\/p>/);
});

test("the kind chips count the loaded entries and show which is pressed", () => {
  const m = board();
  const chip = (label: string) => m.match(new RegExp(`<button type="button" class="ja-ac-chip" aria-pressed="(true|false)">${label}<span class="ja-ac-n">(\\d+)</span>`))?.slice(1);
  assert.deepEqual(chip("All"), ["true", "8"]);
  assert.deepEqual(chip("Requests"), ["false", "3"]);
  assert.deepEqual(chip("Referee"), ["false", "2"]);
  assert.deepEqual(chip("Conflicts"), ["false", "1"]);
  assert.deepEqual(chip("Setup"), ["false", "2"]);
  const referee = board({ filters: { kind: "referee" } });
  assert.deepEqual(referee.match(/class="ja-ac-chip" aria-pressed="(true|false)">Referee/)?.slice(1), ["true"]);
  assert.match(referee, /class="ja-ac-chip" aria-pressed="false">All/);
  // The counts are over what was loaded, not over what is shown.
  assert.match(referee, />Requests<span class="ja-ac-n">3</);
});

test("the toolbar is a team-number search and a Who select of the actors present, Everyone first", () => {
  const m = board();
  assert.match(m, /<label class="sr-only" for="[^"]+-q">Team number<\/label>/);
  assert.match(m, /<input id="[^"]+-q" class="ja-in" type="text" autoComplete="off" placeholder="Team number" value=""\/>/);
  assert.match(m, /<label class="ja-ac-wlab" for="[^"]+-w">Who<\/label>/);
  const select = m.match(/<select[\s\S]*?<\/select>/)![0];
  assert.deepEqual(
    [...select.matchAll(/<option value="(.*?)"/g)].map((x) => x[1]),
    ["", "Alex Morgan · Judge Advisor", "Front desk", "Jordan Lee · Referee", "Priya Nair · Panel 2", "Team"],
  );
  assert.match(select, /<option value="" selected="">Everyone<\/option>/);
  assert.match(board({ filters: { who: "Front desk" } }), /<option value="Front desk" selected="">Front desk<\/option>/);
  assert.match(board({ filters: { team: "98" } }), /value="98"/);
});

/* ---- the hours --------------------------------------------------------------------- */

test("entries are grouped by hour, newest first, under headers that say how many", () => {
  const m = board();
  assert.deepEqual(headers(m), ["11:00–11:59 · 5 events", "10:00–10:59 · 2 events", "09:00–09:59 · 1 event"]);
  assert.deepEqual(times(m), ["11:42", "11:40", "11:38", "11:12", "11:05", "10:42", "10:15", "09:55"]);
  // Each hour is a section named by its header, and holds its own entries.
  const sections = [...m.matchAll(/<section aria-labelledby="([^"]+)">([\s\S]*?)<\/section>/g)];
  assert.equal(sections.length, 3);
  assert.deepEqual(sections.map((s) => events(s[2]).length), [5, 2, 1]);
  for (const [, id, body] of sections) assert.match(m, new RegExp(`<h3 id="${id}" class="ja-ac-hh">`), body.slice(0, 10));
});

test("each hour's header is the timeline's sticky heading", () => {
  const block = css.slice(css.indexOf("/* @ja-block activity */"));
  const wide = block.slice(block.indexOf("@media (min-width: 1024px)"));
  assert.match(wide, /\.ja-ac-hh \{[^}]*position: sticky; top: 0;/);
  assert.doesNotMatch(block.slice(0, block.indexOf("@media (min-width: 1024px)")), /position: sticky/, "on a phone the headers stay in the flow");
  assert.match(wide, /\.ja-ac-tl \{[^}]*overflow-y: auto;/, "the timeline scrolls under the toolbar");
});

test("the footer says how much is shown, and the key explains the dots", () => {
  const m = board();
  assert.match(m, /<div class="ja-ac-lf"><p>Showing all 8 events<\/p>/);
  const key = m.match(/<div class="ja-ac-key"[\s\S]*?<\/div><\/div>/)![0];
  assert.match(key, /role="group" aria-label="Dot key"/);
  for (const word of ["Request", "Referee flag, by severity", "Conflict", "Setup"]) assert.ok(key.includes(word), word);
  // The referee entry in the key is one dot per severity the config has, in its own colours.
  assert.deepEqual([...key.matchAll(/ja-ac-d-referee (bg-[\w-]+)/g)].map((x) => x[1]), ["bg-done", "bg-caution", "bg-waiting", "bg-danger", "bg-ink"]);

  const long = Array.from({ length: 150 }, (_, i) => entry("setup", at(9, 0), { id: `x${i}` }));
  assert.match(board({ poll: { rows: long } }), /<p>Showing the latest 150 events<\/p>/);
});

/* ---- an entry --------------------------------------------------------------------------- */

test("a row: time, the actor in bold with the role beside it, what was done, the detail", () => {
  const e = ev(board(), "11:42");
  assert.match(e, /<b class="ja-ac-tm">11:42<\/b>/);
  assert.match(e, /<span class="ja-ac-wh"><b>Priya Nair<\/b><span> · Panel 2<\/span><\/span>/);
  assert.match(e, /<span class="ja-ac-ac">→ Interview in progress<\/span>/);
  assert.match(e, /<span class="ja-ac-dt">Gear Gremlins<\/span>/);
  assert.match(e, /<span class="sr-only">Requests<\/span>/, "the dot's kind, for a screen reader");
  // No detail: no detail cell.
  assert.doesNotMatch(ev(board({ poll: { rows: [entry("setup", at(9, 0), { action: "reset day" })] } }), "09:00"), /ja-ac-dt/);
});

test("the role is not repeated when it is the name: the front desk, and the anonymous team", () => {
  const m = board();
  assert.match(ev(m, "11:40"), /<span class="ja-ac-wh"><b>Front desk<\/b><\/span>/);
  assert.match(ev(m, "11:05"), /<span class="ja-ac-wh"><b>Team<\/b><\/span>/);
  assert.doesNotMatch(ev(m, "11:40"), /Front desk<\/b><span>/);
});

test("severity words are severity pills: flagged, corrected from and to, removed", () => {
  const m = board();
  const pills = (e: string) => [...e.matchAll(/<span class="ja-sp ([^"]*)" title="([^"]*)">(.*?)<\/span>/g)].map((x) => [x[3], x[1].includes("bg-") ? x[1].match(/bg-[\w-]+/)![0] : "", x[2]]);
  assert.deepEqual(pills(ev(m, "11:38")), [["Minor", "bg-waiting", "Minor violation"]]);
  assert.match(ev(m, "11:38"), /<span class="ja-ac-ac">flagged <span class="ja-sp /);
  assert.deepEqual(pills(ev(m, "11:12")), [["Warning", "bg-caution", "Warning"], ["Major", "bg-danger", "Major violation"]]);
  assert.match(ev(m, "11:12"), /corrected a flag: <span class="ja-sp [^"]*" title="Warning">Warning<\/span> → <span class="ja-sp [^"]*" title="Major violation">Major<\/span>/);
  const removed = board({ poll: { rows: [entry("referee", at(9, 0), { action: "removed a flag: dq", ...forTeam("2011A") })] } });
  assert.deepEqual(pills(ev(removed, "09:00")).map((p) => p[0]), ["DQ"]);
  // Other entries are plain words: no pill.
  assert.doesNotMatch(ev(m, "11:42"), /ja-sp/);
  // A kind the config no longer has is shown by its id, not dropped.
  const gone = board({ poll: { rows: [entry("referee", at(9, 0), { action: "flagged vanished" })] } });
  assert.match(ev(gone, "09:00"), /flagged <span class="ja-sp [^"]*">vanished<\/span>/);
});

test("the dot: request neutral, conflict caution, setup an outline, referee the colour of the severity named", () => {
  const m = board();
  assert.equal(dot(ev(m, "11:42")), "ja-ac-d-request");
  assert.equal(dot(ev(m, "11:38")), "ja-ac-d-referee bg-waiting", "flagged Minor");
  assert.equal(dot(ev(m, "11:12")), "ja-ac-d-referee bg-danger", "corrected to Major: the new severity");
  assert.equal(dot(ev(m, "10:42")), "ja-ac-d-conflict");
  assert.equal(dot(ev(m, "10:15")), "ja-ac-d-setup");
  const block = css.slice(css.indexOf("/* @ja-block activity */"));
  assert.match(block, /\.ja-ac-d-request \{ background: var\(--ink-muted\)/);
  assert.match(block, /\.ja-ac-d-conflict \{ background: var\(--caution\)/);
  assert.match(block, /\.ja-ac-d-setup \{ background: var\(--canvas\); border: 2px solid var\(--accent\)/);
});

/* ---- the filters, on the markup ------------------------------------------------------------ */

test("the kind filter narrows the rows and drops the hours with nothing left", () => {
  const referee = board({ filters: { kind: "referee" } });
  assert.deepEqual(times(referee), ["11:38", "11:12"]);
  assert.deepEqual(headers(referee), ["11:00–11:59 · 2 events"]);
  const setup = board({ filters: { kind: "setup" } });
  assert.deepEqual(times(setup), ["10:15", "09:55"]);
  assert.deepEqual(headers(setup), ["10:00–10:59 · 1 event", "09:00–09:59 · 1 event"]);
});

test("the team search and the Who select narrow the rows, and together with the kind they all have to pass", () => {
  assert.deepEqual(times(board({ filters: { team: "9882K" } })), ["11:40", "11:38"]);
  assert.deepEqual(times(board({ filters: { team: "9882k" } })), ["11:40", "11:38"], "any case");
  assert.deepEqual(times(board({ filters: { who: "Alex Morgan · Judge Advisor" } })), ["11:12", "10:42", "10:15", "09:55"]);
  assert.deepEqual(times(board({ filters: { kind: "referee", team: "9882K" } })), ["11:38"]);
  assert.deepEqual(times(board({ filters: { kind: "referee", who: "Alex Morgan · Judge Advisor" } })), ["11:12"]);
  assert.deepEqual(times(board({ filters: { kind: "request", team: "9882K", who: "Front desk" } })), ["11:40"]);
  assert.deepEqual(times(board({ filters: { kind: "referee", team: "9882K", who: "Front desk" } })), []);
});

/* ---- the team chip ----------------------------------------------------------------------------- */

test("a team's chip is on its entries while the team is on the roster, and only then", () => {
  const m = board();
  assert.match(ev(m, "11:42"), /<button type="button" class="ja-ac-tc" aria-label="Open team sheet for 2011A Gear Gremlins"><span class="ja-ac-tcv">2011A<\/span><\/button>/);
  assert.match(ev(m, "11:12"), /aria-label="Open team sheet for 6036D Nuts &amp; Bolts"/);
  // An entry that names no team, or several (no team_id), has no chip ...
  assert.doesNotMatch(ev(m, "10:42"), /ja-ac-tc/);
  assert.doesNotMatch(ev(m, "09:55"), /ja-ac-tc/);
  // ... and nor does one whose team has since been removed.
  assert.doesNotMatch(ev(m, "11:05"), /ja-ac-tc/);
  // The roster not having loaded yet leaves no chips, rather than dead ones.
  assert.equal(board({ teams: [] }).includes("ja-ac-tc"), false);
  assert.equal([...m.matchAll(/class="ja-ac-tc"/g)].length, 4);
});

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

test("clicking the chip opens that team's sheet", () => {
  const row = log[0];
  const opened: string[] = [];
  const tree = walk(EventRow({ row, team: teams[0], kinds: flagKinds, onOpenSheet: (id) => opened.push(id) }));
  const chip = tree.find((e) => e.type === "button" && String(e.props.className).includes("ja-ac-tc"))!;
  (chip.props.onClick as () => void)();
  assert.deepEqual(opened, ["t-2011A"]);
  // No team, no button at all.
  assert.ok(!walk(EventRow({ row: log[5], team: null, kinds: flagKinds, onOpenSheet: noop })).some((e) => e.type === "button"));
});

/* ---- states ------------------------------------------------------------------------------------ */

test("a failed poll puts a caution banner above the last good log and leaves every row", () => {
  const ok = board();
  assert.doesNotMatch(ok, /Couldn&#x27;t refresh/);
  const down = board({ poll: { error: "Request failed (500)" } });
  assert.match(down, /<div class="jg-caution" role="status">[\s\S]*<p>Couldn&#x27;t refresh — showing what we had at 11:43<\/p><\/div>/);
  // The banner is above the log, and the log is whole: the same rows, the same hours, still filterable.
  assert.ok(down.indexOf("jg-caution") < down.indexOf("ja-ac-tl"), "the banner comes first");
  assert.deepEqual(times(down), times(ok));
  assert.deepEqual(headers(down), headers(ok));
  assert.match(down, /Updated 11:43/, "the time on the title is still the last good one");
  assert.deepEqual(times(board({ poll: { error: "x" }, filters: { kind: "setup" } })), ["10:15", "09:55"]);
  // The error text itself is not the banner: the log is not replaced by a red box.
  assert.doesNotMatch(down, /Request failed/);
  // The next success clears it (polled(), checked in the logic test): no error, no banner.
  assert.doesNotMatch(board({ poll: { error: null } }), /jg-caution/);
});

test("before any log has arrived: Loading…, or the reason it did not, never an empty log", () => {
  const loading = board({ poll: NO_POLL });
  assert.match(loading, /<p class="ja-empty">Loading…<\/p>/);
  assert.doesNotMatch(loading, /Nothing logged|ja-ac-tl|ja-ac-tb/);
  const failed = board({ poll: { ...NO_POLL, error: "Failed to fetch" } });
  assert.match(failed, /Couldn&#x27;t load the log — Failed to fetch/);
  assert.doesNotMatch(failed, /Loading…|Nothing logged/);
  // The tab around the board starts there.
  const tab = renderToStaticMarkup(<ActivityTab state={{ teams, flagKinds }} onOpenSheet={noop} />);
  assert.match(tab, /Loading…/);
});

test("an empty log says so, and has no filters to offer", () => {
  const m = board({ poll: { rows: [] } });
  assert.match(m, /<p class="ja-empty">Nothing logged yet\.<\/p>/);
  assert.doesNotMatch(m, /ja-ac-tb|ja-ac-tl|No events match/);
});

test("filters with no match say so, with a Clear filters link; the log is not empty", () => {
  const m = board({ filters: { kind: "conflict", team: "2011A" } });
  assert.match(m, /<p class="ja-empty">No events match these filters\.\s*<button type="button" class="ja-ac-lnk">Clear filters<\/button><\/p>/);
  assert.equal(events(m).length, 0);
  assert.doesNotMatch(m, /Nothing logged yet/);
  assert.match(m, /ja-ac-tb/, "the toolbar stays, so the filters can be changed");
  assert.doesNotMatch(board(), /No events match/);
  // The link puts every filter back.
  assert.ok(read("src/components/admin/ActivityTab.tsx").includes("onClick={() => onFilters(NO_FILTERS)}"));
});

/* ---- the phone's Who ------------------------------------------------------------------------------ */

test("a phone: a Who button, lit only while someone is chosen, and a sheet shut until it is opened", () => {
  const none = board();
  assert.match(none, /<button type="button" class="ja-ac-wb" aria-haspopup="dialog" aria-label="Who, everyone">/);
  assert.doesNotMatch(none, /data-on/);
  assert.match(none, /<dialog class="ja-sheet ja-ac-wsheet" aria-modal="true" aria-labelledby="[^"]+"><\/dialog>/, "shut: nothing in it");
  const chosen = board({ filters: { who: "Front desk" } });
  assert.match(chosen, /aria-label="Who, Front desk" data-on="true"/);

  const open = board({ whoOpen: true, filters: { who: "Front desk" } });
  const sheet = open.match(/<dialog[\s\S]*<\/dialog>/)![0];
  assert.match(sheet, /<h2 id="[^"]+">Who<\/h2>/);
  assert.match(sheet, /<button type="button" class="ja-x" aria-label="Close">/);
  assert.deepEqual(
    [...sheet.matchAll(/class="ja-ac-wopt" aria-pressed="(true|false)">(.*?)(?:<svg|<\/button>)/g)].map((x) => `${x[2]}:${x[1]}`),
    ["Everyone:false", "Alex Morgan · Judge Advisor:false", "Front desk:true", "Jordan Lee · Referee:false", "Priya Nair · Panel 2:false", "Team:false"],
  );
});

/* ---- the page ------------------------------------------------------------------------------------- */

test("the page renders the Activity tab from its own file, hands it the roster and opens the one team sheet from its chip", () => {
  assert.ok(page.includes('import { ActivityTab } from "@/components/admin/ActivityTab"'));
  assert.ok(!page.includes("function ActivityTab"), "the old tab is out of the page");
  assert.ok(!page.includes("/api/admin/activity"), "and so is its fetch");
  assert.match(page, /tab === "log" \? <ActivityTab state=\{state\} onOpenSheet=\{setSheetId\} \/> : null/);
  assert.match(page, /tab === "scores" \|\| tab === "log" \? "ja-pad"/, "Activity fills the width the rail leaves");
  const tab = read("src/components/admin/ActivityTab.tsx");
  assert.ok(tab.includes("onClick={() => onOpenSheet(team.id)}"));
  assert.ok(tab.includes("teamOf(r, state.teams)"), "the team comes from the live roster");
});

test("the tab polls the log every 10 s, keeps the last good log on a failure and stops with the tab", () => {
  const tab = read("src/components/admin/ActivityTab.tsx");
  assert.ok(tab.includes('call<{ activity: ActivityRow[] }>("/api/admin/activity", { method: "GET" })'));
  assert.ok(tab.includes("setInterval(load, 10_000)") && tab.includes("clearInterval(t)"));
  assert.match(tab, /\.then\(\(\{ activity \}\) => live && setPoll\(\(p\) => polled\(p, \{ rows: activity \}, new Date\(\)\)\)\)/);
  assert.match(tab, /\.catch\(\(e\) => live && setPoll\(\(p\) => polled\(p, \{ error: \(e as Error\)\.message \}, new Date\(\)\)\)\)/);
  assert.ok(!tab.includes("window.confirm") && !/\bconfirm\(/.test(tab));
});

/* ---- Scores re-reads after the team sheet closes -------------------------------------------------- */

test("useScores can reload, and the page does so when the team sheet closes on Scores", () => {
  const hook = read("src/components/useAppState.ts");
  const scores = hook.slice(hook.indexOf("export function useScores"));
  assert.match(scores, /const \[again, setAgain\] = useState\(0\);/);
  assert.match(scores, /\}, \[enabled, again\]\);/, "bumping the counter re-runs the load");
  assert.match(scores, /const reload = useCallback\(\(\) => setAgain\(\(n\) => n \+ 1\), \[\]\);/);
  assert.match(scores, /return \{ scores, rubrics, error, loaded, reload \};/);
  // Only on Scores: nothing else on the console reads rubric totals.
  assert.match(page, /onClose=\{\(\) => \{\s*setSheetId\(null\);\s*\/\/[^\n]*\n\s*if \(tab === "scores"\) scoreData\.reload\(\);\s*\}\}/);
  assert.equal(page.match(/scoreData\.reload\(\)/g)?.length, 1);
});

/* ---- styles ------------------------------------------------------------------------------------------- */

test("the Activity block: the last in the file, its own prefix, tokens only, no motion, 44px taps on a phone and 32px on a desktop", () => {
  const start = css.indexOf("/* @ja-block activity */");
  assert.ok(start > css.indexOf("/* @ja-block scores */"), "appended after the existing blocks");
  const block = css.slice(start);
  assert.ok(!/@ja-block (?!activity)/.test(block), "the last block of the file");
  assert.ok(css.slice(0, css.indexOf("/* @ja-block shell */")).includes(".ja-ac-"), "the shell comment lists the prefix");
  assert.doesNotMatch(block, /transition|animation|@keyframes/, "no motion");
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|oklch\(|rgb\(|hsl\(/i, "tokens only, so the light theme follows");
  const phone = block.slice(0, block.indexOf("@media (min-width: 1024px)"));
  const wide = block.slice(block.indexOf("@media (min-width: 1024px)"));
  assert.match(phone, /\.ja-ac-chip \{[^}]*height: 44px/);
  assert.match(phone, /\.ja-ac \.ja-in \{ height: 44px/);
  assert.match(phone, /\.ja-ac-wb \{[^}]*height: 44px/);
  assert.match(phone, /\.ja-ac-tc \{[^}]*height: 44px/, "the team chip is a 44px target");
  assert.match(phone, /\.ja-ac-wopt \{[^}]*min-height: 52px/);
  assert.match(phone, /\.ja-ac-lnk \{[^}]*min-height: 44px/);
  assert.match(wide, /\.ja-ac-chip \{ height: 36px/);
  assert.match(wide, /\.ja-ac \.ja-in \{ height: 36px/);
  assert.match(wide, /\.ja-ac-tc \{[^}]*height: 32px/);
  assert.match(wide, /\.ja-ac-tcv \{[^}]*height: 32px/);
  assert.match(wide, /\.ja-ac-lnk \{ min-height: 32px/);
  // The chosen chip wears the accent, as the Scores and Teams chips do.
  assert.match(phone, /\.ja-ac-chip\[aria-pressed="true"\] \{[^}]*background: var\(--accent\)/);
  // The kind chips scroll sideways on a phone and wrap on a desktop, with no scrollbar either way.
  assert.match(phone, /\.ja-ac-kc \{[^}]*overflow-x: auto; scrollbar-width: none;/);
  assert.match(phone, /\.ja-ac-kc::-webkit-scrollbar \{ display: none; \}/);
  assert.match(wide, /\.ja-ac-kc \{ flex-wrap: wrap;[^}]*overflow: visible;/);
  // The Who select is for a desktop and the Who button for a phone.
  assert.match(phone, /\.ja-ac-who \{ display: none; \}/);
  assert.match(wide, /\.ja-ac-who \{[^}]*display: block;/);
  assert.match(wide, /\.ja-ac-wb \{ display: none; \}/);
  // Caution, accent and ink are the only colours the dots and the banner use: no new hues.
  assert.match(css, /\.jg-caution \{[^}]*var\(--caution\)/, "the banner is the console's caution box");
});
