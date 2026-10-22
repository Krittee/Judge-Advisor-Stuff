"use client";

/* eslint-disable @next/next/no-img-element -- 20-30 KB static avatars; next/image buys nothing here. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { filterTeamNumberInput, isValidTeamNumber } from "@/lib/teamNumber";

export const TICKET_ERROR = "Enter your team number, for example 1234 or 9882K.";

/** What Continue does with what was typed: the team page to open, or the message to show. */
export function ticketTarget(number: string): { href: string } | { error: string } {
  return isValidTeamNumber(number) ? { href: `/team/${encodeURIComponent(number)}` } : { error: TICKET_ERROR };
}

/**
 * The Pit ticket: a team member with a phone, standing in a loud pit,
 * should be able to get from here to "we asked for a judge" in two taps.
 * It lives at /team (the Team door on "/" opens it).
 *
 * Styles live under `.landing` in globals.css ("Pit ticket",
 * design/landing-redesign/).
 */
export function TeamTicket() {
  const router = useRouter();
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | null>(null);

  function go(e: React.FormEvent) {
    e.preventDefault();
    const target = ticketTarget(number);
    if ("error" in target) {
      setError(target.error);
      return;
    }
    router.push(target.href);
  }

  return (
    <div className="landing">
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

      <main className="lp-stage">
        <div className="lp-grid">
          <Link href="/" className="lp-back">
            <span aria-hidden="true">←</span> All doors
          </Link>

          <section className="lp-ticket" aria-labelledby="lp-title">
            <div className="lp-t-top">
              <h1 className="lp-title" id="lp-title">Find your team</h1>
              <p className="lp-intro">
                Enter your team number to book a judging slot or call for a judge now.
              </p>
            </div>
            <div className="lp-perf" aria-hidden="true">
              <span className="lp-dash" />
              <span className="lp-notch lp-notch--l" />
              <span className="lp-notch lp-notch--r" />
            </div>
            <form onSubmit={go} className="lp-t-bot">
              <label className="lp-label" htmlFor="lp-team">Team number</label>
              <input
                id="lp-team"
                className="lp-input"
                value={number}
                onChange={(e) => {
                  setNumber(filterTeamNumberInput(e.target.value));
                  setError(null);
                }}
                autoFocus
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="go"
                maxLength={12}
                placeholder="1234A"
                aria-invalid={error !== null}
                aria-describedby={error ? "lp-error" : undefined}
              />
              {error ? (
                <div className="si-alert lp-alert" role="alert" id="lp-error">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7.5v5.5M12 16.5v.01" />
                  </svg>
                  <span>{error}</span>
                </div>
              ) : null}
              <button type="submit" className="si-btn lp-btn" disabled={!number}>
                Continue
              </button>
            </form>
          </section>

          <div>
            <Link href="/board" className="lp-board">
              <span className="lp-tile">
                <img src="/avatars/live-board.jpg" alt="" width={40} height={40} />
              </span>
              <span className="lp-rt">
                <span className="lp-t-lg">
                  Live board<span className="lp-pill">LIVE</span>
                </span>
                <span className="lp-s">See every team&apos;s judging status</span>
              </span>
              <svg className="lp-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
