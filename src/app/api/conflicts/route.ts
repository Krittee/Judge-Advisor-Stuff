import { NextResponse } from "next/server";
import { actorLabel, canAdminister, canReadNotes, getSession } from "@/lib/auth";
import type { Session } from "@/lib/auth";
import { store } from "@/lib/db";
import { danglingSuffixes, parseTeamNumberList } from "@/lib/teamNumber";

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

  // Asking a panel "any conflicts?" comes back as a handful of team numbers
  // at once, so take them that way rather than making it one dialog each.
  if (typeof body.teamNumbers === "string" && body.teamNumbers.trim()) {
    return declareMany(session, panelId, body.teamNumbers, String(body.judgeName ?? "").trim().slice(0, 80) || null);
  }

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

/**
 * Record a whole panel's conflicts in one go.
 *
 * This is the Judge Advisor's actual workflow: ask each panel whether they
 * are affiliated with anyone, and get back a short list of team numbers.
 * Doing that a team at a time across six panels is where mistakes creep in.
 *
 * Every number is reported back under exactly one heading, so a typo cannot
 * pass as a recorded conflict.
 */
async function declareMany(
  session: Session | null,
  panelId: string,
  input: string,
  judgeName: string | null,
) {
  if (!panelId) {
    return NextResponse.json({ error: "Pick a judge panel first." }, { status: 400 });
  }

  const db = store();
  const [teams, panels, existing] = await Promise.all([
    db.listTeams(),
    db.listPanels(),
    db.listConflicts(),
  ]);

  const panel = panels.find((p) => p.id === panelId);
  if (!panel) {
    return NextResponse.json({ error: "That panel no longer exists." }, { status: 404 });
  }

  const numbers = parseTeamNumberList(input);
  if (!numbers.length) {
    return NextResponse.json({ error: "No team numbers found." }, { status: 400 });
  }

  // Refuse the whole list rather than record part of it: a stray space in
  // "9882 K" would otherwise conflict team 9882 and leave 9882K judgeable.
  const adrift = danglingSuffixes(input);
  if (adrift.length) {
    return NextResponse.json(
      {
        error:
          `"${adrift.join('", "')}" ${adrift.length === 1 ? "is" : "are"} not a team number. ` +
          `If you meant a letter suffix, write it with no space — 9882K, not 9882 K. ` +
          `Nothing was recorded.`,
      },
      { status: 400 },
    );
  }
  if (numbers.length > 200) {
    return NextResponse.json({ error: "That is too many at once." }, { status: 400 });
  }

  const byNumber = new Map(teams.map((t) => [t.number, t]));
  const already = new Set(
    existing.filter((c) => c.panel_id === panelId).map((c) => c.team_id),
  );

  const recorded: string[] = [];
  const unchanged: string[] = [];
  const notFound: string[] = [];
  const unassigned: string[] = [];

  for (const number of numbers) {
    const team = byNumber.get(number);
    if (!team) {
      notFound.push(number);
      continue;
    }
    if (already.has(team.id)) {
      unchanged.push(number);
      continue;
    }

    await db.addConflict({
      panelId,
      teamId: team.id,
      judgeName,
      note: null,
      declaredBy: actorLabel(session),
    });

    // Same rule as a single declaration: a conflicted panel cannot hold
    // the team, so hand it back for reassignment.
    if (team.panel_id === panelId) {
      await db.updateTeam(team.id, { panel_id: null });
      unassigned.push(number);
    }
    recorded.push(number);
  }

  if (recorded.length) {
    await db.logActivity({
      actor: actorLabel(session),
      action: "declared conflicts of interest",
      detail: `${panel.name} · ${recorded.join(", ")}`,
    });
  }

  return NextResponse.json({ recorded, unchanged, notFound, unassigned, panel: panel.name });
}
