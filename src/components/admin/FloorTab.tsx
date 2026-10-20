"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import { FlagSummary } from "@/components/Flags";
import { cancelAfterAsking } from "@/components/judge/logic";
import { Dot, StatusPill, WarnIcon } from "@/components/judge/parts";
import { hasLanguageGap } from "@/components/Language";
import { Banner, formatClock, formatMinutes } from "@/components/ui";
import { call } from "@/components/useAppState";
import { minutesSince } from "@/lib/judgeQueue";
import { STATUS_META, type Status } from "@/lib/status";
import type { AppState, ConflictRow, FlagRow, JudgeRow, PublicPanel, RequestRow, Team } from "@/lib/types";
import {
  allowedPanels,
  buildColumns,
  cardAction,
  chipLabel,
  chipSpeech,
  columnKey,
  conflictNote,
  coverTags,
  defaultColumnKey,
  divisionTag,
  gapNote,
  loadLine,
  sinceFor,
  teamCount,
  uncoveredLanguages,
  type FloorCard,
  type FloorColumn,
} from "./floorLogic";

/** The card whose "⋯" popover is open, and which of its two views it shows. */
export type FloorMenu = { id: string; view: "root" | "move" };

/** What the Floor does with a team. The container owns the writes. */
export type FloorActions = {
  /** Phone: show this panel's column. */
  onSelect: (key: string) => void;
  onMenu: (menu: FloorMenu | null) => void;
  /** Move the request one step on (On our way / Start interview / Finish). */
  onAdvance: (request: RequestRow) => void;
  onMove: (request: RequestRow, panelId: string) => void;
  onNotes: (team: Team) => void;
  /** Cancel the request. The container asks first. */
  onCancel: (team: Team, request: RequestRow) => void;
};

type Shared = {
  languages: AppState["languages"];
  flags: FlagRow[];
  flagKinds: AppState["flagKinds"];
  panels: PublicPanel[];
  conflicts: ConflictRow[];
  judges: JudgeRow[];
  now: number;
  /** The request id with a write in the air. */
  busy: string | null;
  menu: FloorMenu | null;
};

const STRIP: Status[] = ["requested", "acknowledged", "interviewing", "completed"];

/**
 * The Floor: every panel as a column of the teams in flight on it, with the
 * controls to unjam it. This is the container -- it owns the writes, the
 * confirm, the clock and which popover is open -- and FloorBoard draws it.
 */
export function FloorTab({
  state,
  refresh,
  onError,
  onNotes,
}: {
  state: AppState;
  refresh: () => Promise<void>;
  onError: (message: string | null) => void;
  onNotes: (team: Team) => void;
}) {
  const { ask, dialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [menu, setMenu] = useState<FloorMenu | null>(null);

  // The waits read the clock when they draw; this draws the board again every
  // 30 s so they do not go stale between polls.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const now = Date.now();

  const columns = useMemo(
    () => buildColumns(state.panels, state.teams, state.requests),
    [state.panels, state.teams, state.requests],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of state.requests) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [state.requests]);

  // A pick the panels no longer include (one was deleted) falls back to the default.
  const selected = columns.some((c) => columnKey(c) === picked) ? picked : defaultColumnKey(columns);

  /**
   * Requests with a write already in the air.
   *
   * A ref, not the `busy` state, because `busy` only stops a second tap once
   * React has re-rendered the button as disabled, and a double tap arrives
   * faster than that. Advance walks a status machine, so a duplicate does
   * not merely repeat: it steps the team an extra place. Checked and claimed
   * synchronously, so the second tap has already lost by the time it calls
   * anything.
   */
  const writing = useRef(new Set<string>());

  async function act(request: RequestRow, action: string, extra: Record<string, unknown> = {}) {
    if (writing.current.has(request.id)) return;
    writing.current.add(request.id);
    setBusy(request.id);
    onError(null);
    try {
      // `from`: the status this card is showing, so a stale screen is refused.
      await call(`/api/requests/${request.id}`, {
        method: "PATCH",
        body: { action, from: request.status, ...extra },
      });
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      writing.current.delete(request.id);
      setBusy(null);
    }
  }

  // Escape and a press outside both close the popover. Only listening while one is open.
  const open = menu?.id ?? null;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(null);
      document.getElementById(moreId(open))?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-ja-menu]")) setMenu(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <>
      <FloorBoard
        columns={columns}
        counts={counts}
        selected={selected}
        languages={state.languages}
        flags={state.flags}
        flagKinds={state.flagKinds}
        panels={state.panels}
        conflicts={state.conflicts}
        judges={state.judges}
        now={now}
        busy={busy}
        menu={menu}
        onSelect={setPicked}
        onMenu={setMenu}
        onAdvance={(request) => act(request, "advance")}
        onMove={(request, panelId) => {
          setMenu(null);
          return act(request, "reassign", { panelId });
        }}
        onNotes={(team) => {
          setMenu(null);
          onNotes(team);
        }}
        onCancel={(team, request) => {
          setMenu(null);
          return cancelAfterAsking(ask, team, request, () => act(request, "cancel"));
        }}
      />
      {dialog}
    </>
  );
}

