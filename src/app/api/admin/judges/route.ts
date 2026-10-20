import { NextResponse } from "next/server";
import { actorLabel, canAdminister, getSession } from "@/lib/auth";
import { store, StoreError } from "@/lib/db";
import { takeOffPanel, teamsToTakeOff } from "@/lib/conflicts";
import type { JudgePatch } from "@/lib/db/types";

export const dynamic = "force-dynamic";

/**
 * The judge roster -- Judge Advisor only.
 *
 * A panel's judges are the roster judges sitting on it, and a conflict
 * belongs to a judge, so moving a judge moves their blocks with them.
 * Putting a conflicted judge on a panel that already holds the team takes
 * the team off it (as declaring the conflict does), so PATCH reports
 * `takenOff` -- the numbers of those teams -- and takes `dryRun: true` to
 * report it without writing, for a screen that asks first.
 */
export async function GET() {
  if (!canAdminister(await getSession())) return refuse();
  return NextResponse.json({ judges: await store().listJudges() });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) return refuse();

  const body = await request.json().catch(() => ({}));
  try {
    const judge = await store().addJudge({
      name: cleanName(body.name),
      note: cleanNote(body.note),
    });
    await store().logActivity({
      actor: actorLabel(session),
      action: "added a judge",
      detail: judge.name,
    });
    return NextResponse.json({ judge });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) return refuse();

  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required." }, { status: 400 });

  try {
    const db = store();
    const [judges, panels] = await Promise.all([db.listJudges(), db.listPanels()]);
    const judge = judges.find((j) => j.id === id);
    if (!judge) {
      return NextResponse.json({ error: "That judge is no longer on the roster." }, { status: 404 });
    }

    const patch: JudgePatch = {};
    if ("name" in body) patch.name = cleanName(body.name);
    if ("note" in body) patch.note = cleanNote(body.note);
    if ("panelId" in body) patch.panel_id = body.panelId ? String(body.panelId) : null;

    const target = patch.panel_id ? panels.find((p) => p.id === patch.panel_id) : undefined;
    if (patch.panel_id && !target) {
      return NextResponse.json({ error: "That panel no longer exists." }, { status: 404 });
    }

    // Only a move onto a panel can bring a block to it.
    const joining = patch.panel_id && patch.panel_id !== judge.panel_id ? patch.panel_id : null;
    const takeOff = joining
      ? await teamsToTakeOff(
          joining,
          judges.map((j) => (j.id === id ? { ...j, panel_id: joining } : j)),
        )
      : [];
    const takenOff = takeOff.map((t) => t.number);

    if (body.dryRun === true) return NextResponse.json({ judge, takenOff, dryRun: true });

    const updated = await db.updateJudge(id, patch);
    if (joining) await takeOffPanel(joining, takeOff);

    const actor = actorLabel(session);
    if (updated.name !== judge.name) {
      await db.logActivity({
        actor,
        action: "renamed a judge",
        detail: `${judge.name} → ${updated.name}`,
      });
    }
    if (updated.panel_id !== judge.panel_id) {
      const nameOf = (panelId: string | null) => panels.find((p) => p.id === panelId)?.name;
      await db.logActivity({
        actor,
        action: "moved a judge",
        detail:
          (updated.panel_id
            ? `${updated.name} → ${nameOf(updated.panel_id)}`
            : `${updated.name} off ${nameOf(judge.panel_id) ?? "their panel"}`) +
          (takenOff.length ? ` · taken off the panel: ${takenOff.join(", ")}` : ""),
      });
    }

    return NextResponse.json({ judge: updated, takenOff });
  } catch (e) {
    return fail(e);
  }
}

/** Removing a judge removes their conflicts with them, so say so in the log. */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) return refuse();

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required." }, { status: 400 });

  const db = store();
  const [judges, conflicts] = await Promise.all([db.listJudges(), db.listConflicts()]);
  const judge = judges.find((j) => j.id === id);
  const conflictsRemoved = conflicts.filter((c) => c.judge_id === id).length;

  const removed = await db.removeJudge(id);
  if (removed && judge) {
    await db.logActivity({
      actor: actorLabel(session),
      action: "removed a judge",
      detail: conflictsRemoved
        ? `${judge.name} · ${conflictsRemoved} ${conflictsRemoved === 1 ? "conflict" : "conflicts"} withdrawn with them`
        : judge.name,
    });
  }
  return NextResponse.json({ ok: true, removed, conflictsRemoved: removed ? conflictsRemoved : 0 });
}

function refuse() {
  return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
}

function fail(e: unknown) {
  if (e instanceof StoreError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
}

/** A name is the roster's identity, so an empty one is refused rather than defaulted. */
function cleanName(input: unknown): string {
  const name = String(input ?? "").trim().slice(0, 80);
  if (!name) throw new StoreError("A judge needs a name.", 400);
  return name;
}

function cleanNote(input: unknown): string | null {
  return String(input ?? "").trim().slice(0, 280) || null;
}
