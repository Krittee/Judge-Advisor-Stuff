import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AwardChips, FinishedCard, NominateSheet } from "../src/components/judge/Nominate";
import { QueueTab, type NominateActions } from "../src/components/judge/QueueTab";
import type { Finished } from "../src/components/judge/nominations";
import type { QueueCard } from "../src/lib/judgeQueue";
import type { AwardView, NominationRow, RequestRow, Team } from "../src/lib/types";

/* The judge's award nominations, rendered to markup: the card after Finish,
   its chips, the Done rows and the sheet. There is no DOM harness here, so a
   "tap" is the click handler the markup would get, called as React would
   (`tapButton`), and the decisions behind each tap run in
   judgeNominate.logic.test.mjs. The page's wiring is read from source at the foot. */

const NOW = new Date(2026, 9, 17, 12, 36).getTime();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const noop = () => {};

// The labels come from config/event.json through GET /api/awards: these are not the real ones on purpose.
const awards: AwardView[] = [
  { id: "excellence", label: "Top Prize", short: "Top", blurb: "Overall excellence." },
  { id: "design", label: "Design", short: "Des", blurb: "An organised design process." },
  { id: "think", label: "Think", short: "Thk", blurb: "Coding and software." },
  { id: "inspire", label: "Inspire", short: "Ins", blurb: "Passion and spirit." },
];
const me = { judge: "Sam Rivera", panelId: "p2" };

const categories = [{ id: "developing", label: "Developing", color: "amber", excludesRubrics: [] }];
const team = (number: string, name: string): Team => ({
  id: `t-${number}`,
  number,
  name,
  panel_id: "p2",
  division: "Middle School",
  category: "developing",
  pit: "22",
  created_at: "2026-10-17T08:00:00Z",
});
const request = (t: Team, status: RequestRow["status"], over: Partial<RequestRow> = {}): RequestRow => ({
  id: `r-${t.number}`,
  team_id: t.id,
  panel_id: "p2",
  status,
  kind: "queue",
  language: "en",
  slot_start: null,
  slot_end: null,
  message: null,
  created_by: null,
  acknowledged_by: null,
  interviewer: null,
  outcome: null,
  requested_at: ago(5),
  acknowledged_at: null,
  started_at: null,
  finished_at: null,
  cancelled_at: null,
  updated_at: ago(1),
  ...over,
});
const nomination = (t: Team, award: string, judge = "Sam Rivera", over: Partial<NominationRow> = {}): NominationRow => ({
  id: `${t.id}-${award}-${judge}`,
  award_id: award,
  team_id: t.id,
  panel_id: "p2",
  judge,
  reason: null,
  created_at: ago(2),
  updated_at: ago(2),
  ...over,
});
const card = (t: Team, req: RequestRow | null): QueueCard => ({
  team: t,
  request: req,
  score: { total: 0, max: 76, scored: false },
});

const byteMe = team("7700B", "Byte Me");
const circuit = team("1234A", "Circuit Breakers");
const pixel = team("3456P", "Pixel Pushers");
const torque = team("9882K", "Torque Titans");

type Taps = { toggled: [string, string, boolean][]; done: string[]; nominate: [string, string][] };

function actions(over: Partial<NominateActions> = {}): { nominate: NominateActions; taps: Taps } {
  const taps: Taps = { toggled: [], done: [], nominate: [] };
  const nominate: NominateActions = {
    awards,
    nominations: [],
    me,
    finished: null,
    onToggle: (teamId, awardId, on) => taps.toggled.push([teamId, awardId, on]),
    onDone: (t) => taps.done.push(t.number),
    onNominate: (t, view) => taps.nominate.push([t.number, view]),
    ...over,
  };
  return { nominate, taps };
}

const finishedFor = (c: QueueCard): Finished => ({ card: c, at: new Date(2026, 9, 17, 10, 58).toISOString() });

function queue(cards: QueueCard[], nominate: NominateActions | undefined, completed: Team[]) {
  return (
    <QueueTab
      cards={cards}
      completed={new Set(completed.map((t) => t.id))}
      categories={categories}
      languages={[]}
      flags={[]}
      flagKinds={[]}
      now={NOW}
      busy={null}
      onAdvance={noop}
      onOpen={noop}
      nominate={nominate}
    />
  );
}

