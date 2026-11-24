import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ReviewMarkControl, ReviewMarkView } from "../src/components/ReviewMark";
import { clearMarkAfterAsking, clearQuestion, markOf, mayChangeMark, newestMarksFirst, saveMark, type MarkViewer } from "../src/components/reviewMarkLogic";
import { ReviewStrip, TeamsBoard } from "../src/components/admin/TeamsTab";
import { startDraft } from "../src/components/admin/teamsLogic";
import { TeamSheet } from "../src/components/judge/TeamSheet";
import { QueueTab } from "../src/components/judge/QueueTab";
import { formatClock } from "../src/components/ui";
import type { QueueCard } from "../src/lib/judgeQueue";
import type { AppState, RequestRow, ReviewMark, Team } from "../src/lib/types";

/* The review mark's screens, rendered to markup: the judge team sheet, the queue's pennant and the
   Judge Advisor's For review strip. No DOM harness here, so a tap is the click handler the markup
   would get, called as React would (tapButton); the writes behind each tap run against a fake `call`.
   The API's own rules are in reviewMarks.runtime.test.ts. */

const NOW = new Date(2026, 9, 17, 12, 36).getTime();
const noop = () => {};
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");

const team = (number: string, name: string, over: Partial<Team> = {}): Team => ({
  id: `t-${number}`, number, name, panel_id: "p2", division: "Middle School", category: "developing", pit: "22", languages: [], created_at: "2026-10-17T08:00:00Z", ...over,
});
const titans = team("9882K", "Torque Titans");
const rangers = team("4410C", "Robo Rangers");
const rookies = team("1101R", "Rookies");
const plain = team("7700B", "Byte Me");
const teams = [titans, rangers, rookies, plain];

const mark = (t: Team, by: string, at: string, over: Partial<ReviewMark> = {}): ReviewMark => ({
  team_id: t.id, reason: null, set_by: by, set_by_role: "judge", set_at: at, ...over,
});
const sam: MarkViewer = { name: "Sam Rivera", role: "judge" };
const priya: MarkViewer = { name: "Priya Nair", role: "judge" };
const ja: MarkViewer = { name: "Alex Kim", role: "admin" };
const bySam = mark(titans, "Sam Rivera", "2026-10-17T03:42:00Z", { reason: "Pit answers did not match the notebook." });
const byPriya = mark(rangers, "Priya Nair", "2026-10-17T03:20:00Z", { reason: "Notebook entries read as adult-written." });
const byJa = mark(rookies, "Alex Kim", "2026-10-17T02:55:00Z", { set_by_role: "admin", reason: "Drivetrain was swapped after inspection." });

/** Every element in the tree, function components called as React would (none here uses a hook). */
function walk(node: ReactNode, visit: (el: ReactElement<Record<string, unknown>>) => void) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!isValidElement(node)) return;
  const el = node as ReactElement<Record<string, unknown>>;
  visit(el);
  walk(typeof el.type === "function" ? (el.type as (p: unknown) => ReactNode)(el.props) : (el.props.children as ReactNode), visit);
}
const textOf = (node: ReactNode): string =>
  Array.isArray(node) ? node.map(textOf).join("") : isValidElement(node) ? textOf((node.props as { children?: ReactNode }).children) : typeof node === "string" || typeof node === "number" ? String(node) : "";

/** The click handlers of the buttons matching `want`, in order. */
function buttons(tree: ReactNode, want: (el: ReactElement<Record<string, unknown>>) => boolean) {
  const hits: (() => void)[] = [];
  walk(tree, (el) => {
    if (el.type === "button" && want(el)) hits.push(el.props.onClick as () => void);
  });
  return hits;
}
function tapButton(tree: ReactNode, label: string, nth = 0) {
  const hits = buttons(tree, (el) => textOf(el.props.children as ReactNode).trim() === label);
  assert.ok(hits[nth], `no button reads "${label}"`);
  hits[nth]();
}
/** The words on every button, in order. */
function labels(tree: ReactNode) {
  const out: string[] = [];
  walk(tree, (el) => {
    if (el.type === "button") out.push(textOf(el.props.children as ReactNode).trim());
  });
  return out;
}

