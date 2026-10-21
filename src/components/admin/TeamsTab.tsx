"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import { ChevronDown, ChevronRight, CloseIcon, StatusPill, WarnIcon } from "@/components/judge/parts";
import { call } from "@/components/useAppState";
import { formatClock } from "@/components/ui";
import { STATUS_META, type Status } from "@/lib/status";
import type { AppState, RequestRow, Team } from "@/lib/types";
import { EventData } from "./EventData";
import { divisionTag, teamCount } from "./floorLogic";
import { Pill } from "./RefereeTab";
import {
  activeFilters,
  filterTeams,
  flagPills,
  interviewOf,
  isDirty,
  leaveAfterAsking,
  notebookCounts,
  openInRefereeAfterAsking,
  panelCell,
  panelLoad,
  panelOptions,
  removeTeamAfterAsking,
  RESETTABLE_STATUSES,
  resetStatusAfterAsking,
  saveTeamAfterAsking,
  startDraft,
  strandedIds,
  type Filters,
  type TeamDraft,
} from "./teamsLogic";

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
const FiltersIcon = () => (
  <Glyph size={18}>
    <path d="M4 7h7M17 7h3M4 17h3M13 17h7" />
    <circle cx="14" cy="7" r="2.6" />
    <circle cx="10" cy="17" r="2.6" />
  </Glyph>
);
const TrashIcon = () => (
  <Glyph>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </Glyph>
);
const OutIcon = () => (
  <Glyph size={14}>
    <path d="M7 17L17 7M9 7h8v8" />
  </Glyph>
);

