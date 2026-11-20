import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { AwardsDesk } from "../src/components/marketing/AwardsDesk";
import { homeFor } from "../src/components/SignInForm";
import type { AwardReleaseRow, ReleasedView, ReleaseTeam } from "../src/lib/types";

/* The Awards Desk, rendered to markup. A tap and the polling have no DOM harness
   here: the decisions run as plain functions in marketingLogic.test.ts and the
   page's wiring is read from source at the foot. */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const noop = () => {};
// Sign out reads the app router, which only exists inside Next; a stub is enough to draw it.
const router = {} as React.ContextType<typeof AppRouterContext>;

const MS = "Middle School";
const T = (number: string, name: string): ReleaseTeam => ({ id: `t-${number}`, number, name });
const LABELS = ["Excellence", "Design", "Innovate", "Think", "Amaze", "Build", "Create", "Judges", "Inspire", "Sportsmanship", "Energy"];
const awards = LABELS.map((label, i) => ({ id: label.toLowerCase(), label, order: i + 1, places: label === "Judges" ? 2 : 1 }));
const release = (award_id: string, over: Partial<AwardReleaseRow> = {}): AwardReleaseRow => ({
  award_id, division: MS, teams: [T("2381C", "Byte Size")], no_winner: false, previous: null, status: "sent",
  sent_at: "2026-11-19T03:31:00.000Z", sent_by: "Pat", changed_at: null, ...over,
});
const releases = [
  release("excellence", { teams: [T("7700B", "Polar Bots")], previous: { teams: [T("1234A", "Gear Grinders")], no_winner: false }, changed_at: "2026-11-19T03:58:00.000Z" }),
  release("design"),
  release("innovate", { status: "recalled", teams: [T("9090Z", "Stale Snapshot")] }),
  release("create", { teams: [], no_winner: true }),
  release("judges", { teams: [T("1234A", "Gear Grinders"), T("60601D", "Iron Owls")] }),
];
const IQ = { label: "VEX IQ", divisions: ["Elementary School", MS] };
const V5 = { label: "V5RC", divisions: [MS, "High School"] };
const BL = { label: "Blended", divisions: ["Blended"] };
const DIVISIONS = ["Elementary School", MS, "High School", "Blended"];
const VIEW: ReleasedView = { awards, divisions: DIVISIONS, programs: [IQ, V5, BL], releases };
/** What the desk is given with no programs config: one tab, so no tab bar. */
const ONE: ReleasedView = { ...VIEW, divisions: ["Elementary School", MS, "High School"], programs: [{ label: "All", divisions: ["Elementary School", MS, "High School"] }] };

function desk(over: Partial<React.ComponentProps<typeof AwardsDesk>> = {}) {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <AwardsDesk name="Ploy" view={VIEW} lastGood="10:59" failed={false} query="" onQuery={noop} tab={null} onTab={noop} isSeen={() => false} onSeen={noop} {...over} />
    </AppRouterContext.Provider>,
  );
}
/** One award's `<li>` within a division's list. */
const rowOf = (m: string, division: string, label: string) => {
  const list = m.split(`<ul class="mk-rows" aria-label="${division} awards">`)[1] ?? assert.fail(`no list for ${division}`);
  const li = list.slice(0, list.indexOf("</ul>")).split("<li").slice(1).find((x) => x.includes(`<span class="mk-al">${label}</span>`)) ?? assert.fail(`no row for ${label}`);
  return `<li${li}`;
};
const seenButtons = (m: string) => [...m.matchAll(/<button[^>]*>Seen<\/button>/g)].length;

test("the header: title, who is signed in, sign out", () => {
  const m = desk();
  assert.match(text(m), /Awards Desk/);
  assert.match(text(m), /Marketing · signed in as Ploy/);
  assert.doesNotMatch(text(desk({ name: "Marketing" })), /signed in as/);
  assert.match(text(desk({ name: "Marketing" })), /Marketing/);
  assert.match(m, /Sign out/);
  assert.match(m, /<span class="mk-av"><img src="\/avatars\/marketing\.jpg" alt="" width="48" height="48"\/><\/span>/);
  assert.doesNotMatch(m, /mk-av--ph/);
});

test("a recalled row says Being updated and shows no team", () => {
  const li = rowOf(desk(), MS, "Innovate");
  assert.match(text(li), /Being updated/);
  assert.doesNotMatch(li, /9090Z|Stale Snapshot/);
});

