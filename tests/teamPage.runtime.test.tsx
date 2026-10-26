import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { TeamNotFound, TeamView, type TeamViewProps } from "../src/components/team/TeamView";
import { earlierToday } from "../src/components/team/teamLogic";
import { formatClock } from "../src/components/ui";
import type { PublicPanel, RequestRow, Team, TeamCategoryView } from "../src/lib/types";

/* The team page ("Status board"), rendered to markup. It is read-only -- only
   the queue desk and the Judge Advisor create or change a request -- so there is
   nothing to click: the tests check what is shown and that nothing can be pressed.
   The page itself (polling, the lookup) is read from source at the foot. */

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const noComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");

// Midday in Bangkok, so every `ago()` stays on that day whatever the real clock says.
const NOW = Date.parse("2026-10-20T05:00:00.000Z");
// The view reads the clock itself (ui.tsx), so the clock is pinned to NOW for the whole file.
mock.timers.enable({ apis: ["Date"], now: NOW });
const ago = (mins: number) => new Date(NOW - mins * 60_000 - 5_000).toISOString();
// Far enough ahead that no slot has passed, so the booked times do not depend on the clock.
const SLOT_BASE = Date.parse("2099-01-01T10:00:00.000Z");
const slotAt = (n: number) => new Date(SLOT_BASE + n * 20 * 60_000).toISOString();

const languages = [
  { id: "en", label: "English", short: "EN" },
  { id: "es", label: "Español", short: "ES" },
];

const categories: TeamCategoryView[] = [
  { id: "developing", label: "Developing", color: "oklch(0.7 0.1 250)", excludesRubrics: [] },
  { id: "emerging", label: "Emerging", color: "oklch(0.7 0.1 150)", excludesRubrics: [] },
];

const titans: Team = { id: "t-9882K", number: "9882K", name: "Torque Titans", panel_id: "p2", division: "Middle School", category: "developing", pit: "B4", created_at: "2026-10-20T08:00:00Z" };
const loose: Team = { ...titans, id: "t-7700B", number: "7700B", name: "Byte Me", panel_id: null };
const other = (n: number): Team => ({ ...titans, id: `t-other${n}`, number: `10${n}`, name: `Other ${n}` });

const panel2: PublicPanel = {
  id: "p2", name: "Panel 2", division: "Middle School", judges: ["Priya Nair", "Alex Chen"], languages: ["en", "es"],
  sort_order: 2, slot_start_at: slotAt(0), slot_minutes: 20, slot_count: 7,
};

const req = (over: Partial<RequestRow>): RequestRow => ({
  id: "r1", team_id: titans.id, panel_id: "p2", status: "requested", kind: "queue", language: "en", slot_start: null, slot_end: null,
  message: null, created_by: null, acknowledged_by: null, interviewer: null, outcome: null, requested_at: ago(4), acknowledged_at: null,
  started_at: null, finished_at: null, cancelled_at: null, updated_at: ago(4), ...over,
});

// Panel 2's day, as the idle mock draws it: 1 in interview, 2 waiting (the longest 6 min), three slots taken.
const others = [other(1), other(2), other(3), other(4), other(5), other(6)];
const crowd = [
  req({ id: "x1", team_id: others[0].id, status: "interviewing", started_at: ago(3) }),
  req({ id: "x2", team_id: others[1].id, status: "requested", requested_at: ago(6) }),
  req({ id: "x3", team_id: others[2].id, status: "requested", requested_at: ago(2) }),
  req({ id: "s0", team_id: others[3].id, status: "scheduled", kind: "slot", slot_start: slotAt(0), slot_end: slotAt(1) }),
  req({ id: "s1", team_id: others[4].id, status: "scheduled", kind: "slot", slot_start: slotAt(1), slot_end: slotAt(2) }),
  req({ id: "s4", team_id: others[5].id, status: "scheduled", kind: "slot", slot_start: slotAt(4), slot_end: slotAt(5) }),
];