const moreId = (requestId: string) => `ja-more-${requestId}`;

/** The Floor as markup: the top strip, the phone's panel switcher, and one column per panel. */
export function FloorBoard({
  columns,
  counts,
  selected,
  ...ctx
}: Shared &
  FloorActions & {
    columns: FloorColumn[];
    /** Requests by status, event-wide. */
    counts: Record<string, number>;
    /** The column the phone shows. */
    selected: string | null;
  }) {
  const inFlight = columns.reduce((n, c) => n + c.cards.length, 0);

  return (
    <div className="ja-floor">
      <div className="ja-strip">
        <section className="ja-cs" aria-label="Status counts">
          {STRIP.map((s) => (
            <div key={s}>
              <b>{counts[s] ?? 0}</b>
              <span>
                <Dot status={s} />
                {STATUS_META[s].short}
              </span>
            </div>
          ))}
        </section>
        <a className="ja-board" href="/board" target="_blank" rel="noopener">
          Open big-screen board ↗
        </a>
      </div>

      {!inFlight ? (
        <Banner kind="info">Nothing in flight. Teams will appear here as they request judges.</Banner>
      ) : null}

      {columns.length > 1 ? (
        <div className="ja-seg" role="group" aria-label="Panel">
          {columns.map((column) => {
            const key = columnKey(column);
            const { waiting } = loadLine(column.cards);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={key === selected}
                onClick={() => ctx.onSelect(key)}
              >
                <span aria-hidden="true">{column.panel ? chipLabel(column.panel.name) : "None"}</span>
                <small aria-hidden="true">{teamCount(column.cards.length)}</small>
                {waiting ? <i className="ja-pip" aria-hidden="true" /> : null}
                {uncoveredLanguages(column.panel, column.cards).length ? (
                  <i className="ja-pip ja-gap" aria-hidden="true" />
                ) : null}
                <span className="sr-only">{chipSpeech(column, ctx.languages)}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="ja-cols">
        {columns.map((column) => (
          <Column key={columnKey(column)} column={column} selected={columnKey(column) === selected} {...ctx} />
        ))}
      </div>
    </div>
  );
}

function Column({
  column,
  selected,
  ...ctx
}: Shared & FloorActions & { column: FloorColumn; selected: boolean }) {
  const { panel, cards } = column;
  const headId = useId();
  const load = loadLine(cards);
  const gaps = uncoveredLanguages(panel, cards);
  const label = (id: string) => ctx.languages.find((l) => l.id === id)?.label ?? id;

  return (
    <section className="ja-col" aria-labelledby={headId} data-selected={selected}>
      <header className="ja-ch">
        <h2 id={headId}>{panel?.name ?? "No panel"}</h2>
        {panel?.division ? <span className="jg-ptag">{panel.division}</span> : null}
        {panel && panel.languages.length ? (
          <span className="ja-tags">
            {coverTags(panel, ctx.languages).map((t) => (
              <span key={t.id} className="jg-ptag" lang={t.id}>
                {t.text}
              </span>
            ))}
          </span>
        ) : null}
        <p className="ja-jn">
          {panel ? panel.judges.join(", ") || "No judges listed" : "Their panel was deleted"}
        </p>
        <p className="ja-ld">
          {load.waiting ? <span className="ja-wt">{load.waitingText}</span> : load.waitingText} · {load.status}
        </p>
        {gaps.length ? (
          <span className="ja-gapp">
            <WarnIcon />
            <span>
              {gaps.map((id, i) => (
                <Fragment key={id}>
                  {i ? ", " : null}
                  <span lang={id}>{label(id)}</span>
                </Fragment>
              ))}{" "}
              not covered
            </span>
          </span>
        ) : null}
      </header>

      {cards.length ? (
        <ul className="ja-cl">
          {cards.map((card) => (
            <li key={card.request.id}>
              <Card card={card} panel={panel} {...ctx} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="ja-none">Nothing in flight</p>
      )}
    </section>
  );
}

function Card({
  card,
  panel,
  languages,
  flags,
  flagKinds,
  panels,
  conflicts,
  judges,
  now,
  busy,
  menu,
  onMenu,
  onAdvance,
  onMove,
  onNotes,
  onCancel,
}: Shared & FloorActions & { card: FloorCard; panel: PublicPanel | null }) {
  const { team, request } = card;
  const status = request.status;
  const action = cardAction(status);
  const working = busy === request.id;
  const since = sinceFor(request);
  const language = languages.find((l) => l.id === request.language);
  const gap = panel ? hasLanguageGap(panel.languages, request.language) : false;
  const mine = flags.filter((f) => f.team_id === team.id);
  const view = menu?.id === request.id ? menu.view : null;
  const reasonId = useId();

  const conflict = conflictNote(panel, team, conflicts, judges);

  // Where this interview may go: the current panel is where it already is.
  const targets = view
    ? allowedPanels(team, request.panel_id, panels, conflicts, judges).filter((p) => p.id !== request.panel_id)
    : [];

  return (
    <article className={`ja-card${status === "requested" ? " ja-w" : ""}`} aria-label={`${team.number} ${team.name}`}>
      <div className="ja-c1">
        <b>{team.number}</b>
        <span className="ja-cn">{team.name}</span>
      </div>

      <div className="ja-c2">
        <StatusPill status={status} short />
        {status === "scheduled" ? (
          <span className="ja-ctm">{formatClock(request.slot_start)}</span>
        ) : since ? (
          <span className={`ja-ctm${status === "requested" ? " ja-wt" : ""}`}>
            {formatMinutes(minutesSince(since, now))}
          </span>
        ) : null}
        {language ? (
          <span className={`jg-ptag${gap ? " ja-warn" : ""}`} lang={language.id} title={language.label}>
            {language.short}
          </span>
        ) : null}
        <FlagSummary flags={mine} kinds={flagKinds} />
      </div>

      {conflict ? (
        <div className="jg-caution ja-lw" role="note">
          <WarnIcon />
          <p>{conflict}</p>
        </div>
      ) : null}

      {gap && panel ? (
        <div className="jg-caution ja-lw" role="note">
          <WarnIcon />
          <p>{gapNote(panel, languages, request.language)}</p>
        </div>
      ) : null}

      <div className="ja-c4">
        {action ? (
          <button
            type="button"
            className={`ja-go jg-s-${action.to}`}
            disabled={working}
            onClick={() => onAdvance(request)}
          >
            {/* The label changes, not just the colour: a disabled button on
                venue wifi reads as a dead button, which is what had people
                tapping again. */}
            {working ? "Saving…" : action.label}
          </button>
        ) : null}

        <div className="ja-mw" data-ja-menu>
          <button
            type="button"
            id={moreId(request.id)}
            className="ja-more"
            aria-label={`More actions for ${team.number}: move, notes, cancel`}
            aria-haspopup="dialog"
            aria-expanded={view !== null}
            onClick={() => onMenu(view ? null : { id: request.id, view: "root" })}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>

          {view ? (
            <Popover
              label={view === "move" ? `Move ${team.number} to another panel` : `Actions for ${team.number}`}
              view={view}
            >
              {view === "move" ? (
                <>
                  <p className="ja-pop-h">Move to panel…</p>
                  {targets.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      className="ja-opt"
                      autoFocus={i === 0}
                      disabled={working}
                      onClick={() => onMove(request, p.id)}
                    >
                      <b>{p.name}</b>
                      {/* The short tag keeps "Panel B" on one line; the full name is still read out. */}
                      <span className="jg-ptag">
                        <span aria-hidden="true">{divisionTag(p.division)}</span>
                        <span className="sr-only">{p.division}</span>
                      </span>
                      <span className="ja-tags">
                        {coverTags(p, languages).map((t) => (
                          <span key={t.id} className="jg-ptag" lang={t.id}>
                            {t.text}
                          </span>
                        ))}
                      </span>
                    </button>
                  ))}
                  <p className="ja-pop-c">Only {team.division} panels without a conflict</p>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="ja-pi"
                    autoFocus={targets.length > 0}
                    disabled={!targets.length || working}
                    aria-describedby={targets.length ? undefined : reasonId}
                    onClick={() => onMenu({ id: request.id, view: "move" })}
                  >
                    Move to panel…
                  </button>
                  {targets.length ? null : (
                    <p id={reasonId} className="ja-pop-c">
                      No other {team.division} panel without a conflict
                    </p>
                  )}
                  <button type="button" className="ja-pi" autoFocus={targets.length === 0} onClick={() => onNotes(team)}>
                    Notes
                  </button>
                  <button
                    type="button"
                    className="ja-pi ja-danger"
                    disabled={working}
                    onClick={() => onCancel(team, request)}
                  >
                    Cancel request
                  </button>
                </>
              )}
            </Popover>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** The "⋯" popover, scrolled into view when it opens near the foot of the board. */
function Popover({ label, view, children }: { label: string; view: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [view]);
  return (
    <div ref={ref} className="ja-pop" role="dialog" aria-label={label}>
      {children}
    </div>
  );
}
