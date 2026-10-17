import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FlagList,
  flagsOnDay,
  FlagSummary,
  MatchAffectingCheck,
  RulePicker,
  RulesetPicker,
  type FlagKind,
} from "../src/components/Flags";
import {
  DEFAULT_OPEN_RULE_CATEGORIES,
  getRuleset,
  groupRulesByCategory,
  isCategoryOpen,
  MAX_FLAG_RULES,
  searchRules,
  toggleRule,
} from "../src/lib/rules";
import { tone, toneSolid } from "../src/lib/tone";
import type { FlagRow } from "../src/lib/types";

const kinds: FlagKind[] = [
  { id: "good", label: "Good conduct", short: "Good", color: "emerald", severity: 0, requiresRule: false },
  { id: "warning", label: "Warning", short: "Warning", color: "amber", severity: 1, requiresRule: false },
  { id: "minor", label: "Minor violation", short: "Minor", color: "orange", severity: 2, requiresRule: true },
  { id: "major", label: "Major violation", short: "Major", color: "rose", severity: 3, requiresRule: true },
  { id: "dq", label: "Disqualified", short: "DQ", color: "black", severity: 4, requiresRule: true },
];

function report(values: Partial<FlagRow> = {}): FlagRow {
  return {
    id: "flag-1",
    team_id: "team-1852B",
    kind: "minor",
    body: "Possessed two Bean Bags.",
    author: "Head Referee",
    match_type: "Q",
    match_number: "23",
    field: "Field 2",
    rule: "SG6",
    ruleset: "viqrc",
    manual_version: null,
    match_affecting: false,
    created_at: "2026-09-09T10:00:00.000Z",
    ...values,
  };
}

test("FlagList renders rule, severity, match, field, description, author and time safely", () => {
  const markup = renderToStaticMarkup(<FlagList flags={[report()]} kinds={kinds} />);

  assert.match(markup, /Minor/);
  assert.match(markup, /&lt;SG6&gt; — Possession \/ Plowing is limited to a maximum of one \(1\) Bean Bag/);
  assert.match(markup, /VEX IQ/);
  assert.match(markup, /Q23/);
  assert.match(markup, /Field 2/);
  assert.match(markup, /Possessed two Bean Bags\./);
  assert.match(markup, /Head Referee/);
  assert.match(markup, /\d/);
});

test("Good Conduct and legacy reports without rule information render no broken rule label", () => {
  const markup = renderToStaticMarkup(
    <FlagList
      flags={[
        report({ id: "good", kind: "good", rule: null, body: "Helped reset the Field." }),
        report({
          id: "legacy",
          kind: "warning",
          rule: null,
          match_type: null,
          match_number: null,
          field: null,
          body: "Legacy report",
        }),
      ]}
      kinds={kinds}
    />,
  );

  assert.match(markup, /Good/);
  assert.match(markup, /Helped reset the Field\./);
  assert.match(markup, /Legacy report/);
  assert.doesNotMatch(markup, /undefined|null|Rule violated/);
});

test("Flagged Today counts only reports from the referee's own calendar day", () => {
  // Built in local time, so the test means "the same day on this device" in any timezone.
  const day = new Date(2026, 8, 9, 14, 0);
  const kept = flagsOnDay(
    [
      report({ id: "earlyToday", created_at: new Date(2026, 8, 9, 0, 5).toISOString() }),
      report({ id: "lateYesterday", created_at: new Date(2026, 8, 8, 23, 55).toISOString() }),
      report({ id: "tomorrow", created_at: new Date(2026, 8, 10, 0, 1).toISOString() }),
    ],
    day,
  );
  assert.deepEqual(kept.map((f) => f.id), ["earlyToday"]);
});

test("the referee page builds Flagged Today from today's flags, not the whole retained history", () => {
  const src = readFileSync(new URL("../src/app/referee/page.tsx", import.meta.url), "utf8");
  assert.ok(
    src.includes("flagsOnDay(state.flags, new Date())"),
    "Flagged Today is no longer filtered to the current day",
  );
});