/** Every element in the tree, function components called as React would (none here uses a hook). */
function walk(node: ReactNode, visit: (el: ReactElement<Record<string, unknown>>) => void) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!isValidElement(node)) return;
  const el = node as ReactElement<Record<string, unknown>>;
  visit(el);
  walk(typeof el.type === "function" ? (el.type as (p: unknown) => ReactNode)(el.props) : (el.props.children as ReactNode), visit);
}
const text = (node: ReactNode): string =>
  Array.isArray(node) ? node.map(text).join("") : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === "string" || typeof node === "number" ? String(node) : "";

/** The click handler of the button whose words are `label`, called the way a tap would. */
function tapButton(tree: ReactNode, label: string) {
  let hit: (() => void) | null = null;
  walk(tree, (el) => {
    if (el.type === "button" && text(el.props.children as ReactNode).trim() === label && !hit) hit = el.props.onClick as () => void;
  });
  assert.ok(hit, `no button reads "${label}"`);
  (hit as () => void)();
}

const chipsIn = (markup: string) => [...markup.matchAll(/<button type="button" class="jg-ach" aria-pressed="(true|false)"[^>]*>.*?<span>(.*?)<\/span><\/button>/g)].map((m) => [m[2], m[1] === "true"]);

/* ---- right after Finish --------------------------------------------------- */

