import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { ConflictsTab, RecordingResult } from "../src/components/admin/ConflictsTab";
import type { AppState, ConflictRow, JudgeRow, PublicPanel, Team } from "../src/lib/types";

/* The Judge Advisor Conflicts tab, rendered to markup. Behaviour that needs a
   browser (the sheet opening, the select changing) has no DOM harness here;
   the decisions behind it run as plain functions in
   adminConflicts.logic.test.mjs and the wiring is read from source at the foot. */

const panel = (n: number, division: string): PublicPanel => ({
  id: `p${n}`, name: `Panel ${n}`, division, judges: [], languages: ["en"], sort_order: n, slot_start_at: null, slot_minutes: 20, slot_count: 0,
});
const panels = [panel(1, "High School"), panel(2, "Middle School"), panel(3, "Middle School"), panel(4, "Elementary School")];

const judge = (id: string, name: string, panel_id: string | null): JudgeRow => ({ id, name, note: null, panel_id, created_at: "2026-10-20T08:00:00Z" });
const dana = judge("j-dana", "Dana Ruiz", "p1");
const priya = judge("j-priya", "Priya Nair", "p2");
const lee = judge("j-lee", "Lee Chen", "p2");
const tom = judge("j-tom", "Tom Baker", "p3");
const jordan = judge("j-jordan", "Jordan Kim", null);
const roster = [dana, priya, lee, tom, jordan];

const team = (number: string, name: string, panel_id: string | null, division = "Middle School"): Team => ({
  id: `t-${number}`, number, name, panel_id, division, category: "developing", pit: null, created_at: "2026-10-20T08:00:00Z",
});
const titans = team("9882K", "Torque Titans", "p1", "High School");
const byteMe = team("7700B", "Byte Me", null);
const sparky = team("5150Z", "Sparky", null);
const breakers = team("1234X", "Circuit Breakers", "p3");
const rivets = team("2468E", "Rivet Riders", "p4", "Elementary School");
const teams = [titans, byteMe, sparky, breakers, rivets];

const byJudge = (id: string, judge_id: string, t: Team, note: string | null = null): ConflictRow => ({
  id, panel_id: null, judge_id, team_id: t.id, judge_name: null, note, declared_by: "admin:Alex", created_at: "2026-10-20T09:00:00Z",
});
const byPanel = (id: string, panel_id: string, t: Team): ConflictRow => ({
  id, panel_id, judge_id: null, team_id: t.id, judge_name: "Priya Nair", note: null, declared_by: "admin:Alex", created_at: "2026-10-20T09:00:00Z",
});

// The Conflicts mocks, as data.
const mock: ConflictRow[] = [
  byJudge("c1", priya.id, titans, "coaches this team"),
  byJudge("c2", priya.id, byteMe),
  byJudge("c3", lee.id, sparky),
  byJudge("c4", jordan.id, breakers, "mentor"),
  byPanel("c5", "p4", rivets),
];

function tab(over: Partial<AppState> = {}) {
  const state = { panels, teams, judges: roster, conflicts: mock, ...over } as unknown as AppState;
  return renderToStaticMarkup(<ConflictsTab state={state} refresh={async () => {}} onError={() => {}} />);
}
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
const group = (markup: string, name: string) =>
  [...markup.matchAll(/<section class="ja-grp"[\s\S]*?<\/section>/g)].map((m) => m[0]).find((g) => g.includes(`>${name}</h3>`)) ?? "";
const rowOf = (markup: string, number: string) =>
  markup.split('<li class="ja-cr">').find((r) => r.includes(`<b>${number}</b>`)) ?? "";
const aside = (markup: string) => markup.match(/<aside class="ja-aside"[\s\S]*?<\/aside>/)?.[0] ?? "";

/* ---- the list --------------------------------------------------------------- */

test("the list is grouped by judge, only judges with conflicts, in roster order", () => {
  const m = tab();
  assert.deepEqual([...m.matchAll(/<section class="ja-grp"[^>]*><header class="ja-gh(?: ja-old)?"><h3 id="[^"]+">(.*?)<\/h3>/g)].map((x) => x[1]), [
    "Priya Nair",
    "Lee Chen",
    "Jordan Kim",
    "Whole panel (older entries)",
  ]);
  assert.doesNotMatch(m, />Dana Ruiz<\/h3>|>Tom Baker<\/h3>/, "judges with no conflicts are not listed");
  assert.match(m, /<h2 class="sr-only" id="[^"]+">Conflicts by judge<\/h2>/);
});

