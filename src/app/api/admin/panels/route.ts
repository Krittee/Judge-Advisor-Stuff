import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { canAdminister, getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Full panel rows including judge codes — Judge Advisor only. */
export async function GET() {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
  }

  const { data, error } = await db()
    .from("panels")
    .select("*")
    .order("sort_order")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ panels: data ?? [] });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: "Give the panel a name." }, { status: 400 });

  const code = String(body.code ?? "").trim().toUpperCase() || randomCode();

  const { data, error } = await db()
    .from("panels")
    .insert({
      name,
      code,
      room: String(body.room ?? "").trim().slice(0, 60) || null,
      judges: parseJudges(body.judges),
      sort_order: Number(body.sortOrder) || 0,
      slot_minutes: Math.max(3, Math.min(120, Number(body.slotMinutes) || 12)),
      slot_count: Math.max(0, Math.min(60, Number(body.slotCount) || 0)),
      slot_start_at: body.slotStartAt ? new Date(String(body.slotStartAt)).toISOString() : null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "That panel code is already in use." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ panel: data });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required." }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if ("name" in body) patch.name = String(body.name).trim().slice(0, 80);
  if ("code" in body) patch.code = String(body.code).trim().toUpperCase();
  if ("room" in body) patch.room = String(body.room ?? "").trim().slice(0, 60) || null;
  if ("judges" in body) patch.judges = parseJudges(body.judges);
  if ("sortOrder" in body) patch.sort_order = Number(body.sortOrder) || 0;
  if ("slotMinutes" in body) {
    patch.slot_minutes = Math.max(3, Math.min(120, Number(body.slotMinutes) || 12));
  }
  if ("slotCount" in body) {
    patch.slot_count = Math.max(0, Math.min(60, Number(body.slotCount) || 0));
  }
  if ("slotStartAt" in body) {
    patch.slot_start_at = body.slotStartAt
      ? new Date(String(body.slotStartAt)).toISOString()
      : null;
  }

  const { data, error } = await db().from("panels").update(patch).eq("id", id).select().single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "That panel code is already in use." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ panel: data });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required." }, { status: 400 });

  // Teams and requests fall back to panel_id = null rather than vanishing.
  const { error } = await db().from("panels").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

function parseJudges(input: unknown): string[] {
  if (Array.isArray(input)) return input.map((j) => String(j).trim()).filter(Boolean).slice(0, 12);
  return String(input ?? "")
    .split(/[,\n]/)
    .map((j) => j.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function randomCode(): string {
  // No 0/O/1/I — these get read aloud across a noisy room.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () =>
    alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
}