function view(over: Partial<TeamViewProps> = {}) {
  const team = over.team ?? titans;
  const requests = over.requests ?? crowd;
  const current = over.current ?? null;
  return renderToStaticMarkup(
    <TeamView
      team={team}
      panel={team.panel_id ? panel2 : undefined}
      current={current}
      history={earlierToday(requests, team.id, current?.id, NOW)}
      languages={languages}
      categories={categories}
      requests={requests}
      online
      now={NOW}
      {...over}
    />,
  );
}

const booked = req({ status: "scheduled", kind: "slot", slot_start: slotAt(2), slot_end: slotAt(3) });
const panelOf = (m: string) => m.match(/<section class="tp-pan [^"]*"[\s\S]*?<\/section>/)?.[0] ?? "";
const trackOf = (m: string) => m.match(/<section class="tp-track"[\s\S]*?<\/section>/)?.[0] ?? "";
const stepsOf = (m: string) => [...trackOf(m).matchAll(/<li class="tp-st tp-st--(\w+) tp-s-(\w+)"[^>]*>([\s\S]*?)<\/li>/g)].map((x) => ({ state: x[1], tone: x[2], text: text(x[3]) }));
// A read-only page: nothing to press, type into or send.
const controls = (m: string) => m.match(/<(?:button|input|form|select|textarea|label)\b/g) ?? [];
const NOTE = /<section class="tp-acts" aria-label="How to request a judge"><p>Please ask the queue desk to request a judge or book a time for your team\.<\/p><\/section>/;

/* ---- the details row ------------------------------------------------------------------- */

const detailsOf = (m: string) =>
  [...(m.match(/<ul class="tp-meta"[\s\S]*?<\/ul>/)?.[0] ?? "").matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => text(x[1]));
const sprockets: Team = { ...titans, id: "t-1150", number: "1150", name: "Silver Sprockets", division: "Elementary School", category: "developing", pit: "12" };
const panelA: PublicPanel = { ...panel2, name: "Panel A" };

test("details row: number, name, pit, division, notebook and panel, in that order, above the card", () => {
  const m = view({ team: sprockets, panel: panelA });
  assert.deepEqual(detailsOf(m), ["1150", "Silver Sprockets", "Pit 12", "Division: Elementary School", "Notebook: Developing", "Panel A"]);
  assert.match(m, /<li><b>1150<\/b><\/li>/, "the number is bold");
  assert.match(m, /<li><span class="tp-sr">Division: <\/span>Elementary School<\/li><li><span class="tp-sr">Notebook: <\/span>Developing<\/li>/, "division and notebook carry hidden labels");
  assert.ok(m.indexOf('class="tp-meta"') > 0 && m.indexOf('class="tp-meta"') < m.indexOf('<section class="tp-pan '), "the row comes before the card");
  assert.ok(m.indexOf('class="tp-meta"') > m.indexOf('class="tp-left"'), "in the left column");
  assert.doesNotMatch(m.match(/<ul class="tp-meta"[\s\S]*?<\/ul>/)?.[0] ?? "", /\|/, "the bars are CSS, not text a screen reader would read");
  assert.match(text(panelOf(m)), /^Team 1150 · Silver Sprockets/, "the card keeps its own line");
});

test("details row: no pit and no panel keep their places as '—' and 'No panel'", () => {
  const m = view({ team: { ...sprockets, pit: null, panel_id: null } });
  assert.deepEqual(detailsOf(m), ["1150", "Silver Sprockets", "—No pit", "Division: Elementary School", "Notebook: Developing", "No panel"]);
  assert.match(m, /<li><span aria-hidden="true">—<\/span><span class="tp-sr">No pit<\/span><\/li>/);
});

test("details row: a category the event does not list shows its raw id", () => {
  assert.equal(detailsOf(view({ team: { ...sprockets, category: "legacy-cat" } }))[4], "Notebook: legacy-cat");
  assert.equal(detailsOf(view({ team: { ...sprockets, category: "emerging" } }))[4], "Notebook: Emerging");
});

