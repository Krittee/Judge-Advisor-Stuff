import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { CoordinatorView, type CoordinatorViewProps } from "../src/components/coordinator/CoordinatorView";
import { withPending } from "../src/components/coordinator/coordinatorLogic";
import { slotTime } from "../src/components/desk/deskLogic";
import type { PublicPanel, RequestRow, Team } from "../src/lib/types";

/* The coordinator console, rendered to markup. What needs a browser (a tap, the
   URL changing) has no DOM harness here: the decisions behind it run as plain
   functions in coordinatorLogic.test.ts and the page's wiring is read from
   source at the foot. */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
const noop = () => {};
// Sign out reads the app router, which only exists inside Next; a stub is enough to draw it.
const router = {} as React.ContextType<typeof AppRouterContext>;

const BASE = Date.parse("2099-01-01T10:00:00.000Z");
const slotAt = (n: number) => new Date(BASE + n * 20 * 60_000).toISOString();
const NOW = BASE + 30 * 60_000; // Panel 3's first slot is over

const languages = [
  { id: "en", label: "English", short: "EN" },
  { id: "th", label: "Thai", short: "TH" },
];

const team = (number: string, name: string, over: Partial<Team> = {}): Team =>
  ({ id: `t-${number}`, number, name, panel_id: "p3", division: "Middle School", category: "developing", pit: "A3", languages: ["th"], created_at: "", ...over }) as Team;
const gremlins = team("2011A", "Gear Gremlins", { pit: "A3", languages: ["en", "th"] });
const breakers = team("1234A", "Circuit Breakers", { pit: "A6", languages: ["th"] });
const rangers = team("4410C", "Robo Rangers", { pit: "A9" });
const titans = team("9882K", "Torque Titans", { pit: "B4", languages: ["en"] });
const byte = team("7700B", "Byte Me", { pit: "C2" });
const sparky = team("5150Z", "Sparky", { pit: "C7", languages: [] });
const bolt = team("8123N", "Bolt Brigade", { pit: "D1", panel_id: null });
const high = team("5555H", "High Fives", { pit: "D2" });
const teams = [gremlins, breakers, rangers, titans, byte, sparky, bolt, high];

const panel = (n: number, over: Partial<PublicPanel> = {}): PublicPanel => ({
  id: `p${n}`, name: `Panel ${n}`, division: "Middle School", judges: [], languages: ["th"], sort_order: n,
  slot_start_at: slotAt(0), slot_minutes: 20, slot_count: 8, ...over,
});
const panels = [panel(1, { languages: ["en"] }), panel(2, { languages: ["en", "th"] }), panel(3), panel(4, { slot_start_at: null, slot_count: 0 })];

const req = (who: Team, status: RequestRow["status"], over: Partial<RequestRow> = {}): RequestRow =>
  ({ id: `r-${who.number}`, team_id: who.id, panel_id: who.panel_id, status, kind: "queue", language: "th", slot_start: null, slot_end: null,
    message: null, created_by: null, acknowledged_by: null, interviewer: null, outcome: null,
    requested_at: "", acknowledged_at: null, started_at: null, finished_at: null, cancelled_at: null, updated_at: "", ...over }) as RequestRow;
const slotReq = (who: Team, n: number) => req(who, "scheduled", { kind: "slot", slot_start: slotAt(n), slot_end: slotAt(n + 1) });
const requests = [
  req(gremlins, "interviewing"),
  req(breakers, "completed", { finished_at: slotAt(0) }),
  req(rangers, "requested"),
  slotReq(high, 3),
];

