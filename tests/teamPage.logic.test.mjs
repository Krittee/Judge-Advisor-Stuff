import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  agoParts,
  bigTimeOf,
  canCancel,
  cancelAfterAsking,
  cancelPrompt,
  clockParts,
  earlierToday,
  historyTime,
  stepTime,
  toneOf,
  trackSteps,
} from "../src/components/team/teamLogic";
import { formatClock } from "../src/components/ui";

/* The team page's decisions, run for real against
   src/components/team/teamLogic.ts. How they are drawn is in
   teamPage.runtime.test.tsx. */

const NOW = Date.parse("2026-10-20T10:00:00.000Z");
const ago = (mins) => new Date(NOW - mins * 60_000).toISOString();
const SLOT = "2026-10-20T14:40:00.000Z";

const request = (over) => ({
  id: "r1", team_id: "t1", panel_id: "p2", status: "requested", kind: "queue", language: "en",
  slot_start: null, slot_end: null, message: null, requested_at: ago(4), acknowledged_at: null,
  started_at: null, finished_at: null, cancelled_at: null, ...over,
});

const states = (steps) => steps.map((s) => s.state);

/* ---- the track ------------------------------------------------------------------- */

test("a team with nothing in progress has five steps still to come, and no times", () => {
  const steps = trackSteps(null);
  assert.deepEqual(steps.map((s) => s.label), ["Booked", "Requested", "On the way", "Interviewing", "Complete"]);
  assert.deepEqual(states(steps), ["todo", "todo", "todo", "todo", "todo"]);
  assert.ok(steps.every((s) => s.at === null));
});

test("a booking is the current step, with its slot time, and everything after it is to come", () => {
  const steps = trackSteps(request({ status: "scheduled", kind: "slot", slot_start: SLOT }));
  assert.deepEqual(states(steps), ["current", "todo", "todo", "todo", "todo"]);
  assert.deepEqual(steps[0].at, { kind: "clock", iso: SLOT });
});

test("a queue request: Booked is 'not used', Requested is current and says how long ago", () => {
  const steps = trackSteps(request({ status: "requested" }));
  assert.deepEqual(states(steps), ["skipped", "current", "todo", "todo", "todo"]);
  assert.equal(steps[0].at, null, "nothing was booked, so there is no slot time");
  assert.deepEqual(steps[1].at, { kind: "ago", iso: ago(4) });
});

test("judges on their way: Requested is done (with its time), On the way is current", () => {
  const steps = trackSteps(request({ status: "acknowledged" }));
  assert.deepEqual(states(steps), ["skipped", "done", "current", "todo", "todo"]);
  assert.deepEqual(steps[1].at, { kind: "ago", iso: ago(4) });
  assert.equal(steps[2].at, null);
});

test("interviewing: three steps behind, Complete still ahead", () => {
  assert.deepEqual(states(trackSteps(request({ status: "interviewing", started_at: ago(2) }))), ["skipped", "done", "done", "current", "todo"]);
});

test("a booked team the judges took on early keeps its Booked tick and slot time, and shows no 'requested' time", () => {
  // Its requested_at is when it was booked, so "3 h ago" would be about a request nobody made.
  const steps = trackSteps(request({ status: "acknowledged", kind: "slot", slot_start: SLOT, requested_at: ago(180) }));
  assert.deepEqual(states(steps), ["done", "done", "current", "todo", "todo"]);
  assert.deepEqual(steps[0].at, { kind: "clock", iso: SLOT });
  assert.equal(steps[1].at, null);
});

test("'ready now' leaves a queue request with no slot, so the booking it gave up reads as not used", () => {
  // Exactly what the server writes for ready-now: kind queue, slot cleared, requested_at renewed.
  const steps = trackSteps(request({ status: "requested", kind: "queue", slot_start: null, slot_end: null, requested_at: ago(0) }));
  assert.equal(steps[0].state, "skipped");
  assert.equal(steps[0].at, null);
});