test("details row styles: bars are borders that wrap cleanly, with tokens only", () => {
  const css = read("src/app/globals.css");
  const rules = css.match(/\.tp-meta[^{]*\{[^}]*\}/g)?.join("\n") ?? "";
  assert.match(rules, /flex-wrap: wrap/);
  assert.match(rules, /border-left: 1px solid var\(--tp-field-line\)/);
  assert.match(rules, /overflow: hidden/, "clips the bar at the start of a wrapped line");
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b|oklch\(|rgb|hsl/i, "no hard-coded colours");
});

/* ---- idle ------------------------------------------------------------------------ */

test("idle: a neutral panel that says 'No request yet', with the busy line under it and no status colour", () => {
  const m = view();
  const pan = panelOf(m);
  assert.match(pan, /^<section class="tp-pan tp-pan--idle"/, "no status, so no status colour");
  assert.doesNotMatch(pan, /tp-s-/);
  assert.match(text(pan), /^Team 9882K · Torque TitansNo request yet/);
  assert.match(pan, /<h1 class="tp-pan-sent" id="tp-st">No request yet<\/h1>/);
  assert.match(pan, /<p class="tp-pan-cap"><span>1 in interview · 2 already waiting \(longest 6 min\)<\/span><\/p>/, "PanelBusyLine's own copy, uncoloured");
  assert.match(pan, /<p class="tp-pan-foot"><b>Panel 2<\/b> · Middle School<span>Priya Nair, Alex Chen<\/span><\/p>/);
  assert.doesNotMatch(pan, /tp-pan-lab|tp-pan-time|tp-ptag/, "no status label, big time or language tag without a request");
});

test("idle: the track is all hollow, with its caption and a hidden heading for screen readers", () => {
  const m = view();
  assert.match(trackOf(m), /<h2 class="tp-sr" id="tp-trk">Where you are in the queue<\/h2>/);
  assert.deepEqual(stepsOf(m).map((s) => [s.state, s.text]), [["todo", "Booked"], ["todo", "Requested"], ["todo", "On the way"], ["todo", "Interviewing"], ["todo", "Complete"]]);
  assert.deepEqual(stepsOf(m).map((s) => s.tone), ["booked", "waiting", "enroute", "active", "done"]);
  assert.match(trackOf(m), /<p class="tp-trk-cap">Not in the queue yet<\/p>/);
  assert.doesNotMatch(trackOf(m), /aria-current/);
});

test("idle: the queue desk note stands where the request controls were, and nothing can be pressed", () => {
  const m = view();
  assert.match(m, NOTE);
  assert.deepEqual(controls(m), []);
  assert.doesNotMatch(m, /Request a judge|Ask for a judge|Cancel this|Book a time|tp-slot|Which language/);
});

test("idle: 'See the full board' goes to /board", () => {
  assert.match(view(), /<a class="tp-more" href="\/board">See the full board →<\/a>/);
});

/* ---- booked ---------------------------------------------------------------------- */

test("booked: the panel wears the scheduled colour and shows the slot", () => {
  const m = view({ current: booked, requests: [...crowd, booked] });
  const pan = panelOf(m);
  assert.match(pan, /^<section class="tp-pan tp-s-booked"/);
  assert.match(text(pan), /Scheduled/);
  assert.match(pan, /<h1 class="tp-pan-sent" id="tp-st">Your slot is booked<\/h1>/);
  assert.match(pan, /<p class="tp-pan-time"><span>Booked slot<\/span><b>\d{1,2}:\d{2}(<small>[AP]M<\/small>)?<\/b><\/p>/);
  const { time } = { time: formatClock(slotAt(2)).replace(/\s?[AP]M$/i, "").trim() };
  assert.ok(text(pan).includes(time), `the panel shows ${time}`);
  assert.doesNotMatch(pan, /tp-pan-cap/, "the busy line is only for a team with no request");
});

