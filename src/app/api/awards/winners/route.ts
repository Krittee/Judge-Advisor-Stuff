import { NextResponse } from "next/server";
import { actorParts } from "@/lib/activity";
import { canAdminister, getSession } from "@/lib/auth";
import { goodConductTeams, SPORTSMANSHIP } from "@/lib/awards";
import { store, StoreError } from "@/lib/db";
import { keyError, WHOLE_EVENT } from "@/lib/eventSetup";
import { awards } from "@/lib/presets";
import { awardLabel, fields, refuseIfSent } from "../shared";

export const dynamic = "force-dynamic";

/**
 * The winners: the Judge Advisor's call alone, one team per award per
 * division (the Judges Award has two: `winners` in config/event.json). Reading them is GET /api/awards, which only the Judge Advisor
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
  const setup = await db.getEventSetup();
  const wrongKey = keyError(award, division, setup);
  if (wrongKey) return NextResponse.json({ error: wrongKey }, { status: 400 });
  const locked = await refuseIfSent(awardId, division);
  if (locked) return locked;

  const teams = await db.listTeams();
  const team = teams.find((t) => t.id === teamId);
  if (!team) {
    return NextResponse.json({ error: "That team no longer exists." }, { status: 404 });
  }
  // A blended whole-event award takes any team in the event.
  if (team.division !== division && !(division === WHOLE_EVENT && setup?.format === "blended")) {
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
  const holders = (await db.listWinners()).filter((w) => w.award_id === awardId && w.division === division);
  const already = holders.find((w) => w.team_id === teamId);
  if (already) return NextResponse.json({ winner: already });

  // An award with several places fills up; a single-place award replaces its holder instead.
  if (award.places > 1 && holders.length >= award.places) {
    return NextResponse.json(
      { error: `${award.label} already has its ${award.places} winners in ${division}. Clear one first.` },
      { status: 409 },
    );
  }

  // A team given an award marked "No winner" takes the mark off it.
  const marked = (await db.listNoWinners()).some((n) => n.award_id === awardId && n.division === division);

  try {
    if (marked) await db.clearNoWinner(awardId, division);
    const winner = await db.setWinner({ awardId, division, teamId, decidedBy: session!.name, places: award.places });
    const before = award.places <= 1 ? holders[0] : undefined;
    const previous = before && teams.find((t) => t.id === before.team_id)?.number;
    await db.logActivity({
      teamId,
      kind: "award",
      ...actorParts(session),
      action: `gave ${award.label} to ${team.number}`,
      detail: previous ? `${division} · instead of ${previous}` : marked ? `${division} · instead of No winner` : division,
    });
    return NextResponse.json({ winner });
  } catch (e) {
    if (e instanceof StoreError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** Take the winner back off an award in one division; `teamId` clears just that team (the Judges Award has two), none clears them all. */
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
  const locked = await refuseIfSent(awardId, division);
  if (locked) return locked;

  const db = store();
  const teamId = String(body.teamId ?? "");
  const before = (await db.listWinners()).find(
    (w) => w.award_id === awardId && w.division === division && (!teamId || w.team_id === teamId),
  );
  const removed = await db.clearWinner(awardId, division, teamId || undefined);
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
