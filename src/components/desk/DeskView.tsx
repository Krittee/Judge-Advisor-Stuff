"use client";

/* eslint-disable @next/next/no-img-element -- a 28 px static avatar; next/image buys nothing here. */

import { useMemo } from "react";
import { CautionIcon, DeskSlots } from "./DeskSlots";
import { busyText, lookupState, nextFreeStart, slotKind, teamList, TONE } from "./deskLogic";
import { LanguageCover, LanguageTag, type Language } from "@/components/Language";
import { SignOutButton } from "@/components/judging";
import { panelLoad } from "@/components/SlotPicker";
import { Elapsed, formatClock } from "@/components/ui";
import { buildSlots } from "@/lib/data";
import { STATUS_META } from "@/lib/status";
import { filterTeamNumberInput, normalizeTeamNumber } from "@/lib/teamNumber";
import type { AppState, PublicPanel, RequestRow, Slot, Team } from "@/lib/types";

/**
 * The queue desk, drawn (direction B, "Now / Book", design/queue-redesign/).
 *
 * Everything it shows comes in as props and everything it does goes out as a
 * callback, so the page keeps the polling and every write. The desk never
 * advances an interview and never sees notes or scores; nothing here can.
 * Styles are under `.desk` in globals.css.
 */

export type DeskMode = "now" | "book";

export type DeskViewProps = {
  /** The desk person's name, under "Queue desk". */
  name?: string;
  online: boolean;
  teams: Team[];
  panels: PublicPanel[];
  requests: RequestRow[];
  languages: Language[];
  categories: AppState["categories"];

  mode: DeskMode;
  onMode: (mode: DeskMode) => void;
  /** What is typed, already filtered (filterTeamNumberInput). */
  number: string;
  onNumber: (number: string) => void;
  /** The team that number names, and its panel and live request or booking. */
  team: Team | null;
  panel: PublicPanel | null;
  existing: RequestRow | null;
  message: string;
  onMessage: (message: string) => void;
  bookLanguage: string;
  onBookLanguage: (id: string) => void;

  /** The booking being moved; set only while the team on screen is the one rescheduled. */
  reschedule: RequestRow | null;
  /** The start of the slot chosen in the grid. */
  picked: string | null;
  onPick: (start: string) => void;

  busy: boolean;
  error: string | null;
  ok: string | null;
  now?: number;

  /** Queue the team now, in this language (turns their booking into the request if they hold one). */
  onRequest: (language: string) => void;
  onUndo: (id: string) => void;
  onBook: (slot: Slot) => void;
  onMove: (slot: Slot) => void;
  onStartReschedule: (booking: RequestRow, teamNumber: string) => void;
  onStopReschedule: () => void;
  /** Cancel the booking being moved. The page asks first. */
  onCancelBooking: () => void;
};

function Caution({ children }: { children: React.ReactNode }) {
  return (
    <div className="dk-caution" role="note">
      <CautionIcon />
      <p>{children}</p>
    </div>
  );
}

