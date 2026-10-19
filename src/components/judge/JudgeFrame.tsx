"use client";

/* eslint-disable @next/next/no-img-element -- a 28 px static avatar; next/image buys nothing here. */

import { useEffect, useRef } from "react";
import { SignOutButton } from "@/components/judging";
import type { JudgeTab } from "./logic";

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const TABS: { id: JudgeTab; label: string; icon: React.ReactNode }[] = [
  { id: "queue", label: "Queue", icon: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /> },
  { id: "scores", label: "Scores", icon: <path d="M5 20v-7M12 20V5M19 20V10" /> },
  {
    id: "today",
    label: "Today",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  },
];

/**
 * The judge console's chrome: the top bar, the panel bar, whatever the tab
 * shows, and the three-tab bar along the bottom. A phone app shell like the
 * referee's -- the page itself never scrolls, only `.jg-body`. Styles live
 * under `.judge` in globals.css. The active tab takes the judge's colour,
 * `--accent`.
 *
 * Signed in as the Judge Advisor there is no panel and no tabs: the frame
 * only carries the notice that sends them to their own console.
 */
export function JudgeFrame({
  name,
  online,
  advisor = false,
  panel,
  interviewed,
  tab,
  onTab,
  waiting = 0,
  children,
}: {
  name?: string;
  online: boolean;
  /** The Judge Advisor looking at the judge screen: their avatar and sign-out. */
  advisor?: boolean;
  /** Without one there is no panel bar and no tabs. */
  panel?: { name: string; division: string };
  interviewed?: { done: number; total: number };
  tab?: JudgeTab;
  onTab?: (tab: JudgeTab) => void;
  /** Teams in `requested`: the badge on Queue, hidden at 0. */
  waiting?: number;
  children: React.ReactNode;
}) {
  const body = useRef<HTMLElement>(null);
  // Every tab starts at its top, whatever the last one was scrolled to.
  // Braces: newer browsers return a promise from scrollTo, and an effect may only return a cleanup.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [tab]);

  return (
    <div className="judge">
      <header className="jg-top">
        <div className="jg-who">
          <span className="jg-av">
            <img src={advisor ? "/avatars/judge-advisor.jpg" : "/avatars/judge.jpg"} alt="" width={28} height={28} />
          </span>
          <span className="jg-who-t">
            <b>{advisor ? "Judge Advisor" : "Judge"}</b>
            {name ? <span>{name}</span> : null}
          </span>
        </div>
        {/* Room for the theme toggle, which docks into the top-right corner here. */}
        <div className="jg-top-r">
          <span className="jg-live" data-online={online}>
            <i aria-hidden="true" />
            {online ? "Live" : "Reconnecting"}
          </span>
          <SignOutButton to={advisor ? "/login" : "/judge/login"} />
        </div>
      </header>

      {panel ? (
        <section className="jg-mbar" aria-label="Your panel">
          <div className="jg-mm">
            <span>Your panel</span>
            <b>{panel.name}</b>
          </div>
          {panel.division ? <span className="jg-ptag">{panel.division}</span> : null}
          {interviewed ? (
            <p className="jg-pr">
              <b>
                {interviewed.done}/{interviewed.total}
              </b>{" "}
              interviewed
            </p>
          ) : null}
        </section>
      ) : null}

      <main className="jg-body" ref={body}>
        {children}
      </main>

      {panel && tab && onTab ? (
        <nav className="jg-tabs" aria-label="Judge sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="jg-tab"
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => onTab(t.id)}
            >
              <span className="jg-ico">
                <Icon>{t.icon}</Icon>
                {t.id === "queue" && waiting > 0 ? <span className="jg-bdg">{waiting}</span> : null}
              </span>
              {t.label}
              {t.id === "queue" && waiting > 0 ? (
                <span className="sr-only"> ({waiting} {waiting === 1 ? "team" : "teams"} waiting)</span>
              ) : null}
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