test("a judge's header has the panel tag, what it blocks and the count; one with no panel says so", () => {
  const priyaHead = group(tab(), "Priya Nair").match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.match(priyaHead, /<span class="jg-ptag">Panel 2 · MS<\/span>/);
  assert.match(text(priyaHead), /Blocks Panel 2/);
  assert.match(priyaHead, /<span class="ja-gn">2 conflicts<\/span>/);
  assert.match(group(tab(), "Lee Chen"), /<span class="ja-gn">1 conflict<\/span>/);

  const jordanHead = group(tab(), "Jordan Kim").match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.match(jordanHead, /<span class="ja-blk">Not on a panel yet<\/span>/);
  assert.doesNotMatch(jordanHead, /jg-ptag|Blocks/);
});

test("a row has the team, the note in quotes, a needs-a-panel pill for an unassigned team, and a labelled Withdraw", () => {
  const priyaGroup = group(tab(), "Priya Nair");
  const titansRow = rowOf(priyaGroup, "9882K");
  assert.match(titansRow, /<b>9882K<\/b><span class="ja-tn">Torque Titans<\/span>/);
  assert.match(titansRow, /<span class="ja-nt">“coaches this team”<\/span>/);
  assert.doesNotMatch(titansRow, /needs a panel/, "Torque Titans is on a panel");
  assert.match(titansRow, /<button type="button" class="ja-wd" aria-haspopup="dialog" aria-label="Withdraw conflict: 9882K, Priya Nair">Withdraw<\/button>/);

  const byteRow = rowOf(priyaGroup, "7700B");
  assert.match(byteRow, /<span class="ja-pill ja-fg">[\s\S]*needs a panel<\/span>/);
  assert.match(byteRow, /aria-label="Withdraw conflict: 7700B, Priya Nair"/);
  assert.doesNotMatch(byteRow, /“/, "no note, no quotes");
});

test("the older whole-panel entries are a group of their own, last, with the sub-line, the panel tag and Withdraw", () => {
  const old = group(tab(), "Whole panel (older entries)");
  assert.ok(old, "the legacy group renders");
  assert.match(old, /<span class="ja-gn">1 entry<\/span>/);
  assert.match(old, /<p class="ja-sub">Apply to every judge on the panel, not one judge\.<\/p>/);
  assert.match(old, /<b>2468E<\/b><span class="ja-tn">Rivet Riders<\/span>/);
  assert.match(old, /<span class="jg-ptag ja-nt">Panel 4 · ES<\/span>/);
  assert.match(old, /aria-label="Withdraw conflict: 2468E, whole Panel 4"/);
  assert.ok(tab().indexOf(">Whole panel (older entries)</h3>") > tab().indexOf(">Jordan Kim</h3>"), "after the judges");
  // With none of them the group is not there.
  assert.doesNotMatch(tab({ conflicts: mock.slice(0, 4) }), /older entries/);
});

