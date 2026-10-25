"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import { BandPill, ChevronDown, CloseIcon } from "@/components/judge/parts";
import { Banner } from "@/components/ui";
import { call, useScores } from "@/components/useAppState";
import { rankTeams } from "@/lib/ranking";
import type { Rubric } from "@/lib/rubrics";
import type { AppState, AwardsAdminView, Team } from "@/lib/types";
import {
  ALL_PANELS,
  backing,
  backingText,
  buildAwardPanels,
  buildMatrix,
  clearAfterAsking,
  conductIn,
  conductKeyText,
  conductLine,
  conductText,
  decidedCount,
  decidedText,
  detailFor,
  distinctTeams,
  giveAfterAsking,
  hasText,
  hiddenNote,
  holdsText,
  JA_KEY,
  loadView,
  nominateAsAdmin,
  nominationsIn,
  nominationsText,
  panelChips,
  refereeLine,
  removeAfterAsking,
  saveView,
  scoreParts,
  teamsByNumber,
  winnersOf,
  type AwardPanel,
  type Detail,
  type Matrix,
  type Sel,
  type View,
} from "./awardsLogic";
import { divisionTag } from "./floorLogic";
import { withRanks, type RankedRow } from "./scoresLogic";

function Glyph({ size = 16, strokeWidth = 1.9, children }: { size?: number; strokeWidth?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const Tick = ({ size = 12, strokeWidth = 2.6 }: { size?: number; strokeWidth?: number }) => (
  <Glyph size={size} strokeWidth={strokeWidth}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Glyph>
);
const LockIcon = () => (
  <Glyph>
    <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
  </Glyph>
);
const CautionIcon = ({ size }: { size: number }) => (
  <Glyph size={size} strokeWidth={2}>
    <path d="M12 3.5l9.5 16.5h-19L12 3.5zM12 10v4.5M12 17.2v.01" />
  </Glyph>
);

type Slice = Pick<AppState, "teams" | "panels" | "divisions" | "flags" | "flagKinds">;

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
 */
export function AwardsTab({
  state,
  data,
  error,
  reload,
  division,
  onDivision,
  onError,
}: {
  state: Slice & Pick<AppState, "categories">;
  /** Null until the first answer. */
  data: AwardsAdminView | null;
  error: string | null;
  /** Asks again now; resolves once the answer is in. */
  reload: () => Promise<void>;
  division: string;
  onDivision: (division: string) => void;
  onError: (message: string | null) => void;
}) {
  const [view, setView] = useState<View>(loadView);
  const [panelId, setPanelId] = useState(ALL_PANELS);
  const [sel, setSel] = useState<Sel | null>(null);
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

  return (
    <>
      <AwardsBoard
        data={data}
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
        onGive={(d) => write(() => giveAfterAsking(ask, call, { award: d.award, team: d.team, current: d.current }))}
        onClear={(d) => write(() => clearAfterAsking(ask, call, { award: d.award, team: d.team }))}
        onNominate={(awardId, teamId) => write(() => nominateAsAdmin(call, { awardId, teamId }))}
        onRemove={(d, line) => write(() => removeAfterAsking(ask, call, { ...line, award: d.award, team: d.team }))}
      />
      {dialog}
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
  onNominate,
  onRemove,
}: {
  data: AwardsAdminView;
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
  /** The Judge Advisor nominates a team for an award. */
  onNominate: (awardId: string, teamId: string) => void;
  /** The Judge Advisor removes one nomination, a judge's or their own: its id, and whose it is for the question. */
  onRemove: (detail: Detail, line: { id: string; by: string }) => void;
}) {
  const uid = useId();
  const { awards, nominations, winners } = data;
  const { teams, panels, divisions, flags, flagKinds } = state;

  if (!awards.length) return <p className="ja-empty">No awards are set up. They are listed in config/event.json.</p>;
  if (!divisions.length) return <p className="ja-empty">No divisions yet.</p>;

  const panelsHere = panels.filter((p) => p.division === division);
  const panel = panelsHere.find((p) => p.id === panelId) ?? null;
  const inDivision = nominationsIn(nominations, teams, division);
  const scoped = nominationsIn(nominations, teams, division, panel?.id);
  const conduct = conductIn(flags, teams, division, panel?.id);
  const decided = winnersOf(winners, division);
  const detail = sel ? detailFor(sel, { awards, nominations, winners, teams, panels, flags }) : null;
  const teamsHere = teams.filter((t) => t.division === division);
  const titleId = `${uid}-t`;
  const matrix = buildMatrix(awards, scoped, decided, teamsHere, panels, panel?.id, conduct);

  const nominee = detail ? (
    <NomineePanel
      detail={detail}
      row={rows.find((r) => r.team.id === detail.team.id)}
      rubricList={rubricList}
      flags={flags.filter((f) => f.team_id === detail.team.id)}
      flagKinds={flagKinds}
      titleId={titleId}
      busy={busy}
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
          {division} · {panel ? panel.name : "all panels"} · <b>{decidedCount(winners, awards, division)} of {awards.length}</b> decided · {nominationsText(scoped.length + conduct.size, distinctTeams(scoped, conduct.keys()))}
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
                  {decidedText(winners, awards, d)}
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
        <ViewToggle view={view} onView={onView} />
      </div>

      <div className="ja-aw-cols">
        <div className="ja-aw-view">
          {view === "matrix" ? (
            <MatrixView
              matrix={matrix}
              sel={sel}
              note={hiddenNote(matrix.hidden, panel?.name ?? null)}
              none={`No nominations in ${division}${panel ? ` from ${panel.name}` : ""} yet. Judges nominate the teams they have interviewed.`}
              onSelect={onSelect}
            />
          ) : (
            <AwardLists
              lists={buildAwardPanels(awards, scoped, decided, teamsHere, panels, panel?.id, conduct)}
              sel={sel}
              onSelect={onSelect}
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
export function MatrixView({
  matrix,
  sel,
  note,
  none,
  onSelect,
}: {
  matrix: Matrix;
  sel: Sel | null;
  /** The sentence about the columns that are hidden, if any are. */
  note: string;
  /** What the board says when nobody is nominated. */
  none: string;
  onSelect: (sel: Sel | null) => void;
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
              {matrix.columns.map(({ award, decided }) => (
                <th key={award.id} scope="col" className={sel?.awardId === award.id ? "ja-aw-on" : undefined}>
                  <abbr className="ja-aw-hl" title={award.label}>
                    {award.short}
                  </abbr>
                  <span className="ja-aw-hk">
                    {decided ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="decided">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    ) : null}
                  </span>
                </th>
              ))}
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
                </td>
                {matrix.columns.map(({ award }, i) => {
                  const cell = row.cells[i];
                  if (cell === "none") return <td key={award.id} />;
                  const on = sel?.awardId === award.id && sel.teamId === row.team.id;
                  return (
                    <td key={award.id}>
                      <button
                        type="button"
                        className={cell === "winner" ? "ja-aw-cell ja-aw-won" : "ja-aw-cell"}
                        aria-pressed={on}
                        aria-label={`${row.team.number}, ${award.label}: ${cell === "winner" ? "winner" : cell === "conduct" ? `nominated by referees (${conductText(row.conduct)})` : "nominated"}`}
                        onClick={() => onSelect(on ? null : { awardId: award.id, teamId: row.team.id })}
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
 */
export function AwardLists({
  lists,
  sel,
  onSelect,
  add,
}: {
  lists: AwardPanel[];
  sel: Sel | null;
  onSelect: (sel: Sel | null) => void;
  add?: { teams: Team[]; busy: boolean; onAdd: (awardId: string, teamId: string) => void };
}) {
  return (
    <div className="ja-aw-aps">
      {lists.map(({ award, decided, status, nominees, ja }) => (
        <section key={award.id} className={decided ? "ja-aw-ap ja-aw-dec" : "ja-aw-ap"} aria-label={`${award.label} Award`}>
          <header className="ja-aw-aph">
            <h2 title={award.blurb}>{award.label}</h2>
            <span className={decided ? "ja-aw-cst ja-aw-ok" : "ja-aw-cst"}>{status}</span>
          </header>
          {nominees.length ? (
            <ul>
              {nominees.map((n) => {
                const on = sel?.awardId === award.id && sel.teamId === n.team.id;
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
          ) : (
            <p className="ja-aw-cnone">No nominations yet</p>
          )}
          {add ? (
            <div className="ja-aw-add">
              <div className="ja-selw">
                <select
                  className="ja-in ja-sel"
                  aria-label={`Add team to ${award.label}`}
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
        </section>
      ))}
    </div>
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
 */
export function NomineePanel({
  detail,
  row,
  rubricList,
  flags,
  flagKinds,
  titleId,
  busy,
  onGive,
  onClear,
  onNominate,
  onRemove,
}: {
  detail: Detail;
  row: RankedRow | undefined;
  rubricList: Rubric[];
  /** This team's referee flags. */
  flags: AppState["flags"];
  flagKinds: AppState["flagKinds"];
  titleId: string;
  busy: boolean;
  onGive: (detail: Detail) => void;
  onClear: (detail: Detail) => void;
  onNominate: (awardId: string, teamId: string) => void;
  onRemove: (detail: Detail, line: { id: string; by: string }) => void;
}) {
  const { award, team } = detail;
  const score = scoreParts(row, rubricList);
  const referee = refereeLine(flags, flagKinds);
  return (
    <>
      <p className="ja-aw-eyebrow">
        {award.label} · {team.division}
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
          {hasText(detail.has)}
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
                    {hasText(o.has)}
                  </p>
                ) : null}
              </div>
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
          <button type="button" className="ja-aw-lnk" disabled={busy} onClick={() => onClear(detail)}>
            Clear winner
          </button>
        </div>
      ) : detail.nominated ? (
        <>
          <button type="button" className="ja-aw-prim" disabled={busy} onClick={() => onGive(detail)}>
            {busy ? "Saving…" : `Give ${award.label} to ${team.number}`}
          </button>
          <p className="ja-aw-note">You can change it until the ceremony.</p>
        </>
      ) : (
        // Nobody nominates it any more (a judge withdrew, or the Judge Advisor removed the last one): the server would refuse the award, so offer the way back instead.
        <button type="button" className="ja-aw-lnk" disabled={busy} onClick={() => onNominate(award.id, team.id)}>
          Nominate for {award.label}
        </button>
      )}
    </>
  );
}

/** A native <dialog> opened with showModal(), as the Sections sheet is: the phone's side panel. */
function PanelSheet({ open, titleId, onClose, children }: { open: boolean; titleId: string; onClose: () => void; children: React.ReactNode }) {
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
