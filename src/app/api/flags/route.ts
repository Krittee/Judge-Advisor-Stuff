import { NextResponse } from "next/server";
import {
  actorLabel,
  canAdminister,
  canFlag,
  canReadFlags,
  getSession,
  sameAuthor,
} from "@/lib/auth";
import { store, StoreError } from "@/lib/db";
import { parseFlagFields } from "@/lib/flagValidation";
import type { FlagEdit } from "@/lib/db/types";
import { fieldLabel, matchReference } from "@/lib/match";
import { getRuleset } from "@/lib/rules";

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

  // The event's setup decides the program a new flag is under and how many
  // fields there are to pick from. With none saved, parseFlagFields falls back.
  const setup = await store().getRefereeSetup();
  const parsed = parseFlagFields(body, {
    eventRuleset: setup?.ruleset,
    fieldCount: setup?.field_count,
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }
  const {
    kind,
    text,
    matchType,
    matchNumber,
    field,
    rule,
    ruleset,
    manualVersion,
    matchAffecting,
  } = parsed;

  const flag = await store().createFlag({
    teamId,
    kind,
    body: text,
    author: session!.name,
    matchType,
    matchNumber,
    field,
    rule,
    ruleset,
    manualVersion,
    matchAffecting,
  });

  await store().logActivity({
    teamId,
    actor: actorLabel(session),
    action: `flagged ${kind}`,
    detail: [
      `Team ${team.number}`,
      matchReference(matchType, matchNumber),
      fieldLabel(field),
    ]
      .filter(Boolean)
      .join(" · "),
  });

  return NextResponse.json({ flag });
}

/**
 * Correct a flag already on record — the wrong severity tapped, a
 * mis-typed match number. Open to the referee who raised it and the
 * Judge Advisor, unlike removal, because this does not make the
 * incident disappear: it stays on the board, just described more
 * accurately, and the correction itself is logged to Activity so
 * nothing about it happens quietly.
 *
 * A referee correcting a colleague's flag was previously accepted from
 * any referee session, not just the one who wrote it — the role check
 * below never compared against the flag's own `author`. The record's
 * author has always been fixed once a flag is created (see the note
 * below), so who is allowed to invoke this correction in the first
 * place should match that: the one name attached to the report, or the
 * Judge Advisor's standing authority to correct anything.
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

  // Case-insensitive and trimmed: the author is a hand-typed sign-in name,
  // and "dana" must still be able to correct the flag "Dana" raised. The
  // name is required at sign-in now (see POST /api/session), so this no
  // longer collapses every nameless referee into one "Referee" author.
  if (!canAdminister(session) && !sameAuthor(existing.author, session!.name)) {
    return NextResponse.json(
      { error: "Only the referee who raised this flag, or the Judge Advisor, can correct it." },
      { status: 403 },
    );
  }

  // Read before updateFlag runs, not after: the file store hands back the
  // very object it stores, so existing.kind would already read as the NEW
  // value by the time we get here otherwise — the same trap the conflicts
  // route was written around.
  const teamId = existing.team_id;
  const previousKind = existing.kind;
  // Every field a correction can change, as it reads now. Snapshotted for
  // the same reason as previousKind: by the time the log line is built,
  // `existing` may already be the new values.
  const before = {
    kind: previousKind,
    match: matchReference(existing.match_type, existing.match_number) ?? "",
    field: existing.field,
    body: existing.body,
    rules: existing.rule,
    // A flag recorded before rulesets existed is a VEX IQ one; reading it
    // as that keeps a correction from logging a phantom "none → viqrc".
    ruleset: getRuleset(existing.ruleset).id,
    "match affecting": existing.match_affecting ? "yes" : "no",
  };

  const parsed = parseFlagFields(body, {
    allowLegacyRulelessKind: existing.rule ? null : existing.kind,
    defaultRuleset: existing.ruleset,
    fieldCount: (await store().getRefereeSetup())?.field_count,
    existing,
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }
  const {
    kind,
    text,
    matchType,
    matchNumber,
    field,
    rule,
    ruleset,
    manualVersion,
    matchAffecting,
  } = parsed;

  const edit: FlagEdit = {
    kind,
    body: text,
    matchType,
    matchNumber,
    field,
    rule,
    ruleset,
    manualVersion,
    matchAffecting,
  };
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

  // Before → after for each field that actually changed. A correction can
  // rewrite what a referee reported (the severity, the rule cited, the
  // description), so the log has to say what it used to read -- the flag
  // itself no longer does.
  const after = {
    kind,
    match: matchReference(matchType, matchNumber) ?? "",
    field,
    body: text,
    rules: rule,
    ruleset,
    "match affecting": matchAffecting ? "yes" : "no",
  };
  const show = (v: string | null) => (v ? `"${v}"` : "none");
  const changes = (Object.keys(after) as (keyof typeof after)[])
    .filter((k) => (before[k] ?? "") !== (after[k] ?? ""))
    .map((k) => `${k}: ${show(before[k])} → ${show(after[k])}`);

  await store().logActivity({
    teamId,
    actor: actorLabel(session),
    action: changedKind ? `corrected a flag: ${previousKind} → ${kind}` : "corrected a flag",
    detail: [`Team ${team?.number ?? "?"}`, ...(changes.length ? changes : ["nothing changed"])].join(
      " · ",
    ),
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