test("with no conflicts at all the list says so; older entries alone are not 'no conflicts'", () => {
  const empty = tab({ conflicts: [] });
  assert.match(text(empty), /No conflicts yet\. Ask each judge which teams they&#x27;re affiliated with, and record the answers\./);
  assert.doesNotMatch(empty, /ja-grp/);
  const legacyOnly = tab({ conflicts: [byPanel("c5", "p4", rivets)] });
  assert.doesNotMatch(legacyOnly, /No conflicts yet/);
  assert.match(legacyOnly, /Whole panel \(older entries\)/);
  assert.doesNotMatch(tab(), /No conflicts yet/);
});

test("the stranded alert names teams with no panel left, worked out through the roster", () => {
  assert.doesNotMatch(tab(), /ja-str/, "Panel 3 can still judge Sparky");
  // Tom, on Panel 3, is affiliated with Sparky too: both Middle School panels are blocked.
  const m = tab({ conflicts: [...mock, byJudge("c6", tom.id, sparky)] });
  const alert = m.match(/<section class="ja-str" role="alert"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(text(alert), /One team has no panel left to judge them/);
  assert.match(text(alert), /Every panel in its division is conflicted, so auto-assign skips it\. Move a panel into the division, or withdraw a conflict\./);
  assert.match(alert, /<b>5150Z<\/b> \(MS\)/);
  // Tom off the panel: the block goes with him, and so does the alert.
  assert.doesNotMatch(tab({ conflicts: [...mock, byJudge("c6", tom.id, sparky)], judges: roster.map((j) => (j.id === tom.id ? { ...j, panel_id: null } : j)) }), /ja-str/);
});

/* ---- the form --------------------------------------------------------------- */

test("the Judge select groups by panel, then Not on a panel, and ends with + New judge…", () => {
  const select = aside(tab()).match(/<select[\s\S]*?<\/select>/)?.[0] ?? "";
  assert.match(select, /id="[^"]+-judge" class="ja-in ja-sel"/);
  assert.deepEqual(
    [...select.matchAll(/<optgroup label="([^"]+)">([\s\S]*?)<\/optgroup>/g)].map((m) => [m[1], [...m[2].matchAll(/<option value="[^"]+">(.*?)<\/option>/g)].map((o) => o[1])]),
    [
      ["Panel 1 · HS", ["Dana Ruiz"]],
      ["Panel 2 · MS", ["Priya Nair", "Lee Chen"]],
      ["Panel 3 · MS", ["Tom Baker"]],
      ["Not on a panel", ["Jordan Kim"]],
    ],
  );
  assert.ok(select.endsWith('<option value="new">+ New judge…</option></select>'), "the new-judge option is last");
  // Nobody is picked for you: a conflict recorded against the wrong judge is a wrong block.
  assert.match(select, /<option value="" disabled="" selected="">Choose a judge…<\/option>/);
  assert.match(aside(tab()), /<button type="submit" class="ja-prim" disabled="">Record conflicts<\/button>/, "so Record waits for one");
});

test("with nobody on the roster the form is already on + New judge…, asking for a name and an optional note", () => {
  const m = aside(tab({ judges: [], conflicts: [] }));
  assert.match(m, /<option value="new" selected="">\+ New judge…<\/option>/);
  assert.match(m, /<label class="ja-lab" for="[^"]+-name">Judge&#x27;s name<\/label><input id="[^"]+-name"/);
  assert.match(m, /About them <span class="ja-op">\(optional\)<\/span>/);
  assert.match(m, /<span class="ja-blk">Not on a panel yet<\/span>/);
  // With a roster, the name field is not there until + New judge… is picked.
  assert.doesNotMatch(aside(tab()), /Judge&#x27;s name/);
});

test("the form has the spec's fields, hints and primary button", () => {
  const m = aside(tab());
  assert.match(m, /^<aside class="ja-aside" aria-labelledby="([^"]+)"><form class="ja-fc"><h2 id="\1">Record conflicts<\/h2>/);
  assert.match(m, /<label class="ja-lab" for="[^"]+-nums">Team numbers<\/label><textarea id="[^"]+-nums" class="ja-in ja-ta" rows="3" placeholder="1234, 5678, 9882K" autoCapitalize="characters"/);
  assert.match(m, /<p class="ja-hint" id="[^"]+-nums-h">commas, spaces or one per line<\/p>/);
  assert.match(m, /Note <span class="ja-op">\(optional\)<\/span>/);
  assert.match(m, /maxLength="280"/);
  assert.match(m, /<p class="ja-hint" id="[^"]+-note-h">Only when you enter one team<\/p>/);
  // Nothing recorded yet, so no result box; the live region is there to announce the first.
  assert.match(m, /<div role="status"><\/div>/);
  assert.doesNotMatch(m, /Last recording/);
});

