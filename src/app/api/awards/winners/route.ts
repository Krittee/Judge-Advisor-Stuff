import { NextResponse } from "next/server";
import { actorParts } from "@/lib/activity";
import { canAdminister, getSession } from "@/lib/auth";
import { goodConductTeams, SPORTSMANSHIP } from "@/lib/awards";
import { store, StoreError } from "@/lib/db";
import { awards } from "@/lib/presets";
import { awardLabel, fields } from "../shared";

export const dynamic = "force-dynamic";

/**
 * The winners: the Judge Advisor's call alone, one team per award per
 * division. Reading them is GET /api/awards, which only the Judge Advisor
 * gets them from.
 *
 * A winner is a nominee: a judge nominated the team, or, for Sportsmanship
 * only, referees flagged it for Good conduct enough times (src/lib/awards.ts).
 *
 * "Already has another award" is a caution for the UI to show, not a rule:
 * the Judge Advisor decides, so nothing here refuses on it.
 */
export async function PUT(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Only the Judge Advisor can decide an award." }, { status: 403 });
  }

  const body = await fields(request);
  const awardId = String(body.awardId ?? "");
  const division = String(body.division ?? "").trim();
  const teamId = String(body.teamId ?? "");
  if (!awardId || !division || !teamId) {
    return NextResponse.json({ error: "An award, a division and a team are required." }, { status: 400 });
  }

  const award = awards().find((a) => a.id === awardId);
  if (!award) {
    return NextResponse.json({ error: "That award does not exist." }, { status: 400 });
  }

  const db = store();
  const teams = await db.listTeams();
  const team = teams.find((t) => t.id === teamId);
  if (!team) {
    return NextResponse.json({ error: "That team no longer exists." }, { status: 404 });
  }
  if (team.division !== division) {
    return NextResponse.json(
      { error: `Team ${team.number} is in ${team.division}, not ${division}. Awards are decided division by division.` },
      { status: 400 },
    );
  }
  const nominated =
    (await db.listNominations()).some((n) => n.award_id === awardId && n.team_id === teamId) ||
    (awardId === SPORTSMANSHIP && goodConductTeams(await db.listFlags(teamId)).has(teamId));
  if (!nominated) {
    return NextResponse.json(
      { error: `Team ${team.number} has not been nominated for ${award.label}.` },
      { status: 409 },
    );
  }

  // Picking the team that already has it changes nothing, so it writes and logs nothing.
  const before = (await db.listWinners()).find((w) => w.award_id === awardId && w.division === division);
  if (before?.team_id === teamId) return NextResponse.json({ winner: before });

  try {
    const winner = await db.setWinner({ awardId, division, teamId, decidedBy: session!.name });
    const previous = before && teams.find((t) => t.id === before.team_id)?.number;
    await db.logActivity({
      teamId,
      kind: "award",
      ...actorParts(session),
      action: `gave ${award.label} to ${team.number}`,
      detail: previous ? `${division} · instead of ${previous}` : division,
    });
    return NextResponse.json({ winner });
  } catch (e) {
    if (e instanceof StoreError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** Take the winner back off an award in one division. */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Only the Judge Advisor can clear an award." }, { status: 403 });
  }

  const body = await fields(request);
  const awardId = String(body.awardId ?? "");
  const division = String(body.division ?? "").trim();
  if (!awardId || !division) {
    return NextResponse.json({ error: "An award and a division are required." }, { status: 400 });
  }

  const db = store();
  const before = (await db.listWinners()).find((w) => w.award_id === awardId && w.division === division);
  const removed = await db.clearWinner(awardId, division);
  if (removed && before) {
    const team = (await db.listTeams()).find((t) => t.id === before.team_id);
    await db.logActivity({
      teamId: before.team_id,
      kind: "award",
      ...actorParts(session),
      action: `cleared ${awardLabel(awardId)}`,
      detail: team ? `${division} · was ${team.number}` : division,
    });
  }
  return NextResponse.json({ ok: true, removed });
}
