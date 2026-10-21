import { NextResponse } from "next/server";
import { actorParts } from "@/lib/activity";
import { canAdminister, getSession } from "@/lib/auth";
import { isValidTeamNumber, normalizeTeamNumber } from "@/lib/teamNumber";
import { divisionsCompatible, presetDivisions, resolveCategory } from "@/lib/presets";
import { normalizePit } from "@/lib/pit";
import { store, StoreError } from "@/lib/db";
import { isPanelBlocked, loadBlocks } from "@/lib/conflicts";
import type { Team } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Null where the line (and the request) said nothing: a stored team keeps its own, see `ImportedTeam`. */
type ParsedTeam = {
  number: string;
  name: string | null;
  pit: string | null;
  division: string | null;
  category: string | null;
};

/** A line the import could not read: 1-based, as it is numbered in the box. */
type SkippedLine = { line: number; text: string; reason: string };

const NO_NUMBER = "no team number";
const NO_DIGIT = "no digit in the team number";
const BAD_CHARS = "team number has characters other than A–Z, 0–9 and -";

/**
 * Bulk import. Accepts pasted CSV or TSV, with or without a header row:
 *   1234, Iron Hawks, Pit 12
 *   9882K<TAB>Iron Hawks
 * Existing team numbers are updated rather than duplicated. A blank name,
 * pit, division or notebook column leaves an existing team's value alone (a
 * new team is called "Team <number>" and gets the first division and the
 * default notebook type).
 *
 * Replies with `imported` (teams written, one per distinct number),
 * `created` and `updated` (which add up to it; a number already stored
 * before this paste is an update), `assigned`, `skipped` (every line not
 * read, header included, as it always was) and `skippedLines`: the ones
 * worth telling the Judge Advisor about, each with its line and why.
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

  const { teams, skipped, skippedLines } = parseTeams(
    text,
    named(body.division, resolveDivision),
    named(body.category, resolveCategory),
  );
  if (!teams.length) {
    return NextResponse.json(
      { error: "No team rows found. Use one team per line: number, name" },
      { status: 400 },
    );
  }

  // Refuse before anything is written. Auto-assign has no panels to deal
  // into and throws, but by then upsertTeams has already saved the roster:
  // the caller gets a 400 while the teams stay imported (BUG-015).
  if (autoAssign && !(await store().listPanels()).length) {
    return NextResponse.json({ error: "Add at least one judge panel first." }, { status: 400 });
  }

  try {
    // Counted against what is stored now, before the write. `teams` holds
    // one row per number, so a number pasted twice is one team, not two.
    const known = new Set((await store().listTeams()).map((t) => t.number));
    await store().upsertTeams(teams);
    const assigned = autoAssign ? await store().autoAssignTeams(perPanel) : 0;
    const updated = teams.filter((t) => known.has(t.number)).length;
    await logSetup(
      session,
      "imported teams",
      `${teams.length} ${teams.length === 1 ? "team" : "teams"} · ${teams.length - updated} new`,
    );
    return NextResponse.json({
      imported: teams.length,
      created: teams.length - updated,
      updated,
      skipped,
      skippedLines,
      assigned,
    });
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
    // Both resets clear the log too, so the entry is written after: the first of what follows.
    if (body.action === "resetDay") {
      await store().resetDay();
      await logSetup(session, "reset the day", "Requests, notes, scores and activity cleared");
      return NextResponse.json({ ok: true });
    }

    // Wipes everything, including the roster. Used to clear the demo data.
    if (body.action === "resetAll") {
      await store().resetAll();
      await logSetup(session, "wiped everything", "Teams, panels, judges, conflicts, referee flags and setup cleared");
      return NextResponse.json({ ok: true });
    }

    const teamId = String(body.teamId ?? "");
    if (!teamId) return NextResponse.json({ error: "teamId required." }, { status: 400 });

    // Manual assignment must obey the same rules auto-assign already
    // enforces: the panel has to actually exist, and it has to be one that
    // may judge the division the team will be in once this request is
    // applied. Checked against that division rather than the stored one,
    // so a request carrying both a move and an assignment is held to the
    // wall too -- it used to skip the check entirely on the grounds that
    // the assignment was about to be discarded anyway, which stopped being
    // true once a compatible panel is allowed to survive a move.
    // Assigning a team to a panel that must stay away from it would undo a
    // declared conflict silently, so that is refused here as well.
    if (body.panelId) {
      const panelId = String(body.panelId);
      const [panels, teams, blocks] = await Promise.all([
        store().listPanels(),
        store().listTeams(),
        loadBlocks(),
      ]);

      const panel = panels.find((p) => p.id === panelId);
      if (!panel) {
        return NextResponse.json({ error: "That panel no longer exists." }, { status: 404 });
      }

      const team = teams.find((t) => t.id === teamId);
      const nextDivision =
        "division" in body ? resolveDivision(body.division) : team?.division;

      // A blended team clears this wall against any panel, which is the
      // whole point of the category: it used to be refused here unless a
      // panel happened to exist in the blended division, so the only way
      // to get one judged was to mis-file it as a single age group.
      if (team && nextDivision && !divisionsCompatible(nextDivision, panel.division)) {
        return NextResponse.json(
          {
            error:
              `${panel.name} judges ${panel.division}, but team ${team.number} is in ` +
              `${nextDivision}. Move the team's division first if that is what you meant.`,
          },
          { status: 409 },
        );
      }

      if (isPanelBlocked(blocks, panelId, teamId)) {
        return NextResponse.json(
          { error: "That panel has a declared conflict of interest with this team." },
          { status: 409 },
        );
      }
    }

    const patch: Record<string, unknown> = {};
    if ("panelId" in body) patch.panel_id = body.panelId ? String(body.panelId) : null;
    if ("category" in body) patch.category = resolveCategory(body.category);
    if ("division" in body) {
      const moved = resolveDivision(body.division);
      patch.division = moved;
      // Changing division normally puts the team on the far side of the
      // wall from whichever panel held it, so the assignment goes. Not if
      // the panel may still judge them: moving a team to Blended must not
      // quietly drop the panel it is already booked with, or the category
      // costs the Judge Advisor the assignment every time they set it.
      if (!("panelId" in body)) {
        const teams = await store().listTeams();
        const team = teams.find((t) => t.id === teamId);
        const panels = await store().listPanels();
        const held = panels.find((p) => p.id === team?.panel_id);
        if (!held || !divisionsCompatible(moved, held.division)) patch.panel_id = null;
      }
    }
    if ("pit" in body) patch.pit = normalizePit(body.pit);

    if ("name" in body) {
      const name = String(body.name).trim().slice(0, 120);
      if (!name) {
        return NextResponse.json({ error: "A team needs a name." }, { status: 400 });
      }
      patch.name = name;
    }

    if ("number" in body) {
      const number = normalizeTeamNumber(body.number);
      if (!isValidTeamNumber(number)) {
        return NextResponse.json(
          { error: "Enter a valid team number, for example 1234 or 9882K." },
          { status: 400 },
        );
      }
      patch.number = number;
    }

    const before = { ...(await store().listTeams()).find((t) => t.id === teamId) }; // updateTeam edits the stored row in place
    const team = await store().updateTeam(teamId, patch);
    const changed = (Object.keys(patch) as (keyof Team)[]).filter((k) => String(before[k]) !== String(team[k]));
    if (changed.length) {
      const named = changed.map((k) => (k === "panel_id" ? "panel" : k)).join(", ");
      await logSetup(session, "edited a team", `Team ${team.number} · ${named}`, team.id);
    }
    return NextResponse.json({ team });
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

  const team = (await store().listTeams()).find((t) => t.id === teamId);
  await store().deleteTeam(teamId);
  if (team) await logSetup(session, "removed a team", `Team ${team.number} · ${team.name}`);
  return NextResponse.json({ ok: true });
}

function logSetup(session: Awaited<ReturnType<typeof getSession>>, action: string, detail: string, teamId: string | null = null) {
  return store().logActivity({ teamId, kind: "setup", ...actorParts(session), action, detail });
}

function clampPerPanel(value: unknown): number {
  return Math.max(1, Math.min(40, Number(value) || 10));
}

/** A value the request names for the whole paste, resolved; null when it names none. */
function named(input: unknown, resolve: (input: unknown) => string): string | null {
  return String(input ?? "").trim() ? resolve(input) : null;
}

