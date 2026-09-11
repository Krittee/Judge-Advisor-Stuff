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

test("only Minor and Major are configured to require a rule", () => {
  const byId = Object.fromEntries(event.refereeFlags.map((kind) => [kind.id, kind]));
  assert.equal(byId.good.requiresRule, undefined);
  assert.equal(byId.warning.requiresRule, undefined);
  assert.equal(byId.minor.requiresRule, true);
  assert.equal(byId.major.requiresRule, true);
});

test("POST and PATCH both use the shared validator with server-side rule enforcement", () => {
  const post = routeSrc.slice(routeSrc.indexOf("export async function POST"), routeSrc.indexOf("export async function PATCH"));
  const patch = routeSrc.slice(routeSrc.indexOf("export async function PATCH"), routeSrc.indexOf("export async function DELETE"));

  assert.match(post, /parseFlagFields\(body\)/);
  assert.ok(!routeSrc.includes("requireRuleForSeverity"), "rule enforcement must not be optional");
  assert.match(patch, /allowLegacyRulelessKind:\s*existing\.rule \? null : existing\.kind/);
});

test("rule is stored and remains a correctable field, never a record identity", () => {
  assert.ok(fileStoreSrc.includes("rule: input.rule"));
  assert.ok(fileStoreSrc.includes("row.rule = edit.rule"));
  assert.ok(postgresSrc.includes("alter table flags add column if not exists rule text"));
  assert.ok(postgresSrc.includes("insert into flags"));
  assert.ok(!/on conflict[^;]*flags/is.test(postgresSrc), "flags must be inserted, not upserted by match/rule");
});

test("the page sends the selected rule and only resets it after a successful request", () => {
  const start = pageSrc.indexOf("async function record");
  const record = pageSrc.slice(start, pageSrc.indexOf("\n  }", start));
  assert.match(record, /body:\s*\{ teamId: team\.id, kind, body, matchType, matchNumber, field, rule \}/);
  assert.ok(record.indexOf("await call") < record.indexOf("setRule(null)"));
  assert.ok(record.includes('setBody("")'));
  assert.ok(!record.includes('setMatchType("")'));
  assert.ok(!record.includes('setMatchNumber("")'));
  assert.ok(!record.includes('setField("")'));
});

test("What did you see is optional in the UI and server path", () => {
  assert.ok(pageSrc.includes("(optional)"));
  assert.ok(!pageSrc.includes("!body.trim()"));
  assert.ok(!flagsSrc.includes("!draftBody.trim()"));
});

test("the selector remains one searchable control between observation and action buttons", () => {
  const observation = pageSrc.indexOf("What did you see?");
  const selector = pageSrc.indexOf("Rule violated");
  const actions = pageSrc.indexOf("{kinds.map((k) => {");
  assert.ok(observation < selector && selector < actions);
  assert.equal(pageSrc.match(/placeholder="Search: SG6/g)?.length, 1);
  assert.ok(!pageSrc.includes("choose category"));
  assert.ok(pageSrc.includes("break-words"));
  assert.ok(pageSrc.includes("overflow-y-auto"));
});

test("field selection combines the event division prefix (plus Skills) and field number", () => {
  assert.ok(pageSrc.includes('const FIELD_PREFIXES = ["ES", "MS", "HS", "BL", "SK"]'));
  assert.ok(pageSrc.includes("value={fieldPrefix}"));
  assert.ok(pageSrc.includes("value={fieldNumber}"));
  assert.ok(pageSrc.includes("normalizeField(`${fieldPrefix}${fieldNumber}`)"));
});

test("repeated history comes from the tested helper and cannot submit an automatic Major", () => {
  assert.ok(pageSrc.includes("refereeHistory(state.flags"));
  assert.ok(!/kind\s*=\s*["']major["']/.test(pageSrc));
  assert.ok(!/severity\s*=\s*["']major["']/.test(pageSrc));
  assert.ok(!pageSrc.includes('record("major")'));
  assert.ok(pageSrc.includes("onClick={() => record(k.id)}"));
  assert.ok(pageSrc.includes("Head Referee"));
});

test("Flagged Today renders each complete report and legacy null rules remain guarded", () => {
  const flaggedToday = pageSrc.slice(pageSrc.indexOf("Flagged today"));
  assert.ok(flaggedToday.includes("<FlagList flags={flags}"));
  assert.ok(flagsSrc.includes("ruleDisplayLabel(f.rule) ?"));
  assert.ok(flagsSrc.includes("matchReference(f.match_type, f.match_number) ?"));
});

test("correction UI carries the existing rule and blocks unsafe rule-less severity changes", () => {
  assert.ok(flagsSrc.includes("rule: f.rule"));
  assert.match(flagsSrc, /k\.requiresRule && !f\.rule && k\.id !== f\.kind/);
});

test("the app's existing full wipe remains the active-event boundary", () => {
  assert.ok(fileStoreSrc.includes("loaded = empty()"));
  assert.match(postgresSrc, /truncate activity, notes, scores, conflicts, requests, teams, panels cascade/);
  assert.ok(!/resetDay\(\)[\s\S]*truncate[^\n]*flags/.test(postgresSrc));
});
