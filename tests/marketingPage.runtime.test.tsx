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
const VIEW: ReleasedView = { awards, divisions: ["Elementary School", MS, "High School"], releases };

function desk(over: Partial<React.ComponentProps<typeof AwardsDesk>> = {}) {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <AwardsDesk name="Ploy" view={VIEW} lastGood="10:59" failed={false} query="" onQuery={noop} isSeen={() => false} onSeen={noop} {...over} />
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
