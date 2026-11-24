import { NextResponse } from "next/server";
import { actorParts } from "@/lib/activity";
import { getSession, mayActOnPanel, type Session } from "@/lib/auth";
import { store, StoreError } from "@/lib/db";
import { CONFLICT_MESSAGE, isConflicted } from "@/lib/conflicts";
import { judgeKey } from "@/lib/roster";
import type { ReviewMark } from "@/lib/types";
import { fields } from "../awards/shared";

export const dynamic = "force-dynamic";

/** The longest reason a mark can carry: one line. */
const REASON_MAX = 140;

/**
 * The review mark: "have a look at this team", one per team, optional reason.
 *
 *   judge  marks a team on their own panel (never one they have a conflict
 *          with), and edits or clears only a mark they set themselves
 *   admin  marks, edits and clears any team's mark; whoever saves is `set_by`
 *   anyone else, or signed out, is refused
 *
 * Reads are /api/state's `reviewMarks`: there is no GET here.
 */
export async function PUT(request: Request) {
  const session = await getSession();
  if (session?.role !== "judge" && session?.role !== "admin") return refuse();

  const body = await fields(request);
  const teamId = String(body.teamId ?? "");
  const reason = body.reason == null ? "" : typeof body.reason === "string" ? body.reason.trim() : null;
  if (!teamId) return NextResponse.json({ error: "A team is required." }, { status: 400 });
  if (reason === null || reason.length > REASON_MAX) {
    return NextResponse.json({ error: `A reason is at most ${REASON_MAX} characters.` }, { status: 400 });
  }

  const db = store();
  const scoped = await refuseIfOutOfScope(session, teamId);
  if (scoped) return scoped;
  const team = (await db.listTeams()).find((t) => t.id === teamId)!;
  const before = (await db.listReviewMarks()).find((m) => m.team_id === teamId);
  if (before && !mayChange(session, before)) return refuseOthers();

  let mark: ReviewMark;
  try {
    mark = await db.setReviewMark({ teamId, reason: reason || null, setBy: session.name, setByRole: session.role });
  } catch (e) {
    if (e instanceof StoreError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  // Only a change is logged: saving the same reason again writes nothing worth a line.
  const by = session.role === "admin" ? " (Judge Advisor)" : "";
  const action = !before
    ? `marked ${team.number} for review${by}`
    : before.reason !== mark.reason
      ? `changed the review mark on ${team.number}${by}`
      : null;
  if (action) await db.logActivity({ teamId, kind: "setup", ...actorParts(session), action, detail: mark.reason });

  return NextResponse.json({ mark });
}

/** Clear a team's mark: `{ teamId }` (or `?teamId=`). Nothing to clear is still `{ removed: false }`. */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (session?.role !== "judge" && session?.role !== "admin") return refuse();

  const teamId = String((await fields(request)).teamId ?? "");
  if (!teamId) return NextResponse.json({ error: "A team is required." }, { status: 400 });

  const db = store();
  const scoped = await refuseIfOutOfScope(session, teamId);
  if (scoped) return scoped;
  const team = (await db.listTeams()).find((t) => t.id === teamId)!;
  const before = (await db.listReviewMarks()).find((m) => m.team_id === teamId);
  if (before && !mayChange(session, before)) return refuseOthers();

  const removed = before ? await db.clearReviewMark(teamId) : false;
  if (removed) {
    await db.logActivity({
      teamId,
      kind: "setup",
      ...actorParts(session),
      action: `cleared the review mark on ${team.number}${session.role === "admin" ? " (Judge Advisor)" : ""}`,
    });
  }
  return NextResponse.json({ ok: true, removed });
}

const refuse = () =>
  NextResponse.json({ error: "Only a judge or the Judge Advisor can mark a team for review." }, { status: 403 });
const refuseOthers = () =>
  NextResponse.json({ error: "That mark was set by someone else. Only they or the Judge Advisor can change it." }, { status: 403 });

/** The Judge Advisor changes any mark; a judge only their own, matched by name as nominations are. */
const mayChange = (session: Extract<Session, { role: "judge" | "admin" }>, mark: ReviewMark) =>
  session.role === "admin" || (mark.set_by_role === "judge" && judgeKey(mark.set_by) === judgeKey(session.name));

/** 404 for an unknown team; for a judge, 403 for a conflicted team or another panel's (conflict first, as notes do). */
async function refuseIfOutOfScope(session: Session, teamId: string): Promise<NextResponse | null> {
  const team = (await store().listTeams()).find((t) => t.id === teamId);
  if (!team) return NextResponse.json({ error: "That team no longer exists." }, { status: 404 });
  if (await isConflicted(session, teamId)) return NextResponse.json({ error: CONFLICT_MESSAGE }, { status: 403 });
  if (!mayActOnPanel(session, team.panel_id)) {
    return NextResponse.json({ error: "That team is not assigned to your judge panel." }, { status: 403 });
  }
  return null;
}
