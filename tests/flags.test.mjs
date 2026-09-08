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
