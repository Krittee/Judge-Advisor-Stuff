import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { JudgeFrame } from "../src/components/judge/JudgeFrame";
import { QueueTab, type QueueActions } from "../src/components/judge/QueueTab";
import { ScoresTab } from "../src/components/judge/ScoresTab";
import { RubricSegment, TeamSheet } from "../src/components/judge/TeamSheet";
import { TodayTab } from "../src/components/judge/TodayTab";
import { cancelAfterAsking, dayLabel } from "../src/components/judge/logic";
import { createConfirmer, type Pending } from "../src/components/ConfirmDialog";
import { rankTeams } from "../src/lib/ranking";
import { rubricById, rubrics } from "../src/lib/rubrics";
import type { QueueCard } from "../src/lib/judgeQueue";
import type { Status } from "../src/lib/status";
import type { FlagRow, RequestRow, ScoreRow, Slot, Team } from "../src/lib/types";

/* The judge console, rendered to markup: what each tab shows for a given
   queue. Behaviour that needs a browser (the <dialog> opening, taps) has no
   DOM harness here; the decisions behind it run as plain functions
   (judgePage.logic.test.mjs and the cancel test below) and the page's wiring
   is read from source at the foot. */

// Local time, so "today" is the same calendar day wherever the tests run.
const NOW = new Date(2026, 9, 17, 12, 36).getTime();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const inMin = (min: number) => new Date(NOW + min * 60_000).toISOString();
const noop = () => {};

const categories = [
  { id: "developing", label: "Developing", color: "amber", excludesRubrics: [] },
  { id: "ungraded", label: "Ungraded", color: "zinc", excludesRubrics: ["notebook"] },
];
const languages = [{ id: "en", label: "English", short: "EN" }];
const flagKinds = [
  { id: "good", label: "Good conduct", short: "Good", color: "emerald", severity: 0, requiresRule: false },
  { id: "warning", label: "Warning", short: "Warning", color: "amber", severity: 1, requiresRule: false },
];

function team(number: string, name: string, over: Partial<Team> = {}): Team {
  return {
    id: `t-${number}`,
    number,
    name,
    panel_id: "p2",
    division: "Middle School",
    category: "developing",
    pit: "14",
    created_at: "2026-10-17T08:00:00Z",
    ...over,
  };
}

function request(t: Team, status: RequestRow["status"], over: Partial<RequestRow> = {}): RequestRow {
  return {
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
  };
}

const score = { total: 0, max: 76, scored: false };
const card = (t: Team, req: RequestRow | null, s = score): QueueCard => ({ team: t, request: req, score: s });

const titans = team("9882K", "Torque Titans", { pit: "14" });
const byteMe = team("7700B", "Byte Me", { pit: "22" });
const gremlins = team("2011A", "Gear Gremlins", { pit: "3" });
const rangers = team("4410C", "Robo Rangers", { pit: "9", category: "ungraded" });
const quantum = team("9090Q", "Quantum", { pit: "17" });
const sparky = team("5150Z", "Sparky", { pit: "5" });

const handlers: QueueActions = { onAdvance: noop, onCancel: noop, onSummon: noop, onOpen: noop };

function queue(cards: QueueCard[], over: { busy?: string | null; flags?: FlagRow[]; completed?: string[] } = {}) {
  return renderToStaticMarkup(
    <QueueTab
      cards={cards}
      completed={new Set(over.completed ?? [])}
      categories={categories}
      languages={languages}
      flags={over.flags ?? []}
      flagKinds={flagKinds}
      now={NOW}
      busy={over.busy ?? null}
      {...handlers}
    />,
  );
}

