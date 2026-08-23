import { NextResponse } from "next/server";
import { canReadNotes, getSession, mayActOnPanel, type Session } from "@/lib/auth";
import { store } from "@/lib/db";
import type { Team } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Judging notes.
 *
 * Judges and the Judge Advisor only — and a judge only ever sees notes
 * for teams assigned to their own panel. Without that second check any
 * judge code would read every panel's notes, which is exactly the
 * separation this is supposed to provide.
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
    return NextResponse.json({ notes: await db.listNotes(teamId) });
  }

  const notes = await db.listNotes();
  if (session?.role === "admin") return NextResponse.json({ notes });

  // A judge asking for everything gets their own panel's teams only.
  const mine = new Set(
    (await db.listTeams())
      .filter((t) => t.panel_id === (session as Extract<Session, { role: "judge" }>).panelId)
      .map((t) => t.id),
  );
  return NextResponse.json({ notes: notes.filter((n) => mine.has(n.team_id)) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!canReadNotes(session)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const teamId = String(body.teamId ?? "");
  const text = String(body.body ?? "").trim().slice(0, 4000);

  if (!teamId || !text) {
    return NextResponse.json({ error: "A team and some text are required." }, { status: 400 });
  }

  const denied = await refuseIfOutOfScope(session, teamId);
  if (denied) return denied;

  const team = await findTeam(teamId);
  const note = await store().createNote({
    teamId,
    requestId: body.requestId ? String(body.requestId) : null,
    panelId: team?.panel_id ?? null,
    author: session!.name,
    body: text,
  });

  return NextResponse.json({ note });
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
  if (!mayActOnPanel(session, team.panel_id)) {
    return NextResponse.json(
      { error: "That team is not assigned to your judge panel." },
      { status: 403 },
    );
  }
  return null;
}