/* ---- who may change a mark ------------------------------------------------- */

test("the Judge Advisor changes any mark; a judge only one they set, matched by name", () => {
  assert.equal(mayChangeMark(bySam, ja), true);
  assert.equal(mayChangeMark(byJa, ja), true);
  assert.equal(mayChangeMark(bySam, sam), true);
  assert.equal(mayChangeMark(bySam, { name: "  SAM Rivera ", role: "judge" }), true, "names match the way nominations do: trimmed, any case");
  assert.equal(mayChangeMark(bySam, priya), false, "another judge reads it");
  assert.equal(mayChangeMark(byJa, { name: "Alex Kim", role: "judge" }), false, "a judge with the Judge Advisor's name does not inherit the Judge Advisor's mark");
});

test("marks are found by team and listed newest first", () => {
  assert.equal(markOf([bySam, byPriya], titans.id), bySam);
  assert.equal(markOf([bySam], plain.id), undefined);
  assert.deepEqual(newestMarksFirst([byJa, byPriya, bySam]).map((m) => m.team_id), [titans.id, rangers.id, rookies.id]);
});

/* ---- the control ------------------------------------------------------------ */

type View = Parameters<typeof ReviewMarkView>[0];
const view = (over: Partial<View> = {}): { tree: ReactNode; log: string[] } => {
  const log: string[] = [];
  const tree = ReviewMarkView({
    team: titans,
    mark: undefined,
    canChange: true,
    draft: null,
    busy: false,
    inputId: "rv-r",
    onDraft: (d) => log.push(`draft:${d}`),
    onSave: () => log.push("save"),
    onClear: () => log.push("clear"),
    ...over,
  });
  return { tree, log };
};
const html = (tree: ReactNode) => renderToStaticMarkup(<>{tree}</>);

test("an unmarked team offers an outlined 'Mark for review' button with the pennant, and a tap opens the box", () => {
  const { tree, log } = view();
  const markup = html(tree);
  assert.match(markup, /<button type="button" class="rv-tg"><svg class="rv-pn" [^>]*aria-hidden="true"><path d="M6 21V3"><\/path><path d="M6 4.5l12 5-12 5" fill="currentColor"><\/path><\/svg>Mark for review<\/button>/);
  assert.doesNotMatch(markup, /<input|rv-note/);
  tapButton(tree, "Mark for review");
  assert.deepEqual(log, ["draft:"]);
});

test("the reason box: a labelled one-line input of at most 140, Save and Cancel, and who sees it", () => {
  const { tree, log } = view({ draft: "Check the notebook" });
  const markup = html(tree);
  assert.match(markup, /<label for="rv-r">Reason \(optional\)<\/label>/);
  assert.match(markup, /<input id="rv-r" class="rv-in" type="text"[^>]*maxLength="140"[^>]*placeholder="What should the JA look at\?"[^>]*value="Check the notebook"|<input id="rv-r" class="rv-in" type="text"[^>]*maxlength="140"[^>]*placeholder="What should the JA look at\?"[^>]*value="Check the notebook"/);
  assert.match(markup, /<button type="button" class="rv-save">Save<\/button><button type="button" class="rv-cancel">Cancel<\/button>/);
  assert.match(markup, /<p class="rv-hint">Only judges and the Judge Advisor see this\. The team never does\.<\/p>/);
  tapButton(tree, "Save");
  tapButton(tree, "Cancel");
  assert.deepEqual(log, ["save", "draft:null"]);
});

