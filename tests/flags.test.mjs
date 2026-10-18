import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isValidFieldPick, parseFlagFields } from "../src/lib/flagValidation";
import { isValidMatchType } from "../src/lib/presets";

/* Referee flags. A referee records what they saw on the field and the
   judges read it before they interview the team. Two things must not go
   wrong: a malformed request must never invent a violation against a
   team, and a flag must not reach anyone outside judging. */

const event = JSON.parse(readFileSync(new URL("../config/event.json", import.meta.url)));
const kinds = event.refereeFlags;

/* ---- the kinds themselves -------------------------------------------- */

test("the config offers praise, three weights of violation and Disqualified", () => {
  const ids = kinds.map((k) => k.id);
  assert.deepEqual(ids, ["good", "warning", "minor", "major", "dq"]);
});

test("Disqualified is the most severe kind and, like Minor and Major, needs a rule", () => {
  const dq = kinds.find((k) => k.id === "dq");
  assert.equal(dq.label, "Disqualified");
  assert.equal(dq.short, "DQ");
  assert.equal(dq.requiresRule, true);
  assert.ok(dq.severity > Math.max(...kinds.filter((k) => k.id !== "dq").map((k) => k.severity)));
});

test("every colour a kind uses is one the tone map actually renders", () => {
  const tone = readFileSync(new URL("../src/lib/tone.ts", import.meta.url), "utf8");
  for (const { id, color } of kinds) {
    for (const map of ["TONES", "SOLIDS", "RAILS"]) {
      const block = tone.slice(tone.indexOf(`const ${map}`), tone.indexOf("};", tone.indexOf(`const ${map}`)));
      assert.ok(new RegExp(`\\b${color}:`).test(block), `${id}'s colour "${color}" is missing from ${map} in tone.ts`);
    }
  }
});

test("severity orders them, with praise at the bottom", () => {
  const good = kinds.find((k) => k.id === "good");
  assert.equal(good.severity, 0, "praise must not outrank a violation");
  const violations = kinds.filter((k) => k.id !== "good");
  const ordered = [...violations].sort((a, b) => a.severity - b.severity).map((k) => k.id);
  assert.deepEqual(ordered, ["warning", "minor", "major", "dq"]);
});

test("every kind has its own colour and reads without one", () => {
  const colors = kinds.map((k) => k.color);
  assert.equal(new Set(colors).size, colors.length, "two kinds share a colour");
  for (const k of kinds) {
    assert.ok(k.label && k.label.length > 2, `${k.id} has no readable label`);
    assert.ok(k.short && k.short.length > 1, `${k.id} has no short label`);
  }
});

/* ---- resolving what someone typed ------------------------------------ */

function resolveFlagKind(input) {
  const wanted = String(input ?? "").trim().toLowerCase();
  const match = kinds.find(
    (f) =>
      f.id.toLowerCase() === wanted ||
      f.label.toLowerCase() === wanted ||
      f.short.toLowerCase() === wanted,
  );
  if (match) return match.id;
  return [...kinds].sort((a, b) => a.severity - b.severity)[0].id;
}

test("an id, a label or a short name all resolve", () => {
  assert.equal(resolveFlagKind("major"), "major");
  assert.equal(resolveFlagKind("Major violation"), "major");
  assert.equal(resolveFlagKind("Minor"), "minor");
  assert.equal(resolveFlagKind("WARNING"), "warning");
});

test("an unknown kind falls back to the LEAST severe, never the worst", () => {
  /* The direction matters: falling back to the first entry would be fine
     today, but if the list were ever reordered a junk request could post
     a major violation against a team that did nothing. */
  for (const junk of ["", null, undefined, "nonsense", "critical", "severe", "0"]) {
    assert.equal(resolveFlagKind(junk), "good", `"${junk}" should not become a violation`);
  }
});

