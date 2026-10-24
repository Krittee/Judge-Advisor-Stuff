"use client";

import Link from "next/link";
import { PanelBusyLine, panelLoad, type PanelLoad } from "@/components/SlotPicker";
import { formatClock } from "@/components/ui";
import { STATUS_META } from "@/lib/status";
import type { AppState, PublicPanel, RequestRow, Team } from "@/lib/types";
import {
  agoParts,
  bigTimeOf,
  clockParts,
  historyTime,
  statusCaps,
  stepTime,
  toneOf,
  trackSteps,
  type BigTime,
  type TrackStep,
} from "./teamLogic";

/**
 * The team page, drawn ("Status board", design/team-redesign/).
 *
 * Read-only: only the queue desk and the Judge Advisor create or change a
 * request, so a team sees where it stands and is told who to ask. Everything
 * it shows comes in as props; the page keeps the polling. Styles are under
 * `.teampage` in globals.css; the top bar is the landing page's.
 */

type Language = AppState["languages"][number];

export type TeamViewProps = {
  team: Team;
  panel: PublicPanel | undefined;
  /** What the page shows for the team: its live request or booking, else its latest. */
  current: RequestRow | null;
  /** Up to five of their other requests. */
  history: RequestRow[];
  languages: Language[];
  /** Every request, for the panel's busy line. */
  requests: RequestRow[];
  /** False when the last poll failed: what is on screen may be stale. */
  online: boolean;
  /** The clock "4 min ago" is read against; the page ticks it. */
  now: number;
};

export function TeamView(p: TeamViewProps) {
  const { team, panel, current, languages } = p;
  const load = panel ? panelLoad(panel.id, p.requests) : null;

  return (
    <div className="teampage">
      <header className="lp-top">
        <div className="lp-brand">
          <span className="lp-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <path d="M5 7h14M5 12h10M5 17h6" />
            </svg>
          </span>
          <span className="lp-brand-n">Judge Queue</span>
          <span className="lp-brand-s">VEX IQ · V5RC</span>
        </div>
        {/* The app's theme toggle docks into this row via CSS. */}
      </header>

      <main className="tp-stage">
        <div className="tp-grid">
          {/* A poll that failed after the first answer leaves the last status
              on screen; say so rather than let it pass for current. */}
          {p.online ? null : (
            <p className="tp-offline" role="status">
              Can&apos;t reach the server — retrying…
            </p>
          )}

          <div className="tp-left">
            <StatusPanel
              team={team}
              panel={panel}
              current={current}
              languages={languages}
              load={load}
              now={p.now}
            />
            <Track current={current} now={p.now} />
          </div>

          <div className="tp-right">
            <section className="tp-acts" aria-label="How to request a judge">
              <p>Please ask the queue desk to request a judge or book a time for your team.</p>
            </section>

            {p.history.length ? (
              <section className="tp-hist-s" aria-labelledby="tp-hist">
                <h2 className="tp-h-caps" id="tp-hist">
                  Earlier today
                </h2>
                <ul>
                  {p.history.map((r) => (
                    <li key={r.id} className="tp-hist">
                      <span className={`tp-sc tp-s-${toneOf(r.status)}`}>{STATUS_META[r.status].label}</span>
                      <span className="tp-hist-t">{formatClock(historyTime(r))}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <Link href="/board" className="tp-more">
              See the full board →
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ---- 1 · the status panel ---------------------------------------------------- */

function StatusPanel({
  team,
  panel,
  current,
  languages,
  load,
  now,
}: {
  team: Team;
  panel: PublicPanel | undefined;
  current: RequestRow | null;
  languages: Language[];
  load: PanelLoad | null;
  now: number;
}) {
  const big = current ? bigTimeOf(current) : null;
  const language = current ? languages.find((l) => l.id === current.language) : undefined;

  return (
    <section
      className={`tp-pan ${current ? `tp-s-${toneOf(current.status)}` : "tp-pan--idle"}`}
      aria-labelledby="tp-st"
    >
      <div className="tp-pan-top">
        <p className="tp-pan-team">{`Team ${team.number} · ${team.name}`}</p>
        {language ? <span className="tp-ptag">{language.label}</span> : null}
      </div>
      {current ? <p className="tp-pan-lab">{statusCaps(current.status)}</p> : null}
      <h1 className="tp-pan-sent" id="tp-st">
        {current ? STATUS_META[current.status].teamLabel : "No request yet"}
      </h1>
      {big ? <PanelTime big={big} now={now} /> : null}
      {!current && load ? (
        <p className="tp-pan-cap">
          <PanelBusyLine load={load} />
        </p>
      ) : null}
      {panel ? (
        <p className="tp-pan-foot">
          <b>{panel.name}</b>
          {` · ${panel.division}`}
          {panel.judges.length ? <span>{panel.judges.join(", ")}</span> : null}
        </p>
      ) : (
        <p className="tp-pan-foot tp-pan-foot--none">No judge panel assigned yet — check with the Judge Advisor.</p>
      )}
    </section>
  );
}

function PanelTime({ big, now }: { big: BigTime; now: number }) {
  let figure;
  if (big.at.kind === "clock") {
    const { time, period } = clockParts(big.at.iso);
    figure = (
      <b>
        {time}
        {period ? <small>{period}</small> : null}
      </b>
    );
  } else {
    const { text, suffix, long } = agoParts(big.at.iso, now);
    figure = suffix ? (
      <b className={long ? "tp-word" : undefined}>
        {text}
        <small>{suffix}</small>
      </b>
    ) : (
      <b className="tp-word">{text}</b>
    );
  }
  return (
    <p className="tp-pan-time">
      <span>{big.label}</span>
      {figure}
    </p>
  );
}

/* ---- 2 · the track ------------------------------------------------------------ */

const SR_NOTE: Record<TrackStep["state"], string> = {
  current: ", current step",
  done: ", done",
  skipped: ", not used",
  todo: "",
};

function Track({ current, now }: { current: RequestRow | null; now: number }) {
  return (
    <section className="tp-track" aria-labelledby="tp-trk">
      <h2 className="tp-sr" id="tp-trk">
        Where you are in the queue
      </h2>
      <ol>
        {trackSteps(current).map((step) => (
          <li
            key={step.key}
            className={`tp-st tp-st--${step.state} tp-s-${toneOf(step.status)}`}
            aria-current={step.state === "current" ? "step" : undefined}
          >
            <span className="tp-mk">
              {step.state === "done" ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              ) : null}
            </span>
            <span className="tp-st-l">
              {step.label}
              {SR_NOTE[step.state] ? <span className="tp-sr">{SR_NOTE[step.state]}</span> : null}
            </span>
            {step.at ? <span className="tp-st-m">{stepTime(step.at, now)}</span> : null}
          </li>
        ))}
      </ol>
      {current ? null : <p className="tp-trk-cap">Not in the queue yet</p>}
    </section>
  );
}

/* ---- the states before there is a team to show ----------------------------------- */

export function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
      {children}
    </main>
  );
}

export function TeamNotFound({ number }: { number: string }) {
  return (
    <CenteredNote>
      <p className="mb-2 text-lg font-semibold">{`Team ${number} is not on the list.`}</p>
      <p className="text-ink-subtle">Check the number, or ask the Judge Advisor to add you.</p>
      <Link href="/team" className="mt-6 inline-block text-accent-quiet hover:text-accent">
        ← Try another number
      </Link>
    </CenteredNote>
  );
}
