import { NextResponse } from "next/server";
import { actorParts } from "@/lib/activity";
import { canAdminister, canReadNotes, getSession, mayActOnPanel, type Session } from "@/lib/auth";
import { store } from "@/lib/db";
import { blockedTeams, CONFLICT_MESSAGE, isConflicted, loadBlocks } from "@/lib/conflicts";
import type { Note, Team } from "@/lib/types";

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
  const judge = session as Extract<Session, { role: "judge" }>;
  const barred = blockedTeams(await loadBlocks(), judge.panelId);
  const mine = new Set(
    (await db.listTeams())
      .filter((t) => t.panel_id === judge.panelId && !barred.has(t.id))
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

  if (!teamId) {
    return NextResponse.json({ error: "A team and some text are required." }, { status: 400 });
  }

  // Scope first: a judge who may not touch this team should be told that,
  // not handed notes on how to format their request.
  const denied = await refuseIfOutOfScope(session, teamId);
  if (denied) return denied;

  if (!text) {
    return NextResponse.json({ error: "A team and some text are required." }, { status: 400 });
  }

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

/**
 * Correct or restore a note: `{ id, body }` or `{ id, restore: true }`.
 *
 * Judges write notes but cannot rewrite them afterwards, so only the Judge
 * Advisor gets this; the Activity log keeps what was there before.
 */
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) return refuseToChange();

  const body = await request.json().catch(() => ({}));
  const found = await findNote(String(body.id ?? ""));
  if (!found) return noSuchNote();

  if (body.restore === true) {
    const note = await store().restoreNote(found.id);
    if (!note) return noSuchNote();
    await logChange(session, note, "restored", note.body);
    return NextResponse.json({ note });
  }

  const text = String(body.body ?? "").trim().slice(0, 4000);
  if (!text) return NextResponse.json({ error: "A note cannot be empty." }, { status: 400 });

  const was = found.body; // read now: the file store edits the stored row in place
  const note = await store().updateNote(found.id, text, session!.name);
  if (!note) return noSuchNote();
  await logChange(session, note, "edited", `Was: ${was}`);
  return NextResponse.json({ note });
}

/** Delete a note: `?id=`. It is only hidden, so PATCH with `restore` brings it back. */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) return refuseToChange();

  const found = await findNote(new URL(request.url).searchParams.get("id") ?? "");
  if (!found) return noSuchNote();
  const note = await store().deleteNote(found.id);
  if (!note) return noSuchNote();
  await logChange(session, note, "deleted", note.body);
  return NextResponse.json({ note });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The note with this id, deleted or not; anything that is not an id is simply not found. */
async function findNote(id: string): Promise<Note | null> {
  return UUID.test(id) ? store().getNote(id) : null;
}

const refuseToChange = () =>
  NextResponse.json({ error: "Only the Judge Advisor can change or delete a note." }, { status: 403 });
const noSuchNote = () => NextResponse.json({ error: "That note no longer exists." }, { status: 404 });

function logChange(session: Session | null, note: Note, verb: string, detail: string) {
  return store().logActivity({
    teamId: note.team_id,
    kind: "setup",
    ...actorParts(session),
    action: `${verb} a note by ${note.author}`,
    detail,
  });
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