test("a finished or dropped request is not a step: completed ends on Complete, cancelled reads as idle", () => {
  assert.deepEqual(states(trackSteps(request({ status: "completed" }))), ["skipped", "done", "done", "done", "current"]);
  assert.deepEqual(states(trackSteps(request({ status: "cancelled" }))), ["todo", "todo", "todo", "todo", "todo"]);
});

test("each step wears the status it stands for", () => {
  assert.deepEqual(trackSteps(null).map((s) => toneOf(s.status)), ["booked", "waiting", "enroute", "active", "done"]);
  assert.equal(toneOf("cancelled"), "off");
});

/* ---- the big time ----------------------------------------------------------------- */

test("the panel's big time: a slot, how long ago it was requested, or how long ago it started", () => {
  assert.deepEqual(bigTimeOf(request({ status: "scheduled", kind: "slot", slot_start: SLOT })), { label: "Booked slot", at: { kind: "clock", iso: SLOT } });
  assert.deepEqual(bigTimeOf(request({ status: "requested" })), { label: "Requested", at: { kind: "ago", iso: ago(4) } });
  assert.deepEqual(bigTimeOf(request({ status: "acknowledged" })), { label: "Requested", at: { kind: "ago", iso: ago(4) } });
  assert.deepEqual(bigTimeOf(request({ status: "interviewing", started_at: ago(12) })), { label: "Started", at: { kind: "ago", iso: ago(12) } });
});

test("a booking judges took on early keeps showing its slot, not when it was booked", () => {
  assert.deepEqual(bigTimeOf(request({ status: "acknowledged", kind: "slot", slot_start: SLOT, requested_at: ago(180) })), { label: "Booked slot", at: { kind: "clock", iso: SLOT } });
});

test("no time is invented: an interview with no start, or a finished request, has none", () => {
  assert.equal(bigTimeOf(request({ status: "interviewing", started_at: null })), null);
  assert.equal(bigTimeOf(request({ status: "completed" })), null);
});

test("times read as a person would: '4 min ago', 'just now', '1h 5m ago'", () => {
  assert.deepEqual(agoParts(ago(4), NOW), { text: "4 min", suffix: "ago" });
  assert.deepEqual(agoParts(ago(0), NOW), { text: "just now", suffix: "" });
  assert.deepEqual(agoParts(ago(65), NOW), { text: "1h 5m", suffix: "ago" });
  assert.deepEqual(agoParts(new Date(NOW + 60_000).toISOString(), NOW), { text: "just now", suffix: "" }, "a clock a little ahead never reads as negative");
  assert.equal(stepTime({ kind: "ago", iso: ago(4) }, NOW), "4 min ago");
  assert.equal(stepTime({ kind: "ago", iso: ago(0) }, NOW), "just now");
  assert.equal(stepTime({ kind: "clock", iso: SLOT }, NOW), formatClock(SLOT));
});

test("a clock time splits into big digits and a small AM/PM, and puts back the same time", () => {
  const { time, period } = clockParts(SLOT);
  assert.match(time, /^\d{1,2}:\d{2}$/);
  assert.equal([time, period].filter(Boolean).join(" ").replace(/\s/g, " "), formatClock(SLOT).replace(/\s/g, " "));
});

/* ---- cancelling ------------------------------------------------------------------ */

test("cancel is offered only while the request has not been picked up", () => {
  assert.deepEqual(["scheduled", "requested", "acknowledged", "interviewing"].map((status) => canCancel({ status })), [true, true, false, false]);
});

test("the question names what is being given up", () => {
  assert.deepEqual(cancelPrompt({ status: "scheduled", slot_start: SLOT }), { question: `Cancel your ${formatClock(SLOT)} booking?`, confirmLabel: "Cancel booking" });
  assert.deepEqual(cancelPrompt({ status: "requested", slot_start: null }), { question: "Cancel your request for a judge?", confirmLabel: "Cancel request" });
});

