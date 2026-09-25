import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

/* The phone is the common case here: teams request from theirs, judges and
   referees work off theirs. Layout itself is checked in a real browser, but
   these few rules are what everything else rests on, and losing one of them
   breaks every page at once without failing anything. */

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");

/* The file explains in a comment why the cap is absent, so match the setting
   itself rather than the word. */
const layoutCode = layout.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("pinch-zoom is not blocked", () => {
  /* maximumScale: 1 stops anyone enlarging a team number on a phone. */
  assert.ok(
    !/maximumScale\s*:/.test(layoutCode),
    "layout.tsx caps the viewport scale again, which blocks pinch-zoom",
  );
  assert.ok(
    !/userScalable\s*:\s*false/.test(layoutCode),
    "layout.tsx disables user scaling, which blocks pinch-zoom",
  );
  assert.ok(/width: "device-width"/.test(layoutCode), "the viewport is no longer device-width");
});

test("that check would catch the cap coming back", () => {
  const capped = 'export const viewport = { width: "device-width", maximumScale: 1 };';
  assert.ok(/maximumScale\s*:/.test(capped), "the pattern no longer matches a real cap");
  const commented = "// No maximumScale: capping it blocks pinch-zoom";
  const stripped = commented.replace(/\/\/.*$/gm, "");
  assert.ok(!/maximumScale\s*:/.test(stripped), "a comment mentioning it must not trip the check");
});

test("form controls stay at 16px, so iOS does not zoom on focus", () => {
  const block = /input,\s*select,\s*textarea\s*\{[^}]*font-size:\s*16px/s.test(css);
  assert.ok(block, "inputs dropped below 16px; iOS Safari will zoom the page when one is focused");
});

test("touch pointers get 44px targets", () => {
  const media = css.slice(css.indexOf("@media (pointer: coarse)"));
  assert.ok(css.includes("@media (pointer: coarse)"), "the touch sizing block is gone");
  assert.ok(/min-height:\s*44px/.test(media), "44px minimum height is gone");
  assert.ok(/min-width:\s*44px/.test(media), "44px minimum width is gone");
});

test("a tap shows that it registered", () => {
  /* The tap highlight is turned off for looks, so something has to replace
     it or a phone user gets no feedback at all. */
  assert.ok(
    /-webkit-tap-highlight-color:\s*transparent/.test(css),
    "the tap highlight rule moved; check whether :active feedback is still needed",
  );
  assert.ok(/:active\s*\{[^}]*opacity/.test(css), "nothing replaces the tap highlight any more");
});

test("buttons look clickable", () => {
  /* Tailwind v4 does not do this for us. */
  const rule = /button,[^{]*\{\s*cursor:\s*pointer/s.test(css);
  assert.ok(rule, "buttons no longer get a pointer cursor");
  assert.ok(/cursor:\s*not-allowed/.test(css), "disabled controls no longer say so");
});

test("hover has somewhere to go, in both themes", () => {
  /* The light theme used to collapse every faint surface onto the same
     white, so a row that lit up in the dark theme did nothing at all in
     the light one. It is now structural: hover moves between two named
     surfaces rather than between two opacities of white, so the only way
     to reintroduce that bug is to give them the same value. */
  for (const theme of ["dark", "light"]) {
    const block = blockFor(theme);
    const surface = /--surface:\s*([^;]+);/.exec(block)?.[1]?.trim();
    const raised = /--surface-2:\s*([^;]+);/.exec(block)?.[1]?.trim();
    assert.ok(surface && raised, `${theme}: surface tokens are missing`);
    assert.notEqual(
      surface,
      raised,
      `${theme}: --surface and --surface-2 are identical, so hovering shows nothing`,
    );
  }
});

/** The custom-property block for one theme. */
function blockFor(theme) {
  const start =
    theme === "light"
      ? css.indexOf(':root[data-theme="light"]')
      : css.indexOf(":root,");
  assert.notEqual(start, -1, `${theme}: theme block not found`);
  return css.slice(start, css.indexOf("}", start));
}

test("every page a person opens is covered by the browser checks", () => {
  /* A new route added without a mobile pass is the likely regression, so
     list them here: if this fails, audit the new one on a phone. */
  const pages = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "api") continue;
        walk(`${dir}/${entry.name}`, `${prefix}/${entry.name}`);
      } else if (entry.name === "page.tsx") {
        pages.push(prefix || "/");
      }
    }
  };
  walk("../src/app", "");

  const checked = [
    "/", "/login", "/referee/login", "/team/[number]", "/queue",
    "/judge", "/referee", "/referee/teams", "/admin", "/board",
  ];
  const missing = pages.filter((p) => !checked.includes(p));
  assert.deepEqual(
    missing,
    [],
    `new page(s) not in the mobile check list: ${missing.join(", ")} — audit them on a phone, then add them here`,
  );
});
