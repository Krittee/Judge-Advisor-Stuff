import { NextResponse } from "next/server";
import { canReadNotes, getSession } from "@/lib/auth";
import { store, StoreError } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Judge notes are private: judges and the Judge Advisor only. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!canReadNotes(session)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const teamId = new URL(request.url).searchParams.get("teamId") ?? undefined;
  return NextResponse.json({ notes: await store().listNotes(teamId) });
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

  const note = await store().createNote({
    teamId,
    requestId: body.requestId ? String(body.requestId) : null,
    panelId: session!.role === "judge" ? session!.panelId : (body.panelId ?? null),
    author: session!.name,
    body: text,
  });

  return NextResponse.json({ note });
}