test("cancel asks first, as a danger action; on a no nothing is sent", async () => {
  const asked = [];
  let sent = 0;
  const ask = async (question, options) => {
    asked.push([question, options]);
    return false;
  };
  const did = await cancelAfterAsking(ask, { status: "requested", slot_start: null }, async () => {
    sent++;
  });
  assert.equal(did, false);
  assert.equal(sent, 0, "a declined cancel must send nothing");
  assert.deepEqual(asked, [["Cancel your request for a judge?", { confirmLabel: "Cancel request", danger: true }]]);
});

test("on a yes the cancel is sent, once, after the question", async () => {
  const order = [];
  const did = await cancelAfterAsking(
    async () => {
      order.push("asked");
      return true;
    },
    { status: "scheduled", slot_start: SLOT },
    async () => {
      order.push("sent");
    },
  );
  assert.equal(did, true);
  assert.deepEqual(order, ["asked", "sent"]);
});

test("a failed send is the caller's to show: it is not swallowed", async () => {
  await assert.rejects(
    cancelAfterAsking(async () => true, { status: "requested", slot_start: null }, async () => {
      throw new Error("Request failed (500)");
    }),
    /Request failed \(500\)/,
  );
});

/* ---- earlier today ---------------------------------------------------------------- */

test("earlier today is the team's other requests, at most five, in the order given", () => {
  const rows = [
    ...Array.from({ length: 7 }, (_, i) => request({ id: `a${i}`, team_id: "t1", status: "completed" })),
    request({ id: "other", team_id: "t2" }),
    request({ id: "live", team_id: "t1" }),
  ];
  assert.deepEqual(earlierToday(rows, "t1", "live").map((r) => r.id), ["a0", "a1", "a2", "a3", "a4"]);
  assert.deepEqual(earlierToday([rows[7], rows[8]], "t1", "live"), [], "nothing of this team's but the live one, and nobody else's");
  assert.deepEqual(earlierToday([rows[8], rows[0]], "t1").map((r) => r.id), ["live", "a0"], "with no live request nothing is left out");
});

test("a row is timed by when it finished, else when it was cancelled, else when it was asked for", () => {
  assert.equal(historyTime({ finished_at: "F", cancelled_at: "C", requested_at: "R" }), "F");
  assert.equal(historyTime({ finished_at: null, cancelled_at: "C", requested_at: "R" }), "C");
  assert.equal(historyTime({ finished_at: null, cancelled_at: null, requested_at: "R" }), "R");
});

/* ---- the palette the status panel wears (AA on every fill, both themes) ----------- */

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

/** OKLCH -> linear sRGB -> WCAG relative luminance. */
function luminance(oklch) {
  const [L, C, H] = oklch;
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  const [r, g, bl] = lin.map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}
const contrast = (x, y) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

