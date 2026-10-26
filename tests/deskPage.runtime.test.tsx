import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { DeskSlots } from "../src/components/desk/DeskSlots";
import { DeskView, type DeskViewProps } from "../src/components/desk/DeskView";
import { slotTime } from "../src/components/desk/deskLogic";
import { noSlotsLeftLine } from "../src/components/SlotPicker";
import { formatClock } from "../src/components/ui";
import { buildSlots } from "../src/lib/data";
import type { PublicPanel, RequestRow, Team } from "../src/lib/types";

/* The queue desk, rendered to markup. What needs a browser (a tap, the
   confirm dialog opening) has no DOM harness here: the decision behind
   Cancel booking runs as a function in deskLogic.test.ts and the page's
   wiring is read from source at the foot. */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
const noop = () => {};
// Sign out reads the app router, which only exists inside Next; a stub is enough to draw it.
const router = {} as React.ContextType<typeof AppRouterContext>;

const BASE = Date.parse("2099-01-01T10:00:00.000Z");
const slotAt = (n: number) => new Date(BASE + n * 20 * 60_000).toISOString();
const NOW = Date.now();

const languages = [
  { id: "en", label: "English", short: "EN" },
  { id: "th", label: "ไทย", short: "ไทย" },
];
const categories = [{ id: "developing", label: "Developing", color: "sky" }] as DeskViewProps["categories"];

const team = (number: string, name: string, panel_id: string | null = "p2"): Team =>
  ({ id: `t-${number}`, number, name, panel_id, division: "Middle School", category: "developing", pit: "22", created_at: "" }) as Team;
const byte = team("7700B", "Byte Me");
const robo = team("4410C", "Robo Rangers");
const titans = team("9882K", "Torque Titans");
const bolt = team("8123N", "Bolt Brigade", null);
const high = team("5555H", "High Fives");
const teams = [byte, robo, titans, bolt, high];

const panel2: PublicPanel = {
  id: "p2", name: "Panel 2", division: "Middle School", judges: [], languages: ["en", "th"], sort_order: 2,
  slot_start_at: slotAt(0), slot_minutes: 20, slot_count: 7,
};

const req = (over: Partial<RequestRow>): RequestRow => ({
  id: "r1", team_id: titans.id, panel_id: "p2", status: "requested", kind: "queue", language: "en", slot_start: null, slot_end: null,
  message: null, created_by: null, acknowledged_by: null, interviewer: null, outcome: null,
  requested_at: new Date(NOW - 6 * 60_000).toISOString(), acknowledged_at: null, started_at: null, finished_at: null, cancelled_at: null,
  updated_at: "", ...over,
});
const slotReq = (id: string, who: Team, n: number, panel_id = "p2"): RequestRow =>
  req({ id, team_id: who.id, panel_id, status: "scheduled", kind: "slot", slot_start: slotAt(n), slot_end: slotAt(n + 1) });

const roboBooking = slotReq("b-robo", robo, 2);
const requests = [req({}), slotReq("b-robo", robo, 2), slotReq("b-high", high, 4)];

function view(over: Partial<DeskViewProps> = {}) {
  const number = over.number ?? "7700B";
  const found = teams.find((t) => t.number === number) ?? null;
  const panel = found?.panel_id ? panel2 : null;
  const existing = found ? (requests.find((r) => r.team_id === found.id && r.status !== "cancelled") ?? null) : null;
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <DeskView
        name="Mei Tan"
        online
        teams={teams}
        panels={[panel2]}
        requests={requests}
        languages={languages}
        categories={categories}
        mode="now"
        onMode={noop}
        number={number}
        onNumber={noop}
        team={found}
        panel={panel}
        existing={existing}
        message=""
        onMessage={noop}
        bookLanguage="en"
        onBookLanguage={noop}
        reschedule={null}
        picked={null}
        onPick={noop}
        busy={false}
        error={null}
        ok={null}
        now={NOW}
        onRequest={noop}
        onUndo={noop}
        onBook={noop}
        onMove={noop}
        onStartReschedule={noop}
        onStopReschedule={noop}
        onCancelBooking={noop}
        {...over}
      />
    </AppRouterContext.Provider>,
  );
}

