import type { call } from "@/components/useAppState";
import type { QueueCard } from "@/lib/judgeQueue";
import { judgeKey } from "@/lib/roster";
import type { AwardView, NominateReply, NominationRow, RequestRow } from "@/lib/types";

/* The judge's award nominations, kept out of the markup so they run as plain
   functions in tests/judgeNominate.logic.test.mjs. The server decides who may
   nominate whom (/api/awards); this is what the screen does with the answer. */

/** Who is nominating: the signed-in judge's session name and panel. */
export type Me = { judge: string; panelId: string };

/** A tap whose write is in the air: the chip shows `on` until the server has answered. */
export type PendingTap = { awardId: string; teamId: string; on: boolean };

/** What one judge's nomination of one team for one award is called, for guards and maps. */
export const nominationKey = (awardId: string, teamId: string) => `${awardId}|${teamId}`;

/** Is the row the signed-in judge's own? The name as the roster compares it (trimmed, any case) and the panel, as the API matches it. */
export const isMine = (n: NominationRow, me: Me) => judgeKey(n.judge) === judgeKey(me.judge) && n.panel_id === me.panelId;

const sameSlot = (n: NominationRow, awardId: string, teamId: string) =>
  n.award_id === awardId && n.team_id === teamId;

/** The awards this judge has nominated `teamId` for: the pressed chips. */
export function myAwards(nominations: NominationRow[], teamId: string, me: Me): Set<string> {
  return new Set(
    nominations.filter((n) => n.team_id === teamId && isMine(n, me)).map((n) => n.award_id),
  );
}

/** The reason this judge gave for one nomination, "" when there is none. */
export function myReason(nominations: NominationRow[], awardId: string, teamId: string, me: Me): string {
  return nominations.find((n) => sameSlot(n, awardId, teamId) && isMine(n, me))?.reason ?? "";
}

/**
 * The panel's nominations for one team on one line, in the config's order:
 * "Excellence ×2 · Design", where ×2 is two judges. Empty when there are none.
 * An award the config no longer lists is left out: the judge cannot edit it.
 */
export function nominationSummary(
  nominations: NominationRow[],
  awards: AwardView[],
  teamId: string,
  me: Me,
): string {
  const mine = nominations.filter((n) => n.team_id === teamId && n.panel_id === me.panelId);
  return awards
    .map((a) => {
      const judges = new Set(mine.filter((n) => n.award_id === a.id).map((n) => judgeKey(n.judge))).size;
      return judges > 1 ? `${a.label} ×${judges}` : judges === 1 ? a.label : "";
    })
    .filter(Boolean)
    .join(" · ");
}

/**
 * The server's list with the taps still in the air laid over it, so a chip
 * answers at once. A tap that failed is simply no longer in `taps`, which
 * puts the chip back as the server has it.
 */
export function applyPending(list: NominationRow[], taps: PendingTap[], me: Me): NominationRow[] {
  return taps.reduce((rows, t) => {
    const has = rows.some((n) => sameSlot(n, t.awardId, t.teamId) && isMine(n, me));
    if (t.on === has) return rows;
    if (!t.on) return rows.filter((n) => !(sameSlot(n, t.awardId, t.teamId) && isMine(n, me)));
    return [
      ...rows,
      {
        id: `pending:${nominationKey(t.awardId, t.teamId)}`,
        award_id: t.awardId,
        team_id: t.teamId,
        panel_id: me.panelId,
        judge: me.judge,
        reason: null,
        created_at: "",
        updated_at: "",
      },
    ];
  }, list);
}

/** The list with the server's saved row in place of this judge's earlier one, or added. */
export function withSaved(list: NominationRow[], saved: NominationRow): NominationRow[] {
  const same = (n: NominationRow) =>
    sameSlot(n, saved.award_id, saved.team_id) && n.panel_id === saved.panel_id && judgeKey(n.judge) === judgeKey(saved.judge);
  return list.some(same) ? list.map((n) => (same(n) ? saved : n)) : [...list, saved];
}

/** The list without this judge's nomination of `teamId` for `awardId`. */
export function withoutMine(list: NominationRow[], awardId: string, teamId: string, me: Me): NominationRow[] {
  return list.filter((n) => !(sameSlot(n, awardId, teamId) && isMine(n, me)));
}

/**
 * One write: nominate (or change the reason), or withdraw. `reason` left out
 * keeps what is stored; "" clears it -- what the API does with each. Resolves
 * to the saved row, or null after a withdrawal; rejects with the API's own
 * message (409 not interviewed, 403 conflict, ...).
 */
export async function sendNomination(
  send: typeof call,
  t: { teamId: string; awardId: string; on: boolean; reason?: string },
): Promise<NominationRow | null> {
  const { teamId, awardId } = t;
  if (!t.on) {
    await send("/api/awards", { method: "DELETE", body: { awardId, teamId } });
    return null;
  }
  const body = t.reason === undefined ? { awardId, teamId } : { awardId, teamId, reason: t.reason };
  return (await send<NominateReply>("/api/awards", { method: "POST", body })).nomination;
}

/** The just-finished team the Queue's hero slot is showing, and when it finished. */
export type Finished = { card: QueueCard; at: string };

/**
 * The team whose "Nominate for an award?" card the hero slot shows, or null
 * for the normal hero.
 *
 * `finishedId` is the team this judge last tapped Finish interview for (in
 * memory, set by the page). The card stays until the judge taps Done, and
 * yields -- the team simply shows in Done -- as soon as the team is live
 * again, or any other team has taken a step (requested, been answered, started)
 * since the interview finished. A team already waiting when it finished is
 * not a step: it stays below the card as it did before.
 */
export function pickFinished(
  cards: QueueCard[],
  requests: RequestRow[],
  finishedId: string | null,
  dismissed: ReadonlySet<string>,
): Finished | null {
  if (!finishedId || dismissed.has(finishedId)) return null;
  const card = cards.find((c) => c.team.id === finishedId);
  if (!card || card.request) return null; // gone from the panel, or queueing again
  const at = requests
    .filter((r) => r.team_id === finishedId && r.status === "completed")
    .map((r) => r.finished_at ?? r.updated_at)
    .sort()
    .at(-1);
  if (!at) return null;

  // The latest step a live request has taken. A booking is not a step: it is not asking for a judge yet.
  const lastStep = (r: RequestRow) => Date.parse(r.started_at ?? r.acknowledged_at ?? r.requested_at);
  const taken = cards.some(({ request: r }) =>
    Boolean(r && ["requested", "acknowledged", "interviewing"].includes(r.status) && lastStep(r) > Date.parse(at)),
  );
  return taken ? null : { card, at };
}
