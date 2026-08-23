import { NextResponse } from "next/server";
import { canAdminister, getSession } from "@/lib/auth";
import { store, StoreError } from "@/lib/db";
import type { Panel } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Full panel rows including judge codes — Judge Advisor only. */
export async function GET() {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
  }

  return NextResponse.json({ panels: await store().listPanels() });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: "Give the panel a name." }, { status: 400 });

  try {
    const panel = await store().createPanel({
      name,
      code: String(body.code ?? "").trim().toUpperCase() || await store().generatePanelCode(),
      room: String(body.room ?? "").trim().slice(0, 60) || null,
      judges: parseJudges(body.judges),
      sort_order: Number(body.sortOrder) || 0,
      slot_minutes: clamp(body.slotMinutes, 3, 120, 12),
      slot_count: clamp(body.slotCount, 0, 60, 0),
      slot_start_at: body.slotStartAt ? new Date(String(body.slotStartAt)).toISOString() : null,
    });
    return NextResponse.json({ panel });
  } catch (e) {
    if (e instanceof StoreError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required." }, { status: 400 });

  const patch: Partial<Panel> = {};
  if ("name" in body) patch.name = String(body.name).trim().slice(0, 80);
  if ("code" in body) patch.code = String(body.code).trim().toUpperCase();
  if ("room" in body) patch.room = String(body.room ?? "").trim().slice(0, 60) || null;
  if ("judges" in body) patch.judges = parseJudges(body.judges);
  if ("sortOrder" in body) patch.sort_order = Number(body.sortOrder) || 0;
  if ("slotMinutes" in body) patch.slot_minutes = clamp(body.slotMinutes, 3, 120, 12);
  if ("slotCount" in body) patch.slot_count = clamp(body.slotCount, 0, 60, 0);
  if ("slotStartAt" in body) {
    patch.slot_start_at = body.slotStartAt
      ? new Date(String(body.slotStartAt)).toISOString()
      : null;
  }

  try {
    return NextResponse.json({ panel: await store().updatePanel(id, patch) });
  } catch (e) {
    if (e instanceof StoreError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required." }, { status: 400 });

  // Teams and requests fall back to no panel rather than vanishing.
  await store().deletePanel(id);
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

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return Math.max(min, Math.min(max, Number(value) || fallback));
}