const buttons = (m: string) => [...m.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((x) => ({ attrs: x[1], text: text(x[2]), disabled: /disabled=""/.test(x[1]) }));
const labelled = (m: string, re: RegExp) => buttons(m).filter((b) => re.test(b.text));
/** The pinned primary button, not the Book half of the Now | Book control. */
const primary = (m: string, re: RegExp) => buttons(m).filter((b) => b.attrs.includes("dk-prim") && re.test(b.text));

/* ---- chrome ------------------------------------------------------------------------- */

test("the chrome: avatar, Queue desk and the desk person's name, Live, Sign out, and a Now | Book control", () => {
  const m = view();
  assert.match(m, /<img src="\/avatars\/queue-desk\.jpg" alt="" width="28" height="28"\/>/);
  assert.match(m, /<b>Queue desk<\/b><span>Mei Tan<\/span>/);
  assert.match(m, /<span class="dk-live" data-online="true"><i aria-hidden="true"><\/i>Live<\/span>/);
  assert.match(view({ online: false }), />Reconnecting</);
  assert.match(m, /Sign out/);
  assert.match(m, /<div class="dk-seg" role="group" aria-label="Request type"><button type="button" aria-pressed="true">Now<\/button><button type="button" aria-pressed="false">Book<\/button><\/div>/);
  assert.match(view({ mode: "book" }), /aria-pressed="false">Now<\/button><button type="button" aria-pressed="true">Book/);
  assert.doesNotMatch(m, /rf-strip|<nav/, "no referee stripe and no bottom tab bar");
});

test("the lookup line: name, category, pit, then panel, division, how busy and the next free time", () => {
  const m = view();
  const line = text(m.match(/<p class="dk-tline">[\s\S]*?<\/p>/)![0]);
  const free = formatClock(buildSlots(panel2, requests, teams).find((s) => !s.takenBy && !s.blocked)!.start);
  assert.equal(line, `Byte Me · Developing · Pit 22Panel 2 · Middle School · 1 waiting · next free ${free}`);
});

/* ---- Now ------------------------------------------------------------------------------ */

test("Now shows one Request button per interview language, enabled for a team with a panel", () => {
  const m = view();
  const req = labelled(m, /^Request ·/);
  assert.deepEqual(req.map((b) => [b.text, b.disabled]), [["Request · English", false], ["Request · ไทย", false]]);
  assert.match(m, /<label class="sr-only" for="dk-note">Note for the judges, optional<\/label>/);
  assert.match(m, /placeholder="Optional note for the judges"/);
  assert.match(m, /Panel 2 interviews in English, ไทย/);
});

test("Now lists who is waiting, with Undo only on a request judges have not acknowledged", () => {
  const m = view({
    requests: [req({}), req({ id: "r2", team_id: byte.id, status: "acknowledged", requested_at: new Date(NOW - 3 * 60_000).toISOString() })],
  });
  assert.match(m, /Waiting now · 2/);
  assert.match(m, /<li class="dk-qrow dk-qw">/);
  assert.match(m, /<span class="dk-sc dk-s-waiting">Requesting a judge<\/span>/);
  assert.match(m, /<span class="dk-sc dk-s-enroute">Judges on their way<\/span>/);
  assert.deepEqual(labelled(m, /^Undo$/).map((b) => b.attrs.includes('aria-label="Undo request for 9882K"')), [true]);
  assert.doesNotMatch(m, /Booked later/);
});

test("with nothing typed the buttons are there but off; a number that is not on the roster gets only the error", () => {
  const empty = view({ number: "" });
  assert.deepEqual(labelled(empty, /^Request ·/).map((b) => b.disabled), [true, true]);
  assert.doesNotMatch(empty, /No team|dk-err/, "nothing is said while the box is empty");

  const nope = view({ number: "0420Z" });
  assert.match(nope, /class="dk-input dk-big dk-err"/);
  assert.match(nope, /aria-invalid="true" aria-describedby="dk-nf"/);
  assert.match(nope, /<p class="dk-errln" id="dk-nf">[\s\S]*<span>No team 0420Z at this event\.<\/span><\/p>/);
  assert.equal(labelled(nope, /Request/).length, 0, "no buttons");
  assert.doesNotMatch(view({ number: "770" }), /No team/, "still being typed");
});

test("busy turns every Request button off", () => {
  assert.deepEqual(labelled(view({ busy: true }), /^Request ·/).map((b) => b.disabled), [true, true]);
});

test("the ok and error lines keep their words", () => {
  assert.match(view({ ok: "Team 7700B added to the queue." }), /<p class="dk-msg" role="status">Team 7700B added to the queue\.<\/p>/);
  assert.match(view({ error: "That slot was just taken." }), /<p class="dk-msg dk-msg--err" role="alert">That slot was just taken\.<\/p>/);
});

/* ---- the lookup's other states ----------------------------------------------------------- */

test("already waiting: a status chip with the wait, the caution, no Request buttons, and Undo while requested", () => {
  const m = view({ number: "9882K" });
  assert.match(m, /<span class="dk-sc dk-s-waiting">Requesting a judge ·\u00a0<span[^>]*>[^<]*<\/span><\/span>/);
  assert.match(m, /Already in the queue\. A team can&#x27;t be added twice\./);
  assert.equal(labelled(m, /^Request/).length, 0);
  assert.equal(labelled(m, /^Undo request$/).length, 1);
  assert.match(m, /Only before judges acknowledge/);

  const acked = view({ number: "9882K", existing: req({ status: "acknowledged" }) });
  assert.equal(labelled(acked, /^Undo request$/).length, 0, "too late to undo");
  assert.doesNotMatch(acked, /Only before judges/);
  assert.match(acked, /dk-s-enroute/);
});

test("already booked with one language: Reschedule and Request now instead, and what it frees", () => {
  const m = view({ number: "4410C", languages: [languages[0]] });
  assert.match(m, new RegExp(`Booked for ${formatClock(slotAt(2))} on Panel 2\\.`));
  assert.deepEqual(buttons(m).filter((b) => /^(Reschedule|Request now instead)$/.test(b.text)).map((b) => b.text), ["Reschedule", "Request now instead"]);
  assert.match(text(m), new RegExp(`Requesting now frees their ${formatClock(slotAt(2))} slot\\.`));
  assert.match(m, /dk-out[^>]*>Reschedule/);
});

test("already booked with more than one language: Request now instead becomes a pair, none chosen", () => {
  const m = view({ number: "4410C" });
  assert.equal(labelled(m, /Request now instead/).length, 0);
  assert.deepEqual(labelled(m, /^Now ·/).map((b) => [b.text, b.disabled]), [["Now · English", false], ["Now · ไทย", false]]);
  assert.equal(labelled(m, /^Reschedule$/).length, 1);
  assert.doesNotMatch(m, /aria-pressed="true">Now ·/);
  assert.match(text(m), /Requesting now frees their/);
});

test("no panel yet: the caution, and Request buttons that are shown disabled", () => {
  const m = view({ number: "8123N" });
  assert.match(m, /No judge panel assigned yet\. Ask the Judge Advisor\./);
  assert.deepEqual(labelled(m, /^Request ·/).map((b) => b.disabled), [true, true]);
  assert.doesNotMatch(m, /Panel \d · /, "no panel line under the name");
});

/* ---- Book ---------------------------------------------------------------------------------- */

test("Book: language and note side by side, the panel's grid inline, and a Book button off until a slot is picked", () => {
  const open = slotAt(5);
  const m = view({ mode: "book" });
  assert.match(m, /<select id="dk-lang"/);
  assert.match(m, /<label class="dk-lab" for="dk-bnote"><span>Note<\/span><span class="dk-tag">Optional<\/span><\/label>/);
  assert.match(text(m), /Panel 2 · 20 min slots[^B]*\d of \d open/);
  const off = primary(m, /^Book/);
  assert.deepEqual(off.map((b) => [b.text, b.disabled]), [["Book · pick a time", true]]);

  const on = primary(view({ mode: "book", picked: open }), /^Book/);
  assert.deepEqual(on.map((b) => [b.text, b.disabled]), [[`Book ${formatClock(open)} · 7700B`, false]]);

  // A slot someone has taken since is not a choice.
  const gone = primary(view({ mode: "book", picked: slotAt(4) }), /^Book/);
  assert.equal(gone[0].disabled, true);
  assert.equal(primary(view({ mode: "book", picked: open, busy: true }), /^Book/)[0].disabled, true);
});

test("Book: the grid is on the page, with the picked slot pressed and the taken ones off", () => {
  const m = view({ mode: "book", picked: slotAt(5) });
  const slots = buttons(m).filter((b) => b.attrs.includes("dk-slot"));
  assert.equal(slots.length, 7, "every slot of the panel, none of them over");
  assert.deepEqual(slots.filter((b) => !b.disabled).map((b) => b.attrs.includes('aria-pressed="true"')), [false, false, false, true, false], "five are open, the picked one pressed");
  assert.deepEqual(slots.filter((b) => b.disabled).map((b) => b.text), [`${slotTime(slotAt(2))}5555H`.replace("5555H", "4410C"), `${slotTime(slotAt(4))}5555H`]);
});

test("Book: Booked later rows have a time chip and Reschedule, and no Cancel anywhere", () => {
  const m = view({ mode: "book", number: "" });
  const rows = m.match(/<li class="dk-qrow">[\s\S]*?<\/li>/g)!;
  assert.equal(rows.length, 2);
  assert.match(rows[0], new RegExp(`<span class="dk-sc dk-s-booked dk-tm">${formatClock(slotAt(2)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</span>`));
  for (const row of rows) {
    assert.match(row, /aria-label="Reschedule \w+"/);
    assert.doesNotMatch(text(row), /ancel/);
  }
  assert.match(m, /Booked later · 2/);
  assert.doesNotMatch(m, /Cancel/, "cancelling a booking is only offered from the reschedule view");
  assert.doesNotMatch(m, /Waiting now/);
});

/* ---- Reschedule ------------------------------------------------------------------------------ */

test("rescheduling: a Moving bar with Stop, the grid with the current slot, and Move / Cancel booking pinned", () => {
  const m = view({ mode: "book", number: "4410C", reschedule: roboBooking, picked: slotAt(5) });
  assert.match(text(m), new RegExp(`Moving 4410C from ${formatClock(slotAt(2))}`));
  assert.equal(labelled(m, /^Stop$/).length, 1);
  assert.match(m, /<p class="dk-cover">Language and note stay as booked\.<\/p>/);
  assert.doesNotMatch(m, /dk-lang|dk-bnote/, "language and note stay as booked");
  assert.doesNotMatch(m, /Booked later|Request now instead/);
  const cur = buttons(m).filter((b) => /current/.test(b.text));
  assert.equal(cur.length, 1);
  assert.ok(cur[0].disabled && /aria-current="true"/.test(cur[0].attrs));
  const bar = m.match(/<div class="dk-abar">[\s\S]*<\/div>$/)![0];
  assert.deepEqual(buttons(bar).map((b) => [b.text, b.disabled]), [[`Move to ${formatClock(slotAt(5))}`, false], ["Cancel booking", false]]);
  assert.match(bar, /class="dk-quiet dk-dg"/);
  assert.match(text(bar), /Asks first/);
  assert.deepEqual(labelled(view({ mode: "book", number: "4410C", reschedule: roboBooking }), /^Move/).map((b) => b.disabled), [true]);
});

/* ---- the slot grid ----------------------------------------------------------------------------- */

// 10-minute slots in 2099, so none has passed and nothing depends on the clock.
const S0 = Date.parse("2099-01-01T10:00:00.000Z");
const at = (i: number) => new Date(S0 + i * 10 * 60_000).toISOString();
const gridPanel: PublicPanel = { ...panel2, id: "p1", slot_start_at: at(0), slot_minutes: 10, slot_count: 8 };
const gTeams = [{ id: "ta", number: "1111A" }, { id: "tt", number: "9882K" }] as Team[];
const held = (id: string, team_id: string, status: RequestRow["status"], i: number) =>
  req({ id, team_id, panel_id: "p1", status, kind: "slot", slot_start: at(i), slot_end: at(i + 1) });
// 1111A holds the 3rd slot; 9882K (the team being booked) has a finished one at the 6th. That leaves
// slots 1 and 8 open, 3 taken, 6 theirs, and the four beside those two too close.
const gReqs = [held("g1", "ta", "scheduled", 2), held("g2", "tt", "completed", 5)];
const cells = (m: string) =>
  [...m.matchAll(/<button type="button" class="(dk-slot[^"]*)"([^>]*)>([\s\S]*?)<\/button>/g)].map((x) => ({
    cls: x[1], attrs: x[2], disabled: /disabled=""/.test(x[2]), pressed: /aria-pressed="(true|false)"/.exec(x[2])?.[1], title: /title="([^"]*)"/.exec(x[2])?.[1], text: text(x[3]),
  }));
