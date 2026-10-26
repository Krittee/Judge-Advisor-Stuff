import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { ImportResult, ImportTab } from "../src/components/admin/ImportTab";
import type { ImportOutcome } from "../src/components/admin/importLogic";

/* The Judge Advisor Import tab, rendered to markup. Behaviour that needs a
   browser (a file chosen or dropped, the dashed border while dragging, a
   click) has no DOM harness here; the decisions behind it run as plain
   functions in adminImport.logic.test.mjs and the wiring is read from source
   at the foot. */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
const css = read("src/app/globals.css");

// The Import mock, as data: 46 teams from 48 lines, two of them unreadable.
const outcome = (over: Partial<ImportOutcome["reply"]> = {}, autoAssign = true): ImportOutcome => ({
  autoAssign,
  reply: {
    imported: 46, created: 12, updated: 34, assigned: 9, skipped: 2,
    skippedLines: [
      { line: 17, text: ", Nameless, A2", reason: "no team number" },
      { line: 41, text: "99.9, Dotted", reason: "team number has characters other than A–Z, 0–9 and -" },
    ],
    ...over,
  },
});

const tab = () => renderToStaticMarkup(<ImportTab refresh={async () => {}} onError={() => {}} divisions={["Elementary School", "Middle School"]} />);

/* ---- the answer ------------------------------------------------------------ */

test("the answer is two boxes: Imported in done-green, and the skipped lines in caution", () => {
  const markup = renderToStaticMarkup(<ImportResult outcome={outcome()} />);
  assert.match(markup, /<section class="ja-im-ok" role="status">/, "the success box");
  assert.match(markup, /<div class="jg-caution ja-im-skip" role="note">/, "the caution box");
  assert.ok(markup.indexOf("ja-im-ok") < markup.indexOf("ja-im-skip"), "caution sits under the success box");

  assert.match(markup, /Imported <b>46 teams<\/b>, 12 new · 34 updated · assigned 9 to panels\./);
  assert.match(markup, /<b>2 lines skipped<\/b>/);
  const items = [...markup.matchAll(/<li[^>]*>([^<]*)<\/li>/g)].map((m) => m[1]);
  assert.deepEqual(items, [
    "Line 17 · no team number",
    "Line 41 · team number has characters other than A–Z, 0–9 and -",
  ]);
  assert.match(markup, /<li title=", Nameless, A2">/, "the line itself is on hover");
});

test("'assigned N to panels' is there only when spreading was on when Import was pressed", () => {
  const on = text(renderToStaticMarkup(<ImportResult outcome={outcome({}, true)} />));
  const off = text(renderToStaticMarkup(<ImportResult outcome={outcome({}, false)} />));
  assert.match(on, /Imported 46 teams, 12 new · 34 updated · assigned 9 to panels\./);
  assert.match(off, /Imported 46 teams, 12 new · 34 updated\./);
  assert.doesNotMatch(off, /assigned/);

  const none = text(renderToStaticMarkup(<ImportResult outcome={outcome({ assigned: 0 }, true)} />));
  assert.match(none, /assigned 0 to panels/, "on, with nothing to assign, still says so");
});

test("no skipped lines, no caution box; one skipped line reads '1 line skipped'", () => {
  const clean = renderToStaticMarkup(<ImportResult outcome={outcome({ skipped: 0, skippedLines: [] })} />);
  assert.match(clean, /ja-im-ok/);
  assert.doesNotMatch(clean, /ja-im-skip|skipped|<li/);

  const one = text(renderToStaticMarkup(<ImportResult outcome={outcome({ imported: 1, created: 1, updated: 0, skipped: 1, skippedLines: [{ line: 3, text: "x", reason: "no digit in the team number" }] }, false)} />));
  assert.match(one, /Imported 1 team, 1 new · 0 updated\./);
  assert.match(one, /1 line skipped/);
  assert.match(one, /Line 3 · no digit in the team number/);
});

/* ---- the box --------------------------------------------------------------- */

test("an empty box: Import is disabled, no answer is showing, and nothing is claimed as loaded", () => {
  const markup = tab();
  assert.match(markup, /<button type="button" class="ja-prim" disabled="">Import<\/button>/);
  assert.doesNotMatch(markup, /ja-im-ok|ja-im-skip|ja-im-info|Importing/);
  assert.match(markup, /<textarea[^>]*aria-label="Team list"[^>]*><\/textarea>/, "the box starts empty");
});

