import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { EventSetup } from "../src/components/referee/EventSetup";
import { MatchSheet } from "../src/components/referee/MatchSheet";
import { SeverityButtons } from "../src/components/referee/SeverityButtons";
import type { FlagKind } from "../src/components/Flags";
import type { RefereeSetup } from "../src/lib/types";

/* The referee console's own components, rendered to markup. Behaviour that
   needs a browser (focus, Escape) is native <dialog> and is checked in the
   source test; this covers what they show and how they are marked up. */

const kinds: FlagKind[] = [
  { id: "good", label: "Good conduct", short: "Good", color: "emerald", severity: 0, requiresRule: false },
  { id: "warning", label: "Warning", short: "Warning", color: "amber", severity: 1, requiresRule: false },
  { id: "minor", label: "Minor violation", short: "Minor", color: "orange", severity: 2, requiresRule: true },
  { id: "major", label: "Major violation", short: "Major", color: "rose", severity: 3, requiresRule: true },
  { id: "dq", label: "Disqualified", short: "DQ", color: "black", severity: 4, requiresRule: true },
];

const setup: RefereeSetup = {
  ruleset: "viqrc",
  field_count: 4,
  set_by: "Jordan Lee",
  set_on: "2026-10-17",
  updated_at: "2026-10-17T02:00:00.000Z",
};

const noop = () => {};

/* ---- Event setup ---------------------------------------------------------- */

test("with no earlier setup no program is chosen, 3 fields are shown and Start is disabled", () => {
  const markup = renderToStaticMarkup(
    <EventSetup setup={null} name="Jordan Lee" busy={false} error={null} onSave={noop} />,
  );
  assert.match(markup, /Set up refereeing/);
  assert.equal(markup.match(/aria-pressed="false"/g)?.length, 2, "two program cards, neither chosen");
  assert.doesNotMatch(markup, /aria-pressed="true"/);
  assert.match(markup, /V5RC/);
  assert.match(markup, /VIQRC/);
  assert.match(markup, /<output[^>]*>3<\/output>/, "default 3 fields");
  assert.equal(markup.match(/<span>Field \d<\/span>/g)?.length, 3, "a preview chip per field");
  assert.match(markup, /Set by Jordan Lee · applies to all referees/);
  assert.match(markup, /<button[^>]*type="submit"[^>]*disabled=""[^>]*>Start refereeing/);
  assert.doesNotMatch(markup, />Cancel</, "a day's first setup cannot be skipped");
});

test("the last setup is pre-filled, so a new day is one tap, and a deliberate visit can be cancelled", () => {
  const markup = renderToStaticMarkup(
    <EventSetup setup={setup} name="Jordan Lee" busy={false} error={null} onSave={noop} onCancel={noop} />,
  );
  assert.equal(markup.match(/aria-pressed="true"/g)?.length, 1);
  assert.match(markup, /<button[^>]*aria-pressed="true"[^>]*><span class="rf-pt"><b>VIQRC<\/b>/);
  assert.match(markup, /<output[^>]*>4<\/output>/);
  assert.doesNotMatch(markup, /<button[^>]*type="submit"[^>]*disabled/);
  assert.match(markup, />Cancel</);
});

test("the stepper has 48px labelled steps and stops at 1 and at the event ceiling", () => {
  const low = renderToStaticMarkup(
    <EventSetup setup={{ ...setup, field_count: 1 }} name="x" busy={false} error={null} onSave={noop} />,
  );
  assert.match(low, /<button[^>]*aria-label="Fewer fields"[^>]*disabled=""/);
  assert.doesNotMatch(low, /<button[^>]*aria-label="More fields"[^>]*disabled/);

  const high = renderToStaticMarkup(
    <EventSetup setup={{ ...setup, field_count: 20 }} name="x" busy={false} error={null} onSave={noop} />,
  );
  assert.match(high, /<button[^>]*aria-label="More fields"[^>]*disabled=""/);
  assert.equal(high.match(/<span>Field \d+<\/span>/g)?.length, 20);
});

test("a failed save shows its message", () => {
  const markup = renderToStaticMarkup(
    <EventSetup setup={setup} name="x" busy={false} error="Set the number of fields — 1 to 20." onSave={noop} />,
  );
  assert.match(markup, /Set the number of fields — 1 to 20\./);
});

