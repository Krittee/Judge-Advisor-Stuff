import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/* The Judge Advisor's interview-status reset control (admin > Teams >
   Interview column). This exists to fix a mis-click, so it has to reach
   the whole floor and route each target status through whatever existing
   action actually gets it right -- source-checked, the way this repo
   pins down other subtle correctness details in .tsx it can't cheaply
   unit-test in isolation (see tests/refereeRuleFeature.test.mjs). */

const src = readFileSync(new URL("../src/app/admin/page.tsx", import.meta.url), "utf8");

test("the reset control is scoped to the admin-only page, no extra role check needed", () => {
  assert.ok(
    /session\?\.role !== "admin"[\s\S]{0,40}router\.replace/.test(src),
    "the admin page's own admin-only redirect is gone -- the reset control would no longer be " +
      "implicitly Judge Advisor only just by living on this page",
  );
});

test("resetting a finished request to 'requested' reopens it (clearing stale timestamps), not a bare set-status", () => {
  const fn = src.slice(src.indexOf("async function resetRequestStatus"), src.indexOf("\n  }", src.indexOf("async function resetRequestStatus")));
  assert.ok(
    fn.includes('status === "requested" && canTransition("reopen", request.status)\n          ? "reopen"'),
    "resetting a finished request to requested no longer routes through reopen -- set-status alone " +
      "leaves finished_at/cancelled_at stale even though the status reads requested again",
  );
  // The transition table refuses a reopen of a live request (status.ts), so
  // the override must not send one: it falls through to set-status, which
  // the route clears the timestamps for itself.
  assert.ok(
    fn.includes('canTransition("reopen", request.status)') && fn.includes(': "set-status"'),
    "the reset control must consult the transition table, or stepping a live request back to " +
      "requested would be refused by the server",
  );
});

test("resetting an open request to 'cancelled' routes through cancel (which stamps cancelled_at)", () => {
  const fn = src.slice(src.indexOf("async function resetRequestStatus"), src.indexOf("\n  }", src.indexOf("async function resetRequestStatus")));
  assert.ok(
    fn.includes('status === "cancelled" && canTransition("cancel", request.status)\n            ? "cancel"'),
    "resetting an open request to cancelled no longer routes through the cancel action -- " +
      "set-status alone never sets cancelled_at (a completed one cannot be cancelled: status.ts)",
  );
});

test("every other target status still goes through set-status, with the status field sent", () => {
  const fn = src.slice(src.indexOf("async function resetRequestStatus"), src.indexOf("\n  }", src.indexOf("async function resetRequestStatus")));
  assert.ok(fn.includes(': "set-status"'), "the fallback action is no longer set-status");
  assert.ok(
    fn.includes('action === "set-status" ? { status } : {}'),
    "set-status is no longer sent with the target status",
  );
});

test("'scheduled' is deliberately excluded from the resettable statuses", () => {
  const list = src.slice(src.indexOf("const RESETTABLE_STATUSES"), src.indexOf("];", src.indexOf("const RESETTABLE_STATUSES")));
  assert.ok(!list.includes('"scheduled"'), "scheduled crept back into the reset options");
  for (const s of ["requested", "acknowledged", "interviewing", "completed", "cancelled"]) {
    assert.ok(list.includes(`"${s}"`), `${s} is missing from the resettable statuses`);
  }
});
