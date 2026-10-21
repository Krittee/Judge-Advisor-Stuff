import { NextResponse } from "next/server";
import { actorParts } from "@/lib/activity";
import { canAdminister, getSession } from "@/lib/auth";
import { store, StoreError } from "@/lib/db";
import { takeOffPanel, teamsToTakeOff } from "@/lib/conflicts";
import { judgeKey } from "@/lib/roster";
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
    await logSetup(session, "added a panel", `${panel.name} · ${panel.division}`);
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
    const db = store();
    const was = (await db.listPanels()).find((p) => p.id === id);

    /* The judges field is the roster's now: each name is found or added and
       put on this panel, and anyone else on it is taken off. A judge with a
       conflict who joins a panel that holds the team takes it off, so that
       is worked out first and `dryRun` reports it without writing. */
    let takeOff: Awaited<ReturnType<typeof teamsToTakeOff>> = [];
    let roster: Awaited<ReturnType<typeof db.listJudges>> = [];
    if (patch.judges || body.dryRun === true) {
      if (!was) {
        return NextResponse.json({ error: "That panel no longer exists." }, { status: 404 });
      }
      roster = await db.listJudges();
      if (patch.judges) {
        const wanted = new Set(patch.judges.map(judgeKey));
        takeOff = await teamsToTakeOff(
          id,
          roster.map((j) =>
            wanted.has(judgeKey(j.name))
              ? { ...j, panel_id: id }
              : j.panel_id === id
                ? { ...j, panel_id: null }
                : j,
          ),
        );
      }
      if (body.dryRun === true) {
        return NextResponse.json({ takenOff: takeOff.map((t) => t.number), dryRun: true });
      }
    }

    const before = roster;
    const panel = await db.updatePanel(id, patch);
    if (patch.judges) {
      await takeOffPanel(takeOff);
      await logJudgeChanges(session, panel, before, patch.judges, takeOff.map((t) => t.number));
    }
    // The judges field is the roster's and logged above; this is the panel's own settings.
    const changed = (Object.keys(patch) as (keyof Panel)[]).filter(
      (k) => k !== "judges" && String(was?.[k]) !== String(panel[k]),
    );
    if (changed.length) {
      await logSetup(session, "edited a panel", `${panel.name} · ${changed.map((k) => k.replace(/_/g, " ")).join(", ")}`);
    }
    return NextResponse.json({ panel, takenOff: takeOff.map((t) => t.number) });
  } catch (e) {
    if (e instanceof StoreError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}

/** Who joined, was added to, or left this panel through its judges field -- the roster's activity, one line each. */
async function logJudgeChanges(
  session: Awaited<ReturnType<typeof getSession>>,
  panel: Panel,
  before: { name: string; panel_id: string | null }[],
  names: string[],
  takenOff: string[],
) {
  const wanted = new Set(names.map(judgeKey));
  const known = new Map(before.map((j) => [judgeKey(j.name), j]));
  const log = (action: string, detail: string) => logSetup(session, action, detail);

  for (const name of names) {
    const was = known.get(judgeKey(name));
    if (!was) await log("added a judge", `${name} · ${panel.name}`);
    else if (was.panel_id !== panel.id) await log("moved a judge", `${was.name} → ${panel.name}`);
  }
  for (const j of before) {
    if (j.panel_id === panel.id && !wanted.has(judgeKey(j.name))) {
      await log("moved a judge", `${j.name} off ${panel.name}`);
    }
  }
  if (takenOff.length) await log("took teams off a panel", `${panel.name} · ${takenOff.join(", ")}`);
}

function logSetup(session: Awaited<ReturnType<typeof getSession>>, action: string, detail: string) {
  return store().logActivity({ kind: "setup", ...actorParts(session), action, detail });
}

/** Create any preset panel from config/event.json that does not exist yet. */
export async function PUT() {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
  }

  const created = await store().seedPresetPanels();
  if (created) await logSetup(session, "added preset panels", `${created} added`);
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
    if (deleted) await logSetup(session, "deleted all panels", `${deleted} ${deleted === 1 ? "panel" : "panels"}`);
    return NextResponse.json({ ok: true, deleted });
  }

  const id = params.get("id");
  if (!id) return NextResponse.json({ error: "id required." }, { status: 400 });

  const gone = (await store().listPanels()).find((p) => p.id === id);
  await store().deletePanel(id);
  if (gone) await logSetup(session, "deleted a panel", gone.name);
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
