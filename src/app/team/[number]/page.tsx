"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { liveRequestFor } from "@/lib/data";
import { useAppState } from "@/components/useAppState";
import { normalizeTeamNumber } from "@/lib/teamNumber";
import { CenteredNote, TeamNotFound } from "@/components/team/TeamView";
import { stepTime, toneOf, trackSteps } from "@/components/team/teamLogic";
import { formatClock } from "@/components/ui";
import { STATUS_META } from "@/lib/status";

/** Public team status. Requests and bookings are entered at the queue desk. */
export default function TeamPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = use(params);
  const teamNumber = normalizeTeamNumber(decodeURIComponent(number));
  const { state, loaded, online } = useAppState(4000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  if (!loaded) {
    return <CenteredNote>{online ? "Loading…" : "Can't reach the server — retrying…"}</CenteredNote>;
  }

  const team = state.teams.find((t) => t.number === teamNumber);
  if (!team) return <TeamNotFound number={teamNumber} />;

  const panel = state.panels.find((p) => p.id === team.panel_id);
  const requests = state.requests.filter((r) => r.team_id === team.id);
  const current = liveRequestFor(team.id, requests) ??
    [...requests].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;

  return (
    <div className="teampage">
      <header className="lp-top">
        <div className="lp-brand"><span className="lp-brand-n">Judge Queue</span></div>
      </header>
      <main className="tp-stage">
        <div className="tp-grid">
          {!online ? <p className="tp-offline" role="status">Can&apos;t reach the server — retrying…</p> : null}
          <div className="tp-left">
            <section className={`tp-pan ${current ? `tp-s-${toneOf(current.status)}` : "tp-pan--idle"}`} aria-labelledby="tp-st">
              <div className="tp-pan-top"><p className="tp-pan-team">Team {team.number} · {team.name}</p></div>
              {current ? <p className="tp-pan-lab">{STATUS_META[current.status].label}</p> : null}
              <h1 className="tp-pan-sent" id="tp-st">
                {current ? STATUS_META[current.status].teamLabel : "No request yet"}
              </h1>
              {current?.slot_start ? <p className="tp-pan-time"><span>Booked slot</span><b>{formatClock(current.slot_start)}</b></p> : null}
              <p className="tp-pan-foot">
                {panel ? <b>{panel.name} · {panel.division}</b> : "No judge panel assigned yet."}
              </p>
            </section>
            <section className="tp-track" aria-labelledby="tp-trk">
              <h2 className="tp-sr" id="tp-trk">Where you are in the queue</h2>
              <ol>
                {trackSteps(current).map((step) => (
                  <li key={step.key} className={`tp-st tp-st--${step.state} tp-s-${toneOf(step.status)}`}
                    aria-current={step.state === "current" ? "step" : undefined}>
                    <span className="tp-mk" aria-hidden="true">{step.state === "done" ? "✓" : null}</span>
                    <span className="tp-st-l">{step.label}</span>
                    {step.at ? <span className="tp-st-m">{stepTime(step.at, now)}</span> : null}
                  </li>
                ))}
              </ol>
              {current ? null : <p className="tp-trk-cap">Not in the queue yet</p>}
            </section>
          </div>
          <div className="tp-right">
            <section className="tp-acts" aria-label="How to request a judge">
              <p>Please ask the queue desk to request a judge or book a time for your team.</p>
            </section>
            <Link href="/board" className="tp-more">See the full board →</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
