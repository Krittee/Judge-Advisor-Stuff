import assert from "node:assert/strict";
import test from "node:test";

import { changesOf, countText, deskRows, eventLine, sectionCount, sectionRows, sectionsOf, highlight, matchRow, pickTab, readSeen, readTab, resultsText, rowState, seenKey, sentCount, tabKey, tabCount, tabLabel, writeSeen, writeTab } from "../src/components/marketing/marketingLogic";
import { programTabs } from "../src/lib/presets";
import type { AwardReleaseRow, ReleasedView, ReleaseTeam } from "../src/lib/types";
import { CHANGED_AT, LABELS, MS, T, awards, release } from "./marketing.fixtures";

/* The Awards Desk's decisions as plain functions: what a row says, the "N of M
   sent" count, the changes list, the search, and the Seen key. The page draws
   them (marketingPage.runtime.test.tsx). */

const releases: AwardReleaseRow[] = [
  release("excellence", { teams: [T("7700B", "Polar Bots")], previous: { teams: [T("1234A", "Gear Grinders")], no_winner: false }, changed_at: CHANGED_AT }),
  release("design"),
  release("innovate", { status: "recalled", teams: [] }),
  release("create", { teams: [], no_winner: true }),
  release("judges", { teams: [T("1234A", "Gear Grinders"), T("60601D", "Iron Owls")] }),
  release("ghost"), // an award that is no longer in the config
  release("excellence", { division: "High School", teams: [T("2210R", "Red Shift")] }),
];
const view: ReleasedView = { awards, divisions: ["Elementary School", MS, "High School"], programs: [], releases };
const unseen = () => false;

test("rowState: sent, no winner, recalled, never sent", () => {
  assert.equal(rowState(release("design")), "sent");
  assert.equal(rowState(release("create", { teams: [], no_winner: true })), "no-winner");
  assert.equal(rowState(release("innovate", { status: "recalled", teams: [] })), "recalled");
  assert.equal(rowState(null), "not-sent");
});

test("rowState: recalled ignores teams", () => {
  const v: ReleasedView = { ...view, releases: [release("innovate", { status: "recalled", teams: [T("9999Z", "Leaked")] })] };
  const row = deskRows(v, MS, unseen).find((r) => r.award.id === "innovate");
  assert.equal(row?.state, "recalled");
  assert.deepEqual(row?.teams, []);
});

test("deskRows: every config award by order, and no row for an award that is not in the config", () => {
  const rows = deskRows({ ...view, awards: [...awards].reverse() }, MS, unseen);
  assert.deepEqual(rows.map((r) => r.award.label), LABELS);
  assert.equal(rows.find((r) => r.award.id === "think")?.state, "not-sent");
  assert.equal(rows.some((r) => r.award.id === "ghost"), false);
});

test("countText(sentCount): recalled is not counted", () => {
  assert.equal(countText(sentCount(view, MS), 11), "4 of 11 sent");
  assert.equal(countText(0, 11), "0 of 11 sent");
});

test("sentCount ignores unknown awards", () => {
  assert.equal(sentCount(view, MS), 4); // excellence, design, create (no winner), judges; not ghost, not innovate
  assert.equal(sentCount(view, "High School"), 1);
  assert.equal(sentCount(view, "Elementary School"), 0);
});

test("changesOf: the replaced decision, in words", () => {
  const [one] = changesOf(view, unseen);
  assert.equal(one.nowText, "7700B Polar Bots");
  assert.equal(one.wasText, "1234A");
  assert.equal(one.division, MS);
  assert.equal(one.label, "Excellence");
  assert.equal(changesOf(view, unseen).length, 1);
});

