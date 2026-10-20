import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { AdminFrame, OTHER_CONSOLES, SECTION_GROUPS, railCounts } from "../src/components/admin/AdminFrame";
import { FloorBoard, FloorTab, type FloorActions, type FloorMenu } from "../src/components/admin/FloorTab";
import { buildColumns, defaultColumnKey } from "../src/components/admin/floorLogic";
import { cancelAfterAsking } from "../src/components/judge/logic";
import { createConfirmer, type Pending } from "../src/components/ConfirmDialog";
import type { AppState, ConflictRow, FlagRow, JudgeRow, PublicPanel, RequestRow, Team } from "../src/lib/types";

/* The Judge Advisor console's shell and Floor, rendered to markup. Behaviour
   that needs a browser (the <dialog> opening, taps, the popover's Escape) has
   no DOM harness here; the decisions behind it run as plain functions
   (adminFloor.logic.test.mjs and the cancel test below) and the wiring is read
   from source at the foot. */

const NOW = new Date(2026, 9, 17, 12, 36).getTime();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const inMin = (min: number) => new Date(NOW + min * 60_000).toISOString();
const noop = () => {};

const languages = [
  { id: "en", label: "English", short: "EN" },
  { id: "th", label: "ไทย (Thai)", short: "TH" },
];
const flagKinds = [
  { id: "good", label: "Good conduct", short: "Good", color: "emerald", severity: 0, requiresRule: false },
  { id: "warning", label: "Warning", short: "Warning", color: "amber", severity: 1, requiresRule: false },
];

const panel = (n: number, division: string, langs: string[], judges: string[]): PublicPanel => ({
  id: `p${n}`,
  name: `Panel ${n}`,
  division,
  judges,
  languages: langs,
  sort_order: n,
  slot_start_at: null,
  slot_minutes: 20,
  slot_count: 0,
});
const panels = [
  panel(1, "High School", ["en"], ["Dana Ruiz", "Sam Okafor"]),
  panel(2, "Middle School", ["en", "th"], ["Priya Nair", "Lee Chen"]),
  panel(3, "Middle School", ["en"], ["Tom Baker", "Ana Silva"]),
  panel(4, "Elementary School", ["en", "th"], ["Mei Tan", "Raj Patel"]),
];

function team(number: string, name: string, panel_id: string | null, division = "Middle School"): Team {
  return { id: `t-${number}`, number, name, panel_id, division, category: "developing", pit: null, created_at: "2026-10-17T08:00:00Z" };
}
function request(t: Team, status: RequestRow["status"], over: Partial<RequestRow> = {}): RequestRow {
  return {
    id: `r-${t.number}`,
    team_id: t.id,
    panel_id: t.panel_id,
    status,
    kind: "queue",
    language: "en",
    slot_start: null,
    slot_end: null,
    message: null,
    created_by: null,
    acknowledged_by: null,
    interviewer: null,
    outcome: null,
    requested_at: ago(5),
    acknowledged_at: null,
    started_at: null,
    finished_at: null,
    cancelled_at: null,
    updated_at: ago(1),
    ...over,
  };
}

// The Floor mock, as data: Panel 1 has a team on the way, Panel 2 an interview and three waiting/booked, Panel 3 a Thai request it cannot cover.
const pi = team("3141P", "Pi Squad", "p1", "High School");
const gremlins = team("2011A", "Gear Gremlins", "p2");
const titans = team("9882K", "Torque Titans", "p2");
const byteMe = team("7700B", "Byte Me", "p2");
const rangers = team("4410C", "Robo Rangers", "p2");
const sparky = team("5150Z", "Sparky", "p3");
const breakers = team("1234X", "Circuit Breakers", "p3");
const nuts = team("6036D", "Nuts & Bolts", "p4", "Elementary School");
const teams = [pi, gremlins, titans, byteMe, rangers, sparky, breakers, nuts];
const requests: RequestRow[] = [
  request(pi, "acknowledged", { acknowledged_at: ago(3) }),
  request(gremlins, "interviewing", { started_at: ago(7) }),
  request(titans, "requested", { requested_at: ago(8) }),
  request(byteMe, "requested", { requested_at: ago(4), language: "th" }),
  request(rangers, "scheduled", { kind: "slot", slot_start: inMin(24) }),
  request(sparky, "requested", { requested_at: ago(2), language: "th" }),
  request(breakers, "scheduled", { kind: "slot", slot_start: inMin(44) }),
  request(nuts, "interviewing", { started_at: ago(12), language: "th" }),
];
const warning: FlagRow = {
  id: "f1",
  team_id: titans.id,
  kind: "warning",
  body: "Reset another team's field.",
  author: "Jordan Lee",
  match_type: "Q",
  match_number: "19",
  field: "2",
  rule: "GG17",
  ruleset: "viqrc",
  manual_version: null,
  match_affecting: false,
  created_at: ago(30),
};

const actions: FloorActions = { onSelect: noop, onMenu: noop, onAdvance: noop, onMove: noop, onNotes: noop, onCancel: noop };

function board(
  over: {
    teams?: Team[];
    requests?: RequestRow[];
    panels?: PublicPanel[];
    conflicts?: ConflictRow[];
    judges?: JudgeRow[];
    flags?: FlagRow[];
    busy?: string | null;
    menu?: FloorMenu | null;
    selected?: string | null;
    counts?: Record<string, number>;
  } = {},
) {
  const columns = buildColumns(over.panels ?? panels, over.teams ?? teams, over.requests ?? requests);
  return renderToStaticMarkup(
    <FloorBoard
      columns={columns}
      counts={over.counts ?? { requested: 3, acknowledged: 1, interviewing: 2, completed: 17 }}
      selected={over.selected === undefined ? defaultColumnKey(columns) : over.selected}
      languages={languages}
      flags={over.flags ?? [warning]}
      flagKinds={flagKinds}
      panels={over.panels ?? panels}
      conflicts={over.conflicts ?? []}
      judges={over.judges ?? []}
      now={NOW}
      busy={over.busy ?? null}
      menu={over.menu ?? null}
      {...actions}
    />,
  );
}