const grid = (over: Partial<Parameters<typeof DeskSlots>[0]> = {}) =>
  renderToStaticMarkup(
    <DeskSlots panel={gridPanel} slots={buildSlots(gridPanel, gReqs, gTeams)} teamId="tt" picked={null} onPick={noop} {...over} />,
  );
const t = slotTime;

test("each slot state renders as specified, and only open slots are enabled", () => {
  const c = cells(grid({ picked: at(7) }));
  assert.deepEqual(
    c.map((x) => [x.text, x.cls, x.disabled, x.pressed]),
    [
      [t(at(0)), "dk-slot", false, "false"],
      [`${t(at(1))}too close`, "dk-slot dk-slot--too-close", true, undefined],
      [`${t(at(2))}1111A`, "dk-slot dk-slot--taken", true, undefined],
      [`${t(at(3))}too close`, "dk-slot dk-slot--too-close", true, undefined],
      [`${t(at(4))}too close`, "dk-slot dk-slot--too-close", true, undefined],
      [`${t(at(5))}theirs`, "dk-slot dk-slot--theirs", true, undefined],
      [`${t(at(6))}too close`, "dk-slot dk-slot--too-close", true, undefined],
      [t(at(7)), "dk-slot", false, "true"],
    ],
  );
  assert.equal(c[2].title, "Taken by team 1111A — Scheduled");
  assert.match(c[1].title!, /^Too close to another team&#x27;s booking on this panel — judges need 20 minutes to walk between interviews$/);
  assert.equal(c[5].title, undefined);
  assert.match(grid({ picked: at(7) }), /<button type="button" class="dk-slot" style="[^"]*" aria-pressed="true"><b><svg[^>]*><path d="M5 12\.5l4\.5 4\.5L19 7\.5"><\/path><\/svg>/, "the picked slot carries a check");
  assert.match(grid(), /2 of 8 open/);
  assert.equal(cells(grid({ disabled: true })).filter((x) => !x.disabled).length, 0, "busy turns the open ones off too");
});

test("slots have no status colour", () => {
  const m = grid({ picked: at(7) });
  assert.doesNotMatch(m, /dk-s-|bg-(waiting|enroute|active|done)/);
});

test("past slots are not shown", () => {
  const c = cells(grid({ now: S0 + 25 * 60_000 }));
  assert.equal(c[0].text, `${t(at(2))}1111A`, "slots 1 and 2 are over, the 3rd is still running");
  assert.equal(c.length, 6);
  assert.match(grid({ now: S0 + 25 * 60_000 }), /1 of 6 open/);
});

test("the booking being moved is 'current': outlined, disabled, and not 'theirs'", () => {
  const slots = buildSlots(gridPanel, gReqs, gTeams, "g1");
  const c = cells(grid({ slots, teamId: "ta", currentStart: at(2) }));
  assert.deepEqual(c[2], { cls: "dk-slot dk-slot--current", attrs: c[2].attrs, disabled: true, pressed: undefined, title: undefined, text: `${t(at(2))}current` });
  assert.match(c[2].attrs, /aria-current="true"/);
  assert.equal(c.filter((x) => x.cls.includes("theirs")).length, 0);
  // Its own booking no longer makes its neighbours "too close".
  assert.equal(c[1].disabled, false);
});

test("no slots set up and none left each say so, in place of the grid", () => {
  const none = grid({ panel: { ...gridPanel, slot_start_at: null, slot_count: 0 }, slots: [] });
  assert.equal(
    text(none),
    "Panel 2 has no bookable times set up yet. Use Request now instead, or ask the Judge Advisor to add times (Panels → Panel 2 → Booking slots).",
  );
  assert.match(none, /<strong>Panel 2 has no bookable times set up yet\.<\/strong>/);
  assert.doesNotMatch(none, /dk-slot/);

  const all = [0, 1].map((i) => held(`h${i}`, "ta", "scheduled", i));
  const full = grid({ panel: { ...gridPanel, slot_count: 2 }, slots: buildSlots({ ...gridPanel, slot_count: 2 }, all, gTeams) });
  assert.match(full, /<p>All 2 slots are taken — nothing left to book<\/p>/);
  assert.match(full, /0 of 2 open/);
  assert.doesNotMatch(full, /dk-slot/);

  const past = buildSlots({ ...gridPanel, slot_start_at: "2000-01-01T10:00:00.000Z", slot_count: 2 }, [], gTeams);
  assert.match(grid({ slots: past }), new RegExp(`<p>${noSlotsLeftLine(past, Date.now())}</p>`));
  assert.match(grid({ slots: past }), /No slots left today — the rest have already passed/);
  assert.match(grid({ slots: past }), /min slots/, "the panel line stays");
  assert.doesNotMatch(grid({ slots: past }), / open</, "no \"0 of 0 open\" when every slot is past");
});

/* ---- all teams ----------------------------------------------------------------------------------- */

const teamRows = (m: string) => buttons(m).filter((b) => b.attrs.includes("dk-trow"));

test("All teams: a section in Now and in Book, a real button per team in number order", () => {
  for (const mode of ["now", "book"] as const) {
    const m = view({ mode, number: "" });
    assert.match(m, /<h2 class="dk-sec" id="dk-t-h">All teams · 5<\/h2>/);
    const rows = teamRows(m);
    assert.deepEqual(
      rows.map((b) => /aria-label="([^"]*)"/.exec(b.attrs)![1]),
      ["Select team 4410C, Robo Rangers", "Select team 5555H, High Fives", "Select team 7700B, Byte Me", "Select team 8123N, Bolt Brigade", "Select team 9882K, Torque Titans"],
    );
    assert.ok(rows.every((b) => b.attrs.includes('type="button"') && !b.disabled));
  }
  assert.ok(view({ mode: "book", number: "" }).indexOf("Booked later") < view({ mode: "book", number: "" }).indexOf("All teams"), "after the mode's own list");
  assert.ok(view({ number: "" }).indexOf("Waiting now") < view({ number: "" }).indexOf("All teams"));
});

