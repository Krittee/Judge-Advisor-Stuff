"use client";

import Link from "next/link";
import { useState } from "react";
import { PanelBusyLine, panelLoad, SlotPicker, type PanelLoad } from "@/components/SlotPicker";
import { formatClock } from "@/components/ui";
import { STATUS_META } from "@/lib/status";
import type { AppState, PublicPanel, RequestRow, Slot, Team } from "@/lib/types";
import {
  agoParts,
  bigTimeOf,
  canCancel,
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
 * Everything it shows comes in as props and everything it does goes out as a
 * callback, so the page keeps the polling and the writes. Styles are under
 * `.teampage` in globals.css; the top bar is the landing page's.
 */

type Language = AppState["languages"][number];

export type TeamViewProps = {
  team: Team;
  panel: PublicPanel | undefined;
  /** The team's live request or booking (liveRequestFor), if any. */
  current: RequestRow | null;
  /** Up to five of their other requests. */
  history: RequestRow[];
  languages: Language[];
  /** Every request and team, for the busy line and the slot grid. */
  requests: RequestRow[];
  teams: Team[];
  /** False when the last poll failed: what is on screen may be stale. */
  online: boolean;
  /** The clock "4 min ago" is read against; the page ticks it. */
  now: number;
  busy: boolean;
  error: string | null;
  onDismissError: () => void;
  message: string;
  onMessage: (message: string) => void;
  /** Ask for a judge now; with a booking, turn it into the request. */
  onReady: (language: string) => void;
  onBook: (slot: Slot, language: string) => void;
  onCancel: () => void;
};

export function TeamView(p: TeamViewProps) {
  const { team, panel, current, languages } = p;
  // A booking is not the same as being in the queue: a team holding a
  // later slot can still say they are ready now.
  const booking = current?.status === "scheduled" ? current : null;
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
          {p.error ? (
            <div className="tp-alert" role="alert">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.5v5.5M12 16.5v.01" />
              </svg>
              <span>{p.error}</span>
              <button type="button" className="tp-alert-x" onClick={p.onDismissError} aria-label="Dismiss this message">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          ) : null}
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
            {booking ? (
              <BookedActions p={p} booking={booking} load={load} />
            ) : current ? (
              canCancel(current) ? (
                <section className="tp-acts" aria-label="Your request">
                  <button type="button" className="tp-btn tp-btn--out tp-btn--fit" onClick={p.onCancel} disabled={p.busy}>
                    Cancel this request
                  </button>
                </section>
              ) : null
            ) : (
              <IdleActions p={p} />
            )}

            {!current && panel ? <SlotSection p={p} panel={panel} /> : null}

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
        {current ? STATUS_META[current.status].teamLabel : "Ask for a judge"}
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

/* ---- 3 · the actions ------------------------------------------------------------- */

function NoteField({ p }: { p: TeamViewProps }) {
  return (
    <div>
      <label className="tp-sr" htmlFor="tp-note">
        Optional note for the judges
      </label>
      <input
        id="tp-note"
        className="tp-field"
        type="text"
        value={p.message}
        onChange={(e) => p.onMessage(e.target.value)}
        placeholder="Optional note for the judges"
        maxLength={280}
        autoComplete="off"
      />
    </div>
  );
}

function IdleActions({ p }: { p: TeamViewProps }) {
  const [picked, setPicked] = useState("");
  const language = p.languages.some((l) => l.id === picked) ? picked : (p.languages[0]?.id ?? "");

  return (
    <section className="tp-acts" aria-label="Ask for a judge now">
      {p.languages.length > 1 ? (
        <div>
          <span className="tp-lbl" id="tp-lang">
            Which language would you like to be interviewed in?
          </span>
          <div className="tp-seg" role="group" aria-labelledby="tp-lang">
            {p.languages.map((l) => (
              <button key={l.id} type="button" aria-pressed={l.id === language} onClick={() => setPicked(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <NoteField p={p} />
      <button
        type="button"
        className="tp-btn"
        disabled={p.busy || !p.team.panel_id}
        onClick={() => p.onReady(language)}
      >
        {p.busy ? "Sending…" : "Request a judge"}
      </button>
    </section>
  );
}

function BookedActions({
  p,
  booking,
  load,
}: {
  p: TeamViewProps;
  booking: RequestRow;
  load: PanelLoad | null;
}) {
  const several = p.languages.length > 1;
  // One accent button per language, each sending straight away.
  const choices = several ? p.languages : [{ id: p.languages[0]?.id ?? "", label: "We're ready now" }];

  return (
    <section className="tp-acts" aria-labelledby="tp-ready">
      <h2 className="tp-h-q" id="tp-ready">
        Ready before your slot?
      </h2>
      <NoteField p={p} />
      <div>
        {several ? (
          <span className="tp-lbl" id="tp-lang">
            Which language would you like to be interviewed in?
          </span>
        ) : null}
        <div
          className={`tp-pair${several ? "" : " tp-pair--one"}`}
          role="group"
          aria-labelledby={several ? "tp-lang" : "tp-ready"}
        >
          {choices.map((l) => (
            <button
              key={l.id || "default"}
              type="button"
              className="tp-btn"
              disabled={p.busy || !p.team.panel_id}
              onClick={() => p.onReady(l.id)}
            >
              {p.busy ? "Sending…" : l.label}
            </button>
          ))}
        </div>
      </div>
      <p className="tp-fine tp-fine--c">Either gives up your {formatClock(booking.slot_start)} slot.</p>
      {load ? (
        <p className="tp-load">
          <PanelBusyLine load={load} />
        </p>
      ) : null}
      <div className="tp-rule" aria-hidden="true" />
      <button type="button" className="tp-btn tp-btn--out tp-btn--fit" onClick={p.onCancel} disabled={p.busy}>
        Cancel this booking
      </button>
    </section>
  );
}

function SlotSection({ p, panel }: { p: TeamViewProps; panel: PublicPanel }) {
  const [open, setOpen] = useState(true);
  const [picked, setPicked] = useState("");
  const language = p.languages.some((l) => l.id === picked) ? picked : (p.languages[0]?.id ?? "");

  return (
    <section className="tp-dsc">
      <button type="button" className="tp-dsc-h" aria-expanded={open} aria-controls="tp-slots" onClick={() => setOpen(!open)}>
        <span>{`Book a time with ${panel.name} instead`}</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
        </svg>
      </button>
      <div className="tp-dsc-b" id="tp-slots" hidden={!open}>
        {p.languages.length > 1 ? (
          <div className="tp-chips" role="group" aria-label="Interview language for the slot">
            {p.languages.map((l) => (
              <button key={l.id} type="button" className="tp-chip" aria-pressed={l.id === language} onClick={() => setPicked(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
        ) : null}
        <SlotPicker
          panel={panel}
          requests={p.requests}
          teams={p.teams}
          teamId={p.team.id}
          disabled={p.busy}
          onPick={(slot) => p.onBook(slot, language)}
        />
      </div>
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
