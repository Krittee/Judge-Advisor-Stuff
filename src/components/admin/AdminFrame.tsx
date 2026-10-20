"use client";

/* eslint-disable @next/next/no-img-element -- a 28 px static avatar; next/image buys nothing here. */

import { useEffect, useId, useRef, useState } from "react";
import { SignOutButton } from "@/components/judging";
import { CloseIcon } from "@/components/judge/parts";
import { judgeConflictCount } from "./conflictsLogic";
import type { AppState } from "@/lib/types";

export type AdminTab =
  | "floor"
  | "conflicts"
  | "flags"
  | "teams"
  | "panels"
  | "import"
  | "scores"
  | "log";

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

type Section = { id: AdminTab; label: string; icon: React.ReactNode };

/** The console's sections in the Judge Advisor's order of day: what is live, the setup behind it, the results. */
export const SECTION_GROUPS: { label: string; items: Section[] }[] = [
  {
    label: "Live",
    items: [
      { id: "floor", label: "Floor", icon: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /> },
      {
        id: "conflicts",
        label: "Conflicts",
        icon: (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M5.6 5.6l12.8 12.8" />
          </>
        ),
      },
      { id: "flags", label: "Referee", icon: <path d="M5 21V4M5 4h12l-2.5 4L17 12H5" /> },
    ],
  },
  {
    label: "Setup",
    items: [
      {
        id: "teams",
        label: "Teams",
        icon: (
          <>
            <circle cx="9" cy="8" r="3.2" />
            <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.2a3 3 0 0 1 0 5.6M18.5 14.8c1.7.8 2.7 2.4 2.7 4.2" />
          </>
        ),
      },
      {
        id: "panels",
        label: "Panels",
        icon: (
          <>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16M15 4v16" />
          </>
        ),
      },
      { id: "import", label: "Import", icon: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M4 19h16" /> },
    ],
  },
  {
    label: "Results",
    items: [
      { id: "scores", label: "Scores", icon: <path d="M5 20v-7M12 20V5M19 20V10" /> },
      { id: "log", label: "Activity", icon: <path d="M3 12h4l3-8 4 16 3-8h4" /> },
    ],
  },
];

const ALL_SECTIONS = SECTION_GROUPS.flatMap((g) => g.items);

/**
 * The rail's counts: Floor's is the teams requesting, Conflicts' is the
 * judges' conflicts (the older whole-panel entries are not counted).
 */
export function railCounts(
  state: Pick<AppState, "requests" | "conflicts" | "flags" | "teams" | "panels">,
): Partial<Record<AdminTab, number>> {
  return {
    floor: state.requests.filter((r) => r.status === "requested").length,
    conflicts: judgeConflictCount(state.conflicts),
    flags: state.flags.length,
    teams: state.teams.length,
    panels: state.panels.length,
  };
}

/** The other consoles, for a Judge Advisor who needs to see what a judge or a referee sees. Each opens in a tab of its own. */
export const OTHER_CONSOLES = [
  { href: "/queue", label: "Queue desk" },
  { href: "/judge", label: "Judge" },
  { href: "/referee", label: "Referee" },
  { href: "/board", label: "Big-screen board" },
] as const;

/** Floor's count is the teams requesting: the same orange as the waiting colour. Zero shows nothing. */
function Count({ id, count }: { id: AdminTab; count?: number }) {
  if (!count) return null;
  return id === "floor" ? (
    <>
      <b className="ja-rb">{count}</b>
      <span className="sr-only"> {count === 1 ? "team" : "teams"} requesting</span>
    </>
  ) : (
    <span className="ja-rc">{count}</span>
  );
}

function SectionList({
  tab,
  counts,
  onPick,
  Heading,
}: {
  tab: AdminTab;
  counts: Partial<Record<AdminTab, number>>;
  onPick: (id: AdminTab) => void;
  /** The group labels sit one level under whatever names the list: the page's h1, or the sheet's h2. */
  Heading: "h2" | "h3";
}) {
  return (
    <>
      {SECTION_GROUPS.map((group) => (
        <div key={group.label}>
          <Heading className="ja-rl">{group.label}</Heading>
          <ul>
            {group.items.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="ja-ri"
                  aria-current={tab === s.id ? "page" : undefined}
                  onClick={() => onPick(s.id)}
                >
                  <Icon>{s.icon}</Icon>
                  <span>{s.label}</span>
                  <Count id={s.id} count={counts[s.id]} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/** Quiet links under the sections. Not sections: never counted, never current. */
function OtherConsoles({ Heading }: { Heading: "h2" | "h3" }) {
  return (
    <div className="ja-oc">
      <Heading className="ja-rl">Other consoles</Heading>
      <ul>
        {OTHER_CONSOLES.map((c) => (
          <li key={c.href}>
            <a className="ja-ol" href={c.href} target="_blank" rel="noopener">
              <span>{c.label}</span>
              <span aria-hidden="true">↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Judge Advisor console's chrome: the top bar, the grouped side rail
 * (at 1024px and up), and below that the slim current-section bar with the
 * Sections menu, a bottom sheet. Unlike the judge and referee shells the
 * page body scrolls, because the tabs behind this one are long tables.
 * Styles live under `.admin` in globals.css; the avatar ring, status
 * pill and caution box reuse the judge console's `.jg-*` pieces.
 */
export function AdminFrame({
  name,
  online,
  tab,
  onTab,
  counts,
  children,
}: {
  name?: string;
  online: boolean;
  tab: AdminTab;
  onTab: (tab: AdminTab) => void;
  /** Per-section counts; Floor's is the teams requesting. Omit or 0 for none. */
  counts: Partial<Record<AdminTab, number>>;
  children: React.ReactNode;
}) {
  const [sheet, setSheet] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLElement>(null);
  const titleId = useId();
  const current = ALL_SECTIONS.find((s) => s.id === tab) ?? ALL_SECTIONS[0];

  // A native <dialog> opened with showModal(), as the judge's team sheet is.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (sheet && !el.open) el.showModal();
    else if (!sheet && el.open) el.close();
  }, [sheet]);

  // A phone turned (or a window dragged) past the rail's breakpoint: the sheet has no business open.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const close = (e: MediaQueryListEvent) => {
      if (e.matches) setSheet(false);
    };
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);

  // Every section starts at its top, whatever the last one was scrolled to.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [tab]);

  const pick = (id: AdminTab) => {
    setSheet(false);
    onTab(id);
  };

  return (
    <div className="admin">
      <header className="ja-top">
        <div className="jg-who">
          <button
            type="button"
            className="ja-menu"
            aria-label="Sections"
            aria-haspopup="dialog"
            aria-expanded={sheet}
            onClick={() => setSheet(true)}
          >
            <Icon>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </Icon>
          </button>
          <span className="jg-av">
            <img src="/avatars/judge-advisor.jpg" alt="" width={28} height={28} />
          </span>
          <span className="jg-who-t">
            <b>Judge Advisor</b>
            {name ? <span>{name}</span> : null}
          </span>
        </div>
        {/* Room for the theme toggle, which docks into the top-right corner here. */}
        <div className="ja-top-r">
          <span className="jg-live" data-online={online}>
            <i aria-hidden="true" />
            {online ? "Live" : "Reconnecting"}
          </span>
          <SignOutButton to="/admin/login" />
        </div>
      </header>

      <div className="ja-sbar">
        <Icon>{current.icon}</Icon>
        <b>{current.label}</b>
        {counts[tab] ? (
          tab === "floor" ? (
            <span className="ja-rb">{counts[tab]} requesting</span>
          ) : tab === "conflicts" ? (
            <span className="ja-rc">
              {counts[tab]} {counts[tab] === 1 ? "conflict" : "conflicts"}
            </span>
          ) : tab === "flags" ? (
            <span className="ja-rc">
              {counts[tab]} {counts[tab] === 1 ? "flag" : "flags"}
            </span>
          ) : tab === "teams" ? (
            <span className="ja-rc">
              {counts[tab]} {counts[tab] === 1 ? "team" : "teams"} · {counts.panels ?? 0} {counts.panels === 1 ? "panel" : "panels"}
            </span>
          ) : (
            <span className="ja-rc">{counts[tab]}</span>
          )
        ) : null}
      </div>

      <div className="ja-shell">
        <nav className="ja-rail" aria-label="Judge Advisor sections">
          <SectionList tab={tab} counts={counts} onPick={onTab} Heading="h2" />
          <OtherConsoles Heading="h2" />
        </nav>
        <main className="ja-main" ref={body}>
          <h1 className="sr-only">{current.label}</h1>
          {children}
        </main>
      </div>

      <dialog
        ref={dialog}
        className="ja-sheet"
        aria-modal="true"
        aria-labelledby={titleId}
        // Escape closes the dialog by itself; tell the frame. A close the
        // frame asked for (sheet already false) is not news.
        onClose={() => {
          if (sheet) setSheet(false);
        }}
        // A click whose target is the dialog itself landed on the backdrop.
        onClick={(e) => {
          if (e.target === e.currentTarget) setSheet(false);
        }}
      >
        <div className="jg-grab" aria-hidden="true" />
        <div className="ja-sh-top">
          <h2 id={titleId}>Sections</h2>
          <button type="button" className="ja-x" aria-label="Close" onClick={() => setSheet(false)}>
            <CloseIcon />
          </button>
        </div>
        <nav className="ja-sh-list" aria-label="Judge Advisor sections">
          <SectionList tab={tab} counts={counts} onPick={pick} Heading="h3" />
          <OtherConsoles Heading="h3" />
        </nav>
        <div className="ja-sh-foot">
          <p>{name ? `${name} · Judge Advisor` : "Judge Advisor"}</p>
          <SignOutButton to="/admin/login" />
        </div>
      </dialog>
    </div>
  );
}