test("after Finish the hero is the green finished card with the team, the question and the chips", () => {
  const done = card(byteMe, null);
  const { nominate } = actions({ finished: finishedFor(done) });
  const markup = renderToStaticMarkup(queue([done, card(pixel, request(pixel, "requested"))], nominate, [byteMe]));

  const hero = markup.match(/<section class="jg-hero jg-t-done jg-fin"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(hero, /aria-label="Interview finished"/);
  assert.match(hero, /<span class="jg-eyebrow">Interview finished · 10:58<\/span><span class="jg-sc jg-s-completed">Complete<\/span>/);
  assert.match(hero, /<h2 class="jg-hn">7700B<\/h2><p class="jg-hname">Byte Me<\/p>/);
  assert.match(hero, /<p class="jg-fq">Nominate 7700B for an award\?<small>Each tap saves\. The Judge Advisor decides\.<\/small><\/p>/);
  assert.match(hero, /role="group" aria-label="Awards for 7700B"/);
  assert.match(hero, /<button type="button" class="jg-ghost jg-lg">Done<\/button><button type="button" class="jg-lnk">Add a reason<\/button>/);
  // The normal hero (and its Notes & scores button) is not drawn beside it.
  assert.doesNotMatch(markup, /Up next|Notes &amp; scores|jg-go jg-s-acknowledged">On our way<\/button><\/section>/);
});

test("the chips are the config's awards in the config's order, with its names", () => {
  const markup = renderToStaticMarkup(queue([card(byteMe, null)], actions({ finished: finishedFor(card(byteMe, null)) }).nominate, [byteMe]));
  assert.deepEqual(
    chipsIn(markup).map(([label]) => label),
    ["Top Prize", "Design", "Think", "Inspire"],
  );
  assert.doesNotMatch(markup, /Excellence/, "no award name is written in the code");
  assert.match(markup, /title="Overall excellence\."/, "the blurb is the chip's hint");
});

test("a chip is pressed for my nomination only: not a co-judge's, not another team's", () => {
  const done = card(byteMe, null);
  const { nominate } = actions({
    finished: finishedFor(done),
    nominations: [
      nomination(byteMe, "excellence"),
      nomination(byteMe, "design", "Priya Nair"),
      nomination(circuit, "think"),
      nomination(byteMe, "inspire", "Sam Rivera", { panel_id: "p3" }),
    ],
  });
  const markup = renderToStaticMarkup(queue([done], nominate, [byteMe]));
  assert.deepEqual(chipsIn(markup), [["Top Prize", true], ["Design", false], ["Think", false], ["Inspire", false]]);
});

test("waiting teams stay below the card, with no alert row about them", () => {
  const done = card(byteMe, null);
  const waiting = card(pixel, request(pixel, "requested"));
  const markup = renderToStaticMarkup(queue([done, waiting], actions({ finished: finishedFor(done) }).nominate, [byteMe]));
  assert.ok(markup.indexOf("jg-fin") < markup.indexOf('id="jg-waiting"'), "the card first, the waiting section under it");
  assert.match(markup, /<b>3456P<\/b>/);
  assert.doesNotMatch(markup, /jg-alert/);
  // The finished team is on the card, not repeated in Done.
  assert.doesNotMatch(markup, /jg-done/);
});

test("once the normal hero takes over, the finished team is in Done with its nominations", () => {
  const done = card(byteMe, null);
  const next = card(pixel, request(pixel, "acknowledged"));
  // pickFinished has yielded: no `finished`.
  const markup = renderToStaticMarkup(queue([done, next], actions({ nominations: [nomination(byteMe, "excellence")] }).nominate, [byteMe]));
  assert.doesNotMatch(markup, /jg-fin|Interview finished/);
  assert.match(markup, /<section class="jg-hero[^"]*" aria-label="On the way">/);
  const row = markup.match(/<div class="jg-qrow jg-drow">[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(row, /<b>7700B<\/b><span>Byte Me<\/span>/);
  assert.match(row, /Top Prize/);
});

/* ---- a tap saves ---------------------------------------------------------- */

test("tapping a chip sends the opposite of how it is pressed, for that chip", () => {
  const taps: [string, boolean][] = [];
  const tree = AwardChips({ team: byteMe, awards, pressed: new Set(["excellence"]), onToggle: (id, on) => taps.push([id, on]) });
  tapButton(tree, "Design");
  tapButton(tree, "Top Prize");
  assert.deepEqual(taps, [["design", true], ["excellence", false]], "unpressed nominates, pressed withdraws");
});

test("on the card, a chip tap reaches the page as (team, award, on); Done and Add a reason name the team", () => {
  const done = card(byteMe, null);
  const { nominate, taps } = actions({ finished: finishedFor(done), nominations: [nomination(byteMe, "excellence")] });
  const tree = queue([done], nominate, [byteMe]);
  tapButton(tree, "Think");
  tapButton(tree, "Top Prize");
  tapButton(tree, "Done");
  tapButton(tree, "Add a reason");
  assert.deepEqual(taps.toggled, [["t-7700B", "think", true], ["t-7700B", "excellence", false]]);
  assert.deepEqual(taps.done, ["7700B"]);
  assert.deepEqual(taps.nominate, [["7700B", "reasons"]]);
});

test("the finished card is a plain component the page can drop in: no hooks, one chip per award", () => {
  const tree = FinishedCard({ finished: finishedFor(card(byteMe, null)), awards, pressed: new Set(), onToggle: noop, onDone: noop, onReason: noop });
  let chips = 0;
  walk(tree, (el) => {
    if (el.type === "button" && el.props.className === "jg-ach") chips += 1;
  });
  assert.equal(chips, awards.length);
});

/* ---- the Done rows --------------------------------------------------------- */

test("each Done row lists the panel's nominations with Edit, or says none with Nominate", () => {
  const cards = [card(pixel, request(pixel, "requested")), card(byteMe, null), card(circuit, null), card(torque, null)];
  const { nominate } = actions({
    nominations: [
      nomination(byteMe, "design", "Priya Nair"),
      nomination(byteMe, "excellence", "Sam Rivera"),
      nomination(byteMe, "excellence", "Priya Nair"),
      nomination(circuit, "think"),
      nomination(torque, "inspire", "Lena Ortiz", { panel_id: "p3" }),
    ],
  });
  const markup = renderToStaticMarkup(queue(cards, nominate, [byteMe, circuit, torque]));
  const rows = markup.match(/<div class="jg-qrow jg-drow">[\s\S]*?<\/div>/g) ?? [];
  assert.equal(rows.length, 3);

  assert.match(rows[0], /<b>1234A<\/b>[\s\S]*<span class="jg-dn">.*Think<\/span>[\s\S]*aria-label="Edit nominations for 1234A">Edit<\/button>/);
  assert.match(rows[1], /<b>7700B<\/b>[\s\S]*<span class="jg-dn">.*Top Prize ×2 · Design<\/span>[\s\S]*aria-label="Edit nominations for 7700B">Edit<\/button>/);
  // Another panel's nomination is not this panel's.
  assert.match(rows[2], /<b>9882K<\/b>[\s\S]*<span class="jg-dn jg-no">.*No nominations<\/span>[\s\S]*aria-label="Nominate 9882K">Nominate<\/button>/);
  assert.match(rows[1], /<svg width="13" height="13"/, "the trophy");
});

test("Edit and Nominate open the chips for that team; the rest of the row still opens the team sheet", () => {
  const opened: string[] = [];
  const cards = [card(byteMe, null), card(torque, null)];
  const { nominate, taps } = actions({ nominations: [nomination(byteMe, "design")] });
  const tree = (
    <QueueTab
      cards={cards}
      completed={new Set([byteMe.id, torque.id])}
      categories={categories}
      languages={[]}
      flags={[]}
      flagKinds={[]}
      now={NOW}
      busy={null}
      onAdvance={noop}
      onOpen={(t) => opened.push(t.number)}
      nominate={nominate}
    />
  );
  tapButton(tree, "Edit");
  tapButton(tree, "Nominate");
  assert.deepEqual(taps.nominate, [["7700B", "chips"], ["9882K", "chips"]]);
  assert.deepEqual(opened, []);
  let openers = 0;
  walk(tree, (el) => {
    if (el.type === "button" && el.props.className === "jg-qmain") {
      (el.props.onClick as () => void)();
      openers += 1;
    }
  });
  assert.equal(openers, 2);
  assert.deepEqual(opened, ["7700B", "9882K"]);
});

test("with no awards in config, or no nominate props, the Queue is as it was", () => {
  const cards = [card(byteMe, null)];
  const bare = renderToStaticMarkup(queue(cards, undefined, [byteMe]));
  const empty = renderToStaticMarkup(queue(cards, actions({ awards: [], finished: finishedFor(cards[0]) }).nominate, [byteMe]));
  for (const markup of [bare, empty]) {
    assert.doesNotMatch(markup, /jg-fin|jg-drow|jg-ach|Nominate/);
    assert.match(markup, /<div class="jg-qrow ">/, "the ordinary Done row");
  }
});

/* ---- the sheet ------------------------------------------------------------- */

const sheetProps = { awards, nominations: [] as NominationRow[], me, onSet: async () => null, onClose: noop };

test("closed, the sheet is an empty native dialog; open, a labelled modal with the same chips", () => {
  const closed = renderToStaticMarkup(<NominateSheet team={null} view="chips" {...sheetProps} />);
  assert.match(closed, /<dialog[^>]*class="jg-sheet jg-nsheet"[^>]*aria-modal="true"[^>]*aria-labelledby=/);
  assert.doesNotMatch(closed, /<h2|<button/);

  const markup = renderToStaticMarkup(
    <NominateSheet team={byteMe} view="chips" {...sheetProps} nominations={[nomination(byteMe, "design")]} />,
  );
  const labelledby = markup.match(/<dialog[^>]*aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(labelledby);
  assert.match(markup, new RegExp(`<h2 id="${labelledby}">7700B</h2><p class="jg-nm">Byte Me</p>`));
  assert.match(markup, /<button type="button" class="jg-x" aria-label="Close">/);
  assert.match(markup, /Nominate 7700B for an award\?/);
  assert.deepEqual(chipsIn(markup), [["Top Prize", false], ["Design", true], ["Think", false], ["Inspire", false]]);
  assert.match(markup, /<button type="button" class="jg-ghost jg-lg">Done<\/button><button type="button" class="jg-lnk">Add a reason<\/button>/);
});

test("the reasons view has one optional textarea per pressed award, filled with the stored reason", () => {
  const markup = renderToStaticMarkup(
    <NominateSheet
      team={byteMe}
      view="reasons"
      {...sheetProps}
      nominations={[
        nomination(byteMe, "design", "Sam Rivera", { reason: "Tidy notebook" }),
        nomination(byteMe, "think"),
        nomination(byteMe, "inspire", "Priya Nair", { reason: "Hers, not mine" }),
      ]}
    />,
  );
  assert.equal(markup.match(/<textarea/g)?.length, 2, "Design and Think are mine; Inspire is a co-judge's");
  assert.match(markup, />Why Design\?<\/label><small>An organised design process\.<\/small>/);
  assert.match(markup, />Why Think\?<\/label>/);
  assert.doesNotMatch(markup, /Why Inspire|Why Top Prize/);
  assert.match(markup, /maxLength="500"|maxlength="500"/);
  assert.ok(markup.includes(">Tidy notebook</textarea>"));
  assert.doesNotMatch(markup, /Hers, not mine/);
  assert.match(markup, /<button type="button" class="jg-prim" disabled="">Save reasons<\/button>/, "nothing changed yet");
  assert.doesNotMatch(markup, /jg-ach/, "chips live on the other view");
});

test("with nothing pressed the reasons view says to nominate first", () => {
  const markup = renderToStaticMarkup(<NominateSheet team={byteMe} view="reasons" {...sheetProps} />);
  assert.match(markup, /<p class="jg-none">Nominate 7700B for an award first, then say why\.<\/p>/);
  assert.doesNotMatch(markup, /<textarea/);
});

test("the sheet closes on Escape and the backdrop, and a modal shows its own errors", () => {
  const src = read("src/components/judge/Nominate.tsx");
  assert.ok(src.includes("dialog.showModal()") && src.includes("dialog.close()"));
  assert.match(src, /onClose=\{\(\) => \{\s*if \(open\) onClose\(\);\s*\}\}/, "Escape");
  assert.match(src, /e\.target === e\.currentTarget\) onClose\(\)/, "the backdrop");
  assert.ok(src.includes("<Body key={`${team.id}:${view}`}"), "another team, or the other view, starts fresh");
  assert.ok(src.includes('<Banner kind="error">{error}</Banner>'), "the page's banner is behind the modal");
  assert.doesNotMatch(src, /window\.confirm|confirm\(/);
});

/* ---- the page's wiring (source) -------------------------------------------- */

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}
const page = read("src/app/judge/page.tsx");

test("Finish marks the team before the refresh, so the card is there the moment the queue is", () => {
  assert.match(page, /primaryAction\(request\.status\)\?\.to === "completed"/, "only the step that completes an interview");
  const marked = page.indexOf("setFinishedId(request.team_id)");
  assert.ok(marked > 0 && marked < page.indexOf("await refresh();"), "marked, and before the refresh");
  assert.match(page, /pickFinished\(cards, state\.requests, finishedId, dismissed\)/);
  assert.match(page, /onDone: \(team\) => setDismissed\(\(d\) => new Set\(d\)\.add\(team\.id\)\)/, "Done is remembered per team, in memory");
  assert.doesNotMatch(page, /localStorage|sessionStorage/);
});

test("a failed chip tap goes to the page's error banner; the Judge Advisor gets no awards", () => {
  assert.match(page, /awards\.set\(teamId, awardId, on\)\.then\(\(failed\) => failed && setError\(failed\)\)/);
  assert.ok(page.includes('<Banner kind="error" onDismiss'));
  assert.match(page, /session\?\.role === "judge" \? \{ judge: session\.name, panelId: session\.panelId \} : null/);
  assert.ok(page.includes("useNominations(me)"));
});

test("the hook reads /api/awards on mount, after writes and every 15 s, and guards each chip", () => {
  const hook = read("src/components/judge/useNominations.ts");
  assert.ok(hook.includes('"/api/awards", { method: "GET" }'));
  assert.ok(hook.includes("setInterval(load, 15_000)") && hook.includes("visibilitychange"));
  assert.ok(hook.includes("const writing = useRef(new Set<string>())"));
  assert.match(hook, /if \(writing\.current\.has\(key\)\) return/);
  assert.ok(hook.includes("sendNomination(call,"), "the write is the tested one");
  assert.ok(hook.includes("applyPending(") && hook.includes("withSaved(") && hook.includes("withoutMine("));
  assert.match(hook, /finally \{[\s\S]*writing\.current\.delete\(key\);[\s\S]*reload\(\);/, "refetched after every write, pass or fail");
  assert.doesNotMatch(hook, /winners/, "a judge never asks for winners");
});

/* ---- the styles (source) --------------------------------------------------- */

test("the awards styles are one sub-section at the end of the judge console's, with no motion", () => {
  const css = read("src/app/globals.css");
  const start = css.indexOf("/* Awards: the judge nominates");
  const end = css.indexOf("@keyframes si-bar");
  assert.ok(start > css.indexOf(".jg-sf .jg-quiet") && end > start, "after the last judge rule, before the next section");
  const block = css.slice(start, end);
  assert.doesNotMatch(block, /transition|animation|@keyframes/, "no motion");
  assert.doesNotMatch(block, /@ja-block|\.ja-/, "nothing of the Judge Advisor's");
  assert.match(block, /\.jg-ach \{[^}]*height: 46px/, "46px chips");
  assert.match(block, /\.jg-agrid \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/, "two columns");
  assert.match(block, /\.jg-ach\[aria-pressed="true"\] \{[^}]*background: var\(--accent\)/, "the accent is the pressed chip");
  assert.match(block, /\.jg-t-done \{[^}]*color-mix\(in srgb, var\(--done\) 14%/, "green is finished");
  assert.doesNotMatch(block, /color-mix\(in oklch/, "tints are srgb");
  assert.match(block, /\.jg-nsheet \{ height: fit-content/, "a modal dialog at height auto would fill the screen");
});
