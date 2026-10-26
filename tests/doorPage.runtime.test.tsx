import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";

import { DoorPage } from "../src/components/door/DoorPage";
import { TICKET_ERROR, TeamTicket, ticketTarget } from "../src/components/door/TeamTicket";
import { TeamNotFound } from "../src/components/team/TeamView";
import { filterTeamNumberInput } from "../src/lib/teamNumber";

/* The door page ("/", "Five doors") and the team-number entry it moved to
   (/team), rendered to markup. There is no DOM harness here, so the ticket's
   input behaviour runs as the pure function the component submits through,
   and its wiring (filter on change, push on submit) is read from source. */

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const noComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");

const door = renderToStaticMarkup(<DoorPage />);
const hrefs = [...door.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);

test("/: five doors in order, each a link to its sign-in", () => {
  assert.deepEqual(hrefs.slice(0, 5), ["/team", "/judge/login", "/referee/login", "/queue/login", "/admin/login"]);
  const names = [...door.matchAll(/<span class="dp-dt">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(names, ["Team", "Judge", "Referee", "Queue desk", "Judge Advisor"]);
  const lines = [...door.matchAll(/<span class="dp-s">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(lines.slice(0, 5), [
    "Check your judging status",
    "Panel code from your Judge Advisor",
    "Referees and the head referee",
    "Check teams in and book times",
    "Runs judging for the event",
  ]);
});

test("/: the Live board is the one other link, and /login is not linked", () => {
  assert.deepEqual(hrefs.slice(5), ["/board"]);
  assert.ok(!hrefs.includes("/login"));
  assert.match(door, /<a class="dp-board" href="\/board">/);
  assert.match(door, /Live board<span class="dp-pill">LIVE<\/span>/);
});

test("/: titled 'Who are you?', with no team-number input and no staff rows", () => {
  assert.match(door, /<h1 class="dp-title" id="dp-title">Who are you\?<\/h1>/);
  assert.match(text(door), /Choose your door/);
  assert.ok(!/<input|<form|<button/.test(door), "the door page has no controls but links");
  assert.ok(!/What the colours mean<\/h2>/.test(door), "the old separate colour card is gone");
});

test("/: the Team door has a ticket glyph and a caption, no avatar; the others ring theirs", () => {
  const cards = [...door.matchAll(/<a class="dp-card"[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
  assert.equal(cards.length, 5);
  assert.match(cards[0], /dp-av--team/);
  assert.ok(!/<img/.test(cards[0]));
  assert.match(cards[0], /aria-describedby="dp-cap"/);
  assert.match(door, /<p class="dp-cap" id="dp-cap">Opens the team ticket<\/p>/);
  const rings = [
    ["judge", "judge"], ["referee", "ref"], ["queue-desk", "desk"], ["judge-advisor", "ja"],
  ];
  rings.forEach(([file, ring], i) => {
    assert.match(cards[i + 1], new RegExp(`dp-r-${ring}"><img src="/avatars/${file}\\.jpg" alt=""`));
  });
});

test("/: the Live board card holds five sample tiles for 1234A, as one key group", () => {
  const group = door.match(/<div class="dp-samples" role="group" aria-label="What the colours mean">[\s\S]*?<\/ul><\/div>/)?.[0] ?? "";
  assert.ok(group, "the key group is named 'What the colours mean'");
  assert.match(group, /Each team shows on the board as a tile in one of these colours\./);
  const tiles = [...group.matchAll(/<li class="dp-tl dp-s-(\w+)">([\s\S]*?)<\/li>/g)];
  assert.deepEqual(tiles.map((t) => t[1]), ["bk", "rq", "en", "in", "dn"]);
  // One screen-reader phrase per tile; the visible pieces are hidden from it.
  assert.deepEqual(
    tiles.map((t) => t[2].match(/<span class="sr-only">([^<]+)<\/span>/)?.[1]),
    ["Booked, 10:40", "Requesting, 3 min", "On the way", "Interviewing", "Complete"],
  );
  for (const t of tiles) {
    assert.match(t[2], /<span class="dp-tl-n" aria-hidden="true">1234A<\/span>/);
    assert.ok(!/tabindex|<a |<button/.test(t[0]), "a tile is a key, not a control");
  }
  assert.match(tiles[0][2], /<span class="dp-tl-t" aria-hidden="true">10:40<\/span>/);
  assert.match(tiles[1][2], /<span class="dp-tl-t" aria-hidden="true">3 min<\/span>/);
  assert.ok(!/dp-tl-t/.test(tiles[2][2] + tiles[3][2] + tiles[4][2]), "only Booked and Requesting show a time");
  // The key sits inside the same card as the board link: one border around both.
  assert.ok(door.indexOf('class="dp-bcard"') < door.indexOf('class="dp-board"'));
  assert.ok(door.indexOf('class="dp-board"') < door.indexOf('class="dp-samples"'));
});

test("/team: the ticket, its back link and the Live board, without the staff rows or the colour card", () => {
  const router = {} as React.ContextType<typeof AppRouterContext>;
  const m = renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <TeamTicket />
    </AppRouterContext.Provider>,
  );
  assert.match(m, /<a class="lp-back" href="\/"><span aria-hidden="true">←<\/span> All doors<\/a>/);
  assert.ok(m.indexOf("lp-back") < m.indexOf("lp-ticket"), "the back link is at the top");
  assert.match(m, /<h1 class="lp-title" id="lp-title">Find your team<\/h1>/);
  assert.match(m, /<input id="lp-team"[^>]*maxLength="12"/);
  assert.match(m, /placeholder="1234A"/);
  // Empty: Continue is disabled and no error is showing.
  assert.match(m, /<button type="submit" class="si-btn lp-btn" disabled="">Continue<\/button>/);
  assert.ok(!/role="alert"/.test(m));
  assert.match(m, /<a class="lp-board" href="\/board">/);
  for (const gone of ["/judge/login", "/login", "/referee/login", "Judges", "Event team", "sign in", "What the colours mean", "lp-legend"]) {
    assert.ok(!m.includes(gone), `/team no longer shows "${gone}"`);
  }
});

test("/team: empty or invalid numbers get the copy, a valid one opens /team/<n>", () => {
  assert.equal(TICKET_ERROR, "Enter your team number, for example 1234 or 9882K.");
  assert.deepEqual(ticketTarget(""), { error: TICKET_ERROR });
  assert.deepEqual(ticketTarget("-"), { error: TICKET_ERROR });
  assert.deepEqual(ticketTarget("9882K"), { href: "/team/9882K" });
  assert.deepEqual(ticketTarget("1234A"), { href: "/team/1234A" });
  // What reaches the check is filtered the way typing filters it.
  assert.equal(filterTeamNumberInput("98 82k!"), "9882K");
  assert.deepEqual(ticketTarget(filterTeamNumberInput("98 82k!")), { href: "/team/9882K" });
});

test("/team: the submit still goes through ticketTarget and router.push, and typing still filters", () => {
  const src = noComments(read("src/components/door/TeamTicket.tsx"));
  assert.match(src, /const target = ticketTarget\(number\);/);
  assert.match(src, /setError\(target\.error\)/);
  assert.match(src, /router\.push\(target\.href\)/);
  assert.match(src, /setNumber\(filterTeamNumberInput\(e\.target\.value\)\)/);
  assert.match(src, /href: `\/team\/\$\{encodeURIComponent\(number\)\}`/);
  assert.match(src, /disabled=\{!number\}/);
  assert.match(src, /\bautoFocus\b/);
});

test("the routes: / is the door page, /team the ticket", () => {
  assert.match(read("src/app/page.tsx"), /<DoorPage \/>/);
  assert.match(read("src/app/team/page.tsx"), /<TeamTicket \/>/);
});

test("the not-found team page sends people back to /team", () => {
  assert.match(renderToStaticMarkup(<TeamNotFound number="0000" />), /<a [^>]*href="\/team">← Try another number<\/a>/);
});

test("the sign-in pass says 'Back to all doors' and still links to /", () => {
  const src = read("src/components/SignInForm.tsx");
  assert.match(src, /<Link href="\/" className="si-back">[\s\S]*?Back to all doors\s*<\/Link>/);
  assert.ok(!src.includes("Back to team view"));
});

test("the top bar brand stays the front door", () => {
  assert.match(read("src/components/ui.tsx"), /href="\/"/);
});
