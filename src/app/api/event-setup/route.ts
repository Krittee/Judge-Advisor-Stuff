import { NextResponse } from "next/server";
import { actorParts } from "@/lib/activity";
import { canAdminister, getSession } from "@/lib/auth";
import { store } from "@/lib/db";
import { divisionChoices, setupDivisions, setupLabel } from "@/lib/eventSetup";
import { presetPrograms } from "@/lib/presets";

export const dynamic = "force-dynamic";

/**
 * Set the program and format (Standard or Blended) the whole event runs
 * under. Judge Advisor only. Reading it needs no route -- it is part of
 * /api/state.
 *
 * It is the key every award is decided under, so it cannot change once any
 * award has a decision: clear the awards first. Nor while a team or panel
 * sits in a division the new program does not run. Each save is logged to
 * Activity with what it replaced.
 * ponytail: check-then-write is not atomic, as refuseIfSent; a decision landing between the checks and the save can slip through.
 */
export async function PUT(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Only the Judge Advisor can set up the event." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const program = String(body?.program ?? "");
  const format = body?.format;
  const programs = presetPrograms();
  if (!programs.some((p) => p.label === program)) {
    return NextResponse.json({ error: `Pick a program: ${programs.map((p) => p.label).join(" or ")}.` }, { status: 400 });
  }
  if (format !== "standard" && format !== "blended") {
    return NextResponse.json({ error: "Pick Standard or Blended." }, { status: 400 });
  }

  const db = store();
  const previous = await db.getEventSetup();
  if (previous?.program === program && previous.format === format) return NextResponse.json({ setup: previous });

  const [winners, noWinners, releases, teams, panels] = await Promise.all([
    db.listWinners(),
    db.listNoWinners(),
    db.listReleases(),
    db.listTeams(),
    db.listPanels(),
  ]);
  if (winners.length || noWinners.length || releases.some((r) => r.status === "sent")) {
    return NextResponse.json({ error: "Clear the awards first." }, { status: 409 });
  }

  const next = { program, format };
  const divisions = setupDivisions(next) ?? [];
  const panelOptions = divisionChoices(next, true).options;
  const outside = {
    teams: teams.filter((t) => !divisions.includes(t.division)).map((t) => ({ id: t.id, number: t.number, division: t.division })),
    panels: panels.filter((p) => !panelOptions.includes(p.division)).map((p) => ({ id: p.id, name: p.name, division: p.division })),
  };
  if (outside.teams.length || outside.panels.length) {
    return NextResponse.json({ error: `Move or remove the teams and panels outside ${program} first.`, outside }, { status: 409 });
  }

  const setup = await db.saveEventSetup({ program, format, setBy: session!.name });
  await db.logActivity({
    kind: "setup",
    ...actorParts(session),
    action: `Event setup: ${setupLabel(setup)}`,
    detail: previous ? `was ${setupLabel(previous)}` : null,
  });
  return NextResponse.json({ setup });
}