test("a changed row carries the tag and Seen; the box lists it; Seen hides both", () => {
  const m = desk();
  assert.match(text(rowOf(m, MS, "Excellence")), /Changed — was 1234A/);
  assert.match(rowOf(m, MS, "Excellence"), /<button[^>]*>Seen<\/button>/);
  const box = m.slice(m.indexOf('aria-labelledby="mk-chg"'), m.indexOf('<section class="mk-sec"'));
  assert.match(text(box), /Changed since sent/);
  assert.match(text(box), /Middle School · Excellence/);
  assert.match(text(box), /now 7700B Polar Bots · was 1234A/);
  assert.match(text(box), /Seen is kept on this device/);
  assert.equal(seenButtons(m), 2, "one in the box, one on the row");
  const after = desk({ isSeen: () => true });
  assert.doesNotMatch(after, /Changed since sent/);
  assert.doesNotMatch(text(after), /Changed — was/);
  assert.equal(seenButtons(after), 0);
});

test("the heading counts what is sent; a never-sent row says so", () => {
  const m = desk();
  assert.match(text(m), /Middle School4 of 11 sent/);
  assert.match(text(m), /Elementary School0 of 11 sent/);
  assert.match(text(rowOf(m, MS, "Think")), /Not sent yet/);
  assert.match(rowOf(m, MS, "Think"), /mk-r is-ns/);
  assert.match(text(rowOf(m, MS, "Create")), /No winner/);
});

test("Judges: two teams stacked in one row", () => {
  const li = rowOf(desk(), MS, "Judges");
  assert.equal(li.match(/<span class="mk-tl">/g)?.length, 2);
  assert.match(text(li), /1234AGear Grinders/);
  assert.match(text(li), /60601DIron Owls/);
});

test("sent rows show their time on wide", () => {
  assert.match(rowOf(desk(), MS, "Design"), /<span class="mk-tt">\d\d:\d\d<\/span>/);
  assert.doesNotMatch(rowOf(desk(), MS, "Think"), /class="mk-tt">\d/);
});

