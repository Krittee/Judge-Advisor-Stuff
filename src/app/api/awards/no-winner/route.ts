import { NextResponse } from "next/server";
import { actorParts } from "@/lib/activity";
import { canAdminister, getSession } from "@/lib/auth";
import { store } from "@/lib/db";
import { awards } from "@/lib/presets";
import { awardLabel, fields, refuseIfSent } from "../shared";

export const dynamic = "force-dynamic";

/**
 * "No winner": the Judge Advisor's call that an award in one division goes to
 * no team. Any award can be marked, even one with nominees. Marking an award a
 * team holds takes it off that team; giving a team a marked award takes the
 * mark off (see ../winners). Reading it is GET /api/awards, which only the
 * Judge Advisor gets it from.
 */
export async function PUT(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Only the Judge Advisor can decide an award." }, { status: 403 });
  }

  const body = await fields(request);
  const awardId = String(body.awardId ?? "");
  const division = String(body.division ?? "").trim();
  if (!awardId || !division) {
    return NextResponse.json({ error: "An award and a division are required." }, { status: 400 });
  }
  if (!awards().some((a) => a.id === awardId)) {
    return NextResponse.json({ error: "That award does not exist." }, { status: 400 });
  }
  const locked = await refuseIfSent(awardId, division);
  if (locked) return locked;

  const db = store();
  // Every team holding it: the Judges Award can have two.
  const holders = (await db.listWinners()).filter((w) => w.award_id === awardId && w.division === division);
  // Already marked and nobody holds it: nothing changes, so nothing is written or logged.
  const marked = (await db.listNoWinners()).find((n) => n.award_id === awardId && n.division === division);
  if (marked && !holders.length) return NextResponse.json({ noWinner: marked });

  if (holders.length) await db.clearWinner(awardId, division);
  const noWinner = await db.setNoWinner({ awardId, division, decidedBy: session!.name });
  const teams = await db.listTeams();
  const previous = holders.map((h) => teams.find((t) => t.id === h.team_id)?.number).filter(Boolean).join(" and ");
  await db.logActivity({
    teamId: holders[0]?.team_id ?? null,
    kind: "award",
    ...actorParts(session),
    action: `marked ${awardLabel(awardId)} no winner`,
    detail: previous ? `${division} · instead of ${previous}` : division,
  });
  return NextResponse.json({ noWinner });
}

/** Take the "No winner" mark off an award in one division. */
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
  const removed = await db.clearNoWinner(awardId, division);
  if (removed) {
    await db.logActivity({
      kind: "award",
      ...actorParts(session),
      action: `cleared No winner on ${awardLabel(awardId)}`,
      detail: division,
    });
  }
  return NextResponse.json({ ok: true, removed });
}
