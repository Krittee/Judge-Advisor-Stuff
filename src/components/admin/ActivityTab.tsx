"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { kindOf } from "@/components/Flags";
import { CheckIcon, ChevronDown, CloseIcon, WarnIcon } from "@/components/judge/parts";
import { call } from "@/components/useAppState";
import type { ActivityRow, AppState, Team } from "@/lib/types";
import { Pill } from "./RefereeTab";
import { dotClass } from "./refereeLogic";
import {
  actionParts,
  actorName,
  bannerText,
  chipCounts,
  clockText,
  dotFor,
  filterRows,
  footText,
  hourGroups,
  KIND_CHIPS,
  KIND_NAMES,
  NO_FILTERS,
  NO_POLL,
  polled,
  shownRole,
  spansDays,
  teamOf,
  updatedText,
  whoOptions,
  type ActivityFilters,
  type Poll,
} from "./activityLogic";

function Glyph({ size = 16, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const SearchIcon = () => (
  <Glyph>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Glyph>
);
const PersonIcon = () => (
  <Glyph size={18}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20c0-3.8 3.4-6.2 7.5-6.2s7.5 2.4 7.5 6.2" />
  </Glyph>
);

type Slice = Pick<AppState, "teams" | "flagKinds">;

/**
 * The Activity section: who did what, newest first, for when the floor gets
 * confusing. Polls the log every 10 s; the filters work over what was loaded.
 * A team's chip opens its sheet.
 */
export function ActivityTab({ state, onOpenSheet }: { state: Slice; onOpenSheet: (teamId: string) => void }) {
  const [poll, setPoll] = useState<Poll>(NO_POLL);
  const [filters, setFilters] = useState<ActivityFilters>(NO_FILTERS);
  const [whoOpen, setWhoOpen] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      call<{ activity: ActivityRow[] }>("/api/admin/activity", { method: "GET" })
        .then(({ activity }) => live && setPoll((p) => polled(p, { rows: activity }, new Date())))
        .catch((e) => live && setPoll((p) => polled(p, { error: (e as Error).message }, new Date())));
    load();
    const t = setInterval(load, 10_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  // A phone turned past the breakpoint: the Who sheet has no business open.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const close = (e: MediaQueryListEvent) => {
      if (e.matches) setWhoOpen(false);
    };
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);

  return <ActivityBoard poll={poll} state={state} filters={filters} onFilters={setFilters} whoOpen={whoOpen} onWhoOpen={setWhoOpen} onOpenSheet={onOpenSheet} />;
}

/* ---- the page ------------------------------------------------------------- */

/**
 * The title and toolbar, then the entries grouped by hour. Everything it shows
 * comes in as props, so the markup can be checked without a browser;
 * `ActivityTab` owns the state. From 1024px the hour headers stick to the top
 * of the timeline, which scrolls on its own; on a phone the page scrolls and
 * the headers stay in the flow.
 */
export function ActivityBoard({
  poll,
  state,
  filters,
  onFilters,
  whoOpen = false,
  onWhoOpen,
  onOpenSheet,
}: {
  poll: Poll;
  state: Slice;
  filters: ActivityFilters;
  onFilters: (next: ActivityFilters) => void;
  whoOpen?: boolean;
  onWhoOpen: (open: boolean) => void;
  onOpenSheet: (teamId: string) => void;
}) {
  const uid = useId();
  const { rows, updatedAt, error } = poll;
  const shown = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const groups = useMemo(() => hourGroups(shown, spansDays(rows)), [shown, rows]);
  const counts = useMemo(() => chipCounts(rows), [rows]);
  const people = useMemo(() => whoOptions(rows, filters.who), [rows, filters.who]);
  const loaded = updatedAt !== null;

  return (
    <div className="ja-ac">
      <div className="ja-ac-top">
        <h2 className="ja-ac-h">Activity</h2>
        {updatedAt ? <p className="ja-ac-upd">{updatedText(updatedAt)}</p> : null}
      </div>

      {loaded && rows.length ? (
        <div className="ja-ac-tb" role="group" aria-label="Filter events">
          <div className="ja-ac-kc" role="group" aria-label="Kind">
            {KIND_CHIPS.map((c) => (
              <button key={c.id} type="button" className="ja-ac-chip" aria-pressed={filters.kind === c.id} onClick={() => onFilters({ ...filters, kind: c.id })}>
                {c.label}
                <span className="ja-ac-n">{counts[c.id]}</span>
              </button>
            ))}
          </div>
          <div className="ja-ac-r2">
            <div className="ja-ac-srch">
              <label className="sr-only" htmlFor={`${uid}-q`}>
                Team number
              </label>
              <SearchIcon />
              <input
                id={`${uid}-q`}
                className="ja-in"
                type="text"
                autoComplete="off"
                placeholder="Team number"
                value={filters.team}
                onChange={(e) => onFilters({ ...filters, team: e.target.value })}
              />
            </div>
            <div className="ja-selw ja-ac-who">
              <label className="ja-ac-wlab" htmlFor={`${uid}-w`}>
                Who
              </label>
              <select id={`${uid}-w`} className="ja-in ja-sel" value={filters.who} onChange={(e) => onFilters({ ...filters, who: e.target.value })}>
                <option value="">Everyone</option>
                {people.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <ChevronDown />
            </div>
            <button
              type="button"
              className="ja-ac-wb"
              aria-haspopup="dialog"
              aria-label={`Who, ${filters.who || "everyone"}`}
              data-on={filters.who ? "true" : undefined}
              onClick={() => onWhoOpen(true)}
            >
              <PersonIcon />
              Who
              <ChevronDown />
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="jg-caution" role="status">
          <WarnIcon />
          <p>{bannerText(poll)}</p>
        </div>
      ) : null}

      {!loaded ? (
        error ? null : (
          <p className="ja-empty">Loading…</p>
        )
      ) : !rows.length ? (
        <p className="ja-empty">Nothing logged yet.</p>
      ) : !shown.length ? (
        <p className="ja-empty">
          No events match these filters.{" "}
          <button type="button" className="ja-ac-lnk" onClick={() => onFilters(NO_FILTERS)}>
            Clear filters
          </button>
        </p>
      ) : (
        <section className="ja-ac-tl" aria-label="Activity timeline">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`${uid}-${g.key}`}>
              <h3 id={`${uid}-${g.key}`} className="ja-ac-hh">
                <b>{g.label}</b>
                <span>· {g.count}</span>
              </h3>
              <ol>
                {g.rows.map((r) => (
                  <EventRow key={r.id} row={r} team={teamOf(r, state.teams)} kinds={state.flagKinds} onOpenSheet={onOpenSheet} />
                ))}
              </ol>
            </section>
          ))}
          <div className="ja-ac-lf">
            <p>{footText(rows.length)}</p>
            <div className="ja-ac-key" role="group" aria-label="Dot key">
              <span>
                <i className="ja-ac-dd ja-ac-d-request" aria-hidden="true" />
                Request
              </span>
              <span>
                {/* One dot per severity the config has: a referee entry wears the colour of the one it names. */}
                {state.flagKinds.map((k) => (
                  <i key={k.id} className={`ja-ac-dd ja-ac-d-referee ${dotClass(k.color)}`} aria-hidden="true" />
                ))}
                Referee flag, by severity
              </span>
              <span>
                <i className="ja-ac-dd ja-ac-d-conflict" aria-hidden="true" />
                Conflict
              </span>
              <span>
                <i className="ja-ac-dd ja-ac-d-setup" aria-hidden="true" />
                Setup
              </span>
              <span>
                <i className="ja-ac-dd ja-ac-d-award" aria-hidden="true" />
                Award
              </span>
            </div>
          </div>
        </section>
      )}

      <WhoSheet
        open={whoOpen}
        options={people}
        value={filters.who}
        onPick={(who) => {
          onFilters({ ...filters, who });
          onWhoOpen(false);
        }}
        onClose={() => onWhoOpen(false)}
      />
    </div>
  );
}

