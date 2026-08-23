import { NextResponse } from "next/server";
import { actorLabel, getSession } from "@/lib/auth";
import { store, StoreError } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Create a request. Open to everyone, including teams with no login —
 * that is the front door of the whole app.
 *
 * kind = 'queue' -> walk-up, goes straight to orange.
 * kind = 'slot'  -> books a future slot, sits at 'scheduled' until its time.
 */
export async function POST(request: Request) {
  const session = await getSession();
  const body = await request.json().catch(() => ({}));

  const teamNumber = Number(body.teamNumber);
  const kind = body.kind === "slot" ? "slot" : "queue";
  const message = String(body.message ?? "").trim().slice(0, 280) || null;

  if (!Number.isInteger(teamNumber)) {
    return NextResponse.json({ error: "Enter a valid team number." }, { status: 400 });
  }

  const team = await store().findTeamByNumber(teamNumber);
  if (!team) {
    return NextResponse.json(
      { error: `Team ${teamNumber} is not on the list. Check with the Judge Advisor.` },
      { status: 404 },
    );
  }
  if (!team.panel_id) {
    return NextResponse.json(
      { error: `Team ${teamNumber} has not been assigned to a judge panel yet.` },
      { status: 409 },
    );
  }

  let slotStart: string | null = null;
  let slotEnd: string | null = null;

  if (kind === "slot") {
    const start = new Date(String(body.slotStart ?? ""));
    const end = new Date(String(body.slotEnd ?? ""));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: "That time slot is not valid." }, { status: 400 });
    }
    slotStart = start.toISOString();
    slotEnd = end.toISOString();
  }

  try {
    const created = await store().createRequest({
      teamId: team.id,
      panelId: team.panel_id,
      kind,
      message,
      createdBy: session ? actorLabel(session) : "team",
      slotStart,
      slotEnd,
    });

    await store().logActivity({
      requestId: created.id,
      teamId: team.id,
      actor: session ? actorLabel(session) : "team",
      action: kind === "slot" ? "booked slot" : "joined queue",
      detail: `Team ${team.number}`,
    });

    return NextResponse.json({ request: created });
  } catch (e) {
    if (e instanceof StoreError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
