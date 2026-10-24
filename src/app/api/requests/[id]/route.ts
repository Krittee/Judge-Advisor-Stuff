import { NextResponse } from "next/server";
import { actorParts } from "@/lib/activity";
import { actorLabel, canAdvance, canCancel, getSession, mayActOnPanel } from "@/lib/auth";
import { store, StoreError, STALE_STATUS_MESSAGE } from "@/lib/db";
import { isRealSlot } from "@/lib/data";
import { canTransition, NEXT_STATUS, STATUS_META, type Status } from "@/lib/status";
import { CONFLICT_MESSAGE, isConflicted, isPanelBlocked, loadBlocks } from "@/lib/conflicts";
import { divisionsCompatible, resolveLanguage } from "@/lib/presets";
import type { RequestRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type Action =
  | "advance"
  | "cancel"
  | "reopen"
  | "set-status"
  | "reassign"
  | "reschedule"
  | "ready-now";

/**
 * Move a request along, cancel it, or hand it to a different panel.
 *
 * The body may carry `from`: the status the caller's screen was showing
 * when its button was pressed. A screen left open while someone else moved
 * the request is acting on a request that is no longer the one it drew, so
 * a `from` that no longer matches is refused (409) rather than applied.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await getSession();
  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "advance") as Action;

  const current = await store().findRequest(id);
  if (!current) {
    return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });
  }

  // ---- permission gate -------------------------------------------------
  if (action === "cancel" || action === "reschedule" || action === "ready-now") {
    // Moving a booking to a new time, or into the queue right now, is a
    // cancel-and-rebook that never leaves the slot empty in between -- so
    // each needs exactly the permission cancelling that same booking
    // already needs, no more.
    if (!canCancel(session, current.status)) {
      return NextResponse.json(
        {
          error:
            action === "reschedule"
              ? "You do not have permission to reschedule this booking."
              : action === "ready-now"
                ? "You do not have permission to move this booking into the queue."
                : "You do not have permission to cancel this request.",
        },
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
  } else if (action === "reopen" && session?.role !== "admin") {
    return NextResponse.json({ error: "Only the Judge Advisor can reopen a request." }, { status: 403 });
  } else if (!canAdvance(session)) {
    return NextResponse.json(
      { error: "Only judges and the Judge Advisor can update interview status." },
      { status: 403 },
    );
  }

  // A judge may only touch their own panel's work. Admin may touch anything.
  // This is the scope check; the role checks above only decided whether
  // the action is available at all.
  // A conflict outranks everything: an affiliated panel may not move this
  // team's interview along, whoever assigned it to them. Checked first so
  // the judge is told the real reason rather than the vaguer one.
  if (await isConflicted(session, current.team_id)) {
    return NextResponse.json({ error: CONFLICT_MESSAGE }, { status: 403 });
  }

  // The queuer works across every panel; judges stay on their own panel.
  if (session?.role !== "queuer" && !mayActOnPanel(session, current.panel_id)) {
    return NextResponse.json(
      { error: "That request belongs to another judge panel." },
      { status: 403 },
    );
  }

  // Stale screen: it drew this request in one status and it has since moved
  // on. Refused after the permission checks above so a caller who may not
  // touch the request is still told that, not just that it changed.
  if (body.from != null && String(body.from) !== current.status) {
    return NextResponse.json({ error: STALE_STATUS_MESSAGE }, { status: 409 });
  }

  // The transition table (status.ts): cancel only what is still open,
  // reopen only what is finished, ready-now only a booking.
  if (!canTransition(action, current.status)) {
    return NextResponse.json(
      {
        error: `A ${current.status} request can't be ${
          action === "reopen" ? "reopened" : action === "ready-now" ? "moved into the queue" : "cancelled"
        }.`,
      },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const actor = actorLabel(session);
  const patch: Partial<RequestRow> = {};
  let logLine: string = action;
  let targetPanelId: string | null = null;

  if (action === "reassign") {
    const panelId = String(body.panelId ?? "");
    if (!panelId) {
      return NextResponse.json({ error: "Pick a panel to move this to." }, { status: 400 });
    }

    // Divisions are a hard wall: a team may only be handed to a panel that
    // may judge its division (see divisionsCompatible).
    const db = store();
    const [panels, teams] = await Promise.all([db.listPanels(), db.listTeams()]);
    const target = panels.find((p) => p.id === panelId);
    const team = teams.find((t) => t.id === current.team_id);

    if (!target) {
      return NextResponse.json({ error: "That panel no longer exists." }, { status: 404 });
    }
    if (isPanelBlocked(await loadBlocks(), panelId, current.team_id)) {
      return NextResponse.json(
        { error: `${target.name} has a declared conflict of interest with this team.` },
        { status: 409 },
      );
    }

    // A blended team may be handed to any panel -- it competes across age
    // groups, so no single division's panel owns it.
    if (team && !divisionsCompatible(team.division, target.division)) {
      return NextResponse.json(
        {
          error:
            `Team ${team.number} is in ${team.division}, but ${target.name} judges ` +
            `${target.division}. Move the team's division first if that is what you meant.`,
        },
        { status: 409 },
      );
    }

    targetPanelId = panelId;
    logLine = `reassigned to ${target.name}`;
  } else if (action === "cancel") {
    patch.status = "cancelled";
    patch.cancelled_at = now;
    logLine = "cancelled";
  } else if (action === "ready-now") {
    // The booking becomes a walk-up request in place -- one write, so a
    // failure leaves the booking exactly as it was. (The page used to
    // cancel it and then create a new request, and a failure in between
    // lost the team its slot.) It stays a live row throughout, so the
    // one-live-request-per-team rule is never in play.
    patch.kind = "queue";
    patch.status = "requested";
    patch.slot_start = null;
    patch.slot_end = null;
    patch.requested_at = now;
    // What the team or desk filled in alongside the button, as a new
    // request would have carried it.
    if (body.language) patch.language = resolveLanguage(body.language);
    const message = String(body.message ?? "").trim().slice(0, 280);
    if (message) patch.message = message;
    logLine = "ready now";
  } else if (action === "reopen") {
    patch.status = "requested";
    patch.requested_at = now;
    patch.acknowledged_at = null;
    patch.started_at = null;
    patch.finished_at = null;
    patch.cancelled_at = null;
    logLine = "reopened";
  } else if (action === "reschedule") {
    // A booking, not yet acted on -- once judges have it, "reschedule"
    // is no longer the right tool (the desk would want set-status/reopen
    // to correct a mistake, not a new time for one that already ran).
    if (current.kind !== "slot") {
      return NextResponse.json(
        { error: "Only a booked slot can be rescheduled." },
        { status: 400 },
      );
    }
    if (current.status !== "scheduled") {
      return NextResponse.json(
        { error: "This booking is already underway and can no longer be rescheduled." },
        { status: 409 },
      );
    }

    const start = new Date(String(body.slotStart ?? ""));
    const end = new Date(String(body.slotEnd ?? ""));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: "That time slot is not valid." }, { status: 400 });
    }

    // Checked against the panel's current grid, exactly as a new booking
    // is in POST /api/requests -- a stale page must not move this to a
    // time the panel no longer offers.
    const panel = (await store().listPanels()).find((p) => p.id === current.panel_id);
    if (!panel) {
      return NextResponse.json({ error: "That panel no longer exists." }, { status: 404 });
    }
    if (!isRealSlot(panel, start, end)) {
      return NextResponse.json(
        {
          error:
            `That is not one of ${panel.name}'s slots — their times may have changed. ` +
            `Refresh and pick again.`,
        },
        { status: 409 },
      );
    }
    // A real slot can still be one that is over; a page left open since
    // the morning offers it, and so does anything posting straight here.
    if (end.getTime() <= Date.now()) {
      return NextResponse.json({ error: "That slot has already passed." }, { status: 409 });
    }

    // The 20-minute walking-gap check against every other live booking on
    // this panel (excluding this request's own current slot) happens
    // inside store().updateRequest itself -- the same check createRequest
    // runs for a brand new booking.
    patch.slot_start = start.toISOString();
    patch.slot_end = end.toISOString();
    logLine = `rescheduled to ${start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
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

    // set-status can otherwise name any enumerated value directly,
    // skipping stages or moving backward with no state machine behind
    // it at all. The Judge Advisor keeps that as a manual override for
    // correcting a mistake on the floor, the same final authority they
    // already have everywhere else in this app -- but a judge using
    // set-status is held to the exact transition `advance` would have
    // produced, so the two actions can never quietly diverge on what
    // counts as a legal next step.
    if (action === "set-status" && session?.role !== "admin" && target !== NEXT_STATUS[current.status as Status]) {
      return NextResponse.json(
        { error: `${current.status} cannot move directly to ${target}.` },
        { status: 400 },
      );
    }

    patch.status = target;
    if (target === "requested") {
      // Only the Judge Advisor's override gets here: a live request stepped
      // back to the queue. Drop the stale timestamps exactly as reopen does,
      // or the board would time the wait from when it was acknowledged.
      patch.acknowledged_at = null;
      patch.started_at = null;
      patch.finished_at = null;
      patch.cancelled_at = null;
    }
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
    // The admin override for cancelling a completed request (the table only
    // lets "cancel" take open ones) still has to say when it happened.
    if (target === "cancelled") patch.cancelled_at = now;
    logLine = `→ ${STATUS_META[target].label}`;
  }

  try {
    // Every decision above used this status; reassignment also checks the
    // panel, since two moves can leave the status unchanged.
    const updated = targetPanelId
      ? await store().reassignRequest(id, current.panel_id, targetPanelId, current.status)
      : await store().updateRequest(id, patch, current.status);

    await store().logActivity({
      requestId: id,
      teamId: current.team_id,
      kind: "request",
      ...actorParts(session),
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
