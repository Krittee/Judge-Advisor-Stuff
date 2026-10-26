import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { NO_POLL, polled } from "../src/components/admin/activityLogic";
import { settleSave } from "../src/components/useRubricScoring";
import { fetchState } from "../src/components/useAppState";

/* Client-state fixes from the audit: BUG-017 (rapid score taps), BUG-025
   (polling errors) and the BUG-032 lint warning in the admin console. The
   hooks themselves need a browser, so the decisions they make are pulled out
   into plain functions and checked here; the few things that can only be
   wiring are checked against the source, in the style of mobile.test.mjs. */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
/** Comments explain the old behaviour by name, so match code only. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/* ---- BUG-017: rapid taps on different criteria ----------------------- */

const idle = { drained: true, burstFailed: false, burstOverlapped: false };

test("an older answer is not applied while another overlapping save is pending", () => {
  // Two taps in flight (requests 1 and 2). Answer 1 lands first and
  // describes the sheet without tap 2: applying it would knock tap 2 out.
  const first = settleSave({ mine: 1, newest: 2, ok: true, drained: false, burstFailed: false, burstOverlapped: true });
  assert.equal(first.apply, false);
  assert.equal(first.refetch, false);

  const second = settleSave({ mine: 2, newest: 2, ok: true, drained: true, burstFailed: false, burstOverlapped: true });
  assert.equal(second.apply, true);
  assert.equal(second.refetch, true);
});

test("a lone successful save uses its response without a reload", () => {
  const result = settleSave({ mine: 1, newest: 1, ok: true, ...idle });
  assert.deepEqual(result, { apply: true, refetch: false, burstFailed: false });
});

test("successful overlapping saves reload after the last answer, even when it is older", () => {
  // Request 2 can save first and return only criterion B. Request 1 then
  // saves A and B, but its response is older by tap number.
  const newestFirst = settleSave({ mine: 2, newest: 2, ok: true, drained: false, burstFailed: false, burstOverlapped: true });
  assert.equal(newestFirst.refetch, false);
  const olderLast = settleSave({ mine: 1, newest: 2, ok: true, drained: true, burstFailed: false, burstOverlapped: true });
  assert.equal(olderLast.apply, false);
  assert.equal(olderLast.refetch, true, "the stored combined row must replace the incomplete response");
});

test("a failure mid-burst is reconciled with the server, not rolled back to the prop", () => {
  // Tap 1 fails while tap 2 is still out: nothing to do yet.
  const failed = settleSave({ mine: 1, newest: 2, ok: false, drained: false, burstFailed: false, burstOverlapped: false });
  assert.deepEqual(failed, { apply: false, refetch: false, burstFailed: true });

  // Tap 2 succeeds and is the last one out: show its row, then ask the
  // server what is stored, because tap 1 may or may not have landed.
  const last = settleSave({ mine: 2, newest: 2, ok: true, drained: true, burstFailed: true, burstOverlapped: false });
  assert.deepEqual(last, { apply: true, refetch: true, burstFailed: false });
});

test("when the newest tap is the one that fails, the older answer is dropped and the server is asked", () => {
  const newestFailed = settleSave({ mine: 2, newest: 2, ok: false, drained: false, burstFailed: false, burstOverlapped: false });
  assert.equal(newestFailed.apply, false);
  assert.equal(newestFailed.refetch, false);

  const olderLast = settleSave({ mine: 1, newest: 2, ok: true, drained: true, burstFailed: true, burstOverlapped: false });
  assert.equal(olderLast.apply, false);
  assert.equal(olderLast.refetch, true);
});

test("a lone failure also asks the server instead of trusting the stale prop", () => {
  const r = settleSave({ mine: 1, newest: 1, ok: false, ...idle });
  assert.equal(r.refetch, true);
  assert.equal(r.apply, false);
});

test("useRubricScoring routes every save through settleSave and no longer rolls back to the prop", () => {
  // The save logic lives in the hook the team sheet calls; the markup stays in the sheet.
  const src = code(read("src/components/useRubricScoring.ts"));
  assert.match(src, /settleSave\(\{/);
  assert.ok(!/setValues\(score\?\.values/.test(src.replace(/useEffect\([\s\S]*?\[score\]\);/, "")));
  assert.ok(!/setSaving\b/.test(src), "a single saving key is back");
  assert.match(src, /useState<ReadonlySet<string>>/, "pending is a set of criteria, not one flag");
});

/* ---- BUG-025: the first fetch must not look like an empty roster ------ */

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

test("a failed first fetch yields no state, so nothing can mark the page loaded", async () => {
  const r500 = await fetchState(null, async () => new Response("nope", { status: 500 }));
  assert.deepEqual(r500, { kind: "failed" });

  const offline = await fetchState(null, async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.deepEqual(offline, { kind: "failed" });
});

test("a body that cannot be parsed fails and does not hand back its ETag", async () => {
  const r = await fetchState(null, async () => new Response("<html>", { headers: { ETag: '"a"' } }));
  assert.deepEqual(r, { kind: "failed" });
});

test("a good response returns the state with its own ETag; 304 is unchanged", async () => {
  let sent: HeadersInit | undefined;
  const ok = await fetchState('"old"', async (_url, init) => {
    sent = init?.headers;
    return json({ teams: [] }, { headers: { ETag: '"new"' } });
  });
  assert.deepEqual(sent, { "If-None-Match": '"old"' });
  assert.deepEqual(ok, { kind: "state", state: { teams: [] }, etag: '"new"' });

  const same = await fetchState('"new"', async () => new Response(null, { status: 304 }));
  assert.deepEqual(same, { kind: "unchanged" });
});

test("the hook marks loaded only when state arrived, and the team page says so when it did not", () => {
  const hook = code(read("src/components/useAppState.ts"));
  assert.equal(hook.match(/setLoaded\(true\)/g)?.length, 2, "one for useAppState, one for useScores");
  assert.match(hook, /result\.kind === "state"\)\s*\{[^}]*setLoaded\(true\)/);
  assert.ok(!/finally\s*\{\s*setLoaded\(true\)/.test(hook.slice(0, hook.indexOf("export function useScores"))));

  const team = code(read("src/app/team/[number]/page.tsx"));
  const gate = team.match(/if \(!loaded\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
  assert.match(gate, /online/, "the not-loaded screen must look at online");
  assert.match(gate, /Can't reach the server/);
});

test("the Activity tab clears its error once a poll succeeds", () => {
  const tab = code(read("src/components/admin/ActivityTab.tsx"));
  assert.match(tab, /setPoll\(\(p\) => polled\(p, \{ rows: activity \}/, "a success goes through polled");
  const failed = polled(NO_POLL, { error: "down" }, new Date());
  assert.equal(failed.error, "down");
  assert.equal(polled(failed, { rows: [] }, new Date()).error, null, "the next success is the recovery");
});

/* ---- BUG-032: the flags memo must not close over all of `state` -------- */

test("the Referee tab's flagged-teams memo has no `typeof state` type query", () => {
  const tab = code(read("src/components/admin/RefereeTab.tsx"));
  const memo = tab.match(/const rows = useMemo\(([\s\S]*?)\n  \);/)?.[1] ?? "";
  assert.ok(memo.length > 20, "could not find the flagged-teams memo");
  assert.ok(!/typeof state\b/.test(memo), "`typeof state` makes exhaustive-deps ask for all of state");
  assert.ok(/\[flags, kinds, teams\]/.test(memo), "its inputs are the three lists it reads, not the whole state");
});