/* ---- one entry -------------------------------------------------------------- */

/**
 * One entry. Two lines on a phone (time and who, then what and the team);
 * from 1024px a row of cells. The team's chip is there only while the team is
 * on the roster, and opens its sheet.
 */
export function EventRow({ row, team, kinds, onOpenSheet }: { row: ActivityRow; team: Team | null; kinds: AppState["flagKinds"]; onOpenSheet: (teamId: string) => void }) {
  const role = shownRole(row);
  return (
    <li className="ja-ac-ev">
      <span className="ja-ac-rl">
        <i className={`ja-ac-dd ${dotFor(row, kinds)}`} aria-hidden="true" />
        <span className="sr-only">{KIND_NAMES[row.kind]}</span>
      </span>
      <div className="ja-ac-bx">
        <div className="ja-ac-l1">
          <b className="ja-ac-tm">{clockText(row.created_at)}</b>
          <span className="ja-ac-sep" aria-hidden="true">
            ·
          </span>
          <span className="ja-ac-wh">
            <b>{actorName(row)}</b>
            {role ? <span> · {role}</span> : null}
          </span>
        </div>
        <div className="ja-ac-l2">
          <span className="ja-ac-tx">
            <span className="ja-ac-ac">
              {actionParts(row.action).map((p, i) =>
                "flag" in p ? <Pill key={i} kind={kindOf(p.flag, kinds)} id={p.flag} /> : <Fragment key={i}>{p.text}</Fragment>,
              )}
            </span>
            {row.detail ? (
              <>
                {" "}
                <span className="ja-ac-dt">{row.detail}</span>
              </>
            ) : null}
          </span>
          {team ? (
            <button type="button" className="ja-ac-tc" aria-label={`Open team sheet for ${team.number} ${team.name}`} onClick={() => onOpenSheet(team.id)}>
              <span className="ja-ac-tcv">{team.number}</span>
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/* ---- the phone's Who sheet ---------------------------------------------------- */

/** A native <dialog> opened with showModal(), as the Sections sheet is: the actors present, Everyone first. */
function WhoSheet({ open, options, value, onPick, onClose }: { open: boolean; options: string[]; value: string; onPick: (who: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="ja-sheet ja-ac-wsheet"
      aria-modal="true"
      aria-labelledby={titleId}
      // Escape closes the dialog by itself; tell the tab. A close the tab asked for is not news.
      onClose={() => {
        if (open) onClose();
      }}
      // A click whose target is the dialog itself landed on the backdrop.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open ? (
        <>
          <div className="jg-grab" aria-hidden="true" />
          <div className="ja-sh-top">
            <h2 id={titleId}>Who</h2>
            <button type="button" className="ja-x" aria-label="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
          <ul className="ja-ac-wlist">
            {["", ...options].map((who) => (
              <li key={who}>
                <button type="button" className="ja-ac-wopt" aria-pressed={who === value} onClick={() => onPick(who)}>
                  {who || "Everyone"}
                  {who === value ? <CheckIcon /> : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </dialog>
  );
}