test("Enter in the box saves and Escape cancels, without reaching the drawer's form", () => {
  const { tree, log } = view({ draft: "x" });
  let input: ReactElement<Record<string, unknown>> | null = null;
  walk(tree, (el) => {
    if (el.type === "input") input = el;
  });
  const onKeyDown = (input as unknown as ReactElement<Record<string, unknown>>).props.onKeyDown as (e: unknown) => void;
  const key = (k: string) => {
    const seen: string[] = [];
    onKeyDown({ key: k, preventDefault: () => seen.push("prevent"), stopPropagation: () => seen.push("stop") });
    return seen;
  };
  assert.deepEqual(key("Enter"), ["prevent"]);
  assert.deepEqual(key("Escape"), ["prevent", "stop"]);
  assert.deepEqual(key("a"), []);
  assert.deepEqual(log, ["save", "draft:null"]);
});

test("a marked team shows the red note with who and when, and the reason", () => {
  const { tree } = view({ mark: bySam, canChange: false });
  const markup = html(tree);
  assert.match(markup, /<div class="rv-note" role="note"[^>]*>/);
  assert.ok(text(markup).includes(`Marked for review by Sam Rivera · ${formatClock(bySam.set_at)} — Pit answers did not match the notebook.`));
  assert.doesNotMatch(markup, /Mark for review<\/button>/);
});

test("the setter and the Judge Advisor see Edit reason and Clear; anyone else sees the note read-only", () => {
  for (const [who, viewer, may] of [["the setter", sam, true], ["the Judge Advisor", ja, true], ["another judge", priya, false]] as const) {
    const { tree } = view({ mark: bySam, canChange: mayChangeMark(bySam, viewer) });
    assert.deepEqual(labels(tree), may ? ["Edit reason", "Clear"] : [], who);
  }
});

test("Edit reason opens the box on the stored reason; Clear is its own tap", () => {
  const { tree, log } = view({ mark: bySam });
  tapButton(tree, "Edit reason");
  tapButton(tree, "Clear");
  assert.deepEqual(log, ["draft:Pit answers did not match the notebook.", "clear"]);
  // A mark with no reason edits from an empty box.
  const bare = view({ mark: mark(titans, "Sam Rivera", bySam.set_at) });
  tapButton(bare.tree, "Edit reason");
  assert.deepEqual(bare.log, ["draft:"]);
});

test("while the reason is being edited the note keeps its place and Edit reason / Clear step aside", () => {
  const { tree } = view({ mark: bySam, draft: "New words" });
  const markup = html(tree);
  assert.match(markup, /rv-note/);
  assert.match(markup, /<input id="rv-r"/);
  assert.deepEqual(labels(tree), ["Save", "Cancel"]);
});

test("a write in the air disables Save and says so", () => {
  const markup = html(view({ draft: "x", busy: true }).tree);
  assert.match(markup, /<button type="button" class="rv-save" disabled="">Saving…<\/button><button type="button" class="rv-cancel" disabled="">Cancel<\/button>/);
});

test("the control itself renders the same markup as its view, with the viewer's right to change worked out", () => {
  const control = (mark: ReviewMark | undefined, viewer: MarkViewer) =>
    renderToStaticMarkup(<ReviewMarkControl team={titans} mark={mark} viewer={viewer} ask={async () => true} refresh={async () => {}} onError={noop} />);
  assert.match(control(undefined, priya), /Mark for review<\/button>/);
  assert.match(control(bySam, sam), /Edit reason/);
  assert.match(control(bySam, ja), /Edit reason/);
  assert.doesNotMatch(control(bySam, priya), /Edit reason|Clear/);
});

/* ---- the writes ------------------------------------------------------------- */

type Sent = { url: string; method?: string; body?: unknown };
const recorder = () => {
  const sent: Sent[] = [];
  return { sent, call: async (url: string, options: { method?: string; body?: unknown }) => void sent.push({ url, ...options }) };
};

