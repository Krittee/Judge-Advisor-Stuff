"use client";

import { slotsModel, type CoordinatorTab } from "./coordinatorLogic";
import { BookingBar, SlotsTab } from "./SlotsTab";
import { TeamsTab } from "./TeamsTab";
import type { Language } from "@/components/Language";
import { SignOutButton } from "@/components/judging";
import type { PublicPanel, RequestRow, Slot, Team } from "@/lib/types";

/**
 * The coordinator console, drawn (direction B, "Teams + Slots",
 * design/coordinator-redesign/).
 *
 * Everything it shows comes in as props and everything it does goes out as a
 * callback, so the page keeps the polling and every write. The coordinator
 * sets a team's language, puts it in the queue, or books it a slot; there is
 * no note, score, message, cancel, reschedule or undo here for it to reach.
 * Styles are under `.co` in globals.css.
 */

export type CoordinatorViewProps = {
  /** The coordinator's name, under "Coordinator". */
  name?: string;
  online: boolean;
  /** With any language tapped but not yet saved already applied (withPending). */
  teams: Team[];
  panels: PublicPanel[];
  requests: RequestRow[];
  languages: Language[];
  divisions: string[];

  tab: CoordinatorTab;
  onTab: (tab: CoordinatorTab) => void;

  /** Teams tab: what is typed (already filtered), the division, the "Not asked" toggle and the row opened. */
  query: string;
  onQuery: (query: string) => void;
  division: string;
  onDivision: (division: string) => void;
  notAskedOnly: boolean;
  onNotAskedOnly: (on: boolean) => void;
  openId: string | null;
  onOpen: (teamId: string | null) => void;
  onLanguages: (team: Team, languages: string[]) => void;
  onRequest: (team: Team, language: string) => void;
  /** "Book a time": this team becomes the chosen one and the Slots tab opens on its panel. */
  onBookTime: (team: Team) => void;

  /** Slots tab: the team chosen, the panel tapped, the slot picked (null clears it). */
  chosenId: string | null;
  panelPick: string | null;
  onPanelPick: (panelId: string) => void;
  picked: string | null;
  onPick: (start: string | null) => void;
  onBook: (team: Team, slot: Slot, language: string) => void;

  busy: boolean;
  error: string | null;
  ok: string | null;
  now?: number;
};

const TABS: { id: CoordinatorTab; label: string; icon: React.ReactNode }[] = [
  {
    id: "teams",
    label: "Teams",
    icon: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 19c0-3.2 2.6-5.5 6-5.5s6 2.3 6 5.5" />
        <circle cx="17" cy="9" r="2.4" />
        <path d="M17.5 14c2.2.3 3.5 2 3.5 4.5" />
      </>
    ),
  },
  {
    id: "slots",
    label: "Slots",
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),
  },
];

export function CoordinatorView(p: CoordinatorViewProps) {
  const now = p.now ?? Date.now();
  const model = slotsModel({
    teams: p.teams,
    panels: p.panels,
    requests: p.requests,
    chosenId: p.chosenId,
    panelPick: p.panelPick,
    picked: p.picked,
    now,
  });

  return (
    <div className="co">
      <header className="co-top">
        <div className="co-who">
          {/* No picture yet: the empty dashed box that keeps the avatar's place (the sign-in pass uses it too). */}
          <span className="co-av">
            <span className="si-av si-av--ph" aria-hidden="true" />
          </span>
          <span className="co-who-t">
            <b>Coordinator</b>
            {p.name ? <span>{p.name}</span> : null}
          </span>
        </div>
        {/* Room for the theme toggle, which docks into the top-right corner here. */}
        <div className="co-top-r">
          <span className="co-live" data-online={p.online}>
            <i aria-hidden="true" />
            {p.online ? "Live" : "Reconnecting"}
          </span>
          <SignOutButton to="/coordinator/login" />
        </div>
      </header>

      {p.error || p.ok ? (
        <div className="co-msgs">
          {p.error ? (
            <p className="dk-msg dk-msg--err" role="alert">
              {p.error}
            </p>
          ) : null}
          {p.ok ? (
            <p className="dk-msg" role="status">
              {p.ok}
            </p>
          ) : null}
        </div>
      ) : null}

      <main className="co-body">{p.tab === "teams" ? <TeamsTab {...p} /> : <SlotsTab {...p} model={model} now={now} />}</main>

      {p.tab === "slots" ? <BookingBar model={model} languages={p.languages} busy={p.busy} onBook={p.onBook} /> : null}

      <nav className="co-tabs" aria-label="Coordinator sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-current={p.tab === t.id ? "page" : undefined} onClick={() => p.onTab(t.id)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {t.icon}
            </svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
