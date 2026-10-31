"use client";

import { use, useEffect, useState } from "react";
import { liveRequestFor } from "@/lib/data";
import { useAppState } from "@/components/useAppState";
import { normalizeTeamNumber } from "@/lib/teamNumber";
import { CenteredNote, TeamNotFound, TeamView } from "@/components/team/TeamView";
import { earlierToday, latestToday } from "@/components/team/teamLogic";

/**
 * A team's own page: where it stands. Read-only -- requests and bookings are
 * entered at the queue desk.
 *
 * What is drawn is in components/team/TeamView.tsx ("Status board",
 * design/team-redesign/). This page keeps the polling.
 */
export default function TeamPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = use(params);
  // The URL may carry any casing; the roster stores one canonical form.
  const teamNumber = normalizeTeamNumber(decodeURIComponent(number));
  const { state, loaded, online } = useAppState(4000);
  // "4 min ago" moves without any new state arriving, so it has its own tick.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  if (!loaded) {
    // Nothing has come back yet, so there is no roster to look the team up
    // in. If the first fetch failed, say so: "not on the list" would send a
    // team off to hunt for a Judge Advisor over a bad wifi signal. The poll
    // keeps going, so this clears by itself once the server answers.
    return (
      <CenteredNote>
        {online ? "Loading…" : "Can't reach the server — retrying…"}
      </CenteredNote>
    );
  }

  const team = state.teams.find((t) => t.number === teamNumber);
  if (!team) return <TeamNotFound number={teamNumber} />;

  const panel = state.panels.find((p) => p.id === team.panel_id);
  const requests = state.requests.filter((r) => r.team_id === team.id);
  // Its live request or booking; with none, the latest one from today, so a
  // team that has finished today reads "Interview complete" rather than "No
  // request yet". Yesterday's requests are not today's. `history` leaves
  // `current` out, so the same request is never shown twice.
  const current = liveRequestFor(team.id, requests) ?? latestToday(requests, team.id, now);

  return (
    <TeamView
      team={team}
      panel={panel}
      current={current}
      history={earlierToday(state.requests, team.id, current?.id, now)}
      languages={state.languages}
      requests={state.requests}
      online={online}
      now={now}
    />
  );
}
