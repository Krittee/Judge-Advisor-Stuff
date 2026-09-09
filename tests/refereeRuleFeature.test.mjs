import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/* The referee "Rule violated" feature: rule required for Minor/Major,
   optional for Warning, absent for Good Conduct; repeated-violation and
   same-match warnings computed from existing flags; escalation is a
   warning only, never an automatic Major. Most of this lives in a React
   page and API route, so — like the rest of this repo's tests — these
   assert against the real source rather than re-executing it under
   plain `node --test`. */

const event = JSON.parse(readFileSync(new URL("../config/event.json", import.meta.url)));
const routeSrc = readFileSync(new URL("../src/app/api/flags/route.ts", import.meta.url), "utf8");
const presetsSrc = readFileSync(new URL("../src/lib/presets.ts", import.meta.url), "utf8");
const pageSrc = readFileSync(new URL("../src/app/referee/page.tsx", import.meta.url), "utf8");
const flagsComponentSrc = readFileSync(new URL("../src/components/Flags.tsx", import.meta.url), "utf8");

/* ---- config: which kinds require a rule -------------------------------- */

test("Minor and Major require a rule; Good conduct and Warning do not", () => {
  const byId = Object.fromEntries(event.refereeFlags.map((k) => [k.id, k]));
  assert.equal(byId.good.requiresRule, undefined, "Good conduct must not require a rule");
  assert.equal(byId.warning.requiresRule, undefined, "Warning must stay optional, not required");
  assert.equal(byId.minor.requiresRule, true, "Minor violation must require a rule");
  assert.equal(byId.major.requiresRule, true, "Major violation must require a rule");
});

test("presets.ts reads requiresRule from config, and the fallback list matches", () => {
  assert.ok(
    presetsSrc.includes("requiresRule: o.requiresRule === true"),
    "refereeFlags() no longer parses requiresRule off the config entry",
  );
  const fallback = presetsSrc.slice(
    presetsSrc.indexOf("const FLAG_FALLBACK"),
    presetsSrc.indexOf("];", presetsSrc.indexOf("const FLAG_FALLBACK")),
  );
  assert.ok(/id: "good".*requiresRule: false/.test(fallback), "fallback Good conduct must not require a rule");
  assert.ok(/id: "warning".*requiresRule: false/.test(fallback), "fallback Warning must not require a rule");
  assert.ok(/id: "minor".*requiresRule: true/.test(fallback), "fallback Minor must require a rule");
  assert.ok(/id: "major".*requiresRule: true/.test(fallback), "fallback Major must require a rule");
});

/* ---- API: a new flag is refused without a rule when the kind needs one - */

test("parseFlagFields accepts a requireRuleForSeverity option", () => {
  assert.ok(
    routeSrc.includes("requireRuleForSeverity"),
    "parseFlagFields no longer has a requireRuleForSeverity switch",
  );
});