test("the Last recording box shows all four kinds of line, each in its own colour class", () => {
  const box = renderToStaticMarkup(
    <RecordingResult
      panels={panels}
      result={{ judge: priya, recorded: ["9882K", "7700B"], unchanged: ["5150Z"], notFound: ["0420Z"], takenOff: ["7700B"] }}
    />,
  );
  assert.match(box, /^<div role="status"><section class="ja-res" aria-labelledby="([^"]+)"><h3 class="ja-sec" id="\1">Last recording<\/h3>/);
  const lines = [...box.matchAll(/<li class="ja-r-(\w+)">[\s\S]*?<span>([\s\S]*?)<\/span><\/li>/g)].map((m) => [m[1], text(m[2])]);
  assert.deepEqual(lines, [
    ["ok", "Recorded for Priya Nair: 9882K, 7700B"],
    ["warn", "Priya Nair is on Panel 2, so 7700B comes off it and needs a panel"],
    ["mute", "Already recorded: 5150Z"],
    ["bad", "No team with that number — check these: 0420Z"],
  ]);
  assert.match(box, /<b>9882K<\/b>, <b>7700B<\/b>/, "the numbers stand out");
  // Nothing shown for a line with nothing in it.
  const only = renderToStaticMarkup(<RecordingResult panels={panels} result={{ judge: priya, recorded: ["9882K"], unchanged: [], notFound: [], takenOff: [] }} />);
  assert.equal(only.match(/<li /g)?.length, 1);
});

/* ---- the phone's sheet ------------------------------------------------------ */

test("on a phone a Record conflicts button is pinned under the list and a closed native dialog holds the form", () => {
  const m = tab();
  assert.match(m, /<div class="ja-pin"><button type="button" class="ja-prim" aria-haspopup="dialog">Record conflicts<\/button><\/div>/);
  const dialog = m.match(/<dialog class="ja-sheet ja-cfs"[\s\S]*?<\/dialog>/)?.[0] ?? "";
  assert.match(dialog, /^<dialog class="ja-sheet ja-cfs" aria-modal="true" aria-labelledby="[^"]+">/);
  assert.doesNotMatch(dialog, /^<dialog[^>]* open/, "closed until the button opens it");
  assert.doesNotMatch(dialog, /<form|<select/, "its form only exists while it is open, so the page never has two");
  assert.equal(m.match(/<select/g)?.length, 1);
});

/* ---- the wiring (source) ---------------------------------------------------- */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const src = read("src/components/admin/ConflictsTab.tsx");
const page = read("src/app/admin/page.tsx");

