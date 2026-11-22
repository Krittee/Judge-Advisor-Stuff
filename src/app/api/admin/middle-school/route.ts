import { NextResponse } from "next/server";
import { actorParts } from "@/lib/activity";
import { canAdminister, getSession } from "@/lib/auth";
import { store } from "@/lib/db";
import { setupDivisions } from "@/lib/eventSetup";
import { presetDivisions } from "@/lib/presets";
import { awardLabel } from "../../awards/shared";

export const dynamic = "force-dynamic";

const FROM = "Middle School";
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const count = (n: number, noun: string) => (n ? [`${n} ${noun}${n === 1 ? "" : "s"}`] : []);

/**
 * Move everything filed under the old plain "Middle School" to one of the two divisions it became
 * (IQ Middle School, V5RC Middle School): teams, panels, winners, No winner marks and sends to Marketing.
 * Judge Advisor only. A SENT release moves with its key and stays sent: the decision does not change,
 * only the division's name. Nominations, scores and requests hang off team and panel ids, so they stay.
 *
 * Nothing to move, or plain "Middle School" still a configured division, is `{ moved: null }`.
 * ponytail: check-then-write is not atomic, as event-setup's; a decision landing between the clash check and the move can slip through.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!canAdminister(session)) {
    return NextResponse.json({ error: "Only the Judge Advisor can move Middle School teams." }, { status: 403 });
  }

  const configured = presetDivisions();
  if (configured.some((d) => same(d, FROM))) return NextResponse.json({ moved: null });
  const targets = configured.filter((d) => d.toLowerCase().endsWith(" middle school"));

  const body = await request.json().catch(() => ({}));
  const to = String(body?.to ?? "");
  if (!targets.includes(to)) {
    return NextResponse.json({ error: `Pick ${targets.join(" or ")}.` }, { status: 400 });
  }

  const db = store();
  const setup = await db.getEventSetup();
  const inSetup = setupDivisions(setup);
  if (setup && inSetup && !inSetup.includes(to)) {
    return NextResponse.json({ error: `${to} is not in ${setup.program}. Pick ${targets.filter((d) => inSetup.includes(d)).join(" or ")}.` }, { status: 400 });
  }

  const [teams, panels, winners, noWinners, releases] = await Promise.all([
    db.listTeams(),
    db.listPanels(),
    db.listWinners(),
    db.listNoWinners(),
    db.listReleases(),
  ]);
  const decisions = [...winners, ...noWinners, ...releases];
  if (!teams.some((t) => same(t.division, FROM)) && !panels.some((p) => same(p.division, FROM)) && !decisions.some((d) => same(d.division, FROM))) {
    return NextResponse.json({ moved: null });
  }

  // An award already decided in both places would lose one when the keys merge.
  const clash = [...new Set(decisions.filter((d) => same(d.division, FROM)).map((d) => d.award_id))].filter((id) =>
    decisions.some((d) => d.award_id === id && same(d.division, to)),
  );
  if (clash.length) {
    return NextResponse.json({ error: `${clash.map(awardLabel).join(", ")} already decided in ${to}. Clear one of the two first.` }, { status: 409 });
  }

  const moved = await db.moveDivision(FROM, to);
  await db.logActivity({
    kind: "setup",
    ...actorParts(session),
    action: `Moved "${FROM}" to ${to}`,
    detail: [...count(moved.teams, "team"), ...count(moved.panels, "panel"), ...count(moved.winners + moved.noWinners + moved.releases, "award record")].join(", ") || null,
  });
  return NextResponse.json({ moved });
}