test("changesOf: Judges lists numbers, and No winner reads as No winner either way", () => {
  const prev = (teams: ReleaseTeam[], no_winner = false) => ({ teams, no_winner });
  const v = (r: AwardReleaseRow): ReleasedView => ({ ...view, releases: [r] });
  const j = changesOf(v(release("judges", { teams: [T("1234A", "Gear Grinders"), T("60601D", "Iron Owls")], previous: prev([T("1234A", "Gear Grinders"), T("5150X", "Short Circuit")]), changed_at: CHANGED_AT })), unseen)[0];
  assert.equal(j.nowText, "1234A, 60601D");
  assert.equal(j.wasText, "1234A, 5150X");
  const to = changesOf(v(release("create", { teams: [], no_winner: true, previous: prev([T("1234A", "Gear Grinders")]), changed_at: CHANGED_AT })), unseen)[0];
  assert.equal(to.nowText, "No winner");
  const from = changesOf(v(release("create", { previous: prev([], true), changed_at: CHANGED_AT })), unseen)[0];
  assert.equal(from.wasText, "No winner");
});

test("changesOf: division order then award order, a recalled row is no change, Seen removes it", () => {
  const both: ReleasedView = {
    ...view,
    releases: [
      release("think", { division: "High School", previous: { teams: [T("1", "x")], no_winner: false }, changed_at: CHANGED_AT }),
      release("design", { previous: { teams: [T("1", "x")], no_winner: false }, changed_at: CHANGED_AT }),
      release("excellence", { previous: { teams: [T("1", "x")], no_winner: false }, changed_at: CHANGED_AT }),
      release("build", { status: "recalled", teams: [], previous: { teams: [T("1", "x")], no_winner: false }, changed_at: CHANGED_AT }),
    ],
  };
  assert.deepEqual(changesOf(both, unseen).map((c) => `${c.division}/${c.label}`), [`${MS}/Excellence`, `${MS}/Design`, "High School/Think"]);
  const [first] = changesOf(both, unseen);
  assert.equal(changesOf(both, (k) => k === first.key).length, 2);
  assert.equal(changesOf(view, () => true).length, 0);
});

test("seenKey is the award, the division and the change", () => {
  assert.equal(
    seenKey({ award_id: "excellence", division: MS, changed_at: CHANGED_AT }),
    "mk-seen:excellence:Middle School:2026-11-19T03:58:00.000Z",
  );
});

test("a newer changed_at is unseen again", () => {
  const old = seenKey({ award_id: "excellence", division: MS, changed_at: CHANGED_AT });
  const seen = new Set([old]);
  assert.equal(changesOf(view, (k) => seen.has(k)).length, 0);
  const newer: ReleasedView = { ...view, releases: [{ ...releases[0], changed_at: "2026-11-19T04:10:00.000Z" }] };
  assert.equal(changesOf(newer, (k) => seen.has(k)).length, 1);
});

test("matchRow: current team number, name or award label; never the previous team", () => {
  const rows = deskRows(view, MS, unseen);
  const ex = rows.find((r) => r.award.id === "excellence")!;
  assert.equal(matchRow(ex, "7700b"), true);
  assert.equal(matchRow(ex, " polar "), true);
  assert.equal(matchRow(rows.find((r) => r.award.id === "design")!, "design"), true);
  assert.equal(matchRow(ex, "1234A"), false);
  assert.equal(matchRow(ex, "gear"), false);
  assert.equal(matchRow(ex, ""), true);
  assert.equal(matchRow(ex, "   "), true);
  assert.equal(matchRow(rows.find((r) => r.award.id === "judges")!, "1234A"), true);
});

test("highlight splits the matched part, case-insensitively", () => {
  assert.deepEqual(highlight("Polar Bots", "lar"), [{ text: "Po", hit: false }, { text: "lar", hit: true }, { text: " Bots", hit: false }]);
  assert.deepEqual(highlight("1234A", " 1234"), [{ text: "1234", hit: true }, { text: "A", hit: false }]);
  assert.deepEqual(highlight("Polar", "POLAR"), [{ text: "Polar", hit: true }]);
  assert.deepEqual(highlight("Polar", "zz"), [{ text: "Polar", hit: false }]);
  assert.deepEqual(highlight("Polar", ""), [{ text: "Polar", hit: false }]);
});

