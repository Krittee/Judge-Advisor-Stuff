import { NextResponse } from "next/server";
import { store } from "@/lib/db";
import { awards } from "@/lib/presets";
import { sentHolding, sentRelease } from "@/lib/releases";

/** The longest reason a judge can give for a nomination; longer is cut, as a note is. */
export const REASON_MAX = 500;

/**
 * A write's fields: the JSON body, over the query string. DELETE bodies are
 * legal but not every client sends one, and the other DELETE routes read the
 * query, so either works.
 */
export async function fields(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  return {
    ...Object.fromEntries(new URL(request.url).searchParams),
    ...(body && typeof body === "object" ? body : {}),
  };
}

/** An award's name for the log. An id the config no longer lists reads as itself. */
export const awardLabel = (id: string): string => awards().find((a) => a.id === id)?.label ?? id;

/**
 * The lock: a sent award cannot change until the Judge Advisor recalls it.
 * Null when it is free; else the 409 to return.
 * ponytail: check-then-write is not atomic, so a send landing between this and the write can slip through; a store-level guard if that ever matters.
 */
export async function refuseIfSent(awardId: string, division: string): Promise<NextResponse | null> {
  if (!sentRelease(await store().listReleases(), awardId, division)) return null;
  return NextResponse.json({ error: "Recall it from Marketing first." }, { status: 409 });
}

/** Why a team cannot be deleted or moved: it is in a sent award's snapshot. Null when it is free. A division change (`divisionChange`) is not held by a Whole event release. */
export async function teamLockMessage(teamId: string, divisionChange = false): Promise<string | null> {
  const held = sentHolding(await store().listReleases(), teamId, divisionChange);
  return held ? `Recall ${awardLabel(held.award_id)} from Marketing first.` : null;
}
