import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/* These small source-wiring checks complement the runtime behavior tests.
   They verify that the page and API use the tested shared modules instead
   of carrying a second, divergent copy of the business rules. */

const event = JSON.parse(readFileSync(new URL("../config/event.json", import.meta.url)));
const routeSrc = readFileSync(new URL("../src/app/api/flags/route.ts", import.meta.url), "utf8");
const pageSrc = readFileSync(new URL("../src/app/referee/page.tsx", import.meta.url), "utf8");
const flagsSrc = readFileSync(new URL("../src/components/Flags.tsx", import.meta.url), "utf8");
const allRulesSrc = readFileSync(new URL("../src/components/AllRulesPicker.tsx", import.meta.url), "utf8");
const matchFieldsSrc = readFileSync(new URL("../src/components/MatchFields.tsx", import.meta.url), "utf8");
const fileStoreSrc = readFileSync(new URL("../src/lib/db/file.ts", import.meta.url), "utf8");
const postgresSrc = readFileSync(new URL("../src/lib/db/postgres.ts", import.meta.url), "utf8");
const schemaSql = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");

test("only Minor, Major and Disqualified are configured to require a rule", () => {
  const byId = Object.fromEntries(event.refereeFlags.map((kind) => [kind.id, kind]));
  assert.equal(byId.good.requiresRule, undefined);
  assert.equal(byId.warning.requiresRule, undefined);
  assert.equal(byId.minor.requiresRule, true);
  assert.equal(byId.major.requiresRule, true);
  assert.equal(byId.dq.requiresRule, true);
});

test("POST and PATCH both use the shared validator with server-side rule enforcement", () => {
  const post = routeSrc.slice(routeSrc.indexOf("export async function POST"), routeSrc.indexOf("export async function PATCH"));
  const patch = routeSrc.slice(routeSrc.indexOf("export async function PATCH"), routeSrc.indexOf("export async function DELETE"));

  // A new flag is checked against the event's setup: its program and field count.
  assert.match(post, /parseFlagFields\(body, \{\s*eventRuleset: setup\?\.ruleset,\s*fieldCount: setup\?\.field_count,?\s*\}\)/);
  assert.ok(!routeSrc.includes("requireRuleForSeverity"), "rule enforcement must not be optional");
  assert.match(patch, /allowLegacyRulelessKind:\s*existing\.rule \? null : existing\.kind/);
  assert.match(patch, /defaultRuleset:\s*existing\.ruleset/, "a correction must keep the flag's own ruleset by default");
  assert.ok(!patch.includes("eventRuleset"), "a correction must not be held to the event's program");
  assert.match(patch, /\bexisting,\s*\}\)/, "a correction must pass the flag on record so legacy values can be kept");
});

test("the manual version is taken from the validated ruleset, never read from the request", () => {
  assert.ok(!/body\.manual/i.test(routeSrc), "the route reads a manual version from the request body");
  const validatorSrc = readFileSync(new URL("../src/lib/flagValidation.ts", import.meta.url), "utf8");
  assert.ok(!/body\.manual/i.test(validatorSrc), "the validator reads a manual version from the request body");
  assert.ok(validatorSrc.includes("manualVersion: ruleset.manualVersion"));
  const post = routeSrc.slice(routeSrc.indexOf("export async function POST"), routeSrc.indexOf("export async function PATCH"));
  assert.ok(post.includes("manualVersion,") && post.includes("ruleset,") && post.includes("matchAffecting"));
});

test("rule is stored and remains a correctable field, never a record identity", () => {
  assert.ok(fileStoreSrc.includes("rule: input.rule"));
  assert.ok(fileStoreSrc.includes("row.rule = edit.rule"));
  assert.ok(postgresSrc.includes("alter table flags add column if not exists rule text"));
  assert.ok(postgresSrc.includes("insert into flags"));
  assert.ok(!/on conflict[^;]*flags/is.test(postgresSrc), "flags must be inserted, not upserted by match/rule");
});

test("both stores add the ruleset columns additively, and a flag from before them is VEX IQ", () => {
  // Postgres: additive alters next to the existing flags DDL, never a drop.
  for (const ddl of [
    "alter table flags add column if not exists ruleset text;",
    "alter table flags add column if not exists manual_version text;",
    "alter table flags add column if not exists match_affecting boolean not null default false;",
  ]) {
    assert.ok(postgresSrc.includes(ddl), `migrate() lost: ${ddl}`);
  }
  assert.ok(!/drop column[^;]*(ruleset|manual_version|match_affecting)/i.test(postgresSrc));

  // The hand-run schema stays in step with migrate().
  const flagsTable = schemaSql.slice(schemaSql.indexOf("create table flags"), schemaSql.indexOf(");", schemaSql.indexOf("create table flags")));
  for (const column of [
    /\bruleset\s+text/,
    /\bmanual_version\s+text/,
    /\bmatch_affecting\s+boolean not null default false/,
  ]) {
    assert.match(flagsTable, column, `supabase/schema.sql flags table lost ${column}`);
  }

  // File store: an old state file gets the new fields on load.
  const migrate = fileStoreSrc.slice(fileStoreSrc.indexOf("function migrate("), fileStoreSrc.indexOf("data.requests", fileStoreSrc.indexOf("function migrate(")));
  assert.ok(migrate.includes("f.ruleset ??= null"));
  assert.ok(migrate.includes("f.manual_version ??= null"));
  assert.ok(migrate.includes("f.match_affecting ??= false"));
  assert.ok(migrate.includes("data.refereeSetup ??= null"), "an old state file has no referee setup");
});