test("resultsText", () => {
  assert.equal(resultsText(1), "1 result");
  assert.equal(resultsText(3), "3 results");
  assert.equal(resultsText(0), "0 results");
});

test("seen store survives a throwing storage", () => {
  const k = "mk-seen:x:y:z";
  assert.equal(readSeen({ getItem() { throw new Error("blocked"); } }, k), false);
  assert.doesNotThrow(() => writeSeen({ setItem() { throw new Error("blocked"); } }, k));
  assert.equal(readSeen(null, k), false);
  assert.doesNotThrow(() => writeSeen(null, k));
});

test("seen store reads back what it wrote", () => {
  const m = new Map<string, string>();
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  assert.equal(readSeen(store, "k"), false);
  writeSeen(store, "k");
  assert.equal(readSeen(store, "k"), true);
  assert.equal(m.get("k"), "1");
});

/* ---- the program tabs -------------------------------------------------- */

const IQ = { label: "VEX IQ", divisions: ["Elementary School", MS] };
const V5 = { label: "V5RC", divisions: [MS, "High School"] };
const EVENT = ["Elementary School", MS, "High School", "Blended"];

test("programTabs: configured programs in event order, then Blended, then Other; empty tabs drop", () => {
  assert.deepEqual(programTabs(EVENT, [IQ, V5], ["Blended"]), [IQ, V5, { label: "Blended", divisions: ["Blended"] }]);
  assert.deepEqual(programTabs([...EVENT, "Open"], [IQ, V5], ["Blended"]).at(-1), { label: "Other", divisions: ["Open"] });
  // A program keeps only the divisions this event has, in the event's order.
  assert.deepEqual(programTabs([MS, "Elementary School"], [IQ], []), [{ label: "VEX IQ", divisions: [MS, "Elementary School"] }]);
  assert.deepEqual(programTabs(["High School"], [IQ, V5], ["Blended"]), [{ label: "V5RC", divisions: ["High School"] }]);
});

test("programTabs: without a programs config there is one tab, All", () => {
  assert.deepEqual(programTabs(EVENT, [], ["Blended"]), [{ label: "All", divisions: EVENT }]);
});

test("tabKey is a lower-case slug; pickTab keeps the saved tab only while it exists", () => {
  assert.equal(tabKey("VEX IQ"), "vex-iq");
  assert.equal(tabKey("V5RC"), "v5rc");
  const tabs = [IQ, V5];
  assert.equal(pickTab(tabs, "v5rc"), "v5rc");
  assert.equal(pickTab(tabs, "gone"), "vex-iq", "the first tab when the saved one is gone");
  assert.equal(pickTab(tabs, null), "vex-iq");
});

test("tabLabel counts sent rows over awards x divisions; Middle School counts in each tab it is in", () => {
  const v: ReleasedView = { ...view, programs: [IQ, V5] };
  // Middle School has 4 sent (excellence, design, create, judges); High School 1; the "ghost" award is not counted.
  assert.equal(tabLabel(v, IQ), "VEX IQ · 4 of 22 sent");
  assert.equal(tabLabel(v, V5), "V5RC · 5 of 22 sent");
  assert.equal(tabCount(v, IQ), "4 of 22 sent");
  assert.equal(tabCount(v, V5), "5 of 22 sent");
});

test("the remembered tab survives a throwing storage", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readTab(broken), null);
  assert.equal(readTab(null), null);
  assert.doesNotThrow(() => writeTab(broken, "v5rc"));
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  writeTab(store, "v5rc");
  assert.equal(readTab(store), "v5rc");
  assert.equal(mem.has("mk-tab"), true);
});

/* ---- a saved event setup: sections instead of tabs ---------------------- */