test("POST enforces the rule requirement; PATCH does not", () => {
  const postFn = routeSrc.slice(routeSrc.indexOf("export async function POST"), routeSrc.indexOf("export async function PATCH"));
  const patchFn = routeSrc.slice(routeSrc.indexOf("export async function PATCH"), routeSrc.indexOf("export async function DELETE"));

  assert.ok(
    /parseFlagFields\(body,\s*\{\s*requireRuleForSeverity:\s*true\s*\}\)/.test(postFn),
    "POST no longer requires a rule for a Minor/Major violation",
  );
  assert.ok(
    postFn.indexOf("parseFlagFields(body, { requireRuleForSeverity: true })") < postFn.indexOf("store().createFlag"),
    "the rule requirement is not enforced before the flag is created",
  );

  // PATCH must not pass requireRuleForSeverity: true -- a Minor/Major flag
  // recorded before this feature existed, with no rule on file, must stay
  // correctable (fixing a typo, a match number) without being forced to
  // invent a rule for it retroactively.
  assert.ok(
    patchFn.includes("parseFlagFields(body)") && !/parseFlagFields\(body,\s*\{\s*requireRuleForSeverity:\s*true/.test(patchFn),
    "PATCH must not force a rule onto an existing correction",
  );
});

test("an unrecognised rule id is refused, not silently dropped", () => {
  assert.ok(routeSrc.includes("isValidRuleId(rawRule)"), "a garbage rule id is no longer validated");
  assert.ok(routeSrc.includes("That's not a recognised rule."), "the rejection message is missing");
});

test("the rule is threaded through to storage on create and correct", () => {
  const createCall = routeSrc.slice(routeSrc.indexOf("store().createFlag({"), routeSrc.indexOf("});", routeSrc.indexOf("store().createFlag({")));
  assert.ok(/\brule\b/.test(createCall), "createFlag is no longer given the parsed rule");

  const editLiteral = routeSrc.slice(routeSrc.indexOf("const edit: FlagEdit ="), routeSrc.indexOf(";", routeSrc.indexOf("const edit: FlagEdit =")));
  assert.ok(/\brule\b/.test(editLiteral), "the correction's FlagEdit no longer carries a rule");
});

/* ---- store layer: rule is a correctable column, not part of identity --- */

test("both backends persist rule alongside the other correctable fields", () => {
  const fileSrc = readFileSync(new URL("../src/lib/db/file.ts", import.meta.url), "utf8");
  const pgSrc = readFileSync(new URL("../src/lib/db/postgres.ts", import.meta.url), "utf8");
  assert.ok(fileSrc.includes("rule: input.rule"), "file store's createFlag no longer stores rule");
  assert.ok(fileSrc.includes("row.rule = edit.rule"), "file store's updateFlag no longer sets rule");
  assert.ok(pgSrc.includes("alter table flags add column if not exists rule text"), "the Postgres migration no longer adds the rule column");
});

/* ---- referee page: submit wiring, disabling, reset, no auto-escalation - */

test("record() sends the selected rule and clears it after a successful submit", () => {
  assert.ok(
    /body:\s*\{\s*teamId:\s*team\.id,\s*kind,\s*body,\s*matchType,\s*matchNumber,\s*field,\s*rule\s*\}/.test(pageSrc),
    "record() no longer sends the selected rule to the API",
  );
  const recordFn = pageSrc.slice(pageSrc.indexOf("async function record"), pageSrc.indexOf("\n  }", pageSrc.indexOf("async function record")));
  assert.ok(recordFn.includes("setRule(null)"), "record() no longer clears the rule after a successful submit");
  assert.ok(recordFn.includes('setBody("")'), "record() must still clear the observation text, as before");
  // Match/matchNumber/field must NOT be reset here -- that behaviour predates
  // this feature and must survive unchanged.
  assert.ok(!/setMatchType\(""\)/.test(recordFn), "record() must not reset matchType (existing behaviour)");
  assert.ok(!/setField\(""\)/.test(recordFn), "record() must not reset field (existing behaviour)");
});

test("the observation text (\"What did you see?\") is optional, not required to submit", () => {
  assert.ok(pageSrc.includes("What did you see? "), "the label is missing");
  assert.ok(pageSrc.includes("(optional)"), "the observation box is no longer marked optional");
  assert.ok(
    !/disabled=\{[^}]*!body\.trim\(\)/.test(pageSrc),
    "a kind button still disables on empty observation text -- it must be optional",
  );
});

test("Minor/Major are disabled without a rule, driven by each kind's own requiresRule flag", () => {
  assert.ok(
    pageSrc.includes("const missingRule = k.requiresRule && !rule;"),
    "the per-button rule requirement is no longer computed from k.requiresRule",
  );
  assert.ok(
    /disabled=\{busy \|\| !matchReady \|\| missingRule\}/.test(pageSrc),
    "the kind buttons no longer factor missingRule into their disabled state",
  );
  // Must not be hardcoded to specific ids -- that would silently stop
  // tracking config if a kind were renamed or reordered.
  assert.ok(
    !/k\.id === "minor"/.test(pageSrc) && !/k\.id === "major"/.test(pageSrc),
    "the rule requirement must come from k.requiresRule, not a hardcoded kind id",
  );
});

test("escalation is a warning derived from prior Minor violations of the same rule, never an automatic Major", () => {
  assert.ok(
    pageSrc.includes('sameRuleHistory.some((f) => f.kind === "minor")'),
    "escalationReviewRequired is no longer derived from prior Minor violations",
  );
  // The only place "major" is ever written to a flag is the referee's own
  // click on the Major button (record(k.id)) -- there must be no code path
  // that assigns it based on history.
  assert.ok(
    !/kind\s*=\s*["']major["']/.test(pageSrc) && !/severity\s*=\s*["']major["']/.test(pageSrc),
    "found a direct assignment of kind/severity to \"major\" -- escalation must never auto-select it",
  );
  assert.ok(
    !pageSrc.includes("record(\"major\")") && !pageSrc.includes("record('major')"),
    "record() must only ever be called from the referee's own button click with k.id, never hardcoded",
  );
});

test("the Major-button highlight is visual only -- it never changes what record() is called with", () => {
  const buttonBlock = pageSrc.slice(pageSrc.indexOf("{kinds.map((k) => {"), pageSrc.indexOf("</div>", pageSrc.indexOf("{kinds.map((k) => {")));
  assert.ok(buttonBlock.includes("onClick={() => record(k.id)}"), "the button must still submit whichever kind was actually clicked");
  assert.ok(buttonBlock.includes("highlight"), "the escalation highlight is missing from the button styling");
});

test("same-match history counts only reports for the same team, match and rule", () => {
  assert.ok(
    pageSrc.includes("f.team_id === team.id && f.rule === rule"),
    "sameRuleHistory no longer filters by both team and the exact selected rule",
  );
  assert.ok(
    pageSrc.includes("f.match_type === matchType && f.match_number === matchNumber"),
    "sameMatchSameRule no longer filters by the current match",
  );
});

/* ---- correction UI: rule is preserved, never silently wiped ------------ */

test("correcting a flag carries its existing rule through unchanged", () => {
  const saveFn = flagsComponentSrc.slice(
    flagsComponentSrc.indexOf("async function save(kind"),
    flagsComponentSrc.indexOf("\n  }", flagsComponentSrc.indexOf("async function save(kind")),
  );
  assert.ok(
    saveFn.includes("rule: f.rule"),
    "FlagListItem's save() no longer passes the flag's own rule through -- a correction would wipe it",
  );
});

test("a flag's rule is shown next to its match reference, and only when there is one", () => {
  assert.ok(flagsComponentSrc.includes("ruleDisplayLabel(f.rule)"), "FlagListItem no longer displays the flag's rule");
});
