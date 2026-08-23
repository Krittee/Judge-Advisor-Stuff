import { NextResponse } from "next/server";
import { actorLabel, canAdvance, canCancel, getSession } from "@/lib/auth";
import { findRequest, logActivity, StoreError, updateRequest } from "@/lib/store";
import { NEXT_STATUS, STATUS_META, type Status } from "@/lib/status";
import type { RequestRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type Action = "advance" | "cancel" | "reopen" | "set-status" | "reassign";

/** Move a request along, cancel it, or hand it to a different panel. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await getSession();
  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "advance") as Action;

  const current = findRequest(id);
  if (!current) {
    return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });
  }

  // ---- permission gate -------------------------------------------------
  if (action === "cancel") {
    if (!canCancel(session, current.status)) {
      return NextResponse.json(
        { error: "You do not have permission to cancel this request." },
        { status: 403 },
      );
    }
  } else if (action === "reassign") {
    if (session?.role !== "admin") {
      return NextResponse.json(
        { error: "Only the Judge Advisor can reassign a request." },
        { status: 403 },
      );
    }
  } else if (!canAdvance(session)) {
    return NextResponse.json(
      { error: "Only judges and the Judge Advisor can update interview status." },
      { status: 403 },
    );
  }

  // A judge may only touch their own panel's work. Admin may touch anything.
  if (session?.role === "judge" && current.panel_id !== session.panelId) {
    return NextResponse.json(
      { error: "That request belongs to another judge panel." },
      { status: 403 },
    );
  }

  const now = new Date().toISOString();
  const actor = actorLabel(session);
  const patch: Partial<RequestRow> = {};
  let logLine: string = action;

  if (action === "reassign") {
    const panelId = String(body.panelId ?? "");
    if (!panelId) {
      return NextResponse.json({ error: "Pick a panel to move this to." }, { status: 400 });
    }
    patch.panel_id = panelId;
    logLine = "reassigned";
  } else if (action === "cancel") {
    patch.status = "cancelled";
    patch.cancelled_at = now;
    logLine = "cancelled";
  } else if (action === "reopen") {
    patch.status = "requested";
    patch.requested_at = now;
    patch.acknowledged_at = null;
    patch.started_at = null;
    patch.finished_at = null;
    patch.cancelled_at = null;
    logLine = "reopened";
  } else {
    const target: Status | undefined =
      action === "set-status"
        ? (String(body.status) as Status)
        : NEXT_STATUS[current.status as Status];

    if (!target || !STATUS_META[target]) {
      return NextResponse.json(
        { error: `Nothing to do — this request is already ${current.status}.` },
        { status: 400 },
      );
    }

    patch.status = target;
    if (target === "acknowledged") {
      patch.acknowledged_at = now;
      patch.acknowledged_by = session?.name ?? actor;
    }
    if (target === "interviewing") {
      patch.started_at = now;
      patch.interviewer = session?.name ?? actor;
      if (!current.acknowledged_at) patch.acknowledged_at = now;
    }
    if (target === "completed") {
      patch.finished_at = now;
      if (!current.started_at) patch.started_at = now;
      const outcome = String(body.outcome ?? "").trim().slice(0, 280);
      if (outcome) patch.outcome = outcome;
    }
    logLine = `→ ${STATUS_META[target].label}`;
  }

  try {
    const updated = updateRequest(id, patch);

    logActivity({
      requestId: id,
      teamId: current.team_id,
      actor,
      action: logLine,
      detail: body.detail ? String(body.detail).slice(0, 200) : null,
    });

    return NextResponse.json({ request: updated });
  } catch (e) {
    if (e instanceof StoreError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