test("All teams: each row says its panel or 'No panel', and a status chip or booked time when it has one", () => {
  const rows = teamRows(view({ number: "" }));
  const by = (n: string) => rows.find((b) => b.attrs.includes(`team ${n},`))!;
  assert.match(by("9882K").text, /Panel 2/);
  assert.match(by("9882K").text, /Requesting a judge/);
  assert.match(text(by("4410C").text), new RegExp(`Panel 2${formatClock(slotAt(2))}`));
  assert.match(view({ number: "" }), new RegExp(`dk-sc dk-s-booked dk-tm">${formatClock(slotAt(2))}`));
  assert.equal(by("8123N").text, "8123NBolt BrigadeNo panel");
  assert.match(view({ number: "" }), /<span class="dk-np">No panel<\/span>/);
  assert.equal(by("7700B").text, "7700BByte MePanel 2", "nothing live, no chip");
});

test("All teams: the box filters the list and the heading counts it; the team on screen is pressed", () => {
  const m = view({ number: "77" });
  assert.match(m, /All teams · 1 of 5/);
  assert.deepEqual(teamRows(m).map((b) => [/team (\w+),/.exec(b.attrs)![1], /aria-pressed="(\w+)"/.exec(b.attrs)![1]]), [["7700B", "false"]], "77 is not a whole number yet, so no team is selected");
  const sel = view({ number: "7700B" });
  assert.deepEqual(teamRows(sel).map((b) => b.attrs.includes('aria-pressed="true"')), [true]);
  assert.match(view({ number: "BOLT" }), /All teams · 1 of 5/, "by name");
  assert.match(view({ number: "" }), /All teams · 5</);
  assert.equal(teamRows(view({ number: "" })).filter((b) => b.attrs.includes('aria-pressed="true"')).length, 0);
  assert.equal(teamRows(view({ number: "4410C" })).filter((b) => b.attrs.includes('aria-pressed="true"')).length, 1);
});