function view(over: Partial<CoordinatorViewProps> = {}) {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <CoordinatorView
        name="Pat"
        online
        teams={teams}
        panels={panels}
        requests={requests}
        languages={languages}
        divisions={["Elementary School", "Middle School", "High School", "Blended"]}
        tab="teams"
        onTab={noop}
        query=""
        onQuery={noop}
        division=""
        onDivision={noop}
        notAskedOnly={false}
        onNotAskedOnly={noop}
        openId={null}
        onOpen={noop}
        onLanguages={noop}
        onRequest={noop}
        onBookTime={noop}
        chosenId={null}
        panelPick={null}
        onPanelPick={noop}
        picked={null}
        onPick={noop}
        onBook={noop}
        busy={false}
        error={null}
        ok={null}
        now={NOW}
        {...over}
      />
    </AppRouterContext.Provider>,
  );
}

const buttons = (m: string) => [...m.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((x) => ({ attrs: x[1], text: text(x[2]), disabled: /disabled=""/.test(x[1]) }));
const labelled = (m: string, re: RegExp) => buttons(m).filter((b) => re.test(b.text));
/** One team's `<li>`. */
const rowOf = (m: string, number: string) => {
  const li = m.split('<li class="co-card"').slice(1).find((x) => x.includes(`<b>${number}</b>`)) ?? assert.fail(`no row for ${number}`);
  return `<li class="co-card"${li.slice(0, li.indexOf("</li>"))}`;
};

/* ---- chrome ------------------------------------------------------------------------- */

test("the chrome: the coordinator's picture, Coordinator and the name, Live, Sign out, two tabs", () => {
  const m = view();
  assert.match(m, /<span class="co-av"><img src="\/avatars\/coordinator\.jpg" alt="" width="28" height="28"\/><\/span>/);
  assert.match(m, /<b>Coordinator<\/b><span>Pat<\/span>/);
  assert.match(m, /<span class="co-live" data-online="true"><i aria-hidden="true"><\/i>Live<\/span>/);
  assert.match(view({ online: false }), />Reconnecting</);
  assert.match(m, /Sign out/);
  assert.match(m, /<nav class="co-tabs" aria-label="Coordinator sections">/);
  assert.deepEqual(labelled(m, /^(Teams|Slots)$/).map((b) => b.text), ["Teams", "Slots"]);
});

test("the tab bar marks the current tab with aria-current, and only that one", () => {
  const nav = (m: string) => m.match(/<nav class="co-tabs"[\s\S]*?<\/nav>/)![0];
  const teamsTab = buttons(nav(view({ tab: "teams" })));
  assert.deepEqual(teamsTab.map((b) => /aria-current="page"/.test(b.attrs)), [true, false]);
  const slotsTab = buttons(nav(view({ tab: "slots" })));
  assert.deepEqual(slotsTab.map((b) => /aria-current="page"/.test(b.attrs)), [false, true]);
});

test("the desk's error and success banners, in the desk's words", () => {
  assert.doesNotMatch(view(), /dk-msg/);
  assert.match(view({ error: "Already booked — the queue desk can change it." }), /<p class="dk-msg dk-msg--err" role="alert">Already booked — the queue desk can change it\.<\/p>/);
  assert.match(view({ ok: "Team 7700B added to the queue." }), /<p class="dk-msg" role="status">Team 7700B added to the queue\.<\/p>/);
});

/* ---- Teams ------------------------------------------------------------------------------ */

test("the filters: a search box, a division select, and Not asked with its count", () => {
  const m = view();
  assert.match(m, /<label class="sr-only" for="co-q">Find a team by number or name<\/label>/);
  assert.match(m, /placeholder="Team number or name"/);
  assert.match(m, /<label class="sr-only" for="co-div">Division<\/label>/);
  assert.deepEqual([...m.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g)].map((x) => x[2]), ["All divisions", "ES", "MS", "HS", "BLN"]);
  assert.match(m, /<button type="button" class="co-tgl" aria-pressed="false">Not asked <b>1<\/b><\/button>/);
  assert.match(view({ notAskedOnly: true }), /class="co-tgl" aria-pressed="true"/);
  assert.match(text(m), /8 teams · 7 asked · 1 not asked yet/);
});

