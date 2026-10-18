import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/* The referee console's wiring, checked in the source because there is no DOM
   harness: that the page uses the tested pure functions in
   src/components/referee/logic.ts rather than carrying a second copy, and that
   the pieces the spec names are there. The decisions themselves run for real in
   refereePage.logic.test.mjs. */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const pageSrc = read("src/app/referee/page.tsx");
const teamsSrc = read("src/app/referee/teams/page.tsx");
const frameSrc = read("src/components/referee/RefereeFrame.tsx");
const setupSrc = read("src/components/referee/EventSetup.tsx");
const sheetSrc = read("src/components/referee/MatchSheet.tsx");
const severitySrc = read("src/components/referee/SeverityButtons.tsx");
const logicSrc = read("src/components/referee/logic.ts");
const css = read("src/app/globals.css");

/** The text of one CSS rule or block, from its selector to the closing brace. */
function rule(selector) {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `globals.css has no ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

/* ---- Event setup ---------------------------------------------------------- */

test("the Event setup screen shows once loaded when there is no setup for today, or on request", () => {
  assert.match(pageSrc, /const settingUp = loaded && \(editingSetup \|\| needsEventSetup\(setup, today\)\)/);
  assert.ok(pageSrc.includes("const today = localDate()"), "today is the device's date");
  assert.ok(pageSrc.includes("<EventSetup"));
  // Not before the first poll: an empty state has no setup and would flash the screen.
  assert.ok(pageSrc.includes("if (!loaded)"));
  assert.ok(pageSrc.indexOf("if (!loaded)") < pageSrc.indexOf("if (settingUp)"));
  // A day's first setup cannot be skipped; one opened on purpose can be cancelled.
  assert.ok(pageSrc.includes("onCancel={needsEventSetup(setup, today) ? undefined : () => setEditingSetup(false)}"));
});

test("saving the setup is a PUT with the device's date, behind the app's confirm for a change", () => {
  assert.match(
    pageSrc,
    /call\("\/api\/referee-setup", \{ method: "PUT", body: setupRequest\(nextRuleset, count, today\) \}\)/,
  );
  const save = pageSrc.slice(pageSrc.indexOf("async function saveSetup"), pageSrc.indexOf("if (session === undefined)"));
  assert.ok(save.indexOf("setupChangeQuestion(") < save.indexOf("confirm(question)"));
  assert.ok(save.indexOf("confirm(question)") < save.indexOf("await call("), "the question comes before the save");
});

test("the setup is reachable later from the match sheet's Change link and from a menu row", () => {
  assert.match(pageSrc, /onChangeProgram=\{\(\) => \{\s*setSheetOpen\(false\);\s*setEditingSetup\(true\);/);
  assert.match(pageSrc, /className="rf-setup-link" onClick=\{\(\) => setEditingSetup\(true\)\}/);
});

test("the setup screen has the specified words, pre-fills from the last setup and defaults to 3 fields", () => {
  for (const text of [
    "Today&apos;s event",
    "Set up refereeing",
    "Choose once for this event. Every referee will use it. You can change it for another event or day.",
    "Number of fields",
    "Set by {name} · applies to all referees",
    "Start refereeing",
  ]) {
    assert.ok(setupSrc.includes(text), `the setup screen lost "${text}"`);
  }
  assert.ok(setupSrc.includes("setup?.ruleset ?? \"\"") && setupSrc.includes("setup?.field_count ?? DEFAULT_FIELD_COUNT"));
  assert.ok(logicSrc.includes("export const DEFAULT_FIELD_COUNT = 3"));
  assert.ok(setupSrc.includes("MAX_FIELD_COUNT"), "the stepper stops at the event ceiling");
  assert.ok(setupSrc.includes("RULESETS.map"), "the program cards come from the rulesets");
});

test("today's date comes from the local clock, never toISOString (which is UTC)", () => {
  assert.ok(!/\.toISOString\(/.test(logicSrc));
  assert.ok(!/\.toISOString\(/.test(pageSrc));
  assert.ok(logicSrc.includes("getFullYear()") && logicSrc.includes("getMonth()") && logicSrc.includes("getDate()"));
});

/* ---- chrome --------------------------------------------------------------- */

test("both referee pages share the frame: top bar, stripe and a Report / All teams / Today tab bar", () => {
  assert.ok(frameSrc.includes('title="Referee"') && frameSrc.includes("subtitle={name}") && frameSrc.includes("online={online}"));
  assert.ok(frameSrc.includes('<SignOutButton to="/referee/login" />'));
  assert.ok(frameSrc.includes('className="rf-strip"'));
  for (const href of ['href="/referee"', 'href="/referee/teams"', 'href="/referee#today"']) {
    assert.ok(frameSrc.includes(href), `the tab bar lost ${href}`);
  }
  assert.ok(pageSrc.includes("<RefereeFrame") && teamsSrc.includes("<RefereeFrame"));
  assert.ok(teamsSrc.includes('current="/referee/teams"'));
  assert.ok(!teamsSrc.includes("TabBar") && !pageSrc.includes("TabBar"), "the old two-tab switch is replaced");
  // Today is a section of the Report page, not a view.
  assert.ok(pageSrc.includes('<section id="today">'));
  assert.ok(pageSrc.includes("Flagged today") && pageSrc.includes("Already on {team.number}"));
});

test("the current-match bar shows the match, the field and the read-only program, with Change", () => {
  const bar = pageSrc.slice(pageSrc.indexOf('<section className="rf-mbar"'), pageSrc.indexOf("</section>", pageSrc.indexOf('<section className="rf-mbar"')));
  assert.ok(bar.includes('aria-label="Current match"'));
  assert.ok(bar.includes("matchReference(matchType, matchNumber)") && bar.includes("fieldLabel(field)"));
  assert.ok(bar.includes("{ruleset.program}"));
  assert.ok(!/<button[^>]*>\s*\{ruleset\.program\}/.test(bar), "the program tag is not a control");
  assert.ok(bar.includes("setSheetOpen(true)"));
});

/* ---- the sheet ------------------------------------------------------------ */

test("Set the match is a real modal dialog that closes on Escape and the backdrop", () => {
  assert.ok(sheetSrc.includes("<dialog"));
  assert.ok(sheetSrc.includes("dialog.showModal()"), "showModal gives the focus trap and Escape");
  assert.ok(sheetSrc.includes('aria-modal="true"'));
  assert.match(sheetSrc, /e\.target === e\.currentTarget/, "a click on the backdrop closes it");
  assert.ok(sheetSrc.includes("onClose={() =>"), "Escape is reported to the caller");
  assert.ok(sheetSrc.includes("<MatchFields"), "the controls are the shared ones");
  for (const text of ["Set the match", "set for this event", "Use this match", "Stays set for every team you flag until you change it."]) {
    assert.ok(sheetSrc.includes(text), `the sheet lost "${text}"`);
  }
  // The sheet edits a copy: backing out leaves the match as it was.
  assert.ok(sheetSrc.includes("useState(value)") && sheetSrc.includes("onUse(draft)"));
});

/* ---- the form ------------------------------------------------------------- */

test("the team box is labelled Team to flag, with one muted summary line and its flag pills", () => {
  assert.ok(pageSrc.includes("<span>Team to flag</span>"));
  assert.ok(!pageSrc.includes("<span>Team number</span>"), "the old label is gone");
  assert.ok(pageSrc.includes('htmlFor="rf-team"') && pageSrc.includes('id="rf-team"'), "the label is tied to the input");
  // "{name} · {division} · Pit {pit}": one line, the pit left out when there is none.
  assert.ok(pageSrc.includes("[team.name, team.division, team.pit ? `Pit ${team.pit}` : null].filter(Boolean).join(\" · \")"));
  assert.ok(pageSrc.includes("<FlagSummary flags={flagsFor(team.id)} kinds={state.flagKinds} />"), "the existing flags sit on the right");
  assert.ok(pageSrc.includes("No team with that number."));
  assert.ok(!/<b>\{team\.name\}<\/b>/.test(pageSrc), "the name is not set apart from the line");
  assert.doesNotMatch(rule(".rf-tline {"), /margin-left: auto/);
  assert.ok(!css.includes(".rf-tline b"), "no bold name in the summary line");
});

test("there is no In match shortcut and no recent-team chips: the referee types or picks every team", () => {
  assert.ok(!pageSrc.includes("In match") && !pageSrc.includes("inMatch"));
  assert.ok(!pageSrc.includes("matchTeams") && !logicSrc.includes("matchTeams"));
  assert.ok(!pageSrc.includes("rf-used") && !css.includes(".rf-used"));
  assert.ok(!pageSrc.includes("rf-chip--dot") && !css.includes("rf-chip--dot"));
  assert.ok(!css.includes(".rf-red") && !css.includes(".rf-blue"));
  // The only chips left on the page are the rules.
  assert.equal(pageSrc.match(/className="rf-chip"/g)?.length, 1);
  assert.ok(pageSrc.includes("flagsOnDay(state.flags, new Date())"), "Flagged today uses today's flags only");
});

test("arriving with ?team= fills the team box, from the All teams list", () => {
  assert.ok(pageSrc.includes('params.get("team")'));
  assert.match(pageSrc, /if \(pickedTeam\) setNumber\(normalizeTeamNumber\(pickedTeam\)\)/);
  assert.ok(pageSrc.includes("useSearchParams"));
});

test("severity buttons are a 2-column grid of 56px toneSolid buttons that only select", () => {
  assert.ok(severitySrc.includes("toneSolid(k.color)"));
  assert.ok(severitySrc.includes("aria-pressed={on}"));
  assert.ok(severitySrc.includes("onClick={() => onChange(k.id)}"), "a tap selects");
  assert.ok(severitySrc.includes("DISQUALIFIED_KIND") && severitySrc.includes("rf-sv--wide"), "Disqualified spans both columns");
  assert.ok(severitySrc.includes("{on ? ("), "the selected one shows a check");
  assert.ok(severitySrc.includes("escalateId === k.id"), "the escalation highlight stays");
  assert.match(rule(".rf-sev {"), /grid-template-columns: 1fr 1fr; gap: 8px/);
  const sv = rule(".rf-sv {");
  assert.match(sv, /min-height: 56px/);
  assert.match(sv, /border-radius: 12px/);
  assert.match(sv, /font-weight: 600; font-size: 16px/);
  assert.match(rule('.rf-sv[aria-pressed="true"]'), /outline: 3px solid var\(--ink\); outline-offset: 2px/);
  assert.match(rule(".rf-sv--wide"), /grid-column: 1 \/ -1/);
});

test("the Record bar is pinned above the tabs, 52px, and is the only thing that saves", () => {
  const bar = pageSrc.slice(pageSrc.indexOf('<div className="rf-abar">'), pageSrc.indexOf("<MatchSheet"));
  assert.ok(bar.includes("disabled={busy || Boolean(blocker)}"));
  assert.ok(bar.includes("onClick={record}"));
  assert.ok(bar.includes("recordLabel(kind, team)"));
  assert.ok(bar.includes("toneSolid(kind.color)"), "tinted in the selected severity");
  assert.ok(bar.includes("{blocker}") && bar.includes("{error}"), "one line says what is missing, or what went wrong");
  assert.ok(pageSrc.includes("recordBlocker({"));
  assert.match(rule(".rf-prim {"), /height: 52px/);
  // The record function refuses on its own, so the button is not the only guard.
  assert.match(pageSrc, /if \(!team \|\| !kind \|\| blocker\) return;/);
});

test("the success banner stays, and the form returns to the top for the next team", () => {
  assert.ok(pageSrc.includes('<Banner kind="success">{saved}</Banner>'));
  assert.ok(pageSrc.includes("bodyRef.current?.scrollTo({ top: 0 })"));
});

/* ---- All teams ------------------------------------------------------------ */

test("All teams: a sticky search, a division pill, a Flagged only chip and a shown-of-total count", () => {
  assert.ok(teamsSrc.includes("<span>Search number, name or pit</span>"), "the search is labelled as the mock has it");
  assert.ok(teamsSrc.includes('placeholder="9882K, Nova, A1"'));
  assert.ok(teamsSrc.includes("{shown.length} of {state.teams.length} teams"));
  assert.ok(teamsSrc.includes("Tap a team to flag it on Report."));
  // The toggle is a chip, not the old checkbox.
  assert.match(teamsSrc, /className="rf-fchip" aria-pressed=\{flaggedOnly\} onClick=\{\(\) => setFlaggedOnly\(!flaggedOnly\)\}/);
  assert.ok(!teamsSrc.includes('type="checkbox"'));
  assert.ok(teamsSrc.includes('<select value={division}') && teamsSrc.includes('aria-label="Division"'), "the division is still a real select");
  assert.match(rule(".rf-find {"), /position: sticky; top: 0/);
  assert.match(rule(".rf-body--list"), /padding-top: 0/);
  assert.match(rule('.rf-fchip[aria-pressed="true"]'), /background: var\(--accent\)/);
  assert.match(rule(".rf-dsel select, .rf-fchip {"), /min-height: 44px; padding: 0 12px;[^}]*border-radius: 999px/);
});

test("All teams rows are full-width, 64px or more: number, name, division and pit, flags and a chevron", () => {
  assert.match(rule(".rf-trow {"), /width: 100%; min-height: 64px/);
  assert.ok(teamsSrc.includes('className="rf-trow"'));
  assert.ok(teamsSrc.includes("<b>{t.number}</b>") && teamsSrc.includes("<span>{t.name}</span>"));
  assert.ok(teamsSrc.includes('{t.pit ? ` · Pit ${t.pit}` : ""}'), "the second line reads division · Pit n");
  assert.ok(teamsSrc.includes("<FlagSummary flags={flags} kinds={state.flagKinds} />"));
  assert.ok(teamsSrc.includes('<path d="M9 6l6 6-6 6" />'), "a chevron says the row goes somewhere");
});

test("All teams still searches number, name or pit, and a tap opens Report with that team", () => {
  assert.ok(teamsSrc.includes("t.number.toLowerCase().includes(q)"));
  assert.ok(teamsSrc.includes("t.name.toLowerCase().includes(q)"));
  assert.ok(teamsSrc.includes('(t.pit ?? "").toLowerCase().includes(q)'));
  assert.ok(teamsSrc.includes("router.push(`/referee?team=${encodeURIComponent(t.number)}`)"));
  assert.ok(teamsSrc.includes("flaggedOnly && !flagsByTeam.has(t.id)"));
  assert.ok(teamsSrc.includes("No teams have been imported yet.") && teamsSrc.includes("Nothing matches that."));
});

test("All teams has no match bar: it is not where a flag is written", () => {
  assert.ok(!teamsSrc.includes("rf-mbar") && !teamsSrc.includes("Current match") && !teamsSrc.includes("MatchSheet"));
  assert.ok(teamsSrc.includes('current="/referee/teams"'));
});

test("the report's rhythm follows the mock: 8px between sections, 10px above, the pinned bar at 12px sides", () => {
  assert.match(rule(".rf-body {"), /gap: 8px;\s*padding: 10px var\(--rf-gutter\) 14px/);
  assert.match(rule(".rf-abar {"), /padding: 10px calc\(var\(--rf-gutter\) - 4px\)/);
  // The setup screen keeps its own, roomier rhythm.
  assert.match(rule(".rf-setup .rf-body"), /gap: 20px; padding-top: 20px/);
});

/* ---- no alliance --------------------------------------------------------- */

test("the alliance is gone from the referee pages, their components and their styles", () => {
  for (const [name, src] of [
    ["page", pageSrc],
    ["teams page", teamsSrc],
    ["frame", frameSrc],
    ["event setup", setupSrc],
    ["match sheet", sheetSrc],
    ["severity buttons", severitySrc],
    ["logic", logicSrc],
  ]) {
    assert.doesNotMatch(src, /alliance/i, `${name} still mentions an alliance`);
  }
  assert.ok(!pageSrc.includes("AllianceToggle"));
  // The referee block of the stylesheet, and the two tokens on :root in both themes.
  const referee = css.slice(css.indexOf("Referee console"), css.indexOf("@keyframes si-bar"));
  assert.doesNotMatch(referee, /alliance/i);
  assert.doesNotMatch(css, /--alliance/);
});

test("the referee styles sit after the landing block, scoped under .referee, with a light theme", () => {
  assert.ok(css.indexOf("Referee console") > css.indexOf("Team landing page"));
  assert.ok(css.indexOf('.referee {') > css.indexOf(".lp-chev"));
  assert.ok(css.includes(':root[data-theme="light"] .referee {'));
  assert.ok(css.includes("--rf-field-line: oklch(0.640 0.012 265)"), "the light field outline keeps 3:1 against the surface");
});
