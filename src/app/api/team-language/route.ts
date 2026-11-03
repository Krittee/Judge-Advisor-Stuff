import { NextResponse } from "next/server";
import { actorParts } from "@/lib/activity";
import { canSetTeamLanguage, getSession } from "@/lib/auth";
import { store, StoreError } from "@/lib/db";
import { languages, parseLanguageList } from "@/lib/presets";

export const dynamic = "force-dynamic";

/**
 * Set the language(s) a team can be interviewed in: `{ teamId, languages }`.
 *
 * A coordinator walking the pits has no other way to touch a team, so this
 * writes `languages` and nothing else: the body is never spread into the
 * patch, whatever else it carries.
 */
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!canSetTeamLanguage(session)) {
    return NextResponse.json(
      { error: "Only a coordinator or the Judge Advisor can set a team's interview language." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const teamId = String(body.teamId ?? "");
  if (!teamId) return NextResponse.json({ error: "teamId required." }, { status: 400 });

  const found = (await store().listTeams()).find((t) => t.id === teamId);
  if (!found) return NextResponse.json({ error: "That team no longer exists." }, { status: 404 });
  const was = found.languages.join(); // read now: updateTeam edits the stored row in place

  // An empty list clears it ("not stated"), so a mistaken tap can be undone.
  const next = parseLanguageList(body.languages);

  try {
    const team = await store().updateTeam(teamId, { languages: next });
    if (next.join() !== was) {
      const shorts = languages().filter((l) => next.includes(l.id)).map((l) => l.short);
      await store().logActivity({
        teamId,
        kind: "setup",
        ...actorParts(session),
        action: "set interview language",
        detail: `Team ${team.number} · ${shorts.length ? shorts.join(" + ") : "not stated"}`,
      });
    }
    return NextResponse.json({ team });
  } catch (e) {
    if (e instanceof StoreError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