test("rows run in pit order and each has number, name, division, pit and a pill", () => {
  const m = view();
  const numbers = [...m.matchAll(/<li class="co-card"[^>]*>[\s\S]*?<b>([^<]+)<\/b>/g)].map((x) => x[1]);
  assert.deepEqual(numbers, ["2011A", "1234A", "4410C", "9882K", "7700B", "5150Z", "8123N", "5555H"]);
  assert.match(text(rowOf(m, "2011A")), /^2011AGear GremlinsMS · Pit A3Interviewing/);
  assert.match(rowOf(m, "2011A"), /class="co-sc co-s-active">Interviewing</);
  assert.match(rowOf(m, "1234A"), /class="co-sc co-s-done">Complete</);
  assert.match(rowOf(m, "4410C"), /class="co-sc co-s-waiting">Requesting</);
  assert.match(rowOf(m, "5555H"), new RegExp(`class="co-sc co-s-booked">Booked ${slotTime(slotAt(3))}<`));
  assert.doesNotMatch(rowOf(m, "7700B"), /co-sc/, "no request, no pill");
});

test("the language chips: EN and TH, lit by what the team has, in a labelled group", () => {
  const m = view();
  const pressed = (number: string) => buttons(rowOf(m, number)).filter((b) => /co-chip/.test(b.attrs)).map((b) => [b.text.replace(/^(EN|TH)/, ""), /aria-pressed="true"/.test(b.attrs)]);
  assert.deepEqual(pressed("2011A"), [["English", true], ["Thai", true]], "both lit = both");
  assert.deepEqual(pressed("1234A"), [["English", false], ["Thai", true]]);
  assert.deepEqual(pressed("9882K"), [["English", true], ["Thai", false]]);
  assert.match(rowOf(m, "2011A"), /role="group" aria-label="Interview language for 2011A"/);
  assert.match(rowOf(m, "2011A"), /<span aria-hidden="true">EN<\/span><span class="sr-only">English<\/span>/);
});

test("not asked: dashed chips, a muted Ask, and a group label that says so", () => {
  const m = view();
  assert.match(rowOf(m, "5150Z"), /class="co-chips none" role="group" aria-label="Interview language for 5150Z, not asked yet"/);
  assert.match(rowOf(m, "5150Z"), /<span class="co-ask">Ask<\/span>/);
  assert.match(rowOf(m, "2011A"), /<span class="co-ask"><\/span>/);
  assert.doesNotMatch(rowOf(m, "2011A"), /chips none/);
});

test("a chip tapped but not yet saved is lit at once, and goes back with the entry", () => {
  const lit = (ts: Team[]) => buttons(rowOf(view({ teams: ts }), "5150Z")).filter((b) => /co-chip/.test(b.attrs)).map((b) => /aria-pressed="true"/.test(b.attrs));
  assert.deepEqual(lit(teams), [false, false]);
  assert.deepEqual(lit(withPending(teams, { [sparky.id]: ["th"] })), [false, true], "optimistic");
  assert.deepEqual(lit(withPending(teams, {})), [false, false], "reverted");
  assert.match(rowOf(view({ teams: withPending(teams, { [sparky.id]: ["th"] }) }), "5150Z"), /aria-label="Interview language for 5150Z"/, "no longer 'not asked'");
  assert.match(text(view({ teams: withPending(teams, { [sparky.id]: ["th"] }) })), /8 teams · 8 asked · 0 not asked yet/);
});

test("the Not asked toggle leaves only teams with no language", () => {
  const m = view({ notAskedOnly: true });
  assert.deepEqual([...m.matchAll(/<li class="co-card"[^>]*>[\s\S]*?<b>([^<]+)<\/b>/g)].map((x) => x[1]), ["5150Z"]);
  assert.match(view({ notAskedOnly: true, teams: teams.map((t) => ({ ...t, languages: ["en"] })) }), /Every team has a language\./);
  assert.match(view({ query: "ZZZ" }), /No team matches ZZZ\./);
});

