import { NextResponse } from "next/server";
import { actorParts } from "@/lib/activity";
import { canReadNotes, getSession, mayActOnPanel, type Session } from "@/lib/auth";
import { store, StoreError } from "@/lib/db";
import { blockedTeams, CONFLICT_MESSAGE, isConflicted, loadBlocks } from "@/lib/conflicts";
import { completedTeamIds } from "@/lib/judgeQueue";
import { awards } from "@/lib/presets";
import { judgeKey } from "@/lib/roster";
import type { NominationRow } from "@/lib/types";
import { awardLabel, fields, REASON_MAX } from "./shared";

export const dynamic = "force-dynamic";

/**
 * Award nominations.
 *
 * Judges nominate the teams they interviewed; the Judge Advisor sees every
 * nomination and decides the winners (see ./winners). Winners are secret
 * until the ceremony, so a judge's reply has no `winners` key at all, and
 * nothing here is ever part of /api/state.
 *
 *   judge  reads their own panel's nominations; nominates and withdraws
 *          their own, for completed, non-conflicted teams on their panel
 *   admin  reads every nomination and every winner; nominates any team in
 *          any division for any award (no interview, no panel: role "admin"),
 *          and removes any nomination by id, a judge's included
 *   anyone else is refused
 *
 * The Judge Advisor's own nominations never reach a judge: they have no panel,
 * and a judge is only ever sent rows with theirs.
 */
