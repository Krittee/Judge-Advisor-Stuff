import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/* One stylesheet, many tabs: the Judge Advisor console's tabs all live in
   src/app/globals.css, so a class one tab defines is a class every other
   tab's markup can pick up. The Conflicts rows once reused the Floor card's
   .ja-cm / .ja-c1 / .ja-c2 and, from 1280px, `display: contents` collapsed
   every Floor card.

   Each feature's CSS opens with an @ja-block comment naming it. A class may
   be *defined* (named in a selector with no class of the block's own beside
   it) by one block only. Another block may still *restyle* it, as long as the
   rule is anchored on one of that block's own classes (`.ja-tm .ja-in`), and
   may use it in markup without touching the CSS at all. */

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

/** Every style rule after the first marker: { block, selector } with one entry per comma-separated selector. */
function rules(text) {
  const markers = [];
  const bare = text.replace(/\/\*([\s\S]*?)\*\//g, (all, body, at) => {
    const m = /^\s*@ja-block\s+(\w+)\s*$/.exec(body);
    if (m) markers.push({ at, block: m[1] });
    return " ".repeat(all.length);
  });
  const out = [];
  let depth = 0;
  let start = 0;
  const at = [];
  for (let i = 0; i < bare.length; i++) {
    const c = bare[i];
    if (c === "{") {
      const prelude = bare.slice(start, i).trim();
      const atRule = prelude.startsWith("@");
      at.push(atRule);
      depth++;
      // A @media / @supports block holds rules; @keyframes holds steps, which carry no classes.
      if (!atRule && !at.slice(0, -1).includes("keyframes")) {
        const block = [...markers].reverse().find((m) => m.at < i)?.block;
        if (block) {
          let paren = 0;
          let from = 0;
          const selectors = [];
          for (let j = 0; j <= prelude.length; j++) {
            if (prelude[j] === "(") paren++;
            else if (prelude[j] === ")") paren--;
            else if ((prelude[j] === "," && !paren) || j === prelude.length) {
              selectors.push(prelude.slice(from, j));
              from = j + 1;
            }
          }
          for (const selector of selectors) out.push({ block, selector });
        }
      }
      start = i + 1;
    } else if (c === "}") {
      at.pop();
      depth--;
      start = i + 1;
    } else if (c === ";" && depth === 0) {
      start = i + 1;
    }
  }
  return out;
}

const classesIn = (selector) => [...selector.matchAll(/\.((?:ja|jg)-[\w-]+)/g)].map((m) => m[1]);

/** Classes that two or more blocks define, as `class: [blocks]`. */
function collisions(text, shared = new Set()) {
  const uses = rules(text).map(({ block, selector }) => ({ block, classes: [...new Set(classesIn(selector))] }));
  const blocksOf = new Map();
  for (const { block, classes } of uses) {
    for (const c of classes) blocksOf.set(c, (blocksOf.get(c) ?? new Set()).add(block));
  }
  // A class only one block ever names is that block's own.
  const own = (c, block) => blocksOf.get(c).size === 1 && blocksOf.get(c).has(block);

  const definers = new Map();
  for (const { block, classes } of uses) {
    for (const c of classes) {
      const anchored = classes.some((d) => d !== c && own(d, block));
      if (!anchored) definers.set(c, (definers.get(c) ?? new Set()).add(block));
    }
  }
  const found = {};
  for (const [c, blocks] of definers) {
    if (blocks.size > 1 && !shared.has(c)) found[c] = [...blocks].sort();
  }
  return found;
}

/* Classes two blocks may both define on purpose. Keep it empty: say why before adding to it. */
const SHARED = new Set([]);

test("the detector tells a second definition from a restyle anchored on the block's own class", () => {
  const css = `
    /* @ja-block a */
    .ja-card { display: flex; }
    .ja-a-own { color: red; }
    /* @ja-block b */
    .ja-b-own .ja-card { gap: 4px; }
    .ja-b-own { color: blue; }
    @media (min-width: 1280px) { .ja-x, .ja-b-own .ja-y { display: contents; } }
    /* @ja-block a */
    @media (min-width: 1280px) { .ja-x { display: grid; } }
    /* @ja-block b */
    .ja-card { margin: 0; }
  `;
  assert.deepEqual(collisions(css), { "ja-card": ["a", "b"], "ja-x": ["a", "b"] });
  assert.deepEqual(collisions(css, new Set(["ja-card", "ja-x"])), {});
});

test("every .ja-* class is defined by one feature's CSS only", () => {
  assert.ok(rules(css).length > 400, "the markers should cover the whole Judge Advisor block");
  assert.deepEqual(
    collisions(css, SHARED),
    {},
    "these classes are defined by more than one block of globals.css: rename one side with its block's prefix, or anchor the second block's rule on a class of its own",
  );
});

test("every row that scrolls sideways in the console hides its scrollbar", () => {
  const admin = css.slice(css.indexOf("@ja-block shell"));
  const rows = [...admin.matchAll(/(\.[\w-]+)\s*\{[^}]*overflow-x:\s*(?:auto|scroll)[^}]*\}/g)];
  assert.ok(rows.length >= 2, "the Floor's phone switcher and Teams' chip rows scroll sideways");
  for (const [rule, selector] of rows) {
    assert.match(rule, /scrollbar-width:\s*none/, `${selector} needs scrollbar-width: none`);
    assert.match(admin, new RegExp(`${selector.replace(".", "\\.")}::-webkit-scrollbar\\s*\\{\\s*display:\\s*none`), `${selector} needs its ::-webkit-scrollbar hidden`);
  }
});
