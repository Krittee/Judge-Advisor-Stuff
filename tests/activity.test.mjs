import assert from "node:assert/strict";
import test from "node:test";

import { actorParts, deriveKind, readActivity, splitActor } from "../src/lib/activity";

/* The pure half of the Activity data change: what a new entry stores for its
   actor, and how an entry written before kinds existed is read. Both stores
   read through readActivity, so this is the one place the rules are pinned. */

test("a new entry stores the plain name and the role it acted in", () => {
  assert.deepEqual(actorParts({ role: "admin", name: "Alex" }), { actor: "Alex", actorRole: "Judge Advisor" });
  assert.deepEqual(actorParts({ role: "queuer", name: "Sam" }), { actor: "Sam", actorRole: "Front desk" });
  assert.deepEqual(actorParts({ role: "referee", name: "Jordan" }), { actor: "Jordan", actorRole: "Referee" });
  assert.deepEqual(
    actorParts({ role: "judge", name: "Priya", panelId: "p2", panelName: "Panel 2" }),
    { actor: "Priya", actorRole: "Panel 2" },
    "a judge's role is their panel's real name",
  );
  assert.deepEqual(actorParts(null), { actor: "team", actorRole: "Team" }, "no session is a team");
});

test("old actor labels split into a name and a role: role:Name, Name (Panel N), team", () => {
  assert.deepEqual(splitActor("admin:Alex"), { actor: "Alex", role: "Judge Advisor" });
  assert.deepEqual(splitActor("queuer:Sam"), { actor: "Sam", role: "Front desk" });
  assert.deepEqual(splitActor("referee:Jordan"), { actor: "Jordan", role: "Referee" });
  assert.deepEqual(splitActor("Priya Nair (Panel 2)"), { actor: "Priya Nair", role: "Panel 2" });
  assert.deepEqual(splitActor("team"), { actor: "team", role: "Team" });

  // The role is the LAST parenthesis, and a prefixed name keeps its own.
  assert.deepEqual(splitActor("Amy (Hi) (Panel A)"), { actor: "Amy (Hi)", role: "Panel A" });
  assert.deepEqual(splitActor("admin:Alex (JA)"), { actor: "Alex (JA)", role: "Judge Advisor" });
  assert.deepEqual(splitActor("Someone"), { actor: "Someone", role: null }, "a label in no known form is left alone");
});

test("an old entry's kind follows from its request, then its action", () => {
  const kind = (request_id, action) => deriveKind({ request_id, action });

  assert.equal(kind("r1", "→ Interview in progress"), "request");
  assert.equal(kind("r1", "declared a conflict of interest"), "request", "a request link wins over what it says");

  assert.equal(kind(null, "flagged minor"), "referee");
  assert.equal(kind(null, "corrected a flag"), "referee");
  assert.equal(kind(null, "corrected a flag: warning → minor"), "referee");

  assert.equal(kind(null, "declared a conflict of interest"), "conflict");
  assert.equal(kind(null, "declared conflicts of interest"), "conflict");
  assert.equal(kind(null, "withdrew a conflict of interest"), "conflict");

  assert.equal(kind(null, "Referee setup: V5RC, 3 fields"), "setup");
  assert.equal(kind(null, "added a judge"), "setup");
  assert.equal(kind(null, "removed a judge"), "setup", "only the action counts, not the detail's mention of conflicts");
});

const stored = {
  id: "a1",
  request_id: null,
  team_id: "t1",
  detail: null,
  created_at: "2026-10-20T09:00:00.000Z",
};

test("readActivity derives kind and role for an old entry, and leaves a new one as it was stored", () => {
  const old = readActivity(
    { ...stored, kind: null, actor_role: null, actor: "Priya (Panel 2)", action: "flagged minor" },
    "9882K",
  );
  assert.deepEqual(
    [old.kind, old.actor, old.actor_role, old.team_number],
    ["referee", "Priya", "Panel 2", "9882K"],
  );

  // A new entry's actor is already a plain name: a name that merely LOOKS like an old label is not split again.
  const fresh = readActivity(
    { ...stored, kind: "setup", actor_role: "Judge Advisor", actor: "Sam (Jr)", action: "added a judge" },
    null,
  );
  assert.deepEqual(
    [fresh.kind, fresh.actor, fresh.actor_role, fresh.team_number],
    ["setup", "Sam (Jr)", "Judge Advisor", null],
  );
});