test("a row is closed until opened, and only the one asked for is open", () => {
  const closed = view();
  assert.doesNotMatch(closed, /co-xp|Request ·/);
  assert.match(rowOf(closed, "7700B"), /aria-expanded="false" aria-controls="co-x-t-7700B"/);
  const open = view({ openId: byte.id });
  assert.equal(open.split('class="co-xp"').length - 1, 1);
  assert.match(rowOf(open, "7700B"), /aria-expanded="true"/);
  assert.match(rowOf(open, "7700B"), /role="group" aria-label="Actions for 7700B"/);
  assert.match(rowOf(open, "7700B"), /data-open="true"/);
  assert.doesNotMatch(rowOf(open, "2011A"), /co-xp/);
});

test("an opened ready row: the team's language is the filled button, the other outlined, then the panel line and Book a time", () => {
  const m = rowOf(view({ openId: byte.id }), "7700B");
  const xp = m.slice(m.indexOf('class="co-xp"'));
  assert.deepEqual(
    buttons(xp).map((b) => [b.text, /co-prim/.test(b.attrs) ? "primary" : /co-out/.test(b.attrs) ? "outlined" : "text", b.disabled]),
    [["Request · Thai", "primary", false], ["Request · English", "outlined", false], ["Book a time", "text", false]],
  );
  assert.match(text(xp), /Panel 3 interviews in Thai/);

  const both = team("3333B", "Both Tongues", { languages: ["en", "th"] });
  const bothTongues = rowOf(view({ openId: both.id, teams: [...teams, both] }), "3333B");
  assert.deepEqual(
    buttons(bothTongues.slice(bothTongues.indexOf('class="co-xp"'))).filter((b) => /^Request/.test(b.text)).map((b) => [b.text, /co-prim/.test(b.attrs)]),
    [["Request · English", true], ["Request · Thai", true]],
    "a team with both gets equal buttons, as on the desk",
  );
});

test("an opened row with no language: the buttons are off and say what to do first", () => {
  const xp = rowOf(view({ openId: sparky.id }), "5150Z");
  const actions = buttons(xp.slice(xp.indexOf('class="co-xp"')));
  assert.ok(actions.length >= 3 && actions.every((b) => b.disabled), "Request x2 and Book a time are all off");
  assert.match(text(xp), /Set the language first/);
});

test("an opened row with no panel: the buttons are off and the Judge Advisor is named", () => {
  const xp = rowOf(view({ openId: bolt.id }), "8123N");
  assert.ok(buttons(xp.slice(xp.indexOf('class="co-xp"'))).every((b) => b.disabled));
  assert.match(text(xp), /No panel yet — the Judge Advisor assigns one\./);
});

test("an opened row that is waiting, on the way, interviewing or booked: no buttons, the pill and 'ask the queue desk'", () => {
  for (const [who, pill] of [[rangers, "Requesting"], [gremlins, "Interviewing"], [high, `Booked ${slotTime(slotAt(3))}`]] as const) {
    const m = rowOf(view({ openId: who.id }), who.number);
    const xp = m.slice(m.indexOf('class="co-xp"'));
    assert.equal(buttons(xp).length, 0, `${who.number}: no buttons at all`);
    assert.match(xp, new RegExp(`<p class="co-held"><span class="co-sc [^"]*">${pill}</span><span>To change it, ask the queue desk\\.</span></p>`));
  }
});

test("a team whose interview is done is not held: it can be asked for again", () => {
  const xp = rowOf(view({ openId: breakers.id }), "1234A");
  assert.deepEqual(labelled(xp, /^Request/).map((b) => b.disabled), [false, false]);
});

test("busy turns the request buttons off", () => {
  const xp = rowOf(view({ openId: byte.id, busy: true }), "7700B");
  assert.deepEqual(labelled(xp, /^Request/).map((b) => b.disabled), [true, true]);
});

/* ---- Slots ------------------------------------------------------------------------------- */

