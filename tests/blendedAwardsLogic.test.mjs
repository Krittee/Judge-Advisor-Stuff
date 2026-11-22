import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAwardPanels, buildMatrix, clearAfterAsking, conductIn, decidedCount, decidedText, detailFor, eventDecided, eventDecidedText, eventNotReadyLines, giveAfterAsking, heldByTeam, nominationsIn, notReadyLines, readyToSend, winnersOf,
} from "../src/components/admin/awardsLogic";
import { awardsUnder, scopeKeys, WHOLE_EVENT } from "../src/lib/eventSetup";
import { sentUnder } from "../src/lib/releases";
import { awards as awardList, gearGrinders, nom, nominations, panels, release, roboraptors, team, teams, win } from "./adminAwards.fixtures";

const ES = "Elementary School";
const MS = "IQ Middle School";
const awards = awardList;
const esTeam = team("100A", "ES One", { division: ES, panel_id: "p2" });
const all = [...teams, esTeam];
// Excellence is per division; Innovate is given once for the whole event.
const winners = [win("excellence", esTeam), win("innovate", gearGrinders, WHOLE_EVENT)];
const noms = [...nominations, nom(esTeam, "innovate", "p2", "Sam Rivera")];

test("decidedText counts the awards under the key; no format counts all of them", () => {
  assert.equal(decidedText(winners, awards, ES, [], "blended"), "1/2");
  assert.equal(decidedText(winners, awards, WHOLE_EVENT, [], "blended"), "1/9");
  assert.equal(decidedText([win("excellence", esTeam)], awards, WHOLE_EVENT, [], "blended"), "0/9");
  assert.equal(decidedText([win("excellence", esTeam)], awards, ES), "1/11");
  assert.equal(decidedCount([win("excellence", esTeam)], awards, ES), 1);
});

test("nominationsIn and conductIn read every team under Whole event", () => {
  const whole = nominationsIn(noms, all, WHOLE_EVENT);
  assert.ok(whole.some((n) => n.team_id === esTeam.id) && whole.some((n) => n.team_id === roboraptors.id));
  assert.equal(nominationsIn(noms, all, ES).length, 1);
  const flags = [1, 2].map((i) => ({ id: `f${i}`, team_id: esTeam.id, kind: "good" }));
  const wholeFlags = conductIn(flags, all, WHOLE_EVENT);
  assert.equal(wholeFlags.get(esTeam.id), 2);
  assert.equal(conductIn(flags, all, MS).size, 0);
});

test("heldByTeam gathers an award's winners across every key", () => {
  const held = heldByTeam([win("excellence", esTeam), win("excellence", gearGrinders), win("innovate", gearGrinders, WHOLE_EVENT)]);
  assert.equal(held.get("excellence").length, 2);
  assert.equal(held.get("innovate").length, 1);
});

test("detailFor in a blended event reads Whole event and the team's other keys", () => {
  const d = detailFor({ awardId: "innovate", teamId: esTeam.id }, { awards, nominations: noms, winners, teams: all, panels, format: "blended" });
  assert.ok(d.others.some((o) => o.team.id === roboraptors.id), "MS nominee shows");
  assert.equal(d.current.id, gearGrinders.id);
  assert.deepEqual(d.has.map((a) => a.id), ["excellence"]);
  assert.equal(d.isWinner, false);
});

test("detailFor without a format is today's per-division read", () => {
  const d = detailFor({ awardId: "innovate", teamId: esTeam.id }, { awards, nominations: noms, winners, teams: all, panels });
  assert.ok(!d.others.some((o) => o.team.id === roboraptors.id));
  assert.equal(d.current, null);
});

test("buildMatrix and buildAwardPanels take `has` from held", () => {
  const decided = winnersOf(winners, ES);
  const held = heldByTeam(winners);
  const m = buildMatrix(awards, noms, decided, all, panels, "", new Map(), new Set(), held);
  assert.deepEqual(m.rows.find((r) => r.team.id === esTeam.id).has.map((a) => a.id), ["excellence"]);
  const p = buildAwardPanels(awards, noms, new Map(), all, panels, "", new Map(), new Set(), held);
  assert.deepEqual(p.find((x) => x.award.id === "innovate").nominees.find((n) => n.team.id === esTeam.id).has.map((a) => a.id), ["excellence"]);
  const plain = buildMatrix(awards, noms, decided, all, panels);
  assert.deepEqual(plain.rows.find((r) => r.team.id === esTeam.id).has.map((a) => a.id), ["excellence"]);
});

