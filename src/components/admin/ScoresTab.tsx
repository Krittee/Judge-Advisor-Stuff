"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { kindCounts } from "@/components/Flags";
import { BandPill, CheckIcon, CloseIcon } from "@/components/judge/parts";
import { call } from "@/components/useAppState";
import { Banner } from "@/components/ui";
import { bands, type Rubric } from "@/lib/rubrics";
import type { RankedTeam } from "@/lib/ranking";
import { tone } from "@/lib/tone";
import type { AppState, Note, Team } from "@/lib/types";
import { divisionTag } from "./floorLogic";
import { Pill } from "./RefereeTab";
import {
  activeScoreFilters,
  COMPARE_HINT,
  COMPARE_MAX,
  compareLines,
  compareMeta,
  conductText,
  filterRows,
  flagsByTeam,
  livePicks,
  NO_SCORE_FILTERS,
  notesText,
  percentText,
  pickBlocker,
  showingText,
  togglePick,
  totalLine,
  withRanks,
  worstConduct,
  type Cell,
  type CompareLine,
  type RankedRow,
  type ScoreFilters,
} from "./scoresLogic";

function Glyph({ size = 16, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const FiltersIcon = () => (
  <Glyph size={18}>
    <path d="M4 7h7M17 7h3M4 17h3M13 17h7" />
    <circle cx="14" cy="7" r="2.6" />
    <circle cx="10" cy="17" r="2.6" />
  </Glyph>
);
const BackIcon = () => (
  <Glyph size={18}>
    <path d="M15 6l-6 6 6 6" />
  </Glyph>
);
const OutIcon = () => (
  <Glyph size={12}>
    <path d="M7 17L17 7M9 7h8v8" />
  </Glyph>
);

/** A team's note count for the compare panel: a number, or "error" when the notes would not load. */
type NoteCounts = Record<string, number | "error">;

/**
 * How many notes each of these teams has, from the same `/api/notes?teamId=`
 * the team sheet reads. Asked again when `again` changes (the sheet opening
 * or closing), so a note written in the sheet shows up here.
 */
function useNoteCounts(ids: string[], again: string | null): NoteCounts {
  const [counts, setCounts] = useState<NoteCounts>({});
  const key = ids.join("\n");
  useEffect(() => {
    if (!key) return;
    let live = true;
    for (const id of key.split("\n")) {
      call<{ notes: Note[] }>(`/api/notes?teamId=${id}`, { method: "GET" })
        .then(({ notes }) => live && setCounts((c) => ({ ...c, [id]: notes.length })))
        .catch(() => live && setCounts((c) => ({ ...c, [id]: "error" })));
    }
    return () => {
      live = false;
    };
  }, [key, again]);
  return counts;
}

type Slice = Pick<AppState, "categories" | "divisions" | "panels" | "flags" | "flagKinds">;

/**
 * The Scores section: every team ranked on points, with two ticked to set
 * side by side. `ranked` is `rankTeams`' order, which this never changes;
 * the filters only hide rows, so a place means the same thing filtered or not.
 *
 * Rows open the team sheet (notes, scores, flags); a compared team's conduct
 * opens the Referee section on that team.
 */
export function ScoresTab({
  ranked,
  state,
  rubricList,
  loaded,
  error,
  sheetId,
  onOpenTeam,
  onOpenFlags,
}: {
  /** rankTeams, best first, unscored last. */
  ranked: RankedTeam[];
  state: Slice;
  rubricList: Rubric[];
  loaded: boolean;
  error: string | null;
  /** The team whose sheet is open, if any: the notes are counted again as it opens and closes. */
  sheetId: string | null;
  onOpenTeam: (team: Team) => void;
  /** The conduct link: the Referee section with that team selected. */
  onOpenFlags: (team: Team) => void;
}) {
  const [filters, setFilters] = useState<ScoreFilters>(NO_SCORE_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const rows = useMemo(() => withRanks(ranked), [ranked]);
  const live = livePicks(picked, rows);
  const paired = live.length === COMPARE_MAX;
  const notes = useNoteCounts(paired ? live : [], sheetId);

  // The phone's full-screen compare is only for as long as two are ticked.
  useEffect(() => {
    if (!paired) setCompareOpen(false);
  }, [paired]);

  // A phone turned past the breakpoint: the Filters sheet has no business open.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const close = (e: MediaQueryListEvent) => {
      if (e.matches) setFiltersOpen(false);
    };
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!loaded) return <p className="ja-empty">Loading…</p>;

  return (
    <ScoresBoard
      rows={rows}
      filters={filters}
      onFilters={setFilters}
      filtersOpen={filtersOpen}
      onFiltersOpen={setFiltersOpen}
      picked={live}
      compareOpen={compareOpen}
      onToggle={(id) => {
        setPicked(togglePick(live, id));
        setCompareOpen(false);
      }}
      onClear={() => {
        setPicked([]);
        setCompareOpen(false);
      }}
      onCompare={() => setCompareOpen(true)}
      onBack={() => setCompareOpen(false)}
      state={state}
      rubricList={rubricList}
      notes={notes}
      onOpenTeam={onOpenTeam}
      onOpenFlags={onOpenFlags}
    />
  );
}

/* ---- the page ------------------------------------------------------------- */

/**
 * The title and filters, the ranked list and the compare panel. From 1024px
 * the list and the panel sit side by side; on a phone the panel is a screen
 * of its own (`data-view`), opened from the pinned bar, with a back button.
 * Everything it shows comes in as props, so the markup can be checked without
 * a browser; `ScoresTab` owns the state.
 */
export function ScoresBoard({
  rows,
  filters,
  onFilters,
  filtersOpen = false,
  onFiltersOpen,
  picked,
  compareOpen = false,
  onToggle,
  onClear,
  onCompare,
  onBack,
  state,
  rubricList,
  notes,
  onOpenTeam,
  onOpenFlags,
}: {
  /** withRanks: the whole event, ranked. */
  rows: RankedRow[];
  filters: ScoreFilters;
  onFilters: (next: ScoreFilters) => void;
  filtersOpen?: boolean;
  onFiltersOpen: (open: boolean) => void;
  /** Ticked team ids, at most two. */
  picked: string[];
  /** On a phone: the compare screen instead of the list. */
  compareOpen?: boolean;
  onToggle: (teamId: string) => void;
  onClear: () => void;
  onCompare: () => void;
  onBack: () => void;
  state: Slice;
  rubricList: Rubric[];
  notes: NoteCounts;
  onOpenTeam: (team: Team) => void;
  onOpenFlags: (team: Team) => void;
}) {
  const uid = useId();
  const { categories, divisions, panels, flags, flagKinds } = state;
  const shown = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const byTeam = useMemo(() => flagsByTeam(flags), [flags]);
  const active = activeScoreFilters(filters);
  const scored = rows.filter((r) => r.scored).length;
  // In the list's order, so the left column is the higher-ranked team whichever was ticked first.
  const pair = rows.filter((r) => picked.includes(r.team.id));
  const view = pair.length === COMPARE_MAX && compareOpen ? "compare" : "list";

  // On a phone the list and the compare screen swap places: follow the focus across.
  const backButton = useRef<HTMLButtonElement>(null);
  const compareButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(view === "compare");
  useEffect(() => {
    const open = view === "compare";
    if (open !== wasOpen.current) (open ? backButton : compareButton).current?.focus();
    wasOpen.current = open;
  }, [view]);

  const filterGroups = (
    <>
      <Chips
        label="Notebook"
        value={filters.category}
        onPick={(category) => onFilters({ ...filters, category })}
        options={[{ value: "", label: "All" }, ...categories.map((c) => ({ value: c.id, label: c.label }))]}
      />
      <Chips
        label="Division"
        value={filters.division}
        onPick={(division) => onFilters({ ...filters, division })}
        options={[{ value: "", label: "All" }, ...divisions.map((d) => ({ value: d, label: d, short: divisionTag(d) }))]}
      />
    </>
  );

  return (
    <div className="ja-sc" data-view={view}>
      <div className="ja-sc-top">
        <h2 className="ja-sc-h">Scores</h2>
        <button
          type="button"
          className="ja-sc-fb"
          aria-haspopup="dialog"
          aria-label={active ? `Filters, ${active} on` : "Filters"}
          data-on={active > 0 ? "true" : undefined}
          onClick={() => onFiltersOpen(true)}
        >
          <FiltersIcon />
          Filters
          {active ? (
            <span className="ja-sc-fc" aria-hidden="true">
              {active}
            </span>
          ) : null}
        </button>
        <p className="ja-sc-meta">
          {showingText(shown.length)}
          <span className="ja-sc-sc">
            {" "}
            · <b>{scored} of {rows.length}</b> scored
          </span>
        </p>
        <div className="ja-sc-leg" role="group" aria-label="Score bands">
          {bands().map((b) => (
            <span key={b.id} className={`jg-band ring-1 ring-inset ${tone(b.color)}`}>
              {b.label}
              {b.minPercent > 0 ? ` ≥${b.minPercent}%` : ""}
            </span>
          ))}
        </div>
      </div>

      <div className="ja-sc-fbar">{filterGroups}</div>

      {!rows.length ? (
        <p className="ja-empty">No teams to score yet.</p>
      ) : (
        <div className="ja-sc-cols">
          {pair.length < COMPARE_MAX ? <p className="ja-sc-hint">{COMPARE_HINT}</p> : null}

          <section className="ja-sc-list" aria-label="Ranked teams">
            <div className="ja-sc-lh">
              <p>
                <b>{picked.length} selected</b>
                <span> · Compare</span>
              </p>
              <button type="button" className="ja-sc-lnk" disabled={!picked.length} onClick={onClear}>
                Clear
              </button>
            </div>
            {shown.length ? (
              <ul>
                {shown.map((row) => (
                  <ScoreRowItem
                    key={row.team.id}
                    row={row}
                    on={picked.includes(row.team.id)}
                    blocker={pickBlocker(picked, row)}
                    conduct={worstConduct(byTeam.get(row.team.id) ?? [], flagKinds)}
                    onToggle={onToggle}
                    onOpen={onOpenTeam}
                  />
                ))}
              </ul>
            ) : (
              <p className="ja-sc-none">
                No teams match these filters.{" "}
                <button type="button" className="ja-sc-lnk" onClick={() => onFilters(NO_SCORE_FILTERS)}>
                  Clear filters
                </button>
              </p>
            )}
          </section>

          {pair.length === COMPARE_MAX ? (
            <ComparePanel
              a={pair[0]}
              b={pair[1]}
              rubricList={rubricList}
              panels={panels}
              flags={byTeam}
              flagKinds={flagKinds}
              notes={notes}
              backRef={backButton}
              onBack={onBack}
              onOpenTeam={onOpenTeam}
              onOpenFlags={onOpenFlags}
            />
          ) : null}
        </div>
      )}

      {pair.length === COMPARE_MAX ? (
        <div className="ja-sc-pbar" role="region" aria-label="Compare selection">
          <p className="ja-sc-sel">
            <b>2 selected</b>
            <span>{pair.map((r) => r.team.number).join(" · ")}</span>
          </p>
          <button type="button" className="ja-sc-quiet" onClick={onClear}>
            Clear
          </button>
          <button type="button" className="ja-sc-cmpb" ref={compareButton} onClick={onCompare}>
            Compare
          </button>
        </div>
      ) : null}

      {/* A sheet is a dialog: it stays in the page, shut, and is opened by the Filters button. */}
      <FilterSheet open={filtersOpen} titleId={`${uid}-fh`} onClose={() => onFiltersOpen(false)}>
        <div className="ja-sh-form">
          <div className="jg-grab" aria-hidden="true" />
          <div className="ja-sh-top">
            <h2 id={`${uid}-fh`}>Filters</h2>
            <button type="button" className="ja-x" aria-label="Close" onClick={() => onFiltersOpen(false)}>
              <CloseIcon />
            </button>
          </div>
          <div className="ja-cf-scroll">{filterGroups}</div>
          <div className="ja-cf-foot ja-sc-ff">
            <button type="button" className="ja-prim" onClick={() => onFiltersOpen(false)}>
              Show {shown.length === 1 ? "1 team" : `${shown.length} teams`}
            </button>
            {active ? (
              <button type="button" className="jg-quiet" onClick={() => onFilters(NO_SCORE_FILTERS)}>
                Clear filters
              </button>
            ) : null}
          </div>
        </div>
      </FilterSheet>
    </div>
  );
}

/** A native <dialog> opened with showModal(), as the Sections sheet is. */
function FilterSheet({ open, titleId, onClose, children }: { open: boolean; titleId: string; onClose: () => void; children: React.ReactNode }) {
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
      className="ja-sheet ja-sc-fsheet"
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
      {open ? children : null}
    </dialog>
  );
}