const columnOf = (markup: string, name: string) =>
  [...markup.matchAll(/<section class="ja-col"[\s\S]*?<\/section>/g)].map((m) => m[0]).find((c) => c.includes(`>${name}</h2>`)) ?? "";
const cardOf = (markup: string, number: string) =>
  markup.match(new RegExp(`<article class="ja-card[^"]*" aria-label="${number} [\\s\\S]*?</article>`))?.[0] ?? "";
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");

/* ---- the shell: top bar, rail, phone menu --------------------------------- */

const router = {} as React.ContextType<typeof AppRouterContext>;
const frame = (over: Partial<Parameters<typeof AdminFrame>[0]> = {}) =>
  renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <AdminFrame
        name="Alex Morgan"
        online
        tab="floor"
        onTab={noop}
        counts={{ floor: 3, conflicts: 2, flags: 14, teams: 48, panels: 4 }}
        {...over}
      >
        <p>the tab</p>
      </AdminFrame>
    </AppRouterContext.Provider>,
  );
const rail = (markup: string) => markup.match(/<nav class="ja-rail"[\s\S]*?<\/nav>/)?.[0] ?? "";
const sheet = (markup: string) => markup.match(/<dialog class="ja-sheet"[\s\S]*?<\/dialog>/)?.[0] ?? "";

test("the rail is a labelled nav with LIVE, SETUP and RESULTS in order, and the eight sections under them", () => {
  const r = rail(frame());
  assert.match(r, /^<nav class="ja-rail" aria-label="Judge Advisor sections">/);
  assert.deepEqual([...r.matchAll(/<h2 class="ja-rl">(.*?)<\/h2>/g)].map((m) => m[1]), ["Live", "Setup", "Results", "Other consoles"]);
  const groups = r.split('<h2 class="ja-rl">').slice(1, 4).map((g) => [...g.matchAll(/<span>(\w+)<\/span>/g)].map((m) => m[1]));
  assert.deepEqual(groups, [["Floor", "Conflicts", "Referee"], ["Teams", "Panels", "Import"], ["Scores", "Activity"]]);
  assert.deepEqual(SECTION_GROUPS.flatMap((g) => g.items.map((i) => i.id)), ["floor", "conflicts", "flags", "teams", "panels", "import", "scores", "log"]);
  // Real buttons, not links: the section is page state.
  assert.equal(r.match(/<button type="button" class="ja-ri"/g)?.length, 8);
  // The only links are the other consoles, in a group of their own after the sections.
  const sections = r.split('<h2 class="ja-rl">Other consoles</h2>')[0];
  assert.doesNotMatch(sections, /<a /);
});

test("the current section is marked aria-current in the rail, and only that one", () => {
  const current = (markup: string) => [...rail(markup).matchAll(/<button[^>]*aria-current="page"[^>]*>[\s\S]*?<\/button>/g)].map((m) => text(m[0]).trim());
  assert.deepEqual(current(frame()), ["Floor3 teams requesting"]);
  assert.deepEqual(current(frame({ tab: "teams" })), ["Teams48"]);
  assert.deepEqual(current(frame({ tab: "log" })), ["Activity"]);
});

test("Floor's count is the orange badge; every other count is plain text; nothing shows at zero", () => {
  const r = rail(frame());
  assert.match(r, /<span>Floor<\/span><b class="ja-rb">3<\/b><span class="sr-only"> teams requesting<\/span>/);
  assert.match(r, /<span>Conflicts<\/span><span class="ja-rc">2<\/span>/);
  assert.match(r, /<span>Referee<\/span><span class="ja-rc">14<\/span>/);
  assert.match(r, /<span>Teams<\/span><span class="ja-rc">48<\/span>/);
  assert.match(r, /<span>Panels<\/span><span class="ja-rc">4<\/span>/);
  assert.doesNotMatch(r, /<span>Import<\/span><span class="ja-rc"/);
  assert.equal(r.match(/ja-rb/g)?.length, 1, "the orange badge is Floor's alone");

  const quiet = rail(frame({ counts: { floor: 0, conflicts: 0 } }));
  assert.doesNotMatch(quiet, /ja-rb|ja-rc/);
  assert.match(frame({ counts: { floor: 1 } }), /<b class="ja-rb">1<\/b><span class="sr-only"> team requesting<\/span>/);
});

