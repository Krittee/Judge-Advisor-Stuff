import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

/* The phone is the common case here: teams request from theirs, judges and
   referees work off theirs. Layout itself is checked in a real browser, but
   these few rules are what everything else rests on, and losing one of them
   breaks every page at once without failing anything. */

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const ui = readFileSync(new URL("../src/components/ui.tsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../src/app/admin/page.tsx", import.meta.url), "utf8");
const referee = readFileSync(new URL("../src/app/referee/page.tsx", import.meta.url), "utf8");

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

test("light mode gives hover somewhere to go", () => {
  /* Every faint surface maps to the same white there, so without these the
     hover states are invisible in light mode. */
  assert.ok(
    /hover\\:bg-white/.test(css),
    "light-theme hover backgrounds are gone; hovering will show nothing",
  );
});

test("operational controls cannot be covered by the floating theme button", () => {
  assert.ok(ui.includes("<ThemeToggle inline />"), "the theme control is no longer in the app header");
  assert.ok(
    css.includes("body:has(.app-header) > .theme-toggle"),
    "the duplicate floating control can cover field actions again",
  );
});

test("dense admin navigation remains discoverable on a phone", () => {
  assert.ok(admin.includes('aria-label="Admin section"'), "the mobile admin section picker is gone");
  assert.ok(admin.includes("sm:hidden"), "the admin picker is no longer scoped to mobile");
});

test("referee field actions and rule search fit a phone viewport", () => {
  assert.ok(referee.includes("grid grid-cols-2 gap-2"), "referee outcomes returned to a long stack");
  assert.ok(referee.includes("max-h-[75dvh]"), "the mobile rule picker can escape the viewport");
});

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
