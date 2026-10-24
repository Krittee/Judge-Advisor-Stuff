import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { TeamNotFound, TeamView, type TeamViewProps } from "../src/components/team/TeamView";
import { earlierToday } from "../src/components/team/teamLogic";
import { formatClock } from "../src/components/ui";
import type { PublicPanel, RequestRow, Team } from "../src/lib/types";

/* The team page ("Status board"), rendered to markup. What needs a browser
   (a click, the confirm dialog opening) has no DOM harness here: the decision
   behind Cancel runs as a function in teamPage.logic.test.mjs and its wiring is
   read from source at the foot. */

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const noComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
const noop = () => {};

const NOW = Date.now();
const ago = (mins: number) => new Date(NOW - mins * 60_000 - 5_000).toISOString();
// Far enough ahead that no slot has passed, so the grid does not depend on the clock.
const SLOT_BASE = Date.parse("2099-01-01T10:00:00.000Z");
const slotAt = (n: number) => new Date(SLOT_BASE + n * 20 * 60_000).toISOString();

const languages = [
  { id: "en", label: "English", short: "EN" },
  { id: "es", label: "Español", short: "ES" },
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
      history={earlierToday(requests, team.id, current?.id)}
      languages={languages}
      requests={requests}
      teams={[titans, loose, ...others]}
      online
      now={NOW}
      busy={false}
      error={null}
      onDismissError={noop}
      message=""
      onMessage={noop}
      onReady={noop}
      onBook={noop}
      onCancel={noop}
      {...over}
    />,
  );
}

const booked = req({ status: "scheduled", kind: "slot", slot_start: slotAt(2), slot_end: slotAt(3) });
const panelOf = (m: string) => m.match(/<section class="tp-pan [^"]*"[\s\S]*?<\/section>/)?.[0] ?? "";
const trackOf = (m: string) => m.match(/<section class="tp-track"[\s\S]*?<\/section>/)?.[0] ?? "";
const stepsOf = (m: string) => [...trackOf(m).matchAll(/<li class="tp-st tp-st--(\w+) tp-s-(\w+)"[^>]*>([\s\S]*?)<\/li>/g)].map((x) => ({ state: x[1], tone: x[2], text: text(x[3]) }));
const requestButtons = (m: string) => (m.match(/<button type="button" class="tp-btn"/g) ?? []).length;

/* ---- idle ------------------------------------------------------------------------ */

