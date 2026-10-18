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
    "alter table flags add column if not exists alliance text check (alliance in ('red','blue'));",
  ]) {
    assert.ok(postgresSrc.includes(ddl), `migrate() lost: ${ddl}`);
  }
  assert.ok(!/drop column[^;]*(ruleset|manual_version|match_affecting|alliance)/i.test(postgresSrc));

  // The hand-run schema stays in step with migrate().
  const flagsTable = schemaSql.slice(schemaSql.indexOf("create table flags"), schemaSql.indexOf(");", schemaSql.indexOf("create table flags")));
  for (const column of [
    /\bruleset\s+text/,
    /\bmanual_version\s+text/,
    /\bmatch_affecting\s+boolean not null default false/,
    /\balliance\s+text check \(alliance in \('red','blue'\)\)/,
  ]) {
    assert.match(flagsTable, column, `supabase/schema.sql flags table lost ${column}`);
  }

  // File store: an old state file gets the new fields on load.
  const migrate = fileStoreSrc.slice(fileStoreSrc.indexOf("function migrate("), fileStoreSrc.indexOf("data.requests", fileStoreSrc.indexOf("function migrate(")));
  assert.ok(migrate.includes("f.ruleset ??= null"));
  assert.ok(migrate.includes("f.manual_version ??= null"));
  assert.ok(migrate.includes("f.match_affecting ??= false"));
  assert.ok(migrate.includes("f.alliance ??= null"));
  assert.ok(migrate.includes("data.refereeSetup ??= null"), "an old state file has no referee setup");
});

test("the page sends ruleset, rules and match affecting, and only resets them after a successful request", () => {
  const start = pageSrc.indexOf("async function record");
  const record = pageSrc.slice(start, pageSrc.indexOf("\n  }", start));
  assert.match(
    record,
    /body:\s*\{ teamId: team\.id, kind, body, matchType, matchNumber, field, ruleset: rulesetId, rules, matchAffecting \}/,
  );
  assert.ok(record.indexOf("await call") < record.indexOf("setRules([])"));
  assert.ok(record.indexOf("await call") < record.indexOf("setMatchAffecting(false)"));
  assert.ok(record.includes('setBody("")'));
  assert.ok(!record.includes("setRulesetId"), "the ruleset is remembered, not cleared after a flag");
  assert.ok(!record.includes('setMatchType("")'));
  assert.ok(!record.includes('setMatchNumber("")'));
  assert.ok(!record.includes('setField("")'));
});

test("the ruleset is remembered per device in localStorage, guarded, and switching it clears the rules", () => {
  assert.match(pageSrc, /try \{\s*const saved = localStorage\.getItem\(RULESET_STORAGE_KEY\);/);
  assert.match(pageSrc, /try \{\s*localStorage\.setItem\(RULESET_STORAGE_KEY, id\);/);
  assert.ok(pageSrc.includes("isValidRulesetId(saved)"), "a stale or tampered stored value must fall back to the default");
  const choose = pageSrc.slice(pageSrc.indexOf("function chooseRuleset"), pageSrc.indexOf("function chooseRuleset") + 400);
  assert.ok(choose.includes("setRules([])"), "switching ruleset must clear the selected rules");
  assert.ok(pageSrc.includes("<RulesetPicker"));
  assert.ok(
    pageSrc.indexOf("<RulesetPicker") < pageSrc.indexOf("Team number"),
    "the ruleset dropdown belongs at the top of the flag form",
  );
});

test("What did you see is optional in the UI and server path", () => {
  assert.ok(pageSrc.includes("(optional)"));
  assert.ok(!pageSrc.includes("!body.trim()"));
  assert.ok(!flagsSrc.includes("!draftBody.trim()"));
});

test("the selector remains one searchable control between observation and action buttons", () => {
  const observation = pageSrc.indexOf("What did you see?");
  const selector = pageSrc.indexOf("Rules violated");
  const actions = pageSrc.indexOf("{kinds.map((k) => {");
  assert.ok(observation < selector && selector < actions);
  assert.equal(flagsSrc.match(/placeholder="Search: SG6/g)?.length, 1);
  assert.ok(pageSrc.includes("<RulePicker"), "the raise form no longer uses the shared rule picker");
  assert.ok(!pageSrc.includes("choose category"));
  assert.ok(flagsSrc.includes("break-words"));
  assert.ok(flagsSrc.includes("overflow-y-auto"));
});

test("the rule list wraps on a phone: no fixed widths or nowrap on the picker rows", () => {
  const picker = flagsSrc.slice(flagsSrc.indexOf("function RuleRow"), flagsSrc.indexOf("/** The worst thing said about a team"));
  assert.ok(!/whitespace-nowrap/.test(picker), "rule rows must wrap, not scroll sideways");
  assert.ok(!/\bw-\[\d/.test(picker) && !/\bmin-w-\[/.test(picker), "no fixed widths in the picker");
  assert.ok(picker.includes("min-w-0 break-words"), "long official titles must break inside the row");
  assert.ok(picker.includes("min-h-11"), "44px touch targets");
});

test("match affecting appears once a rule is picked, in the raise form and the correction form", () => {
  assert.match(pageSrc, /rules\.length \? \(\s*<MatchAffectingCheck/);
  assert.match(flagsSrc, /draftRules\.length \|\| MATCH_AFFECTING_KINDS\.includes\(f\.kind\)/);
});

test("a field is a number from the event's setup; the division prefix lives on only in the old form", () => {
  const validatorSrc = readFileSync(new URL("../src/lib/flagValidation.ts", import.meta.url), "utf8");
  assert.ok(validatorSrc.includes("export const MAX_FIELD_COUNT = 20"), "the setup's field ceiling moved");
  assert.ok(validatorSrc.includes("Pick the field — 1 to ${maxField}."));
  // The correction form picks from the event's fields; the old raise form keeps its division box until it is rebuilt.
  assert.ok(flagsSrc.includes("length: fieldCount"));
  assert.ok(pageSrc.includes("<FieldPicker"));
});

test("repeated history comes from the tested helper and cannot submit an automatic Major or DQ", () => {
  assert.ok(pageSrc.includes("refereeHistory(state.flags"));
  assert.ok(pageSrc.includes("rules, matchType, matchNumber, rulesetId"), "history must be scoped to the chosen ruleset");
  assert.ok(!/kind\s*=\s*["']major["']/.test(pageSrc));
  assert.ok(!/severity\s*=\s*["']major["']/.test(pageSrc));
  assert.ok(!pageSrc.includes('record("major")'));
  assert.ok(!pageSrc.includes('record("dq")'));
  assert.ok(pageSrc.includes("onClick={() => record(k.id)}"));
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
  assert.ok(flagsSrc.includes("ruleset: draftRuleset"));
  assert.match(flagsSrc, /k\.requiresRule && !draftRules\.length && !legacyKeep/);
});

test("the app's existing full wipe remains the active-event boundary", () => {
  assert.ok(fileStoreSrc.includes("loaded = empty()"));
  assert.match(
    postgresSrc,
    /truncate activity, notes, scores, conflicts, requests, teams, panels, referee_setup cascade/,
    "a full wipe must clear the referee setup with the rest of the event",
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
    "alliance: existing.alliance",
    '"match affecting"',
  ]) {
    assert.ok(patch.includes(label), `the PATCH before-snapshot lost ${label}`);
  }
  // Both halves are captured before updateFlag runs (the file store aliases).
  assert.ok(patch.indexOf("existing.rule,") < patch.indexOf("store().updateFlag("));
});
