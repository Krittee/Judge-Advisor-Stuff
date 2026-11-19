import assert from "node:assert/strict";
import test from "node:test";

import { changesOf, countText, deskRows, highlight, matchRow, readSeen, resultsText, rowState, seenKey, sentCount, writeSeen } from "../src/components/marketing/marketingLogic";
import type { AwardReleaseRow, ReleasedView, ReleaseTeam } from "../src/lib/types";

/* The Awards Desk's decisions as plain functions: what a row says, the "N of M
   sent" count, the changes list, the search, and the Seen key. The page draws
   them (marketingPage.runtime.test.tsx). */

const MS = "Middle School";
const T = (number: string, name: string): ReleaseTeam => ({ id: `t-${number}`, number, name });
const LABELS = ["Excellence", "Design", "Innovate", "Think", "Amaze", "Build", "Create", "Judges", "Inspire", "Sportsmanship", "Energy"];
const awards = LABELS.map((label, i) => ({ id: label.toLowerCase(), label, order: i + 1, places: label === "Judges" ? 2 : 1 }));

const release = (award_id: string, over: Partial<AwardReleaseRow> = {}): AwardReleaseRow => ({
  award_id, division: MS, teams: [T("2381C", "Byte Size")], no_winner: false, previous: null, status: "sent",
  sent_at: "2026-11-19T03:31:00.000Z", sent_by: "Pat", changed_at: null, ...over,
});
const CHANGED_AT = "2026-11-19T03:58:00.000Z";

const releases: AwardReleaseRow[] = [
  release("excellence", { teams: [T("7700B", "Polar Bots")], previous: { teams: [T("1234A", "Gear Grinders")], no_winner: false }, changed_at: CHANGED_AT }),
  release("design"),
  release("innovate", { status: "recalled", teams: [] }),
  release("create", { teams: [], no_winner: true }),
  release("judges", { teams: [T("1234A", "Gear Grinders"), T("60601D", "Iron Owls")] }),
  release("ghost"), // an award that is no longer in the config
  release("excellence", { division: "High School", teams: [T("2210R", "Red Shift")] }),
];
const view: ReleasedView = { awards, divisions: ["Elementary School", MS, "High School"], releases };
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
