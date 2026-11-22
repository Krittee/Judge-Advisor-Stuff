"use client";

import { SignOutButton } from "@/components/judging";
import { countText, deskHeading, deskRows, changesOf, eventLine, sectionCount, sectionRows, highlight, hhmm, matchRow, pickTab, resultsText, tabCount, tabKey, tabsOf, type Change, type DeskRow } from "./marketingLogic";
import { divisionTag } from "@/components/admin/floorLogic";
import { setupLabel, WHOLE_EVENT } from "@/lib/eventSetup";
import { sentUnder } from "@/lib/releases";
import type { ReleasedView } from "@/lib/types";

/**
 * The Awards Desk, drawn (direction A, "One list", design/awards-desk/).
 *
 * Marketing reads what the Judge Advisor has sent and nothing else: no
 * control here writes to the server. Everything shown comes in as props, and
 * the page keeps the polling and the Seen set. Styles are under `.mk` in
 * globals.css.
 */

export type AwardsDeskProps = {
  /** The Marketing sign-in's name; "Marketing" when none was given. */
  name: string;
  /** The last good answer, or null before the first one. */
  view: ReleasedView | null;
  /** "HH:MM" of that answer, null before the first one. */
  lastGood: string | null;
  /** The latest poll failed: `view` is then what was shown before. */
  failed: boolean;
  query: string;
  onQuery: (query: string) => void;
  /** The remembered tab's key (`mk-tab`), null when none; a key no tab has falls back to the first. */
  tab: string | null;
  onTab: (key: string) => void;
  isSeen: (key: string) => boolean;
  onSeen: (key: string) => void;
};

/** The progress bar's share: sent over total, 0 when there is no total. */
const sentOf = (sent: number, total: number) => (total ? sent / total : 0);

const icon = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/** The query's matched part, on a neutral tile (never the accent: the accent means "press me"). */
function Hl({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((p, i) =>
        p.hit ? <mark key={i} className="mk-hl">{p.text}</mark> : <span key={i}>{p.text}</span>,
      )}
    </>
  );
}

/** "7700B Polar Bots" with the number bold, "1234A, 60601D" all bold, "No winner" plain. */
function Now({ text }: { text: string }) {
  const nums = text === "No winner" ? "" : (/^[^\s,]+(?:, [^\s,]+)*/.exec(text)?.[0] ?? "");
  return (
    <>
      {nums ? <b>{nums}</b> : null}
      {text.slice(nums.length)}
    </>
  );
}

function SeenButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="mk-seen" aria-label={label} onClick={onClick}>
      Seen
    </button>
  );
}

function ChangedBox({ changes, onSeen }: { changes: Change[]; onSeen: (key: string) => void }) {
  return (
    <section className="mk-chg" aria-labelledby="mk-chg">
      <div className="mk-chg-h">
        <svg width="18" height="18" viewBox="0 0 24 24" {...icon}>
          <path d="M12 4l9 16H3z" />
          <path d="M12 10v4M12 17h.01" />
        </svg>
        <h2 id="mk-chg">Changed since sent</h2>
        <span className="mk-n">{changes.length}</span>
      </div>
      <ul className="mk-chg-l">
        {changes.map((c) => (
          <li key={c.key} className="mk-chg-i">
            <p className="mk-cw">
              <b>{c.division} · {c.label}</b>
              <span className="d">
                now <Now text={c.nowText} /> · was {c.wasText === "No winner" ? c.wasText : <b>{c.wasText}</b>}
              </span>
            </p>
            <SeenButton label={`Mark ${c.division} ${c.label} as seen`} onClick={() => onSeen(c.key)} />
          </li>
        ))}
      </ul>
      <p className="mk-chg-ft">Seen is kept on this device</p>
    </section>
  );
}

/**
 * One tab per program, drawn like the Judge Advisor's Matrix | By award toggle
 * but with tab semantics: the selected tab is the accent (it is a control),
 * and each label carries its own sent count in words: the name over the
 * count on a phone, one line with a " · " drawn by CSS from 1024px. Arrow keys move between
 * tabs, Home and End jump to the ends.
 */
