import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  boardOrder,
  divisionClass,
  groupByPanel,
  markerKey,
  notebookMarker,
  waitParts,
} from "../src/components/board/boardLogic";

/* The Live board's decisions, apart from how it is drawn: the tile order, the
   notebook marker, the wait text, and the palette the tiles wear (AA in both
   themes). The drawing itself is board.runtime.test.tsx. */

const tile = (number, status = null, over = {}) => ({
  team: { id: `t-${number}`, number },
  status,
  since: null,
  slotStart: null,
  requestedAt: null,
  ...over,
});
const order = (tiles) => [...tiles].sort(boardOrder).map((t) => t.team.number);

test("the board's order: requesting, on the way, interviewing, booked, not yet, complete", () => {
  const tiles = [
    tile("1", "completed"),
    tile("2"),
    tile("3", "scheduled", { slotStart: "2099-01-01T10:00:00Z" }),
    tile("4", "interviewing"),
    tile("5", "acknowledged"),
    tile("6", "requested", { requestedAt: "2099-01-01T09:00:00Z" }),
  ];
  assert.deepEqual(order(tiles), ["6", "5", "4", "3", "2", "1"]);
});

test("requesting: the longest wait (oldest requested_at) first, whatever the numbers say", () => {
  const tiles = [
    tile("100", "requested", { requestedAt: "2099-01-01T09:05:00Z" }),
    tile("900", "requested", { requestedAt: "2099-01-01T09:00:00Z" }),
    tile("500", "requested", { requestedAt: "2099-01-01T09:02:00Z" }),
  ];
  assert.deepEqual(order(tiles), ["900", "500", "100"]);
});

test("booked: by slot time, not by number", () => {
  const tiles = [
    tile("1", "scheduled", { slotStart: "2099-01-01T12:20:00Z" }),
    tile("2", "scheduled", { slotStart: "2099-01-01T11:50:00Z" }),
    tile("3", "scheduled", { slotStart: "2099-01-01T12:00:00Z" }),
  ];
  assert.deepEqual(order(tiles), ["2", "3", "1"]);
});

test("team number breaks every tie, and 9882K comes right after 9882", () => {
  assert.deepEqual(order([tile("20"), tile("100"), tile("9882K"), tile("9882")]), ["20", "100", "9882", "9882K"]);
  assert.deepEqual(order([tile("30", "completed"), tile("4", "completed")]), ["4", "30"]);
  assert.deepEqual(
    order([tile("30", "interviewing"), tile("4", "interviewing")]),
    ["4", "30"],
  );
  // Same wait to the instant: the number decides.
  const same = "2099-01-01T09:00:00Z";
  assert.deepEqual(
    order([tile("8", "requested", { requestedAt: same }), tile("7", "requested", { requestedAt: same })]),
    ["7", "8"],
  );
});

test("a request with no readable time sorts after the dated ones, not first", () => {
  const tiles = [tile("1", "requested"), tile("2", "requested", { requestedAt: "2099-01-01T09:00:00Z" })];
  assert.deepEqual(order(tiles), ["2", "1"]);
});

test("groupByPanel: every team once, the best request wins, Unassigned last, cancelled counts as none", () => {
  const panels = [{ id: "p1", name: "Panel 1" }];
  const teams = [
    { id: "a", number: "1", panel_id: "p1" },
    { id: "b", number: "2", panel_id: "p1" },
    { id: "c", number: "3", panel_id: null },
  ];
  const req = (team_id, status) => ({ id: `${team_id}-${status}`, team_id, status, requested_at: "2099-01-01T09:00:00Z" });
  const groups = groupByPanel(panels, teams, [req("a", "completed"), req("a", "requested"), req("b", "cancelled")]);
  assert.equal(groups.length, 2);
  assert.equal(groups[1].panel, null, "teams with no panel go to a trailing Unassigned group");
  assert.deepEqual(groups[0].teams.map((t) => [t.team.number, t.status]), [["1", "requested"], ["2", null]]);
});

test("notebook marker: the three known ids by meaning, wherever the config lists them", () => {
  // config/event.json lists developing first: position alone would draw it filled.
  const cats = [{ id: "developing" }, { id: "fully-developed" }, { id: "ungraded" }];
  assert.equal(notebookMarker("fully-developed", cats), "full");
  assert.equal(notebookMarker("developing", cats), "half");
  assert.equal(notebookMarker("ungraded", cats), "hollow");
});

test("notebook marker: any other id falls back to config order (filled, half, hollow)", () => {
  const cats = [{ id: "gold" }, { id: "silver" }, { id: "bronze" }, { id: "extra" }];
  assert.equal(notebookMarker("gold", cats), "full");
  assert.equal(notebookMarker("silver", cats), "half");
  assert.equal(notebookMarker("bronze", cats), "hollow");
  assert.equal(notebookMarker("extra", cats), "hollow");
  assert.equal(notebookMarker("not-in-config", cats), "hollow");
});

