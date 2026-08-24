import { NextResponse } from "next/server";
import { canAdminister, getSession } from "@/lib/auth";
import { isValidTeamNumber, normalizeTeamNumber } from "@/lib/teamNumber";
import { presetDivisions, resolveCategory } from "@/lib/presets";
import { store, StoreError } from "@/lib/db";

export const dynamic = "force-dynamic";

type ParsedTeam = {
  number: string;
  name: string;
  pit: string | null;
  division: string;
  category: string;
};

/**
 * Bulk import. Accepts pasted CSV or TSV, with or without a header row:
 *   1234, Iron Hawks, Pit 12
 *   9882K<TAB>Iron Hawks
 * Existing team numbers are updated rather than duplicated.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const text = String(body.text ?? "");
  const autoAssign = Boolean(body.autoAssign);
  const perPanel = clampPerPanel(body.perPanel);

  const { teams, skipped } = parseTeams(
    text,
    resolveDivision(body.division),
    resolveCategory(body.category),
  );
  if (!teams.length) {
    return NextResponse.json(
      { error: "No team rows found. Use one team per line: number, name" },
      { status: 400 },
    );
  }

  try {
    await store().upsertTeams(teams);
    const assigned = autoAssign ? await store().autoAssignTeams(perPanel) : 0;
    return NextResponse.json({ imported: teams.length, skipped, assigned });
  } catch (e) {
    if (e instanceof StoreError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}

/** Assign a team to a panel, rename it, spread them all out, or reset the day. */
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  try {
    if (body.action === "autoAssign") {
      const assigned = await store().autoAssignTeams(
        clampPerPanel(body.perPanel),
        Boolean(body.includeAssigned),
        body.division ? resolveDivision(body.division) : undefined,
      );
      return NextResponse.json({ assigned });
    }

    // Clears the day's requests, notes and log but keeps teams and panels.
    if (body.action === "resetDay") {
      await store().resetDay();
      return NextResponse.json({ ok: true });
    }

    // Wipes everything, including the roster. Used to clear the demo data.
    if (body.action === "resetAll") {
      await store().resetAll();
      return NextResponse.json({ ok: true });
    }

    const teamId = String(body.teamId ?? "");
    if (!teamId) return NextResponse.json({ error: "teamId required." }, { status: 400 });

    const patch: Record<string, unknown> = {};
    if ("panelId" in body) patch.panel_id = body.panelId ? String(body.panelId) : null;
    if ("category" in body) patch.category = resolveCategory(body.category);
    if ("division" in body) {
      patch.division = resolveDivision(body.division);
      // Changing division puts the team on the far side of the wall from
      // whichever panel held it.
      patch.panel_id = null;
    }
    if ("pit" in body) patch.pit = body.pit ? String(body.pit).slice(0, 60) : null;
    if ("name" in body) patch.name = String(body.name).slice(0, 120);

    return NextResponse.json({ team: await store().updateTeam(teamId, patch) });
  } catch (e) {
    if (e instanceof StoreError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
  }

  const teamId = new URL(request.url).searchParams.get("teamId");
  if (!teamId) return NextResponse.json({ error: "teamId required." }, { status: 400 });

  await store().deleteTeam(teamId);
  return NextResponse.json({ ok: true });
}

function clampPerPanel(value: unknown): number {
  return Math.max(1, Math.min(40, Number(value) || 10));
}

function resolveDivision(input: unknown): string {
  const wanted = String(input ?? "").trim();
  const divisions = presetDivisions();
  return divisions.includes(wanted) ? wanted : divisions[0];
}

/**
 * @param fallbackDivision used for any row that does not name one in a
 *        fourth column, so a whole paste can go into one division.
 * @param fallbackCategory likewise for a fifth column.
 */
function parseTeams(
  text: string,
  fallbackDivision: string,
  fallbackCategory: string,
): { teams: ParsedTeam[]; skipped: number } {
  const seen = new Map<string, ParsedTeam>();
  let skipped = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const cells = splitRow(line);
    const number = normalizeTeamNumber(cells[0]);

    // Team numbers are text, so a header row cannot be spotted by failing
    // to parse as a number. It is caught by requiring at least one digit:
    // "Team Number" has none, "9882K" does.
    if (!isValidTeamNumber(number) || !/\d/.test(number)) {
      skipped++;
      continue;
    }

    seen.set(number, {
      number,
      name: cells[1] || `Team ${number}`,
      pit: cells[2] || null,
      division: cells[3] ? resolveDivision(cells[3]) : fallbackDivision,
      category: cells[4] ? resolveCategory(cells[4]) : fallbackCategory,
    });
  }

  return { teams: [...seen.values()], skipped };
}

/**
 * Split one pasted row into fields.
 *
 * Tabs win when present, because that is what a spreadsheet paste gives
 * you and tabs never appear inside a team name. Otherwise split on commas
 * while respecting double quotes, so "Robotics, Inc." survives the trip.
 */
function splitRow(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map(clean);

  const cells: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // A doubled quote inside a quoted field is a literal quote.
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      cells.push(clean(field));
      field = "";
    } else {
      field += ch;
    }
  }
  cells.push(clean(field));
  return cells;
}

function clean(value: string): string {
  return value.trim().replace(/^"(.*)"$/s, "$1").trim();
}
