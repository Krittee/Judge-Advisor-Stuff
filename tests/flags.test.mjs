import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/* Referee flags. A referee records what they saw on the field and the
   judges read it before they interview the team. Two things must not go
   wrong: a malformed request must never invent a violation against a
   team, and a flag must not reach anyone outside judging. */

const event = JSON.parse(readFileSync(new URL("../config/event.json", import.meta.url)));
const kinds = event.refereeFlags;

/* ---- the kinds themselves -------------------------------------------- */

test("the config offers praise and three weights of violation", () => {
  const ids = kinds.map((k) => k.id);
  assert.deepEqual(ids, ["good", "warning", "minor", "major"]);
});

test("severity orders them, with praise at the bottom", () => {
  const good = kinds.find((k) => k.id === "good");
  assert.equal(good.severity, 0, "praise must not outrank a violation");
  const violations = kinds.filter((k) => k.id !== "good");
  const ordered = [...violations].sort((a, b) => a.severity - b.severity).map((k) => k.id);
  assert.deepEqual(ordered, ["warning", "minor", "major"]);
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

test("the API refuses a flag with no text", () => {
  const src = readFileSync(new URL("../src/app/api/flags/route.ts", import.meta.url), "utf8");
  assert.ok(src.includes("Say what you saw"), "an empty flag is no use to a judge");
});

/* ---- match reference: which match and field a flag happened at -------- */

const types = event.matchTypes;

test("the config offers exactly Practice, Qualification and Final", () => {
  assert.deepEqual(
    types.map((t) => t.id),
    ["P", "Q", "F"],
  );
});

function isValidMatchType(input, list = types) {
  const wanted = String(input ?? "").trim();
  return list.some((t) => t.id === wanted);
}

test("a configured id is valid; anything else is not", () => {
  assert.ok(isValidMatchType("P"));
  assert.ok(isValidMatchType("Q"));
  assert.ok(isValidMatchType("F"));
  for (const bad of ["", "p", "practice", "X", null, undefined, "Practice"]) {
    assert.ok(!isValidMatchType(bad), `"${bad}" should not resolve to a match type`);
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
  const src = readFileSync(new URL("../src/app/api/flags/route.ts", import.meta.url), "utf8");
  assert.ok(src.includes("isValidMatchType(matchType)"), "match type is no longer validated");
  assert.ok(src.includes("isValidMatchNumber(matchNumber)"), "match number is no longer validated");
  assert.ok(src.includes("isValidField(field)"), "field is no longer validated");
  // Each of the three failure branches must return before createFlag runs.
  const createIdx = src.indexOf("store().createFlag");
  for (const check of ["isValidMatchType(matchType)", "isValidMatchNumber(matchNumber)", "isValidField(field)"]) {
    assert.ok(src.indexOf(check) < createIdx, `${check} does not run before the flag is created`);
  }
});

test("the activity log entry carries the match reference, so Activity can trace it too", () => {
  const src = readFileSync(new URL("../src/app/api/flags/route.ts", import.meta.url), "utf8");
  assert.ok(
    /detail:\s*`Team \$\{team\.number\} · \$\{matchType\}\$\{matchNumber\} · \$\{field\}`/.test(src),
    "the activity log no longer records which match a flag happened at",
  );
  // Not "· Field ${field}" -- a referee typing the box's own placeholder,
  // "Field 2", would otherwise read back as "Field Field 2".
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
  const postFn = src.slice(src.indexOf("export async function POST"), src.indexOf("export async function PATCH"));
  const patchFn = src.slice(src.indexOf("export async function PATCH"), src.indexOf("export async function DELETE"));
  assert.ok(postFn.includes("parseFlagFields(body)"), "POST no longer shares the validator");
  assert.ok(patchFn.includes("parseFlagFields(body)"), "PATCH no longer shares the validator");
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
    new Set(["kind", "body", "match_type", "match_number", "field"]),
    "updateFlag assigns a field beyond the correctable ones -- id, team_id, author and " +
      "created_at must stay fixed",
  );
});

test("the Postgres store's updateFlag only sets the correctable columns", () => {
  const src = readFileSync(new URL("../src/lib/db/postgres.ts", import.meta.url), "utf8");
  const signature = src.indexOf("async updateFlag(");
  assert.ok(signature !== -1, "updateFlag is missing from postgres.ts");
  const fn = src.slice(signature, signature + 700);

  // Read the SET clause specifically -- "where id = $1" is a lookup
  // condition, not a column being written, and must not be mistaken for
  // one the way a first draft of this test did.
  const setClause = /set\s+([\s\S]*?)\s+where\s+id\s*=/i.exec(fn);
  assert.ok(setClause, "updateFlag's SQL no longer has a recognisable set ... where id = shape");
  const columns = [...setClause[1].matchAll(/(\w+)\s*=\s*\$\d/g)].map((m) => m[1]);
  assert.deepEqual(
    new Set(columns),
    new Set(["kind", "body", "match_type", "match_number", "field"]),
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