test("the colour key lists the markers in shape order", () => {
  const cats = [{ id: "developing", label: "Developing" }, { id: "fully-developed", label: "Fully Developed" }, { id: "ungraded", label: "Ungraded" }];
  assert.deepEqual(markerKey(cats).map((c) => [c.label, c.marker]), [
    ["Fully Developed", "full"],
    ["Developing", "half"],
    ["Ungraded", "hollow"],
  ]);
});

test("the wait on a requesting tile", () => {
  assert.deepEqual(waitParts(11), { value: "11", unit: "min" });
  assert.deepEqual(waitParts(0), { value: "<1", unit: "min" });
  assert.deepEqual(waitParts(60), { value: "1h", unit: "" });
  assert.deepEqual(waitParts(65), { value: "1h 5m", unit: "" });
});

test("a division wears its --cat-* token by position, cycling after four", () => {
  const d = ["A", "B", "C", "D", "E"];
  assert.deepEqual(d.map((x) => divisionClass(x, d)), ["bd-dv-1", "bd-dv-2", "bd-dv-3", "bd-dv-4", "bd-dv-1"]);
});

/* ---- the palette the tiles wear (AA on every fill, both themes) ------------------- */

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

/** OKLCH -> linear sRGB -> WCAG relative luminance. */
function luminance([L, C, H]) {
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
const toLinear = ([L, C, H]) => {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
};
const encode = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.abs(v) ** (1 / 2.4) - 0.055);
const decode = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function fromLinear([r, g, bl]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}
/** color-mix(in srgb, a pct%, b), back as an oklch triple: what the browser computes for the complete tint. */
function mix(a, b, pct) {
  const t = pct / 100;
  const la = toLinear(a).map((v) => encode(Math.min(1, Math.max(0, v))));
  const lb = toLinear(b).map((v) => encode(Math.min(1, Math.max(0, v))));
  return fromLinear(la.map((v, i) => decode(v * t + lb[i] * (1 - t))));
}
const hueGap = (x, y) => Math.abs(((x - y + 540) % 360) - 180);

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
});

