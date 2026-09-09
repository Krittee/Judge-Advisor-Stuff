import { NextResponse } from "next/server";
import { actorLabel, canAdminister, canFlag, canReadFlags, getSession } from "@/lib/auth";
import { store, StoreError } from "@/lib/db";
import { isValidMatchType, matchTypes, refereeFlags, resolveFlagKind } from "@/lib/presets";
import { isValidField, isValidMatchNumber, normalizeField, normalizeMatchNumber } from "@/lib/match";
import { isValidRuleId } from "@/lib/rules";
import type { FlagEdit } from "@/lib/db/types";

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

/**
 * Validate the fields a referee fills in for a flag — shared between
 * raising a new one and correcting one already on record, so the two
 * paths can never quietly drift apart on what counts as valid.
 *
 * The kind falls back to the least severe reading on garbage input; the
 * rest have no safe guess and are refused outright (see the comment on
 * matchType below).
 *
 * `requireRuleForSeverity` only applies to a brand-new flag (POST): a
 * Minor or Major violation must name a rule going forward. It is left
 * off for corrections (PATCH), so a Minor/Major flag recorded before
 * this feature existed — with no rule on file — can still be corrected
 * (a typo fixed, a match number corrected) without being forced to
 * invent a rule for it retroactively.
 */
function parseFlagFields(
  body: Record<string, unknown>,
  { requireRuleForSeverity = false }: { requireRuleForSeverity?: boolean } = {},
):
  | {
      ok: true;
      kind: string;
      text: string;
      matchType: string;
      matchNumber: string;
      field: string;
      rule: string | null;
    }
  | { ok: false; response: NextResponse } {
  const kind = resolveFlagKind(body.kind);
  const text = String(body.body ?? "").trim().slice(0, 500);
  if (!text) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Say what you saw — judges read this without you there to explain." },
        { status: 400 },
      ),
    };
  }

  // Match and field are what let a head referee trace a flag back to a
  // moment, so unlike the flag kind they are required and validated
  // outright rather than guessed at: recording a Qualification incident
  // as Practice because the request was malformed would be worse than
  // refusing it.
  const matchType = String(body.matchType ?? "").trim().toUpperCase();
  if (!isValidMatchType(matchType)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Pick which match this was — ${matchTypes()
            .map((t) => `${t.id} (${t.label})`)
            .join(", ")}.`,
        },
        { status: 400 },
      ),
    };
  }
  const matchNumber = normalizeMatchNumber(body.matchNumber);
  if (!isValidMatchNumber(matchNumber)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Enter the match number." }, { status: 400 }),
    };
  }
  const field = normalizeField(body.field);
  if (!isValidField(field)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Enter which field this was." }, { status: 400 }),
    };
  }

  // Which Quick Reference rule this was against. A garbage value is
  // refused rather than silently dropped -- the referee picked from a
  // known list, so anything else means the request was malformed.
  const rawRule = String(body.rule ?? "").trim().toUpperCase();
  if (rawRule && !isValidRuleId(rawRule)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "That's not a recognised rule." }, { status: 400 }),
    };
  }
  const rule = rawRule || null;

  if (requireRuleForSeverity && !rule) {
    const kindMeta = refereeFlags().find((k) => k.id === kind);
    if (kindMeta?.requiresRule) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: `Pick which rule was violated — required for ${kindMeta.label}.` },
          { status: 400 },
        ),
      };
    }
  }

  return { ok: true, kind, text, matchType, matchNumber, field, rule };
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

  const parsed = parseFlagFields(body, { requireRuleForSeverity: true });
  if (!parsed.ok) return parsed.response;
  const { kind, text, matchType, matchNumber, field, rule } = parsed;

  const flag = await store().createFlag({
    teamId,
    kind,
    body: text,
    author: session!.name,
    matchType,
    matchNumber,
    field,
    rule,
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
 * Correct a flag already on record — the wrong severity tapped, a
 * mis-typed match number. Open to referees and the Judge Advisor, unlike
 * removal, because this does not make the incident disappear: it stays on
 * the board, just described more accurately, and the correction itself is
 * logged to Activity so nothing about it happens quietly.
 *
 * Team and author are not editable here. Reassigning a flag to a
 * different team, or rewriting who raised it, is a bigger mistake than
 * this is meant to fix — that goes through the Judge Advisor deleting and
 * refiling it.
 */
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!canFlag(session) && !canAdminister(session)) {
    return NextResponse.json(
      { error: "Only a referee or the Judge Advisor can correct a flag." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) {
    return NextResponse.json({ error: "id required." }, { status: 400 });
  }

  const existing = (await store().listFlags()).find((f) => f.id === id);
  if (!existing) {
    return NextResponse.json({ error: "That flag no longer exists." }, { status: 404 });
  }
  // Read before updateFlag runs, not after: the file store hands back the
  // very object it stores, so existing.kind would already read as the NEW
  // value by the time we get here otherwise — the same trap the conflicts
  // route was written around.
  const teamId = existing.team_id;
  const previousKind = existing.kind;

  const parsed = parseFlagFields(body);
  if (!parsed.ok) return parsed.response;
  const { kind, text, matchType, matchNumber, field, rule } = parsed;

  const edit: FlagEdit = { kind, body: text, matchType, matchNumber, field, rule };
  let flag;
  try {
    flag = await store().updateFlag(id, edit);
  } catch (e) {
    if (e instanceof StoreError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const team = (await store().listTeams()).find((t) => t.id === teamId);
  const changedKind = previousKind !== kind;
  await store().logActivity({
    teamId,
    actor: actorLabel(session),
    action: changedKind ? `corrected a flag: ${previousKind} → ${kind}` : "corrected a flag",
    detail: `Team ${team?.number ?? "?"} · ${matchType}${matchNumber} · ${field}`,
  });

  return NextResponse.json({ flag });
}

/**
 * Remove one. The Judge Advisor's alone: making the incident disappear
 * entirely is a different, larger power than correcting how it reads —
 * a referee who could delete their own flag could quietly unsay it after
 * a team complained, and the whole point is that the record stands.
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