test("the top bar: Judge Advisor avatar, the admin's name, Live, Sign out, and the Sections button", () => {
  const markup = frame();
  const top = markup.match(/<header class="ja-top">[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.match(top, /<img src="\/avatars\/judge-advisor\.jpg" alt="" width="28" height="28"\/>/);
  assert.match(top, /<b>Judge Advisor<\/b><span>Alex Morgan<\/span>/);
  assert.match(top, /data-online="true"><i aria-hidden="true"><\/i>Live</);
  assert.match(top, />Sign out</);
  assert.match(frame({ online: false }), /data-online="false"><i aria-hidden="true"><\/i>Reconnecting</);
  // The menu button comes before the avatar, labelled for a screen reader.
  assert.match(top, /<button type="button" class="ja-menu" aria-label="Sections" aria-haspopup="dialog" aria-expanded="false">[\s\S]*<span class="jg-av">/);
  assert.match(markup, /<h1 class="sr-only">Floor<\/h1><p>the tab<\/p>/, "the tab sits under an h1 naming the section");
});

test("on a phone a slim bar names the current section with its count, Floor's in the orange badge", () => {
  const bar = (markup: string) => markup.match(/<div class="ja-sbar">[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(bar(frame()), /<b>Floor<\/b><span class="ja-rb">3 requesting<\/span>/);
  assert.match(bar(frame({ tab: "teams" })), /<b>Teams<\/b><span class="ja-rc">48<\/span>/);
  assert.doesNotMatch(bar(frame({ tab: "import" })), /ja-rb|ja-rc/);
  assert.doesNotMatch(bar(frame({ counts: { floor: 0 } })), /ja-rb/);
});

test("the Sections sheet is a native dialog with a grab handle, title, Close, the same groups, and the admin's name above Sign out", () => {
  const s = sheet(frame());
  assert.match(s, /^<dialog class="ja-sheet" aria-modal="true" aria-labelledby="[^"]+">/);
  assert.match(s, /<div class="jg-grab" aria-hidden="true"><\/div>/);
  assert.match(s, /<h2 id="[^"]+">Sections<\/h2><button type="button" class="ja-x" aria-label="Close">/);
  assert.match(s, /<nav class="ja-sh-list" aria-label="Judge Advisor sections">/);
  assert.deepEqual([...s.matchAll(/<h3 class="ja-rl">(.*?)<\/h3>/g)].map((m) => m[1]), ["Live", "Setup", "Results", "Other consoles"]);
  assert.equal(s.match(/<button type="button" class="ja-ri"/g)?.length, 8);
  assert.match(s, /<button type="button" class="ja-ri" aria-current="page">[\s\S]*<span>Floor<\/span><b class="ja-rb">3<\/b>/, "current is marked as in the rail");
  assert.match(s, /<div class="ja-sh-foot"><p>Alex Morgan · Judge Advisor<\/p><button[^>]*>Sign out<\/button><\/div>/);
  // Closed until the menu button opens it: showModal() is what makes it open.
  assert.doesNotMatch(s, /^<dialog[^>]* open/);
});

/* ---- Other consoles ------------------------------------------------------- */

const SECTION_IDS = SECTION_GROUPS.flatMap((g) => g.items.map((i) => i.id));
const otherConsoles = (markup: string) => markup.match(/<div class="ja-oc">[\s\S]*?<\/ul><\/div>/)?.[0] ?? "";

test("Other consoles: four quiet links at the foot of the rail, each opening in a new tab and saying so in its name", () => {
  const group = otherConsoles(rail(frame()));
  assert.match(group, /^<div class="ja-oc"><h2 class="ja-rl">Other consoles<\/h2>/);
  const links = [...group.matchAll(/<a class="ja-ol" href="([^"]+)" target="_blank" rel="noopener">([\s\S]*?)<\/a>/g)];
  assert.deepEqual(
    links.map((m) => [m[1], text(m[2])]),
    [
      ["/queue", "Queue desk↗ (opens in a new tab)"],
      ["/judge", "Judge↗ (opens in a new tab)"],
      ["/referee", "Referee↗ (opens in a new tab)"],
      ["/board", "Big-screen board↗ (opens in a new tab)"],
    ],
  );
  // The arrow is decoration; the words are what a screen reader gets.
  assert.equal(group.match(/<span aria-hidden="true">↗<\/span><span class="sr-only"> \(opens in a new tab\)<\/span>/g)?.length, 4);
  assert.deepEqual(OTHER_CONSOLES.map((c) => c.href), ["/queue", "/judge", "/referee", "/board"]);
  // After the sections, not among them.
  assert.ok(rail(frame()).indexOf("Other consoles") > rail(frame()).indexOf("<span>Activity</span>"));
});

test("Other consoles are not counted and are never current, whichever section is open", () => {
  for (const tab of SECTION_IDS) {
    const markup = frame({ tab, counts: { floor: 3, conflicts: 2, flags: 14, teams: 48, panels: 4 } });
    for (const where of [otherConsoles(rail(markup)), otherConsoles(sheet(markup))]) {
      assert.ok(where, "the group is there");
      assert.doesNotMatch(where, /aria-current|ja-rc|ja-rb/, `${tab}: a quiet link, no count, never current`);
    }
    // The sections' own marks are unchanged: one current, in the rail and in the sheet.
    assert.equal(rail(markup).match(/aria-current="page"/g)?.length, 1);
    assert.equal(sheet(markup).match(/aria-current="page"/g)?.length, 1);
  }
});

test("the phone Sections sheet shows the same group under its list, above the sign-out line", () => {
  const s = sheet(frame());
  const group = otherConsoles(s);
  assert.match(group, /^<div class="ja-oc"><h3 class="ja-rl">Other consoles<\/h3>/);
  assert.equal(group.match(/<a class="ja-ol" href="\/(?:queue|judge|referee|board)" target="_blank" rel="noopener">/g)?.length, 4);
  assert.equal(group.match(/ \(opens in a new tab\)/g)?.length, 4);
  assert.ok(s.indexOf("<span>Activity</span>") < s.indexOf("Other consoles") && s.indexOf("Other consoles") < s.indexOf('class="ja-sh-foot"'));
  assert.ok(s.indexOf('class="ja-sh-foot"') > s.indexOf("</nav>"), "the group sits inside the list's nav, before it closes");
  assert.ok(s.indexOf("Other consoles") < s.indexOf("</nav>"));
});

/* ---- the rail's counts ---------------------------------------------------- */

test("the rail counts: Floor is the teams requesting, Conflicts is the judges' conflicts only", () => {
  const conflict = (id: string, over: Partial<ConflictRow>): ConflictRow => ({
    id, panel_id: null, judge_id: null, team_id: titans.id, judge_name: null, note: null, declared_by: "admin:Alex", created_at: ago(60), ...over,
  });
  const state = {
    requests,
    teams,
    panels,
    flags: [warning],
    conflicts: [conflict("c1", { judge_id: "j1" }), conflict("c2", { judge_id: "j1", team_id: byteMe.id }), conflict("c3", { panel_id: "p4" })],
  };
  assert.deepEqual(railCounts(state), { floor: 3, conflicts: 2, flags: 1, teams: 8, panels: 4 });
  assert.equal(railCounts({ ...state, conflicts: [conflict("c3", { panel_id: "p4" })] }).conflicts, 0, "older whole-panel entries are not counted");
  // Zero draws nothing.
  assert.doesNotMatch(rail(frame({ counts: railCounts({ ...state, conflicts: [conflict("c3", { panel_id: "p4" })] }) })), /<span>Conflicts<\/span><span class="ja-rc"/);
});

test("on a phone the Conflicts bar reads '5 conflicts', and '1 conflict'", () => {
  const bar = (n: number) => frame({ tab: "conflicts", counts: { conflicts: n } }).match(/<div class="ja-sbar">[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(bar(5), /<b>Conflicts<\/b><span class="ja-rc">5 conflicts<\/span>/);
  assert.match(bar(1), /<span class="ja-rc">1 conflict<\/span>/);
  assert.doesNotMatch(bar(0), /ja-rc/);
});

/* ---- the Floor: top strip and columns ------------------------------------ */

test("the top strip shows the four counts with their status dots, and the board link opens in a new tab", () => {
  const markup = board();
  const strip = markup.match(/<section class="ja-cs"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.deepEqual(
    [...strip.matchAll(/<b>(\d+)<\/b><span><i class="jg-dot (jg-s-\w+)" aria-hidden="true"><\/i>([^<]+)<\/span>/g)].map((m) => [m[1], m[2], m[3]]),
    [["3", "jg-s-requested", "Requesting"], ["1", "jg-s-acknowledged", "On the way"], ["2", "jg-s-interviewing", "Interviewing"], ["17", "jg-s-completed", "Complete"]],
  );
  assert.match(strip, /aria-label="Status counts"/);
  assert.match(markup, /<a class="ja-board" href="\/board" target="_blank" rel="noopener">Open big-screen board ↗<\/a>/);
  assert.match(board({ counts: {} }), /<b>0<\/b><span><i class="jg-dot jg-s-requested"/, "a status with no requests reads 0");
});

test("one column per panel, in order, headed by name, division, languages, judges and the load line", () => {
  const markup = board();
  assert.deepEqual([...markup.matchAll(/<section class="ja-col"[^>]*><header class="ja-ch"><h2 id="[^"]+">(.*?)<\/h2>/g)].map((m) => m[1]), ["Panel 1", "Panel 2", "Panel 3", "Panel 4"]);

  const p2 = columnOf(markup, "Panel 2");
  assert.match(p2, /<h2 id="[^"]+">Panel 2<\/h2><span class="jg-ptag">Middle School<\/span>/);
  assert.match(p2, /<span class="ja-tags"><span class="jg-ptag" lang="en">EN<\/span><span class="jg-ptag" lang="th">TH<\/span><\/span>/);
  assert.match(p2, /<p class="ja-jn">Priya Nair, Lee Chen<\/p>/);
  assert.match(p2, /<p class="ja-ld"><span class="ja-wt">2 waiting<\/span> · with 2011A<\/p>/);

  assert.match(columnOf(markup, "Panel 1"), /<p class="ja-ld">none waiting · going to 3141P<\/p>/);
  assert.match(columnOf(markup, "Panel 3"), /<p class="ja-ld"><span class="ja-wt">1 waiting<\/span> · panel free<\/p>/);
  assert.match(columnOf(markup, "Panel 4"), /none waiting · with 6036D/);
  // A panel covering one language says so.
  assert.match(columnOf(markup, "Panel 1"), /<span class="jg-ptag" lang="en">EN only<\/span>/);
});

test("a panel that cannot cover a requested language shows the caution pill; one that can does not", () => {
  const markup = board();
  assert.match(columnOf(markup, "Panel 3"), /<span class="ja-gapp">[\s\S]*<span lang="th">ไทย \(Thai\)<\/span> not covered<\/span>/);
  // Panel 2 covers Thai, so Byte Me's request there is no gap.
  assert.doesNotMatch(columnOf(markup, "Panel 2"), /ja-gapp|not covered/);
  assert.doesNotMatch(columnOf(markup, "Panel 1"), /ja-gapp/);
  // An empty cover is "not stated", not "covers nothing".
  const unstated = panels.map((p) => (p.id === "p3" ? { ...p, languages: [] } : p));
  assert.doesNotMatch(board({ panels: unstated }), /ja-gapp|not covered/);
});

test("cards sit in a column interviewing first, then on the way, requesting longest wait first, then booked", () => {
  const p2 = columnOf(board(), "Panel 2");
  const order = [...p2.matchAll(/<article class="ja-card[^"]*" aria-label="(\w+) /g)].map((m) => m[1]);
  assert.deepEqual(order, ["2011A", "9882K", "7700B", "4410C"]);
});

test("a requesting card has the waiting tint, its wait in orange, and an On our way button in the on-the-way colour", () => {
  const c = cardOf(board(), "9882K");
  assert.match(c, /^<article class="ja-card ja-w" aria-label="9882K Torque Titans">/);
  assert.match(c, /<div class="ja-c1"><b>9882K<\/b><span class="ja-cn">Torque Titans<\/span><\/div>/);
  assert.match(c, /<span class="jg-sc jg-s-requested">Requesting<\/span><span class="ja-tm ja-wt">8 min<\/span>/);
  // The button wears the colour of the status it moves the team to.
  assert.match(c, /<button type="button" class="ja-go jg-s-acknowledged">On our way<\/button>/);
  // The referee flag rides on the card.
  assert.match(c, /Warning/);
  // A card that is not waiting has no tint.
  assert.doesNotMatch(cardOf(board(), "2011A"), /ja-w"/);
});

test("the big button is Start interview on the way, Finish in the room, and On our way for a booking", () => {
  const markup = board();
  const go = (n: string) => cardOf(markup, n).match(/<button type="button" class="ja-go ([^"]+)"[^>]*>(.*?)<\/button>/)?.slice(1);
  assert.deepEqual(go("3141P"), ["jg-s-interviewing", "Start interview"]);
  assert.deepEqual(go("2011A"), ["jg-s-completed", "Finish"]);
  assert.deepEqual(go("6036D"), ["jg-s-completed", "Finish"]);
  assert.deepEqual(go("4410C"), ["jg-s-acknowledged", "On our way"]);
});

test("each status shows its own clock: time on the way, time in the room, the slot for a booking", () => {
  const markup = board();
  assert.match(cardOf(markup, "3141P"), /jg-sc jg-s-acknowledged">On the way<\/span><span class="ja-tm">3 min<\/span>/);
  assert.match(cardOf(markup, "2011A"), /jg-sc jg-s-interviewing">Interviewing<\/span><span class="ja-tm">7 min<\/span>/);
  const booked = cardOf(markup, "4410C");
  assert.match(booked, /jg-sc jg-s-scheduled">Booked<\/span><span class="ja-tm">\d{1,2}:\d{2}/);
  assert.doesNotMatch(booked, /ja-wt|ja-w"/);
  assert.match(cardOf(board({ requests: requests.map((r) => (r.id === "r-9882K" ? { ...r, requested_at: ago(0) } : r)) }), "9882K"), /ja-tm ja-wt">just now/);
});

test("a language the panel does not cover is a caution box on the card and a caution tag; a covered one is plain", () => {
  const markup = board();
  const c = cardOf(markup, "5150Z");
  assert.match(c, /<span class="jg-ptag ja-warn" lang="th" title="ไทย \(Thai\)">TH<\/span>/);
  assert.match(c, /<div class="jg-caution ja-lw" role="note">[\s\S]*<p>Panel 3 interviews in English only — this team asked for ไทย \(Thai\)\.<\/p><\/div>/);
  const covered = cardOf(markup, "7700B");
  assert.match(covered, /<span class="jg-ptag" lang="th"/);
  assert.doesNotMatch(covered, /jg-caution|ja-warn/);
});

test("the advance button reads Saving… and is disabled for the card with a write in the air, and only that card", () => {
  const markup = board({ busy: "r-9882K" });
  assert.match(cardOf(markup, "9882K"), /<button type="button" class="ja-go jg-s-acknowledged" disabled="">Saving…<\/button>/);
  assert.doesNotMatch(cardOf(markup, "7700B"), /Saving…|disabled/);
  assert.doesNotMatch(board(), /Saving…|disabled=""/);
});

test("a panel with nothing in flight says so, and still shows its judges", () => {
  const p1 = columnOf(board({ requests: [], teams: [] }), "Panel 1");
  assert.match(p1, /<p class="ja-jn">Dana Ruiz, Sam Okafor<\/p>/);
  assert.match(p1, /<p class="ja-none">Nothing in flight<\/p>/);
  assert.doesNotMatch(p1, /<ul class="ja-cl">/);
});

test("with nothing in flight anywhere the board says so; with something it does not", () => {
  assert.match(board({ requests: [], teams: [] }), /Nothing in flight\. Teams will appear here as they request judges\./);
  assert.doesNotMatch(board(), /Teams will appear here/);
});

test("a request whose panel was deleted still shows, in a column of its own", () => {
  const lost = team("8800C", "Lost & Found", null);
  const markup = board({ teams: [lost], requests: [request(lost, "requested")], selected: "none" });
  const col = columnOf(markup, "No panel");
  assert.match(col, /<article class="ja-card ja-w" aria-label="8800C /);
  assert.match(col, /Their panel was deleted/);
});

/* ---- the "⋯" popover ------------------------------------------------------ */

test("the ⋯ button is a labelled 44px-target button that says whether its popover is open", () => {
  const closed = cardOf(board(), "5150Z");
  assert.match(closed, /<button type="button" id="ja-more-r-5150Z" class="ja-more" aria-label="More actions for 5150Z: move, notes, cancel" aria-haspopup="dialog" aria-expanded="false">/);
  assert.doesNotMatch(closed, /ja-pop/);
  const open = cardOf(board({ menu: { id: "r-5150Z", view: "root" } }), "5150Z");
  assert.match(open, /aria-expanded="true"/);
  // Only that card's popover opens.
  assert.doesNotMatch(cardOf(board({ menu: { id: "r-5150Z", view: "root" } }), "9882K"), /ja-pop|aria-expanded="true"/);
});

test("the popover offers Move to panel…, Notes and a danger-quiet Cancel request", () => {
  const pop = cardOf(board({ menu: { id: "r-5150Z", view: "root" } }), "5150Z").match(/<div class="ja-pop"[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(pop, /role="dialog" aria-label="Actions for 5150Z"/);
  assert.deepEqual([...pop.matchAll(/<button[^>]*class="(ja-pi[^"]*)"[^>]*>(.*?)<\/button>/g)].map((m) => [m[1], m[2]]), [
    ["ja-pi", "Move to panel…"],
    ["ja-pi", "Notes"],
    ["ja-pi ja-danger", "Cancel request"],
  ]);
  assert.doesNotMatch(pop, /disabled/);
});

test("Move to panel… lists only panels in the team's division without a conflict, never the current one, with the caption", () => {
  const move = (b: Parameters<typeof board>[0]) =>
    cardOf(board({ ...b, menu: { id: "r-5150Z", view: "move" } }), "5150Z").match(/<div class="ja-pop"[\s\S]*?<\/div><\/div>/)?.[0] ?? "";

  // Sparky is a Middle School team on Panel 3: Panel 2 is the one other Middle School panel.
  const pop = move({});
  assert.match(pop, /aria-label="Move 5150Z to another panel"/);
  assert.match(pop, /<p class="ja-pop-h">Move to panel…<\/p>/);
  // The short tag keeps "Panel 2" on one line; the full division is still in the markup for a screen reader.
  assert.deepEqual(
    [...pop.matchAll(/<button type="button" class="ja-opt"[^>]*><b>(.*?)<\/b>(?:<!-- -->)?<span class="jg-ptag"><span aria-hidden="true">(.*?)<\/span><span class="sr-only">(.*?)<\/span><\/span>/g)].map((m) => [m[1], m[2], m[3]]),
    [["Panel 2", "MS", "Middle School"]],
  );
  assert.match(pop, /<span class="ja-tags"><span class="jg-ptag" lang="en">EN<\/span><span class="jg-ptag" lang="th">TH<\/span><\/span>/);
  assert.match(pop, /<p class="ja-pop-c">Only Middle School panels without a conflict<\/p>/);
  assert.doesNotMatch(pop, /Panel 1|Panel 3|Panel 4/, "High School and Elementary panels are out, and so is where it already is");

  // A conflict with Panel 2 takes it out too.
  const conflicted = move({ conflicts: [{ id: "c1", panel_id: "p2", judge_id: null, team_id: sparky.id, judge_name: null, note: null, declared_by: "Alex", created_at: ago(60) }] });
  assert.doesNotMatch(conflicted, /ja-opt/);
});

test("Move to panel… honours a judge's conflict through the panel the judge is on, and lifts it when the judge is off that panel", () => {
  const move = (b: Parameters<typeof board>[0]) =>
    cardOf(board({ ...b, menu: { id: "r-5150Z", view: "move" } }), "5150Z").match(/<div class="ja-pop"[\s\S]*?<\/div><\/div>/)?.[0] ?? "";
  const priya = (panel_id: string | null): JudgeRow => ({ id: "j1", name: "Priya Nair", note: null, panel_id, created_at: ago(90) });
  const conflicts: ConflictRow[] = [{ id: "c1", panel_id: null, judge_id: "j1", team_id: sparky.id, judge_name: null, note: null, declared_by: "Alex", created_at: ago(60) }];

  assert.doesNotMatch(move({ conflicts, judges: [priya("p2")] }), /ja-opt/, "Priya is on Panel 2, so Panel 2 is blocked");
  assert.match(move({ conflicts, judges: [priya("p4")] }), /<b>Panel 2<\/b>/, "moved to another panel, the block went with her");
  assert.match(move({ conflicts, judges: [priya(null)] }), /<b>Panel 2<\/b>/, "with no panel she blocks nobody yet");
});

test("with nowhere else to go the Move row is disabled and says why", () => {
  const conflicts: ConflictRow[] = [{ id: "c1", panel_id: "p2", judge_id: null, team_id: sparky.id, judge_name: null, note: null, declared_by: "Alex", created_at: ago(60) }];
  const pop = cardOf(board({ conflicts, menu: { id: "r-5150Z", view: "root" } }), "5150Z").match(/<div class="ja-pop"[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(pop, /<button type="button" class="ja-pi" disabled="" aria-describedby="([^"]+)">Move to panel…<\/button>/);
  const id = /aria-describedby="([^"]+)"/.exec(pop)![1];
  assert.ok(pop.includes(`<p id="${id}" class="ja-pop-c">No other Middle School panel without a conflict</p>`));
  // Notes and Cancel are still there.
  assert.match(pop, />Notes</);
  assert.match(pop, />Cancel request</);
});

/* ---- the phone's panel switcher ------------------------------------------ */

test("the panel switcher has a chip per panel, the selected one pressed, an orange pip for waiting and a caution dot for a gap", () => {
  const seg = board().match(/<div class="ja-seg" role="group" aria-label="Panel">[\s\S]*?<\/div>/)?.[0] ?? "";
  const chips = [...seg.matchAll(/<button type="button" aria-pressed="(\w+)">([\s\S]*?)<\/button>/g)];
  assert.deepEqual(
    chips.map((m) => [
      m[1],
      m[2].match(/<span aria-hidden="true">(P\d)<\/span>/)?.[1],
      m[2].match(/<small aria-hidden="true">(.*?)<\/small>/)?.[1],
      m[2].includes('<i class="ja-pip" aria-hidden="true">'),
      m[2].includes('<i class="ja-pip ja-gap"'),
    ]),
    [
      ["false", "P1", "1 team", false, false],
      ["true", "P2", "4 teams", true, false],
      ["false", "P3", "2 teams", true, true],
      ["false", "P4", "1 team", false, false],
    ],
  );
});

test("the switcher opens on the longest-waiting panel, and a pick overrides it", () => {
  const columns = buildColumns(panels, teams, requests);
  assert.equal(defaultColumnKey(columns), "p2", "Titans has waited 8 minutes, longest");
  const pressed = (markup: string) => [...markup.matchAll(/<button type="button" aria-pressed="true"><span aria-hidden="true">(P\d)</g)].map((m) => m[1]);
  assert.deepEqual(pressed(board()), ["P2"]);
  assert.deepEqual(pressed(board({ selected: "p4" })), ["P4"]);
  // Only the shown column is flagged for the phone; wide shows them all.
  assert.deepEqual([...board().matchAll(/data-selected="(\w+)"/g)].map((m) => m[1]), ["false", "true", "false", "false"]);
});

test("each chip is spoken as the panel, its teams, who waits and any language not covered", () => {
  const seg = board().match(/<div class="ja-seg"[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(seg, /<i class="ja-pip" aria-hidden="true"><\/i><span class="sr-only">Panel 2, 4 teams, 2 waiting<\/span>/);
  assert.match(seg, /<i class="ja-pip" aria-hidden="true"><\/i><i class="ja-pip ja-gap" aria-hidden="true"><\/i><span class="sr-only">Panel 3, 2 teams, 1 waiting, ไทย \(Thai\) not covered<\/span>/);
  assert.match(seg, /<span class="sr-only">Panel 1, 1 team<\/span>/, "no pip when nobody waits");
  assert.doesNotMatch(seg.split("P2")[0], /ja-pip/);
});

test("a single panel needs no switcher", () => {
  assert.doesNotMatch(board({ panels: [panels[1]], teams: [titans], requests: [request(titans, "requested")] }), /ja-seg/);
});

test("the container renders the board with its confirm dialog and the phone starting on the longest wait", () => {
  const state = { panels, teams, requests, languages, flags: [warning], flagKinds, conflicts: [] } as unknown as AppState;
  const markup = renderToStaticMarkup(<FloorTab state={state} refresh={async () => {}} onError={noop} onNotes={noop} />);
  assert.match(markup, /<div class="ja-floor">/);
  assert.match(markup, /<dialog[^>]*aria-labelledby/, "the shared confirm is rendered once");
  assert.equal(markup.match(/<dialog/g)?.length, 1);
  assert.deepEqual([...markup.matchAll(/data-selected="(\w+)"/g)].map((m) => m[1]), ["false", "true", "false", "false"]);
});

/* ---- Cancel request asks first -------------------------------------------- */

test("Cancel request opens a confirm worded for what is being cancelled, and nothing is sent until it is confirmed", async () => {
  const sent: string[] = [];
  const shown: (Pending | null)[] = [];
  const { ask, settle } = createConfirmer((p) => shown.push(p));

  const booked = request(rangers, "scheduled", { kind: "slot", slot_start: inMin(24) });
  const answered = cancelAfterAsking(ask, rangers, booked, async () => {
    sent.push("cancel");
  });
  assert.equal(shown.length, 1, "a confirm dialog opened");
  assert.match(shown[0]!.question, /4410C/);
  assert.match(shown[0]!.question, /booking/, "a booked slot is worded as a booking");
  assert.equal(shown[0]!.danger, true);
  assert.deepEqual(sent, [], "nothing is sent while the question is open");
  settle(true);
  assert.equal(await answered, true);
  assert.deepEqual(sent, ["cancel"]);

  const declined: string[] = [];
  const second = createConfirmer(noop);
  const no = cancelAfterAsking(second.ask, titans, request(titans, "requested"), async () => {
    declined.push("cancel");
  });
  second.settle(false);
  assert.equal(await no, false);
  assert.deepEqual(declined, [], "declining sends nothing");
});

/* ---- the wiring (source) -------------------------------------------------- */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const floor = read("src/components/admin/FloorTab.tsx");
const frameSrc = read("src/components/admin/AdminFrame.tsx");
const page = read("src/app/admin/page.tsx");

test("the Floor cancels only through the confirm, and every write goes through the guarded act()", () => {
  assert.ok(floor.includes('import { useConfirm } from "@/components/ConfirmDialog"'));
  assert.ok(floor.includes("const { ask, dialog } = useConfirm();"));
  assert.ok(floor.includes('cancelAfterAsking(ask, team, request, () => act(request, "cancel"))'));
  assert.equal(floor.match(/act\(request, "cancel"\)/g)?.length, 1, "no cancel that skips the question");
  assert.ok(floor.includes("{dialog}"), "the confirm is rendered");
  // The cards only call back; the one place that talks to the API is act().
  assert.equal(floor.match(/call\(/g)?.length, 1);
  assert.ok(floor.includes('call(`/api/requests/${request.id}`'));
  assert.ok(!floor.includes("confirm("), "never window.confirm");
});

test("the writes keep their guards: a synchronous writing ref, from: request.status, and Saving…", () => {
  assert.ok(floor.includes("const writing = useRef(new Set<string>());"));
  assert.match(floor, /if \(writing\.current\.has\(request\.id\)\) return;\s*writing\.current\.add\(request\.id\);/);
  assert.match(floor, /body: \{ action, from: request\.status, \.\.\.extra \}/);
  assert.match(floor, /writing\.current\.delete\(request\.id\);\s*setBusy\(null\);/);
  assert.ok(floor.includes('"Saving…"'));
  // Advance, move and cancel are the three writes.
  assert.ok(floor.includes('act(request, "advance")') && floor.includes('act(request, "reassign", { panelId })'));
});

test("the popover closes on Escape and on a press outside it, and the board redraws every 30 s", () => {
  assert.match(floor, /if \(e\.key !== "Escape"\) return;\s*setMenu\(null\);/);
  assert.ok(floor.includes('e.target.closest("[data-ja-menu]")'));
  assert.ok(floor.includes('document.addEventListener("pointerdown", onDown)') && floor.includes('document.removeEventListener("pointerdown", onDown)'));
  assert.ok(floor.includes("setInterval(() => tick((n) => n + 1), 30_000)"));
  // Picking Notes or Move closes it before doing anything else.
  assert.match(floor, /onNotes=\{\(team\) => \{\s*setMenu\(null\);\s*onNotes\(team\);/);
});

test("picking a section closes the phone sheet and switches; the rail switches without a sheet to close", () => {
  assert.match(frameSrc, /const pick = \(id: AdminTab\) => \{\s*setSheet\(false\);\s*onTab\(id\);\s*\};/);
  assert.ok(frameSrc.includes('onPick={pick} Heading="h3"'), "the sheet's list uses pick");
  assert.ok(frameSrc.includes('onPick={onTab} Heading="h2"'), "the rail's list uses the page's switch directly");
  // The sheet is a real dialog opened with showModal, and Escape / the backdrop close it.
  assert.ok(frameSrc.includes("el.showModal()") && frameSrc.includes("el.close()"));
  assert.match(frameSrc, /onClose=\{\(\) => \{\s*if \(sheet\) setSheet\(false\);/);
  assert.match(frameSrc, /if \(e\.target === e\.currentTarget\) setSheet\(false\);/);
  assert.equal(frameSrc.match(/to="\/admin\/login"/g)?.length, 2, "Sign out in the top bar and in the sheet");
});

test("the page wraps every tab in the frame, keeps its session gate, polling, focus trip and score polling, and drops the old Floor", () => {
  assert.ok(page.includes("<AdminFrame") && page.includes("</AdminFrame>"));
  assert.ok(page.includes('router.replace("/admin/login")'));
  assert.ok(page.includes("useAppState(4000)"));
  assert.ok(page.includes('useScores({ enabled: tab === "scores" })'));
  // A marked team belongs to the trip you took to see it.
  assert.match(page, /if \(id !== tab\) setFocusFlagTeam\(null\);\s*setTab\(id\);/);
  assert.match(page, /setFocusFlagTeam\(team\.id\);\s*setTab\("flags"\);/);
  for (const tab of ["Rankings", "TeamsTab", "PanelsTab", "ConflictsTab", "RefereeTab", "ImportTab", "ActivityTab"]) {
    assert.ok(page.includes(`<${tab}`), `${tab} is still rendered inside the frame`);
  }
  assert.ok(page.includes("<FloorTab "), "the new Floor");
  assert.ok(!page.includes("function FloorTab(") && !page.includes("<TabBar") && !page.includes("<TopBar"), "the old Floor, tab bar and top bar are gone from the page");
  assert.ok(!page.includes("StatusLegend"));
  assert.match(page, /<NotesDrawer\s/, "Notes is still the drawer in this step");
  assert.ok(floor.includes("onNotes(team)"));
});

test("the admin styles are page-scoped after the judge block, with light-theme tokens and no animation", () => {
  const css = read("src/app/globals.css");
  const start = css.indexOf(".admin {");
  assert.ok(start > css.indexOf(".jg-sf .jg-quiet"), "the block follows the judge's");
  const block = css.slice(start);
  assert.match(block, /:root\[data-theme="light"\] \.admin/, "light theme tokens");
  assert.match(block, /\.ja-ri\[aria-current\]::before \{[^}]*width: 3px/, "the 3px accent bar on the current item");
  assert.match(block, /\.ja-rb \{[^}]*background: var\(--waiting\)/, "the Floor badge is the waiting orange");
  assert.match(block, /\.ja-w \{[^}]*--waiting\) 45%[^}]*--waiting\) 12%/, "the waiting tint: 12% fill, 45% ring");
  assert.match(block, /\.ja-ri\[aria-current\] \{ background: var\(--ja-accent-t\)/);
  assert.match(block, /--ja-accent-t: color-mix\(in oklch, var\(--accent\) 14%/);
  assert.match(block, /\.ja-rail \{\s*display: none;/);
  assert.match(block, /@media \(min-width: 1024px\) \{[\s\S]*\.ja-rail \{ display: flex; \}/, "the rail appears from 1024px");
  assert.match(block, /\.ja-opt b \{[^}]*white-space: nowrap/, "a panel's name in the Move list stays on one line");
  assert.match(block, /\.ja-rail \.ja-oc \{ margin-top: auto/, "Other consoles sit at the foot of the rail");
  assert.match(block, /\.ja-sheet \.ja-ol \{ height: 48px/, "and are 48px rows in the phone sheet");
  assert.doesNotMatch(block, /@keyframes|animation|transition/, "no playful motion");
});

test("the JA avatar ring is the accent, not the sign-in violet", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /\.jg-av img \{[^}]*box-shadow: 0 0 0 2px var\(--accent\)/);
  assert.ok(frameSrc.includes('className="jg-av"') && frameSrc.includes("/avatars/judge-advisor.jpg"));
});