test("the pinned button opens the sheet with showModal(); Escape, the backdrop, Close and a wider window close it", () => {
  assert.match(src, /aria-haspopup="dialog" onClick=\{\(\) => setSheet\(true\)\}/);
  assert.ok(src.includes("el.showModal()") && src.includes("el.close()"));
  assert.match(src, /onClose=\{\(\) => \{\s*if \(sheet\) setSheet\(false\);/);
  assert.match(src, /if \(e\.target === e\.currentTarget\) setSheet\(false\);/);
  assert.match(src, /aria-label="Close" onClick=\{\(\) => setSheet\(false\)\}/);
  assert.ok(src.includes('window.matchMedia("(min-width: 1024px)")'));
});

test("Withdraw goes through the confirm and only the confirm; recording goes through recordConflicts", () => {
  assert.ok(src.includes("const { ask, dialog } = useConfirm();") && src.includes("{dialog}"));
  assert.ok(src.includes("withdrawAfterAsking(ask, question, async () => {"));
  assert.equal(src.match(/method: "DELETE"/g)?.length, 1, "one delete, inside the confirmed callback");
  assert.ok(src.indexOf('method: "DELETE"') > src.indexOf("withdrawAfterAsking(ask"));
  assert.ok(src.includes("recordConflicts(call, input,"));
  assert.ok(!src.includes("confirm("), "never window.confirm");
  assert.ok(!/\.panel_id\b[^;\n]*conflict|\bc\.panel_id\b/.test(src), "no conflict decision of its own: the rule is panelBlocks");
});

test("the page uses the tab, counts judge conflicts only, and the old tab and its dialog are gone", () => {
  assert.ok(page.includes("<ConflictsTab state={state}"));
  assert.ok(page.includes("railCounts(state)"));
  assert.ok(!page.includes("conflicts: state.conflicts.length"), "the rail count is not every conflict");
  assert.ok(!page.includes("function ConflictsTab(") && !page.includes("BulkConflictResult"));
  assert.ok(!page.includes("ConflictDialog"));
});

test("the Panels tab has no judges text field any more: a move looks first (dryRun) and asks inside the roster board", () => {
  const panelsTab = read("src/components/admin/PanelsTab.tsx");
  const panelsLogic = read("src/components/admin/panelsLogic.ts");
  assert.ok(!page.includes("saveJudgesAfterAsking(") && !page.includes("Judge names, comma separated"));
  assert.ok(!panelsTab.includes("Judge names, comma separated") && !panelsTab.includes("saveJudgesAfterAsking"), "the roster replaced the field");
  assert.match(panelsLogic, /body: \{ \.\.\.body, dryRun: true \}/);
  assert.ok(panelsTab.includes("moveJudgeShowing("));
});

/* ---- arriving from Panels --------------------------------------------------- */

const arrive = (focus: string | null, over: Partial<AppState> = {}) =>
  renderToStaticMarkup(
    <ConflictsTab
      state={{ panels, teams, judges: roster, conflicts: mock, ...over } as unknown as AppState}
      refresh={async () => {}}
      onError={() => {}}
      focusJudgeId={focus}
    />,
  );

test("the 'N conflicts' link on Panels lands here with that judge's group marked and focusable, and the form on them", () => {
  const m = arrive(priya.id);
  assert.match(m, /<section class="ja-grp ja-fx" tabindex="-1" aria-labelledby="g-j-priya">/);
  assert.equal(m.match(/ja-fx/g)?.length, 1, "only that judge's group");
  assert.doesNotMatch(group(m, "Lee Chen"), /ja-fx/);
  const select = aside(m).match(/<select[\s\S]*?<\/select>/)?.[0] ?? "";
  assert.match(select, /<option value="j-priya" selected="">Priya Nair<\/option>/, "the Judge select is on them");
  assert.doesNotMatch(select, /Choose a judge/);
  assert.match(text(aside(m)), /Blocks Panel 2/);
});

test("without a focus, or with a judge who has no conflicts or is gone, nothing is marked and the form waits for a choice", () => {
  for (const focus of [null, dana.id, "j-gone"]) {
    const m = arrive(focus);
    assert.doesNotMatch(m, /ja-fx|tabindex="-1"/, `focus ${focus}`);
  }
  assert.match(aside(arrive(null)), /<option value="" disabled="" selected="">Choose a judge…<\/option>/);
  // A judge with no conflicts is still a valid pick for the form (their group just is not there).
  assert.match(aside(arrive(dana.id)), /<option value="j-dana" selected="">Dana Ruiz<\/option>/);
  assert.match(aside(arrive("j-gone")), /Choose a judge…/, "an unknown id is not a choice");
});

test("the tab scrolls the marked group into view after the frame's own scroll-to-top, and the page hands it the focus", () => {
  assert.match(src, /el\.focus\(\{ preventScroll: true \}\);\s*const frame = requestAnimationFrame\(\(\) => el\.scrollIntoView\?\.\(\{ block: "nearest" \}\)\);/);
  assert.match(src, /\}, \[focusJudgeId\]\);/);
  assert.ok(src.includes("useRecorder(state.judges, refresh, focusJudgeId ?? \"\")"));
  assert.ok(page.includes("focusJudgeId={focusJudge}"));
});

test("the Conflicts styles are page-scoped, use tokens for both themes, and have no animation", () => {
  const css = read("src/app/globals.css");
  const block = css.slice(css.indexOf("/* Conflicts (design/admin-redesign"));
  assert.ok(block.length > 100);
  assert.doesNotMatch(block, /@keyframes|animation|transition/, "no playful motion");
  assert.doesNotMatch(block, /oklch\(|#[0-9a-f]{3,6}\b/i, "colours come from the tokens, so light works too");
  assert.match(block, /\.ja-r-ok \{ color: var\(--done-quiet\)/);
  assert.match(block, /\.ja-r-warn \{ color: var\(--caution-quiet\)/);
  assert.match(block, /\.ja-r-bad \{ color: var\(--danger-quiet\)/);
  assert.match(block, /\.ja-prim \{[^}]*background: var\(--accent\)/, "the primary is the accent");
  assert.match(block, /\.ja-wd \{[^}]*height: 44px/, "Withdraw is a 44px target on a phone");
  assert.match(block, /@media \(min-width: 1024px\) \{[\s\S]*\.ja-aside \{[^}]*position: sticky/, "pinned right from 1024px");
  assert.match(block, /@media \(min-width: 1024px\) \{[\s\S]*\.ja-pin \{ display: none; \}/);
  assert.match(block, /\.ja-aside \{ display: none; \}/, "and not there on a phone");
});
