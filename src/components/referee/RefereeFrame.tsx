"use client";

import Link from "next/link";
import { TopBar } from "@/components/ui";
import { SignOutButton } from "@/components/judging";
import type { Role } from "@/lib/auth";

/** The icons are the mock's, drawn once here. */
function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/**
 * The referee console's chrome: the top bar, the 6px referee stripe, whatever
 * the page pins or scrolls, and the three-tab bar along the bottom. A phone
 * app shell -- the page itself never scrolls, so what a page pins above or
 * below its `.rf-body` stays put. Styles live under `.referee` in globals.css.
 *
 * Today is not a page of its own: it is the Report page with `?tab=today`,
 * which shows only its "Flagged today" list. The page passes `today`.
 */
export function RefereeFrame({
  name,
  online,
  role,
  current,
  tabs = true,
  today = false,
  children,
}: {
  name?: string;
  online: boolean;
  role: Role | "team";
  /** The page this is: the tab that reads "you are here" follows from it. */
  current: "/referee" | "/referee/teams";
  /** The event setup screen is a gate, not a place to navigate from. */
  tabs?: boolean;
  /** On the Report page, showing its Today list rather than the form. */
  today?: boolean;
  children: React.ReactNode;
}) {
  const report = current === "/referee";
  return (
    <div className="referee">
      <TopBar
        title="Referee"
        subtitle={name}
        online={online}
        role={role}
        current={current}
        right={
          // Room for the theme toggle, which docks into the top-right corner here.
          <span className="rf-top-r">
            <SignOutButton to="/referee/login" />
          </span>
        }
      />
      <div className="rf-strip" aria-hidden="true" />

      {children}

      {tabs ? (
        <nav className="rf-tabs" aria-label="Referee sections">
          <Link
            href="/referee"
            className="rf-tab"
            aria-current={report && !today ? "page" : undefined}
            onClick={() => {
              // Already on the page: the link goes nowhere, so take it to the top.
              document.querySelector(".rf-body")?.scrollTo({ top: 0 });
            }}
          >
            <Icon>
              <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
            </Icon>
            Report
          </Link>
          <Link href="/referee/teams" className="rf-tab" aria-current={report ? undefined : "page"}>
            <Icon>
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.5c2.2.6 3.5 2.5 3.5 5.5" />
            </Icon>
            All teams
          </Link>
          <Link
            href="/referee?tab=today"
            className="rf-tab"
            aria-current={report && today ? "page" : undefined}
          >
            <Icon>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </Icon>
            Today
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