test("the format card names the line, the optional fifth column, and the three things to know", () => {
  const body = text(tab());
  assert.match(body, /Format · one team per line/);
  assert.match(body, /number, name, pit, division/);
  assert.match(body, /Tabs work too, and a header row is skipped\. An optional fifth column sets the notebook type/);
  assert.match(body, /Division is each team&#x27;s own\. One list can hold every division\. Blank means the first one, Elementary School\./);
  assert.match(body, /Pit reads as a letter and a number, like A1\. That places the team on the floor plan\./);
  assert.match(body, /Re-importing updates teams\. It never duplicates them\./);
});

test("the drop card: Choose a file is a labelled, keyboard-reachable input; the box is mono and wide-open", () => {
  const markup = tab();
  assert.match(markup, /<label class="ja-im-pick">[\s\S]*Choose a file<input type="file" accept="\.xlsx,\.csv,\.tsv,\.txt" class="sr-only"\/><\/label>/);
  assert.doesNotMatch(markup, /type="file"[^>]*class="hidden"|display:\s*none/, "visually hidden, not removed from the tab order");
  assert.match(markup, /or drag one here · \.xlsx \.csv \.tsv · or paste below/);
  const box = markup.match(/<textarea[^>]*>/)?.[0] ?? "";
  assert.ok(box.includes('class="ja-im-ta"') && box.includes('wrap="off"') && box.includes('rows="8"'), box);
  assert.match(css, /\.ja-im-ta \{[^}]*font-family: var\(--ja-im-mono\)/, "mono");
  assert.doesNotMatch(markup, /data-drag/, "not dragging to begin with");
});

test("Spread across panels evenly starts on with max 10 per panel, a number from 1 to 40", () => {
  const markup = tab();
  assert.match(markup, /<input type="checkbox" class="ja-im-cb" checked=""\/>Spread across panels evenly/);
  assert.match(markup, /max<input type="number" min="1" max="40" class="ja-im-num" value="10"\/>per panel/);
  assert.doesNotMatch(markup, /ja-im-num"[^>]*disabled/, "enabled while spreading is on");
});

/* ---- the wiring (source) ---------------------------------------------------- */

const src = read("src/components/admin/ImportTab.tsx");
const page = read("src/app/admin/page.tsx");

test("the page renders the moved tab inside the redesigned padding and no longer defines one", () => {
  assert.ok(page.includes('import { ImportTab } from "@/components/admin/ImportTab";'));
  assert.ok(page.includes("<ImportTab refresh={refresh} onError={setError} divisions={state.divisions} />"));
  assert.ok(!page.includes("function ImportTab("), "the old tab is gone from the page");
  assert.ok(!page.includes("readSpreadsheet") && !page.includes("Importing…"));
  assert.match(page, /tab === "import"( \|\| tab === "\w+")* \? "ja-pad"/, "Import fills the width the rail leaves");
});

test("a file chosen, a file dropped and a paste all go to the one box; Import says Importing… while busy", () => {
  assert.equal(src.match(/readSpreadsheet\(/g)?.length, 1, "one reader");
  assert.equal(src.match(/takeFile\(/g)?.length, 3, "defined once, called from the chooser and the drop");
  assert.match(src, /onDrop=\{\(e\) => \{\s*e\.preventDefault\(\);\s*setDragging\(false\);\s*takeFile\(e\.dataTransfer\.files\?\.\[0\]\);/);
  assert.ok(src.includes('data-drag={dragging ? "" : undefined}'), "the drag state is on the whole drop card");
  assert.ok(src.includes('{busy ? "Importing…" : "Import"}'));
  assert.ok(src.includes("disabled={importDisabled(text, busy)}"));
  assert.ok(src.includes("disabled={!autoAssign}"), "max is off when spreading is");
  assert.ok(src.includes("{result ? <ImportResult outcome={result} /> : null}"));
  assert.ok(!src.includes("confirm("), "never window.confirm");
});

test("a typed edit clears 'Loaded…', a new file clears the last answer, a successful import empties the box", () => {
  assert.match(src, /onChange=\{\(e\) => \{\s*setText\(e\.target\.value\);\s*setLoaded\(null\);/);
  assert.match(src, /onError\(null\);\s*setResult\(null\);\s*setLoaded\(null\);\s*try \{\s*const sheet/);
  assert.match(src, /setResult\(await runImport\(call, \{ text, autoAssign, perPanel \}\)\);\s*setText\(""\);/);
});

test("the Import block of globals.css: its own prefix, an accent dashed drag border, done-green and caution answers, no motion", () => {
  const start = css.indexOf("/* @ja-block import */");
  assert.ok(start > css.indexOf("/* @ja-block panels */"), "appended after the existing blocks");
  // Scores (step 8) is appended after it.
  const end = css.indexOf("/* @ja-block scores */");
  assert.ok(end > start, "Scores follows it");
  const block = css.slice(start, end);
  assert.ok(!/@ja-block (?!import)/.test(block), "the import block runs up to the next one");
  assert.match(block, /\.ja-im-drop \{[^}]*border: 1\.5px dashed/);
  assert.match(block, /\.ja-im-drop\[data-drag\] \{[^}]*border-color: var\(--accent\)/);
  assert.match(block, /\.ja-im-ok \{[^}]*var\(--done\) 45%[^}]*var\(--done\) 12%/);
  assert.match(block, /\.ja-im-cb:checked::after/, "a checked box wears the accent");
  assert.doesNotMatch(block, /transition|animation|@keyframes/, "no motion");
  assert.doesNotMatch(block, /overflow-x/, "no sideways-scrolling row to hide a scrollbar on");
  // Every size a tap lands on is 44px on a phone and at least 32px from 1024px.
  assert.match(block, /\.ja-im-pick \{[^}]*height: 48px/);
  assert.match(block, /\.ja-im-num \{[^}]*height: 44px/);
  assert.match(block, /\.ja-im-chk \{[^}]*min-height: 48px/);
  assert.match(block, /@media \(min-width: 1024px\) \{[\s\S]*\.ja-im-pick \{[^}]*height: 40px[\s\S]*\.ja-im-num \{[^}]*height: 36px/);
  // Tokens only: no colour literals, so the light theme follows.
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|oklch\(|rgb\(|hsl\(/i);
});
