import { NextResponse } from "next/server";
import { actorLabel, canAdminister, canFlag, canReadFlags, getSession } from "@/lib/auth";
import { store } from "@/lib/db";
import { isValidMatchType, matchTypes, resolveFlagKind } from "@/lib/presets";
import { isValidField, isValidMatchNumber, normalizeField, normalizeMatchNumber } from "@/lib/match";

export const dynamic = "force-dynamic";

/**
 * What referees saw on the field.
 *
 * Written by referees, read by the people who judge. Kept apart from
 * judging notes deliberately: a note is a judge's own record, a flag is
 * an official observation the judges read but never write. Letting a
 * judge raise one would turn it into an opinion.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!canReadFlags(session)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const teamId = new URL(request.url).searchParams.get("teamId") ?? undefined;
  const flags = await store().listFlags(teamId);

  // A judge sees flags on their own panel's teams only, the same wall
  // that applies to notes and scores.
  if (session?.role === "judge") {
    const mine = new Set(
      (await store().listTeams())
        .filter((t) => t.panel_id === session.panelId)
        .map((t) => t.id),
    );
    return NextResponse.json({ flags: flags.filter((f) => mine.has(f.team_id)) });
  }

  return NextResponse.json({ flags });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!canFlag(session)) {
    return NextResponse.json(
      { error: "Only a referee can record a flag." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const teamId = String(body.teamId ?? "");
  if (!teamId) {
    return NextResponse.json({ error: "Pick a team first." }, { status: 400 });
  }

  const team = (await store().listTeams()).find((t) => t.id === teamId);
  if (!team) {
    return NextResponse.json({ error: "That team no longer exists." }, { status: 404 });
  }

  // An unknown kind resolves to the least severe one, never the worst,
  // so a malformed request cannot invent a major violation.
  const kind = resolveFlagKind(body.kind);
  const text = String(body.body ?? "").trim().slice(0, 500);
  if (!text) {
    return NextResponse.json(
      { error: "Say what you saw — judges read this without you there to explain." },
      { status: 400 },
    );
  }

  // Match and field are what let a head referee trace a flag back to a
  // moment, so unlike the flag kind they are required and validated
  // outright rather than guessed at: recording a Qualification incident
  // as Practice because the request was malformed would be worse than
  // refusing it.
  const matchType = String(body.matchType ?? "").trim().toUpperCase();
  if (!isValidMatchType(matchType)) {
    return NextResponse.json(
      {
        error: `Pick which match this was — ${matchTypes()
          .map((t) => `${t.id} (${t.label})`)
          .join(", ")}.`,
      },
      { status: 400 },
    );
  }
  const matchNumber = normalizeMatchNumber(body.matchNumber);
  if (!isValidMatchNumber(matchNumber)) {
    return NextResponse.json({ error: "Enter the match number." }, { status: 400 });
  }
  const field = normalizeField(body.field);
  if (!isValidField(field)) {
    return NextResponse.json({ error: "Enter which field this was." }, { status: 400 });
  }

  const flag = await store().createFlag({
    teamId,
    kind,
    body: text,
    author: session!.name,
    matchType,
    matchNumber,
    field,
  });

  await store().logActivity({
    teamId,
    actor: actorLabel(session),
    action: `flagged ${kind}`,
    // No "Field" label here: the field value is free text and a referee
    // typing "Field 2" (the box's own placeholder) would otherwise read as
    // "Field Field 2". FlagList shows it the same bare way on screen.
    detail: `Team ${team.number} · ${matchType}${matchNumber} · ${field}`,
  });

  return NextResponse.json({ flag });
}

/**
 * Remove one. The Judge Advisor's alone: a referee who could delete their
 * own flag could quietly unsay it after a team complained, and the whole
 * point is that the record stands.
 */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json(
      { error: "Only the Judge Advisor can remove a flag." },
      { status: 403 },
    );
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required." }, { status: 400 });

  const removed = await store().removeFlag(id);
  return NextResponse.json({ ok: true, removed });
}
