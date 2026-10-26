import { store } from "./db";
import { stripCode } from "./data";
import { blockedTeams, conflictsFor, panelBlocks } from "./roster";
import {
  divisionsCompatible,
  languages,
  matchTypes,
  pitFloor,
  presetDivisions,
  refereeFlags,
  teamCategories,
} from "./presets";
import {
  canAdminister,
  canAdvance,
  canFlag,
  canReadFlags,
  canReadNotes,
  type Session,
} from "./auth";
import type { AppState, ViewerCapabilities } from "./types";

/**
 * Server-only. Imports the store, which reaches for node:fs — keep this
 * out of anything a client component imports.
 *
 * What comes back depends on who is asking:
 *
 *   admin   everything
 *   judge   their own division only — the wall applies to what they can
 *           see, not only to what they can touch
 *   queuer  everything, including the notes teams leave for judges
 *   referee everything the board shows, minus those notes — a referee
 *           files flags; nothing about their job involves what a team
 *           wrote to its judges
 *   team    the same, and without the staff names on each request
 *           (who created, acknowledged or interviewed it, and the
 *           outcome) — the big board never shows them
 *
 * Team numbers, names and statuses are public by design: they are on the
 * big board on the wall. The private things are judging notes, panel
 * codes, the free-text message a team leaves, and declared conflicts of
 * interest — which name a judge and their connection to a team. None of
 * those are in this payload for anyone who has not earned them.
 */