test("idle: a neutral panel that says 'Ask for a judge', with the busy line under it and no status colour", () => {
  const m = view();
  const pan = panelOf(m);
  assert.match(pan, /^<section class="tp-pan tp-pan--idle"/, "no status, so no status colour");
  assert.doesNotMatch(pan, /tp-s-/);
  assert.match(text(pan), /^Team 9882K · Torque TitansAsk for a judge/);
  assert.match(pan, /<h1 class="tp-pan-sent" id="tp-st">Ask for a judge<\/h1>/);
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

test("idle: the language is a pressed-state segmented control, the note has a real label, and Request a judge is the one accent button", () => {
  const m = view();
  assert.match(m, /<span class="tp-lbl" id="tp-lang">Which language would you like to be interviewed in\?<\/span>/);
  assert.match(m, /<div class="tp-seg" role="group" aria-labelledby="tp-lang"><button type="button" aria-pressed="true">English<\/button><button type="button" aria-pressed="false">Español<\/button><\/div>/);
  assert.match(m, /<label class="tp-sr" for="tp-note">Optional note for the judges<\/label><input id="tp-note" class="tp-field" type="text" placeholder="Optional note for the judges" maxLength="280" autoComplete="off" value=""\/>/);
  assert.equal(requestButtons(m), 1);
  assert.match(m, /<button type="button" class="tp-btn">Request a judge<\/button>/);
  assert.doesNotMatch(m, /Cancel this/);
});

test("idle: only one language means no language question at all", () => {
  const m = view({ languages: [languages[0]] });
  assert.doesNotMatch(m, /Which language|tp-seg|tp-chips/);
  assert.match(m, />Request a judge<\/button>/);
});

test("idle: the buttons read 'Sending…' while a request is on its way, and are disabled", () => {
  const m = view({ busy: true });
  assert.match(m, /<button type="button" class="tp-btn" disabled="">Sending…<\/button>/);
  assert.doesNotMatch(m, />Request a judge</);
});

test("idle: booking a time is a collapsible, open to start with, over the slot grid in the team variant", () => {
  const m = view();
  assert.match(m, /<button type="button" class="tp-dsc-h" aria-expanded="true" aria-controls="tp-slots"><span>Book a time with Panel 2 instead<\/span>/);
  assert.match(m, /<div class="tp-dsc-b" id="tp-slots">/, "open: not hidden");
  assert.match(m, /<div class="tp-chips" role="group" aria-label="Interview language for the slot"><button type="button" class="tp-chip" aria-pressed="true">English<\/button><button type="button" class="tp-chip" aria-pressed="false">Español<\/button>/);
  assert.match(m, /<div class="tp-slots" role="group" aria-label="Times with Panel 2, 20 minutes each">/);
  const tiles = [...m.matchAll(/<button type="button" class="tp-slot( tp-slot--off)?"( disabled="")?[^>]*><b>([^<]*)<\/b><small>([^<]*)<\/small>/g)];
  assert.deepEqual(tiles.map((t) => t[4]), ["Taken", "Taken", "Open", "Open", "Taken", "Open", "Open"]);
  for (const t of tiles) assert.equal(Boolean(t[1]), t[4] === "Taken", "taken tiles are the dashed ones");
  for (const t of tiles.filter((t) => t[4] === "Taken")) assert.ok(t[2], "a taken slot cannot be pressed");
  for (const t of tiles.filter((t) => t[4] === "Open")) assert.ok(!t[2], "an open slot can");
  assert.equal(tiles[2][3], formatClock(slotAt(2)), "slot times come from formatClock, as the picker always had them");
  // Not the desk's picker.
  assert.doesNotMatch(m, /slots open|text-center ring-1/);
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
  assert.doesNotMatch(pan, /tp-pan-cap/, "the busy line sits under the actions here");
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

test("booked: ready early is one accent button per language, Cancel this booking is the outline one, and the slot picker is gone", () => {
  const m = view({ current: booked, requests: [...crowd, booked] });
  assert.match(m, /<h2 class="tp-h-q" id="tp-ready">Ready before your slot\?<\/h2>/);
  assert.match(m, /<div class="tp-pair" role="group" aria-labelledby="tp-lang"><button type="button" class="tp-btn">English<\/button><button type="button" class="tp-btn">Español<\/button><\/div>/);
  assert.equal(requestButtons(m), 2);
  assert.match(m, new RegExp(`Either gives up your ${formatClock(slotAt(2))} slot\\.`));
  assert.match(m, /<p class="tp-load"><span>1 in interview · 2 already waiting \(longest 6 min\)<\/span><\/p>/);
  assert.match(m, /<button type="button" class="tp-btn tp-btn--out tp-btn--fit">Cancel this booking<\/button>/);
  assert.doesNotMatch(m, /Book a time with|tp-slots|Request a judge/);
});

test("booked: with one language the single button reads 'We're ready now'", () => {
  const m = view({ current: booked, requests: [...crowd, booked], languages: [languages[0]] });
  assert.match(m, /<div class="tp-pair tp-pair--one"[^>]*><button type="button" class="tp-btn">We&#x27;re ready now<\/button><\/div>/);
  assert.doesNotMatch(m, /Which language/);
});

/* ---- a request in progress -------------------------------------------------------- */

const acknowledged = req({ status: "acknowledged", acknowledged_at: ago(1) });

test("on the way: the enroute colour, the sentence, the time since requested, the language tag; no request buttons and no cancel", () => {
  const m = view({ current: acknowledged, requests: [...crowd, acknowledged] });
  const pan = panelOf(m);
  assert.match(pan, /^<section class="tp-pan tp-s-enroute"/);
  assert.match(pan, /<p class="tp-pan-lab">Judges on their way<\/p>/);
  assert.match(pan, /<h1 class="tp-pan-sent" id="tp-st">Judges are on their way to you<\/h1>/);
  assert.match(pan, /<p class="tp-pan-time"><span>Requested<\/span><b>4 min<small>ago<\/small><\/b><\/p>/);
  assert.match(pan, /<span class="tp-ptag">English<\/span>/);
  assert.equal(requestButtons(m), 0);
  assert.doesNotMatch(m, /Request a judge|Cancel this|We&#x27;re ready|Ready before|Book a time|<input/);
});

test("on the way: Booked is 'not used', Requested is ticked with how long ago, On the way is current", () => {
  const steps = stepsOf(view({ current: acknowledged, requests: [...crowd, acknowledged] }));
  assert.deepEqual(steps.map((s) => s.state), ["skipped", "done", "current", "todo", "todo"]);
  assert.equal(steps[0].text, "Booked, not used");
  assert.equal(steps[1].text, "Requested, done4 min ago");
  assert.equal(steps[2].text, "On the way, current step");
});

test("a requested team is in the orange state and may still cancel; nobody else can", () => {
  const requested = req({ status: "requested" });
  const m = view({ current: requested, requests: [...crowd, requested] });
  assert.match(panelOf(m), /^<section class="tp-pan tp-s-waiting"/);
  assert.match(m, /<button type="button" class="tp-btn tp-btn--out tp-btn--fit">Cancel this request<\/button>/);
  assert.equal(requestButtons(m), 0);

  const interviewing = req({ status: "interviewing", started_at: ago(12) });
  const mi = view({ current: interviewing, requests: [...crowd, interviewing] });
  assert.match(panelOf(mi), /^<section class="tp-pan tp-s-active"/);
  assert.match(panelOf(mi), /<span>Started<\/span><b>12 min<small>ago<\/small><\/b>/);
  // The caps label is the short name, so the sentence is not said twice.
  assert.match(panelOf(mi), /<p class="tp-pan-lab">Interviewing<\/p><h1[^>]*>Interview in progress<\/h1>/);
  assert.equal(text(panelOf(mi)).match(/Interview in progress/g)?.length, 1);
  assert.doesNotMatch(mi, /Cancel this/);
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

/* ---- no panel, errors, offline ------------------------------------------------------ */

test("no panel: the caution line, the request button disabled, and no booking section", () => {
  const m = view({ team: loose });
  assert.match(panelOf(m), /<p class="tp-pan-foot tp-pan-foot--none">No judge panel assigned yet — check with the Judge Advisor\.<\/p>/);
  assert.match(m, /<button type="button" class="tp-btn" disabled="">Request a judge<\/button>/);
  assert.doesNotMatch(m, /Book a time with|tp-slots|1 in interview|Panel is free/);
});

test("a panel with no slots set up says so plainly, in the team variant", () => {
  const m = view({ requests: [] });
  assert.doesNotMatch(m, /tp-slots-none/);
  const empty = renderToStaticMarkup(
    <TeamView
      team={titans} panel={{ ...panel2, slot_start_at: null, slot_count: 0 }} current={null} history={[]} languages={languages}
      requests={[]} teams={[titans]} online now={NOW} busy={false} error={null} onDismissError={noop} message=""
      onMessage={noop} onReady={noop} onBook={noop} onCancel={noop}
    />,
  );
  assert.match(empty, /<p class="tp-slots-none">No times to book with Panel 2\. Ask for a judge now instead\.<\/p>/);
  assert.doesNotMatch(empty, /Judge Advisor|Admin/);
});

test("an error shows in a dismissible alert and leaves the page usable", () => {
  const m = view({ error: "That slot has already passed." });
  assert.match(m, /<div class="tp-alert" role="alert">[\s\S]*<span>That slot has already passed\.<\/span><button type="button" class="tp-alert-x" aria-label="Dismiss this message">/);
  assert.match(m, />Request a judge<\/button>/);
  assert.doesNotMatch(view(), /tp-alert/);
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

test("the public page keeps status polling and offers no request or booking actions", () => {
  assert.match(page, /normalizeTeamNumber\(decodeURIComponent\(number\)\)/);
  assert.match(page, /useAppState\(4000\)/);
  assert.match(page, /online \? "Loading…" : "Can't reach the server — retrying…"/);
  assert.match(page, /if \(!team\) return <TeamNotFound number=\{teamNumber\} \/>/);
  assert.match(page, /STATUS_META\[current\.status\]\.teamLabel/);
  assert.match(page, /trackSteps\(current\)/);
  assert.match(page, /Please ask the queue desk/);
  assert.doesNotMatch(page, /\/api\/requests|onReady|onBook|onCancel/);
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

test("every control in the view is a real button, link or input", () => {
  const view = noComments(read("src/components/team/TeamView.tsx"));
  assert.doesNotMatch(view, /role="button"|<div[^>]*onClick|<span[^>]*onClick/);
  assert.equal([...view.matchAll(/<button /g)].length, [...view.matchAll(/<button [^>]*type="button"/g)].length, "every button says type=\"button\"");
});
