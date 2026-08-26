import { NextResponse } from "next/server";
import { actorLabel, canAdminister, canReadNotes, getSession } from "@/lib/auth";
import { store } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Conflicts of interest.
 *
 * A judge affiliated with a team must stay away from it entirely — no
 * interview, no notebook, no notes. Held against the panel rather than
 * the person, because a panel code is what judges sign in with and so the
 * panel is the only unit anything can be enforced against.
 *
 * Judges may declare one for their own panel; only the Judge Advisor can
 * withdraw one, so nobody can quietly clear a conflict they declared and
 * then judge the team anyway.
 */
export async function GET() {
  const session = await getSession();
  if (!canReadNotes(session)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const all = await store().listConflicts();
  return NextResponse.json({
    conflicts:
      session?.role === "judge" ? all.filter((c) => c.panel_id === session.panelId) : all,
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!canReadNotes(session)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const teamId = String(body.teamId ?? "");

  // A judge can only declare against their own panel; the Judge Advisor
  // can record one for any.
  const panelId =
    session?.role === "judge" ? session.panelId : String(body.panelId ?? "");

  if (!teamId || !panelId) {
    return NextResponse.json({ error: "A team and a panel are required." }, { status: 400 });
  }

  const db = store();
  const [teams, panels] = await Promise.all([db.listTeams(), db.listPanels()]);

  const team = teams.find((t) => t.id === teamId);
  const panel = panels.find((p) => p.id === panelId);
  if (!team || !panel) {
    return NextResponse.json({ error: "That team or panel no longer exists." }, { status: 404 });
  }

  const conflict = await db.addConflict({
    panelId,
    teamId,
    judgeName: String(body.judgeName ?? "").trim().slice(0, 80) || null,
    note: String(body.note ?? "").trim().slice(0, 280) || null,
    declaredBy: actorLabel(session),
  });

  // A conflicted panel cannot hold the team, so hand it back for
  // reassignment rather than leaving it sitting with judges who must not
  // interview it. Read the answer before the update: the file store hands
  // back the same object it stores, so team.panel_id is already null by
  // the time updateTeam returns.
  const wasHoldingIt = team.panel_id === panelId;
  if (wasHoldingIt) {
    await db.updateTeam(team.id, { panel_id: null });
  }

  await db.logActivity({
    teamId: team.id,
    actor: actorLabel(session),
    action: "declared a conflict of interest",
    detail: `Team ${team.number} · ${panel.name}`,
  });

  return NextResponse.json({ conflict, unassigned: wasHoldingIt });
}

/** Withdrawing a conflict is the Judge Advisor's call alone. */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json(
      { error: "Only the Judge Advisor can withdraw a conflict." },
      { status: 403 },
    );
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required." }, { status: 400 });

  const removed = await store().removeConflict(id);
  return NextResponse.json({ ok: true, removed });
}
