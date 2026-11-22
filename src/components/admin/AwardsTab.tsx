"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import { BandPill, ChevronDown, CloseIcon } from "@/components/judge/parts";
import { hhmm } from "@/components/marketing/marketingLogic";
import { sentUnder } from "@/lib/releases";
import { Banner } from "@/components/ui";
import { call, useScores } from "@/components/useAppState";
import { rankTeams } from "@/lib/ranking";
import type { Rubric } from "@/lib/rubrics";
import { setupDivisions } from "@/lib/eventSetup";
import type { AppState, AwardReleaseRow, AwardsAdminView, AwardView, RecallAllReply, ReleasedView, SendAllReply, Team } from "@/lib/types";
import {
  ALL_PANELS,
  backing,
  backingText,
  buildAwardPanels,
  buildMatrix,
  clearAfterAsking,
  clearNoWinnerAfterAsking,
  conductIn,
  conductKeyText,
  conductLine,
  conductText,
  decidedCount,
  decidedText,
  detailFor,
  eventNotReadyLines,
  distinctTeams,
  fullText,
  giveAfterAsking,
  hasText,
  hiddenNote,
  holdsText,
  JA_KEY,
  loadView,
  markNoWinnerAfterAsking,
  nominateAsAdmin,
  noWinnersOf,
  nominationsIn,
  nominationsText,
  notReadyLines,
  panelChips,
  readyToSend,
  recallAllLines,
  recallQuestion,
  refereeLine,
  releaseOf,
  removeAfterAsking,
  saveView,
  scoreParts,
  sendAllLines,
  sendState,
  skippedText,
  snapshotLine,
  teamsByNumber,
  winnersOf,
  type AwardPanel,
  type BlendedSel,
  type Detail,
  type Matrix,
  type Nominee,
  type Sel,
  type SendState,
  type View,
} from "./awardsLogic";
import { BlendedBoard } from "./BlendedAwards";
import { divisionTag } from "./floorLogic";
import { withRanks, type RankedRow } from "./scoresLogic";

