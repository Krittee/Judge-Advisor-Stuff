import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

/**
 * The palette rules, guarded structurally.
 *
 * A full contrast check would need an OKLCH-to-sRGB conversion in the test
 * suite. It does not need one: every contrast failure this palette has
 * actually had came from breaking one of the two rules below, and both are
 * readable straight off the lightness channel.
 */

/** The custom-property block for one theme. */
function block(theme) {
  const start =
    theme === "light" ? css.indexOf(':root[data-theme="light"]') : css.indexOf(":root,");
  assert.notEqual(start, -1, `${theme}: theme block not found`);
  return css.slice(start, css.indexOf("\n}", start));
}

/** The L of `--name: oklch(L C H)`, or null when it is not an oklch value. */
function lightness(themeBlock, name) {
  const m = new RegExp(`--${name}:\\s*oklch\\(\\s*([\\d.]+)`).exec(themeBlock);
  return m ? Number(m[1]) : null;
}

const STATUSES = ["waiting", "enroute", "active", "done", "booked", "off", "accent", "danger"];

for (const theme of ["dark", "light"]) {
  test(`${theme}: every status is a bright fill with dark ink, or the reverse -- never a muddle`, () => {
    const b = block(theme);
    for (const name of STATUSES) {
      const fill = lightness(b, name);
      const ink = lightness(b, `${name}-ink`);
      assert.ok(fill !== null, `${theme}: --${name} is missing or not oklch`);
      assert.ok(ink !== null, `${theme}: --${name}-ink is missing or not oklch`);

      /* The gap is what carries the contrast. White ink on a mid-lightness
         green measured 2.9:1 -- legal-looking CSS, unreadable tile -- and
         the thing that made it wrong was a gap of 0.33.

         0.40 is calibrated against the real thing rather than chosen: every
         pair in the shipped palette was measured in the browser and the
         narrowest one that cleared 4.5:1 sits at 0.42 (the cancelled grey,
         which is low-chroma and deliberately the quietest state there is).
         This is a canary for that failure mode, not a proof of contrast --
         a much more saturated pair could still need checking by hand. */
      assert.ok(
        Math.abs(fill - ink) >= 0.4,
        `${theme}: --${name} (L ${fill}) and --${name}-ink (L ${ink}) are too close ` +
          `to each other to be readable together`,
      );
    }
  });

  test(`${theme}: the ink scale stays in order and clears the background`, () => {
    const b = block(theme);
    const canvas = lightness(b, "canvas");
    const steps = ["ink", "ink-muted", "ink-subtle", "ink-faint"].map((n) => lightness(b, n));
    assert.ok(
      steps.every((s) => s !== null),
      `${theme}: an ink step is missing`,
    );

    // Each step is fainter than the one before it, in whichever direction
    // this theme runs.
    const towardCanvas = theme === "light" ? (a, z) => a < z : (a, z) => a > z;
    for (let i = 1; i < steps.length; i++) {
      assert.ok(
        towardCanvas(steps[i - 1], steps[i]),
        `${theme}: ink step ${i} (L ${steps[i]}) is not fainter than the one before it`,
      );
    }

    /* Even the faintest tier is still text somebody has to read -- hints,
       captions, "Not booked". It has to stay clear of the page it sits on. */
    assert.ok(
      Math.abs(steps[steps.length - 1] - canvas) >= 0.34,
      `${theme}: --ink-faint (L ${steps[steps.length - 1]}) is too close to --canvas (L ${canvas})`,
    );
  });
}

test("no theme is built by re-mapping individual Tailwind colour utilities", () => {
  /* The light theme was once ~40 rules like `[data-theme=light] .text-zinc-400 {}`
     -- a list every new colour had to be added to by hand, and was not
     always added to. Tokens replaced it. If these reappear, the palette has
     started leaking back into per-utility overrides. */
  const overrides = css.match(/\[data-theme="light"\]\s+\.(text|bg|ring|border)-/g) ?? [];
  assert.deepEqual(
    overrides,
    [],
    `the light theme is overriding Tailwind utilities again (${overrides.length} rules)`,
  );
});