test("a name that matches a team gives no danger state; the list does the finding", () => {
  const m = view({ number: "BYTE" });
  assert.doesNotMatch(m, /dk-err|aria-invalid|dk-errln|No team BYTE at this event/);
  assert.match(m, /All teams · 1 of 5/);
  assert.match(view({ number: "BYTEZ" }), /No team BYTEZ at this event/, "no team has that in its name");
});

test("All teams: no match gives one muted line", () => {
  const m = view({ number: "0420Z" });
  assert.match(m, /All teams · 0 of 5/);
  assert.equal(teamRows(m).length, 0);
  assert.match(m, /<li class="dk-empty">No team matches 0420Z\.<\/li>/);
});

test("All teams: hidden while rescheduling", () => {
  const m = view({ mode: "book", number: "4410C", reschedule: roboBooking });
  assert.doesNotMatch(m, /All teams|dk-trow/);
});

test("All teams: a tap goes through the number setter, then scrolls to the top without smoothing", () => {
  const src = noComments(read("src/components/desk/DeskView.tsx"));
  assert.match(src, /onClick=\{\(\) => \{\s*p\.onNumber\(t\.number\);\s*window\.scrollTo\(\{ top: 0 \}\);\s*\}\}/);
  assert.doesNotMatch(src, /smooth/);
  assert.match(noComments(read("src/app/queue/page.tsx")), /onNumber=\{\(n\) => \{\s*setNumber\(n\);\s*setPicked\(null\);/, "the same setter typing uses");
});

/* ---- the wiring, read from source ------------------------------------------------------------------ */

const noComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

test("the page keeps its behaviour: one PATCH each, the plain scroll, polling, and the in-page confirm", () => {
  const page = noComments(read("src/app/queue/page.tsx"));
  assert.match(page, /useAppState\(4000\)/);
  assert.match(page, /router\.replace\("\/queue\/login"\)/);
  assert.match(page, /action: "ready-now"/);
  assert.match(page, /action: "reschedule"/);
  assert.match(page, /window\.scrollTo\(\{ top: 0 \}\)/);
  assert.doesNotMatch(page, /smooth|window\.confirm|\bconfirm\(/);
  assert.match(page, /useConfirm\(\)/);
  assert.match(page, /cancelBookingAfterAsking\(ask,/);
  assert.match(page, /state\.languages\[0\]\.id/, "the booking language defaults to the first");
  assert.match(page, /setReschedule\(null\)/, "the isRescheduling effect drops a stale reschedule");
  assert.doesNotMatch(page, /advance|notes|scores/i, "the desk never advances an interview or reads notes");
});

test("only the reschedule view cancels a booking, through the confirm", () => {
  const view = noComments(read("src/components/desk/DeskView.tsx"));
  assert.equal(view.match(/onCancelBooking/g)!.length, 2, "its prop, and the one button");
  assert.doesNotMatch(view, /action: "cancel"/);
  const page = noComments(read("src/app/queue/page.tsx"));
  assert.equal(page.match(/action: "cancel"/g)!.length, 2, "Undo, and Cancel booking");
});