for (const theme of ["dark", "light"]) {
  test(`${theme}: every text and fill pair on the board clears AA 4.5:1`, () => {
    const app = ruleBody(theme === "dark" ? /^:root,\n:root\[data-theme="dark"\] \{/m : /^:root\[data-theme="light"\] \{/m);
    const page = ruleBody(theme === "dark" ? /^\.board \{/m : /^:root\[data-theme="light"\] \.board \{/m);
    const t = (n) => token(app, n);
    const bookedInk = token(page, "bd-booked-ink");
    const doneTint = mix(t("done"), t("surface"), 22);

    const pairs = {
      "requesting tile": [t("waiting"), t("waiting-ink")],
      "on the way tile": [t("enroute"), t("enroute-ink")],
      "interviewing tile": [t("active"), t("active-ink")],
      "booked tile": [t("booked-quiet"), bookedInk],
      "complete tile ink": [doneTint, t("ink")],
      "complete tile name": [doneTint, t("ink-muted")],
      "not-yet tile ink": [t("canvas"), t("ink")],
      "not-yet tile name": [t("canvas"), t("ink-subtle")],
      "waiting block": [t("waiting"), t("waiting-ink")],
      "interview tally on the page": [t("canvas"), t("active-quiet")],
      "complete tally on the page": [t("canvas"), t("done-quiet")],
      "tally label on the page": [t("canvas"), t("ink-subtle")],
      "panel meta on the card": [t("surface"), t("ink-subtle")],
      "Nobody waiting pill": [t("surface"), t("ink-subtle")],
      "selected toggle": [t("accent"), t("accent-ink")],
      "pit code on a complete pit": [doneTint, t("ink-muted")],
    };
    for (const [name, [fill, ink]] of Object.entries(pairs)) {
      const ratio = contrast(fill, ink);
      assert.ok(ratio >= 4.5, `${theme}: ${name} is ${ratio.toFixed(2)}:1`);
    }
  });
}

for (const theme of ["dark", "light"]) {
  test(`${theme}: the complete tint stays green (hue within 20 degrees of --done)`, () => {
    const app = ruleBody(theme === "dark" ? /^:root,\n:root\[data-theme="dark"\] \{/m : /^:root\[data-theme="light"\] \{/m);
    const done = token(app, "done");
    const tint = mix(done, token(app, "surface"), 22);
    assert.ok(hueGap(tint[2], done[2]) <= 20, `${theme}: the tint's hue is ${tint[2].toFixed(0)}, --done's is ${done[2]}`);
    // Guard the guard: the oklch mix this replaced lands near 241 and must be caught.
    assert.ok(hueGap(241, done[2]) > 20);
  });
}

test("each status class pairs the fill and the ink the test above measures", () => {
  const pairs = {
    req: ["waiting", "waiting-ink"],
    en: ["enroute", "enroute-ink"],
    int: ["active", "active-ink"],
    bk: ["booked-quiet", "bd-booked-ink"],
  };
  for (const [cls, [fill, ink]] of Object.entries(pairs)) {
    assert.ok(
      css.includes(`.board .bd-s-${cls} { --c: var(--${fill}); --ci: var(--${ink}); }`),
      `.bd-s-${cls} no longer uses --${fill} with --${ink}`,
    );
  }
  assert.ok(css.includes("--bd-done-tint: color-mix(in srgb, var(--done) 22%, var(--surface));"));
});

/* ---- the stylesheet --------------------------------------------------------------- */

const blockStart = css.lastIndexOf("/*", css.indexOf('The board ("Panel columns, refined"'));
const block = css.slice(blockStart, css.lastIndexOf("/*", css.indexOf(" * Controls\n")));
const bare = block.replace(/\/\*[\s\S]*?\*\//g, "");

test("the board's CSS is all .board / bd-* (plus the toggle it hosts)", () => {
  assert.ok(block.length > 5000, "the board block was not found");
  const classes = new Set([...bare.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));
  const stray = [...classes].filter((c) => !/^(bd-|board$|theme-toggle$)/.test(c));
  assert.deepEqual(stray, [], "every class in the block is the page's own");
});

test("the old unscoped .board-* rules are gone", () => {
  assert.doesNotMatch(css, /\.board-(number|tile|name|meta|heading)/);
});

test("the board has no motion: no keyframes, no animation, transitions off under reduced motion", () => {
  assert.doesNotMatch(bare, /@keyframes|animation/);
  assert.match(bare, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.board \*, \.board \*::before, \.board \*::after \{ transition: none !important; \}/);
});

test("pulse-waiting is kept for the pages that still use it", () => {
  assert.match(css, /\.pulse-waiting\s*\{\s*animation: waiting-pulse/);
});

test("a long team number still fits its tile: --num-len drives the size inside a container", () => {
  assert.match(bare, /\.bd-tile \{[^}]*container-type: inline-size/);
  assert.match(bare, /var\(--num-len, 5\)/);
  assert.match(bare, /100cqw/);
});

test("the tiles never shrink below the mock's sizes on a laptop: the unit only scales up", () => {
  assert.match(bare, /--bd-u: max\(1px, calc\(100vw \/ 1920\)\)/);
});

test("phone: the toggle and Hide completed are at least 44px tall, and no console links or Fullscreen", () => {
  const phone = bare.slice(bare.indexOf("@media (max-width: 767px)"));
  assert.match(phone, /\.bd-links, \.bd-fs \{ display: none; \}/);
  const stacked = bare.slice(bare.indexOf("@media (max-width: 1199px)"), bare.indexOf("@media (max-width: 767px)"));
  assert.match(stacked, /\.theme-toggle \{[^}]*width: 44px; height: 44px/);
  assert.match(stacked, /\.bd-chk \{[^}]*min-height: 44px/);
});

test("phone: panels stretch to the full width, and the brand row is out-ranked off the header", () => {
  const phone = bare.slice(bare.indexOf("@media (max-width: 767px)"));
  assert.match(phone, /\.bd-body, \.bd-panels, \.bd-side \{[^}]*align-items: stretch/);
  const stacked = bare.slice(bare.indexOf("@media (max-width: 1199px)"), bare.indexOf("@media (max-width: 767px)"));
  assert.match(stacked, /\.bd-body \{[^}]*align-items: stretch/);
  // .lp-brand (the landing's, later in the file) sets display:flex at the same specificity.
  assert.match(stacked, /\.board \.bd-brand \{ display: none; \}/);
});

test("the number's reserve is in characters of the neighbour's own font size, which a phone sets", () => {
  assert.match(bare, /var\(--bd-rc, 0\) \* 0\.55 \* var\(--bd-tf\)/);
  const phone = bare.slice(bare.indexOf("@media (max-width: 767px)"));
  assert.match(phone, /\.bd-tile \{ --bd-nom: 22px; --bd-tf: 15px;/);
  assert.match(phone, /\.bd-tt \{ font-size: 15px;/, "--bd-tf must match the phone time size");
  assert.match(phone, /\.bd-tile--big \{ --bd-nom: 32px; --bd-tf: 40px;/);
});