test("search: results, the note, matching rows only, and the box stays", () => {
  const m = desk({ query: "7700B" });
  assert.match(text(m), /1 result(?!s)/);
  assert.match(text(m), /Search looks at what Marketing has now/);
  assert.doesNotMatch(text(m), /High School|Elementary School/);
  assert.match(m, /<mark class="mk-hl">7700B<\/mark>/);
  assert.match(text(m), /Changed since sent/);
  assert.doesNotMatch(m, /mk-al">Design</);
  assert.match(m, /aria-label="Clear search"/);
  assert.match(m, /type="search"/);
  assert.doesNotMatch(desk(), /Clear search/);
});

test("search never looks at the team an award used to have, and says when nothing matches", () => {
  // "Gear" is Excellence's previous team and Judges' current one: only the Judges row answers.
  const gear = desk({ query: "Gear" });
  assert.match(text(gear), /1 result(?!s)/);
  assert.doesNotMatch(gear, /mk-al">Excellence</);
  const m = desk({ query: "zzz" });
  assert.match(text(m), /No award or team matches "zzz"\./);
  assert.doesNotMatch(text(m), /Search looks at/);
});

test("a failed poll keeps what was shown and says so quietly", () => {
  const m = desk({ failed: true });
  assert.match(text(m), /Couldn't reach the server\. Showing what you had at 10:59\./);
  assert.match(text(m), /Checks every 15 s · last 10:59/);
  assert.match(text(m), /Middle School4 of 11 sent/);
  assert.match(text(desk({ failed: true, view: null, lastGood: null })), /Couldn't reach the server\./);
  assert.doesNotMatch(text(desk()), /Couldn't reach/);
});

test("before the first answer: loading, nothing invented", () => {
  const m = desk({ view: null, lastGood: null });
  assert.match(text(m), /Loading…/);
  assert.doesNotMatch(m, /mk-sec/);
});

test("empty states", () => {
  assert.match(text(desk({ view: { ...VIEW, divisions: [] } })), /No divisions yet\./);
  assert.match(text(desk({ view: { ...VIEW, awards: [] } })), /No awards are set up\./);
});

test("a read-only page: the only buttons are search clear, Seen and Sign out", () => {
  const labels = [...desk({ query: "7700B" }).matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((b) => text(b[1]).trim());
  assert.ok(labels.length >= 3);
  for (const l of labels) assert.match(l, /^(Seen|Sign out|)$/);
});

test("the page: no session goes to the login, marketing and the Judge Advisor stay, the rest go home", () => {
  const page = read("src/app/marketing/page.tsx");
  assert.match(page, /router\.replace\("\/marketing\/login"\)/);
  assert.match(page, /session\.role !== "marketing" && session\.role !== "admin"/);
  assert.match(page, /router\.replace\(homeFor\(session\.role\)\)/);
  assert.match(page, /\/api\/awards\/released/);
  assert.match(page, /15_000/);
  assert.match(page, /visibilitychange/);
  assert.match(page, /readSeen\(/);
  assert.match(page, /writeSeen\(/);
  assert.match(read("src/components/marketing/AwardsDesk.tsx"), /<SignOutButton to="\/marketing\/login" \/>/);
});

test("the Seen set reads localStorage behind its own try/catch", () => {
  assert.match(read("src/app/marketing/page.tsx"), /try \{\s*return window\.localStorage;\s*\} catch \{\s*return null;\s*\}/);
});

test("sign-in: Marketing has a door, a home and its own avatar", () => {
  assert.equal(homeFor("marketing"), "/marketing");
  const form = read("src/components/SignInForm.tsx");
  assert.match(form, /marketing: \{ label: "Marketing", avatar: "\/avatars\/marketing\.jpg"/);
  assert.doesNotMatch(form, /si-av--ph/);
  assert.doesNotMatch(form, /Placeholder until the Awards Desk/);
  const login = read("src/app/marketing/login/page.tsx");
  assert.match(login, /Marketing sign in/);
  assert.match(login, /Marketing signs in here to see the awards as the Judge Advisor sends them\./);
  assert.match(login, /door="marketing"/);
});

test("the coordinator page still refuses other roles", () => {
  const page = read("src/app/coordinator/page.tsx");
  assert.match(page, /session\.role !== "coordinator" && session\.role !== "admin"/);
  assert.match(page, /router\.replace\(homeFor\(session\.role\)\)/);
});

test("the CSS: page-scoped, no motion, outside the Judge Advisor blocks", () => {
  const css = read("src/app/globals.css");
  const start = css.indexOf("Awards Desk (");
  assert.ok(start > 0, "the block was found");
  assert.ok(start < css.indexOf("/* @ja-block"), "before the first @ja-block marker");
  const block = css.slice(css.lastIndexOf("/* ----", start), css.lastIndexOf("/* ----", css.indexOf("Coordinator console (")));
  assert.ok(block.length > 3000);
  assert.doesNotMatch(block.replace(/\/\*[\s\S]*?\*\//g, ""), /@keyframes|animation|transform: (?!none)|(?<!over)scroll-behavior/);
  assert.doesNotMatch(css, /si-av--ph|dp-av--ph|mk-av--ph/);
  assert.match(block, /\.mk-av img \{[^}]*object-fit: cover/);
});

/* ---- the program tabs -------------------------------------------------- */

const tabsOf = (m: string) => [...m.matchAll(/<button[^>]*role="tab"[^>]*aria-label="([^"]*)"/g)].map((b) => b[1]);
const headings = (m: string) => [...m.matchAll(/<h2 id="mk-h-\d+">([^<]*)<\/h2>/g)].map((h) => h[1]);

test("the tab bar: one tab per program with its sent count, the first selected, a quiet tablist", () => {
  const m = desk();
  assert.match(m, /role="tablist"/);
  assert.deepEqual(tabsOf(m), ["VEX IQ, 4 of 22 sent", "V5RC, 4 of 22 sent", "Blended, 0 of 11 sent"]);
  // Name and count are separate spans so a phone breaks between them, never mid-phrase.
  assert.match(m, /<b class="mk-tab-n">VEX IQ<\/b><span class="mk-tab-c">4 of 22 sent<\/span>/);
  assert.match(m, /<b class="mk-tab-n">Blended<\/b><span class="mk-tab-c">0 of 11 sent<\/span>/);
  assert.equal([...m.matchAll(/aria-selected="true"/g)].length, 1);
  assert.match(m, /aria-selected="true"[^>]*><b class="mk-tab-n">VEX IQ/);
  // The status line comes first, the tabs under it, the changed box above them.
  assert.ok(m.indexOf("Checks every") < m.indexOf('role="tablist"'));
  assert.ok(m.indexOf("Changed since sent") < m.indexOf('role="tablist"'));
});

test("only the selected tab's divisions show, in its order; the saved tab is the one drawn", () => {
  assert.deepEqual(headings(desk()), ["Elementary School", MS]);
  const v5 = desk({ tab: "v5rc" });
  assert.deepEqual(headings(v5), [MS, "High School"]);
  assert.match(v5, /aria-selected="true"[^>]*><b class="mk-tab-n">V5RC/);
  assert.deepEqual(headings(desk({ tab: "blended" })), ["Blended"]);
  // A saved tab that no longer exists falls back to the first.
  assert.deepEqual(headings(desk({ tab: "gone" })), ["Elementary School", MS]);
});

test("the changed box lists every division whatever tab is showing", () => {
  const view: ReleasedView = { ...VIEW, releases: [...releases, release("design", { division: "High School", teams: [T("2210R", "Red Shift")], previous: { teams: [T("1111Z", "Old")], no_winner: false }, changed_at: "2026-11-19T04:00:00.000Z" })] };
  const m = desk({ view, tab: "vex-iq" });
  assert.match(text(m), /High School · Design/);
  assert.deepEqual(headings(m), ["Elementary School", MS]);
});

test("search spans every tab: no tab bar, each division once, each row counted once; clearing brings the tabs back", () => {
  const view: ReleasedView = { ...VIEW, releases: [...releases, release("design", { division: "High School" })] };
  const m = desk({ view, tab: "vex-iq", query: "2381C" });
  assert.doesNotMatch(m, /role="tablist"|role="tab"/);
  assert.deepEqual(headings(m), [MS, "High School"], "Middle School once, and High School from the other tab");
  assert.match(text(m), /2 results/);
  const ms = desk({ query: "7700B" });
  assert.doesNotMatch(ms, /role="tab"/);
  assert.deepEqual(headings(ms), [MS]);
  assert.match(text(ms), /1 result(?!s)/);
  // Back on the same tab once the query is gone.
  assert.match(desk({ tab: "v5rc", query: "" }), /aria-selected="true"[^>]*><b class="mk-tab-n">V5RC/);
});

test("one tab, no tab bar: the page is what it was", () => {
  const m = desk({ view: ONE });
  assert.doesNotMatch(m, /role="tablist"|role="tab"/);
  assert.deepEqual(headings(m), ["Elementary School", MS, "High School"]);
});

test("the tab is remembered on this device behind its own try/catch, and the tabs are styled like the Judge Advisor's toggle", () => {
  const page = read("src/app/marketing/page.tsx");
  assert.match(page, /readTab\(/);
  assert.match(page, /writeTab\(/);
  const css = read("src/app/globals.css");
  assert.match(css, /\.mk-tabs button\[aria-selected="true"\] \{[^}]*background: var\(--accent\)/);
  assert.match(css, /\.mk-tabs button \{[^}]*min-height: 44px/);
  assert.match(css, /\.mk-tabs button \{[^}]*min-height: 36px/);
  assert.match(css, /\.mk-tab-c::before \{ content: " \\00b7 "/);
  assert.match(css, /\.mk-tab-c \{[^}]*white-space: nowrap/);
  assert.doesNotMatch(read("src/components/marketing/AwardsDesk.tsx"), /ja-aw-/);
});

/* ---- a saved event setup: no tabs, an event title, sections ------------ */

const WE = "Whole event";
const ES = "Elementary School";
const PER = ["excellence", "design"];
const TAGGED = (n: string, name: string, division?: string): ReleaseTeam => ({ ...T(n, name), ...(division && { division }) });
const SETUP_VIEW: ReleasedView = {
  awards,
  divisions: [ES, MS],
  programs: [{ label: "All", divisions: [ES, MS] }],
  setup: { program: "VEX IQ", format: "blended" },
  sections: [
    { key: ES, awardIds: PER },
    { key: MS, awardIds: PER },
    { key: WE, awardIds: awards.filter((a) => !PER.includes(a.id)).map((a) => a.id) },
  ],
  releases: [
    release("excellence", { division: ES, teams: [TAGGED("41111A", "Little Levers", ES)] }),
    release("excellence", { teams: [TAGGED("7700B", "Polar Bots", MS)], previous: { teams: [T("1234A", "Gear Grinders")], no_winner: false }, changed_at: "2026-11-19T03:58:00.000Z" }),
    release("design", { teams: [TAGGED("2381C", "Byte Size", MS)] }),
    release("think", { division: WE, teams: [TAGGED("5150X", "Short Circuit", MS)] }),
    release("build", { division: WE, teams: [T("88012A", "Torque Team")] }),
    release("create", { division: WE, teams: [], no_winner: true }),
    release("judges", { division: WE, teams: [TAGGED("1234A", "Gear Grinders", MS), TAGGED("12021B", "Blue Bolts", ES)] }),
    release("sportsmanship", { division: WE, teams: [TAGGED("3388K", "Kind Robots", MS)] }),
    release("energy", { division: WE, status: "recalled", teams: [] }),
  ],
};
const setupDesk = (over: Partial<React.ComponentProps<typeof AwardsDesk>> = {}) => desk({ view: SETUP_VIEW, ...over });

test("a saved setup: no tab bar, the setup label as the brand line and the event title", () => {
  const m = setupDesk();
  assert.doesNotMatch(m, /role="tablist"|role="tab"/);
  assert.match(m, /<span class="mk-brand-s">VEX IQ · Blended<\/span>/);
  assert.match(m, /<div class="mk-ev"><h2>VEX IQ · Blended<\/h2><p>Excellence and Design for each division · every other award for the whole event<\/p><\/div>/);
  assert.ok(m.indexOf("Checks every") < m.indexOf('class="mk-ev"'), "the title sits under the poll line");
  assert.ok(m.indexOf('class="mk-ev"') < m.indexOf("Changed since sent"), "and above the changed box");
  assert.match(setupDesk({ view: { ...SETUP_VIEW, setup: { program: "V5RC", format: "standard" }, sections: [{ key: MS, awardIds: awards.map((a) => a.id) }] } }), /<h2>V5RC · Standard<\/h2><p>Every award for each division<\/p>/);
  assert.doesNotMatch(desk(), /class="mk-ev"/, "no setup, no title");
});

test("a saved setup: the sections in order, each with its count and bar", () => {
  const m = setupDesk();
  assert.deepEqual(headings(m), [ES, MS, WE]);
  assert.match(text(m), /Elementary School1 of 2 sent/);
  assert.match(text(m), /Whole event5 of 9 sent/);
  assert.match(m, /<i style="width:55\.5+\d*%"><\/i>/);
  assert.equal([...m.matchAll(/<li class="mk-r/g)].length, 2 + 2 + 9);
});

test("a saved setup: Whole event rows tag each team with its division; a row without one shows none; division sections show none", () => {
  const m = setupDesk();
  assert.match(rowOf(m, WE, "Think"), /5150X[^]*<span class="mk-dv" title="Middle School">MS<\/span>/);
  const judges = rowOf(m, WE, "Judges");
  assert.match(judges, /1234A[^]*>MS<\/span>[^]*12021B[^]*>ES<\/span>/);
  assert.equal([...judges.matchAll(/class="mk-dv"/g)].length, 2);
  assert.doesNotMatch(rowOf(m, WE, "Build"), /mk-dv/, "an old row without a division");
  assert.doesNotMatch(rowOf(m, ES, "Excellence"), /mk-dv/);
  assert.doesNotMatch(rowOf(m, MS, "Design"), /mk-dv/);
  assert.match(rowOf(m, WE, "Create"), /No winner/);
  assert.match(rowOf(m, WE, "Energy"), /Being updated/);
  assert.match(rowOf(m, WE, "Inspire"), /Not sent yet/);
});

test("a saved setup: the changed box is above the sections and reads scope · award", () => {
  const m = setupDesk();
  assert.match(text(m), /Middle School · Excellencenow 7700B Polar Bots · was 1234A/);
  assert.ok(m.indexOf("Changed since sent") < m.indexOf('aria-label="Elementary School awards"'));
  const wholeChange: ReleasedView = { ...SETUP_VIEW, releases: [...SETUP_VIEW.releases, release("innovate", { division: WE, teams: [T("9090Z", "New")], previous: { teams: [T("1111Z", "Old")], no_winner: false }, changed_at: "2026-11-19T04:10:00.000Z" })] };
  assert.match(text(setupDesk({ view: wholeChange })), /Whole event · Innovate/);
});

test("a saved setup: search groups results by section and hides sections with nothing", () => {
  const m = setupDesk({ query: "5150X" });
  assert.deepEqual(headings(m), [WE]);
  assert.match(text(m), /1 result(?!s)/);
  assert.deepEqual(headings(setupDesk({ query: "Excellence" })), [ES, MS]);
  assert.match(text(setupDesk({ query: "nothing here" })), /No award or team matches/);
});

test("the CSS: the event title and the division tag are plain styles under .mk, no motion", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /\.mk-ev h2 \{[^}]*font-size: 19px/);
  assert.match(css, /\.mk-dv \{[^}]*border-radius: 999px/);
  assert.match(css, /\.mk-ev h2 \{[^}]*font-size: 22px/);
});
