import assert from "node:assert/strict";
import test from "node:test";

import { completedTeamIds, groupQueue, pickHero, waitingAlert } from "../src/lib/judgeQueue";

/* The judge console's queue: who is the hero card, and how the rest are
   listed. Runs against the real src/lib/judgeQueue.ts. */

const score = { total: 0, max: 0, scored: false };

/** A team's card; `request` is null for a team with nothing live. */
function card(number, status, req = {}) {
  return {
    team: { id: `t${number}`, number },
    request: status
      ? { id: `r${number}`, team_id: `t${number}`, status, requested_at: "2026-10-17T09:00:00Z", slot_start: null, ...req }
      : null,
    score,
  };
}
const numbers = (cards) => cards.map((c) => c.team.number);
const at = (hhmm) => `2026-10-17T${hhmm}:00Z`;

/* ---- pickHero ------------------------------------------------------------- */

test("with nothing live there is no hero", () => {
  assert.equal(pickHero([]), null);
  assert.equal(pickHero([card("1A", null), card("2A", null)]), null);
});

test("a team being interviewed is the hero even with others waiting longer", () => {
  const cards = [card("1A", "requested", { requested_at: at("08:00") }), card("2A", "interviewing", { requested_at: at("09:30") })];
  assert.equal(pickHero(cards).team.number, "2A");
});

test("a team on the way beats one waiting, and loses to one interviewing", () => {
  const waiting = card("1A", "requested", { requested_at: at("08:00") });
  const enroute = card("2A", "acknowledged", { requested_at: at("09:00") });
  const talking = card("3A", "interviewing", { requested_at: at("09:10") });
  assert.equal(pickHero([waiting, enroute]).team.number, "2A");
  assert.equal(pickHero([waiting, enroute, talking]).team.number, "3A");
});

test("the longest-waiting team is the hero, then team number breaks a tie", () => {
  const cards = [
    card("30A", "requested", { requested_at: at("09:20") }),
    card("9A", "requested", { requested_at: at("09:05") }),
    card("10A", "requested", { requested_at: at("09:05") }),
  ];
  // 9A and 10A tie on time; the number is read as a number, so 9A first.
  assert.equal(pickHero(cards).team.number, "9A");
});

test("with nobody live the hero is the next booked slot", () => {
  const cards = [
    card("1A", "scheduled", { slot_start: at("11:00"), requested_at: at("07:00") }),
    card("2A", "scheduled", { slot_start: at("10:00"), requested_at: at("08:00") }),
    card("3A", null),
  ];
  assert.equal(pickHero(cards).team.number, "2A");
});

test("a live team beats any booking", () => {
  const cards = [card("1A", "scheduled", { slot_start: at("09:00") }), card("2A", "requested")];
  assert.equal(pickHero(cards).team.number, "2A");
});

/* ---- groupQueue ----------------------------------------------------------- */

test("the list runs Waiting, With us, Booked, Not in queue, Done", () => {
  const sections = groupQueue([], null, new Set());
  assert.deepEqual(Object.keys(sections), ["waiting", "withUs", "booked", "notInQueue", "done"]);
});

test("the hero is in no section, and every other team is in exactly one", () => {
  const cards = [
    card("1A", "interviewing"),
    card("2A", "requested"),
    card("3A", "acknowledged"),
    card("4A", "scheduled", { slot_start: at("10:00") }),
    card("5A", null),
    card("6A", null),
  ];
  const hero = pickHero(cards);
  const sections = groupQueue(cards, hero, new Set(["t6A"]));
  assert.equal(hero.team.number, "1A");
  assert.deepEqual(numbers(sections.waiting), ["2A"]);
  assert.deepEqual(numbers(sections.withUs), ["3A"]);
  assert.deepEqual(numbers(sections.booked), ["4A"]);
  assert.deepEqual(numbers(sections.notInQueue), ["5A"]);
  assert.deepEqual(numbers(sections.done), ["6A"]);
  assert.equal(Object.values(sections).flat().length, cards.length - 1);
});

test("a waiting hero is not repeated under Waiting", () => {
  const cards = [card("1A", "requested", { requested_at: at("09:00") }), card("2A", "requested", { requested_at: at("09:10") })];
  const sections = groupQueue(cards, pickHero(cards), new Set());
  assert.deepEqual(numbers(sections.waiting), ["2A"]);
});

test("waiting is longest wait first, then team number", () => {
  const cards = [
    card("2A", "requested", { requested_at: at("09:30") }),
    card("11A", "requested", { requested_at: at("09:10") }),
    card("3A", "requested", { requested_at: at("09:10") }),
  ];
  assert.deepEqual(numbers(groupQueue(cards, null, new Set()).waiting), ["3A", "11A", "2A"]);
});

test("With us lists teams on the way before teams interviewing", () => {
  const cards = [
    card("1A", "interviewing", { requested_at: at("08:00") }),
    card("2A", "acknowledged", { requested_at: at("09:00") }),
  ];
  assert.deepEqual(numbers(groupQueue(cards, null, new Set()).withUs), ["2A", "1A"]);
});

test("Booked is by slot start, not by when the booking was made", () => {
  const cards = [
    card("1A", "scheduled", { slot_start: at("11:00"), requested_at: at("07:00") }),
    card("2A", "scheduled", { slot_start: at("10:00"), requested_at: at("08:00") }),
  ];
  assert.deepEqual(numbers(groupQueue(cards, null, new Set()).booked), ["2A", "1A"]);
});

test("a finished team is Done, but one that has queued again is back in the queue", () => {
  const cards = [card("1A", null), card("2A", null), card("3A", "requested")];
  const sections = groupQueue(cards, null, new Set(["t1A", "t3A"]));
  assert.deepEqual(numbers(sections.done), ["1A"]);
  assert.deepEqual(numbers(sections.notInQueue), ["2A"]);
  assert.deepEqual(numbers(sections.waiting), ["3A"]);
});

test("completedTeamIds reads completed requests, not cancelled ones", () => {
  const ids = completedTeamIds([
    { team_id: "a", status: "completed" },
    { team_id: "b", status: "cancelled" },
    { team_id: "c", status: "requested" },
  ]);
  assert.deepEqual([...ids], ["a"]);
});

/* ---- waitingAlert --------------------------------------------------------- */

test("the alert row reads each waiting team's minutes, longest first", () => {
  const now = Date.parse(at("09:30"));
  const alert = waitingAlert(
    [card("2A", "requested", { requested_at: at("09:22") }), card("1A", "requested", { requested_at: at("09:10") })],
    now,
  );
  assert.deepEqual(alert.map((a) => [a.team.number, a.minutes]), [["1A", 20], ["2A", 8]]);
});
