import { NextResponse } from "next/server";
import { actorParts } from "@/lib/activity";
import { actorLabel, canAdminister, canReadNotes, getSession } from "@/lib/auth";
import type { Session } from "@/lib/auth";
import { store, StoreError } from "@/lib/db";
import { conflictsFor, isPanelBlocked, panelBlocks, takeOffPanel } from "@/lib/conflicts";
import { blockedAndAssigned } from "@/lib/roster";
import { danglingSuffixes, parseTeamNumberList } from "@/lib/teamNumber";

export const dynamic = "force-dynamic";

/**
 * Conflicts of interest.
 *
 * A judge affiliated with a team must stay away from it entirely — no
 * interview, no notebook, no notes. A conflict belongs to a judge on the
 * Judge Advisor's roster, and the panel that judge sits on is the unit
 * anything is enforced against, because a panel code is what judges sign
 * in with. An older kind, against a whole panel, still works and still
 * blocks it.
 *
 * Judges may declare one for their own panel; only the Judge Advisor can
 * withdraw one, so nobody can quietly clear a conflict they declared and
 * then judge the team anyway.
 */
export async function GET() {
  const session = await getSession();
  if (!canReadNotes(session)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const db = store();
  const [all, judges] = await Promise.all([db.listConflicts(), db.listJudges()]);
  return NextResponse.json({
    conflicts:
      session?.role === "judge"
        ? conflictsFor(session.panelId, all, panelBlocks(all, judges))
        : all,
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!canReadNotes(session)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  // The roster way: one judge, and the teams they are affiliated with.
  if (body.judgeId !== undefined) return declareForJudge(session, body);

  const teamId = String(body.teamId ?? "");

  // A judge can only declare against their own panel; the Judge Advisor
  // can record one for any.
  const panelId =
    session?.role === "judge" ? session.panelId : String(body.panelId ?? "");

  // Asking a panel "any conflicts?" comes back as a handful of team numbers
  // at once, so take them that way rather than making it one dialog each.
  if (typeof body.teamNumbers === "string" && body.teamNumbers.trim()) {
    return declareMany(session, panelId, body.teamNumbers, String(body.judgeName ?? "").trim().slice(0, 80) || null);
  }

  if (!teamId || !panelId) {
    return NextResponse.json({ error: "A team and a panel are required." }, { status: 400 });
  }

  const db = store();
  const [teams, panels] = await Promise.all([db.listTeams(), db.listPanels()]);

  const team = teams.find((t) => t.id === teamId);
  const panel = panels.find((p) => p.id === panelId);
  if (!team || !panel) {
    return NextResponse.json({ error: "That team or panel no longer exists." }, { status: 404 });
  }

  const conflict = await db.addConflict({
    panelId,
    teamId,
    judgeName: String(body.judgeName ?? "").trim().slice(0, 80) || null,
    note: String(body.note ?? "").trim().slice(0, 280) || null,
    declaredBy: actorLabel(session),
  });

  // A conflicted panel cannot hold the team, so hand it back for
  // reassignment rather than leaving it sitting with judges who must not
  // interview it. Read the answer before the update: the file store hands
  // back the same object it stores, so team.panel_id is already null by
  // the time updateTeam returns.
  const wasHoldingIt = team.panel_id === panelId;
  if (wasHoldingIt) {
    await db.updateTeam(team.id, { panel_id: null });
  }

  await db.logActivity({
    teamId: team.id,
    kind: "conflict",
    ...actorParts(session),
    action: "declared a conflict of interest",
    detail: `Team ${team.number} · ${panel.name}`,
  });

  return NextResponse.json({ conflict, unassigned: wasHoldingIt });
}

/** Withdrawing a conflict is the Judge Advisor's call alone. */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json(
      { error: "Only the Judge Advisor can withdraw a conflict." },
      { status: 403 },
    );
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required." }, { status: 400 });

  const db = store();
  const [conflicts, teams, panels, judges] = await Promise.all([
    db.listConflicts(),
    db.listTeams(),
    db.listPanels(),
    db.listJudges(),
  ]);
  const conflict = conflicts.find((c) => c.id === id);

  const removed = await db.removeConflict(id);
  if (removed && conflict) {
    const team = teams.find((t) => t.id === conflict.team_id);
    const who = conflict.judge_id
      ? judges.find((j) => j.id === conflict.judge_id)?.name
      : panels.find((p) => p.id === conflict.panel_id)?.name;
    await db.logActivity({
      teamId: conflict.team_id,
      kind: "conflict",
      ...actorParts(session),
      action: "withdrew a conflict of interest",
      detail: `Team ${team?.number ?? "?"} · ${who ?? conflict.judge_name ?? "unknown"}`,
    });
  }
  return NextResponse.json({ ok: true, removed });
}

/**
 * The team numbers out of a pasted list, or the refusal to send back.
 *
 * Refuses the whole list rather than record part of it: a stray space in
 * "9882 K" would otherwise conflict team 9882 and leave 9882K judgeable.
 */
function readTeamNumbers(input: string): { numbers: string[] } | { refusal: NextResponse } {
  const numbers = parseTeamNumberList(input);
  if (!numbers.length) {
    return { refusal: NextResponse.json({ error: "No team numbers found." }, { status: 400 }) };
  }

  const adrift = danglingSuffixes(input);
  if (adrift.length) {
    return {
      refusal: NextResponse.json(
        {
          error:
            `"${adrift.join('", "')}" ${adrift.length === 1 ? "is" : "are"} not a team number. ` +
            `If you meant a letter suffix, write it with no space — 9882K, not 9882 K. ` +
            `Nothing was recorded.`,
        },
        { status: 400 },
      ),
    };
  }
  if (numbers.length > 200) {
    return { refusal: NextResponse.json({ error: "That is too many at once." }, { status: 400 }) };
  }
  return { numbers };
}

/**
 * Record a whole panel's conflicts in one go.
 *
 * This is the Judge Advisor's actual workflow: ask each panel whether they
 * are affiliated with anyone, and get back a short list of team numbers.
 * Doing that a team at a time across six panels is where mistakes creep in.
 *
 * Every number is reported back under exactly one heading, so a typo cannot
 * pass as a recorded conflict.
 */
async function declareMany(
  session: Session | null,
  panelId: string,
  input: string,
  judgeName: string | null,
) {
  if (!panelId) {
    return NextResponse.json({ error: "Pick a judge panel first." }, { status: 400 });
  }

  const db = store();
  const [teams, panels, existing, judges] = await Promise.all([
    db.listTeams(),
    db.listPanels(),
    db.listConflicts(),
    db.listJudges(),
  ]);

  const panel = panels.find((p) => p.id === panelId);
  if (!panel) {
    return NextResponse.json({ error: "That panel no longer exists." }, { status: 404 });
  }

  const read = readTeamNumbers(input);
  if ("refusal" in read) return read.refusal;

  const byNumber = new Map(teams.map((t) => [t.number, t]));
  const blocks = panelBlocks(existing, judges);

  const recorded: string[] = [];
  const unchanged: string[] = [];
  const notFound: string[] = [];
  const unassigned: string[] = [];

  for (const number of read.numbers) {
    const team = byNumber.get(number);
    if (!team) {
      notFound.push(number);
      continue;
    }
    if (isPanelBlocked(blocks, panelId, team.id)) {
      unchanged.push(number);
      continue;
    }

    await db.addConflict({
      panelId,
      teamId: team.id,
      judgeName,
      note: null,
      declaredBy: actorLabel(session),
    });

    // Same rule as a single declaration: a conflicted panel cannot hold
    // the team, so hand it back for reassignment.
    if (team.panel_id === panelId) {
      await db.updateTeam(team.id, { panel_id: null });
      unassigned.push(number);
    }
    recorded.push(number);
  }

  if (recorded.length) {
    await db.logActivity({
      kind: "conflict",
      ...actorParts(session),
      action: "declared conflicts of interest",
      detail: `${panel.name} · ${recorded.join(", ")}`,
    });
  }

  return NextResponse.json({ recorded, unchanged, notFound, unassigned, panel: panel.name });
}

/**
 * Record one roster judge's conflicts: `{ judgeId, teamNumbers, note? }`.
 *
 * `teamNumbers` is a pasted list (or an array of numbers). The note is the
 * connection to the team, so it applies only when exactly one team is given.
 * Every number comes back under exactly one of `recorded`, `unchanged` (this
 * judge already has it) and `notFound`; `takenOff` is the recorded teams that
 * were assigned to the judge's current panel and came off it -- exactly the
 * teams that lose their panel, and now need one. A live request on the panel
 * is left where it is (the Floor flags it). A judge with no panel blocks
 * nobody yet, so nothing comes off.
 *
 * A judge session may record only for a judge on their own panel.
 */
async function declareForJudge(session: Session | null, body: Record<string, unknown>) {
  const db = store();
  const [judges, teams] = await Promise.all([db.listJudges(), db.listTeams()]);

  const judge = judges.find((j) => j.id === String(body.judgeId ?? ""));
  if (!judge) {
    return NextResponse.json({ error: "That judge is not on the roster." }, { status: 404 });
  }
  if (session?.role === "judge" && judge.panel_id !== session.panelId) {
    return NextResponse.json(
      { error: "You can only record conflicts for judges on your own panel." },
      { status: 403 },
    );
  }

  const list = Array.isArray(body.teamNumbers) ? body.teamNumbers.join("\n") : body.teamNumbers;
  const read = readTeamNumbers(String(list ?? ""));
  if ("refusal" in read) return read.refusal;

  const existing = await db.listConflicts();
  const have = new Set(existing.filter((c) => c.judge_id === judge.id).map((c) => c.team_id));
  const note = read.numbers.length === 1 ? String(body.note ?? "").trim().slice(0, 280) || null : null;
  const byNumber = new Map(teams.map((t) => [t.number, t]));

  const recorded: string[] = [];
  const unchanged: string[] = [];
  const notFound: string[] = [];
  const recordedIds = new Set<string>();

  try {
    for (const number of read.numbers) {
      const team = byNumber.get(number);
      if (!team) {
        notFound.push(number);
      } else if (have.has(team.id)) {
        unchanged.push(number);
      } else {
        await db.addConflict({
          judgeId: judge.id,
          teamId: team.id,
          note,
          declaredBy: actorLabel(session),
        });
        recorded.push(number);
        recordedIds.add(team.id);
      }
    }
  } catch (e) {
    if (e instanceof StoreError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  // The recorded teams assigned to the judge's panel come off it. Worked out
  // from the roster as it is now, before any team is touched.
  let takeOff: typeof teams = [];
  if (judge.panel_id && recorded.length) {
    takeOff = blockedAndAssigned(judge.panel_id, panelBlocks(await db.listConflicts(), judges), teams).filter((t) =>
      recordedIds.has(t.id),
    );
  }
  const takenOff = takeOff.map((t) => t.number);
  await takeOffPanel(takeOff);

  if (recorded.length) {
    const panelName = (await db.listPanels()).find((p) => p.id === judge.panel_id)?.name;
    await db.logActivity({
      teamId: recorded.length === 1 ? [...recordedIds][0] : null,
      kind: "conflict",
      ...actorParts(session),
      action: "declared conflicts of interest",
      detail:
        `${judge.name} (${panelName ?? "no panel"}) · ${recorded.join(", ")}` +
        (takenOff.length ? ` · taken off the panel: ${takenOff.join(", ")}` : ""),
    });
  }

  // The roster note is the Judge Advisor's; a judge recording for a colleague does not get it back.
  return NextResponse.json({
    judge: session?.role === "judge" ? { ...judge, note: null } : judge,
    recorded,
    unchanged,
    notFound,
    takenOff,
  });
}