test("the page sends the event's ruleset, rules and match affecting, and only resets them after a successful request", () => {
  const start = pageSrc.indexOf("async function record");
  const record = pageSrc.slice(start, pageSrc.indexOf("\n  }", start));
  assert.match(
    record,
    /recordPayload\(\{ teamId: team\.id, kind: kind\.id, body, match, rulesetId, rules, matchAffecting \}\)/,
  );
  assert.ok(record.indexOf("await call") < record.indexOf("setRules([])"));
  assert.ok(record.indexOf("await call") < record.indexOf("setMatchAffecting(false)"));
  assert.ok(record.indexOf("await call") < record.indexOf("setKindId(null)"));
  assert.ok(record.includes('setBody("")'));
  // The team, match and field stay, so the next team in the same match is quick.
  for (const kept of ["setNumber(", "setMatch(", "setRulesetId", "setSheetOpen("]) {
    assert.ok(!record.includes(kept), `a recorded flag must not touch ${kept}`);
  }
});

test("the program comes from the event setup, not from this device", () => {
  assert.ok(!pageSrc.includes("RulesetPicker"), "the per-device ruleset dropdown is gone");
  assert.ok(!pageSrc.includes("localStorage"), "nothing about the program is remembered on the device");
  assert.ok(!pageSrc.includes("RULESET_STORAGE_KEY"));
  assert.ok(pageSrc.includes("const rulesetId = setup?.ruleset ?? DEFAULT_RULESET_ID"));
});

test("the note is optional: a collapsed row, capped at 500, never required", () => {
  assert.ok(pageSrc.includes("Add a note"));
  assert.match(pageSrc, /<details className="rf-note">/);
  assert.ok(pageSrc.includes("maxLength={500}"));
  assert.ok(!pageSrc.includes("!body.trim()"));
  assert.ok(!flagsSrc.includes("!draftBody.trim()"));
});