/** The declarations of the first rule whose selector line matches `open`. */
function ruleBody(open) {
  const at = css.search(open);
  assert.notEqual(at, -1, `${open} not found`);
  return css.slice(at, css.indexOf("\n}", at));
}
function token(body, name) {
  const m = new RegExp(`--${name}:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`).exec(body);
  assert.ok(m, `--${name} is not an oklch() in that block`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

test("the contrast maths knows black from white", () => {
  assert.ok(Math.abs(contrast([0, 0, 0], [1, 0, 0]) - 21) < 0.01);
  assert.ok(contrast([0.5, 0, 0], [0.5, 0, 0]) < 1.001);
});

for (const theme of ["dark", "light"]) {
  test(`${theme}: the ink on every status fill (panel, chips) clears AA 4.5:1`, () => {
    const app = ruleBody(theme === "dark" ? /^:root,\n:root\[data-theme="dark"\] \{/m : /^:root\[data-theme="light"\] \{/m);
    const page = ruleBody(theme === "dark" ? /^\.teampage \{/m : /^:root\[data-theme="light"\] \.teampage \{/m);
    // The same pairs the page's .tp-s-* classes make.
    const pairs = {
      booked: [token(app, "booked-quiet"), token(page, "tp-booked-ink")],
      waiting: [token(app, "waiting"), token(app, "waiting-ink")],
      enroute: [token(app, "enroute"), token(app, "enroute-ink")],
      active: [token(app, "active"), token(app, "active-ink")],
      done: [token(app, "done"), token(app, "done-ink")],
      off: [token(app, "off"), token(app, "off-ink")],
    };
    for (const [name, [fill, ink]] of Object.entries(pairs)) {
      const ratio = contrast(fill, ink);
      assert.ok(ratio >= 4.5, `${theme}: ${name} ink on its fill is ${ratio.toFixed(2)}:1`);
    }
  });
}

test("each status class on the page pairs the fill and the ink the test above measures", () => {
  const pairs = {
    booked: ["booked-quiet", "tp-booked-ink"],
    waiting: ["waiting", "waiting-ink"],
    enroute: ["enroute", "enroute-ink"],
    active: ["active", "active-ink"],
    done: ["done", "done-ink"],
    off: ["off", "off-ink"],
  };
  for (const [tone, [fill, ink]] of Object.entries(pairs)) {
    assert.ok(
      css.includes(`.teampage .tp-s-${tone} { --c: var(--${fill}); --ci: var(--${ink}); }`),
      `.tp-s-${tone} no longer uses --${fill} with --${ink}`,
    );
  }
});

/* ---- the stylesheet ------------------------------------------------------------------ */

// From the comment that opens the page's block to the comment that opens the next one.
const blockStart = css.lastIndexOf("/*", css.indexOf('Team page ("Status board"'));
const block = css.slice(blockStart, css.lastIndexOf("/*", css.indexOf('Referee console ("Match first"')));
const bare = block.replace(/\/\*[\s\S]*?\*\//g, "");

test("the page's CSS sits after the landing block and is all .teampage / tp-* (plus the toggle it docks)", () => {
  assert.ok(block.length > 3000, "the Team page block was not found");
  assert.ok(blockStart > css.indexOf(".landing *, .landing *::before"), "the block belongs after the landing block");
  const classes = new Set([...bare.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));
  const stray = [...classes].filter((c) => !/^(tp-|teampage$|theme-toggle$)/.test(c));
  assert.deepEqual(stray, [], "every class in the block is the page's own");
});

test("the page has no motion: no keyframes, no animation, and its transitions go off under reduced motion", () => {
  assert.doesNotMatch(bare, /@keyframes|animation/);
  assert.match(bare, /@media \(prefers-reduced-motion: reduce\) \{\s*\.teampage \*, \.teampage \*::before, \.teampage \*::after \{ transition: none !important; \}/);
  for (const file of ["src/components/team/TeamView.tsx", "src/components/team/teamLogic.ts", "src/app/team/[number]/page.tsx"]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /pulse-waiting|animate-|StatusChip/, `${file} brings a pulse or spin back`);
  }
});

test("the layout: one column to 560px, two columns from 1024px, a horizontal track and four slot columns there", () => {
  assert.match(bare, /\.tp-grid \{[^}]*max-width: 560px/);
  const wide = bare.slice(bare.indexOf("@media (min-width: 1024px)"));
  assert.match(wide, /\.tp-grid \{[^}]*grid-template-columns: 1fr 1fr/);
  assert.match(wide, /\.tp-track ol \{[^}]*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(wide, /\.tp-slots \{[^}]*repeat\(4, minmax\(0, 1fr\)\)/);
});

test("controls keep 44px tap targets", () => {
  for (const [selector, min] of [[".tp-btn--out", 44], [".tp-seg button", 44], [".tp-chip", 44], [".tp-alert-x", 44], [".tp-more", 44], [".tp-dsc-h", 56]]) {
    const rule = new RegExp(`${selector.replace(/[.[\]]/g, "\\$&")} \\{[^}]*\\b(?:min-)?height: (\\d+)px`).exec(bare);
    assert.ok(rule, `${selector} sets no height`);
    assert.ok(Number(rule[1]) >= min, `${selector} is ${rule[1]}px tall`);
  }
});
