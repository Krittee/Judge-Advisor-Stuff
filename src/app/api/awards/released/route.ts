import { NextResponse } from "next/server";
import { actorParts } from "@/lib/activity";
import { canAdminister, getSession, type Session } from "@/lib/auth";
import { store } from "@/lib/db";
import { awardPairs, awardsUnder, keyError, scopeKeys } from "@/lib/eventSetup";
import { awards, blendedDivisions, presetPrograms, programTabs } from "@/lib/presets";
import { decisionFor, nextSend, sentRelease } from "@/lib/releases";
import { eventDivisions } from "@/lib/server-state";
import type { AwardReleaseRow, AwardView, ReleaseReply, RecallAllReply, ReleasedView, ReleaseSnapshot, SendAllReply } from "@/lib/types";
import { awardLabel, fields } from "../shared";

export const dynamic = "force-dynamic";

/**
 * The Awards Desk's hand-off to Marketing. The Judge Advisor sends an award in
 * a division once it is decided (a winner, both for the Judges Award, or No
 * winner), recalls it, or sends everything ready. Marketing reads what was
 * sent and nothing else: no nominations, no winners, and a recalled decision
 * comes through emptied.
 */
const FORBIDDEN = { error: "Only the Judge Advisor can send awards to Marketing." };
const names = (s: ReleaseSnapshot) => (s.no_winner ? "No winner" : s.teams.map((t) => t.number).join(" and "));

type Decisions = {
  releases: AwardReleaseRow[];
  decide: (award: AwardView, division: string) => ReleaseSnapshot | null;
};

async function decisions(): Promise<Decisions> {
  const db = store();
  const [releases, winners, noWinners, teams] = await Promise.all([db.listReleases(), db.listWinners(), db.listNoWinners(), db.listTeams()]);
  return { releases, decide: (award, division) => decisionFor(award, division, winners, noWinners, teams) };
}

/** The award and division a PUT or DELETE names, or the 400 when either is missing. */
async function parseTarget(request: Request): Promise<{ awardId: string; division: string } | NextResponse> {
  const body = await fields(request);
  const awardId = String(body.awardId ?? "");
  const division = String(body.division ?? "").trim();
  if (!awardId || !division) return NextResponse.json({ error: "An award and a division are required." }, { status: 400 });
  return { awardId, division };
}

/** Send one decided award, once: a sent one comes back as it is, and only a real send is logged. */
async function sendOne(
  session: Session,
  award: AwardView,
  division: string,
  snapshot: ReleaseSnapshot,
  releases: AwardReleaseRow[],
): Promise<AwardReleaseRow> {
  const current = releases.find((r) => r.award_id === award.id && r.division === division);
  const next = nextSend(current, snapshot, new Date().toISOString());
  if (next === "unchanged") return current!;
  const db = store();
  const release = await db.sendRelease({
    awardId: award.id,
    division,
    snapshot,
    previous: next.previous,
    changedAt: next.changedAt,
    sentBy: session.name,
  });
  const was = current && next.changedAt !== current.changed_at && next.previous ? ` · was ${names(next.previous)}` : "";
  await db.logActivity({
    teamId: snapshot.teams[0]?.id ?? null,
    kind: "award",
    ...actorParts(session),
    action: `sent ${award.label} to Marketing`,
    detail: `${division} · ${names(snapshot)}${was}`,
  });
  return release;
}

/** Log one award taken back from Marketing. */
const logRecall = (session: Session, awardId: string, release: AwardReleaseRow) =>
  store().logActivity({
    teamId: release.teams[0]?.id ?? null,
    kind: "award",
    ...actorParts(session),
    action: `recalled ${awardLabel(awardId)} from Marketing`,
    detail: release.division,
  });