const WE = "Whole event";
const ES = "Elementary School";
const PER = ["excellence", "design"];
const blendedView: ReleasedView = {
  awards,
  divisions: [ES, MS],
  programs: [{ label: "All", divisions: [ES, MS] }],
  setup: { program: "VEX IQ", format: "blended" },
  sections: [
    { key: ES, awardIds: PER },
    { key: MS, awardIds: PER },
    { key: WE, awardIds: awards.filter((a) => !PER.includes(a.id)).map((a) => a.id) },
  ],
  releases: [
    release("excellence", { division: ES, teams: [T("41111A", "Little Levers")] }),
    release("excellence", { teams: [T("7700B", "Polar Bots")], previous: { teams: [T("1234A", "Gear Grinders")], no_winner: false }, changed_at: CHANGED_AT }),
    release("design"),
    release("innovate", { division: WE, teams: [T("5150X", "Short Circuit")], previous: { teams: [T("9090Z", "Old")], no_winner: false }, changed_at: CHANGED_AT }),
    release("think", { division: WE }),
    release("build", { division: WE }),
    release("create", { division: WE, teams: [], no_winner: true }),
    release("judges", { division: WE, teams: [T("1234A", "Gear Grinders"), T("12021B", "Blue Bolts")] }),
    release("energy", { division: WE, status: "recalled", teams: [] }),
  ],
};

test("sectionsOf: the view's sections in order, each with its awards in config order", () => {
  const s = sectionsOf({ ...blendedView, awards: [...awards].reverse() });
  assert.deepEqual(s.map((x) => x.key), [ES, MS, WE]);
  assert.deepEqual(s[0].awards.map((a) => a.label), ["Excellence", "Design"]);
  assert.deepEqual(s[2].awards.map((a) => a.label), LABELS.filter((l) => l !== "Excellence" && l !== "Design"));
  assert.deepEqual(sectionsOf(view), [], "no setup, no sections");
});

test("sectionRows: only the section's awards, read under the section's key", () => {
  const [es, ms, we] = blendedView.sections!;
  assert.deepEqual(sectionRows(blendedView, es, unseen).map((r) => [r.award.label, r.state]), [["Excellence", "sent"], ["Design", "not-sent"]]);
  const msRows = sectionRows(blendedView, ms, unseen);
  assert.equal(msRows[0].teams[0].number, "7700B");
  assert.equal(msRows[0].change?.wasText, "1234A");
  const weRows = sectionRows(blendedView, we, unseen);
  assert.equal(weRows.length, 9);
  assert.equal(weRows.find((r) => r.award.id === "energy")?.state, "recalled");
  assert.equal(weRows.find((r) => r.award.id === "think")?.state, "sent");
});

test("sectionCount: sent rows under the key over the section's awards", () => {
  const [es, , we] = blendedView.sections!;
  assert.equal(sectionCount(blendedView, es), "1 of 2 sent");
  assert.equal(sectionCount(blendedView, we), "5 of 9 sent", "a recalled row is not counted");
});

test("eventLine: Blended names the per-division awards, Standard says every award", () => {
  assert.equal(eventLine(blendedView), "Excellence and Design for each division · every other award for the whole event");
  assert.equal(eventLine({ ...blendedView, setup: { program: "V5RC", format: "standard" }, sections: [{ key: MS, awardIds: awards.map((a) => a.id) }] }), "Every award for each division");
});

test("changesOf with sections: a whole-event change is listed under Whole event, in section order", () => {
  const c = changesOf(blendedView, unseen);
  assert.deepEqual(c.map((x) => `${x.division} · ${x.label}`), [`${MS} · Excellence`, `${WE} · Innovate`]);
  assert.equal(changesOf(blendedView, (k) => k.includes(`:${WE}:`)).length, 1);
});

test("a snapshot's division stays on the row's team for the desk to tag", () => {
  const r = sectionRows({ ...blendedView, releases: [release("think", { division: WE, teams: [{ ...T("5150X", "Short Circuit"), division: MS }] })] }, blendedView.sections![2], unseen);
  assert.equal(r.find((x) => x.award.id === "think")?.teams[0].division, MS);
});
