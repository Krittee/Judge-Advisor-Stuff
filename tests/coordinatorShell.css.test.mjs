import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/* Regression: the Coordinator's sr-only labels (position: absolute) escaped the
   unpositioned .co-body scroller, stretched the document past the 100dvh shell,
   and the page scrolled past its tab bar. The scroller must be positioned. */

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

test(".co-body is a positioned scroller", () => {
  const rule = css.match(/\.co-body\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /position:\s*relative/);
  assert.match(rule, /overflow-y:\s*auto/);
});