export async function GET() {
  const session = await getSession();
  if (!canAdminister(session) && session?.role !== "marketing") {
    return NextResponse.json(FORBIDDEN, { status: 403 });
  }
  const db = store();
  const [releases, panels, teams, setup] = await Promise.all([db.listReleases(), db.listPanels(), db.listTeams(), db.getEventSetup()]);
  const divisions = eventDivisions(panels, teams, setup);
  const view: ReleasedView = {
    awards: awards().map((a) => ({ id: a.id, label: a.label, places: a.places })),
    divisions,
    // A saved setup picks the program, so the desk needs no tabs.
    programs: setup ? programTabs(divisions, [], []) : programTabs(divisions, presetPrograms(), blendedDivisions()),
    ...(setup && {
      setup: { program: setup.program, format: setup.format },
      sections: scopeKeys(divisions, setup.format).map((key) => ({
        key,
        awardIds: awardsUnder(awards(), key, setup.format).map((a) => a.id),
      })),
    }),
    // A recalled decision is the Judge Advisor's business; Marketing sees only that it is withdrawn.
    releases:
      session?.role === "marketing"
        ? releases.map((r) => (r.status === "recalled" ? { ...r, teams: [], no_winner: false, previous: null } : r))
        : releases,
  };
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
}

/** Send one award in one division. */
export async function PUT(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) return NextResponse.json(FORBIDDEN, { status: 403 });

  const target = await parseTarget(request);
  if (target instanceof NextResponse) return target;
  const { awardId, division } = target;
  const award = awards().find((a) => a.id === awardId);
  if (!award) return NextResponse.json({ error: "That award does not exist." }, { status: 400 });
  const wrongKey = keyError(award, division, await store().getEventSetup());
  if (wrongKey) return NextResponse.json({ error: wrongKey }, { status: 400 });

  const { releases, decide } = await decisions();
  const snapshot = decide(award, division);
  if (!snapshot) {
    return NextResponse.json(
      {
        error: `${award.label} in ${division} is not decided yet. Pick its winner (or both for the Judges Award) or mark it No winner first.`,
      },
      { status: 409 },
    );
  }
  const reply: ReleaseReply = { release: await sendOne(session!, award, division, snapshot, releases) };
  return NextResponse.json(reply);
}

/** Take a sent award back from Marketing, or with `?all=1` every sent award in every division and the whole event. */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) return NextResponse.json(FORBIDDEN, { status: 403 });

  if (new URL(request.url).searchParams.get("all") === "1") {
    const db = store();
    const reply: RecallAllReply = { recalled: [] };
    for (const r of (await db.listReleases()).filter((r) => r.status === "sent")) {
      const release = await db.recallRelease(r.award_id, r.division);
      if (!release) continue;
      reply.recalled.push(release);
      await logRecall(session!, r.award_id, release);
    }
    return NextResponse.json(reply);
  }

  const target = await parseTarget(request);
  if (target instanceof NextResponse) return target;
  const { awardId, division } = target;

  const db = store();
  const label = awardLabel(awardId);
  const current = (await db.listReleases()).find((r) => r.award_id === awardId && r.division === division);
  if (!current) {
    return NextResponse.json({ error: `${label} has not been sent to Marketing.` }, { status: 404 });
  }
  if (current.status === "recalled") return NextResponse.json({ release: current } satisfies ReleaseReply);

  const release = await db.recallRelease(awardId, division);
  if (!release) return NextResponse.json({ error: `${label} has not been sent to Marketing.` }, { status: 404 });
  await logRecall(session!, awardId, release);
  return NextResponse.json({ release } satisfies ReleaseReply);
}

/** Send every award that is decided and not yet sent, in every division. */
export async function POST() {
  const session = await getSession();
  if (!canAdminister(session)) return NextResponse.json(FORBIDDEN, { status: 403 });

  const db = store();
  const [{ releases, decide }, panels, teams, setup] = await Promise.all([decisions(), db.listPanels(), db.listTeams(), db.getEventSetup()]);
  const reply: SendAllReply = { sent: [], skipped: [] };
  for (const { award, division } of awardPairs(awards(), eventDivisions(panels, teams, setup), setup?.format)) {
    const snapshot = decide(award, division);
    if (!snapshot) reply.skipped.push({ awardId: award.id, division, reason: "not ready" });
    else if (sentRelease(releases, award.id, division)) reply.skipped.push({ awardId: award.id, division, reason: "already sent" });
    else reply.sent.push(await sendOne(session!, award, division, snapshot, releases));
  }
  return NextResponse.json(reply);
}