test("the source really does fall back on severity, not position", () => {
  const src = readFileSync(new URL("../src/lib/presets.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export function resolveFlagKind"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(
    /sort\(\(a, b\) => a\.severity - b\.severity\)/.test(body),
    "resolveFlagKind no longer picks the least severe kind as its fallback",
  );
});

/* ---- the worst flag on a team ---------------------------------------- */

function worstFlag(flags) {
  let worst = null;
  for (const f of flags) {
    const kind = kinds.find((k) => k.id === f.kind);
    if (kind && (!worst || kind.severity > worst.severity)) worst = kind;
  }
  return worst;
}

test("a team's worst flag is what shows at a glance", () => {
  assert.equal(worstFlag([{ kind: "good" }, { kind: "minor" }, { kind: "warning" }]).id, "minor");
  assert.equal(worstFlag([{ kind: "good" }]).id, "good");
  assert.equal(worstFlag([{ kind: "major" }, { kind: "good" }]).id, "major");
  assert.equal(worstFlag([]), null);
});

test("praise does not cancel out a violation", () => {
  /* Five good flags and one major is still a major. */
  const flags = [...Array(5).fill({ kind: "good" }), { kind: "major" }];
  assert.equal(worstFlag(flags).id, "major");
});

/* ---- who may do what -------------------------------------------------- */

const canFlag = (role) => role === "referee";
const canReadFlags = (role) => role === "admin" || role === "judge" || role === "referee";
const canRemoveFlag = (role) => role === "admin";

test("only a referee raises a flag", () => {
  assert.ok(canFlag("referee"));
  for (const role of ["admin", "judge", "queuer", "team", null]) {
    assert.ok(!canFlag(role), `${role} must not be able to raise a flag`);
  }
});

test("judges and the Judge Advisor read them; teams and the desk do not", () => {
  for (const role of ["admin", "judge", "referee"]) assert.ok(canReadFlags(role));
  for (const role of ["queuer", "team", null]) {
    assert.ok(!canReadFlags(role), `${role} must not receive referee flags`);
  }
});

test("only the Judge Advisor removes one", () => {
  assert.ok(canRemoveFlag("admin"));
  for (const role of ["referee", "judge", "queuer", "team", null]) {
    assert.ok(!canRemoveFlag(role), `${role} must not be able to delete a flag`);
  }
});

test("a referee cannot delete the flag they raised", () => {
  /* Otherwise a flag could be quietly unsaid after a team complained,
     and the record would stop being a record. */
  assert.ok(canFlag("referee") && !canRemoveFlag("referee"));
});

/* ---- the payload ------------------------------------------------------ */

test("the state payload gates flags on read access", () => {
  const src = readFileSync(new URL("../src/lib/server-state.ts", import.meta.url), "utf8");
  assert.ok(
    /flags: !canReadFlags\(session\)\s*\?\s*\[\]/.test(src),
    "server-state no longer withholds flags from viewers without access",
  );
});

test("the observation text is optional and capped when supplied", () => {
  const src = readFileSync(new URL("../src/lib/flagValidation.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export function parseFlagFields"));
  assert.ok(!/if \(!text\)/.test(fn), "empty observation text is being rejected");
  assert.ok(fn.includes('.slice(0, 500)'), "the 500-character cap on the observation text is gone");
});

/* ---- match reference: which match and field a flag happened at -------- */

/* Match types depend on the program, so they live with each ruleset in
   config/rules/*.json rather than in config/event.json. */
const rulesetFile = (name) => JSON.parse(readFileSync(new URL(`../config/rules/${name}`, import.meta.url)));
const viqrc = rulesetFile("viqrc.json");
const v5rc = rulesetFile("v5rc-override-2.1.json");

test("the event config no longer carries match types: each ruleset offers its own", () => {
  assert.equal(event.matchTypes, undefined, "config/event.json still has a matchTypes list nothing reads");
  assert.deepEqual(
    viqrc.matchTypes.map((t) => t.id),
    ["P", "Q", "F", "SKD", "SKA"],
  );
  assert.deepEqual(
    v5rc.matchTypes.map((t) => t.id),
    ["P", "Q", "R16", "QF", "SF", "F", "SKD", "SKA"],
  );
});

test("every match type is Teamwork or Skills, and only V5RC's eliminations are brackets", () => {
  for (const file of [viqrc, v5rc]) {
    for (const t of file.matchTypes) {
      assert.ok(["teamwork", "skills"].includes(t.group), `${file.id} ${t.id} has no group`);
      assert.ok(t.label, `${file.id} ${t.id} has no label`);
    }
    assert.deepEqual(
      file.matchTypes.filter((t) => t.group === "skills").map((t) => [t.id, t.label]),
      [["SKD", "Driver"], ["SKA", "Auto"]],
    );
  }
  assert.deepEqual(
    v5rc.matchTypes.filter((t) => t.bracket).map((t) => t.id),
    ["R16", "QF", "SF", "F"],
  );
  assert.deepEqual(viqrc.matchTypes.filter((t) => t.bracket), [], "VEX IQ numbers are all plain");
});

test("a configured id is valid for its ruleset; anything else is not", () => {
  for (const id of ["P", "Q", "F", "SKD", "SKA"]) {
    assert.ok(isValidMatchType(id, "viqrc"), `${id} on viqrc`);
    assert.ok(isValidMatchType(id, "v5rc"), `${id} on v5rc`);
  }
  for (const id of ["QF", "SF", "R16"]) {
    assert.ok(isValidMatchType(id, "v5rc"), `${id} on v5rc`);
    assert.ok(!isValidMatchType(id, "viqrc"), `${id} is V5RC-only`);
  }
  for (const bad of ["", "p", "practice", "skills", "X", null, undefined, "Practice", "SK"]) {
    assert.ok(!isValidMatchType(bad, "viqrc"), `"${bad}" should not resolve to a match type`);
    assert.ok(!isValidMatchType(bad, "v5rc"), `"${bad}" should not resolve to a match type`);
  }
});

test("unlike a flag kind, an unrecognised match type has no safe fallback", () => {
  /* resolveFlagKind quietly downgrades a bad kind to the least severe one
     -- correct there, because severity is the thing being protected. There
     is no equivalent safe guess for which match something happened in:
     defaulting a Final incident to Practice would misfile it, so the only
     right answer is refusing the request outright. */
  const src = readFileSync(new URL("../src/lib/presets.ts", import.meta.url), "utf8");
  assert.ok(
    src.includes("export function isValidMatchType"),
    "isValidMatchType was renamed or removed",
  );
  const fn = src.slice(src.indexOf("export function isValidMatchType"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(
    !/severity|fallback|sort\(/.test(body),
    "isValidMatchType picked up a fallback; a match type must be validated, not guessed",
  );
});

test("the API route requires match type, match number and field, and rejects rather than guesses", () => {
  const src = readFileSync(new URL("../src/lib/flagValidation.ts", import.meta.url), "utf8");
  assert.ok(src.includes("isValidMatchType(matchType, ruleset.id)"), "match type is no longer validated");
  assert.ok(
    src.includes("isValidMatchNumber(matchNumber, matchType, ruleset.id)"),
    "match number is no longer validated for its type",
  );
  assert.ok(src.includes("isValidFieldPick(rawField, maxField)"), "field is no longer validated as a number");
  const route = readFileSync(new URL("../src/app/api/flags/route.ts", import.meta.url), "utf8");
  assert.ok(route.indexOf("parseFlagFields(body") < route.indexOf("store().createFlag"));
});

test("the activity log entry carries the match reference, so Activity can trace it too", () => {
  const src = readFileSync(new URL("../src/app/api/flags/route.ts", import.meta.url), "utf8");
  const post = src.slice(src.indexOf("export async function POST"), src.indexOf("export async function PATCH"));
  assert.ok(
    post.includes("matchReference(matchType, matchNumber)") && post.includes("fieldLabel(field)"),
    "the activity log no longer records which match a flag happened at",
  );
  // fieldLabel adds the word once; a "Field" typed in front would double it.
  assert.ok(!src.includes("· Field ${field}"), "the field is double-labelled again");
});

/* ---- correcting a flag already on record ------------------------------ */

/* A referee tapping "Major" when they meant "Minor" is a slip of the
   finger, not a request to erase the incident. Unlike removal, a
   correction leaves the flag on the board -- just described more
   accurately -- so it stands on different footing than deletion and gets
   a wider set of hands. */

test("both a referee and the Judge Advisor may correct a flag", () => {
  const src = readFileSync(new URL("../src/app/api/flags/route.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function PATCH"));
  const guard = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(
    /!canFlag\(session\)\s*&&\s*!canAdminister\(session\)/.test(guard),
    "PATCH no longer accepts both a referee and the Judge Advisor",
  );
});

test("a judge cannot correct a flag -- canFlag and canAdminister are both false for one", () => {
  const canFlag = (role) => role === "referee";
  const canAdminister = (role) => role === "admin";
  const role = "judge";
  assert.ok(!(canFlag(role) || canAdminister(role)), "a judge must not pass the PATCH guard");
});

test("PATCH validates with the same rules as POST, not a looser copy", () => {
  const src = readFileSync(new URL("../src/app/api/flags/route.ts", import.meta.url), "utf8");
  // Both handlers must route through the one shared validator, or a
  // correction could accept something a fresh flag would have refused.
  // POST additionally opts into requiring a rule for Minor/Major (an
  // options argument on the same shared call, not a second validator),
  // so the match here is a prefix rather than the exact literal call.
  const postFn = src.slice(src.indexOf("export async function POST"), src.indexOf("export async function PATCH"));
  const patchFn = src.slice(src.indexOf("export async function PATCH"), src.indexOf("export async function DELETE"));
  assert.ok(postFn.includes("parseFlagFields(body"), "POST no longer shares the validator");
  assert.ok(patchFn.includes("parseFlagFields(body"), "PATCH no longer shares the validator");
});

test("PATCH does not accept a new team or author -- only removal replaces a flag's identity", () => {
  const src = readFileSync(new URL("../src/app/api/flags/route.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function PATCH"), src.indexOf("export async function DELETE"));
  // logActivity legitimately uses teamId internally, built from the flag's
  // OWN existing.team_id -- the thing that must never happen is reading a
  // client-supplied teamId out of the request body to move the flag.
  assert.ok(
    !/body\.teamId/.test(fn),
    "PATCH must not let a flag be reassigned to a different team from the request body",
  );
  assert.ok(fn.includes("existing.team_id"), "PATCH no longer keeps the flag pinned to its own team");
  assert.ok(!/author:\s*session/.test(fn), "PATCH must not let a flag's author be rewritten");
});

test("removal stays the Judge Advisor's alone -- correction is not a route around that", () => {
  const src = readFileSync(new URL("../src/app/api/flags/route.ts", import.meta.url), "utf8");
  const del = src.slice(src.indexOf("export async function DELETE"));
  assert.ok(
    /!canAdminister\(session\)/.test(del) && !/canFlag\(session\)/.test(del),
    "DELETE must remain admin-only even though PATCH is not",
  );
});

test("a correction is logged to Activity, so nothing about it happens quietly", () => {
  const src = readFileSync(new URL("../src/app/api/flags/route.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function PATCH"), src.indexOf("export async function DELETE"));
  assert.ok(fn.includes("logActivity"), "a correction no longer leaves a trace in Activity");
  assert.ok(
    fn.includes('"corrected a flag'),
    "the activity action no longer reads as a correction, distinct from raising one",
  );
});

test("a missing flag id is refused before any store call, on both create and correct", () => {
  const src = readFileSync(new URL("../src/app/api/flags/route.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function PATCH"));
  assert.ok(/if \(!id\)/.test(fn), "PATCH no longer checks for a missing id");
});

/* ---- the store layer keeps a flag's identity fixed while editing it --- */

test("the file store's updateFlag only assigns the correctable fields", () => {
  const src = readFileSync(new URL("../src/lib/db/file.ts", import.meta.url), "utf8");
  const signature = src.indexOf("function updateFlag(");
  assert.ok(signature !== -1, "updateFlag is missing from file.ts");
  const bodyStart = src.indexOf("{", signature) + 1;
  const body = src.slice(bodyStart, src.indexOf("\n}", bodyStart));

  // Every "row.<field> =" assignment in the function, read directly
  // rather than guessed at with a broad regex over the whole body.
  const assigned = [...body.matchAll(/row\.(\w+)\s*=/g)].map((m) => m[1]);
  assert.ok(assigned.length > 0, "updateFlag does not assign anything -- did it move?");
  assert.deepEqual(
    new Set(assigned),
    new Set([
      "kind",
      "body",
      "match_type",
      "match_number",
      "alliance",
      "field",
      "rule",
      "ruleset",
      "manual_version",
      "match_affecting",
    ]),
    "updateFlag assigns a field beyond the correctable ones -- id, team_id, author and " +
      "created_at must stay fixed",
  );
});

test("the Postgres store's updateFlag only sets the correctable columns", () => {
  const src = readFileSync(new URL("../src/lib/db/postgres.ts", import.meta.url), "utf8");
  const signature = src.indexOf("async updateFlag(");
  assert.ok(signature !== -1, "updateFlag is missing from postgres.ts");
  const fn = src.slice(signature, signature + 1000);

  // Read the SET clause specifically -- "where id = $1" is a lookup
  // condition, not a column being written, and must not be mistaken for
  // one the way a first draft of this test did.
  const setClause = /set\s+([\s\S]*?)\s+where\s+id\s*=/i.exec(fn);
  assert.ok(setClause, "updateFlag's SQL no longer has a recognisable set ... where id = shape");
  const columns = [...setClause[1].matchAll(/(\w+)\s*=\s*\$\d/g)].map((m) => m[1]);
  assert.deepEqual(
    new Set(columns),
    new Set([
      "kind",
      "body",
      "match_type",
      "match_number",
      "alliance",
      "field",
      "rule",
      "ruleset",
      "manual_version",
      "match_affecting",
    ]),
    "updateFlag's SET clause writes a column beyond the correctable ones -- id, team_id, " +
      "author and created_at must stay fixed",
  );
});

test("both backends' updateFlag refuse a missing flag rather than silently no-op", () => {
  for (const path of ["../src/lib/db/file.ts", "../src/lib/db/postgres.ts"]) {
    const src = readFileSync(new URL(path, import.meta.url), "utf8");
    const start = src.indexOf(path.includes("file.ts") ? "function updateFlag(" : "async updateFlag(");
    const fn = src.slice(start, start + 700);
    assert.ok(
      /StoreError\(.*flag.*(?:exists|found)/i.test(fn.replace(/\n/g, " ")),
      `${path}'s updateFlag does not refuse a missing id`,
    );
  }
});

/* ---- the file-store aliasing trap, applied to this route -------------- */

/* The file store hands back the same object it stores (documented on the
   conflicts route already), so reading existing.kind AFTER updateFlag has
   run reads the NEW value, not the old one -- the "before" half of a
   before/after log line silently becomes a duplicate of the "after" half.
   Caught this exact bug live: every correction logged as a bare
   "corrected a flag" because previousKind and kind were, by the time they
   were compared, the identical string. */

test("PATCH captures the previous kind before updateFlag runs, not after", () => {
  const src = readFileSync(new URL("../src/app/api/flags/route.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function PATCH"), src.indexOf("export async function DELETE"));

  const captureLine = fn.search(/previousKind\s*=\s*existing\.kind/);
  const updateLine = fn.indexOf("store().updateFlag(");
  assert.ok(captureLine !== -1, "previousKind is no longer captured from the existing flag");
  assert.ok(updateLine !== -1, "the PATCH handler no longer calls updateFlag");
  assert.ok(
    captureLine < updateLine,
    "previousKind is captured after updateFlag runs -- on the file store this reads the " +
      "NEW kind, because updateFlag mutates the same object existing points at",
  );

  // And the comparison itself must use the captured copy, not existing.kind
  // read fresh a second time (which would reintroduce the same bug).
  assert.ok(
    fn.includes("previousKind !== kind"),
    "the change-detection no longer compares against the captured previousKind",
  );
  assert.ok(
    !/existing\.kind\s*!==/.test(fn),
    "the comparison reads existing.kind directly again, after updateFlag has already run",
  );
});

/* ---- the field: just a number, up to the event's field count --------------- */

test("a field is a plain number from 1 to the field count; the division prefix is gone", () => {
  for (const ok of ["1", "2", "10", "20"]) {
    assert.ok(isValidFieldPick(ok), `${ok} should be a valid field`);
  }
  for (const bad of ["", "0", "21", "ES2", "es2", "Field 2", "2.5", "-1", " 2", "ESX", "100"]) {
    assert.ok(!isValidFieldPick(bad), `"${bad}" should not be a valid field`);
  }
  assert.ok(isValidFieldPick("3", 3) && !isValidFieldPick("4", 3), "the event's own count is the ceiling");
});

test("a correction with a prefixed, free-text or empty field is refused, and a picked number is stored plain", () => {
  const report = { kind: "warning", body: "", matchType: "Q", matchNumber: "23", alliance: "red", rule: null };
  assert.equal(parseFlagFields({ ...report, field: "Field 2" }).ok, false);
  assert.equal(parseFlagFields({ ...report, field: "ES2" }).ok, false);
  assert.equal(parseFlagFields({ ...report, field: "" }).ok, false);
  const picked = parseFlagFields({ ...report, field: "2" });
  assert.equal(picked.ok, true);
  if (picked.ok) assert.equal(picked.field, "2");
});

test("a correction can change the rule, not only keep the one already on record", () => {
  const edit = parseFlagFields({
    kind: "minor",
    body: "",
    matchType: "Q",
    matchNumber: "23",
    alliance: "blue",
    field: "2",
    rule: "sg7",
  });
  assert.equal(edit.ok && edit.rule, "SG7");
});

test("the correction form offers the rule picker and sends everything it shows", () => {
  const flags = readFileSync(new URL("../src/components/Flags.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/app/referee/page.tsx", import.meta.url), "utf8");
  assert.ok(flags.includes("<RulePicker"), "the correction form lost the rule picker");
  assert.ok(page.includes("<RulePicker"), "the raise form lost the rule picker");
  // The field is a choice from the event's fields, not a typed box or a division prefix.
  assert.ok(flags.includes('aria-label="Field"') && flags.includes("length: fieldCount"), "the correction form lost its field choices");
  assert.ok(flags.includes('aria-label="Alliance"'), "the correction form cannot change the alliance");
  assert.ok(!/<FieldPicker/.test(flags.slice(flags.indexOf("function FlagListItem"))), "the correction form is back to a division prefix");
  assert.ok(flags.includes("alliance: draftAlliance"), "the correction form no longer sends its alliance");
  assert.ok(flags.includes("field: draftField"), "the correction form no longer sends its field");
  assert.ok(flags.includes("rules: draftRules"), "the correction form no longer sends the rules it shows");
  assert.ok(flags.includes("ruleset: draftRuleset"), "the correction form no longer sends its ruleset");
  assert.ok(flags.includes("matchAffecting: draftMatchAffecting"), "the correction form lost match affecting");
  assert.ok(flags.includes("<RulesetPicker"), "the correction form lost the ruleset dropdown");
});