const slots = (over: Partial<CoordinatorViewProps> = {}) => view({ tab: "slots", ...over });
const slotRows = (m: string) => [...m.matchAll(/<li class="co-srow"[^>]*>([\s\S]*?)<\/li>/g)].map((x) => x[1]);
const bookButtons = (m: string) => labelled(m, /^(Book|Picked)$/);

test("the panel switcher, defaulting to the first panel and following the chosen team's", () => {
  const first = slots();
  assert.match(first, /<div class="co-pcs" role="group" aria-label="Panel">/);
  assert.deepEqual(labelled(first, /^Panel \d$/).map((b) => [b.text, /aria-pressed="true"/.test(b.attrs)]), [["Panel 1", true], ["Panel 2", false], ["Panel 3", false], ["Panel 4", false]]);
  assert.deepEqual(labelled(slots({ chosenId: byte.id }), /^Panel \d$/).map((b) => /aria-pressed="true"/.test(b.attrs)), [false, false, true, false]);
  assert.deepEqual(labelled(slots({ chosenId: byte.id, panelPick: "p2" }), /^Panel \d$/).map((b) => /aria-pressed="true"/.test(b.attrs)), [false, true, false, false], "a tapped chip wins");
});

test("the panel's header: name and division, its language tags, and how many are open", () => {
  const m = slots({ chosenId: byte.id });
  assert.match(text(m.match(/<div class="co-gh">[\s\S]*?<\/div>/)![0]), /^Panel 3 · MSTH6 of 7 open$/, "slot 0 is over and one is booked: 6 of the 7 still to come are open");
  assert.match(m, /aria-label="Panel 3 time slots, 20 minutes each"/);
});

test("past slots are left out; a taken slot reads the team and its status, read-only", () => {
  const rows = slotRows(slots({ chosenId: byte.id }));
  assert.equal(rows.length, 7, "8 slots less the one that is over");
  assert.ok(!rows.some((r) => text(r).startsWith(slotTime(slotAt(0)))), "10:00 is not drawn");
  const taken = rows.find((r) => r.includes("<b>5555H</b>"))!;
  assert.match(text(taken), new RegExp(`^${slotTime(slotAt(3))}5555HHigh FivesBooked$`));
  assert.match(taken, /co-sc co-s-booked/);
  assert.equal(buttons(taken).length, 0, "no Book, no cancel, no move");
});

test("Book is live on the chosen team's own panel, off on another, and off with nobody chosen", () => {
  assert.deepEqual(bookButtons(slots({ chosenId: byte.id })).map((b) => b.disabled), [false, false, false, false, false, false], "6 open slots, all live");
  assert.ok(bookButtons(slots({ chosenId: byte.id, panelPick: "p2" })).every((b) => b.disabled), "Panel 2 is not Byte Me's");
  assert.ok(bookButtons(slots()).length > 0 && bookButtons(slots()).every((b) => b.disabled), "nobody chosen");
  assert.ok(bookButtons(slots({ chosenId: sparky.id, panelPick: "p3" })).every((b) => b.disabled), "a team with no language cannot be booked");
});

test("picking a slot lights it: accent border, a filled Picked", () => {
  const m = slots({ chosenId: byte.id, picked: slotAt(4) });
  const picked = slotRows(m).find((r) => /aria-pressed="true"/.test(r))!;
  assert.match(m, /<li class="co-srow" data-picked="true">/);
  assert.match(text(picked), new RegExp(`^${slotTime(slotAt(4))}OpenPicked$`));
  assert.equal(slotRows(m).filter((r) => /aria-pressed="true"/.test(r)).length, 1);
  assert.match(picked, new RegExp(`aria-label="Book ${slotTime(slotAt(4)).replace(".", "\\.")}"`));
});

test("the pinned bar with a team: who, their language, the panel line, and Book with the picked time", () => {
  const m = slots({ chosenId: byte.id, picked: slotAt(4) });
  const bar = m.match(/<div class="co-pinb"[\s\S]*?<\/div><button[\s\S]*?<\/button><\/div>/)![0];
  assert.match(bar, /role="group" aria-label="Booking"/);
  assert.match(text(bar), new RegExp(`^Booking for7700BTHPanel 3 interviews in ThaiBook ${slotTime(slotAt(4))}$`));
  assert.deepEqual(buttons(bar).map((b) => b.disabled), [false]);
});