test("Save sends PUT { teamId, reason } with the reason trimmed; blank is an empty reason", async () => {
  const { sent, call } = recorder();
  await saveMark(call, titans.id, "  Ask who wrote the intake code.  ");
  await saveMark(call, titans.id, "   ");
  assert.deepEqual(sent, [
    { url: "/api/review-marks", method: "PUT", body: { teamId: "t-9882K", reason: "Ask who wrote the intake code." } },
    { url: "/api/review-marks", method: "PUT", body: { teamId: "t-9882K", reason: "" } },
  ]);
});

test("Clear asks first, by name, and DELETEs only on a yes", async () => {
  const asked: string[] = [];
  const no = recorder();
  assert.equal(await clearMarkAfterAsking(async (q) => (asked.push(q), false), no.call, titans), false);
  assert.deepEqual(no.sent, [], "a no sends nothing");

  const yes = recorder();
  assert.equal(await clearMarkAfterAsking(async (q) => (asked.push(q), true), yes.call, titans), true);
  assert.deepEqual(yes.sent, [{ url: "/api/review-marks", method: "DELETE", body: { teamId: "t-9882K" } }]);
  assert.deepEqual(asked, ["Clear the review mark on 9882K?", "Clear the review mark on 9882K?"]);
  assert.equal(clearQuestion(titans), "Clear the review mark on 9882K?");
});

/* ---- the judge team sheet ---------------------------------------------------- */

function sheet(over: { viewer?: MarkViewer; marks?: ReviewMark[]; refresh?: () => Promise<void> } = {}) {
  return renderToStaticMarkup(
    <TeamSheet
      team={titans}
      request={null}
      categories={[{ id: "developing", label: "Developing", color: "sky", excludesRubrics: [] }]}
      languages={[]}
      flags={[]}
      flagKinds={[]}
      ask={async () => true}
      reviewMarks={over.marks ?? []}
      viewer={over.viewer}
      refresh={"refresh" in over ? over.refresh : async () => {}}
      onClose={noop}
    />,
  );
}

test("the judge's sheet offers 'Mark for review' under the privacy line", () => {
  const markup = sheet({ viewer: sam });
  const priv = markup.indexOf("Private to judges and the Judge Advisor.");
  const offer = markup.indexOf("Mark for review</button>");
  assert.ok(priv > 0 && offer > priv, "below the privacy line");
  assert.ok(offer < markup.indexOf('class="jg-seg"'), "above the segments");
});

test("a mark set by another judge shows read-only on the sheet; the setter and the Judge Advisor can Edit reason and Clear", () => {
  const marks = [bySam];
  const other = sheet({ viewer: priya, marks });
  assert.ok(text(other).includes("Marked for review by Sam Rivera"));
  assert.doesNotMatch(other, /Edit reason|rv-na|Mark for review<\/button>/);
  for (const viewer of [sam, ja]) {
    const markup = sheet({ viewer, marks });
    assert.match(markup, /Edit reason<\/button><button type="button" class="rv-lk">Clear<\/button>/);
  }
});

test("a mark on another team does not show on this sheet", () => {
  assert.match(sheet({ viewer: sam, marks: [byPriya] }), /Mark for review<\/button>/);
});

test("with no viewer (or no refresh) the sheet is as it was: nothing about review", () => {
  assert.doesNotMatch(sheet({ marks: [bySam] }), /review|rv-/i);
  assert.doesNotMatch(sheet({ viewer: sam, refresh: undefined }), /review|rv-/i);
});

/* ---- the judge queue ----------------------------------------------------------- */

const card = (t: Team, req: RequestRow | null): QueueCard => ({ team: t, request: req, score: { total: 0, max: 76, scored: false } });
const request = (t: Team, status: RequestRow["status"]): RequestRow =>
  ({ id: `r-${t.number}`, team_id: t.id, panel_id: "p2", status, kind: "queue", language: "en", slot_start: null, requested_at: new Date(NOW - 5 * 60_000).toISOString(), updated_at: new Date(NOW).toISOString() }) as RequestRow;