function Glyph({ size = 16, strokeWidth = 1.9, children }: { size?: number; strokeWidth?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
export const Tick = ({ size = 12, strokeWidth = 2.6 }: { size?: number; strokeWidth?: number }) => (
  <Glyph size={size} strokeWidth={strokeWidth}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Glyph>
);
export const LockIcon = () => (
  <Glyph>
    <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
  </Glyph>
);
export const Arrow = ({ size }: { size: number }) => (
  <Glyph size={size} strokeWidth={2.2}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Glyph>
);
export const CautionIcon = ({ size }: { size: number }) => (
  <Glyph size={size} strokeWidth={2}>
    <path d="M12 3.5l9.5 16.5h-19L12 3.5zM12 10v4.5M12 17.2v.01" />
  </Glyph>
);

/** `eventSetup` is the saved setup, if any: a blended one swaps the board for BlendedBoard. */
export type Slice = Pick<AppState, "teams" | "panels" | "divisions" | "flags" | "flagKinds"> & { eventSetup?: AppState["eventSetup"] };

/** The side panel is a column from 1024px, the Sections sheet's own breakpoint; below it, a bottom sheet. */
const WIDE = "(min-width: 1024px)";
function useWide(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

/**
 * The Awards section: every nomination the judges made, and the Judge
 * Advisor's pick for each award. One board, read two ways (a team-by-award
 * matrix, or a list per award); either opens the same side panel on a
 * nominee, which is where a winner is given, replaced or cleared.
 *
 * `data` is the page's /api/awards fetch (the rail counts the decided awards
 * from it too), so winners never travel in /api/state. Replacing or clearing
 * a winner asks first, through `useConfirm`.
 *
 * The Judge Advisor can also nominate any team of the division for any award
 * (Add team, in By award; Also nominate for…, in the side panel) and remove
 * any nomination, a judge's included (Remove, asked first the same way).
 *
 * `released` is what has been sent to the Awards Desk (Marketing). Send, Recall
 * and Send all ready go through the same `write()` guard as every other change,
 * so the board is read again, awards and sends together, once each lands.
 */
export function AwardsTab({
  state,
  data,
  released,
  error,
  reload,
  division,
  onDivision,
  onError,
}: {
  state: Slice & Pick<AppState, "categories">;
  /** Null until the first answer. */
  data: AwardsAdminView | null;
  /** What has been sent to Marketing; null until the first answer, when the board draws no send control. */
  released: ReleasedView | null;
  error: string | null;
  /** Asks again now; resolves once the answer is in. */
  reload: () => Promise<void>;
  division: string;
  onDivision: (division: string) => void;
  onError: (message: string | null) => void;
}) {
  const [view, setView] = useState<View>(loadView);
  const [panelId, setPanelId] = useState(ALL_PANELS);
  const [sel, setSel] = useState<(Sel & { key?: string }) | null>(null);
  // Blended: which division's nominees the rows show ("" is All).
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const { ask, dialog } = useConfirm();
  const wide = useWide();
  // Only while this section is open: nothing else on the console reads rubric totals.
  const scoreData = useScores();
  const rows = useMemo(
    () => withRanks(rankTeams(state.teams, scoreData.scores, scoreData.rubrics, state.categories)),
    [state.teams, state.categories, scoreData.scores, scoreData.rubrics],
  );

  if (!data) return error ? <Banner kind="error">{error}</Banner> : <p className="ja-empty">Loading…</p>;

  // One write at a time: a second tap while the first is asking or in the air is ignored.
  const write = async (job: () => Promise<boolean>) => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    try {
      if (await job()) {
        onError(null);
        await reload();
      }
    } catch (e) {
      onError((e as Error).message);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };

  const releases = released?.releases ?? [];
  // A blended event is decided under each of the program's divisions and under "Whole event"; any other keeps the console's divisions.
  const setupKeys = state.eventSetup?.format === "blended" ? setupDivisions(state.eventSetup) : null;
  const keys = setupKeys ?? state.divisions;
  const format = setupKeys ? ("blended" as const) : undefined;

  // The writes below take the key the award is decided under: the division on the standard board, a division or "Whole event" on the blended one.
  // Sending is undone by Recall, so it does not ask; Recall does, since Marketing sees the award go.
  const sendAward = (awardId: string, division: string) =>
    write(async () => {
      await call("/api/awards/released", { method: "PUT", body: { awardId, division } });
      return true;
    });
  const recallAward = (awardId: string, division: string) => {
    const award = data.awards.find((a) => a.id === awardId);
    if (!award) return;
    const { question, body } = recallQuestion(award.label, division);
    void write(async () => {
      if (!(await ask(question, { body, confirmLabel: "Recall", danger: true }))) return false;
      await call("/api/awards/released", { method: "DELETE", body: { awardId, division } });
      return true;
    });
  };
  const markNoWinner = (awardId: string, division: string) => {
    const award = data.awards.find((a) => a.id === awardId);
    const held = new Set(data.winners.filter((w) => w.award_id === awardId && w.division === division).map((w) => w.team_id));
    if (award) void write(() => markNoWinnerAfterAsking(ask, call, { award, division, holders: state.teams.filter((t) => held.has(t.id)) }));
  };
  const clearNoWinner = (awardId: string, division: string) => {
    const award = data.awards.find((a) => a.id === awardId);
    if (award) void write(() => clearNoWinnerAfterAsking(ask, call, { award, division }));
  };

  const recallAll = () => {
    const lines = recallAllLines(releases, data.awards);
    if (!lines.length) return;
    const n = lines.length;
    void write(async () => {
      const question = n === 1 ? "Recall 1 award from Marketing?" : `Recall ${n} awards from Marketing?`;
      if (!(await ask(question, { body: <RecallAllBody lines={lines} />, confirmLabel: `Recall ${n}`, danger: true }))) return false;
      await call<RecallAllReply>("/api/awards/released?all=1", { method: "DELETE" });
      return true;
    });
  };

  const sendAll = () => {
    const items = readyToSend(data.awards, keys, data.winners, data.noWinners, releases, format);
    if (!items.length) return;
    const lines = sendAllLines(items, data.winners, data.noWinners, state.teams, releases);
    const notReady = setupKeys
      ? eventNotReadyLines(data.awards, keys, data.winners, data.noWinners, releases, format)
      : notReadyLines(data.awards, division, data.winners, data.noWinners, releases);
    // The banner has to come after write() has cleared the last error and reloaded, or it would be wiped at once.
    const skipped: { text: string | null } = { text: null };
    void (async () => {
      await write(async () => {
        const question = items.length === 1 ? "Send 1 award to Marketing?" : `Send ${items.length} awards to Marketing?`;
        if (!(await ask(question, { body: <SendAllBody lines={lines} notReady={notReady} />, confirmLabel: `Send ${items.length}` }))) return false;
        const reply = await call<SendAllReply>("/api/awards/released", { method: "POST" });
        skipped.text = skippedText(reply.skipped, new Set(lines.map((l) => l.key)), data.awards);
        return true;
      });
      if (skipped.text) onError(skipped.text);
    })();
  };

  if (setupKeys && state.eventSetup) {
    return (
      <>
        <BlendedBoard
          data={data}
          released={released}
          state={state}
          setup={state.eventSetup}
          rows={rows}
          rubricList={scoreData.rubrics}
          from={from}
          onFrom={setFrom}
          panelId={panelId}
          onPanel={setPanelId}
          view={view}
          onView={(next) => {
            setView(next);
            saveView(next);
          }}
          sel={sel?.key ? (sel as BlendedSel) : null}
          onSelect={setSel}
          wide={wide}
          busy={busy}
          onGive={(d, key) => write(() => giveAfterAsking(ask, call, { award: d.award, team: d.team, current: d.current, noWinner: d.noWinner, division: key }))}
          onClear={(d, key) => write(() => clearAfterAsking(ask, call, { award: d.award, team: d.team, division: key }))}
          onMarkNoWinner={(awardId, key) => markNoWinner(awardId, key)}
          onClearNoWinner={(awardId, key) => clearNoWinner(awardId, key)}
          onNominate={(awardId, teamId) => write(() => nominateAsAdmin(call, { awardId, teamId }))}
          onRemove={(d, line) => write(() => removeAfterAsking(ask, call, { ...line, award: d.award, team: d.team }))}
          onSend={(awardId, key) => sendAward(awardId, key)}
          onRecall={(awardId, key) => recallAward(awardId, key)}
          onSendAll={sendAll}
          onRecallAll={recallAll}
        />
        {dialog}
      </>
    );
  }

  return (
    <>
      <AwardsBoard
        data={data}
        released={released}
        state={state}
        rows={rows}
        rubricList={scoreData.rubrics}
        division={division}
        onDivision={(next) => {
          // A panel or a nominee of one division means nothing in the next.
          setPanelId(ALL_PANELS);
          setSel(null);
          onDivision(next);
        }}
        panelId={panelId}
        onPanel={setPanelId}
        view={view}
        onView={(next) => {
          setView(next);
          saveView(next);
        }}
        sel={sel}
        onSelect={setSel}
        wide={wide}
        busy={busy}
        onGive={(d) => write(() => giveAfterAsking(ask, call, { award: d.award, team: d.team, current: d.current, noWinner: d.noWinner }))}
        onClear={(d) => write(() => clearAfterAsking(ask, call, { award: d.award, team: d.team }))}
        onMarkNoWinner={(awardId) => markNoWinner(awardId, division)}
        onClearNoWinner={(awardId) => clearNoWinner(awardId, division)}
        onNominate={(awardId, teamId) => write(() => nominateAsAdmin(call, { awardId, teamId }))}
        onRemove={(d, line) => write(() => removeAfterAsking(ask, call, { ...line, award: d.award, team: d.team }))}
        onSend={(awardId) => sendAward(awardId, division)}
        onRecall={(awardId) => recallAward(awardId, division)}
        onSendAll={sendAll}
        onRecallAll={recallAll}
      />
      {dialog}
    </>
  );
}

/** What the Recall all dialog says under its question: what Marketing will see, and one line per award that will be taken back. */
function RecallAllBody({ lines }: { lines: { key: string; text: string }[] }) {
  return (
    <>
      <p>Marketing will see each of these as &quot;Being updated&quot; until you send it again. Each one unlocks so you can change its winner.</p>
      <ul className="ja-aw-sl" aria-label="Awards that will be recalled">
        {lines.map((l) => (
          <li key={l.key}>
            <span>{l.text}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * What the Send all ready dialog lists under its question: one line per award it will send, a caution under any that changes what Marketing
 * has, and, muted, the awards of this division that are not ready and so are left out.
 */
function SendAllBody({ lines, notReady }: { lines: { key: string; text: string; was: string | null }[]; notReady: string[] }) {
  return (
    <>
      <ul className="ja-aw-sl" aria-label="Awards that will be sent">
        {lines.map((l) => (
          <li key={l.key}>
            <span>{l.text}</span>
            {l.was ? (
              <span className="ja-aw-cw">
                <CautionIcon size={13} />
                <span>Changes what Marketing has: was {l.was}</span>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {notReady.length ? (
        <ul className="ja-aw-dnote">
          {notReady.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/* ---- the page ------------------------------------------------------------- */

/**
 * The title and filters, then the matrix or the per-award lists, and the side
 * panel. Everything it shows comes in as props, so the markup can be checked
 * without a browser; `AwardsTab` owns the state. From 1024px the panel is a
 * column beside the board; on a phone it is a bottom sheet over it.
 */
export function AwardsBoard({
  data,
  released = null,
  state,
  rows,
  rubricList,
  division,
  onDivision,
  panelId = ALL_PANELS,
  onPanel,
  view,
  onView,
  sel,
  onSelect,
  wide = true,
  busy = false,
  onGive,
  onClear,
  onMarkNoWinner,
  onClearNoWinner,
  onNominate,
  onRemove,
  onSend = () => {},
  onRecall = () => {},
  onSendAll = () => {},
  onRecallAll = () => {},
}: {
  data: AwardsAdminView;
  /** What has been sent to Marketing. Null (not asked yet): no Send, Recall, lock or count is drawn. */
  released?: ReleasedView | null;
  state: Slice;
  /** withRanks: the Scores tab's rows, for the panel's totals and band. Empty until the scores arrive. */
  rows: RankedRow[];
  rubricList: Rubric[];
  division: string;
  onDivision: (division: string) => void;
  /** "" is every panel. */
  panelId?: string;
  onPanel: (panelId: string) => void;
  view: View;
  onView: (view: View) => void;
  sel: Sel | null;
  /** Null clears it. */
  onSelect: (sel: Sel | null) => void;
  wide?: boolean;
  busy?: boolean;
  onGive: (detail: Detail) => void;
  onClear: (detail: Detail) => void;
  /** The Judge Advisor marks an award "No winner" in this division, or takes the mark off: the award's id. */
  onMarkNoWinner: (awardId: string) => void;
  onClearNoWinner: (awardId: string) => void;
  /** The Judge Advisor nominates a team for an award. */
  onNominate: (awardId: string, teamId: string) => void;
  /** The Judge Advisor removes one nomination, a judge's or their own: its id, and whose it is for the question. */
  onRemove: (detail: Detail, line: { id: string; by: string }) => void;
  /** Send one award of this division to Marketing, at once; Recall (asked first) takes it back. */
  onSend?: (awardId: string) => void;
  onRecall?: (awardId: string) => void;
  /** Send everything that is ready, in every division (the tab asks first). */
  onSendAll?: () => void;
  /** Take back everything sent, in every division (the tab asks first). */
  onRecallAll?: () => void;
}) {
  const uid = useId();
  const { awards, nominations, winners, noWinners } = data;
  const { teams, panels, divisions, flags, flagKinds } = state;

  if (!awards.length) return <p className="ja-empty">No awards are set up. They are listed in config/event.json.</p>;
  if (!divisions.length) return <p className="ja-empty">No divisions yet.</p>;

  const panelsHere = panels.filter((p) => p.division === division);
  const panel = panelsHere.find((p) => p.id === panelId) ?? null;
  const inDivision = nominationsIn(nominations, teams, division);
  const scoped = nominationsIn(nominations, teams, division, panel?.id);
  const conduct = conductIn(flags, teams, division, panel?.id);
  const decided = winnersOf(winners, division);
  const none = noWinnersOf(noWinners, division);
  const detail = sel ? detailFor(sel, { awards, nominations, winners, noWinners, teams, panels, flags }) : null;
  const teamsHere = teams.filter((t) => t.division === division);
  const titleId = `${uid}-t`;
  const matrix = buildMatrix(awards, scoped, decided, teamsHere, panels, panel?.id, conduct, none);
  const releases = released?.releases ?? [];
  const states = new Map(awards.map((a) => [a.id, sendState(a, division, winners, noWinners, releases)]));
  // A sent award is locked: the matrix marks its column, and its winner cannot be changed until it is recalled.
  const sent = new Set([...states].filter(([, state]) => state === "sent").map(([id]) => id));
  const readyCount = readyToSend(awards, divisions, winners, noWinners, releases).length;
  const sentCount = releases.filter((r) => r.status === "sent").length;
  const sentRelease = detail && sent.has(detail.award.id) ? releaseOf(releases, detail.award.id, division) : null;

  const nominee = detail ? (
    <NomineePanel
      detail={detail}
      row={rows.find((r) => r.team.id === detail.team.id)}
      rubricList={rubricList}
      flags={flags.filter((f) => f.team_id === detail.team.id)}
      flagKinds={flagKinds}
      titleId={titleId}
      busy={busy}
      sentAt={sentRelease?.sent_at ?? null}
      onGive={onGive}
      onClear={onClear}
      onNominate={onNominate}
      onRemove={onRemove}
    />
  ) : null;

  return (
    <div className="ja-aw">
      <div className="ja-aw-top">
        <h2 className="ja-aw-h">Awards</h2>
        <p className="ja-aw-meta">
          {division} · {panel ? panel.name : "all panels"} · <b>{decidedCount(winners, awards, division, noWinners)} of {awards.length}</b> decided · {nominationsText(scoped.length + conduct.size, distinctTeams(scoped, conduct.keys()))}
          {released ? ` · ${sentUnder(releases, division, awards.map((a) => a.id))} sent to Marketing` : null}
        </p>
        <p className="ja-aw-priv">
          <LockIcon />
          Winners stay private to you until the ceremony
        </p>
      </div>

      <div className="ja-aw-fbar">
        <div className="ja-aw-fg" role="group" aria-labelledby={`${uid}-d`}>
          <span id={`${uid}-d`} className="ja-aw-cl">
            Division
          </span>
          <div className="ja-aw-chips">
            {divisions.map((d) => (
              <button key={d} type="button" className="ja-aw-chip" aria-pressed={d === division} title={divisionTag(d) !== d ? d : undefined} onClick={() => onDivision(d)}>
                <span aria-hidden="true">{divisionTag(d)}</span>
                <span className="sr-only">{d}</span>
                <span className="ja-aw-fn">
                  {decidedText(winners, awards, d, noWinners)}
                  <span className="sr-only"> decided</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        {panelsHere.length ? (
          <div className="ja-aw-fg" role="group" aria-labelledby={`${uid}-p`}>
            <span id={`${uid}-p`} className="ja-aw-cl">
              Panel
            </span>
            <div className="ja-aw-chips">
              {panelChips(panelsHere, inDivision, conduct).map((c) => (
                <button key={c.id} type="button" className="ja-aw-chip" aria-pressed={c.id === (panel?.id ?? ALL_PANELS)} onClick={() => onPanel(c.id)}>
                  {c.label}
                  <span className="ja-aw-fn">
                    {c.count}
                    <span className="sr-only"> {c.count === 1 ? "team" : "teams"}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="ja-aw-fr">
          <ViewToggle view={view} onView={onView} />
          {released ? (
            <button type="button" className="ja-aw-sall" disabled={busy || readyCount === 0} title={readyCount === 0 ? "Nothing is ready to send" : undefined} onClick={onSendAll}>
              {`Send all ready (${readyCount})`}
              <Arrow size={15} />
            </button>
          ) : null}
          {released ? (
            <button type="button" className="ja-aw-rall" disabled={busy || sentCount === 0} title={sentCount === 0 ? "Nothing is sent to Marketing" : undefined} onClick={onRecallAll}>
              {`Recall all (${sentCount})`}
            </button>
          ) : null}
        </div>
      </div>

      <div className="ja-aw-cols">
        <div className="ja-aw-view">
          {view === "matrix" ? (
            <MatrixView
              matrix={matrix}
              sel={sel}
              note={hiddenNote(matrix.hidden, panel?.name ?? null)}
              none={`No nominations in ${division}${panel ? ` from ${panel.name}` : ""} yet. Judges nominate the teams they have interviewed.`}
              sent={sent}
              onSelect={onSelect}
            />
          ) : (
            <AwardLists
              lists={buildAwardPanels(awards, scoped, decided, teamsHere, panels, panel?.id, conduct, none)}
              sel={sel}
              onSelect={onSelect}
              noWinner={{ busy, onMark: onMarkNoWinner, onClear: onClearNoWinner }}
              send={released ? { states, releases, held: decided, division, busy, onSend, onRecall } : undefined}
              // The Judge Advisor's nominations belong to no panel, so one added under a panel's filter would not show: Add team is for All panels.
              add={panel ? undefined : { teams: teamsByNumber(teamsHere), busy, onAdd: onNominate }}
            />
          )}
        </div>
        {wide ? (
          detail ? (
            <aside className="ja-aw-dr" aria-label={`${detail.award.label} · ${detail.team.number}`}>
              {nominee}
            </aside>
          ) : (
            <aside className="ja-aw-dr ja-aw-dr0" aria-label="Nominee">
              <p>Pick a nomination to see who made it, and why.</p>
            </aside>
          )
        ) : (
          <PanelSheet open={detail !== null} titleId={titleId} onClose={() => onSelect(null)}>
            {nominee}
          </PanelSheet>
        )}
      </div>
    </div>
  );
}

/** Matrix | By award. Pressed is the view on show. */
export function ViewToggle({ view, onView }: { view: View; onView: (view: View) => void }) {
  return (
    <div className="ja-aw-seg" role="group" aria-label="View">
      <button type="button" aria-pressed={view === "matrix"} onClick={() => onView("matrix")}>
        Matrix
      </button>
      <button type="button" aria-pressed={view === "award"} onClick={() => onView("award")}>
        By award
      </button>
    </div>
  );
}

/* ---- the matrix -------------------------------------------------------------- */

/**
 * Teams down, awards across. A dot is a nomination (no counts: how many judges
 * is in the side panel), a green dot is Sportsmanship from referees' Good
 * conduct alone, a tick is the winner, nothing is not nominated. Only this box
 * scrolls sideways, with the team column held in place.
 */
/** The matrix, or the blended one: whose columns can also say which key (division or "Whole event") an award is decided under, and a team a division. */
export type MatrixLike = { columns: (Matrix["columns"][number] & { key?: string })[]; rows: Matrix["rows"]; hidden: Matrix["hidden"] };

const columnId = (c: { award: { id: string }; key?: string }): string => (c.key ? `${c.award.id}|${c.key}` : c.award.id);

export function MatrixView({
  matrix,
  sel,
  note,
  none,
  sent,
  onSelect,
  tags = false,
}: {
  matrix: MatrixLike;
  sel: (Sel & { key?: string }) | null;
  /** The sentence about the columns that are hidden, if any are. */
  note: string;
  /** What the board says when nobody is nominated. */
  none: string;
  /** The awards sent to Marketing, which wear a lock after their tick: their ids, or (a blended column) "id|key". */
  sent?: Set<string>;
  onSelect: (sel: (Sel & { key?: string }) | null) => void;
  /** Blended: each team wears its division beside its panel. */
  tags?: boolean;
}) {
  if (!matrix.rows.length) return <p className="ja-empty">{none}</p>;
  return (
    <div className="ja-aw-mxw">
      <div className="ja-aw-mx">
        <table style={{ "--n": matrix.columns.length } as React.CSSProperties}>
          <caption className="sr-only">Nominations by team and award</caption>
          <thead>
            <tr>
              <th scope="col" className="ja-aw-tm">
                Team
              </th>
              <th scope="col" className="ja-aw-pn">
                Panel
              </th>
              {matrix.columns.map((column) => {
                const { award, decided, noWinner, key } = column;
                const label = key ? `${award.label} ${divisionTag(key)}` : undefined;
                return (
                  <th key={columnId(column)} scope="col" className={sel?.awardId === award.id && (!key || sel.key === key) ? "ja-aw-on" : undefined} aria-label={label}>
                    <abbr className="ja-aw-hl" title={key ? `${award.label} · ${key}` : award.label}>
                      {award.short}
                      {key ? <span className="ja-aw-hd">{divisionTag(key)}</span> : null}
                    </abbr>
                    <span className="ja-aw-hk">
                      {noWinner ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="no winner">
                          <path d="M6 12h12" />
                        </svg>
                      ) : decided ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="decided">
                          <path d="M5 12.5l4.5 4.5L19 7.5" />
                        </svg>
                      ) : null}
                      {sent?.has(columnId(column)) ? <Locked /> : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.team.id}>
                <th scope="row" className="ja-aw-tm">
                  <b>{row.team.number}</b>
                  <span className={row.has.length ? "ja-aw-sub ja-aw-has" : "ja-aw-sub"}>{row.has.length ? holdsText(row.has) : row.team.name}</span>
                </th>
                <td className="ja-aw-pn">
                  <span className="ja-aw-ptag">{row.tag}</span>
                  {tags ? (
                    <span className="ja-aw-ptag ja-aw-dv" title={divisionTag(row.team.division) !== row.team.division ? row.team.division : undefined}>
                      {divisionTag(row.team.division)}
                    </span>
                  ) : null}
                </td>
                {matrix.columns.map((column, i) => {
                  const { award, key } = column;
                  const cell = row.cells[i];
                  if (cell === "none") return <td key={columnId(column)} />;
                  const on = sel?.awardId === award.id && sel.teamId === row.team.id && (!key || sel.key === key);
                  return (
                    <td key={columnId(column)}>
                      <button
                        type="button"
                        className={cell === "winner" ? "ja-aw-cell ja-aw-won" : "ja-aw-cell"}
                        aria-pressed={on}
                        aria-label={`${row.team.number}, ${key ? `${award.label} · ${key}` : award.label}: ${cell === "winner" ? "winner" : cell === "conduct" ? `nominated by referees (${conductText(row.conduct)})` : "nominated"}`}
                        onClick={() => onSelect(on ? null : key ? { awardId: award.id, teamId: row.team.id, key } : { awardId: award.id, teamId: row.team.id })}
                      >
                        {cell === "winner" ? <Tick size={16} strokeWidth={2.8} /> : <i className={cell === "conduct" ? "ja-aw-mk ja-aw-gd" : "ja-aw-mk"} aria-hidden="true" />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ja-aw-key">
        <span>
          <b className="ja-aw-cell" aria-hidden="true">
            <i className="ja-aw-mk" />
          </b>
          nominated
        </span>
        <span>
          <b className="ja-aw-cell ja-aw-won" aria-hidden="true">
            <Tick size={12} strokeWidth={2.8} />
          </b>
          winner
        </span>
        <span>
          <b className="ja-aw-cell" aria-hidden="true">
            <i className="ja-aw-mk ja-aw-gd" />
          </b>
          {conductKeyText}
        </span>
        <span>Only nominated teams are listed. {note}</span>
      </p>
    </div>
  );
}

/* ---- by award ------------------------------------------------------------------ */

/** The lock of a sent award: labelled for a screen reader, since the icon alone says nothing. */
export const Locked = () => (
  <span className="ja-aw-lk" role="img" aria-label="Locked: sent to Marketing">
    <LockIcon />
  </span>
);

/** Why a sent award's winner cannot be changed. */
export const RECALL_FIRST = "Recall it from Marketing first.";

/** "2 judges", "1 judge · JA" when the Judge Advisor nominated too, or "Good conduct ×3" in green for a team only referees put up, or both. */
function Backing({ judges, ja = 0, conduct }: { judges: number; ja?: number; conduct: number }) {
  const b = backing(judges, conduct, ja);
  return (
    <>
      {b.judges}
      {b.judges && b.conduct ? ", " : null}
      {b.conduct ? <span className="ja-aw-good">{b.conduct}</span> : null}
    </>
  );
}

/**
 * Every award in the config's order, nominated or not, each with its nominees as rows
 * and, when `add` is given, an Add team picker under them: the Judge Advisor's way
 * to put any team of the division up for the award. A team already added is listed but off.
 * When `noWinner` is given, each award's header has Mark no winner (or, once marked, Clear).
 * When `send` is given, each header also says where the award stands with Marketing: Send to Marketing,
 * Sent (locked, with Recall), Recalled (Send again) or what it still needs. A sent award's Mark no winner
 * and Clear are off.
 */
export function AwardLists({
  lists,
  sel,
  onSelect,
  add,
  noWinner,
  send,
}: {
  lists: AwardPanel[];
  sel: Sel | null;
  onSelect: (sel: Sel | null) => void;
  add?: { teams: Team[]; busy: boolean; onAdd: (awardId: string, teamId: string) => void };
  noWinner?: { busy: boolean; onMark: (awardId: string) => void; onClear: (awardId: string) => void };
  send?: {
    states: Map<string, SendState>;
    releases: AwardReleaseRow[];
    /** This division's winners by award, for how many are still to pick. */
    held: Map<string, unknown[]>;
    division: string;
    busy: boolean;
    onSend: (awardId: string) => void;
    onRecall: (awardId: string) => void;
  };
}) {
  return (
    <div className="ja-aw-aps">
      {lists.map((panel) => {
        const { award, decided } = panel;
        const state = send?.states.get(award.id);
        const row = send ? releaseOf(send.releases, award.id, send.division) : null;
        const locked = state === "sent";
        return (
          <section key={award.id} className={decided ? "ja-aw-ap ja-aw-dec" : "ja-aw-ap"} aria-label={`${award.label} Award`}>
            <header className="ja-aw-aph">
              <h2 title={award.blurb}>
                {award.label}
                {locked ? <Locked /> : null}
              </h2>
              {awardStatus(panel, state, row)}
              {sendControls(award, award.label, state, row, decided, send?.held.get(award.id)?.length ?? 0, send)}
            </header>
            {awardBody({ panel, state, row, name: award.label, sel, onSelect, add, noWinner, locked })}
          </section>
        );
      })}
    </div>
  );
}

/*
 * The pieces of one award's list, as plain functions (they hold no state and return markup, so a test can walk what they return). The standard board
 * draws them under its own header; the blended board draws them under a division's half of the award, or under a whole-event award's.
 */

/** The write handlers behind an award's Send controls. */
export type SendCtx = {
  busy: boolean;
  onSend: (awardId: string) => void;
  onRecall: (awardId: string) => void;
};

/** Where the award stands with Marketing, on the right of its header: Send, or Sent and Recall, or what it still needs. Nothing until the sends are known. `name` is what a screen reader hears for the award: its label, or (blended) "Excellence · Middle School". `held` is how many winners it has. */
export function sendControls(award: AwardView, name: string, state: SendState | undefined, row: AwardReleaseRow | null, decided: boolean, held: number, send: SendCtx | undefined) {
  if (!send || !state) return null;
  return (
    <div className="ja-aw-hr">
      {state === "ready" || state === "recalled" ? (
        <button
          type="button"
          className="ja-aw-snd"
          disabled={send.busy || !decided}
          aria-label={state === "ready" ? `Send ${name} to Marketing` : `Send ${name} to Marketing again`}
          onClick={() => send.onSend(award.id)}
        >
          {state === "ready" ? "Send to Marketing" : "Send again"}
          <Arrow size={14} />
        </button>
      ) : state === "sent" && row ? (
        <>
          <span className="ja-aw-sent">
            <Tick size={13} />
            Sent {hhmm(row.sent_at)}
          </span>
          <button type="button" className="ja-aw-rcl" disabled={send.busy} aria-label={`Recall ${name} from Marketing`} onClick={() => send.onRecall(award.id)}>
            Recall
          </button>
        </>
      ) : (
        <span className="ja-aw-nsend">{award.places > 1 && held > 0 ? "Pick both winners to send" : "Pick a winner to send"}</span>
      )}
    </div>
  );
}

/** "Decided", "2 nominees", "Open"; "Recalled" once it was sent and taken back. */
export function awardStatus({ decided, status }: AwardPanel, state: SendState | undefined, row: AwardReleaseRow | null) {
  return state === "recalled" && row ? <span className="ja-aw-cst">Recalled</span> : <span className={decided ? "ja-aw-cst ja-aw-ok" : "ja-aw-cst"}>{status}</span>;
}

/**
 * Blended: a row wears its team's division, and a team that holds another award says so in a line under the row, naming where it holds it.
 * `has` writes that line: "Already has Excellence · Middle School".
 */
export type Scoped = { has: (teamId: string, has: AwardView[]) => string };

/** The nominees of one award as rows, or the note that there are none. `empty` words that note when a filter, not the judges, is why. */
export function nomineeRows(award: AwardView, nominees: Nominee[], sel: Sel | null, onSelect: (sel: Sel | null) => void, scoped?: Scoped, empty = "No nominations yet") {
  if (!nominees.length) return <p className="ja-aw-cnone">{empty}</p>;
  return (
    <ul>
      {nominees.map((n) => {
        const on = sel?.awardId === award.id && sel.teamId === n.team.id;
        if (scoped) {
          const has = n.has.length ? scoped.has(n.team.id, n.has) : null;
          const tag = divisionTag(n.team.division);
          return (
            <li key={n.team.id}>
              <button
                type="button"
                className={n.winner ? "ja-aw-nr ja-aw-won" : "ja-aw-nr"}
                aria-pressed={on}
                aria-label={`${n.team.number} ${n.team.name}, ${tag}, ${award.label}, ${n.winner ? "winner" : backingText(n.judges, n.conduct, n.ja)}${has ? `, ${has}` : ""}`}
                onClick={() => onSelect(on ? null : { awardId: award.id, teamId: n.team.id })}
              >
                <b>{n.team.number}</b>
                <span className="ja-aw-nm">
                  <span className="ja-aw-n1">{n.team.name}</span>
                  <span className="ja-aw-n2">
                    {n.tag} · <Backing judges={n.judges} ja={n.ja} conduct={n.conduct} />
                  </span>
                </span>
                <span className="ja-aw-ptag ja-aw-dv" title={tag !== n.team.division ? n.team.division : undefined}>
                  {tag}
                </span>
                {n.winner ? (
                  <span className="ja-aw-win">
                    <Tick />
                    Winner
                  </span>
                ) : null}
              </button>
              {has ? (
                <p className="ja-aw-rwarn">
                  <CautionIcon size={15} />
                  <span>{has}</span>
                </p>
              ) : null}
            </li>
          );
        }
        return (
          <li key={n.team.id}>
            <button
              type="button"
              className={n.winner ? "ja-aw-nr ja-aw-won" : "ja-aw-nr"}
              aria-pressed={on}
              aria-label={`${n.team.number} ${n.team.name}, ${award.label}, ${n.winner ? "winner" : backingText(n.judges, n.conduct, n.ja)}${n.has.length ? `, ${hasText(n.has)}` : ""}`}
              onClick={() => onSelect(on ? null : { awardId: award.id, teamId: n.team.id })}
            >
              <b>{n.team.number}</b>
              <span className="ja-aw-nm">{n.team.name}</span>
              {n.has.length ? (
                <span className="ja-aw-cau" title={hasText(n.has)}>
                  <CautionIcon size={15} />
                </span>
              ) : null}
              <span className="ja-aw-ptag">{n.tag}</span>
              <span className="ja-aw-jc">
                <Backing judges={n.judges} ja={n.ja} conduct={n.conduct} />
              </span>
              {n.winner ? (
                <span className="ja-aw-win">
                  <Tick />
                  Winner
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** What is under an award's header: what Marketing had (once recalled), the nominees, the Add team picker, and Mark no winner or Clear. */
export function awardBody({
  panel,
  state,
  row,
  name,
  sel,
  onSelect,
  add,
  noWinner,
  locked,
  scoped,
  empty,
}: {
  panel: AwardPanel;
  state: SendState | undefined;
  row: AwardReleaseRow | null;
  name: string;
  sel: Sel | null;
  onSelect: (sel: Sel | null) => void;
  add?: { teams: Team[]; busy: boolean; onAdd: (awardId: string, teamId: string) => void };
  noWinner?: { busy: boolean; onMark: (awardId: string) => void; onClear: (awardId: string) => void };
  locked: boolean;
  scoped?: Scoped;
  empty?: string;
}) {
  const { award, nominees, ja, noWinner: marked } = panel;
  return (
    <>
      {state === "recalled" && row ? (
        <p className="ja-aw-cwarn">
          <CautionIcon size={15} />
          <span>
            Marketing had <b>{snapshotLine(row)}</b>
          </span>
        </p>
      ) : null}
      {nomineeRows(award, nominees, sel, onSelect, scoped, empty)}
      {add ? (
        <div className="ja-aw-add">
          <div className="ja-selw">
            <select
              className="ja-in ja-sel"
              aria-label={`Add team to ${name}`}
              value=""
              disabled={add.busy}
              onChange={(e) => e.target.value && add.onAdd(award.id, e.target.value)}
            >
              <option value="">Add team…</option>
              {add.teams.map((t) => (
                <option key={t.id} value={t.id} disabled={ja.has(t.id)}>
                  {`${t.number} ${t.name}${ja.has(t.id) ? " · added" : ""}`}
                </option>
              ))}
            </select>
            <ChevronDown />
          </div>
        </div>
      ) : null}
      {noWinner ? (
        <div className="ja-aw-nw">
          {marked ? (
            <button type="button" className="ja-aw-lnk" disabled={noWinner.busy || locked} title={locked ? RECALL_FIRST : undefined} aria-label={`Clear No winner on ${name}`} onClick={() => noWinner.onClear(award.id)}>
              Clear
            </button>
          ) : (
            <button type="button" className="ja-aw-lnk" disabled={noWinner.busy || locked} title={locked ? RECALL_FIRST : undefined} aria-label={`Mark no winner for ${name}`} onClick={() => noWinner.onMark(award.id)}>
              Mark no winner
            </button>
          )}
        </div>
      ) : null}
    </>
  );
}

/* ---- the side panel ---------------------------------------------------------------- */

/**
 * One nominee for one award: the scores, why each panel nominated them (and,
 * for Sportsmanship, the referees' Good conduct flags), who else is in the
 * running, and the button that gives the award. "Already has"
 * is only ever a line of amber text here; the button is never off for it.
 * Each judge's and Judge Advisor line has a quiet Remove, and "Also nominate
 * for…" adds the Judge Advisor's own nomination for another award. The Good
 * conduct lines have no Remove: they come from flags, not from a nomination.
 * A sent award's winner is locked (Clear winner and Give are off, with the
 * reason under them); nominations are not part of what was sent, so they stay.
 */
export function NomineePanel({
  detail,
  row,
  rubricList,
  flags,
  flagKinds,
  titleId,
  busy,
  sentAt = null,
  onGive,
  onClear,
  onNominate,
  onRemove,
  scoped,
}: {
  detail: Detail;
  row: RankedRow | undefined;
  rubricList: Rubric[];
  /** This team's referee flags. */
  flags: AppState["flags"];
  flagKinds: AppState["flagKinds"];
  titleId: string;
  busy: boolean;
  /** When this award was sent to Marketing (an ISO time), if it is sent now: its winner is locked until it is recalled. */
  sentAt?: string | null;
  onGive: (detail: Detail) => void;
  onClear: (detail: Detail) => void;
  onNominate: (awardId: string, teamId: string) => void;
  onRemove: (detail: Detail, line: { id: string; by: string }) => void;
  /** Blended: the key the award is decided under, which the eyebrow names instead of the team's division, and how "Already has" names the scope. Other nominees wear their division. */
  scoped?: Scoped & { key: string };
}) {
  const { award, team } = detail;
  const has = (teamId: string, list: AwardView[]) => (scoped ? scoped.has(teamId, list) : hasText(list));
  const score = scoreParts(row, rubricList);
  const referee = refereeLine(flags, flagKinds);
  const locked = sentAt !== null;
  const lockId = `${titleId}-lock`;
  return (
    <>
      <p className="ja-aw-eyebrow">
        {award.label} · {scoped ? scoped.key : team.division}
      </p>
      <h2 id={titleId}>
        {team.number}
        <span>{team.name}</span>
      </h2>
      {score ? (
        <p className="ja-aw-dst">
          {score.parts.map((p) => (
            <span key={p.label}>
              {p.label} <b>{p.text}</b>
            </span>
          ))}
          {score.total ? (
            <span>
              <b>{score.total}</b>
            </span>
          ) : null}
          {row?.scored ? <BandPill total={row.total} max={row.max} scored /> : null}
        </p>
      ) : null}
      {detail.has.length ? (
        <p className="ja-aw-warnl">
          <CautionIcon size={13} />
          {has(team.id, detail.has)}
        </p>
      ) : null}

      {detail.reasons.length ? (
        detail.reasons.map((r) => (
          <Fragment key={r.key}>
            <h3 className="ja-aw-sec">Why {r.panel} nominated them</h3>
            <ul className="ja-aw-qs">
              {r.judges.map((j) => (
                <li key={j.id} className="ja-aw-ql">
                  <div className="ja-aw-qt">
                    <b>{j.judge}</b>
                    {j.reason ? `“${j.reason}”` : <span className="ja-aw-q0">No reason given</span>}
                  </div>
                  <button type="button" className="ja-aw-lnk ja-aw-rm" disabled={busy} aria-label={`Remove ${r.key === JA_KEY ? "the Judge Advisor" : j.judge}'s nomination`} onClick={() => onRemove(detail, { id: j.id, by: r.key === JA_KEY ? r.panel : j.judge })}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </Fragment>
        ))
      ) : detail.conduct.length ? null : (
        <p className="ja-aw-also">No judge is nominating {team.number} for {award.label} any more.</p>
      )}
      {detail.conduct.length ? (
        <>
          <h3 className="ja-aw-sec ja-aw-good">Good conduct from referees</h3>
          <ul className="ja-aw-qs ja-aw-gc">
            {detail.conduct.map((f) => (
              <li key={f.id}>
                <b>{conductLine(f)}</b>
                {f.body ? `“${f.body}”` : <span className="ja-aw-q0">No note</span>}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="ja-aw-also">
        {detail.alsoFor.length ? `Also nominated for ${detail.alsoFor.map((a) => a.label).join(", ")} · ` : ""}
        {referee.good || referee.caution ? (
          <>
            {referee.good ? <span className="ja-aw-good">{referee.good}</span> : null}
            {referee.good && referee.caution ? ", " : null}
            {referee.caution ? <span className="ja-aw-caut">{referee.caution}</span> : null}
          </>
        ) : (
          "No referee flags"
        )}
      </p>
      {detail.addable.length ? (
        <div className="ja-selw">
          <select
            className="ja-in ja-sel"
            aria-label={`Also nominate ${team.number} for`}
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && onNominate(e.target.value, team.id)}
          >
            <option value="">Also nominate for…</option>
            {detail.addable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <ChevronDown />
        </div>
      ) : null}

      {detail.others.length ? (
        <>
          <h3 className="ja-aw-sec">
            Other {award.label} {detail.others.length === 1 ? "nominee" : "nominees"}
          </h3>
          {detail.others.map((o) => (
            <div key={o.team.id} className="ja-aw-oth">
              <div>
                <p>
                  <b>{o.team.number}</b> {o.team.name} · <Backing judges={o.judges} ja={o.ja} conduct={o.conduct} />
                </p>
                {o.has.length ? (
                  <p className="ja-aw-warnl">
                    <CautionIcon size={13} />
                    {has(o.team.id, o.has)}
                  </p>
                ) : null}
              </div>
              {scoped ? (
                <span className="ja-aw-ptag ja-aw-dv" title={divisionTag(o.team.division) !== o.team.division ? o.team.division : undefined}>
                  {divisionTag(o.team.division)}
                </span>
              ) : null}
              {o.winner ? (
                <span className="ja-aw-win">
                  <Tick />
                  Winner
                </span>
              ) : null}
            </div>
          ))}
        </>
      ) : null}

      {detail.isWinner ? (
        <div className="ja-aw-held">
          <span className="ja-aw-win">
            <Tick />
            Winner
          </span>
          <button type="button" className="ja-aw-lnk" disabled={busy || locked} aria-describedby={locked ? lockId : undefined} onClick={() => onClear(detail)}>
            Clear winner
          </button>
        </div>
      ) : detail.full ? (
        <p className="ja-aw-note">{fullText(award, team)}</p>
      ) : detail.nominated ? (
        <>
          <button type="button" className="ja-aw-prim" disabled={busy || locked} aria-describedby={locked ? lockId : undefined} onClick={() => onGive(detail)}>
            {busy ? "Saving…" : `Give ${award.label} to ${team.number}`}
          </button>
          {locked ? null : <p className="ja-aw-note">You can change it until the ceremony.</p>}
        </>
      ) : (
        // Nobody nominates it any more (a judge withdrew, or the Judge Advisor removed the last one): the server would refuse the award, so offer the way back instead.
        <button type="button" className="ja-aw-lnk" disabled={busy} onClick={() => onNominate(award.id, team.id)}>
          Nominate for {award.label}
        </button>
      )}
      {sentAt !== null ? (
        <p className="ja-aw-lockn" id={lockId}>
          <LockIcon />
          <span>
            <b>{RECALL_FIRST}</b> Sent to Marketing at {hhmm(sentAt)}.
          </span>
        </p>
      ) : null}
    </>
  );
}

/** A native <dialog> opened with showModal(), as the Sections sheet is: the phone's side panel. */
export function PanelSheet({ open, titleId, onClose, children }: { open: boolean; titleId: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="ja-sheet ja-aw-sheet"
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
          <button type="button" className="ja-x ja-aw-sx" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
          <div className="ja-aw-dr">{children}</div>
        </>
      ) : null}
    </dialog>
  );
}