/** One filter: All, then each choice, as pressed/not-pressed buttons. */
function Chips({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; short?: string }[];
  onPick: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="ja-sc-fg" role="group" aria-labelledby={id}>
      <span id={id} className="ja-sc-cl">
        {label}
      </span>
      <div className="ja-sc-chips">
        {options.map((o) => (
          <button key={o.value} type="button" className="ja-sc-chip" aria-pressed={value === o.value} title={o.short ? o.label : undefined} onClick={() => onPick(o.value)}>
            {o.short ? (
              <>
                <span aria-hidden="true">{o.short}</span>
                <span className="sr-only">{o.label}</span>
              </>
            ) : (
              o.label
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---- the ranked list ------------------------------------------------------- */

/**
 * One team in the list: a checkbox to compare it, and a button that opens its
 * team sheet. An unscored team is muted and cannot be ticked, but its row still
 * opens, because the sheet is where it gets scored. The worst thing a referee
 * flagged sits on the row, so a disqualification shows without opening anything.
 */
export function ScoreRowItem({
  row,
  on,
  blocker,
  conduct,
  onToggle,
  onOpen,
}: {
  row: RankedRow;
  on: boolean;
  /** Why the checkbox is off (a third team, or an unscored one), or null. */
  blocker: string | null;
  conduct: ReturnType<typeof worstConduct>;
  onToggle: (teamId: string) => void;
  onOpen: (team: Team) => void;
}) {
  const { team } = row;
  return (
    <li className={`ja-sc-row${on ? " ja-sc-on" : ""}${row.scored ? "" : " ja-sc-un"}`}>
      <label className="ja-sc-ck" title={blocker ?? undefined}>
        <input
          type="checkbox"
          className="ja-sc-cin"
          checked={on}
          disabled={blocker !== null}
          title={blocker ?? undefined}
          aria-label={`Compare ${team.number}`}
          onChange={() => onToggle(team.id)}
        />
        <span className="ja-sc-box" aria-hidden="true">
          <CheckIcon />
        </span>
      </label>
      <button type="button" className="ja-sc-main" onClick={() => onOpen(team)}>
        <span className="ja-sc-rn">{row.rank ?? "—"}</span>
        <span className="ja-sc-t">
          <span className="ja-sc-t1">
            <b>{team.number}</b>
            <span className="ja-sc-nm">{team.name}</span>
          </span>
          {conduct ? (
            <Pill kind={conduct.kind} id={conduct.kind.id}>
              {conduct.kind.short} ×{conduct.count}
            </Pill>
          ) : null}
        </span>
        <span className="ja-sc-s">
          {row.scored ? (
            <>
              {/* The denominator is not the same for every team, so it is always shown rather than left to be assumed. */}
              <b className="ja-sc-tot">
                {row.total}
                <small>/{row.max}</small>
              </b>
              <BandPill total={row.total} max={row.max} scored />
            </>
          ) : (
            <span className="ja-sc-ns">not scored</span>
          )}
        </span>
      </button>
    </li>
  );
}

/* ---- the compare panel ------------------------------------------------------ */

/** A number out of its maximum; the higher side of a row is bold. A rubric the team's notebook leaves out reads "excluded". */
function CellView({ cell, bold }: { cell: Cell; bold: boolean }) {
  if (cell.kind === "excluded") return <span className="ja-sc-x">excluded</span>;
  if (cell.kind === "unscored") {
    return (
      <span className="ja-sc-x">
        —<span className="sr-only"> not scored</span>
      </span>
    );
  }
  const value = (
    <>
      {cell.got}
      <span className="ja-sc-of">/{cell.max}</span>
    </>
  );
  return bold ? (
    <b className="ja-sc-v ja-sc-hi">
      {value}
      <span className="sr-only"> (higher)</span>
    </b>
  ) : (
    <span className="ja-sc-v">{value}</span>
  );
}

function ComparePanel({
  a,
  b,
  rubricList,
  panels,
  flags,
  flagKinds,
  notes,
  backRef,
  onBack,
  onOpenTeam,
  onOpenFlags,
}: {
  a: RankedRow;
  b: RankedRow;
  rubricList: Rubric[];
  panels: Slice["panels"];
  flags: Map<string, Slice["flags"]>;
  flagKinds: Slice["flagKinds"];
  notes: NoteCounts;
  backRef?: React.Ref<HTMLButtonElement>;
  onBack: () => void;
  onOpenTeam: (team: Team) => void;
  onOpenFlags: (team: Team) => void;
}) {
  const headId = useId();
  const sides = [a, b] as const;
  const total = totalLine(a, b);
  const lines: CompareLine[] = compareLines(a, b, rubricList);

  return (
    <section className="ja-sc-cmp" aria-labelledby={headId}>
      <button type="button" className="ja-sc-back" ref={backRef} onClick={onBack}>
        <BackIcon />
        Ranked teams
      </button>
      <h2 id={headId} className="sr-only">
        Compare {a.team.number} and {b.team.number}
      </h2>
      <table>
        <caption className="sr-only">
          {a.team.number} {a.team.name} compared with {b.team.number} {b.team.name}
        </caption>
        <colgroup>
          <col className="ja-sc-c0" />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Measure</span>
            </th>
            {sides.map((r) => (
              <th key={r.team.id} scope="col">
                <span className="ja-sc-tn">{r.team.number}</span>
                <span className="ja-sc-tnm">{r.team.name}</span>
                <span className="ja-sc-tmt">{compareMeta(r, panels)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="ja-sc-tt">
            <th scope="row">Total</th>
            {sides.map((r, i) => (
              <td key={r.team.id}>
                <CellView cell={total.cells[i]} bold={total.higher === i} />
                <span className="ja-sc-bl">
                  <BandPill total={r.total} max={r.max} scored={r.scored} />
                  <span className="ja-sc-pc">{percentText(r.total, r.max)}</span>
                </span>
              </td>
            ))}
          </tr>
          {lines.map((l) => (
            <tr key={l.id} className={l.level === "rubric" ? "ja-sc-grp" : undefined}>
              <th scope="row">{l.label}</th>
              {l.cells.map((cell, i) => (
                <td key={sides[i].team.id}>
                  <CellView cell={cell} bold={l.higher === i} />
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row">Notes</th>
            {sides.map((r) => {
              const n = notes[r.team.id];
              return (
                <td key={r.team.id}>
                  <span className="ja-sc-nct">
                    {n === undefined ? "…" : n === "error" ? "unavailable" : notesText(n)}
                  </span>
                  <button type="button" className="ja-sc-olink" aria-label={`Open team sheet for ${r.team.number} ${r.team.name}`} onClick={() => onOpenTeam(r.team)}>
                    Open team sheet
                  </button>
                </td>
              );
            })}
          </tr>
          <tr className="ja-sc-cd">
            <th scope="row">Conduct</th>
            {sides.map((r) => {
              const own = flags.get(r.team.id) ?? [];
              const kinds = kindCounts(own, flagKinds);
              return (
                <td key={r.team.id}>
                  {kinds.length ? (
                    <button
                      type="button"
                      className="ja-sc-cbtn"
                      aria-label={`Open referee flags for ${r.team.number} ${r.team.name}: ${conductText(own, flagKinds)}`}
                      onClick={() => onOpenFlags(r.team)}
                    >
                      {kinds.map(({ kind, count }) => (
                        <Pill key={kind.id} kind={kind} id={kind.id}>
                          {kind.short} ×{count}
                        </Pill>
                      ))}
                      <OutIcon />
                    </button>
                  ) : (
                    <span className="ja-sc-none">None</span>
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </section>
  );
}