test("rules are common-rule chips plus one All rules dialog, between the note and the severity buttons", () => {
  const note = pageSrc.indexOf("Add a note");
  const trigger = pageSrc.indexOf("All rules <em>");
  const severity = pageSrc.indexOf("<SeverityButtons");
  assert.ok(trigger < note && note < severity, "What happened, then the note, then How serious");
  assert.ok(pageSrc.includes("<AllRulesPicker"), "the page lost the All rules dialog");
  assert.ok(!pageSrc.includes("<RulePicker"), "the old dropdown picker is back");
  assert.ok(pageSrc.includes("commonFieldRules(rulesetId)"), "the chips are the event program's common rules");
  assert.match(pageSrc, /aria-pressed=\{rules\.includes\(id\)\}/, "a rule chip is a multi-select toggle");
  assert.ok(pageSrc.includes("MAX_FLAG_RULES") && pageSrc.includes("toggleRule(rules, id)"), "the cap on rules is kept");
  assert.equal(allRulesSrc.match(/placeholder="Search/g)?.length, 1, "the dialog has the one search box");
  assert.ok(allRulesSrc.includes("overflow-y-auto overscroll-contain"), "the long list must scroll inside the dialog");
});

test("the rule list wraps on a phone: no nowrap on the rows, long official titles break inside them", () => {
  const rows = allRulesSrc.slice(allRulesSrc.indexOf("rules.map((r) => {"));
  assert.ok(!/whitespace-nowrap/.test(rows), "rule rows must wrap, not scroll sideways");
  assert.ok(rows.includes("min-w-0 flex-1 break-words"), "long official titles must break inside the row");
  assert.ok(rows.includes("min-h-12"), "rows are at least 48px tall");
});

test("match affecting is a switch that appears once a rule is picked, in the raise form and the correction form", () => {
  assert.match(pageSrc, /rules\.length \? \(\s*<label className="rf-row">/);
  assert.match(pageSrc, /type="checkbox"\s+role="switch"/);
  assert.match(flagsSrc, /draftRules\.length \|\| MATCH_AFFECTING_KINDS\.includes\(f\.kind\)/);
});

test("a field is a number from the event's setup; the division prefix is gone", () => {
  const validatorSrc = readFileSync(new URL("../src/lib/flagValidation.ts", import.meta.url), "utf8");
  assert.ok(validatorSrc.includes("export const MAX_FIELD_COUNT = 20"), "the setup's field ceiling moved");
  assert.ok(validatorSrc.includes("Pick the field — 1 to ${maxField}."));
  assert.ok(!validatorSrc.includes("FIELD_PREFIXES"));
  // The field chips are the shared match control's, one per field the event has.
  assert.ok(matchFieldsSrc.includes("length: fieldCount"));
  assert.ok(!pageSrc.includes("FieldPicker") && !pageSrc.includes("FIELD_PREFIXES"));
  assert.ok(pageSrc.includes("const fieldCount = setup?.field_count ?? MAX_FIELD_COUNT"));
  assert.match(pageSrc, /<MatchSheet[^>]*fieldCount=\{fieldCount\}/);
  assert.equal(
    pageSrc.match(/<FlagList[^>]*fieldCount=\{fieldCount\}/g)?.length,
    pageSrc.match(/<FlagList/g)?.length,
    "every FlagList is given the event's field count",
  );
  assert.ok(!pageSrc.includes("matchTypes={"), "FlagList's deprecated matchTypes prop is no longer passed");
});

test("repeated history comes from the tested helper and cannot select an automatic Major or DQ", () => {
  assert.ok(pageSrc.includes("refereeHistory(state.flags"));
  assert.ok(pageSrc.includes("rules, matchType, matchNumber, rulesetId"), "history must be scoped to the event's ruleset");
  assert.ok(!/kind\s*=\s*["']major["']/.test(pageSrc));
  assert.ok(!/severity\s*=\s*["']major["']/.test(pageSrc));
  assert.ok(!pageSrc.includes('record("major")'));
  assert.ok(!pageSrc.includes('record("dq")'));
  // A severity is only ever selected by a tap on its button, never set from here.
  assert.ok(!/setKindId\(\s*["'`]/.test(pageSrc), "nothing may select a severity by id");
  assert.ok(pageSrc.includes("onChange={setKindId}"));
  // The Record button is the only thing that saves.
  assert.equal(pageSrc.match(/onClick=\{record\}/g)?.length, 1);
  assert.ok(!pageSrc.includes("record(k.id)"), "tapping a severity must not save");
  assert.ok(pageSrc.includes("Head Referee"));
});

test("the escalation highlight can never point at Disqualified", () => {
  assert.match(pageSrc, /kinds\.filter\(\(k\) => k\.id !== DISQUALIFIED_KIND\)\.map\(\(k\) => k\.severity\)/);
});

test("Flagged Today renders each complete report and legacy null rules remain guarded", () => {
  const flaggedToday = pageSrc.slice(pageSrc.indexOf("Flagged today"));
  assert.ok(flaggedToday.includes("<FlagList flags={flags}"));
  assert.ok(flagsSrc.includes("ruleDisplayLabel(id, f.ruleset)"));
  assert.ok(flagsSrc.includes("ruleIds.length ? ("), "no rules (Good Conduct, legacy) must render no rule block");
  assert.ok(flagsSrc.includes("matchReference(f.match_type, f.match_number) ?"));
});

test("correction UI sends the ruleset and rules it shows and blocks unsafe rule-less severity changes", () => {
  assert.ok(flagsSrc.includes("rules: draftRules"));
  assert.ok(flagsSrc.includes("ruleset: ruleset.id"), "a correction keeps the flag's own ruleset");
  assert.match(flagsSrc, /k\.requiresRule && !draftRules\.length && !legacyKeep/);
});

test("the app's existing full wipe remains the active-event boundary", () => {
  assert.ok(fileStoreSrc.includes("loaded = empty()"));
  assert.match(
    postgresSrc,
    /truncate activity, notes, scores, conflicts, requests, teams, panels, judges, referee_setup cascade/,
    "a full wipe must clear the referee setup, and the judge roster, with the rest of the event",
  );
  assert.ok(!/resetDay\(\)[\s\S]*truncate[^\n]*flags/.test(postgresSrc));
  const resetDay = postgresSrc.slice(postgresSrc.indexOf("async resetDay()"), postgresSrc.indexOf("async resetAll()"));
  assert.ok(!/truncate[^\n]*referee_setup/.test(resetDay), "a day reset must keep the referee setup");
});

test("the PATCH activity log reports rules, ruleset and match-affecting changes", () => {
  const patch = routeSrc.slice(routeSrc.indexOf("export async function PATCH"), routeSrc.indexOf("export async function DELETE"));
  for (const label of [
    "rules: existing.rule",
    "ruleset: getRuleset(existing.ruleset).id",
    '"match affecting"',
  ]) {
    assert.ok(patch.includes(label), `the PATCH before-snapshot lost ${label}`);
  }
  // Both halves are captured before updateFlag runs (the file store aliases).
  assert.ok(patch.indexOf("existing.rule,") < patch.indexOf("store().updateFlag("));
});
