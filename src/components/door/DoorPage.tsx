/* eslint-disable @next/next/no-img-element -- 20-30 KB static avatars; next/image buys nothing here. */

import Link from "next/link";
import { STATUS_META, type Status } from "@/lib/status";

/**
 * The front door: one card per role, then the Live board with the colour
 * key drawn as sample tiles inside it. Styles live under `.doorpage` in
 * globals.css ("Five doors", design/door-redesign/).
 */

type Door = { name: string; line: string; href: string; ring: string | null; avatar?: string };

/** Most people first. The Team door has no avatar and no ring: it opens the ticket. */
const DOORS: Door[] = [
  { name: "Team", line: "Check your judging status", href: "/team", ring: null },
  { name: "Judge", line: "Panel code from your Judge Advisor", href: "/judge/login", ring: "judge", avatar: "judge" },
  { name: "Referee", line: "Referees and the head referee", href: "/referee/login", ring: "ref", avatar: "referee" },
  { name: "Queue desk", line: "Check teams in and book times", href: "/queue/login", ring: "desk", avatar: "queue-desk" },
  { name: "Judge Advisor", line: "Runs judging for the event", href: "/admin/login", ring: "ja", avatar: "judge-advisor" },
];

/** One sample team in each colour a tile can wear on the board, in the order a visit happens. */
const SAMPLES: { status: Status; cls: string; time?: string }[] = [
  { status: "scheduled", cls: "bk", time: "10:40" },
  { status: "requested", cls: "rq", time: "3 min" },
  { status: "acknowledged", cls: "en" },
  { status: "interviewing", cls: "in" },
  { status: "completed", cls: "dn" },
];

export function DoorPage() {
  return (
    <div className="landing doorpage">
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

      <main className="dp-stage">
        <div className="dp-grid">
          <div className="dp-head">
            <h1 className="dp-title" id="dp-title">Who are you?</h1>
            <p className="dp-intro">Choose your door</p>
          </div>

          <ul className="dp-doors" aria-labelledby="dp-title">
            {DOORS.map((d) => (
              <li key={d.href} className="dp-cell">
                <Link href={d.href} className="dp-card" aria-describedby={d.ring ? undefined : "dp-cap"}>
                  {d.avatar ? (
                    <span className={`dp-av dp-r-${d.ring}`}>
                      <img src={`/avatars/${d.avatar}.jpg`} alt="" width={48} height={48} />
                    </span>
                  ) : (
                    <span className="dp-av dp-av--team">
                      <span className="dp-gl">
                        <TicketGlyph />
                      </span>
                    </span>
                  )}
                  <span className="dp-rt">
                    <span className="dp-dt">{d.name}</span>
                    <span className="dp-s">{d.line}</span>
                  </span>
                  <Chevron />
                </Link>
                {d.ring ? null : <p className="dp-cap" id="dp-cap">Opens the team ticket</p>}
              </li>
            ))}
          </ul>

          <div className="dp-below">
            <div className="dp-bcard">
              <Link href="/board" className="dp-board">
                <span className="dp-btile">
                  <img src="/avatars/live-board.jpg" alt="" width={40} height={40} />
                </span>
                <span className="dp-rt">
                  <span className="dp-bt">
                    Live board<span className="dp-pill">LIVE</span>
                  </span>
                  <span className="dp-s">See every team&apos;s judging status</span>
                </span>
                <Chevron />
              </Link>
              <div className="dp-samples" role="group" aria-label="What the colours mean">
                <p className="dp-kn">Each team shows on the board as a tile in one of these colours.</p>
                <ul className="dp-sg">
                  {SAMPLES.map(({ status, cls, time }) => {
                    const word = STATUS_META[status].short;
                    return (
                      <li key={status} className={`dp-tl dp-s-${cls}`}>
                        <span className="sr-only">{time ? `${word}, ${time}` : word}</span>
                        <span className="dp-tl-n" aria-hidden="true">1234A</span>
                        <span className="dp-tl-s" aria-hidden="true">{word}</span>
                        {time ? <span className="dp-tl-t" aria-hidden="true">{time}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function TicketGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />
      <path d="M14.5 7.5v9" strokeDasharray="2 2.4" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