function resolveDivision(input: unknown): string {
  const wanted = String(input ?? "").trim();
  const divisions = presetDivisions();
  return divisions.includes(wanted) ? wanted : divisions[0];
}

/**
 * @param fallbackDivision used for any row that does not name one in a
 *        fourth column, so a whole paste can go into one division. Null
 *        when the request names none.
 * @param fallbackCategory likewise for a fifth column.
 */
function parseTeams(
  text: string,
  fallbackDivision: string | null,
  fallbackCategory: string | null,
): { teams: ParsedTeam[]; skipped: number; skippedLines: SkippedLine[] } {
  const seen = new Map<string, ParsedTeam>();
  const skippedLines: SkippedLine[] = [];
  let skipped = 0;
  let first = true;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const isFirst = first;
    first = false;

    const cells = splitRow(line);
    const number = normalizeTeamNumber(cells[0]);

    // Team numbers are text, so a header row cannot be spotted by failing
    // to parse as a number. It is caught by requiring at least one digit:
    // "Team Number" has none, "9882K" does. The first line without one is
    // that header, and is skipped without a word; anywhere else it is a
    // line the Judge Advisor should hear about.
    const reason = !number ? NO_NUMBER : !/\d/.test(number) ? NO_DIGIT : !isValidTeamNumber(number) ? BAD_CHARS : null;
    if (reason) {
      skipped++;
      if (!(isFirst && reason === NO_DIGIT)) skippedLines.push({ line: i + 1, text: line.slice(0, 200), reason });
      continue;
    }

    seen.set(number, {
      number,
      name: cells[1] || null,
      pit: normalizePit(cells[2]),
      division: cells[3] ? resolveDivision(cells[3]) : fallbackDivision,
      category: cells[4] ? resolveCategory(cells[4]) : fallbackCategory,
    });
  }

  return { teams: [...seen.values()], skipped, skippedLines };
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