test("a V5RC flag lists every rule with its official title, the ruleset and the manual edition", () => {
  const markup = renderToStaticMarkup(
    <FlagList
      flags={[
        report({
          kind: "major",
          rule: "GG17,SG9",
          ruleset: "v5rc",
          manual_version: "2.1",
          match_affecting: true,
        }),
      ]}
      kinds={kinds}
    />,
  );

  assert.match(markup, /V5RC Override/);
  assert.match(markup, /v2\.1/);
  assert.match(markup, /&lt;GG17&gt; — No Holding for more than a 3-count/);
  assert.match(markup, /&lt;SG9&gt; — Alliance Goals are protected/);
  assert.match(markup, /Match affecting/);
});

test("a legacy flag with no ruleset is read as VEX IQ, and a flag that is not match affecting says nothing", () => {
  const markup = renderToStaticMarkup(
    <FlagList flags={[report({ ruleset: null, rule: "SG6", match_affecting: false })]} kinds={kinds} />,
  );
  assert.match(markup, /VEX IQ/);
  assert.match(markup, /&lt;SG6&gt; — Possession \/ Plowing/);
  assert.doesNotMatch(markup, /Match affecting/);
});

test("a rule id the ruleset no longer knows still shows, rather than the rule silently vanishing", () => {
  const markup = renderToStaticMarkup(<FlagList flags={[report({ rule: "ZZ99" })]} kinds={kinds} />);
  assert.match(markup, /ZZ99/);
});

test("Disqualified renders as its own DQ chip, in a tone no other kind shares", () => {
  const markup = renderToStaticMarkup(
    <FlagSummary flags={[report({ kind: "dq" }), report({ id: "2", kind: "major" })]} kinds={kinds} />,
  );
  assert.match(markup, /DQ/);
  assert.match(markup, /Major/);
  assert.notEqual(tone("black"), tone("rose"));
  assert.notEqual(tone("black"), tone(undefined), "black must not fall through to the neutral zinc tone");
  assert.notEqual(toneSolid("black"), toneSolid(undefined));
});

/* ---- the rule picker ------------------------------------------------------ */

test("selected rules show as removable chips, each tap target at least 44px tall", () => {
  const markup = renderToStaticMarkup(
    <RulePicker rulesetId="v5rc" value={["SG9", "GG17"]} onChange={() => {}} />,
  );
  assert.match(markup, /SG9 ×/);
  assert.match(markup, /GG17 ×/);
  assert.match(markup, /aria-label="Remove SG9"/);
  assert.match(markup, /min-h-11/, "44px (min-h-11) touch targets");
  assert.match(markup, /aria-expanded="false"/, "closed until tapped");
  assert.doesNotMatch(markup, /COMMON FIELD RULES/);
});

test("the open picker starts with Scoring, Specific Game and General Game rules expanded, the rest collapsed", () => {
  const markup = renderToStaticMarkup(
    <RulePicker rulesetId="v5rc" value={[]} onChange={() => {}} startOpen />,
  );
  // Expanded: their rule rows are present, code + em dash + official title.
  assert.match(markup, /&lt;SC1&gt;<\/span> — All scoring statuses are evaluated after the Match ends/);
  assert.match(markup, /&lt;SG6&gt;<\/span> — Possession is limited to a maximum of one Pin and one Cup/);
  assert.match(markup, /&lt;GG17&gt;<\/span> — No Holding for more than a 3-count/);
  // Collapsed: the header says so and none of their rows render.
  for (const [category, sample] of [
    ["SAFETY RULES", "&lt;S4&gt;"],
    ["ROBOT RULES", "&lt;R1&gt;"],
    ["TOURNAMENT RULES", "&lt;T1&gt;"],
    ["TOURNAMENT SPECIAL", "&lt;TS1&gt;"],
  ]) {
    assert.match(markup, new RegExp(category), `${category} header missing`);
    assert.ok(!markup.includes(`${sample}</span>`), `${sample} should be hidden in a collapsed ${category}`);
  }
  assert.match(markup, /aria-expanded="true"/);
  assert.match(markup, /aria-expanded="false"/);
  // The shortcut section is V5RC's own list.
  assert.match(markup, /COMMON FIELD RULES/);
  assert.match(markup, /0 of 5 selected/);
});

test("the open picker marks selected rows, and a ruleset switch shows that ruleset's rules", () => {
  const markup = renderToStaticMarkup(
    <RulePicker rulesetId="viqrc" value={["SG6"]} onChange={() => {}} startOpen />,
  );
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /Possession \/ Plowing is limited/, "IQ's SG6 wording");
  assert.doesNotMatch(markup, /one Pin and one Cup/, "V5RC wording must not leak into IQ");
  assert.match(markup, /1 of 5 selected/);
});