export function DeskView(p: DeskViewProps) {
  const { team, panel, existing, reschedule, languages, busy } = p;
  const now = p.now ?? Date.now();

  const slots = useMemo(
    () => (panel ? buildSlots(panel, p.requests, p.teams, reschedule?.id) : []),
    [panel, p.requests, p.teams, reschedule],
  );
  const state = lookupState({
    number: p.number,
    team,
    panel,
    existing,
    roster: p.teams,
  });
  const moving = reschedule && state.kind === "booked" ? reschedule : null;

  // Only a slot that is still open counts as chosen: someone else may have taken it since.
  const chosen =
    slots.find(
      (s) =>
        s.start === p.picked &&
        slotKind(s, { teamId: team?.id ?? null, currentStart: moving?.slot_start ?? null, now }) === "open",
    ) ?? null;

  const panelById = useMemo(() => new Map(p.panels.map((x) => [x.id, x])), [p.panels]);
  const teamById = useMemo(() => new Map(p.teams.map((x) => [x.id, x])), [p.teams]);
  const live = useMemo(
    () =>
      p.requests
        .filter((r) => r.status === "requested" || r.status === "acknowledged")
        .sort((a, b) => a.requested_at.localeCompare(b.requested_at)),
    [p.requests],
  );
  const booked = useMemo(
    () =>
      p.requests
        .filter((r) => r.status === "scheduled")
        .sort((a, b) => (a.slot_start ?? "").localeCompare(b.slot_start ?? "")),
    [p.requests],
  );

  const allTeams = useMemo(() => teamList(p.teams, p.requests, p.number), [p.teams, p.requests, p.number]);
  const notFound = state.kind === "not-found";
  const canRequest = Boolean(team && panel) && state.kind === "ready";
  const category = team ? (p.categories.find((c) => c.id === team.category)?.label ?? team.category) : "";
  const nextFree = nextFreeStart(slots, now);
  const load = panel ? panelLoad(panel.id, p.requests) : null;

  const requestButtons = (disabled: boolean) => (
    <div className="dk-pair" role="group" aria-label="Request a judge now, by interview language">
      {languages.map((l) => (
        <button key={l.id} type="button" className="dk-prim dk-lg" disabled={disabled} onClick={() => p.onRequest(l.id)}>
          {`Request · ${l.label}`}
        </button>
      ))}
    </div>
  );

  const noteInput = (id: string) => (
    <input
      id={id}
      className="dk-input"
      type="text"
      value={p.message}
      onChange={(e) => p.onMessage(e.target.value)}
      maxLength={280}
      autoComplete="off"
      placeholder="Optional note for the judges"
    />
  );

  return (
    <div className="desk">
      <header className="dk-top">
        <div className="dk-who">
          <span className="dk-av">
            <img src="/avatars/queue-desk.jpg" alt="" width={28} height={28} />
          </span>
          <span className="dk-who-t">
            <b>Queue desk</b>
            {p.name ? <span>{p.name}</span> : null}
          </span>
        </div>
        {/* Room for the theme toggle, which docks into the top-right corner here. */}
        <div className="dk-top-r">
          <span className="dk-live" data-online={p.online}>
            <i aria-hidden="true" />
            {p.online ? "Live" : "Reconnecting"}
          </span>
          <SignOutButton to="/queue/login" />
        </div>
      </header>

      <section className="dk-mbar" aria-label="What to do">
        <div className="dk-seg" role="group" aria-label="Request type">
          {(["now", "book"] as const).map((id) => (
            <button key={id} type="button" aria-pressed={p.mode === id} onClick={() => p.onMode(id)}>
              {id === "now" ? "Now" : "Book"}
            </button>
          ))}
        </div>
      </section>

      <main className="dk-body">
        {moving ? (
          <div className="dk-mv" role="status">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 7h11l-3-3M17 17H6l3 3" />
            </svg>
            <p>
              Moving <b>{team?.number}</b> from <b>{formatClock(moving.slot_start)}</b>
            </p>
            <button type="button" className="dk-quiet" onClick={p.onStopReschedule}>
              Stop
            </button>
          </div>
        ) : null}

        {/* ---- team number and what we know about it ---- */}
        <div>
          <label className="dk-lab" htmlFor="dk-team">
            <span>Team number</span>
          </label>
          <input
            id="dk-team"
            className={`dk-input dk-big${notFound ? " dk-err" : ""}`}
            type="text"
            value={p.number}
            onChange={(e) => p.onNumber(filterTeamNumberInput(e.target.value))}
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            placeholder="0000"
            aria-invalid={notFound ? true : undefined}
            aria-describedby={notFound ? "dk-nf" : undefined}
          />
          {team ? (
            <p className="dk-tline">
              <span>
                <b>{team.name}</b>
                {category ? ` · ${category}` : ""}
                {team.pit ? ` · Pit ${team.pit}` : ""}
              </span>
              {panel && load ? (
                <span>
                  {panel.name} · {panel.division} · {busyText(load)}
                  {nextFree ? (
                    <>
                      {" "}
                      · next free <b>{formatClock(nextFree)}</b>
                    </>
                  ) : null}
                </span>
              ) : null}
            </p>
          ) : null}
          {notFound ? (
            <p className="dk-errln" id="dk-nf">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5v5.5M12 16.5v.01" />
              </svg>
              <span>No team {normalizeTeamNumber(p.number)} at this event.</span>
            </p>
          ) : null}
        </div>

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

        {/* ---- the team already has something: that replaces the actions ---- */}
        {state.kind === "waiting" ? (
          <section className="dk-ex">
            <div className="dk-stl">
              <span className={`dk-sc dk-s-${TONE[state.request.status]}`}>
                {STATUS_META[state.request.status].label} ·{"\u00a0"}<Elapsed since={state.request.requested_at} />
              </span>
              <span className="dk-lt">
                <LanguageTag language={state.request.language} languages={languages} />
              </span>
            </div>
            <Caution>Already in the queue. A team can&apos;t be added twice.</Caution>
            {state.request.status === "requested" ? (
              <div className="dk-undo">
                <button type="button" className="dk-quiet" onClick={() => p.onUndo(state.request.id)}>
                  Undo request
                </button>
                <p>Only before judges acknowledge</p>
              </div>
            ) : null}
          </section>
        ) : null}

        {state.kind === "booked" && !moving && team ? (
          <section className="dk-ex">
            <Caution>
              Booked for {formatClock(state.booking.slot_start)} on{" "}
              {panelById.get(state.booking.panel_id ?? "")?.name ?? panel?.name ?? "a panel"}.
            </Caution>
            {languages.length > 1 ? (
              <>
                <button type="button" className="dk-out" disabled={busy} onClick={() => p.onStartReschedule(state.booking, team.number)}>
                  Reschedule
                </button>
                <div className="dk-pair" role="group" aria-label="Request now instead, by interview language">
                  {languages.map((l) => (
                    <button key={l.id} type="button" className="dk-prim dk-lg" disabled={busy} onClick={() => p.onRequest(l.id)}>
                      {`Now · ${l.label}`}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="dk-pair dk-rq" role="group" aria-label="What to do with the booking">
                <button type="button" className="dk-out" disabled={busy} onClick={() => p.onStartReschedule(state.booking, team.number)}>
                  Reschedule
                </button>
                <button type="button" className="dk-prim dk-lg" disabled={busy} onClick={() => p.onRequest(languages[0]?.id ?? "")}>
                  Request now instead
                </button>
              </div>
            )}
            <p className="dk-cap">Requesting now frees their {formatClock(state.booking.slot_start)} slot.</p>
          </section>
        ) : null}

        {/* ---- Now: one button per language ---- */}
        {p.mode === "now" && (state.kind === "ready" || state.kind === "none") ? (
          <div>
            <label className="sr-only" htmlFor="dk-note">
              Note for the judges, optional
            </label>
            {noteInput("dk-note")}
            <div style={{ marginTop: 8 }}>{requestButtons(busy || !canRequest)}</div>
            {team && panel ? (
              <div className="dk-cover">
                <LanguageCover panel={panel} languages={languages} />
              </div>
            ) : null}
          </div>
        ) : null}

        {state.kind === "no-panel" ? (
          <section className="dk-ex">
            <Caution>No judge panel assigned yet. Ask the Judge Advisor.</Caution>
            {p.mode === "now" ? requestButtons(true) : null}
          </section>
        ) : null}

        {/* ---- Book: language and note, then the panel's slots ---- */}
        {p.mode === "book" && state.kind === "none" ? (
          <p className="dk-hint">Enter a team number to see their panel&apos;s times.</p>
        ) : null}

        {p.mode === "book" && state.kind === "ready" && team && panel ? (
          <>
            <div className="dk-two">
              <div>
                <label className="dk-lab" htmlFor="dk-lang">
                  <span>Language</span>
                </label>
                <div className="dk-selw">
                  <select id="dk-lang" className="dk-input dk-sel" value={p.bookLanguage} onChange={(e) => p.onBookLanguage(e.target.value)}>
                    {languages.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>
              </div>
              <div>
                <label className="dk-lab" htmlFor="dk-bnote">
                  <span>Note</span>
                  <span className="dk-tag">Optional</span>
                </label>
                <input
                  id="dk-bnote"
                  className="dk-input"
                  type="text"
                  value={p.message}
                  onChange={(e) => p.onMessage(e.target.value)}
                  maxLength={280}
                  autoComplete="off"
                  placeholder="For the judges"
                />
              </div>
            </div>
            <div className="dk-cover">
              <LanguageCover panel={panel} languages={languages} asking={p.bookLanguage} />
            </div>
            <DeskSlots panel={panel} slots={slots} teamId={team.id} picked={p.picked} disabled={busy} onPick={(s) => p.onPick(s.start)} now={now} />
            <div className="dk-pin">
              <button type="button" className="dk-prim dk-lg" disabled={busy || !chosen} onClick={() => chosen && p.onBook(chosen)}>
                {chosen ? `Book ${formatClock(chosen.start)} · ${team.number}` : "Book · pick a time"}
              </button>
            </div>
          </>
        ) : null}

        {moving && team && panel ? (
          <div>
            <DeskSlots
              panel={panel}
              slots={slots}
              teamId={team.id}
              currentStart={moving.slot_start}
              picked={p.picked}
              disabled={busy}
              onPick={(s) => p.onPick(s.start)}
              now={now}
            />
            <p className="dk-cover">Language and note stay as booked.</p>
          </div>
        ) : null}

        {/* ---- what is already happening ---- */}
        {p.mode === "now" ? (
          <section className="dk-grp" aria-labelledby="dk-w-h">
            <h2 className="dk-sec" id="dk-w-h">
              Waiting now · {live.length}
            </h2>
            <ul className="dk-grp">
              {live.map((r) => {
                const t = teamById.get(r.team_id);
                if (!t) return null;
                return (
                  <li key={r.id} className={`dk-qrow${r.status === "requested" ? " dk-qw" : ""}`}>
                    <div className="dk-qmain">
                      <span className="dk-qt">
                        <span className="dk-q1">
                          <b>{t.number}</b>
                          <span>{t.name}</span>
                        </span>
                        <span className="dk-q2">
                          <span className={`dk-sc dk-s-${TONE[r.status]}`}>{STATUS_META[r.status].label}</span>
                          <span className={r.status === "requested" ? "dk-wt" : "dk-el"}>
                            <Elapsed since={r.requested_at} />
                          </span>
                          <span className="dk-lt">
                            <LanguageTag language={r.language} languages={languages} />
                          </span>
                          <span>{panelById.get(r.panel_id ?? "")?.name ?? "—"}</span>
                        </span>
                      </span>
                    </div>
                    {r.status === "requested" ? (
                      <button type="button" className="dk-quiet" aria-label={`Undo request for ${t.number}`} onClick={() => p.onUndo(r.id)} title="Undo a mis-entry. Only works before judges acknowledge it.">
                        Undo
                      </button>
                    ) : null}
                  </li>
                );
              })}
              {!live.length ? <li className="dk-empty">Nobody waiting.</li> : null}
            </ul>
          </section>
        ) : null}

        {p.mode === "book" && !moving && booked.length ? (
          <section className="dk-grp" aria-labelledby="dk-b-h">
            <h2 className="dk-sec" id="dk-b-h">
              Booked later · {booked.length}
            </h2>
            <ul className="dk-grp">
              {booked.map((r) => {
                const t = teamById.get(r.team_id);
                if (!t) return null;
                return (
                  <li key={r.id} className="dk-qrow">
                    <div className="dk-qmain">
                      <span className="dk-sc dk-s-booked dk-tm">{formatClock(r.slot_start)}</span>
                      <span className="dk-qt">
                        <span className="dk-q1">
                          <b>{t.number}</b>
                          <span>{t.name}</span>
                        </span>
                        <span className="dk-q2">{panelById.get(r.panel_id ?? "")?.name ?? "—"}</span>
                      </span>
                    </div>
                    <button
                      type="button"
                      className="dk-quiet"
                      aria-label={`Reschedule ${t.number}`}
                      title="Move this team to a different time instead of cancelling and booking again"
                      onClick={() => p.onStartReschedule(r, t.number)}
                    >
                      Reschedule
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* ---- every team, to scroll and tap ---- */}
        {!moving ? (
          <section className="dk-grp" aria-labelledby="dk-t-h">
            <h2 className="dk-sec" id="dk-t-h">
              {p.number
                ? `All teams · ${allTeams.length} of ${p.teams.length}`
                : `All teams · ${p.teams.length}`}
            </h2>
            <ul className="dk-grp">
              {allTeams.map(({ team: t, request: r }) => {
                const pn = panelById.get(t.panel_id ?? "")?.name;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="dk-qrow dk-trow"
                      aria-label={`Select team ${t.number}, ${t.name}`}
                      aria-pressed={team?.id === t.id}
                      onClick={() => {
                        p.onNumber(t.number);
                        window.scrollTo({ top: 0 });
                      }}
                    >
                      <span className="dk-qmain">
                        <span className="dk-qt">
                          <span className="dk-q1">
                            <b>{t.number}</b>
                            <span>{t.name}</span>
                          </span>
                          <span className="dk-q2">
                            <span className={pn ? undefined : "dk-np"}>{pn ?? "No panel"}</span>
                            {r ? (
                              r.status === "scheduled" ? (
                                <span className="dk-sc dk-s-booked dk-tm">{formatClock(r.slot_start)}</span>
                              ) : (
                                <span className={`dk-sc dk-s-${TONE[r.status]}`}>{STATUS_META[r.status].label}</span>
                              )
                            ) : null}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {!allTeams.length ? (
                <li className="dk-empty">{p.number ? `No team matches ${normalizeTeamNumber(p.number)}.` : "No teams yet."}</li>
              ) : null}
            </ul>
          </section>
        ) : null}
      </main>

      {/* ---- pinned while moving a booking ---- */}
      {moving && team ? (
        <div className="dk-abar">
          <button type="button" className="dk-prim dk-lg" disabled={busy || !chosen} onClick={() => chosen && p.onMove(chosen)}>
            {chosen ? `Move to ${formatClock(chosen.start)}` : "Move · pick a time"}
          </button>
          <div className="dk-sub">
            <button type="button" className="dk-quiet dk-dg" disabled={busy} onClick={p.onCancelBooking}>
              Cancel booking
            </button>
            <span>Asks first</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