function TabBar({ view, active, onTab }: { view: ReleasedView; active: string; onTab: (key: string) => void }) {
  const tabs = tabsOf(view);
  const go = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = tabs.map((t) => tabKey(t.label));
    const at = keys.indexOf(active);
    const to = e.key === "ArrowRight" ? (at + 1) % keys.length : e.key === "ArrowLeft" ? (at + keys.length - 1) % keys.length : e.key === "Home" ? 0 : e.key === "End" ? keys.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onTab(keys[to]);
    (e.currentTarget.children[to] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className="mk-tabs" role="tablist" aria-label="Program" onKeyDown={go}>
      {tabs.map((t) => {
        const key = tabKey(t.label);
        const on = key === active;
        return (
          <button key={key} type="button" role="tab" id={`mk-tab-${key}`} aria-selected={on} aria-controls="mk-tp" aria-label={`${t.label}, ${tabCount(view, t)}`} tabIndex={on ? 0 : -1} onClick={() => onTab(key)}>
            <b className="mk-tab-n">{t.label}</b>
            <span className="mk-tab-c">{tabCount(view, t)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** `tagged`: a Whole event row, whose teams each carry a small neutral division tag (when the snapshot has one). */
function Row({ row, query, tagged, onSeen }: { row: DeskRow; query: string; tagged?: boolean; onSeen: (key: string) => void }) {
  const { award, release, state, change } = row;
  return (
    <li className={`mk-r${state === "not-sent" ? " is-ns" : ""}${change ? " is-ch" : ""}`}>
      <span className="mk-al">{award.label}</span>
      <span className="mk-tm">
        {row.teams.map((t) => (
          <span key={t.id} className="mk-tl">
            <b><Hl text={t.number} query={query} /></b>
            <span className="mk-nm"><Hl text={t.name} query={query} /></span>
            {tagged && t.division ? <span className="mk-dv" title={t.division}>{divisionTag(t.division)}</span> : null}
          </span>
        ))}
        {state === "no-winner" ? <span className="mk-mu">No winner</span> : null}
        {state === "recalled" ? (
          <span className="mk-mu">
            <svg width="14" height="14" viewBox="0 0 24 24" {...icon}>
              <path d="M4 20h4L19 9l-4-4L4 16z" />
              <path d="M13.5 6.5l4 4" />
            </svg>
            Being updated
          </span>
        ) : null}
        {state === "not-sent" ? <span className="mk-mu">Not sent yet</span> : null}
      </span>
      {change ? (
        <span className="mk-fl">
          <span className="mk-tag">Changed — was {change.wasText}</span>
          <SeenButton label={`Mark ${award.label} as seen`} onClick={() => onSeen(change.key)} />
        </span>
      ) : null}
      <span className="mk-tt">{release && (state === "sent" || state === "no-winner") ? hhmm(release.sent_at) : ""}</span>
    </li>
  );
}

export function AwardsDesk(p: AwardsDeskProps) {
  const q = p.query.trim();
  const view = p.view;
  const changes = view ? changesOf(view, p.isSeen) : [];
  const setup = view?.setup && view.sections ? view.setup : null;
  const tabs = view ? tabsOf(view) : [];
  const active = pickTab(tabs, p.tab);
  // A saved setup picks the program, so it has no tabs. Otherwise a search looks across every tab, so the bar goes while there is one and each division is listed once.
  const tabbed = !setup && !q && tabs.length > 1;
  const activeTab = view ? (tabs.find((t) => tabKey(t.label) === active) ?? tabs[0]) : null;
  const shown = view ? (q ? view.divisions : activeTab!.divisions) : [];
  // The program a heading sits under: the saved one, else the active tab. A search lists every tab's divisions at once, so it shows full names ("" drops nothing).
  const program = (setup ? setup.program : q ? "" : activeTab?.label) ?? "";
  // Search hides what does not match, and a section with nothing left. A section is a division (as today) or, with a setup, a setup section.
  const awardIds = view?.awards.map((a) => a.id) ?? [];
  const sections = !view
    ? []
    : (setup
        ? view.sections!.map((s, i) => ({ i, key: s.key, rows: sectionRows(view, s, p.isSeen), count: sectionCount(view, s), n: sentOf(sentUnder(view.releases, s.key, s.awardIds), s.awardIds.length) }))
        : shown.map((division) => ({ i: view.divisions.indexOf(division), key: division, rows: deskRows(view, division, p.isSeen), count: countText(sentUnder(view.releases, division, awardIds), view.awards.length), n: sentOf(sentUnder(view.releases, division, awardIds), view.awards.length) }))
      )
        .map((s) => ({ ...s, rows: s.rows.filter((r) => matchRow(r, q)) }))
        .filter((s) => !q || s.rows.length > 0);
  const found = sections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <div className="mk">
      <header className="mk-top">
        <div className="mk-brand">
          <span className="mk-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" {...icon} strokeWidth={2.6}>
              <path d="M5 7h14M5 12h10M5 17h6" />
            </svg>
          </span>
          <span className="mk-brand-n">Judge Queue</span>
          <span className="mk-brand-s">{setup ? setupLabel(setup) : "VEX IQ · V5RC"}</span>
        </div>
        {/* Room for the theme toggle, which docks into the top-right corner here. */}
      </header>

      <main className="mk-page">
        <div className="mk-id">
          <span className="mk-av">
            {/* eslint-disable-next-line @next/next/no-img-element -- a 320 px static JPEG; next/image buys nothing here. */}
            <img src="/avatars/marketing.jpg" alt="" width={48} height={48} />
          </span>
          <div className="mk-id-t">
            <h1>Awards Desk</h1>
            <span>{p.name === "Marketing" ? "Marketing" : `Marketing · signed in as ${p.name}`}</span>
          </div>
          <SignOutButton to="/marketing/login" />
        </div>

        <div className="mk-srch">
          <label className="sr-only" htmlFor="mk-q">Search team number, name or award</label>
          <svg width="18" height="18" viewBox="0 0 24 24" {...icon}>
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </svg>
          <input
            id="mk-q"
            className="mk-input"
            type="search"
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            placeholder="Search team number, name or award"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {p.query ? (
            <button type="button" className="mk-clr" aria-label="Clear search" onClick={() => p.onQuery("")}>
              <svg width="18" height="18" viewBox="0 0 24 24" {...icon}>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          ) : null}
        </div>
        <p className="mk-poll">Checks every 15 s{p.lastGood ? ` · last ${p.lastGood}` : ""}</p>
        {view && setup ? (
          <div className="mk-ev">
            <h2>{setupLabel(setup)}</h2>
            <p>{eventLine(view)}</p>
          </div>
        ) : null}
        {p.failed ? (
          <p className="mk-err" role="alert">
            Couldn&apos;t reach the server.{p.lastGood ? ` Showing what you had at ${p.lastGood}.` : ""}
          </p>
        ) : null}

        {!view ? (
          p.failed ? null : <p className="mk-empty">Loading…</p>
        ) : (
          <>
            {changes.length > 0 ? <ChangedBox changes={changes} onSeen={p.onSeen} /> : null}
            {tabbed && view.divisions.length > 0 && view.awards.length > 0 ? <TabBar view={view} active={active} onTab={p.onTab} /> : null}

            {view.divisions.length === 0 ? (
              <p className="mk-empty">No divisions yet.</p>
            ) : view.awards.length === 0 ? (
              <p className="mk-empty">No awards are set up.</p>
            ) : (
              <>
                {q ? (
                  found > 0 ? (
                    <>
                      <p className="mk-res" role="status">{resultsText(found)}</p>
                      <p className="mk-res-n">Search looks at what Marketing has now</p>
                    </>
                  ) : (
                    <p className="mk-empty" role="status">{`No award or team matches "${q}".`}</p>
                  )
                ) : null}
                <div className={setup ? "mk-set" : undefined} role={tabbed ? "tabpanel" : undefined} id={tabbed ? "mk-tp" : undefined} aria-labelledby={tabbed ? `mk-tab-${active}` : undefined}>
                {sections.map(({ i, key, rows, count, n }) => (
                  <section key={key} className="mk-sec" aria-labelledby={`mk-h-${i}`}>
                    <div className="mk-dh">
                      <h2 id={`mk-h-${i}`}>{deskHeading(key, program)}</h2>
                      <span className="mk-cnt">{count}</span>
                      <span className="mk-pg" aria-hidden="true">
                        <i style={{ width: `${n * 100}%` }} />
                      </span>
                    </div>
                    <ul className="mk-rows" aria-label={`${deskHeading(key, program)} awards`}>
                      {rows.map((row) => (
                        <Row key={row.award.id} row={row} query={q} tagged={setup !== null && key === WHOLE_EVENT} onSeen={p.onSeen} />
                      ))}
                    </ul>
                  </section>
                ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