test("readyToSend lists a whole-event award once, notReadyLines filters under the key", () => {
  const ready = readyToSend(awards, [ES, MS], winners, [], [], "blended");
  assert.deepEqual(ready.filter((r) => r.award.id === "innovate"), [{ award: awards.find((a) => a.id === "innovate"), division: WHOLE_EVENT }]);
  assert.deepEqual(ready.map((r) => `${r.award.id}|${r.division}`).sort(), [`excellence|${ES}`, `innovate|${WHOLE_EVENT}`]);
  assert.equal(readyToSend(awards, [ES, MS], winners, [], []).filter((r) => r.award.id === "innovate").length, 0);
  assert.equal(readyToSend(awards, [ES, MS], [win("innovate", gearGrinders, ES), win("innovate", gearGrinders, MS)], [], []).length, 2);
  assert.equal(notReadyLines(awards, ES, winners, [], [], "blended").length, 1);
  assert.equal(notReadyLines(awards, WHOLE_EVENT, winners, [], [], "blended").length, 8);
  assert.equal(notReadyLines(awards, ES, winners, [], []).length, 10);
});

test("give and clear send the pick's division, else the team's", async () => {
  const sent = [];
  const call = async (url, init) => { sent.push(init); };
  const ask = async () => true;
  const innovate = awards.find((a) => a.id === "innovate");
  await giveAfterAsking(ask, call, { award: innovate, team: esTeam, current: null, division: WHOLE_EVENT });
  await clearAfterAsking(ask, call, { award: innovate, team: esTeam, division: WHOLE_EVENT });
  await giveAfterAsking(ask, call, { award: innovate, team: esTeam, current: null });
  assert.deepEqual(sent.map((s) => s.body.division), [WHOLE_EVENT, WHOLE_EVENT, ES]);
});

// The whole VEX IQ Blended event: Excellence and Design in ES and MS, and nine awards for the whole event, 13 in all.
const twelve = [
  win("excellence", esTeam), win("excellence", gearGrinders), win("design", esTeam), win("design", gearGrinders),
  ...["innovate", "think", "amaze", "build", "inspire", "sportsmanship"].map((id) => win(id, gearGrinders, WHOLE_EVENT)),
  win("judges", gearGrinders, WHOLE_EVENT), win("judges", roboraptors, WHOLE_EVENT),
];
const create = [{ award_id: "create", division: WHOLE_EVENT }];

test("eventDecided and eventDecidedText count every key: 12 of 13 with Energy open", () => {
  assert.deepEqual(eventDecided(twelve, awards, [ES, MS], create, "blended"), { decided: 12, total: 13 });
  assert.equal(eventDecidedText(twelve, awards, [ES, MS], create, "blended"), "12/13");
  assert.equal(eventDecidedText([], awards, [ES, MS], [], "blended"), "0/13");
  // Standard: every award per division.
  assert.equal(eventDecidedText([win("excellence", esTeam)], awards, [ES, MS], [], "standard"), "1/22");
});

// BlendedAwards.tsx's "· N sent to Marketing": sentUnder summed over every key of the blended setup.
const eventSent = (releases, divisions) => scopeKeys(divisions, "blended").reduce((n, key) => n + sentUnder(releases, key, awardsUnder(awards, key, "blended").map((a) => a.id)), 0);

test("the event's sent count adds up the sent rows across ES, MS and Whole event, not a recalled one", () => {
  const releases = [
    release("excellence", esTeam, { division: ES }),
    release("excellence", gearGrinders, { division: MS }),
    release("innovate", gearGrinders, { division: WHOLE_EVENT }),
    release("think", gearGrinders, { division: WHOLE_EVENT, status: "recalled" }),
  ];
  assert.equal(eventSent(releases, [ES, MS]), 3);
  assert.equal(eventSent([], [ES, MS]), 0);
});

test("eventNotReadyLines names each key, so two halves of one award do not read alike", () => {
  const lines = eventNotReadyLines(awards, [ES, MS], [win("excellence", esTeam)], [], [], "blended");
  assert.equal(lines.length, 12);
  assert.ok(lines.includes("Excellence · IQ Middle School isn't ready: no winner yet."));
  assert.ok(lines.includes("Innovate · Whole event isn't ready: no winner yet."));
  assert.ok(!lines.some((l) => l.startsWith("Excellence · Elementary School")));
  assert.equal(new Set(lines).size, lines.length);
});
