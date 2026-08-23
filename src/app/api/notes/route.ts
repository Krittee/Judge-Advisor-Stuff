import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { canReadNotes, getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Judge notes are private: judges and the Judge Advisor only. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!canReadNotes(session)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const teamId = new URL(request.url).searchParams.get("teamId");
  let query = db().from("notes").select("*").order("created_at", { ascending: false }).limit(400);
  if (teamId) query = query.eq("team_id", teamId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ notes: data ?? [] });
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

  const { data, error } = await db()
    .from("notes")
    .insert({
      team_id: teamId,
      request_id: body.requestId ? String(body.requestId) : null,
      panel_id: session?.role === "judge" ? session.panelId : (body.panelId ?? null),
      author: session!.name,
      body: text,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data });
}
