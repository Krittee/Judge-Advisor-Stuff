import assert from "node:assert/strict";
import test from "node:test";

import { decisionFor, nextSend, sameDecision, sentHolding, sentRelease } from "../src/lib/releases";
import type { AwardReleaseRow, AwardView, NoWinnerRow, ReleaseSnapshot, Team, WinnerRow } from "../src/lib/types";

const ES = "Elementary School";
const award = (id: string, places = 1): AwardView => ({ id, label: id, short: id, blurb: "", places });
const team = (id: string, number: string): Team =>
  ({ id, number, name: `Team ${number}`, panel_id: null, division: ES, category: "developing", pit: null, languages: [] }) as unknown as Team;
const win = (award_id: string, team_id: string, division = ES): WinnerRow => ({ award_id, division, team_id, decided_by: "Alex", decided_at: "2026-11-19T09:00:00.000Z" });
const none = (award_id: string, division = ES): NoWinnerRow => ({ award_id, division, decided_by: "Alex", decided_at: "2026-11-19T09:00:00.000Z" });
const A = { id: "a", number: "1001", name: "Team 1001" };
const B = { id: "b", number: "1002", name: "Team 1002" };
const C = { id: "c", number: "1003", name: "Team 1003" };
const snap = (teams: ReleaseSnapshot["teams"], no_winner = false): ReleaseSnapshot => ({ teams, no_winner });
const row = (over: Partial<AwardReleaseRow> = {}): AwardReleaseRow => ({
  award_id: "design", division: ES, teams: [A], no_winner: false, previous: null, status: "sent",
  sent_at: "2026-11-19T09:00:00.000Z", sent_by: "Alex", changed_at: null, ...over,
});
const teams = [team("a", "1001"), team("b", "1002"), team("c", "1003")];

test("decisionFor: nothing decided is null, one of two places is null, a full set is a snapshot sorted by number", () => {
  assert.equal(decisionFor(award("design"), ES, [], [], teams), null);
  assert.equal(decisionFor(award("judges", 2), ES, [win("judges", "a")], [], teams), null);
  assert.deepEqual(decisionFor(award("design"), ES, [win("design", "a")], [], teams), snap([A]));
  assert.deepEqual(decisionFor(award("judges", 2), ES, [win("judges", "b"), win("judges", "a")], [], teams), snap([A, B]));
  assert.deepEqual(decisionFor(award("design"), ES, [win("design", "a", "Middle School")], [], teams), null, "another division's win does not count");
});

test("decisionFor: a no-winner mark is {[], true}", () => {
  assert.deepEqual(decisionFor(award("design"), ES, [], [none("design")], teams), snap([], true));
  assert.equal(decisionFor(award("design"), ES, [], [none("design", "Middle School")], teams), null);
});

test("sameDecision compares no_winner and the set of team ids", () => {
  assert.equal(sameDecision(snap([A, B]), snap([B, A])), true);
  assert.equal(sameDecision(snap([A]), snap([C])), false);
  assert.equal(sameDecision(snap([], true), snap([A])), false);
  assert.equal(sameDecision(snap([], true), snap([], true)), true);
});

test("nextSend: first send, already sent, recalled with the same or a different decision, a third change", () => {
  const NOW = "2026-11-19T10:00:00.000Z";
  assert.deepEqual(nextSend(undefined, snap([A]), NOW), { previous: null, changedAt: null });
  assert.equal(nextSend(row(), snap([B]), NOW), "unchanged");

  const same = row({ status: "recalled", previous: snap([C]), changed_at: "2026-11-19T09:30:00.000Z" });
  assert.deepEqual(nextSend(same, snap([A]), NOW), { previous: snap([C]), changedAt: "2026-11-19T09:30:00.000Z" });

  const recalled = row({ status: "recalled" });
  assert.deepEqual(nextSend(recalled, snap([B]), NOW), { previous: snap([A]), changedAt: NOW });

  const second = row({ status: "recalled", teams: [B], previous: snap([A]), changed_at: NOW });
  assert.deepEqual(nextSend(second, snap([C]), "2026-11-19T11:00:00.000Z"), { previous: snap([B]), changedAt: "2026-11-19T11:00:00.000Z" });
});

test("sentRelease and sentHolding only see sent rows", () => {
  const rows = [row({ award_id: "design", status: "recalled" }), row({ award_id: "create", teams: [B, C] })];
  assert.equal(sentRelease(rows, "design", ES), undefined);
  assert.equal(sentRelease(rows, "create", ES)?.award_id, "create");
  assert.equal(sentRelease(rows, "create", "Middle School"), undefined);
  assert.equal(sentHolding(rows, "a"), undefined, "A's row is recalled");
  assert.equal(sentHolding(rows, "c")?.award_id, "create");
});