test("the pinned bar with a team and no pick: Book waits for a time", () => {
  const bar = slots({ chosenId: byte.id }).match(/<div class="co-pinb"[\s\S]*?<\/button><\/div>/)![0];
  assert.deepEqual(buttons(bar).map((b) => [b.text, b.disabled]), [["Book · pick a time", true]]);
});

test("the pinned bar with nobody chosen says where to choose, and Book is off", () => {
  const bar = slots().match(/<div class="co-pinb"[\s\S]*?<\/button><\/div>/)![0];
  assert.match(text(bar), /^Choose a team on the Teams tabBook$/);
  assert.deepEqual(buttons(bar).map((b) => b.disabled), [true]);
});

test("the pinned bar for a team that cannot be booked says why", () => {
  assert.match(text(slots({ chosenId: sparky.id })), /Booking for5150ZSet the language first/);
  assert.match(text(slots({ chosenId: high.id })), /Booking for5555HAlready booked — the queue desk can change it\./);
  assert.match(text(slots({ chosenId: bolt.id })), /Booking for8123NNo panel yet — the Judge Advisor assigns one\./);
});

test("a language the panel does not cover is flagged in the bar, not blocked", () => {
  const bar = slots({ chosenId: titans.id, panelPick: "p3", picked: slotAt(4) }).match(/<div class="co-pinb"[\s\S]*?<\/button><\/div>/)![0];
  assert.match(text(bar), /Panel 3 interviews in Thai — this team asked for English/);
  assert.deepEqual(buttons(bar).map((b) => b.disabled), [false]);
});

test("a panel with no times, or none left, says so instead of an empty list", () => {
  const none = slots({ panelPick: "p4" });
  assert.match(text(none), /Panel 4 has no bookable times set up yet\./);
  assert.equal(slotRows(none).length, 0);
  const over = slots({ now: BASE + 99 * 20 * 60_000 });
  assert.match(text(over), /No slots left today — the rest have already passed/);
  assert.equal(slotRows(over).length, 0);
});

/* ---- what a coordinator cannot reach --------------------------------------------------------- */

test("no cancel, undo, reschedule, move, note, score or message control on either tab, open or not", () => {
  const forbidden = /cancel|undo|reschedule|move|note|score|message|advance|acknowledge|finish/i;
  for (const m of [view(), view({ openId: byte.id }), view({ openId: rangers.id }), slots(), slots({ chosenId: byte.id, picked: slotAt(4) })]) {
    assert.deepEqual(buttons(m).filter((b) => forbidden.test(b.text)), []);
    assert.doesNotMatch(m, /<textarea|maxLength|maxlength|placeholder="[^"]*(note|message)/i);
    assert.equal((m.match(/<input/g) ?? []).length, m.includes('id="co-q"') ? 1 : 0, "the search box is the only text field");
  }
});

/* ---- the wiring, read from source ------------------------------------------------------------------ */