export async function GET() {
  const session = await getSession();
  if (!canReadNotes(session)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const db = store();
  const nominations = await db.listNominations();
  const noStore = { headers: { "Cache-Control": "no-store" } };

  if (session?.role === "admin") {
    const winners = await db.listWinners();
    return NextResponse.json({ awards: awards(), nominations, winners }, noStore);
  }

  // A judge gets their own panel's nominations, minus any team the panel has
  // since been barred from: the same wall the notes use. Winners are never read,
  // and neither is anything the Judge Advisor added.
  const judge = session as Extract<Session, { role: "judge" }>;
  const barred = blockedTeams(await loadBlocks(), judge.panelId);
  return NextResponse.json(
    {
      awards: awards(),
      nominations: nominations.filter((n) => n.role === "judge" && n.panel_id === judge.panelId && !barred.has(n.team_id)),
    },
    noStore,
  );
}

/**
 * Nominate a team for an award, or change the reason. Asking again is harmless.
 * A judge's team must be one they interviewed; the Judge Advisor's is any team.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (session?.role !== "judge" && session?.role !== "admin") {
    return NextResponse.json({ error: "Only a judge or the Judge Advisor can nominate a team for an award." }, { status: 403 });
  }

  const body = await fields(request);
  const awardId = String(body.awardId ?? "");
  const teamId = String(body.teamId ?? "");
  if (!awardId || !teamId) {
    return NextResponse.json({ error: "An award and a team are required." }, { status: 400 });
  }

  const db = store();
  const team = (await db.listTeams()).find((t) => t.id === teamId);
  if (!team) {
    return NextResponse.json({ error: "That team no longer exists." }, { status: 404 });
  }
  const judge = session.role === "judge" ? session : null;
  if (judge) {
    // Scope before anything else, as the notes do: a judge who may not touch
    // this team is told that, not how to format their request. Conflict first,
    // because declaring one takes the team off the panel and the panel check
    // would otherwise answer with the vaguer message.
    if (await isConflicted(judge, teamId)) {
      return NextResponse.json({ error: CONFLICT_MESSAGE }, { status: 403 });
    }
    if (!mayActOnPanel(judge, team.panel_id)) {
      return NextResponse.json({ error: "That team is not assigned to your judge panel." }, { status: 403 });
    }
    if (!completedTeamIds(await db.listRequests()).has(teamId)) {
      return NextResponse.json(
        { error: `Team ${team.number} has not finished an interview yet. Nominate it once you have met it.` },
        { status: 409 },
      );
    }
  }
  const award = awards().find((a) => a.id === awardId);
  if (!award) {
    return NextResponse.json({ error: "That award does not exist." }, { status: 400 });
  }

  // Left out, the reason stays as it was (a chip tap sends none); an empty one clears it.
  const reason = body.reason === undefined ? undefined : String(body.reason ?? "").trim().slice(0, REASON_MAX) || null;
  const key = { awardId, teamId, judge: session.name };
  const before = (await db.listNominations()).find((n) =>
    judge ? isMine(n, { ...key, panelId: judge.panelId }) : isTheJudgeAdvisors(n, key),
  );

  let nomination: NominationRow;
  try {
    nomination = judge
      ? await db.nominate({ ...key, panelId: judge.panelId, reason })
      : await db.nominateAsAdmin({ ...key, reason });
  } catch (e) {
    if (e instanceof StoreError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  // Only a write is logged: a repeat tap changes nothing.
  const by = judge ? "" : " (Judge Advisor)";
  const action = !before
    ? `nominated ${team.number} for ${award.label}${by}`
    : reason !== undefined && reason !== before.reason
      ? `changed the reason for ${team.number}'s ${award.label} nomination${by}`
      : null;
  if (action) await db.logActivity({ teamId, kind: "award", ...actorParts(session), action });

  return NextResponse.json({ nomination });
}

/**
 * A judge withdraws their own nomination, named by award and team: nobody
 * else's can be touched that way. The Judge Advisor removes any nomination,
 * a judge's included, by its id.
 */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (session?.role !== "judge" && session?.role !== "admin") {
    return NextResponse.json({ error: "Only a judge or the Judge Advisor can remove a nomination." }, { status: 403 });
  }

  const body = await fields(request);
  const db = store();

  if (session.role === "admin") {
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "A nomination id is required." }, { status: 400 });
    // Looked up first: it names the row in the log, and an id that matches
    // nothing is a 404 here, never a database error on a malformed uuid.
    const row = (await db.listNominations()).find((n) => n.id === id);
    if (!row || !(await db.removeNomination(id))) {
      return NextResponse.json({ error: "That nomination is already gone." }, { status: 404 });
    }
    const team = (await db.listTeams()).find((t) => t.id === row.team_id);
    await db.logActivity({
      teamId: row.team_id,
      kind: "award",
      ...actorParts(session),
      action: `removed ${row.role === "admin" ? "the Judge Advisor's" : `${row.judge}'s`} ${awardLabel(row.award_id)} nomination for ${team?.number ?? "a team"}`,
    });
    return NextResponse.json({ ok: true, removed: true });
  }

  const awardId = String(body.awardId ?? "");
  const teamId = String(body.teamId ?? "");
  if (!awardId || !teamId) {
    return NextResponse.json({ error: "An award and a team are required." }, { status: 400 });
  }

  // Looked up rather than passed straight through: an id that matches nothing
  // is "nothing to withdraw", not a database error.
  const key = { awardId, teamId, panelId: session.panelId, judge: session.name };
  if (!(await db.listNominations()).some((n) => isMine(n, key))) {
    return NextResponse.json({ ok: true, removed: false });
  }

  const removed = await db.withdrawNomination(key);
  if (removed) {
    const team = (await db.listTeams()).find((t) => t.id === teamId);
    await db.logActivity({
      teamId,
      kind: "award",
      ...actorParts(session),
      action: `withdrew ${team?.number ?? "a team"} from ${awardLabel(awardId)}`,
    });
  }
  return NextResponse.json({ ok: true, removed });
}

// The judge is matched as the roster matches a name (trimmed, any case), so
// signing in as "dana" is the same judge as "Dana". The row keeps the spelling it was made with.
const isMine = (n: NominationRow, k: { awardId: string; teamId: string; panelId: string; judge: string }) =>
  n.role === "judge" &&
  n.award_id === k.awardId &&
  n.team_id === k.teamId &&
  n.panel_id === k.panelId &&
  judgeKey(n.judge) === judgeKey(k.judge);

// The Judge Advisor's has no panel; their name is matched the same way.
const isTheJudgeAdvisors = (n: NominationRow, k: { awardId: string; teamId: string; judge: string }) =>
  n.role === "admin" && n.award_id === k.awardId && n.team_id === k.teamId && judgeKey(n.judge) === judgeKey(k.judge);
