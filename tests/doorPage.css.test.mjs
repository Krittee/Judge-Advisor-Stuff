import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/* The door page's stylesheet ("Five doors", design/door-redesign/): the
   sample tiles wear the Live board's fills and inks, so they get the same
   contrast and hue checks as the board's (tests/board.logic.test.mjs), and
   the block stays scoped, still and in its place in the file. */

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
  const m = new RegExp(`--${name}:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*/\\s*[\\d.]+)?\\s*\\)`).exec(body);
  assert.ok(m, `--${name} is not an oklch() in that block`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
const appRule = (theme) => ruleBody(theme === "dark" ? /^:root,\n:root\[data-theme="dark"\] \{/m : /^:root\[data-theme="light"\] \{/m);
const pageRule = (theme) => ruleBody(theme === "dark" ? /^\.doorpage \{/m : /^:root\[data-theme="light"\] \.doorpage \{/m);

for (const theme of ["dark", "light"]) {
  test(`${theme}: every sample tile and muted line on the door page clears AA 4.5:1`, () => {
    const app = appRule(theme);
    const page = pageRule(theme);
    const t = (n) => token(app, n);
    const bookedInk = token(page, "dp-booked-ink");
    const doneTint = mix(t("done"), t("surface"), 22);
    const hover = mix(t("accent"), t("surface"), theme === "dark" ? 14 : 9);

    const pairs = {
      "Booked tile": [t("booked-quiet"), bookedInk],
      "Requesting tile": [t("waiting"), t("waiting-ink")],
      "On the way tile": [t("enroute"), t("enroute-ink")],
      "Interviewing tile": [t("active"), t("active-ink")],
      "Complete tile": [doneTint, t("ink")],
      "door line on the card": [t("surface"), t("ink-subtle")],
      "door name on the card": [t("surface"), t("ink")],
      "key line in the Live board card": [t("surface"), t("ink-subtle")],
      "Live board line on its hover tint": [hover, t("ink-subtle")],
      "intro line on the page": [t("canvas"), t("ink-subtle")],
      "caption on the page": [t("canvas"), t("ink-subtle")],
      "LIVE pill": [t("surface"), t("accent")],
    };
    for (const [name, [fill, ink]] of Object.entries(pairs)) {
      const ratio = contrast(fill, ink);
      assert.ok(ratio >= 4.5, `${theme}: ${name} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${theme}: the complete tint stays green (hue within 20 degrees of --done)`, () => {
    const app = appRule(theme);
    const done = token(app, "done");
    const tint = mix(done, token(app, "surface"), 22);
    assert.ok(hueGap(tint[2], done[2]) <= 20, `${theme}: the tint's hue is ${tint[2].toFixed(0)}, --done's is ${done[2]}`);
    // Guard the guard: the oklch mix lands near 241 and must be caught.
    assert.ok(hueGap(241, done[2]) > 20);
  });
}

test("each sample tile class pairs the fill and the ink the test above measures, and the tint is mixed in srgb", () => {
  const pairs = {
    bk: ["booked-quiet", "dp-booked-ink"],
    rq: ["waiting", "waiting-ink"],
    en: ["enroute", "enroute-ink"],
    in: ["active", "active-ink"],
  };
  for (const [cls, [fill, ink]] of Object.entries(pairs)) {
    assert.ok(css.includes(`.dp-s-${cls} { --c: var(--${fill}); --ci: var(--${ink}); }`), `.dp-s-${cls} no longer uses --${fill} with --${ink}`);
  }
  assert.ok(css.includes("--dp-done-tint: color-mix(in srgb, var(--done) 22%, var(--surface));"));
  assert.ok(css.includes(".dp-s-dn { border-color: var(--dp-done-line); background: var(--dp-done-tint); color: var(--ink); }"));
  // The board's booked ink, so a tile on "/" matches a tile on /board.
  assert.equal(pageRule("dark").match(/--dp-booked-ink: ([^;]+);/)[1], ruleBody(/^\.board \{/m).match(/--bd-booked-ink: ([^;]+);/)[1]);
  assert.equal(pageRule("light").match(/--dp-booked-ink: ([^;]+);/)[1], ruleBody(/^:root\[data-theme="light"\] \.board \{/m).match(/--bd-booked-ink: ([^;]+);/)[1]);
});

/* ---- the block ---------------------------------------------------------------------- */

const start = css.lastIndexOf("/*", css.indexOf('Door page ("/"'));
const block = css.slice(start, css.lastIndexOf("/*", css.indexOf('Team page ("Status board"')));
const bare = block.replace(/\/\*[\s\S]*?\*\//g, "");

test("the door page's CSS is all .doorpage / dp-*", () => {
  assert.ok(block.length > 3000, "the door block was not found");
  const classes = new Set([...bare.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));
  const stray = [...classes].filter((c) => !/^(dp-|doorpage$)/.test(c));
  assert.deepEqual(stray, [], "every class in the block is the page's own");
});

test("the door block sits after the landing block and before the referee block", () => {
  assert.ok(start > css.indexOf(".lp-chev {"));
  assert.ok(start < css.indexOf(".referee {"));
  assert.ok(css.indexOf(".lp-brand {") > css.indexOf("The board (\"Panel columns, refined\""), "the landing block did not move");
});

test("no motion on / or /team: no keyframes, no animation, transitions off under reduced motion", () => {
  const landing = css.slice(css.indexOf("Team landing page"), css.indexOf('Team page ("Status board"'));
  const landingBare = landing.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(landingBare, /@keyframes|animation/);
  assert.match(bare, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.doorpage \*, \.doorpage \*::before, \.doorpage \*::after \{ transition: none !important; \}/);
  assert.match(landingBare, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.landing \*, \.landing \*::before, \.landing \*::after \{ transition: none !important; \}/);
});

test("the sample tiles are a key: nothing on them reacts to the pointer or the keyboard", () => {
  assert.doesNotMatch(bare, /\.dp-tl[^{]*:(hover|focus|active)/);
  assert.doesNotMatch(bare, /\.dp-sg[^{]*:(hover|focus|active)/);
});

test("touch targets: doors 64px or more, the board link 56px, the back link 44px", () => {
  assert.match(bare, /\.dp-card \{[^}]*min-height: 72px/);
  assert.match(bare, /\.dp-board \{[^}]*min-height: 56px/);
  assert.match(css, /\.lp-back \{[^}]*min-height: 44px/);
});

test("layout: tiles go 3 + 2 on a phone and one row of five from 1024px; doors one column then a row of five", () => {
  assert.match(bare, /\.dp-sg \{[^}]*grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(bare, /\.dp-tl:nth-child\(n\+4\) \{ grid-column: span 3; \}/);
  const wide = bare.slice(bare.indexOf("@media (min-width: 1024px)"));
  assert.match(wide, /\.dp-sg \{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(wide, /\.dp-doors \{ flex-direction: row;/);
  assert.match(bare, /\.dp-doors \{ display: flex; flex-direction: column;/);
});
