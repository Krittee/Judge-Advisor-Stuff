import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { canAdminister, getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

type ParsedTeam = { number: number; name: string; pit: string | null };

/**
 * Bulk import. Accepts pasted CSV or TSV, with or without a header row:
 *   1234, Iron Hawks, Pit 12
 *   1234<TAB>Iron Hawks
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
  const perPanel = Math.max(1, Math.min(40, Number(body.perPanel) || 10));

  const { teams, skipped } = parseTeams(text);
  if (!teams.length) {
    return NextResponse.json(
      { error: "No team rows found. Use one team per line: number, name" },
      { status: 400 },
    );
  }

  const client = db();
  const { error } = await client
    .from("teams")
    .upsert(
      teams.map((t) => ({ number: t.number, name: t.name, pit: t.pit })),
      { onConflict: "number", ignoreDuplicates: false },
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let assigned = 0;
  if (autoAssign) assigned = await spreadAcrossPanels(perPanel);

  return NextResponse.json({ imported: teams.length, skipped, assigned });
}

/** Assign a single team to a panel, or clear it with panelId = null. */
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  if (body.action === "autoAssign") {
    const perPanel = Math.max(1, Math.min(40, Number(body.perPanel) || 10));
    const assigned = await spreadAcrossPanels(perPanel, Boolean(body.includeAssigned));
    return NextResponse.json({ assigned });
  }

  const teamId = String(body.teamId ?? "");
  if (!teamId) return NextResponse.json({ error: "teamId required." }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if ("panelId" in body) patch.panel_id = body.panelId ? String(body.panelId) : null;
  if ("pit" in body) patch.pit = body.pit ? String(body.pit).slice(0, 60) : null;
  if ("name" in body) patch.name = String(body.name).slice(0, 120);

  const { data, error } = await db()
    .from("teams")
    .update(patch)
    .eq("id", teamId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ team: data });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Judge Advisor access required." }, { status: 403 });
  }

  const teamId = new URL(request.url).searchParams.get("teamId");
  if (!teamId) return NextResponse.json({ error: "teamId required." }, { status: 400 });

  const { error } = await db().from("teams").delete().eq("id", teamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Deal unassigned teams round-robin into panels, up to perPanel each. */
async function spreadAcrossPanels(perPanel: number, includeAssigned = false): Promise<number> {
  const client = db();
  const [{ data: panels }, { data: teams }] = await Promise.all([
    client.from("panels").select("id").order("sort_order").order("name"),
    client.from("teams").select("id, number, panel_id").order("number"),
  ]);

  if (!panels?.length || !teams?.length) return 0;

  const pending = includeAssigned ? teams : teams.filter((t) => !t.panel_id);
  if (!pending.length) return 0;

  // Respect what each panel already carries so a top-up stays balanced.
  const load = new Map<string, number>(panels.map((p) => [p.id, 0]));
  if (!includeAssigned) {
    for (const t of teams) {
      if (t.panel_id && load.has(t.panel_id)) load.set(t.panel_id, load.get(t.panel_id)! + 1);
    }
  }

  const updates: { id: string; panelId: string }[] = [];
  for (const team of pending) {
    const target = panels
      .map((p) => ({ id: p.id, count: load.get(p.id) ?? 0 }))
      .filter((p) => p.count < perPanel)
      .sort((a, b) => a.count - b.count)[0];
    if (!target) break; // every panel is full
    load.set(target.id, target.count + 1);
    updates.push({ id: team.id, panelId: target.id });
  }

  for (const u of updates) {
    await client.from("teams").update({ panel_id: u.panelId }).eq("id", u.id);
  }
  return updates.length;
}

function parseTeams(text: string): { teams: ParsedTeam[]; skipped: number } {
  const seen = new Map<number, ParsedTeam>();
  let skipped = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const cells = splitRow(line);
    const number = Number(cells[0]);
    if (!Number.isInteger(number) || number <= 0) {
      skipped++; // header rows and junk land here
      continue;
    }

    seen.set(number, {
      number,
      name: cells[1] || `Team ${number}`,
      pit: cells[2] || null,
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
