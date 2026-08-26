import { NextResponse } from "next/server";
import { canReadNotes, getSession, mayActOnPanel, type Session } from "@/lib/auth";
import { store } from "@/lib/db";
import { CONFLICT_MESSAGE, isConflicted } from "@/lib/conflicts";
import { bandFor, grandTotalMax, isValidPoint, rubricById, rubrics } from "@/lib/rubrics";
import type { ScoreRow, Team } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Rubric scores.
 *
 * Judges and the Judge Advisor only, and a judge only ever sees or
 * touches teams on their own panel — the same rule as judging notes, and
 * for the same reason: the rubric sheet itself says these materials do
 * not leave the judging room.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!canReadNotes(session)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const db = store();
  const teamId = new URL(request.url).searchParams.get("teamId") ?? undefined;

  if (teamId) {
    const denied = await refuseIfOutOfScope(session, teamId);
    if (denied) return denied;
    return NextResponse.json({
      scores: await db.listScores(teamId),
      rubrics: rubrics(),
    });
  }

  const [scores, teams] = await Promise.all([db.listScores(), db.listTeams()]);
  const visible =
    session?.role === "admin"
      ? scores
      : await (async () => {
          const judge = session as Extract<Session, { role: "judge" }>;
          const barred = new Set(
            (await db.listConflicts())
              .filter((c) => c.panel_id === judge.panelId)
              .map((c) => c.team_id),
          );
          return scores.filter((s) => {
            if (barred.has(s.team_id)) return false;
            const team = teams.find((t) => t.id === s.team_id);
            return team ? mayActOnPanel(session, team.panel_id) : false;
          });
        })();

  return NextResponse.json({
    scores: visible,
    rubrics: rubrics(),
    max: grandTotalMax(),
  });
}

/** Set or clear one criterion. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!canReadNotes(session)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const teamId = String(body.teamId ?? "");
  const rubricId = String(body.rubricId ?? "");
  const criterionId = String(body.criterionId ?? "");

  // Authorisation before validation: a judge with a conflict on this team has
  // no business learning the shape of its rubric, and the answer they get
  // should be the conflict, not a note about their payload.
  const denied = await refuseIfOutOfScope(session, teamId);
  if (denied) return denied;

  const rubric = rubricById(rubricId);
  if (!rubric) {
    return NextResponse.json({ error: "Unknown rubric." }, { status: 400 });
  }
  if (!rubric.criteria.some((c) => c.id === criterionId)) {
    return NextResponse.json({ error: "Unknown criterion." }, { status: 400 });
  }

  // null clears the row back to unscored; anything else must be on the scale.
  const value = body.value === null || body.value === undefined ? null : Number(body.value);
  if (value !== null && !isValidPoint(rubric, value)) {
    return NextResponse.json(
      { error: `That is not a score this rubric offers.` },
      { status: 400 },
    );
  }

  const team = await findTeam(teamId);
  const score = await store().saveScore({
    teamId,
    rubricId,
    criterionId,
    value,
    scoredBy: session!.name,
    panelId: team?.panel_id ?? null,
    // Only points the rubric still recognises count, so a criterion
    // removed from the config file stops inflating the total.
    totalOf: (values) =>
      rubric.criteria.reduce((sum, c) => sum + (Number(values[c.id]) || 0), 0),
  });

  return NextResponse.json({ score, band: bandOf(score, rubric.max) });
}

/** Clear one rubric for one team. Same scope rules as reading it. */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!canReadNotes(session)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const teamId = String(params.get("teamId") ?? "");
  const rubricId = String(params.get("rubricId") ?? "");

  const denied = await refuseIfOutOfScope(session, teamId);
  if (denied) return denied;

  if (!rubricById(rubricId)) {
    return NextResponse.json({ error: "Unknown rubric." }, { status: 400 });
  }

  const cleared = await store().clearScore(teamId, rubricId);
  return NextResponse.json({ ok: true, cleared });
}

function bandOf(score: ScoreRow, max: number) {
  return bandFor(score.total, max, Object.keys(score.values ?? {}).length > 0);
}

async function findTeam(teamId: string): Promise<Team | null> {
  return (await store().listTeams()).find((t) => t.id === teamId) ?? null;
}

/** 404 for an unknown team, 403 for another panel's. */
async function refuseIfOutOfScope(
  session: Session | null,
  teamId: string,
): Promise<NextResponse | null> {
  const team = await findTeam(teamId);
  if (!team) {
    return NextResponse.json({ error: "That team no longer exists." }, { status: 404 });
  }
  // Conflict first: it is the more specific reason, and once a conflict
  // is declared the team is unassigned from that panel — so the panel
  // check would otherwise answer with the vaguer message.
  if (await isConflicted(session, teamId)) {
    return NextResponse.json({ error: CONFLICT_MESSAGE }, { status: 403 });
  }
  if (!mayActOnPanel(session, team.panel_id)) {
    return NextResponse.json(
      { error: "That team is not assigned to your judge panel." },
      { status: 403 },
    );
  }
  return null;
}
