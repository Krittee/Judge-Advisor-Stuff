import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { RESETTABLE_STATUSES, resetAction } from "../src/components/admin/teamsLogic";

/* The Judge Advisor's interview-status reset control (admin > Teams > the
   drawer's Interview row). This exists to fix a mis-click, so it has to reach
   the whole floor and route each target status through whatever existing
   action actually gets it right. The routing is `resetAction` in
   src/components/admin/teamsLogic.ts, run for real here; what the control
   sends, and that it asks first, is in adminTeams.logic.test.mjs. */

const src = readFileSync(new URL("../src/app/admin/page.tsx", import.meta.url), "utf8");

test("the reset control is scoped to the admin-only page, no extra role check needed", () => {
  assert.ok(
    /session\?\.role !== "admin"[\s\S]{0,40}router\.replace/.test(src),
    "the admin page's own admin-only redirect is gone -- the reset control would no longer be " +
      "implicitly Judge Advisor only just by living on this page",
  );
});

test("resetting a finished request to 'requested' reopens it (clearing stale timestamps), not a bare set-status", () => {
  // set-status alone leaves finished_at/cancelled_at stale even though the status reads requested again.
  assert.equal(resetAction("completed", "requested"), "reopen");
  assert.equal(resetAction("cancelled", "requested"), "reopen");
  // The transition table refuses a reopen of a live request (status.ts), so
  // the override must not send one: it falls through to set-status, which
  // the route clears the timestamps for itself.
  for (const live of ["scheduled", "requested", "acknowledged", "interviewing"]) {
    assert.equal(resetAction(live, "requested"), "set-status", `${live} -> requested`);
  }
});

test("resetting an open request to 'cancelled' routes through cancel (which stamps cancelled_at)", () => {
  for (const open of ["scheduled", "requested", "acknowledged", "interviewing"]) {
    assert.equal(resetAction(open, "cancelled"), "cancel", `${open} -> cancelled`);
  }
  // A completed one cannot be cancelled (status.ts); the override still gets it there.
  assert.equal(resetAction("completed", "cancelled"), "set-status");
  assert.equal(resetAction("cancelled", "cancelled"), "set-status");
});

test("every other target status still goes through set-status", () => {
  for (const to of ["acknowledged", "interviewing", "completed"]) {
    for (const from of ["requested", "acknowledged", "interviewing", "completed", "cancelled"]) {
      assert.equal(resetAction(from, to), "set-status", `${from} -> ${to}`);
    }
  }
});

test("'scheduled' is deliberately excluded from the resettable statuses", () => {
  assert.ok(!RESETTABLE_STATUSES.includes("scheduled"), "scheduled crept back into the reset options");
  assert.deepEqual(RESETTABLE_STATUSES, ["requested", "acknowledged", "interviewing", "completed", "cancelled"]);
});
