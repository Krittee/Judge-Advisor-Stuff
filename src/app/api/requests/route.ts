import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { actorLabel, getSession } from "@/lib/auth";
import { logActivity } from "@/lib/data";

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

  const client = db();
  const { data: team } = await client
    .from("teams")
    .select("id, number, name, panel_id")
    .eq("number", teamNumber)
    .maybeSingle();

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

  const row: Record<string, unknown> = {
    team_id: team.id,
    panel_id: team.panel_id,
    kind,
    message,
    created_by: session ? actorLabel(session) : "team",
  };

  if (kind === "slot") {
    const start = new Date(String(body.slotStart ?? ""));
    const end = new Date(String(body.slotEnd ?? ""));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: "That time slot is not valid." }, { status: 400 });
    }
    row.status = "scheduled";
    row.slot_start = start.toISOString();
    row.slot_end = end.toISOString();
  } else {
    row.status = "requested";
  }

  const { data: created, error } = await client.from("requests").insert(row).select().single();

  if (error) {
    // Both of these come from the partial unique indexes in schema.sql.
    if (error.code === "23505") {
      const msg =
        kind === "slot"
          ? "Someone just took that slot. Pick another one."
          : `Team ${teamNumber} is already in the queue.`;
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logActivity({
    requestId: created.id,
    teamId: team.id,
    actor: session ? actorLabel(session) : "team",
    action: kind === "slot" ? "booked slot" : "joined queue",
    detail: `Team ${team.number}`,
  });

  return NextResponse.json({ request: created });
}