const WIDE = "(min-width: 1024px)";
const watchWide = (notify: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const isWide = () => window.matchMedia(WIDE).matches;

/** From 1024px the editor is a drawer beside a table; below it, a sheet over a list. */
const useWide = (): boolean => useSyncExternalStore(watchWide, isWide, () => false);

type Slice = Pick<AppState, "teams" | "panels" | "requests" | "categories" | "divisions" | "conflicts" | "judges" | "flags" | "flagKinds">;

/**
 * The Teams section: the roster and who judges whom. Select a team to edit it
 * in a drawer (a sheet on a phone); "Save changes" sends number, name, pit,
 * division, notebook and panel together in one PATCH. The interview status override,
 * Remove team and the two resets each ask first, through the in-page confirm.
 */
export function TeamsTab({
  state,
  refresh,
  onError,
  onOpenFlags,
  onOpenSheet,
}: {
  state: AppState;
  refresh: () => Promise<void>;
  onError: (message: string | null) => void;
  /** Switch to the Referee section with this team selected, as Scores' conduct link does. */
  onOpenFlags: (teamId: string) => void;
  /** Open this team's sheet (notes, scores, flags) over the console. */
  onOpenSheet: (teamId: string) => void;
}) {
  const wide = useWide();
  const { ask, dialog } = useConfirm();
  const [filters, setFilters] = useState<Filters>({ q: "", division: "", category: "" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [perPanel, setPerPanel] = useState(10);
  const [autoBusy, setAutoBusy] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  // What is typed into the editor, for the team it was typed for. Until something is, the editor follows the team.
  const [edit, setEdit] = useState<{ teamId: string; draft: TeamDraft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const team = pickedId ? (state.teams.find((t) => t.id === pickedId) ?? null) : null;
  const draft = team ? (edit?.teamId === team.id ? edit.draft : startDraft(team)) : null;

  // Closing the drawer puts the focus back on the row it came from.
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const lastPicked = useRef<string | null>(null);
  useEffect(() => {
    if (!pickedId && lastPicked.current && wide) rows.current.get(lastPicked.current)?.focus();
    lastPicked.current = pickedId;
  }, [pickedId, wide]);

  // A phone turned past the breakpoint: the Filters sheet is not a thing on a wide screen.
  useEffect(() => {
    if (wide) setFiltersOpen(false);
  }, [wide]);

  /** Close the editor; with unsaved changes, only if the Judge Advisor agrees to lose them. */
  async function close(): Promise<boolean> {
    if (team && draft && !(await leaveAfterAsking(ask, team, draft))) return false;
    setPickedId(null);
    setEdit(null);
    setError(null);
    return true;
  }

  async function pick(id: string) {
    if (id === pickedId) return;
    if (team && draft && !(await leaveAfterAsking(ask, team, draft))) return;
    setPickedId(id);
    setEdit(null);
    setError(null);
  }

  async function save() {
    if (!team || !draft || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (await saveTeamAfterAsking(ask, call, team, draft, state.panels)) {
        await refresh();
        setEdit(null);
        // A sheet has done its job; a drawer stays, showing the saved team.
        if (!wide) setPickedId(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function resetStatus(request: RequestRow, status: Status) {
    if (!team) return;
    setError(null);
    try {
      if (await resetStatusAfterAsking(ask, call, team, request, status)) await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove() {
    if (!team) return;
    setError(null);
    try {
      if (await removeTeamAfterAsking(ask, call, team)) {
        await refresh();
        setPickedId(null);
        setEdit(null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function openFlags() {
    if (team && draft) await openInRefereeAfterAsking(ask, team, draft, onOpenFlags);
  }

  async function autoAssign() {
    setAutoBusy(true);
    onError(null);
    try {
      const res = await call<{ assigned: number }>("/api/admin/teams", {
        method: "PATCH",
        body: { action: "autoAssign", perPanel, division: filters.division || undefined },
      });
      await refresh();
      if (!res.assigned) onError("Nothing to assign — every team already has a panel.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setAutoBusy(false);
    }
  }

  return (
    <div
      className="ja-tm"
      data-open={wide && team ? "true" : undefined}
      onKeyDown={(e) => {
        // Escape closes the drawer. A dialog (the confirm, or the phone's sheet) has its own Escape.
        if (e.key !== "Escape" || !wide || !team || e.defaultPrevented) return;
        if ((e.target as HTMLElement).closest("dialog")) return;
        // Without this, the browser's own Escape action cancels the confirm
        // that close() has just opened, so a dirty drawer never asks.
        e.preventDefault();
        void close();
      }}
    >
      {dialog}
      <TeamsBoard
        state={state}
        wide={wide}
        filters={filters}
        onFilters={setFilters}
        filtersOpen={filtersOpen}
        onFiltersOpen={setFiltersOpen}
        perPanel={perPanel}
        onPerPanel={setPerPanel}
        autoBusy={autoBusy}
        onAutoAssign={autoAssign}
        pickedId={team?.id ?? null}
        onPick={pick}
        rowRef={(id, el) => {
          if (el) rows.current.set(id, el);
          else rows.current.delete(id);
        }}
        draft={draft}
        onDraft={(next) => team && setEdit({ teamId: team.id, draft: next })}
        saving={saving}
        error={error}
        onSave={save}
        onClose={close}
        onResetStatus={resetStatus}
        onRemove={remove}
        onOpenFlags={openFlags}
        onOpenSheet={() => team && onOpenSheet(team.id)}
        eventData={<EventData refresh={refresh} />}
      />
    </div>
  );
}

/* ---- the page ------------------------------------------------------------- */

/**
 * The toolbar, the table (a list on a phone), the editor beside or over it and
 * Event data below. Everything it shows comes in as props, so the markup can
 * be checked without a browser; `TeamsTab` owns the state.
 */
export function TeamsBoard({
  state,
  wide,
  filters,
  onFilters,
  filtersOpen = false,
  onFiltersOpen,
  perPanel,
  onPerPanel,
  autoBusy = false,
  onAutoAssign,
  pickedId,
  onPick,
  rowRef,
  draft,
  onDraft,
  saving = false,
  error = null,
  onSave,
  onClose,
  onResetStatus,
  onRemove,
  onOpenFlags,
  onOpenSheet,
  eventData = null,
}: {
  state: Slice;
  wide: boolean;
  filters: Filters;
  onFilters: (next: Filters) => void;
  filtersOpen?: boolean;
  onFiltersOpen: (open: boolean) => void;
  perPanel: number;
  onPerPanel: (n: number) => void;
  autoBusy?: boolean;
  onAutoAssign: () => void;
  /** The team the editor is open on. */
  pickedId: string | null;
  onPick: (id: string) => void;
  rowRef?: (id: string, el: HTMLButtonElement | null) => void;
  /** What the editor shows; null while it is shut. */
  draft: TeamDraft | null;
  onDraft: (next: TeamDraft) => void;
  saving?: boolean;
  error?: string | null;
  onSave: () => void;
  onClose: () => void;
  onResetStatus: (request: RequestRow, status: Status) => void;
  onRemove: () => void;
  onOpenFlags: () => void;
  onOpenSheet: () => void;
  eventData?: React.ReactNode;
}) {
  const uid = useId();
  const { teams, panels, requests, categories, divisions, conflicts, judges, flags, flagKinds } = state;
  const shown = useMemo(() => filterTeams(teams, filters), [teams, filters]);
  const unassigned = shown.filter((t) => !t.panel_id).length;
  const stranded = useMemo(() => strandedIds(teams, panels, conflicts, judges), [teams, panels, conflicts, judges]);
  const team = pickedId ? (teams.find((t) => t.id === pickedId) ?? null) : null;
  const active = activeFilters(filters);
  const categoryLabel = (id: string) => categories.find((c) => c.id === id)?.label ?? id;
  const editor = (t: Team, d: TeamDraft): EditorProps => ({
    uid,
    team: t,
    draft: d,
    onDraft,
    state,
    saving,
    error,
    onSave,
    onClose,
    onResetStatus,
    onRemove,
    onOpenFlags,
    onOpenSheet,
  });

  const selects = (
    <>
      <SelectField
        id={`${uid}-dv`}
        label="Division"
        className="ja-tm-dv"
        value={filters.division}
        onChange={(division) => onFilters({ ...filters, division })}
        options={[{ value: "", label: "All divisions" }, ...divisions.map((d) => ({ value: d, label: d }))]}
      />
      <SelectField
        id={`${uid}-nb`}
        label="Notebook type"
        className="ja-tm-nb"
        value={filters.category}
        onChange={(category) => onFilters({ ...filters, category })}
        options={[{ value: "", label: "All notebooks" }, ...categories.map((c) => ({ value: c.id, label: c.label }))]}
      />
    </>
  );

  return (
    <>
      <div className="ja-tm-main">
        <section className="ja-tm-tb" aria-label="Team filters">
          <div className="ja-tm-r1">
            <div className="ja-tm-srch">
              <label className="sr-only" htmlFor={`${uid}-q`}>
                Filter by number or name
              </label>
              <SearchIcon />
              <input
                id={`${uid}-q`}
                className="ja-in"
                type="text"
                autoComplete="off"
                placeholder="Filter by number or name"
                value={filters.q}
                onChange={(e) => onFilters({ ...filters, q: e.target.value })}
              />
            </div>
            {wide ? (
              selects
            ) : (
              <button
                type="button"
                className="ja-tm-fb"
                aria-haspopup="dialog"
                aria-label={active ? `Filters, ${active} on` : "Filters"}
                data-on={active > 0 ? "true" : undefined}
                onClick={() => onFiltersOpen(true)}
              >
                <FiltersIcon />
                Filters
                {active ? (
                  <span className="ja-tm-fc" aria-hidden="true">
                    {active}
                  </span>
                ) : null}
              </button>
            )}
          </div>

          <div className="ja-tm-aa" role="group" aria-label="Auto-assign">
            <div className="ja-tm-mpf">
              <label className="ja-tm-mpl" htmlFor={`${uid}-max`}>
                Max per panel
              </label>
              <input
                id={`${uid}-max`}
                className="ja-in"
                type="number"
                min={1}
                max={40}
                value={perPanel}
                onChange={(e) => onPerPanel(Number(e.target.value))}
              />
            </div>
            <button
              type="button"
              className="ja-tm-ghost"
              title="Assigns within each division and skips conflicted panels."
              disabled={autoBusy || !unassigned}
              onClick={onAutoAssign}
            >
              Auto-assign {unassigned} unassigned
            </button>
          </div>

          <div className="ja-tm-chr" role="group" aria-label="Notebook counts">
            <span className="ja-tm-cl">Notebook</span>
            {notebookCounts(shown, categories).map(({ category, count }) => (
              <span key={category.id} className="ja-tm-ch">
                {category.label}
                <b>{count}</b>
              </span>
            ))}
            <p className="ja-tm-rd">
              {teams.length} teams · {panels.length} panels
            </p>
          </div>
          <div className="ja-tm-chr" role="group" aria-label="Panel load">
            <span className="ja-tm-cl">Panels</span>
            {panelLoad(teams, panels, filters.division).map(({ panel, count }) => (
              <span key={panel.id} className="ja-tm-ch">
                {panel.name} · {divisionTag(panel.division)} · <b>{count}</b>
              </span>
            ))}
            {unassigned ? (
              <span className="ja-tm-ch ja-tm-un">
                Unassigned<b>{unassigned}</b>
              </span>
            ) : null}
          </div>
        </section>

        <p className="ja-tm-help">Select a team to edit its number, name, pit, panel and notebook.</p>

        {!shown.length ? (
          <p className="ja-empty">No teams match. Use the Import tab to add your roster.</p>
        ) : wide ? (
          <TeamTable
            shown={shown}
            panels={panels}
            requests={requests}
            flags={flags}
            flagKinds={flagKinds}
            stranded={stranded}
            categoryLabel={categoryLabel}
            pickedId={pickedId}
            onPick={onPick}
            rowRef={rowRef}
          />
        ) : (
          <TeamList
            shown={shown}
            panels={panels}
            requests={requests}
            stranded={stranded}
            categoryLabel={categoryLabel}
            pickedId={pickedId}
            onPick={onPick}
            rowRef={rowRef}
          />
        )}

        {eventData}
      </div>

      {wide ? (
        team && draft ? <Drawer {...editor(team, draft)} /> : null
      ) : (
        <>
          {/* A sheet is a dialog: it stays in the page, shut, and is opened by the team picked. */}
          <Sheet open={Boolean(team && draft)} className="ja-tm-sheet" labelledBy={`${uid}-t`} onClose={onClose}>
            {team && draft ? <SheetBody titleId={`${uid}-t`} {...editor(team, draft)} /> : null}
          </Sheet>

          <Sheet open={filtersOpen} className="ja-tm-fsheet" labelledBy={`${uid}-fh`} onClose={() => onFiltersOpen(false)}>
            <div className="ja-sh-form">
              <div className="jg-grab" aria-hidden="true" />
              <div className="ja-sh-top">
                <h2 id={`${uid}-fh`}>Filters</h2>
                <button type="button" className="ja-x" aria-label="Close" onClick={() => onFiltersOpen(false)}>
                  <CloseIcon />
                </button>
              </div>
              <div className="ja-cf-scroll">{selects}</div>
              <div className="ja-cf-foot ja-tm-ff">
                <button type="button" className="ja-prim" onClick={() => onFiltersOpen(false)}>
                  Show {teamCount(shown.length)}
                </button>
                {active ? (
                  <button type="button" className="jg-quiet" onClick={() => onFilters({ ...filters, division: "", category: "" })}>
                    Clear filters
                  </button>
                ) : null}
              </div>
            </div>
          </Sheet>
        </>
      )}
    </>
  );
}

function SelectField({
  id,
  label,
  className,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  className: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className={`ja-selw ${className}`}>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="ja-in ja-sel" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown />
    </div>
  );
}

/* ---- the roster ------------------------------------------------------------ */

type RosterProps = {
  shown: Team[];
  panels: Slice["panels"];
  requests: Slice["requests"];
  stranded: Set<string>;
  categoryLabel: (id: string) => string;
  pickedId: string | null;
  onPick: (id: string) => void;
  rowRef?: (id: string, el: HTMLButtonElement | null) => void;
};

/** ≥1024px: a read-only table. The row is the button; a click anywhere on it opens the drawer. */
function TeamTable({ shown, panels, requests, flags, flagKinds, stranded, categoryLabel, pickedId, onPick, rowRef }: RosterProps & { flags: Slice["flags"]; flagKinds: Slice["flagKinds"] }) {
  return (
    <div className="ja-tm-tw">
      <table>
        <caption className="sr-only">Teams</caption>
        <colgroup>
          <col className="ja-k-n" />
          <col />
          <col className="ja-k-pit ja-tm-lo" />
          <col className="ja-k-nb ja-tm-lo" />
          <col className="ja-k-dv ja-tm-lo" />
          <col className="ja-k-pn" />
          <col className="ja-k-bk ja-tm-lo" />
          <col className="ja-k-iv" />
          <col className="ja-k-fl" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Team</th>
            <th scope="col">Name</th>
            <th scope="col" className="ja-tm-lo">Pit</th>
            <th scope="col" className="ja-tm-lo">Notebook</th>
            <th scope="col" className="ja-tm-lo">Div</th>
            <th scope="col">Panel</th>
            <th scope="col" className="ja-tm-lo">Booked</th>
            <th scope="col">Interview</th>
            <th scope="col">Flags</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((team) => {
            const { request, bookedAt } = interviewOf(team.id, requests);
            const on = team.id === pickedId;
            return (
              <tr key={team.id} className={on ? "ja-tm-sel" : undefined} onClick={() => onPick(team.id)}>
                <td>
                  <button
                    type="button"
                    className="ja-tm-rb"
                    aria-label={`Edit ${team.number} ${team.name}`}
                    aria-current={on ? "true" : undefined}
                    ref={(el) => rowRef?.(team.id, el)}
                  >
                    {team.number}
                  </button>
                </td>
                <td>
                  <span className="ja-tm-nm">{team.name}</span>
                </td>
                <td className="ja-tm-c ja-tm-lo">{team.pit ?? "—"}</td>
                <td className="ja-tm-lo">{categoryLabel(team.category)}</td>
                <td className="ja-tm-c ja-tm-lo">{divisionTag(team.division)}</td>
                <td>
                  <PanelText cell={panelCell(team, panels, stranded)} />
                </td>
                <td className="ja-tm-lo">
                  <span className={bookedAt ? "ja-tm-bk" : "ja-tm-bk ja-tm-none"}>{formatClock(bookedAt)}</span>
                </td>
                <td>{request ? <StatusPill status={request.status} short /> : <span className="ja-tm-bk ja-tm-none">—</span>}</td>
                <td>
                  <div className="ja-tm-fl2">
                    {flagPills(team.id, flags, flagKinds).map(({ kind, count }) => (
                      <Pill key={kind.id} kind={kind} id={kind.id}>
                        {kind.short} ×{count}
                      </Pill>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PanelText({ cell }: { cell: ReturnType<typeof panelCell> }) {
  return cell.kind === "panel" ? (
    <>{cell.name}</>
  ) : cell.kind === "unassigned" ? (
    <span className="ja-pill">Unassigned</span>
  ) : (
    <span className="ja-tm-dp">no panel left</span>
  );
}

/** <1024px: compact two-line rows, each a button. */
function TeamList({ shown, panels, requests, stranded, categoryLabel, pickedId, onPick, rowRef }: RosterProps) {
  return (
    <ul className="ja-tm-ll" aria-label="Teams">
      {shown.map((team) => {
        const { request } = interviewOf(team.id, requests);
        const cell = panelCell(team, panels, stranded);
        const on = team.id === pickedId;
        const parts: React.ReactNode[] = [
          team.pit ? `Pit ${team.pit}` : null,
          categoryLabel(team.category),
          divisionTag(team.division),
          cell.kind === "panel" ? (
            cell.name
          ) : cell.kind === "unassigned" ? (
            <span className="ja-tm-w">unassigned</span>
          ) : (
            <span className="ja-tm-d">no panel left</span>
          ),
        ].filter((p) => p !== null);
        return (
          <li key={team.id}>
            <button
              type="button"
              className="ja-tm-lrow"
              aria-label={`Edit ${team.number} ${team.name}`}
              aria-current={on ? "true" : undefined}
              ref={(el) => rowRef?.(team.id, el)}
              onClick={() => onPick(team.id)}
            >
              <span className="ja-tm-l1">
                <b>{team.number}</b>
                <span className="ja-tm-nm">{team.name}</span>
              </span>
              <span className="ja-tm-l2">
                {parts.map((p, i) => (
                  <span key={i}>
                    {i ? " · " : null}
                    {p}
                  </span>
                ))}
              </span>
              <span className="ja-tm-lr">
                {request ? <StatusPill status={request.status} short /> : null}
                <ChevronRight />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ---- the editor ----------------------------------------------------------- */

/**
 * A native <dialog> opened with showModal(), as the Sections and Correct flag
 * sheets are. Escape and the backdrop ask the tab to close rather than closing
 * on their own, so unsaved changes can be asked about first.
 */
function Sheet({
  open,
  className,
  labelledBy,
  onClose,
  children,
}: {
  open: boolean;
  className: string;
  labelledBy: string;
  onClose: () => void;
  children?: React.ReactNode;
}) {
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
      className={`ja-sheet ${className}`}
      aria-modal="true"
      aria-labelledby={labelledBy || undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // The browser closed it anyway (a second Escape): put it back, then ask.
      onClose={() => {
        if (open) {
          ref.current?.showModal();
          onClose();
        }
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

type EditorProps = {
  uid: string;
  team: Team;
  draft: TeamDraft;
  onDraft: (next: TeamDraft) => void;
  state: Slice;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onClose: () => void;
  onResetStatus: (request: RequestRow, status: Status) => void;
  onRemove: () => void;
  onOpenFlags: () => void;
  onOpenSheet: () => void;
};

/** The pinned bottom of the editor: what the server refused, and "Save changes", disabled until something changed. */
function EditorFoot({ team, draft, saving, error }: Pick<EditorProps, "team" | "draft" | "saving" | "error">) {
  return (
    <>
      {error ? (
        <p className="ja-err" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="ja-prim" disabled={!isDirty(team, draft) || saving}>
        {saving ? "Saving…" : "Save changes"}
      </button>
    </>
  );
}

/** Enter in a field saves, like the button -- and, like it, only when something changed. */
const submitter = (p: EditorProps) => (e: React.FormEvent) => {
  e.preventDefault();
  if (isDirty(p.team, p.draft) && !p.saving) p.onSave();
};

/** From 1024px: ~368px on the right, pushing the table narrower rather than covering it. */
function Drawer(p: EditorProps) {
  const { team } = p;
  const drawer = useRef<HTMLElement>(null);

  // Opening it moves the focus onto the drawer itself, so the next Tab is its first field.
  useEffect(() => {
    drawer.current?.focus();
  }, [team.id]);

  return (
    <aside className="ja-tm-dr" ref={drawer} tabIndex={-1} aria-label={`Edit team · ${team.number} ${team.name}`}>
      <header className="ja-tm-drh">
        <div>
          <p className="ja-sec">Edit team</p>
          <h2>
            <b>{team.number}</b>
            <span>{team.name}</span>
          </h2>
        </div>
        <button type="button" className="ja-x" aria-label="Close team drawer" onClick={p.onClose}>
          <CloseIcon />
        </button>
      </header>
      <form className="ja-tm-form" onSubmit={submitter(p)}>
        <div className="ja-tm-drb">
          <Fields {...p} />
        </div>
        <div className="ja-tm-drf">
          <EditorFoot {...p} />
        </div>
      </form>
    </aside>
  );
}

/** Below 1024px: the same fields in a bottom sheet, Save pinned under them. */
function SheetBody(p: EditorProps & { titleId: string }) {
  const { team } = p;
  return (
    <form className="ja-sh-form" onSubmit={submitter(p)}>
      <div className="jg-grab" aria-hidden="true" />
      <div className="ja-sh-top">
        <h2 id={p.titleId}>
          <span className="sr-only">Edit team · </span>
          {team.number} <span>{team.name}</span>
        </h2>
        <button type="button" className="ja-x" aria-label="Close" onClick={p.onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="ja-cf-scroll">
        <Fields {...p} />
      </div>
      <div className="ja-cf-foot ja-tm-ff">
        <EditorFoot {...p} />
      </div>
    </form>
  );
}

function Fields({ uid, team, draft, onDraft, state, onResetStatus, onRemove, onOpenFlags, onOpenSheet }: EditorProps) {
  const set = (patch: Partial<TeamDraft>) => onDraft({ ...draft, ...patch });
  const { request, bookedAt } = interviewOf(team.id, state.requests);
  const pills = flagPills(team.id, state.flags, state.flagKinds);
  const options = panelOptions(team, state.panels, state.conflicts, state.judges, draft.division);
  // A panel the new division cannot use is no longer in the list: the select reads "— none —", which is what Save will do (after asking).
  const panelShown = options.some((o) => o.id === draft.panelId) ? draft.panelId : "";
  const divisions = state.divisions.includes(draft.division) ? state.divisions : [...state.divisions, draft.division];

  return (
    <>
      <div className="ja-tm-g2">
        <div className="ja-fl">
          <label className="ja-lab" htmlFor={`${uid}-num`}>
            Team number
          </label>
          <input id={`${uid}-num`} className="ja-in" type="text" autoComplete="off" spellCheck={false} value={draft.number} onChange={(e) => set({ number: e.target.value })} />
        </div>
        <div className="ja-fl">
          <label className="ja-lab" htmlFor={`${uid}-pit`}>
            Pit
          </label>
          <input id={`${uid}-pit`} className="ja-in" type="text" autoComplete="off" spellCheck={false} value={draft.pit} onChange={(e) => set({ pit: e.target.value })} />
        </div>
      </div>
      <div className="ja-fl">
        <label className="ja-lab" htmlFor={`${uid}-name`}>
          Name
        </label>
        <input id={`${uid}-name`} className="ja-in" type="text" autoComplete="off" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        <p className="ja-hint">Pits read as a letter and a number (A1), which places a team on the board&apos;s floor plan.</p>
      </div>

      <div className="ja-tm-ro">
        <div className="ja-fl">
          <label className="ja-lab" htmlFor={`${uid}-division`}>
            Division
          </label>
          <div className="ja-selw">
            <select id={`${uid}-division`} className="ja-in ja-sel" value={draft.division} onChange={(e) => set({ division: e.target.value })}>
              {divisions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <ChevronDown />
          </div>
        </div>
        <div className="ja-fl">
          <span className="ja-lab">Booked</span>
          <span className={bookedAt ? "ja-tm-bk" : "ja-tm-bk ja-tm-none"}>{formatClock(bookedAt)}</span>
        </div>
      </div>

      <div className="ja-fl">
        <label className="ja-lab" htmlFor={`${uid}-category`}>
          Notebook
        </label>
        <div className="ja-selw">
          <select id={`${uid}-category`} className="ja-in ja-sel" value={draft.category} onChange={(e) => set({ category: e.target.value })}>
            {state.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <ChevronDown />
        </div>
      </div>

      <div className="ja-fl">
        <label className="ja-lab" htmlFor={`${uid}-pn`}>
          Judge panel
        </label>
        <div className="ja-selw">
          {/* Only panels that may judge this team: its own side of the division wall and no conflict (the Floor's list), plus the one it holds. */}
          <select id={`${uid}-pn`} className="ja-in ja-sel" value={panelShown} onChange={(e) => set({ panelId: e.target.value })}>
            <option value="">— none —</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.blocked ? " — conflicted" : ""}
              </option>
            ))}
          </select>
          <ChevronDown />
        </div>
        <p className="ja-hint">{divisionTag(draft.division)} panels without a conflict</p>
      </div>

      <div className="ja-fl">
        <h3 className="ja-lab">Interview</h3>
        {request ? (
          <>
            <div className="ja-tm-iv">
              <StatusPill status={request.status} short />
              <div className="ja-selw">
                <label className="sr-only" htmlFor={`${uid}-rs`}>
                  Reset interview status to
                </label>
                {/* Not part of Save: choosing a status asks, then applies at once. */}
                <select
                  id={`${uid}-rs`}
                  className="ja-in ja-sel"
                  value=""
                  title="Judge Advisor override — corrects a mistake, not the normal flow"
                  onChange={(e) => {
                    const status = e.target.value as Status;
                    if (status) onResetStatus(request, status);
                  }}
                >
                  <option value="">Reset to…</option>
                  {RESETTABLE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_META[s].label}
                    </option>
                  ))}
                </select>
                <ChevronDown />
              </div>
            </div>
            <div className="jg-caution" role="note">
              <WarnIcon />
              <p>Overrides what judges set. Use when a status is stuck.</p>
            </div>
          </>
        ) : (
          <p className="ja-hint">No interview requested yet.</p>
        )}
      </div>

      <div className="ja-fl">
        <h3 className="ja-lab">Flags</h3>
        {pills.length ? (
          <div className="ja-tm-flr">
            {pills.map(({ kind, count }) => (
              <Pill key={kind.id} kind={kind} id={kind.id}>
                {kind.short} ×{count}
              </Pill>
            ))}
            <button type="button" className="ja-tm-od" onClick={onOpenFlags}>
              Open in Referee
              <OutIcon />
            </button>
          </div>
        ) : (
          <p className="ja-hint">No flags recorded.</p>
        )}
        {/* The judge console's team sheet: the flags in full, the notes, and the scores. */}
        <button type="button" className="ja-tm-od ja-tm-ts" onClick={onOpenSheet}>
          Open team sheet
        </button>
      </div>

      <div className="ja-fl ja-tm-rm">
        <button type="button" className="ja-tm-rmb" onClick={onRemove}>
          <TrashIcon />
          Remove team
        </button>
        <p className="ja-hint">Asks first. Removes {team.number} and all its requests.</p>
      </div>
    </>
  );
}