/* ---- the match sheet ------------------------------------------------------ */

const sheet = (open: boolean, rulesetId = "v5rc") =>
  renderToStaticMarkup(
    <MatchSheet
      open={open}
      rulesetId={rulesetId}
      fieldCount={3}
      value={{ matchType: "QF", matchNumber: "2-1", field: "2" }}
      onUse={noop}
      onClose={noop}
      onChangeProgram={noop}
    />,
  );

test("the open sheet names the event's program, offers the shared match controls and the confirm", () => {
  const markup = sheet(true);
  assert.match(markup, /<dialog[^>]*aria-modal="true"[^>]*aria-labelledby=/);
  assert.match(markup, /Set the match/);
  assert.match(markup, /Program: <b>V5RC<\/b>/);
  assert.match(markup, /set for this event/);
  assert.match(markup, />Change</, "the program line links to the event setup");
  assert.match(markup, /aria-label="Match group"/, "Teamwork | Skills");
  assert.match(markup, /aria-label="Round of 16 \(R16\)"/, "V5RC's bracket types");
  assert.match(markup, /3 fields · set in event setup/);
  assert.match(markup, /Use this match/);
  assert.match(markup, /Stays set for every team you flag until you change it\./);
  // The match already in force is the starting point.
  assert.match(markup, /id="rf-sheet-bracket"[^>]*value="2"/);
});

test("the sheet's program line follows the event: VIQRC has no eliminations", () => {
  const markup = sheet(true, "viqrc");
  assert.match(markup, /Program: <b>VIQRC<\/b>/);
  assert.doesNotMatch(markup, /Round of 16/);
});

test("a closed sheet holds the dialog but none of its contents, so each opening starts fresh", () => {
  const markup = sheet(false);
  assert.match(markup, /<dialog/);
  assert.doesNotMatch(markup, /Set the match|Use this match/);
});

test("Use this match is off until the match is complete", () => {
  const incomplete = renderToStaticMarkup(
    <MatchSheet
      open
      rulesetId="v5rc"
      fieldCount={3}
      value={{ matchType: "Q", matchNumber: "", field: "" }}
      onUse={noop}
      onClose={noop}
      onChangeProgram={noop}
    />,
  );
  assert.match(incomplete, /<button[^>]*disabled=""[^>]*>Use this match/);
  assert.doesNotMatch(sheet(true), /<button[^>]*disabled=""[^>]*>Use this match/);
});

/* ---- severity buttons ----------------------------------------------------- */

test("the severity group has a button per kind, in order, and only the chosen one is pressed", () => {
  const markup = renderToStaticMarkup(<SeverityButtons kinds={kinds} value="minor" onChange={noop} />);
  assert.match(markup, /How serious\?/);
  const labels = [...markup.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>(?:<svg.*?<\/svg>)?([^<]+)<\/button>/g)];
  assert.deepEqual(
    labels.map((m) => [m[2], m[1]]),
    [
      ["Good conduct", "false"],
      ["Warning", "false"],
      ["Minor violation", "true"],
      ["Major violation", "false"],
      ["Disqualified", "false"],
    ],
  );
  assert.equal(markup.match(/<svg/g)?.length, 1, "the check is on the chosen one only");
  assert.match(markup, /class="[^"]*rf-sv--wide[^"]*">Disqualified/, "Disqualified spans both columns");
  assert.equal(markup.match(/rf-sv--wide/g)?.length, 1);
});

test("severity buttons are filled in their tone, and the escalation ring marks a kind without selecting it", () => {
  const markup = renderToStaticMarkup(<SeverityButtons kinds={kinds} value={null} onChange={noop} escalateId="major" />);
  assert.match(markup, /class="[^"]*bg-danger[^"]*">Major violation/);
  assert.match(markup, /class="[^"]*bg-ink [^"]*">Disqualified/);
  const ringed = markup.match(/ring-caution/g) ?? [];
  assert.equal(ringed.length, 1, "exactly one kind is ringed");
  assert.match(markup, /class="[^"]*ring-caution[^"]*">Major violation/);
  assert.doesNotMatch(markup, /aria-pressed="true"/, "nothing is selected on the user's behalf");
});