test("the page makes the three writes the coordinator may and no others", () => {
  const page = read("src/app/coordinator/page.tsx");
  const urls = [...page.matchAll(/call(?:<[^>]*>)?\(\s*"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(urls, ["/api/requests", "/api/session", "/api/team-language"]);
  assert.match(page, /"\/api\/team-language", \{ method: "PATCH"/);
  assert.match(page, /kind: "queue", language \}/);
  assert.match(page, /kind: "slot", language, slotStart: slot\.start, slotEnd: slot\.end/);
  assert.doesNotMatch(page, /message\s*:|\/api\/requests\//, "no message field, no per-request write");
  for (const f of ["CoordinatorView", "TeamsTab", "SlotsTab"]) {
    assert.doesNotMatch(read(`src/components/coordinator/${f}.tsx`), /\bcall\(|fetch\(/, `${f} draws; the page writes`);
  }
});

test("the tab is in the URL, read with useSearchParams under Suspense and written with router.replace", () => {
  const page = read("src/app/coordinator/page.tsx");
  assert.match(page, /useSearchParams\(\)/);
  assert.match(page, /tabFrom\(params\.get\("tab"\)\)/);
  assert.match(page, /router\.replace\(tabHref\(next\)\)/);
  assert.match(page, /<Suspense[\s\S]*<Coordinator \/>[\s\S]*<\/Suspense>/);
  assert.match(page, /const bookTime[\s\S]*|function bookTime[\s\S]*goTab\("slots"\)/, "Book a time goes to Slots");
});

test("a tab change scrolls the body back to the top, with no motion", () => {
  const source = read("src/components/coordinator/CoordinatorView.tsx");
  assert.match(source, /<main className="co-body" ref=\{body\}>/);
  assert.match(source, /const body = useRef<HTMLElement>\(null\);/);
  assert.match(source, /useEffect\(\(\) => \{\s*if \(body\.current\) body\.current\.scrollTop = 0;\s*\}, \[p\.tab\]\);/);
  assert.doesNotMatch(source, /scrollTo\(|behavior/);
});

test("who may open it: nobody goes to the coordinator door, the Judge Advisor stays, the rest go home", () => {
  const page = read("src/app/coordinator/page.tsx");
  assert.match(page, /router\.replace\("\/coordinator\/login"\)/);
  assert.match(page, /session\.role !== "coordinator" && session\.role !== "admin"/);
  assert.match(page, /router\.replace\(homeFor\(session\.role\)\)/);
  assert.match(read("src/components/SignInForm.tsx"), /export function homeFor/);
  assert.match(read("src/components/coordinator/CoordinatorView.tsx"), /<SignOutButton to="\/coordinator\/login" \/>/);
});

test("a coordinator who opens the desk is sent to their console", () => {
  assert.match(read("src/app/queue/page.tsx"), /session\.role === "coordinator"\) \{\s*router\.replace\("\/coordinator"\);\s*return;/);
});

test("the CSS: the console's tokens in both themes, the avatar ringed in --co-ring, no motion", () => {
  const css = read("src/app/globals.css");
  const start = css.indexOf("Coordinator console (");
  const block = css.slice(css.lastIndexOf("/* ----", start), css.lastIndexOf("/* ----", css.indexOf('Queue desk ("Now / Book"')));
  assert.ok(block.length > 3000, "the block was found");
  assert.match(block, /\.co-av img \{[^}]*box-shadow: 0 0 0 2px var\(--co-ring\)/);
  assert.doesNotMatch(block, /--rail/);
  assert.match(block, /\.co-pc \{[\s\S]*?height: 44px/);
  assert.match(block, /\.co-chip \{[\s\S]*?width: 46px; height: 44px/);
  assert.match(block, /\.co-tabs button \{[\s\S]*?min-height: 64px/);
  assert.doesNotMatch(block.replace(/\/\*[\s\S]*?\*\//g, ""), /@keyframes|animation|transition|(?<!over)scroll-behavior/);
  // The pills wear the desk's pairs; the desk's own test measures them.
  const desk = css.match(/:root\[data-theme="light"\] \.desk \{[\s\S]*?--dk-booked-ink: ([^;]+);/)![1];
  assert.match(block, new RegExp(`:root\\[data-theme="light"\\] \\.co \\{[\\s\\S]*?--co-booked-ink: ${desk.replace(/[().]/g, "\\$&")};`));
  for (const tone of ["booked", "waiting", "enroute", "active", "done"]) assert.ok(block.includes(`.co .co-s-${tone} {`), tone);
});

test("every page a person opens is covered by the browser checks list", () => {
  assert.match(read("tests/mobile.test.mjs"), /"\/coordinator",/);
});