/** The markup of one element: from its opening tag to the next section of the page. */
const hero = (markup: string) => markup.match(/<section class="jg-hero[\s\S]*?<\/section>/)?.[0] ?? "";

/* ---- the hero card -------------------------------------------------------- */

test("the hero is the longest-waiting team, with On our way as its primary action", () => {
  const markup = queue([
    card(byteMe, request(byteMe, "requested", { requested_at: ago(2) })),
    card(titans, request(titans, "requested", { requested_at: ago(6), message: "We’ll be at the practice field until 10:40" })),
    card(quantum, null),
  ]);
  const h = hero(markup);
  assert.match(h, /class="jg-hero jg-t-waiting" aria-label="Up next"/);
  assert.match(h, /<span class="jg-eyebrow">Up next<\/span>/);
  assert.match(h, /<span class="jg-sc jg-s-requested">Requesting a judge<\/span>/);
  assert.match(h, /<h2 class="jg-hn">9882K<\/h2><p class="jg-hname">Torque Titans<\/p>/);
  assert.match(h, /Developing/);
  assert.match(h, /EN/);
  assert.match(h, /Pit 14 · <b class="jg-wt">waiting 6 min<\/b>/);
  assert.match(h, /“We’ll be at the practice field until 10:40”/);
  // The button wears the colour of the status it moves the team to.
  assert.match(h, /<button type="button" class="jg-go jg-s-acknowledged">On our way<\/button>/);
  assert.match(h, />Notes &amp; scores</);
  assert.match(h, />Cancel request</);
  // The hero is not repeated in the list below it.
  assert.doesNotMatch(markup.replace(h, ""), /9882K/);
  assert.doesNotMatch(markup, /jg-alert/, "a waiting hero needs no alert about waiting teams");
});

test("the primary action is Saving… and disabled while its write is in the air", () => {
  const t = card(titans, request(titans, "requested"));
  const h = hero(queue([t], { busy: "r-9882K" }));
  assert.match(h, /<button type="button" class="jg-go jg-s-acknowledged" disabled="">Saving…<\/button>/);
  assert.match(h, /<button[^>]*class="jg-quiet"[^>]*disabled=""/, "Cancel request waits too");
  assert.doesNotMatch(hero(queue([t])), /Saving…|disabled/);
});

test("the primary action's fill is the colour of the status it moves the team to", () => {
  const onTheWay = hero(queue([card(titans, request(titans, "acknowledged"))]));
  assert.match(onTheWay, /aria-label="On the way"/);
  assert.match(onTheWay, /jg-go jg-s-interviewing">Start interview</);
  assert.doesNotMatch(onTheWay, /jg-t-waiting|jg-t-active/, "on the way is a neutral card");

  const talking = hero(queue([card(gremlins, request(gremlins, "interviewing", { started_at: ago(7) }))]));
  assert.match(talking, /class="jg-hero jg-t-active" aria-label="Interviewing now"/);
  assert.match(talking, /jg-eyebrow">Now interviewing</);
  assert.match(talking, /jg-go jg-s-completed">Finish interview</);
  assert.match(talking, /<b>7 min<\/b>/, "how long they have been in");
  assert.match(talking, /class="jg-opensheet"[\s\S]*Open team sheet[\s\S]*Score the interview/);
  assert.doesNotMatch(talking, /Notes &amp; scores/, "the larger Open team sheet button replaces it");
  assert.match(talking, />Cancel request</, "an interview can still be called off, behind the confirm");
});

test("with nobody live the hero is the next booked slot", () => {
  const booked = request(gremlins, "scheduled", { kind: "slot", slot_start: inMin(4) });
  const h = hero(queue([card(gremlins, booked), card(quantum, null)]));
  assert.match(h, /aria-label="Up next"/);
  assert.match(h, /jg-s-scheduled">Scheduled</);
  assert.match(h, /in 4 min/);
  assert.match(h, /jg-go jg-s-acknowledged">On our way</);
});

test("score total and band, and the referee flag with one line of it, ride on the hero", () => {
  const flag: FlagRow = {
    id: "f1",
    team_id: titans.id,
    kind: "warning",
    body: "Reset another team's field.",
    author: "Jordan Lee",
    match_type: "Q",
    match_number: "19",
    field: "2",
    rule: "GG17",
    ruleset: "viqrc",
    manual_version: null,
    match_affecting: false,
    created_at: ago(30),
  };
  const h = hero(
    queue([card(titans, request(titans, "requested"), { total: 22, max: 76, scored: true })], { flags: [flag] }),
  );
  assert.match(h, /<b>22<small>\/76<\/small><\/b>/);
  assert.match(h, /jg-band[^>]*>Emerging</);
  assert.match(h, /jg-flagrow[\s\S]*Warning[\s\S]*<span>GG17 · Q19 · by Jordan Lee<\/span>/);
  // No score line for a team with nothing to be scored on, and no flag row without flags.
  const bare = hero(queue([card(titans, request(titans, "requested"), { total: 0, max: 0, scored: false })]));
  assert.doesNotMatch(bare, /jg-hscore|jg-flagrow/);
});

test("an unscored hero says not scored rather than printing 0/76", () => {
  const unscored = hero(queue([card(titans, request(titans, "requested"), { total: 0, max: 76, scored: false })]));
  assert.match(unscored, /<div class="jg-hscore"><span class="jg-ns">not scored<\/span><\/div>/);
  assert.doesNotMatch(unscored, /0<small>|\/76|jg-band/);
  // Scored, even on a real zero, it is a number again.
  const zero = hero(queue([card(titans, request(titans, "requested"), { total: 0, max: 76, scored: true })]));
  assert.match(zero, /<b>0<small>\/76<\/small><\/b>/);
  assert.doesNotMatch(zero, /not scored/);
});

test("the interview timer reads Just started, then N min in, then 1h 5m in", () => {
  const timer = (startedMin: number) =>
    hero(queue([card(gremlins, request(gremlins, "interviewing", { started_at: ago(startedMin) }))])).match(/<div class="jg-tmr">.*?<\/div>/)?.[0] ?? "";
  assert.match(timer(0), /<b>Just started<\/b><span>· [^<]+<\/span>/);
  assert.match(timer(1), /<b>1 min<\/b><span>in · started [^<]+<\/span>/);
  assert.match(timer(12), /<b>12 min<\/b><span>in · started /);
  assert.match(timer(65), /<b>1h 5m<\/b><span>in · started /);
  assert.doesNotMatch(timer(0), /just now|in ·/);
});

/* ---- the waiting alert row ------------------------------------------------ */

test("with a team being interviewed and others waiting, an alert row says who and for how long", () => {
  const markup = queue([
    card(gremlins, request(gremlins, "interviewing", { started_at: ago(7), requested_at: ago(20) })),
    card(byteMe, request(byteMe, "requested", { requested_at: ago(4) })),
    card(titans, request(titans, "requested", { requested_at: ago(8) })),
  ]);
  assert.match(markup, /<div class="jg-alert" role="status">/);
  assert.match(markup, /<b>2 teams waiting<\/b><span>9882K 8 min · 7700B 4 min<\/span>/, "longest wait first");
  assert.match(markup, /<button type="button" class="jg-lnk">View<\/button>/);
  assert.match(markup, /<div class="jg-grp" id="jg-waiting">/, "the View link has somewhere to scroll to");
  assert.ok(markup.indexOf("jg-alert") < markup.indexOf("jg-hero"), "the alert sits above the hero");
  // Both waiting teams are in the list, each with its own On our way.
  const list = markup.slice(markup.indexOf('id="jg-waiting"'));
  assert.equal(list.match(/jg-go jg-sm jg-s-acknowledged">On our way</g)?.length, 2);
  assert.match(list, /Waiting 8 min/);
});

test("one waiting team reads as a singular, and nobody waiting means no alert", () => {
  const talking = card(gremlins, request(gremlins, "interviewing", { started_at: ago(7) }));
  assert.match(queue([talking, card(byteMe, request(byteMe, "requested", { requested_at: ago(1) }))]), /<b>1 team waiting<\/b><span>7700B 1 min<\/span>/);
  assert.doesNotMatch(queue([talking, card(quantum, null)]), /jg-alert/);
});

/* ---- the sections --------------------------------------------------------- */

test("the list runs Waiting, With us, Booked, Not in queue, Done, and omits what is empty", () => {
  const markup = queue(
    [
      card(gremlins, request(gremlins, "interviewing", { started_at: ago(7) })), // hero
      card(byteMe, request(byteMe, "requested")),
      card(titans, request(titans, "acknowledged")),
      card(rangers, request(rangers, "scheduled", { kind: "slot", slot_start: inMin(30) })),
      card(quantum, null),
      card(sparky, null),
    ],
    { completed: [sparky.id] },
  );
  const headings = [...markup.matchAll(/<h2 class="jg-sec">.*?<\/h2>/g)].map((m) => m[0].replace(/<[^>]+>/g, ""));
  assert.deepEqual(headings, ["Waiting · 1", "With us · 1", "Booked · 1", "Not in queue · 1"]);
  assert.match(markup, /<details class="jg-done"><summary><i class="jg-dot jg-s-completed" aria-hidden="true"><\/i>Done · 1<span class="jg-dp">5150Z<\/span>/);
  // With us: the one on the way is offered Start interview.
  assert.match(markup, /<b>9882K<\/b>[\s\S]*?jg-go jg-sm jg-s-interviewing">Start interview</);
  // Not in queue: a 44px ghost button, and Saving… becomes Adding… while it is in the air.
  assert.match(markup, /<button type="button" class="jg-ghost"><svg[\s\S]*?<\/svg>Add to queue<\/button>/);
  assert.match(queue([card(quantum, null)], { busy: quantum.id }), /class="jg-ghost" disabled="">Adding…</);

  const none = queue([card(gremlins, request(gremlins, "interviewing", { started_at: ago(7) }))]);
  assert.doesNotMatch(none, /jg-sec|jg-done/, "empty sections are left out");
});

test("a booked row has its time chip, and says in N min only inside ten minutes", () => {
  const markup = queue([
    card(titans, request(titans, "requested")), // hero
    card(gremlins, request(gremlins, "scheduled", { kind: "slot", slot_start: inMin(4) })),
    card(rangers, request(rangers, "scheduled", { kind: "slot", slot_start: inMin(24) })),
  ]);
  const rows = markup.match(/<div class="jg-qrow ">[\s\S]*?<\/button><\/div>/g) ?? [];
  assert.equal(rows.length, 2);
  assert.match(rows[0], /2011A/);
  assert.match(rows[0], /<b>in 4 min<\/b>/);
  assert.match(rows[0], /jg-sc jg-s-scheduled/);
  assert.match(rows[1], /4410C/);
  assert.doesNotMatch(rows[1], /in 24 min|<b>in/);
  assert.match(rows[1], /Ungraded · Pit 9/);
});

test("every row with a live or booked request has a Cancel outside its tap target; the others have none", () => {
  const markup = queue(
    [
      card(gremlins, request(gremlins, "interviewing", { started_at: ago(7) })), // hero
      card(byteMe, request(byteMe, "requested")),
      card(titans, request(titans, "acknowledged")),
      card(rangers, request(rangers, "scheduled", { kind: "slot", slot_start: inMin(30) })),
      card(quantum, null),
      card(sparky, null),
    ],
    { completed: [sparky.id] },
  );
  const rows = markup.match(/<div class="jg-qrow[^"]*">[\s\S]*?<\/div>(?=<\/li>)/g) ?? [];
  assert.equal(rows.length, 5);
  const cancelled = rows.filter((r) => r.includes('class="jg-cx"')).map((r) => r.match(/<b>(\w+)<\/b>/)?.[1]);
  assert.deepEqual(cancelled, ["7700B", "9882K", "4410C"], "Waiting, With us and Booked; not Not in queue or Done");
  const row = rows.find((r) => r.includes("7700B"))!;
  assert.match(row, /<button type="button" class="jg-cx" aria-label="Cancel 7700B&#x27;s request">/);
  // Beside the tap target that opens the sheet, never inside it, and after the primary action.
  assert.ok(row.indexOf("</button>") < row.indexOf("jg-cx"), "after the row's own button closes");
  assert.ok(row.indexOf("jg-go") < row.indexOf("jg-cx"));
  assert.match(queue([card(byteMe, request(byteMe, "requested")), card(titans, request(titans, "requested", { requested_at: ago(9) }))], { busy: "r-7700B" }), /class="jg-cx" aria-label="[^"]*" disabled=""/);
  // 44px, and the primary action keeps its size: it is the name that gives way.
  const css = read("src/app/globals.css");
  assert.match(css, /\.jg-cx \{[^}]*width: 44px; height: 44px;/);
  assert.match(css, /\.jg-go\.jg-sm \{ width: auto; flex: none; height: 44px;/);
});

/** Walks a function-component tree (QueueTab and its rows hold no hooks) to the button with this label. */
function findByLabel(node: ReactNode, label: string): ReactElement<{ onClick?: () => void }> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findByLabel(n, label);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<{ "aria-label"?: string; children?: ReactNode; onClick?: () => void }>;
  if (typeof el.type === "function") return findByLabel((el.type as (p: unknown) => ReactNode)(el.props), label);
  return el.props["aria-label"] === label ? el : findByLabel(el.props.children, label);
}

test("a list row's Cancel asks first, sends nothing until confirmed, and never opens the sheet", async () => {
  const sent: string[] = [];
  const opened: string[] = [];
  const shown: (Pending | null)[] = [];
  const { ask, settle } = createConfirmer((p) => shown.push(p));
  const waiting = request(byteMe, "requested");
  const tree = (
    <QueueTab
      cards={[card(titans, request(titans, "requested", { requested_at: ago(9) })), card(byteMe, waiting)]}
      completed={new Set()}
      categories={categories}
      languages={languages}
      flags={[]}
      flagKinds={flagKinds}
      now={NOW}
      busy={null}
      {...handlers}
      onCancel={(t, r) => void cancelAfterAsking(ask, t, r, async () => void sent.push(r.id))}
      onOpen={(t) => opened.push(t.number)}
    />
  );
  const cancel = findByLabel(tree, "Cancel 7700B's request");
  assert.ok(cancel, "the row has a Cancel");

  cancel.props.onClick!();
  assert.equal(shown.length, 1, "a confirm dialog opened");
  assert.match(shown[0]!.question, /Cancel 7700B's request\?/);
  assert.equal(shown[0]!.danger, true);
  assert.deepEqual(sent, [], "nothing sent while the question is open");
  settle(false);
  await Promise.resolve();
  assert.deepEqual(sent, [], "declined: still nothing");

  cancel.props.onClick!();
  settle(true);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, ["r-7700B"], "confirmed: sent once");
  assert.deepEqual(opened, [], "Cancel is not the row's open button");
});

test("a panel with no teams gets the notice, restyled", () => {
  assert.match(queue([]), /<p class="jg-empty">No teams are assigned to this panel yet\./);
});

/* ---- the frame ------------------------------------------------------------ */

// Sign out reads the app router, which only exists inside Next; a stub is enough to draw it.
const router = {} as React.ContextType<typeof AppRouterContext>;

const frame = (over: Partial<Parameters<typeof JudgeFrame>[0]> = {}) =>
  renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <JudgeFrame
        name="Sam Rivera"
        online
        panel={{ name: "Panel 2", division: "Middle School" }}
        interviewed={{ done: 4, total: 12 }}
        tab="queue"
        onTab={noop}
        waiting={2}
        {...over}
      >
        <p>body</p>
      </JudgeFrame>
    </AppRouterContext.Provider>,
  );

test("the Queue tab's badge is the number of teams requesting, and is hidden at 0", () => {
  const two = frame({ waiting: 2 });
  assert.match(two, /<span class="jg-bdg">2<\/span>/);
  assert.match(two, /<span class="sr-only"> \(2 teams waiting\)<\/span>/);
  assert.match(frame({ waiting: 1 }), /\(1 team waiting\)/);
  const none = frame({ waiting: 0 });
  assert.doesNotMatch(none, /jg-bdg|waiting\)/);
  // Only Queue carries it.
  assert.equal(two.match(/jg-bdg/g)?.length, 1);
});

test("three tabs, the current one marked, and no referee stripe", () => {
  const markup = frame({ tab: "scores", waiting: 0 });
  assert.match(markup, /<nav class="jg-tabs" aria-label="Judge sections">/);
  const tabs = [...markup.matchAll(/<button type="button" class="jg-tab"([^>]*)>[\s\S]*?<\/button>/g)];
  assert.equal(tabs.length, 3);
  assert.deepEqual(
    tabs.map((m) => [m[0].replace(/<[^>]+>/g, ""), m[1].includes('aria-current="page"')]),
    [["Queue", false], ["Scores", true], ["Today", false]],
  );
  assert.doesNotMatch(markup, /rf-strip|referee/);
});

test("the chrome: avatar, Judge and the judge's name, Live, Sign out, and the panel bar", () => {
  const markup = frame();
  assert.match(markup, /<img src="\/avatars\/judge\.jpg" alt="" width="28" height="28"\/>/);
  assert.match(markup, /<b>Judge<\/b><span>Sam Rivera<\/span>/);
  assert.match(markup, /data-online="true"><i aria-hidden="true"><\/i>Live</);
  assert.match(markup, />Sign out</);
  assert.match(markup, /<section class="jg-mbar" aria-label="Your panel"><div class="jg-mm"><span>Your panel<\/span><b>Panel 2<\/b><\/div><span class="jg-ptag">Middle School<\/span>/);
  assert.match(markup, /<p class="jg-pr"><b>4\/12<\/b> interviewed<\/p>/);
  assert.match(frame({ online: false }), /data-online="false"><i aria-hidden="true"><\/i>Reconnecting</);
});

test("the Judge Advisor sees the notice in the frame, with their avatar and no tabs", () => {
  const markup = frame({ advisor: true, panel: undefined, tab: undefined, onTab: undefined });
  assert.match(markup, /judge-advisor\.jpg/);
  assert.match(markup, /<b>Judge Advisor<\/b>/);
  assert.doesNotMatch(markup, /jg-tabs|jg-mbar/);
});

/* ---- the Scores tab ------------------------------------------------------- */

test("the ranking lists scored teams best first, then unscored ones with a dash", () => {
  const rubricList = rubrics();
  const interview = rubricList.find((r) => r.id === "interview")!;
  const notebook = rubricList.find((r) => r.id === "notebook")!;
  const row = (t: Team, rubric: typeof interview, total: number): ScoreRow => ({
    id: `s-${t.number}-${rubric.id}`,
    team_id: t.id,
    rubric_id: rubric.id,
    values: { [rubric.criteria[0].id]: total },
    total,
    scored_by: "Sam",
    panel_id: "p2",
    updated_at: ago(1),
  });
  const teams = [rangers, titans, sparky, gremlins];
  const rows = rankTeams(
    teams,
    [row(sparky, interview, 10), row(sparky, notebook, 50), row(gremlins, notebook, 44), row(titans, notebook, 22)],
    rubricList,
    categories,
  );
  const markup = renderToStaticMarkup(
    <ScoresTab
      panelName="Panel 2"
      rows={rows}
      categories={categories}
      rubricList={rubricList}
      loaded
      error={null}
      flags={[]}
      flagKinds={flagKinds}
      onOpen={noop}
    />,
  );
  assert.match(markup, /<h2>Panel 2 ranking<\/h2><span>3 of 4 scored<\/span>/);
  for (const band of ["Top ≥85%", "Strong ≥70%", "Middle ≥50%", "Emerging"]) assert.ok(markup.includes(band), band);
  const rks = [...markup.matchAll(/<span class="jg-rn">(.*?)<\/span>.*?<b>(\w+)<\/b>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(rks, [["1", "5150Z"], ["2", "2011A"], ["3", "9882K"], ["—", "4410C"]]);
  assert.match(markup, /Gear Gremlins · notebook only/, "the interview is unscored");
  assert.doesNotMatch(markup, /Sparky ·/, "both rubrics are scored");
  assert.match(markup, /<b>60<small>\/76<\/small><\/b>/);
  // An unscored Ungraded team: no band, and the denominator says what it can be scored on.
  assert.match(markup, /Robo Rangers · Ungraded/);
  assert.match(markup, /not scored<\/span><small class="jg-of">interview \/12<\/small>/);
  assert.equal(markup.match(/<button type="button" class="jg-rk"/g)?.length, 4, "each row is a button that opens the sheet");
});

test("Scores says Loading… until the scores arrive, and shows a failure rather than an empty table", () => {
  const props = { panelName: "Panel 2", rows: [], categories, rubricList: [], flags: [], flagKinds, onOpen: noop };
  assert.match(renderToStaticMarkup(<ScoresTab {...props} loaded={false} error={null} />), /Loading…/);
  assert.match(renderToStaticMarkup(<ScoresTab {...props} loaded error="Could not load scores." />), /Could not load scores\./);
});

/* ---- the Today tab -------------------------------------------------------- */

test("the timeline has its times, booked cards, dimmed open slots, and one static now rule", () => {
  const slot = (min: number, by?: { team: Team; status: Status }): Slot => ({
    panelId: "p2",
    start: inMin(min),
    end: inMin(min + 20),
    takenBy: by ? { teamId: by.team.id, teamNumber: by.team.number, status: by.status } : null,
    blocked: false,
  });
  const slots = [
    slot(-36, { team: sparky, status: "completed" }),
    slot(-16),
    slot(4, { team: gremlins, status: "scheduled" }),
    slot(24, { team: rangers, status: "scheduled" }),
    slot(44),
  ];
  const markup = renderToStaticMarkup(
    <TodayTab
      panel={{ name: "Panel 2", slot_minutes: 20 }}
      slots={slots}
      teams={[sparky, gremlins, rangers, titans]}
      panelTeams={[sparky, gremlins, rangers, titans]}
      requests={[
        request(sparky, "completed", { kind: "slot", slot_start: slots[0].start, finished_at: ago(30) }),
        request(titans, "completed", { finished_at: inMin(-90) }),
      ]}
      categories={categories}
      now={NOW}
      onOpen={noop}
    />,
  );
  assert.match(markup, /<h2>Today&#x27;s slots<\/h2><span>3 of 5 booked<\/span>/);
  assert.match(markup, /<p class="jg-cap">Panel 2 · 20 min each<\/p>/);
  assert.equal(markup.match(/class="jg-now"/g)?.length, 1, "one now rule");
  assert.match(markup, /role="separator" aria-label="Now, /);
  // The rule sits between the slots already started and the first still to come.
  const at = markup.indexOf('class="jg-now"');
  assert.equal(markup.slice(0, at).match(/class="jg-sl/g)?.length, 2);
  assert.equal(markup.slice(at).match(/class="jg-sl/g)?.length, 3);
  // The past open slot is dimmed; the one still to come is not.
  assert.equal(markup.match(/jg-sl jg-past/g)?.length, 1);
  assert.equal(markup.match(/class="jg-scard jg-open"/g)?.length, 2);
  // Booked cards: number, name, the status's short label, and "in N min" for the one about to start.
  assert.match(markup, /<b>5150Z<\/b><span>Sparky<\/span>[\s\S]*?jg-s-completed">Complete</);
  assert.match(markup, /<b>2011A<\/b>[\s\S]*?<b>in 4 min<\/b>[\s\S]*?jg-s-scheduled">Booked</);
  assert.doesNotMatch(markup, /<b>in 24/);
  // Teams interviewed before the first slot collapse into one line.
  assert.match(markup, /<p class="jg-early">.*Before .* · 9882K complete<\/p>/);
});

test("with every slot already started the now rule closes the timeline; with none there is a notice", () => {
  const past: Slot = { panelId: "p2", start: inMin(-60), end: inMin(-40), takenBy: null, blocked: false };
  const markup = renderToStaticMarkup(
    <TodayTab panel={{ name: "Panel 2", slot_minutes: 20 }} slots={[past]} teams={[]} panelTeams={[]} requests={[]} categories={categories} now={NOW} onOpen={noop} />,
  );
  assert.ok(markup.indexOf('class="jg-sl') < markup.indexOf('class="jg-now"'));
  assert.match(
    renderToStaticMarkup(<TodayTab panel={{ name: "Panel 2", slot_minutes: 20 }} slots={[]} teams={[]} panelTeams={[]} requests={[]} categories={categories} now={NOW} onOpen={noop} />),
    /This panel has no booking slots\./,
  );
});

test("Today shows only today's slots; the count and the Before line follow", () => {
  const slot = (iso: string, by?: Team): Slot => ({
    panelId: "p2",
    start: iso,
    end: iso,
    takenBy: by ? { teamId: by.id, teamNumber: by.number, status: "scheduled" } : null,
    blocked: false,
  });
  const yesterday = (h: number) => new Date(2026, 9, 16, h).toISOString();
  const today = (h: number) => new Date(2026, 9, 17, h).toISOString();
  const props = { panel: { name: "Panel 2", slot_minutes: 20 }, teams: [gremlins, rangers, titans], panelTeams: [gremlins, rangers, titans], categories, now: NOW, onOpen: noop };
  const markup = renderToStaticMarkup(
    <TodayTab
      {...props}
      slots={[slot(yesterday(9), gremlins), slot(yesterday(10)), slot(today(13), rangers), slot(today(14)), slot(today(15))]}
      // Titans finished at 8:00 today, before today's first slot; Gremlins' slot was yesterday.
      requests={[request(titans, "completed", { finished_at: today(8) })]}
    />,
  );
  assert.match(markup, /<span>1 of 3 booked<\/span>/, "yesterday's slots are not counted");
  assert.equal(markup.match(/class="jg-sl/g)?.length, 3);
  assert.doesNotMatch(markup, /2011A|Gear Gremlins/, "yesterday's booking is not drawn");
  assert.match(markup, /Before [^<]* · 9882K complete/);
  assert.equal(markup.slice(0, markup.indexOf('class="jg-now"')).match(/class="jg-sl/g)?.length ?? 0, 0, "the rule leads: all of today's slots are still to come");
});

test("with no slots today, Today names the date the panel's slots are on", () => {
  const start = new Date(2026, 9, 16, 9).toISOString();
  const later = new Date(2026, 9, 16, 9, 20).toISOString();
  const slots: Slot[] = [start, later].map((iso) => ({ panelId: "p2", start: iso, end: iso, takenBy: null, blocked: false }));
  const markup = renderToStaticMarkup(
    <TodayTab panel={{ name: "Panel A", slot_minutes: 20 }} slots={slots} teams={[]} panelTeams={[]} requests={[]} categories={categories} now={NOW} onOpen={noop} />,
  );
  assert.ok(markup.includes(`No slots today. Panel A&#x27;s slots are on ${dayLabel(start)}.`), markup);
  assert.doesNotMatch(markup, /jg-now|jg-sl|booked/, "no timeline for another day");
});

/* ---- the team sheet ------------------------------------------------------- */

const sheetProps = { request: null, categories, languages, flags: [], flagKinds, ask: async () => true, onClose: noop };

test("closed, the sheet is an empty native dialog; open, it is a labelled modal with the composer", () => {
  const closed = renderToStaticMarkup(<TeamSheet team={null} {...sheetProps} />);
  assert.match(closed, /<dialog[^>]*class="jg-sheet"[^>]*aria-modal="true"[^>]*aria-labelledby=/);
  assert.doesNotMatch(closed, /<h2|<button|<textarea/);

  const markup = renderToStaticMarkup(<TeamSheet team={titans} {...sheetProps} request={request(titans, "requested")} />);
  const labelledby = markup.match(/<dialog[^>]*aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(labelledby);
  assert.match(markup, new RegExp(`<h2 id="${labelledby}">9882K</h2><p class="jg-nm">Torque Titans</p><p class="jg-sub">Developing · EN · Pit 14</p>`));
  assert.match(markup, /<button type="button" class="jg-x" aria-label="Close">/);
  assert.match(markup, /Private to judges and the Judge Advisor\./);
  assert.match(markup, /role="group" aria-label="Team sheet sections"/);
  assert.match(markup, /aria-pressed="true"><span>Notes<\/span><small>no notes<\/small>/);
  assert.match(markup, /<textarea id="jg-note" class="jg-ta" rows="3" placeholder="Add a note for the panel…"/);
  assert.match(markup, /<button type="button" class="jg-prim" disabled="">Save note<\/button>/, "nothing to save yet");
});

test("the sheet closes on Escape and on the backdrop, and the body is rebuilt per team", () => {
  const src = read("src/components/judge/TeamSheet.tsx");
  assert.ok(src.includes("dialog.showModal()") && src.includes("dialog.close()"));
  assert.match(src, /onClose=\{\(\) => \{\s*if \(open\) onClose\(\);\s*\}\}/, "Escape");
  assert.match(src, /e\.target === e\.currentTarget\) onClose\(\)/, "the backdrop");
  assert.ok(src.includes("<Body key={team.id}"), "another team starts fresh");
});

test("the interview segment: sections with subtotals, a scale button per point, the chosen label under each", () => {
  const interview = rubricById("interview")!;
  const [first, second] = interview.criteria;
  const saved: ScoreRow = {
    id: "s1",
    team_id: gremlins.id,
    rubric_id: "interview",
    values: { [first.id]: 2, [second.id]: 1 },
    total: 3,
    scored_by: "Sam",
    panel_id: "p2",
    updated_at: ago(1),
  };
  const markup = renderToStaticMarkup(
    <RubricSegment rubric={interview} team={gremlins} score={saved} ask={async () => true} onSaved={noop} onCleared={noop} />,
  );
  assert.match(markup, new RegExp(`<h3>${interview.sections[0].name}</h3><span class="jg-st"><b>3</b>/${interview.sections[0].criteria.length * 2}</span>`));
  assert.match(markup, new RegExp(`<h3>${interview.sections[1].name}</h3><span class="jg-st"><b>0</b>/`), "a section with nothing scored reads 0");
  // Three points on the interview scale, all labelled, the tapped ones pressed.
  const firstGroup = markup.slice(markup.indexOf('class="jg-sv"'), markup.indexOf("</div>", markup.indexOf('class="jg-sv"')));
  assert.equal(firstGroup.match(/<button/g)?.length, interview.scale.length);
  assert.match(firstGroup, /aria-pressed="true" aria-label="2, /);
  assert.match(firstGroup, /grid-template-columns:repeat\(3, minmax\(0, 1fr\)\)/);
  assert.equal(markup.match(/aria-pressed="true"/g)?.length, 2);
  assert.ok(markup.includes(`<p class="jg-cc">${interview.scale.find((p) => p.value === 2)!.label}</p>`), "the chosen label");
  assert.ok(markup.includes(`<p class="jg-cc">${interview.scale.find((p) => p.value === 1)!.label}</p>`));
  assert.match(markup, /<p class="jg-cc">Not scored<\/p>/);
  // Footer: each tap saves, and clearing is offered because something is scored.
  assert.match(markup, /Saved · each tap saves/);
  assert.match(markup, /<button type="button" class="jg-quiet">Clear Interview scores<\/button>/);
});

test("the notebook segment is a four-point scale, and with nothing scored there is nothing to clear", () => {
  const notebook = rubricById("notebook")!;
  const markup = renderToStaticMarkup(
    <RubricSegment rubric={notebook} team={gremlins} score={null} ask={async () => true} onSaved={noop} onCleared={noop} />,
  );
  assert.match(markup, /grid-template-columns:repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(markup, /aria-label="4, Exemplary"/);
  assert.doesNotMatch(markup, /aria-pressed="true"/);
  assert.doesNotMatch(markup, /Clear Notebook scores|Saved ·/);
  assert.match(markup, /Each tap saves/);
});

/* ---- Cancel request asks first ------------------------------------------- */

test("Cancel request opens a confirm, and nothing is sent until it is confirmed", async () => {
  const sent: string[] = [];
  const shown: (Pending | null)[] = [];
  const { ask, settle } = createConfirmer((p) => shown.push(p));

  const answered = cancelAfterAsking(ask, titans, request(titans, "requested"), async () => {
    sent.push("cancel");
  });
  assert.equal(shown.length, 1, "a confirm dialog opened");
  assert.match(shown[0]!.question, /9882K/);
  assert.equal(shown[0]!.danger, true);
  assert.deepEqual(sent, [], "no request has been sent while the question is open");

  settle(true);
  assert.equal(await answered, true);
  assert.deepEqual(sent, ["cancel"], "confirmed: sent once");
});

test("declining the confirm sends nothing", async () => {
  const sent: string[] = [];
  const { ask, settle } = createConfirmer(noop);
  const answered = cancelAfterAsking(ask, titans, request(titans, "requested"), async () => {
    sent.push("cancel");
  });
  settle(false); // Cancel, Escape and the backdrop all answer no
  assert.equal(await answered, false);
  assert.deepEqual(sent, []);
});

/* ---- the page's wiring (source) ------------------------------------------- */

const page = read("src/app/judge/page.tsx");
function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the page cancels only through the confirm, and advances through the guarded advance()", () => {
  assert.ok(page.includes('import { useConfirm } from "@/components/ConfirmDialog"'));
  assert.ok(page.includes("const { ask, dialog } = useConfirm();"));
  assert.ok(page.includes('cancelAfterAsking(ask, team, request, () => advance(request, "cancel"))'));
  assert.equal(page.match(/advance\(request, "cancel"\)/g)?.length, 1, "no cancel that skips the question");
  assert.ok(page.includes("{dialog}"), "the confirm is rendered");
  const queue = read("src/components/judge/QueueTab.tsx");
  assert.match(queue, /onClick=\{\(\) => onCancel\(team, request\)\}/);
  assert.ok(!queue.includes('"cancel"'), "the tab never sends a cancel itself");
});

test("the clear-scores confirm is worded by its helper", () => {
  const src = read("src/components/judge/TeamSheet.tsx");
  assert.ok(src.includes("ask(clearScoresQuestion(rubric, team, answered)"));
  assert.ok(!src.includes("Clear all ${answered}"));
});

test("the writes keep their guards: a synchronous writing ref, from: request.status, Saving… and Adding…", () => {
  assert.ok(page.includes("const writing = useRef(new Set<string>());"));
  assert.match(page, /if \(writing\.current\.has\(request\.id\)\) return;\s*writing\.current\.add\(request\.id\);/);
  assert.match(page, /body: \{ action, from: request\.status, \.\.\.extra \}/);
  assert.match(page, /if \(writing\.current\.has\(team\.id\)\) return;\s*writing\.current\.add\(team\.id\);/);
  const queue = read("src/components/judge/QueueTab.tsx");
  assert.ok(queue.includes('"Saving…"') && queue.includes('"Adding…"'));
});

test("the page keeps its session gate, polling and error banner, and no longer uses the old drawer or window.confirm", () => {
  assert.ok(page.includes('router.replace("/judge/login")'));
  assert.ok(page.includes("useAppState(4000)") && page.includes("useScores()"));
  assert.ok(page.includes('<Banner kind="error" onDismiss'));
  assert.ok(page.includes("session.role === \"admin\"") && page.includes("Judge Advisor console"));
  assert.ok(!page.includes("NotesDrawer") && !page.includes("Rankings"));
  assert.ok(page.includes("rankTeams("), "the ranking order is the shared one");
});

test("the notes, scores and totals are loaded and saved by one hook, read by the team sheet on both consoles", () => {
  const hook = read("src/components/useTeamRecord.ts");
  assert.ok(hook.includes("/api/notes?teamId=") && hook.includes('"/api/notes"') && hook.includes("/api/scores?teamId="));
  assert.ok(hook.includes("rubricsFor(") && hook.includes("totalFor("));
  const sheet = read("src/components/judge/TeamSheet.tsx");
  assert.ok(sheet.includes('useTeamRecord } from "@/components/useTeamRecord"'), "the team sheet does not use the hook");
  assert.ok(!sheet.includes("/api/notes") && !sheet.includes("totalFor("), "the team sheet carries its own copy of the loading");
});

test("the wait is rounded in one place: judgeQueue's minutesSince, used by the alert row and the cards", () => {
  const queue = read("src/lib/judgeQueue.ts");
  assert.equal(queue.match(/Math\.round\(/g)?.length, 1, "one rounding in judgeQueue.ts");
  assert.ok(queue.includes("minutesSince(c.request!.requested_at, now)"));
  const tab = read("src/components/judge/QueueTab.tsx");
  assert.ok(tab.includes("minutesSince") && !tab.includes("Math.round"));
  assert.ok(!read("src/components/judge/logic.ts").includes("Math.round"));
});

test("the judge styles are page-scoped in globals.css and add no animation", () => {
  const css = read("src/app/globals.css");
  const start = css.indexOf(".judge {");
  const end = css.indexOf("@keyframes si-bar");
  assert.ok(start > css.indexOf(".rf-sheet-foot") && end > start, "the block follows the referee's");
  const block = css.slice(start, end);
  assert.match(block, /\.jg-sheet\[open\] \{ display: flex/, "display is set only while open");
  assert.doesNotMatch(block, /@keyframes|animation|transition/, "no playful motion");
  assert.match(block, /:root\[data-theme="light"\] \.judge/, "light theme tokens");
});