test("at the cap every unselected row is disabled and selected rows stay tappable", () => {
  const picked = ["SC1", "SC2", "SC3", "SC4", "SC5"];
  const markup = renderToStaticMarkup(
    <RulePicker rulesetId="v5rc" value={picked} onChange={() => {}} startOpen />,
  );
  assert.match(markup, /5 of 5 selected/);
  const rows = markup.match(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>/g) ?? [];
  assert.ok(rows.length > 5);
  for (const row of rows) {
    const selected = row.includes('aria-pressed="true"');
    assert.equal(/\sdisabled=""/.test(row), !selected, `row ${selected ? "selected" : "unselected"}: ${row.slice(0, 80)}`);
  }
});

test("a search opens every category, an empty one leaves the referee's own toggles in charge", () => {
  const open = new Set(DEFAULT_OPEN_RULE_CATEGORIES);
  assert.deepEqual([...open], ["Scoring Rules", "Specific Game Rules", "General Game Rules"]);
  assert.equal(isCategoryOpen("Scoring Rules", "", open), true);
  assert.equal(isCategoryOpen("Robot Rules", "", open), false, "collapsed by default");
  assert.equal(isCategoryOpen("Robot Rules", "   ", open), false, "a blank search is not a search");
  assert.equal(isCategoryOpen("Robot Rules", "pneu", open), true, "a search opens collapsed sections");
  assert.equal(isCategoryOpen("Robot Rules", "", new Set(["Robot Rules"])), true, "a tapped header stays open");
});

test("toggleRule adds, removes and honours the cap", () => {
  assert.deepEqual(toggleRule([], "SG9"), ["SG9"]);
  assert.deepEqual(toggleRule(["SG9"], "GG17"), ["SG9", "GG17"]);
  assert.deepEqual(toggleRule(["SG9", "GG17"], "SG9"), ["GG17"]);
  const full = ["A1", "A2", "A3", "A4", "A5"].slice(0, MAX_FLAG_RULES);
  assert.deepEqual(toggleRule(full, "B1"), full, "an add past the cap is ignored");
  assert.deepEqual(toggleRule(full, "A1"), full.slice(1), "a removal at the cap still works");
});

test("groupRulesByCategory follows the manual's order and keeps an unknown category rather than dropping it", () => {
  const v5 = groupRulesByCategory(getRuleset("v5rc").rules).map((g) => g.category);
  assert.equal(v5[0], "Scoring Rules");
  assert.equal(v5[v5.length - 1], "Tournament Special");

  const odd = {
    id: "X1",
    displayId: "<X1>",
    category: "Brand New Category",
    officialTitle: "t",
    searchKeywords: ["x1"],
  };
  const grouped = groupRulesByCategory([odd, ...getRuleset("viqrc").rules]).map((g) => g.category);
  assert.ok(grouped.includes("Brand New Category"));
  assert.equal(grouped[grouped.length - 1], "Brand New Category", "unknown categories go after the known ones");

  // Search narrows the groups to the categories that still have a hit.
  const holding = groupRulesByCategory(searchRules("holding", "v5rc"));
  assert.deepEqual(holding.map((g) => g.category), ["General Game Rules"]);
});

test("the ruleset dropdown lists both rulesets and shows the manual edition from the data", () => {
  const v5 = renderToStaticMarkup(<RulesetPicker value="v5rc" onChange={() => {}} />);
  assert.match(v5, /VEX IQ/);
  assert.match(v5, /V5RC Override/);
  assert.match(v5, /Override Manual v2\.1/);

  const iq = renderToStaticMarkup(<RulesetPicker value="viqrc" onChange={() => {}} />);
  assert.doesNotMatch(iq, /Manual v/, "IQ records no edition, so none is invented");
  assert.match(renderToStaticMarkup(<RulesetPicker value="nope" onChange={() => {}} />), /<option value="viqrc"[^>]*selected/);
});

test("the match-affecting checkbox is a real, labelled checkbox with a 44px row", () => {
  const markup = renderToStaticMarkup(<MatchAffectingCheck checked onChange={() => {}} />);
  assert.match(markup, /type="checkbox"/);
  assert.match(markup, /checked/);
  assert.match(markup, /Match affecting/);
  assert.match(markup, /min-h-11/);
});
