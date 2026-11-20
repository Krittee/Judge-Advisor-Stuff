"use client";

import { useId } from "react";
import { awardKeys, scopeKeys, setupDivisions, setupLabel, WHOLE_EVENT } from "@/lib/eventSetup";
import type { Rubric } from "@/lib/rubrics";
import type { AwardReleaseRow, AwardsAdminView, AwardView, EventSetup, FlagRow, NoWinnerRow, PublicPanel, ReleasedView, Team, WinnerRow } from "@/lib/types";
import {
  Arrow,
  awardBody,
  awardStatus,
  LockIcon,
  Locked,
  MatrixView,
  NomineePanel,
  PanelSheet,
  sendControls,
  ViewToggle,
  type MatrixLike,
  type Scoped,
  type Slice,
} from "./AwardsTab";
import {
  ALL_PANELS,
  buildAwardPanels,
  buildMatrix,
  conductIn,
  detailFor,
  distinctTeams,
  eventDecided,
  eventSentCount,
  heldByTeam,
  hiddenNote,
  nominationsIn,
  nominationsText,
  noWinnersOf,
  panelChips,
  readyToSend,
  releaseOf,
  sendState,
  teamsByNumber,
  winnersOf,
  type AwardPanel,
  type BlendedSel,
  type Detail,
  type Matrix,
  type Sel,
  type View,
} from "./awardsLogic";
import { divisionTag } from "./floorLogic";
import type { RankedRow } from "./scoresLogic";

/**
 * The Awards board in a blended event, "Award order": one column of blocks in the config's order, the ceremony order. An award given in each division
 * (Excellence, Design) is one block with a half per division, side by side from 1280px and stacked below it (a phone, and a narrow desktop beside the side panel); every other award is one full-width
 * block for the whole event. Each half and each whole-event block is decided, sent, recalled and cleared on its own, under its own key (a division,
 * or "Whole event"), so every write here takes the key. Everything is the standard board's, only the markup around it differs: the award bodies
 * are the same pieces (`awardBody`, `sendControls`), the matrix has a column per key, and the side panel names the key.
 *
 * "Nominees from" narrows the nominee rows to one division's teams (a winner always stays: decisions and Send are never hidden).
 */

const noop = () => {};

/** "Already has Excellence · Middle School": the scope is where the team holds the award, so Excellence in MS reads differently from Excellence in ES. */
export function scopedHas(winners: Pick<WinnerRow, "award_id" | "team_id" | "division">[]): Scoped {
  return {
    has: (teamId, has) =>
      `Already has ${has
        .map((a) => {
          const at = winners.find((w) => w.award_id === a.id && w.team_id === teamId);
          return at ? `${a.label} · ${at.division}` : a.label;
        })
        .join(", ")}`,
  };
}

/** A matrix tap as a blended selection: a column with no key (a whole-event award's) is decided under "Whole event". */
export function toBlendedSel(s: (Sel & { key?: string }) | null): BlendedSel | null {
  return s ? { ...s, key: s.key ?? WHOLE_EVENT } : null;
}

/** The key an award is named under on screen: "Excellence · Middle School", or just "Innovate" for the whole event. */
const nameOf = (award: Pick<AwardView, "label">, key: string): string => (key === WHOLE_EVENT ? award.label : `${award.label} · ${key}`);

/* ---- by award ------------------------------------------------------------------------------------------------ */

/**
 * The blocks, one column. It holds no state: `lists` is every key's awards (buildAwardPanels once per key), and every tap says which key it is for.
 * Hook-free on purpose, so a test can read the buttons off the tree it returns.
 */
