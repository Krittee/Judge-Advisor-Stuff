import { NextResponse } from "next/server";
import { canAdminister, getSession } from "@/lib/auth";
import { store, StoreError } from "@/lib/db";
import type { Panel } from "@/lib/types";
import { languages as configLanguages, presetDivisions } from "@/lib/presets";
import { normalizePanelCode } from "@/lib/panelCode";

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
      code: normalizePanelCode(body.code) || (await store().generatePanelCode()),
      division: resolveDivision(body.division),
      judges: parseJudges(body.judges),
      languages: parseLanguages(body.languages),
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
  if ("code" in body) patch.code = normalizePanelCode(body.code);
  if ("division" in body) patch.division = resolveDivision(body.division);
  if ("judges" in body) patch.judges = parseJudges(body.judges);
  if ("languages" in body) patch.languages = parseLanguages(body.languages);
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

/** Create any preset panel from config/event.json that does not exist yet. */
export async function PUT() {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
  }

  const created = await store().seedPresetPanels();
  return NextResponse.json({ created, panels: await store().listPanels() });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;

  // Teams and requests fall back to no panel rather than vanishing,
  // whether one panel goes or all of them do.
  if (params.get("all") === "true") {
    const deleted = await store().deleteAllPanels();
    return NextResponse.json({ ok: true, deleted });
  }

  const id = params.get("id");
  if (!id) return NextResponse.json({ error: "id required." }, { status: 400 });

  await store().deletePanel(id);
  return NextResponse.json({ ok: true, deleted: 1 });
}

/**
 * Fall back to the first configured division rather than accepting a
 * free-text one: a typo would strand the panel where no team can reach it.
 */
function resolveDivision(input: unknown): string {
  const wanted = String(input ?? "").trim();
  const divisions = presetDivisions();
  return divisions.includes(wanted) ? wanted : divisions[0];
}

/** Only languages the event actually runs, de-duplicated. */
function parseLanguages(input: unknown): string[] {
  const known = new Set(configLanguages().map((l) => l.id));
  const list = Array.isArray(input) ? input : String(input ?? "").split(/[,\s]+/);

  return [
    ...new Set(
      list
        .map((l) => String(l).trim().toLowerCase())
        .filter((l) => known.has(l)),
    ),
  ];
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
