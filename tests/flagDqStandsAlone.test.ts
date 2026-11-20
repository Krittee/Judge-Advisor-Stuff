import assert from "node:assert/strict";
import test from "node:test";

import { canonicalFlagKind, refereeFlags, resolveFlagKind } from "../src/lib/presets";
import { tone, toneRail, toneSolid } from "../src/lib/tone";

/* A Major violation IS a disqualification, so the kind is gone and DQ stands
   alone. A stale phone, an old flag or an old log line that still says
   "major" must read as DQ -- never as nothing, never as Good conduct. */

test("the config no longer offers a Major kind", () => {
  assert.deepEqual(refereeFlags().map((k) => k.id), ["good", "warning", "minor", "dq"]);
});

test("a stale 'major' resolves to DQ, never to the least severe kind", () => {
  for (const input of ["major", "Major", "MAJOR violation".replace(" violation", ""), "Major violation", " major "]) {
    assert.equal(resolveFlagKind(input), "dq", input);
  }
  assert.equal(canonicalFlagKind("major"), "dq");
  assert.equal(canonicalFlagKind("minor"), "minor");
  assert.equal(resolveFlagKind("nonsense"), "good", "an unknown kind is still the safest one");
});

test("DQ no longer looks like the rose (danger) tone, and its pill is solid", () => {
  assert.notEqual(tone("black"), tone("rose"));
  assert.notEqual(toneSolid("black"), toneSolid("rose"));
  assert.notEqual(toneRail("black"), toneRail("rose"));
  const bg = tone("black").split(" ").find((c) => c.startsWith("bg-"));
  assert.ok(bg && !bg.includes("/"), `the DQ pill background must be solid, got ${bg}`);
});