export function BlendedLists({
  awards,
  divisions,
  lists,
  winners,
  noWinners,
  releases,
  released,
  from,
  teams,
  addable,
  sel,
  onSelect,
  busy,
  onSend,
  onRecall,
  onMarkNoWinner,
  onClearNoWinner,
  onNominate,
}: {
  awards: AwardView[];
  divisions: string[];
  lists: Map<string, Map<string, AwardPanel>>;
  winners: WinnerRow[];
  noWinners: Pick<NoWinnerRow, "award_id" | "division">[];
  releases: AwardReleaseRow[];
  /** Whether the sends are known: Send, Recall and the lock are drawn only then. */
  released: boolean;
  /** Nominees from: "" is every division, else the one whose nominees the rows show. */
  from: string;
  teams: Team[];
  /** The Add team picker: for All panels only (the Judge Advisor's nominations belong to no panel). */
  addable: boolean;
  sel: BlendedSel | null;
  onSelect: (sel: BlendedSel | null) => void;
  busy: boolean;
  onSend: (awardId: string, key: string) => void;
  onRecall: (awardId: string, key: string) => void;
  onMarkNoWinner: (awardId: string, key: string) => void;
  onClearNoWinner: (awardId: string, key: string) => void;
  onNominate: (awardId: string, teamId: string) => void;
}) {
  const scoped = scopedHas(winners);

  /** One award under one key: its header pieces and its body. */
  const part = (award: AwardView, key: string) => {
    const found = lists.get(key)?.get(award.id);
    if (!found) return null;
    const nominees = from ? found.nominees.filter((n) => n.winner || n.team.division === from) : found.nominees;
    const panel: AwardPanel = { ...found, nominees };
    const state = released ? sendState(award, key, winners, noWinners, releases) : undefined;
    const row = released ? releaseOf(releases, award.id, key) : null;
    const locked = state === "sent";
    const name = nameOf(award, key);
    const send = released ? { busy, onSend: (id: string) => onSend(id, key), onRecall: (id: string) => onRecall(id, key) } : undefined;
    const held = winnersOf(winners, key).get(award.id)?.length ?? 0;
    const body = awardBody({
      panel,
      state,
      row,
      name,
      sel,
      onSelect: (s: Sel | null) => onSelect(s ? { ...s, key } : null),
      add: addable ? { teams: teamsByNumber(key === WHOLE_EVENT ? teams : teams.filter((t) => t.division === key)), busy, onAdd: onNominate } : undefined,
      noWinner: { busy, onMark: (id) => onMarkNoWinner(id, key), onClear: (id) => onClearNoWinner(id, key) },
      locked,
      scoped,
      empty: from && found.nominees.length ? `No ${divisionTag(from)} nominees` : undefined,
    });
    return { panel, state, row, locked, name, send, held, body };
  };

  return (
    <div className="ja-aw-stack">
      {awards.map((award) => {
        if (award.blendedScope === "division") {
          const done = awardKeys(award, divisions, "blended").every((key) => lists.get(key)?.get(award.id)?.decided);
          return (
            <section key={award.id} className={done ? "ja-aw-ap ja-aw-bk ja-aw-dec" : "ja-aw-ap ja-aw-bk"} aria-label={`${award.label} Award`}>
              <header className="ja-aw-bh">
                <h2 title={award.blurb}>{award.label}</h2>
                <span className="ja-aw-cst">Given once per division</span>
              </header>
              <div className="ja-aw-halves" style={{ "--n": divisions.length } as React.CSSProperties}>
                {divisions.map((key) => {
                  const p = part(award, key);
                  if (!p) return null;
                  return (
                    <div key={key} className="ja-aw-half" role="group" aria-label={p.name}>
                      <header className="ja-aw-aph">
                        <h3 className="ja-aw-hn">
                          {key}
                          {p.locked ? <Locked /> : null}
                        </h3>
                        {awardStatus(p.panel, p.state, p.row)}
                        {sendControls(award, p.name, p.state, p.row, p.panel.decided, p.held, p.send)}
                      </header>
                      {p.body}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        }
        const p = part(award, WHOLE_EVENT);
        if (!p) return null;
        return (
          <section key={award.id} className={p.panel.decided ? "ja-aw-ap ja-aw-dec" : "ja-aw-ap"} aria-label={`${award.label} Award`}>
            <header className="ja-aw-aph">
              <h2 title={award.blurb}>
                {award.label}
                <span className="ja-aw-scope">{WHOLE_EVENT}</span>
                {p.locked ? <Locked /> : null}
              </h2>
              {awardStatus(p.panel, p.state, p.row)}
              {sendControls(award, p.name, p.state, p.row, p.panel.decided, p.held, p.send)}
            </header>
            {p.body}
          </section>
        );
      })}
    </div>
  );
}

/* ---- the matrix ------------------------------------------------------------------------------------------------ */

type BlendedMatrix = MatrixLike & { columns: { key?: string }[] };

/**
 * The matrix of a blended event, put together from one standard matrix per key: columns in the config's order, an award given per division with a column for
 * each (headed "Excellence ES", "Excellence MS"), every other award with one. A team of the other division has no cell under a division's column.
 * Rows are every team with a nomination or a win, most nominations first.
 */
export function blendedMatrix({
  awards,
  nominations,
  winners,
  noWinners,
  teams,
  panels,
  flags,
  divisions,
  panelId,
}: {
  awards: AwardView[];
  nominations: AwardsAdminView["nominations"];
  winners: WinnerRow[];
  noWinners: Pick<NoWinnerRow, "award_id" | "division">[];
  teams: Team[];
  panels: Pick<PublicPanel, "id" | "name">[];
  flags: Pick<FlagRow, "team_id" | "kind">[];
  divisions: string[];
  panelId: string;
}): BlendedMatrix {
  const held = heldByTeam(winners);
  // The whole event first: it knows every team and every nomination, so it is the base of a row.
  const keys = [WHOLE_EVENT, ...divisions];
  const byKey = new Map(
    keys.map((key) => {
      const here = key === WHOLE_EVENT ? teams : teams.filter((t) => t.division === key);
      const m = buildMatrix(awards, nominationsIn(nominations, teams, key, panelId), winnersOf(winners, key), here, panels, panelId, conductIn(flags, teams, key, panelId), noWinnersOf(noWinners, key), held);
      return [key, m] as const;
    }),
  );

  const columns: BlendedMatrix["columns"] = [];
  const from: { key: string; index: number }[] = [];
  for (const award of awards) {
    for (const key of awardKeys(award, divisions, "blended")) {
      const m = byKey.get(key)!;
      const index = m.columns.findIndex((c) => c.award.id === award.id);
      if (index < 0) continue;
      columns.push({ ...m.columns[index], key: award.blendedScope === "division" ? key : undefined });
      from.push({ key, index });
    }
  }

  const base = new Map<string, Matrix["rows"][number]>();
  for (const key of keys) for (const row of byKey.get(key)!.rows) if (!base.has(row.team.id)) base.set(row.team.id, row);
  const rows = [...base.values()]
    .map((row) => ({
      ...row,
      cells: from.map(({ key, index }) => byKey.get(key)!.rows.find((r) => r.team.id === row.team.id)?.cells[index] ?? ("none" as const)),
    }))
    .sort((a, b) => b.count - a.count || a.team.number.localeCompare(b.team.number, undefined, { numeric: true }));

  const shown = new Set(columns.map((c) => c.award.id));
  return { columns, rows, hidden: awards.filter((a) => !shown.has(a.id)) };
}

/* ---- the page ---------------------------------------------------------------------------------------------------- */

/**
 * The title and filters, then the matrix or the blocks, and the side panel. As `AwardsBoard`, everything arrives as props. Every write names its key.
 */
export function BlendedBoard({
  data,
  released = null,
  state,
  setup,
  rows,
  rubricList,
  from: fromProp = "",
  onFrom,
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
  onSend = noop,
  onRecall = noop,
  onSendAll = noop,
}: {
  data: AwardsAdminView;
  /** What has been sent to Marketing. Null (not asked yet): no Send, Recall, lock or count is drawn. */
  released?: ReleasedView | null;
  state: Slice;
  setup: Pick<EventSetup, "program" | "format">;
  rows: RankedRow[];
  rubricList: Rubric[];
  /** Nominees from: "" is every division. */
  from?: string;
  onFrom: (division: string) => void;
  /** "" is every panel. */
  panelId?: string;
  onPanel: (panelId: string) => void;
  view: View;
  onView: (view: View) => void;
  sel: BlendedSel | null;
  /** Null clears it. */
  onSelect: (sel: BlendedSel | null) => void;
  wide?: boolean;
  busy?: boolean;
  /** Give or clear a winner under this key. */
  onGive: (detail: Detail, key: string) => void;
  onClear: (detail: Detail, key: string) => void;
  onMarkNoWinner: (awardId: string, key: string) => void;
  onClearNoWinner: (awardId: string, key: string) => void;
  onNominate: (awardId: string, teamId: string) => void;
  onRemove: (detail: Detail, line: { id: string; by: string }) => void;
  onSend?: (awardId: string, key: string) => void;
  onRecall?: (awardId: string, key: string) => void;
  /** Send everything that is ready, under every key (the tab asks first). */
  onSendAll?: () => void;
}) {
  const uid = useId();
  const { awards, nominations, winners, noWinners } = data;
  const { teams, panels, flags, flagKinds } = state;
  const divisions = setupDivisions(setup) ?? [];
  // A division another console's save took out of the setup reads as All.
  const from = divisions.includes(fromProp) ? fromProp : "";

  if (!awards.length) return <p className="ja-empty">No awards are set up. They are listed in config/event.json.</p>;
  if (!divisions.length) return <p className="ja-empty">No divisions yet.</p>;

  const keys = scopeKeys(divisions, "blended");
  // A panel belongs to a division of the program, or to the whole event ("Any panel can interview any team").
  const panelsHere = panels.filter((p) => divisions.includes(p.division) || p.division === WHOLE_EVENT);
  const panel = panelsHere.find((p) => p.id === panelId) ?? null;
  const inEvent = nominationsIn(nominations, teams, WHOLE_EVENT);
  const scoped = nominationsIn(nominations, teams, WHOLE_EVENT, panel?.id);
  const conduct = conductIn(flags, teams, WHOLE_EVENT, panel?.id);
  const held = heldByTeam(winners);
  const releases = released?.releases ?? [];
  const lists = new Map(
    keys.map((key) => {
      const here = key === WHOLE_EVENT ? teams : teams.filter((t) => t.division === key);
      const built = buildAwardPanels(awards, nominationsIn(nominations, teams, key, panel?.id), winnersOf(winners, key), here, panels, panel?.id, conductIn(flags, teams, key, panel?.id), noWinnersOf(noWinners, key), held);
      return [key, new Map(built.map((p) => [p.award.id, p]))] as const;
    }),
  );
  const { decided, total } = eventDecided(winners, awards, divisions, noWinners, "blended");
  const readyCount = readyToSend(awards, divisions, winners, noWinners, releases, "blended").length;
  const detail = sel ? detailFor(sel, { awards, nominations, winners, noWinners, teams, panels, flags, format: "blended" }) : null;
  const sentRelease = detail && sel && sendState(detail.award, sel.key, winners, noWinners, releases) === "sent" ? releaseOf(releases, detail.award.id, sel.key) : null;
  const titleId = `${uid}-t`;

  const matrix = blendedMatrix({ awards, nominations: scoped, winners, noWinners, teams, panels, flags, divisions, panelId: panel?.id ?? ALL_PANELS });
  const shown = { ...matrix, rows: from ? matrix.rows.filter((r) => r.team.division === from || r.has.length > 0) : matrix.rows };
  const sent = new Set(
    matrix.columns.filter((c) => sendState(c.award, c.key ?? WHOLE_EVENT, winners, noWinners, releases) === "sent").map((c) => (c.key ? `${c.award.id}|${c.key}` : c.award.id)),
  );

  const nominee = detail && sel ? (
    <NomineePanel
      detail={detail}
      row={rows.find((r) => r.team.id === detail.team.id)}
      rubricList={rubricList}
      flags={flags.filter((f) => f.team_id === detail.team.id)}
      flagKinds={flagKinds}
      titleId={titleId}
      busy={busy}
      sentAt={sentRelease?.sent_at ?? null}
      onGive={(d) => onGive(d, sel.key)}
      onClear={(d) => onClear(d, sel.key)}
      onNominate={onNominate}
      onRemove={onRemove}
      scoped={{ ...scopedHas(winners), key: sel.key }}
    />
  ) : null;

  return (
    <div className="ja-aw ja-aw-bl">
      <div className="ja-aw-top">
        <h2 className="ja-aw-h">Awards</h2>
        <p className="ja-aw-meta">
          {setupLabel(setup)} · {panel ? panel.name : "all panels"} · <b>{decided} of {total}</b> decided · {nominationsText(scoped.length + conduct.size, distinctTeams(scoped, conduct.keys()))}
          {released ? ` · ${eventSentCount(releases, awards, divisions, "blended")} sent to Marketing` : null}
        </p>
        <p className="ja-aw-priv">
          <LockIcon />
          Winners stay private to you until the ceremony
        </p>
      </div>

      <div className="ja-aw-fbar">
        <div className="ja-aw-fg" role="group" aria-labelledby={`${uid}-d`}>
          <span id={`${uid}-d`} className="ja-aw-cl">
            Nominees from
          </span>
          <div className="ja-aw-chips ja-aw-from">
            <button type="button" className="ja-aw-chip" aria-pressed={from === ""} onClick={() => onFrom("")}>
              All
            </button>
            {divisions.map((d) => (
              <button key={d} type="button" className="ja-aw-chip" aria-pressed={d === from} title={divisionTag(d) !== d ? d : undefined} onClick={() => onFrom(d)}>
                <span aria-hidden="true">{divisionTag(d)}</span>
                <span className="sr-only">{d}</span>
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
              {panelChips(panelsHere, inEvent, conduct).map((c) => (
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
        </div>
      </div>

      <div className="ja-aw-cols">
        <div className="ja-aw-view">
          {view === "matrix" ? (
            <MatrixView
              matrix={shown}
              sel={sel}
              note={hiddenNote(matrix.hidden, panel?.name ?? null)}
              none={`No nominations in ${setupLabel(setup)}${panel ? ` from ${panel.name}` : ""} yet. Judges nominate the teams they have interviewed.`}
              sent={sent}
              tags
              onSelect={(s) => onSelect(toBlendedSel(s))}
            />
          ) : (
            <BlendedLists
              awards={awards}
              divisions={divisions}
              lists={lists}
              winners={winners}
              noWinners={noWinners}
              releases={releases}
              released={Boolean(released)}
              from={from}
              teams={teams}
              addable={!panel}
              sel={sel}
              onSelect={onSelect}
              busy={busy}
              onSend={onSend}
              onRecall={onRecall}
              onMarkNoWinner={onMarkNoWinner}
              onClearNoWinner={onClearNoWinner}
              onNominate={onNominate}
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