export async function loadState(session: Session | null): Promise<AppState> {
  const db = store();
  const [panels, teams, rows, allConflicts, judges, allFlags, refereeSetup] = await Promise.all([
    db.listPanels(),
    db.listTeams(),
    db.listRequests(),
    db.listConflicts(),
    db.listJudges(),
    db.listFlags(),
    db.getRefereeSetup(),
  ]);

  const isJudge = session?.role === "judge";
  const judgePanel = isJudge ? panels.find((p) => p.id === session.panelId) : undefined;

  // A judge's session names one specific panel. If that panel cannot be
  // resolved -- for example, deleted mid-event -- there is no division to scope by.
  // Falling through to the same `division === null` a non-judge caller
  // gets would silently hand a stale judge session global visibility for
  // until the next session check. Fail closed instead: still authenticated
  // as a judge, but sees nothing, until they sign in again with a panel
  // that actually exists.
  const judgeSessionValid = !isJudge || Boolean(judgePanel);
  const division = judgePanel ? judgePanel.division : null;

  // A judge sees their own division and nothing else — and nothing at all
  // of a team their panel has a declared conflict with. "Cannot interview"
  // has to mean cannot see, or the team is still there to be worked on.
  const blocks = panelBlocks(allConflicts, judges);
  const barred = isJudge && judgeSessionValid ? blockedTeams(blocks, session.panelId) : new Set<string>();

  // divisionsCompatible rather than `===`: a blended team competes across
  // age groups, so it is judged by whichever panel holds it. Comparing
  // exactly would hide a Blended team from the very panel it is assigned
  // to -- the team would be on the roster, on the board, and missing from
  // the only screen that could interview it.
  const visibleTeams = !judgeSessionValid
    ? []
    : (division
        ? teams.filter((t) => divisionsCompatible(t.division, division))
        : teams
      ).filter((t) => !barred.has(t.id));

  /* Plus the panel holding any of those teams, even one across the wall.
     A blended team is compatible with every division, so an Elementary
     judge can see one that a Middle School panel holds -- and a team in
     the payload whose panel is not would render as unassigned on its own
     page, telling the team to go and ask the Judge Advisor about an
     assignment it already has. Panel names are on the board anyway; the
     code is stripped from all of these, and notes, scores and flags stay
     on the narrower own-panel wall regardless. */
  const heldPanelIds = new Set(visibleTeams.map((t) => t.panel_id).filter(Boolean));
  const visiblePanels = !judgeSessionValid
    ? []
    : division
      ? panels.filter((p) => divisionsCompatible(p.division, division) || heldPanelIds.has(p.id))
      : panels;
  const visiblePanelIds = new Set(visiblePanels.map((p) => p.id));
  const visibleTeamIds = new Set(visibleTeams.map((t) => t.id));

  /* A judge sees their whole division's teams -- numbers and names are on
     the board anyway -- but a referee's flag is not public, so it is held
     to the narrower wall that notes and scores use: their own panel only.
     This is the same set /api/flags narrows to, and the two must agree. */
  const ownPanelTeamIds = new Set(
    isJudge ? visibleTeams.filter((t) => t.panel_id === session.panelId).map((t) => t.id) : [],
  );
  const visibleRequests = !judgeSessionValid
    ? []
    : (
        division
          ? rows.filter((r) => visibleTeamIds.has(r.team_id) || visiblePanelIds.has(r.panel_id ?? ""))
          : rows
      ).filter((r) => !barred.has(r.team_id));

  // The note a team types for its judges is free text, and has no
  // business being readable by the other 119 teams polling this -- nor by
  // a referee, who is signed in but has no part in an interview. It goes
  // to the people who run one: the judges and Judge Advisor, and the desk
  // that may have typed it in on a team's behalf.
  const includeMessages = canAdvance(session) || session?.role === "queuer";

  // Who created, acknowledged and interviewed a request, and how it came
  // out, is staff metadata. The board and team pages show none of it, so
  // an anonymous caller (anyone on the venue wifi) gets it nulled rather
  // than a roster of who was working which desk.
  const includeStaffFields = session !== null;

  const divisions = [
    ...new Set([
      ...presetDivisions(),
      ...panels.map((p) => p.division),
      ...teams.map((t) => t.division),
    ]),
  ].filter(Boolean);

  return {
    panels: visiblePanels.map(stripCode),
    teams: visibleTeams,
    requests: visibleRequests.map((r) => ({
      ...r,
      message: includeMessages ? r.message : null,
      ...(includeStaffFields
        ? {}
        : { created_by: null, acknowledged_by: null, interviewer: null, outcome: null }),
    })),
    divisions: !judgeSessionValid ? [] : division ? [division] : divisions,
    categories: teamCategories(),
    languages: languages(),
    /* A conflict names a judge and says how they are connected to a team.
       That is about a person, not about the queue, so it goes only to
       those who act on it: the Judge Advisor, who records and clears them,
       and a judge for their own panel. Everyone else — the desk, the big
       board, and every team polling this without logging in — gets none,
       rather than a list of which judges are related to which teams. */
    conflicts: !canReadNotes(session) || (isJudge && !judgeSessionValid)
      ? []
      : session?.role === "judge"
        ? conflictsFor(session.panelId, allConflicts, blocks)
        : allConflicts,
    /* The roster is the Judge Advisor's to run. A judge already sees the
       names on their own panel; nobody else needs the list, and a judge
       must not learn which of their colleagues has a conflict with whom. */
    judges: canAdminister(session) ? judges : [],
    pitFloor: pitFloor(),
    /* The program and field count are the same for every viewer, so they
       go to everyone. Who set them is a staff name, nulled like the rest. */
    matchTypes: matchTypes(refereeSetup?.ruleset),
    refereeSetup:
      refereeSetup && !includeStaffFields ? { ...refereeSetup, set_by: "" } : refereeSetup,
    flagKinds: refereeFlags(),
    /* A referee's flag is about a team's conduct, not the queue, so it
       goes only to those who act on it: referees writing them, judges
       reading them for their own teams, and the Judge Advisor. Teams and
       the desk get an empty list -- a team should hear about a violation
       from an official, not from a page it is refreshing. */
    flags: !canReadFlags(session)
      ? []
      : session?.role === "judge"
        ? allFlags.filter((f) => ownPanelTeamIds.has(f.team_id))
        : allFlags,
    viewer: describeViewer(session, division),
    serverTime: new Date().toISOString(),
  };
}

/** Told to the browser so the UI never offers what the API would refuse. */
function describeViewer(session: Session | null, division: string | null): ViewerCapabilities {
  return {
    role: session?.role ?? "team",
    name: session?.name ?? null,
    panelId: session?.role === "judge" ? session.panelId : null,
    panelName: session?.role === "judge" ? session.panelName : null,
    division,
    canAdvance: canAdvance(session),
    canReadNotes: canReadNotes(session),
    canFlag: canFlag(session),
    canReadFlags: canReadFlags(session),
    canAdminister: canAdminister(session),
  };
}