test("booked: the track is on Booked with the slot time, the rest still to come", () => {
  const m = view({ current: booked, requests: [...crowd, booked] });
  const steps = stepsOf(m);
  assert.deepEqual(steps.map((s) => s.state), ["current", "todo", "todo", "todo", "todo"]);
  assert.ok(steps[0].text.includes(formatClock(slotAt(2))));
  assert.match(trackOf(m), /<li class="tp-st tp-st--current tp-s-booked" aria-current="step">/);
  assert.match(steps[0].text, /Booked, current step/);
  assert.doesNotMatch(trackOf(m), /Not in the queue yet/);
});

test("booked: the same note, and no way to go ready early or cancel the booking", () => {
  const m = view({ current: booked, requests: [...crowd, booked] });
  assert.match(m, NOTE);
  assert.deepEqual(controls(m), []);
  assert.doesNotMatch(m, /Ready before|Either gives up|Cancel this|Request a judge|We&#x27;re ready/);
});

/* ---- a request in progress -------------------------------------------------------- */

const acknowledged = req({ status: "acknowledged", acknowledged_at: ago(1) });

test("on the way: the enroute colour, the sentence, the time since requested and the language tag", () => {
  const m = view({ current: acknowledged, requests: [...crowd, acknowledged] });
  const pan = panelOf(m);
  assert.match(pan, /^<section class="tp-pan tp-s-enroute"/);
  assert.match(pan, /<p class="tp-pan-lab">Judges on their way<\/p>/);
  assert.match(pan, /<h1 class="tp-pan-sent" id="tp-st">Judges are on their way to you<\/h1>/);
  assert.match(pan, /<p class="tp-pan-time"><span>Requested<\/span><b>4 min<small>ago<\/small><\/b><\/p>/);
  assert.match(pan, /<span class="tp-ptag">English<\/span>/);
  assert.deepEqual(controls(m), []);
  assert.doesNotMatch(m, /Request a judge|Cancel this|We&#x27;re ready|Ready before|Book a time/);
});

test("on the way: Booked is 'not used', Requested is ticked with how long ago, On the way is current", () => {
  const steps = stepsOf(view({ current: acknowledged, requests: [...crowd, acknowledged] }));
  assert.deepEqual(steps.map((s) => s.state), ["skipped", "done", "current", "todo", "todo"]);
  assert.equal(steps[0].text, "Booked, not used");
  assert.equal(steps[1].text, "Requested, done4 min ago");
  assert.equal(steps[2].text, "On the way, current step");
});

test("a requested team is in the orange state and an interviewing one in the active state, neither with a cancel", () => {
  const requested = req({ status: "requested" });
  const m = view({ current: requested, requests: [...crowd, requested] });
  assert.match(panelOf(m), /^<section class="tp-pan tp-s-waiting"/);
  assert.deepEqual(controls(m), []);
  assert.doesNotMatch(m, /Cancel this/);

  const interviewing = req({ status: "interviewing", started_at: ago(12) });
  const mi = view({ current: interviewing, requests: [...crowd, interviewing] });
  assert.match(panelOf(mi), /^<section class="tp-pan tp-s-active"/);
  assert.match(panelOf(mi), /<span>Started<\/span><b>12 min<small>ago<\/small><\/b>/);
  // The caps label is the short name, so the sentence is not said twice.
  assert.match(panelOf(mi), /<p class="tp-pan-lab">Interviewing<\/p><h1[^>]*>Interview in progress<\/h1>/);
  assert.equal(text(panelOf(mi)).match(/Interview in progress/g)?.length, 1);
  assert.deepEqual(controls(mi), []);
});

test("a team with a live request and one finished earlier: the sentence, the track, Earlier today and the queue desk note, nothing to press", () => {
  const done = req({ id: "h0", status: "completed", finished_at: ago(60) });
  const m = view({ current: acknowledged, requests: [...crowd, acknowledged, done] });
  assert.match(text(panelOf(m)), /Judges are on their way to you/);
  assert.deepEqual(stepsOf(m).map((s) => s.state), ["skipped", "done", "current", "todo", "todo"]);
  assert.match(m, /<h2 class="tp-h-caps" id="tp-hist">Earlier today<\/h2>/);
  assert.deepEqual([...m.matchAll(/<li class="tp-hist"><span class="tp-sc tp-s-(\w+)">([^<]+)</g)].map((r) => [r[1], r[2]]), [["done", "Interview complete"]]);
  assert.match(m, NOTE);
  assert.doesNotMatch(m, /<button|<input|<form/);
});

test("a team whose only request is over shows it as where it stands, and not again under Earlier today", () => {
  // The page picks the team's latest request when none is live; the view shows whatever it is given.
  const done = req({ id: "h0", status: "completed", finished_at: ago(30), updated_at: ago(30) });
  const m = view({ current: done, requests: [...crowd, done] });
  assert.match(panelOf(m), /^<section class="tp-pan tp-s-done"/);
  assert.match(text(panelOf(m)), /Interview complete — thank you!/);
  assert.deepEqual(stepsOf(m).map((s) => s.state), ["skipped", "done", "done", "done", "current"]);
  assert.doesNotMatch(m, /Earlier today|class="tp-hist"/, "it is the current request, so it is not history too");
  assert.doesNotMatch(m, /No request yet/);
});

test("a request made a moment ago reads 'just now', set smaller so it still fits a phone", () => {
  const fresh = req({ status: "requested", requested_at: new Date(NOW - 10_000).toISOString() });
  assert.match(panelOf(view({ current: fresh, requests: [fresh] })), /<span>Requested<\/span><b class="tp-word">just now<\/b>/);
});

test("an hour or more is set smaller so it still fits; under an hour is not", () => {
  const long = req({ status: "interviewing", started_at: ago(54 * 60 + 39) });
  assert.match(panelOf(view({ current: long, requests: [long] })), /<span>Started<\/span><b class="tp-word">54h 39m<small>ago<\/small><\/b>/);
  const short = req({ status: "interviewing", started_at: ago(59) });
  assert.match(panelOf(view({ current: short, requests: [short] })), /<b>59 min<small>ago<\/small><\/b>/);
});

/* ---- no panel, offline ---------------------------------------------------------------- */

test("no panel: the caution line, and no busy line", () => {
  const m = view({ team: loose });
  assert.match(panelOf(m), /<p class="tp-pan-foot tp-pan-foot--none">No judge panel assigned yet — check with the Judge Advisor\.<\/p>/);
  assert.doesNotMatch(m, /1 in interview|Panel is free|tp-pan-cap/);
});

test("a failed poll after the first answer says so, and a good one says nothing", () => {
  assert.match(view({ online: false }), /<p class="tp-offline" role="status">Can&#x27;t reach the server — retrying…<\/p>/);
  assert.doesNotMatch(view(), /tp-offline/);
});

/* ---- earlier today ---------------------------------------------------------------- */

test("earlier today: up to five of the team's other requests, a status chip and a time each", () => {
  const done = Array.from({ length: 7 }, (_, i) =>
    req({ id: `h${i}`, status: i === 1 ? "cancelled" : "completed", finished_at: i === 1 ? null : ago(60 + i), cancelled_at: i === 1 ? ago(90) : null }),
  );
  const m = view({ requests: [...crowd, ...done] });
  const rows = [...m.matchAll(/<li class="tp-hist"><span class="tp-sc tp-s-(\w+)">([^<]+)<\/span><span class="tp-hist-t">([^<]+)<\/span><\/li>/g)];
  assert.equal(rows.length, 5);
  assert.match(m, /<h2 class="tp-h-caps" id="tp-hist">Earlier today<\/h2>/);
  assert.deepEqual(rows.map((r) => [r[1], r[2]]), [["done", "Interview complete"], ["off", "Cancelled"], ["done", "Interview complete"], ["done", "Interview complete"], ["done", "Interview complete"]]);
  assert.equal(rows[0][3], formatClock(done[0].finished_at));
  assert.equal(rows[1][3], formatClock(done[1].cancelled_at), "a cancelled one is timed by when it was cancelled");
  assert.doesNotMatch(view(), /Earlier today/, "nothing earlier, no heading");
});

test("earlier today never repeats the live request", () => {
  const done = req({ id: "h0", status: "completed", finished_at: ago(60) });
  const m = view({ current: acknowledged, requests: [...crowd, acknowledged, done] });
  assert.equal([...m.matchAll(/class="tp-hist"/g)].length, 1);
  assert.doesNotMatch(m.slice(m.indexOf("Earlier today")), /Judges on their way/);
});

/* ---- the states before there is a team ------------------------------------------------ */

test("a number that is not on the list says so, and offers another go", () => {
  const m = renderToStaticMarkup(<TeamNotFound number="9882K" />);
  assert.match(m, /<p class="mb-2 text-lg font-semibold">Team 9882K is not on the list\.<\/p>/);
  assert.match(m, /<p class="text-ink-subtle">Check the number, or ask the Judge Advisor to add you\.<\/p>/);
  assert.match(m, /<a class="mt-6 inline-block text-accent-quiet hover:text-accent" href="\/team">← Try another number<\/a>/);
});

/* ---- the page: what it keeps, read from source ------------------------------------------ */

const page = noComments(read("src/app/team/[number]/page.tsx"));

test("the public page renders TeamView and keeps only polling and the lookup", () => {
  assert.match(page, /<TeamView\b/);
  assert.match(page, /normalizeTeamNumber\(decodeURIComponent\(number\)\)/);
  assert.match(page, /useAppState\(4000\)/);
  assert.match(page, /online \? "Loading…" : "Can't reach the server — retrying…"/);
  assert.match(page, /if \(!team\) return <TeamNotFound number=\{teamNumber\} \/>/);
  // The live request, else the latest from today, and history leaves that one out.
  assert.match(page, /liveRequestFor\(team\.id, requests\) \?\? latestToday\(requests, team\.id, now\)/);
  assert.match(page, /history=\{earlierToday\(state\.requests, team\.id, current\?\.id, now\)\}/);
  assert.match(page, /categories=\{state\.categories\}/);
  // Not a second copy of the view's markup.
  assert.doesNotMatch(page, /tp-pan|tp-track|tp-acts|<main|<header|<section|trackSteps|STATUS_META/);
  assert.doesNotMatch(page, /\/api\/requests|onReady|onBook|onCancel|\brefresh\b/);
});

test("the public page does not ask for confirmation or make writes", () => {
  assert.doesNotMatch(page, /useConfirm|cancelAfterAsking|\bcall\(/);
  for (const file of ["src/app/team/[number]/page.tsx", "src/components/team/TeamView.tsx", "src/components/team/teamLogic.ts"]) {
    const src = noComments(read(file));
    assert.ok(!/(?:^|[^\w$.])confirm\s*\(|\bwindow\.confirm/.test(src), `${file} calls the native confirm()`);
    // A keydown that opened the dialog would have to preventDefault() first; there is none.
    assert.ok(!/onKeyDown|keydown/.test(src), `${file} has a key handler`);
  }
});

test("the view is read-only: no buttons, inputs, forms or handlers in its source", () => {
  const view = noComments(read("src/components/team/TeamView.tsx"));
  assert.doesNotMatch(view, /<button|<input|<form|<select|<textarea|role="button"|\bon[A-Z]\w*=|useState/);
  assert.match(view, /Please ask the queue desk to request a judge or book a time for your team\./);
});
