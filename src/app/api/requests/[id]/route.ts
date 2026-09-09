import { NextResponse } from "next/server";
import { actorLabel, canAdvance, canCancel, getSession, mayActOnPanel } from "@/lib/auth";
import { store, StoreError } from "@/lib/db";
import { NEXT_STATUS, STATUS_META, type Status } from "@/lib/status";
import { CONFLICT_MESSAGE, isConflicted } from "@/lib/conflicts";
import type { RequestRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type Action = "advance" | "cancel" | "reopen" | "set-status" | "reassign";

/** Move a request along, cancel it, or hand it to a different panel. */
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
  if (action === "cancel") {
    if (!canCancel(session, current.status, current.created_by)) {
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
  // This is the scope check; the role checks above only decided whether
  // the action is available at all.
  // A conflict outranks everything: an affiliated panel may not move this
  // team's interview along, whoever assigned it to them. Checked first so
  // the judge is told the real reason rather than the vaguer one.
  if (await isConflicted(session, current.team_id)) {
    return NextResponse.json({ error: CONFLICT_MESSAGE }, { status: 403 });
  }

  // The queuer works across every panel, so this wall does not apply to
  // them -- and neither does it apply to a team with no session at all:
  // by the time execution reaches here the only action such a caller can
  // have gotten past the permission gate above with is "cancel" (see
  // canCancel), on the one request their own page is showing them. A
  // "panel" is not a concept a team is scoped to in the first place.
  if (session && session.role !== "queuer" && !mayActOnPanel(session, current.panel_id)) {
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

    // Divisions are a hard wall: a team may only be handed to a panel
    // judging its own division.
    const db = store();
    const [panels, teams] = await Promise.all([db.listPanels(), db.listTeams()]);
    const target = panels.find((p) => p.id === panelId);
    const team = teams.find((t) => t.id === current.team_id);

    if (!target) {
      return NextResponse.json({ error: "That panel no longer exists." }, { status: 404 });
    }
    const conflicts = await db.listConflicts();
    if (conflicts.some((c) => c.panel_id === panelId && c.team_id === current.team_id)) {
      return NextResponse.json(
        { error: `${target.name} has a declared conflict of interest with this team.` },
        { status: 409 },
      );
    }

    if (team && target.division !== team.division) {
      return NextResponse.json(
        {
          error:
            `Team ${team.number} is in ${team.division}, but ${target.name} judges ` +
            `${target.division}. Move the team's division first if that is what you meant.`,
        },
        { status: 409 },
      );
    }

    // The team's own panel_id is what every other view -- the judge
    // console's team list, /api/state's division scoping, auto-assign's
    // load counts -- actually reads to decide who owns this team.
    // Moving only the request would leave the two disagreeing: the
    // request says one panel, the team still says another, and the
    // judge this was reassigned to may not even see it. Reassigning a
    // request IS reassigning the team; keep them as one operation.
    if (team) await db.updateTeam(team.id, { panel_id: panelId });

    patch.panel_id = panelId;
    logLine = `reassigned to ${target.name}`;
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
    const updated = await store().updateRequest(id, patch);

    await store().logActivity({
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
