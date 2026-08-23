import { NextResponse } from "next/server";
import { canAdminister, getSession } from "@/lib/auth";
import { store } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Is it alive, and what is it storing into?
 *
 * Someone deploying from a browser has no terminal and cannot read the
 * server log, so this is how they confirm the deploy actually picked up
 * their database. Details are Judge Advisor only — the storage location
 * names a host, which is nobody else's business.
 */
export async function GET() {
  const session = await getSession();

  try {
    const db = store();
    const [panels, teams, requests] = await Promise.all([
      db.listPanels(),
      db.listTeams(),
      db.listRequests(),
    ]);

    if (!canAdminister(session)) {
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({
      ok: true,
      storage: db.kind,
      location: db.describe(),
      persistent: db.kind === "postgres",
      counts: {
        panels: panels.length,
        teams: teams.length,
        requests: requests.length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: canAdminister(session)
          ? (e as Error).message
          : "The app cannot reach its storage.",
      },
      { status: 503 },
    );
  }
}