function queue(cards: QueueCard[], markedIds?: ReadonlySet<string>) {
  return renderToStaticMarkup(
    <QueueTab
      cards={cards}
      completed={new Set([plain.id])}
      categories={[{ id: "developing", label: "Developing", color: "amber", excludesRubrics: [] }]}
      languages={[]}
      flags={[]}
      flagKinds={[]}
      markedIds={markedIds}
      now={NOW}
      busy={null}
      onAdvance={noop}
      onOpen={noop}
    />,
  );
}
const PENNANT = /<svg class="rv-pn"[^>]*role="img" aria-label="Marked for review"/g;

test("the queue shows a read-only pennant after a marked team's name on the hero and on each row, and not on the others", () => {
  const cards = [
    card(titans, request(titans, "acknowledged")), // the hero
    card(rangers, request(rangers, "requested")), // waiting
    card(rookies, null), // not in queue
    card(plain, null), // done
  ];
  const markup = queue(cards, new Set([titans.id, rangers.id, plain.id]));
  assert.equal(markup.match(PENNANT)?.length, 3, "hero, one waiting row, one done row");
  const hero = markup.match(/<section class="jg-hero[\s\S]*?<\/section>/)![0];
  assert.match(hero, /jg-hmk/);
  assert.match(hero, /<p class="jg-hname">Torque Titans<svg class="rv-pn"[^>]*aria-label="Marked for review"/);
  const rows = markup.match(/<div class="jg-qrow [^"]*">[\s\S]*?<\/div>/g) ?? [];
  const rowOf = (n: string) => rows.find((r) => r.includes(`<b>${n}</b>`)) ?? "";
  assert.match(rowOf("4410C"), /^<div class="jg-qrow jg-qw jg-qmk">/);
  assert.match(rowOf("4410C"), /<span>Robo Rangers<\/span><svg class="rv-pn"[^>]*aria-label="Marked for review"/);
  assert.match(rowOf("7700B"), /jg-qmk/);
  assert.doesNotMatch(rowOf("1101R"), /rv-pn|jg-qmk/, "Rookies is not marked");
  assert.doesNotMatch(markup.replace(hero, ""), /<button[^>]*aria-label="Marked/, "no control on a row: the pennant is only a picture");
});

test("with no marks the queue is exactly as it was", () => {
  const cards = [card(titans, request(titans, "acknowledged")), card(rookies, null)];
  const bare = queue(cards, undefined);
  assert.equal(queue(cards, new Set()), bare);
  assert.doesNotMatch(bare, /rv-pn|jg-qmk|jg-hmk/);
});

/* ---- the Judge Advisor's Teams page ------------------------------------------------ */

const cardsOf = (markup: string) => markup.match(/<li class="ja-tm-rvc">[\s\S]*?<\/li>/g) ?? [];

function strip(over: Partial<Parameters<typeof ReviewStrip>[0]> = {}) {
  return ReviewStrip({ id: "rv", marks: newestMarksFirst([byJa, byPriya, bySam]), teams, wide: true, open: false, onOpen: noop, onPick: noop, onClear: noop, ...over });
}

test("the strip lists every mark newest first, with number, name, who and when, the reason and Clear / Open", () => {
  const markup = html(strip());
  assert.match(markup, /<h2 class="ja-tm-rvh" id="rv"><svg class="rv-pn"[^>]*aria-hidden="true">[\s\S]*<\/svg>For review · 3<span>Marked by judges and the Judge Advisor\. The teams do not see this\.<\/span><\/h2>/);
  const cards = cardsOf(markup);
  assert.deepEqual(cards.map((c) => c.match(/<b>(.*?)<\/b>/)![1]), ["9882K", "4410C", "1101R"], "newest first");
  assert.match(text(cards[0] ?? ""), new RegExp(`9882KTorque TitansSam Rivera · ${formatClock(bySam.set_at)}Pit answers did not match the notebook\\.ClearOpen`));
  assert.match(cards[1] ?? "", /aria-label="Clear the review mark on 4410C"/);
  assert.match(cards[1] ?? "", /aria-label="Open 4410C Robo Rangers"/);
  assert.match(markup, /class="ja-tm-rvr"/);
});

test("with no marks the strip is not drawn, wide or on a phone", () => {
  assert.equal(strip({ marks: [] }), null);
  assert.equal(strip({ marks: [], wide: false }), null);
  // A mark whose team has gone is not a card either.
  assert.equal(strip({ marks: [mark(team("0000X", "Gone"), "Sam Rivera", bySam.set_at)] }), null);
});

test("Open selects that team, as its row does; Clear hands the mark over to be asked about", () => {
  const picked: string[] = [];
  const cleared: string[] = [];
  const tree = strip({ onPick: (id) => picked.push(id), onClear: (m) => cleared.push(m.team_id) });
  tapButton(tree, "Open", 1);
  tapButton(tree, "Clear", 0);
  assert.deepEqual(picked, [rangers.id]);
  assert.deepEqual(cleared, [titans.id]);
});

test("on a phone the strip is one red bar with a chevron, shut until tapped", () => {
  const shut = html(strip({ wide: false }));
  assert.match(shut, /<button type="button" class="ja-tm-rvbar" aria-expanded="false" aria-controls="rv-l">/);
  assert.match(text(shut), /3 teams marked for review/);
  assert.equal(cardsOf(shut).length, 0, "collapsed by default");
  assert.doesNotMatch(shut, /For review ·/);

  const open = html(strip({ wide: false, open: true }));
  assert.match(open, /aria-expanded="true"/);
  assert.equal(cardsOf(open).length, 3);

  const opened: boolean[] = [];
  tapButton(strip({ wide: false, onOpen: (o) => opened.push(o) }), "3 teams marked for review");
  tapButton(strip({ wide: false, open: true, onOpen: (o) => opened.push(o) }), "3 teams marked for review");
  assert.deepEqual(opened, [true, false]);
  assert.match(text(html(strip({ wide: false, marks: [bySam] }))), /1 team marked for review/);
});

const slice = {
  teams,
  panels: [{ id: "p2", name: "Panel 2", division: "Middle School", judges: [], languages: ["en"], sort_order: 2, slot_start_at: null, slot_minutes: 20, slot_count: 0, slot_days: [] }],
  requests: [],
  conflicts: [],
  judges: [],
  flags: [],
  flagKinds: [],
  divisions: ["Middle School"],
  languages: [],
  categories: [{ id: "developing", label: "Developing", color: "sky" }],
} as unknown as AppState;

function board(over: { wide?: boolean; marks?: ReviewMark[]; picked?: Team; markControl?: (t: Team) => ReactNode; reviewOpen?: boolean } = {}) {
  return renderToStaticMarkup(
    <TeamsBoard
      state={{ ...slice, reviewMarks: over.marks ?? [] }}
      wide={over.wide ?? true}
      filters={{ q: "", division: "", category: "", language: "" }}
      onFilters={noop}
      onFiltersOpen={noop}
      perPanel={12}
      onPerPanel={noop}
      onAutoAssign={noop}
      pickedId={over.picked?.id ?? null}
      onPick={noop}
      draft={over.picked ? startDraft(over.picked) : null}
      onDraft={noop}
      onSave={noop}
      onClose={noop}
      onResetStatus={noop}
      interview={{} as never}
      onRemove={noop}
      onOpenFlags={noop}
      onOpenSheet={noop}
      reviewOpen={over.reviewOpen}
      onReviewOpen={noop}
      onClearMark={noop}
      markControl={over.markControl}
    />,
  );
}

test("the strip sits above the filter bar, and the page is unchanged with no marks", () => {
  const markup = board({ marks: [bySam, byPriya] });
  assert.ok(markup.indexOf("For review · 2") > 0 && markup.indexOf("For review · 2") < markup.indexOf('aria-label="Team filters"'));
  const none = board();
  assert.doesNotMatch(none, /ja-tm-rv|rv-pn|For review/);
});

test("a marked team wears the pennant by its number in the table (the Name column hides with the drawer open) and after its name in the phone list; the others do not", () => {
  const marks = [bySam, byJa];
  const table = board({ marks });
  const rowOf = (m: string, n: string) => m.match(new RegExp(`<tr[^>]*>(?:(?!</tr>)[\\s\\S])*?>${n}</button>[\\s\\S]*?</tr>`))?.[0] ?? "";
  assert.match(rowOf(table, "9882K"), />9882K<\/button><svg class="rv-pn"[^>]*aria-label="Marked for review"/);
  assert.match(rowOf(table, "1101R"), /aria-label="Marked for review"/);
  assert.doesNotMatch(rowOf(table, "4410C"), /rv-pn/);

  const list = board({ marks, wide: false });
  const lrow = (n: string) => list.match(new RegExp(`<button type="button" class="ja-tm-lrow"[^>]*aria-label="Edit ${n} [^"]*"[\\s\\S]*?</button>`))?.[0] ?? "";
  assert.match(lrow("9882K"), /<span class="ja-tm-nm">Torque Titans<\/span><svg class="rv-pn"[^>]*aria-label="Marked for review"/);
  assert.doesNotMatch(lrow("4410C"), /rv-pn/);
});

test("the drawer and the phone sheet carry the mark control at the top of the editor", () => {
  const control = (t: Team) => <i className="mark-here">{t.number}</i>;
  const wide = board({ picked: titans, markControl: control });
  const drawer = wide.match(/<aside class="ja-tm-dr"[\s\S]*?<\/aside>/)![0];
  assert.ok(drawer.indexOf('<i class="mark-here">9882K</i>') > 0 && drawer.indexOf("mark-here") < drawer.indexOf('class="ja-tm-g2"'));
  const phone = board({ picked: titans, wide: false, markControl: control });
  assert.match(phone.match(/<dialog class="ja-sheet ja-tm-sheet"[\s\S]*?<\/dialog>/)![0], /mark-here/);
  assert.doesNotMatch(board({ picked: titans }), /mark-here/);

  // The real control, in the drawer, for an unmarked team and a marked one.
  const real = (marks: ReviewMark[]) =>
    board({
      picked: titans,
      marks,
      markControl: (t) => <ReviewMarkControl team={t} mark={markOf(marks, t.id)} viewer={ja} ask={async () => true} refresh={async () => {}} onError={noop} />,
    }).match(/<aside class="ja-tm-dr"[\s\S]*?<\/aside>/)![0];
  assert.match(real([]), /<button type="button" class="rv-tg">[\s\S]*Mark for review<\/button>/);
  assert.match(real([bySam]), /Marked for review by Sam Rivera[\s\S]*Edit reason<\/button><button type="button" class="rv-lk">Clear<\/button>/);
});

/* ---- the pages' wiring (source) ------------------------------------------------------ */

test("both consoles hand the team sheet the marks, who is looking and a refresh; the judge page marks its queue", () => {
  const judgePage = read("src/app/judge/page.tsx");
  const adminPage = read("src/app/admin/page.tsx");
  assert.match(judgePage, /reviewMarks=\{state\.reviewMarks\}/);
  assert.match(judgePage, /viewer=\{\{ name: session\.name, role: "judge" \}\}/);
  assert.match(judgePage, /markedIds=\{markedIds\}/);
  assert.match(adminPage, /reviewMarks=\{state\.reviewMarks\}/);
  assert.match(adminPage, /viewer=\{session \? \{ name: session\.name, role: "admin" \} : undefined\}/);
  assert.match(adminPage, /adminName=\{session\?\.name\}/, "the Teams tab reads the mark's name from the session");
});
