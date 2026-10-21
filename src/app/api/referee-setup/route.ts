import { NextResponse } from "next/server";
import { actorParts } from "@/lib/activity";
import { canSetUpRefereeing, getSession } from "@/lib/auth";
import { store } from "@/lib/db";
import { parseRefereeSetup } from "@/lib/flagValidation";
import { getRuleset } from "@/lib/rules";
import type { RefereeSetup } from "@/lib/types";

export const dynamic = "force-dynamic";

/** "V5RC, 3 fields" -- how the Activity log reads a setup. */
function describe(setup: RefereeSetup): string {
  const n = setup.field_count;
  return `${getRuleset(setup.ruleset).program}, ${n} ${n === 1 ? "field" : "fields"}`;
}

/**
 * Set the program and number of fields every referee works from at this
 * event. Done once (and again for another event or day), not per match or
 * per device, so a new flag takes its ruleset from here.
 *
 * Only the head referee (the referee who signed in with HEAD_REFEREE_CODE)
 * or the Judge Advisor may save it; every other referee works from it. Each
 * save is logged to Activity with what it replaced. Reading it needs no
 * route -- it is part of /api/state.
 */
export async function PUT(request: Request) {
  const session = await getSession();
  if (!canSetUpRefereeing(session)) {
    return NextResponse.json(
      { error: "Only the head referee or the Judge Advisor can set up refereeing." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = parseRefereeSetup(body ?? {});
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  // Read before saving, so the log can say what this replaced.
  const previous = await store().getRefereeSetup();
  const setup = await store().saveRefereeSetup({
    ruleset: parsed.ruleset,
    fieldCount: parsed.fieldCount,
    setBy: session!.name,
    setOn: parsed.today,
  });

  await store().logActivity({
    kind: "setup",
    ...actorParts(session),
    action: `Referee setup: ${describe(setup)}`,
    detail: previous ? `was ${describe(previous)}` : null,
  });

  return NextResponse.json({ setup });
}
