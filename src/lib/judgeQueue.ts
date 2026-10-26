import { STATUS_META } from "./status";
import { compareTeamNumbers } from "./teamNumber";
import type { RequestRow, Team } from "./types";

/**
 * One team on a judge's panel, with what the console needs to draw it.
 *
 * `request` is the team's live request (`liveRequestFor`): requested,
 * acknowledged or interviewing, else the earliest scheduled booking, else
 * none. `score` is `totalFor` against the rubrics the team's category is
 * judged on.
 */
export type QueueCard = {
  team: Team;
  request: RequestRow | null;
  score: { total: number; max: number; scored: boolean };
};

export type QueueSections = {
  /** Requested, longest wait first. */
  waiting: QueueCard[];
  /** On the way, then interviewing -- the ones not already the hero. */
  withUs: QueueCard[];
  /** Scheduled, by slot start. */
  booked: QueueCard[];
  /** No live request and not finished. */
  notInQueue: QueueCard[];
  /** Finished, and nothing live since. */
  done: QueueCard[];
};

// Longest wait first, then team number, so nobody gets forgotten.
const byWait = (a: QueueCard, b: QueueCard) =>
  (a.request?.requested_at ?? "").localeCompare(b.request?.requested_at ?? "") ||
  compareTeamNumbers(a.team.number, b.team.number);

const bySlot = (a: QueueCard, b: QueueCard) =>
  (a.request?.slot_start ?? "").localeCompare(b.request?.slot_start ?? "") ||
  compareTeamNumbers(a.team.number, b.team.number);

const byNumber = (a: QueueCard, b: QueueCard) => compareTeamNumbers(a.team.number, b.team.number);

/**
 * The one team the console puts front and centre.
 *
 * While judges are with a team, that team is the hero and the ones still
 * waiting are surfaced by an alert row instead. Otherwise whoever has
 * waited longest, and with nobody live the next booked slot.
 */
export function pickHero(cards: QueueCard[]): QueueCard | null {
  const first = (status: string, order: (a: QueueCard, b: QueueCard) => number) =>
    cards.filter((c) => c.request?.status === status).sort(order)[0];

  return (
    first("interviewing", byWait) ??
    first("acknowledged", byWait) ??
    first("requested", byWait) ??
    first("scheduled", bySlot) ??
    null
  );
}

/**
 * The teams on this panel that have a finished interview.
 *
 * "Done" is a completed request in the requests list, not the absence of a
 * live one: a team that has never queued also has no live request.
 */
export function completedTeamIds(requests: RequestRow[]): Set<string> {
  return new Set(requests.filter((r) => r.status === "completed").map((r) => r.team_id));
}

/**
 * Everyone but the hero, in the sections the list shows, top to bottom.
 *
 * A team is done when it has a completed request and no live one -- booking
 * or queueing again takes it back out of Done.
 */
export function groupQueue(
  cards: QueueCard[],
  hero: QueueCard | null,
  completed: ReadonlySet<string>,
): QueueSections {
  const rest = cards.filter((c) => c.team.id !== hero?.team.id);
  const status = (c: QueueCard) => c.request?.status;

  return {
    waiting: rest.filter((c) => status(c) === "requested").sort(byWait),
    withUs: rest
      .filter((c) => status(c) === "acknowledged" || status(c) === "interviewing")
      .sort((a, b) => {
        const order = STATUS_META[a.request!.status].order - STATUS_META[b.request!.status].order;
        return order || byWait(a, b);
      }),
    booked: rest.filter((c) => status(c) === "scheduled").sort(bySlot),
    notInQueue: rest.filter((c) => !c.request && !completed.has(c.team.id)).sort(byNumber),
    done: rest.filter((c) => !c.request && completed.has(c.team.id)).sort(byNumber),
  };
}

/**
 * Whole minutes since `iso`, rounded and never negative. The one place the
 * console rounds a wait, so the alert row and the "4 min" on the cards agree.
 */
export function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
}

/** Minutes each waiting team has stood there, longest first, for the alert row. */
export function waitingAlert(waiting: QueueCard[], now: number) {
  return [...waiting].sort(byWait).map((c) => ({
    team: c.team,
    minutes: minutesSince(c.request!.requested_at, now),
  }));
}
