"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AllRulesPicker } from "@/components/AllRulesPicker";
import { useConfirm } from "@/components/ConfirmDialog";
import { kindCounts, kindOf, type FlagKind } from "@/components/Flags";
import { ChevronDown, ChevronRight, CloseIcon, WarnIcon } from "@/components/judge/parts";
import { MatchFields } from "@/components/MatchFields";
import { SeverityButtons } from "@/components/referee/SeverityButtons";
import { call } from "@/components/useAppState";
import { formatClock } from "@/components/ui";
import { MAX_FIELD_COUNT, type FlagReport } from "@/lib/flagValidation";
import { fieldLabel, matchReference } from "@/lib/match";
import { getRuleset, MAX_FLAG_RULES, parseRuleList, ruleDisplayLabel, toggleRule } from "@/lib/rules";
import type { AppState, FlagRow, PublicPanel, Team } from "@/lib/types";
import {
  canAffectMatch,
  correctionBlocker,
  dotClass,
  flagLabel,
  flaggedTeams,
  goBack,
  historyOf,
  otherDay,
  phoneView,
  pickTeam,
  pillClass,
  removeAfterAsking,
  repeatedRules,
  repeatingOn,
  ruleChipIds,
  saveCorrection,
  selectedTeamId,
  severityTotals,
  startCorrection,
  startNav,
  teamTags,
  type Correction,
  type FlaggedTeam,
  type RefereeNav,
} from "./refereeLogic";

const CAPTION =
  "Recorded by referees on their own page. Judges see these against the teams they are judging; teams and the queue desk do not.";

function Glyph({ size = 16, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const FlagIcon = () => (
  <Glyph size={13}>
    <path d="M5 21V4M5 4h12l-2.5 4L17 12H5" />
  </Glyph>
);
const BackIcon = () => (
  <Glyph size={18}>
    <path d="M15 6l-6 6 6 6" />
  </Glyph>
);

/** A severity pill, filled in the kind's colour. A kind the config no longer has is shown plainly. The Teams tab wears the same pill. */
export function Pill({ kind, id, children }: { kind: FlagKind | null; id: string; children?: React.ReactNode }) {
  return (
    <span className={`ja-sp ${pillClass(kind?.color ?? "zinc")}`} title={kind?.label}>
      {children ?? kind?.short ?? id}
    </span>
  );
}

/**
 * The Referee section: what referees have recorded, team by team. Recorded by
 * the referees on their own page; the Judge Advisor sees the whole picture,
 * corrects a flag that was raised wrong and strikes one raised in error.
 *
 * Remove asks first. A correction goes through the same PATCH the inline form
 * always used, from a sheet where the severity buttons only select and
 * "Save correction" saves.
 */
export function RefereeTab({
  state,
  refresh,
  onError,
  focusTeamId = null,
  adminName,
}: {
  state: AppState;
  refresh: () => Promise<void>;
  onError: (message: string | null) => void;
  /** Set when Scores' conduct link sent you here: that team is open and stays so until you pick another. */
  focusTeamId?: string | null;
  /** Who the correction is logged under. */
  adminName?: string | null;
}) {
  const { ask, dialog } = useConfirm();
  const [nav, setNav] = useState<RefereeNav>(() => startNav(focusTeamId));
  const [editing, setEditing] = useState<FlagRow | null>(null);
  const [busy, setBusy] = useState(false);

  function remove(flag: FlagRow) {
    return removeAfterAsking(ask, async () => {
      setBusy(true);
      onError(null);
      try {
        await call(`/api/flags?id=${flag.id}`, { method: "DELETE" });
        await refresh();
      } catch (e) {
        onError((e as Error).message);
      } finally {
        setBusy(false);
      }
    });
  }

  async function save(id: string, patch: FlagReport) {
    onError(null);
    try {
      await call(`/api/flags`, { method: "PATCH", body: { id, ...patch } });
      await refresh();
    } catch (e) {
      onError((e as Error).message);
      throw e; // let the sheet show it too
    }
  }

  const kinds = useMemo(() => [...state.flagKinds].sort((a, b) => a.severity - b.severity), [state.flagKinds]);
  const editedTeam = editing ? (state.teams.find((t) => t.id === editing.team_id) ?? null) : null;

  return (
    <>
      {dialog}
      <RefereeBoard
        flags={state.flags}
        kinds={state.flagKinds}
        teams={state.teams}
        panels={state.panels}
        nav={nav}
        focusTeamId={focusTeamId}
        busy={busy}
        onPick={(id) => setNav((n) => pickTeam(n, id))}
        onBack={() => setNav(goBack)}
        onEdit={setEditing}
        onRemove={remove}
      />
      <CorrectSheet
        flag={editing}
        team={editedTeam}
        kinds={kinds}
        fieldCount={state.refereeSetup?.field_count ?? MAX_FIELD_COUNT}
        correctorName={adminName}
        onSave={save}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

/* ---- the page ------------------------------------------------------------- */

/**
 * The count strip, then the flagged teams and the history of the one picked.
 * From 1024px they sit side by side; on a phone the list and a team's history
 * are two screens (`data-view`), with a back button between them.
 */
export function RefereeBoard({
  flags,
  kinds,
  teams,
  panels,
  nav,
  focusTeamId = null,
  busy = false,
  onPick,
  onBack,
  onEdit,
  onRemove,
}: {
  flags: FlagRow[];
  kinds: FlagKind[];
  teams: Team[];
  panels: PublicPanel[];
  nav: RefereeNav;
  focusTeamId?: string | null;
  busy?: boolean;
  onPick: (id: string) => void;
  onBack: () => void;
  onEdit: (flag: FlagRow) => void;
  onRemove: (flag: FlagRow) => void;
}) {
  const headId = useId();
  const rows = useMemo(() => flaggedTeams(flags, kinds, teams), [flags, kinds, teams]);
  const totals = useMemo(() => severityTotals(flags, kinds), [flags, kinds]);
  const selectedId = selectedTeamId(rows, nav, focusTeamId);
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const view = phoneView(rows, nav);

  // Arriving from Scores: bring that team's row into view in the list.
  const focusRow = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    focusRow.current?.scrollIntoView?.({ block: "nearest" });
  }, [focusTeamId]);

  // On a phone the list and the history swap places: follow the focus across.
  const backButton = useRef<HTMLButtonElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const wasOpen = useRef(nav.open);
  useEffect(() => {
    if (nav.open !== wasOpen.current) {
      if (nav.open) backButton.current?.focus();
      else if (selectedId) rowButtons.current.get(selectedId)?.focus();
    }
    wasOpen.current = nav.open;
  }, [nav.open, selectedId]);

  return (
    <div className="ja-rf" data-view={view}>
      <div className="ja-rf-top">
        <section className="ja-cs ja-rf-cs" aria-label="Flags by severity">
          {totals.map(({ kind, count }) => (
            <div key={kind.id}>
              <b>{count}</b>
              <span>
                <i aria-hidden="true" className={`ja-rf-dot ${dotClass(kind.color)}`} />
                <em className="ja-rf-long">{kind.label}</em>
                <em className="ja-rf-short">{kind.short}</em>
              </span>
            </div>
          ))}
        </section>
        <p className="ja-rf-cap">{CAPTION}</p>
      </div>

      {!rows.length ? (
        <p className="ja-empty">No referee has flagged anything yet.</p>
      ) : (
        <div className="ja-rf-cols">
          <nav className="ja-rf-tl" aria-label="Flagged teams">
            <div className="ja-rf-jh">
              <h2>Flagged teams</h2>
              <span>{rows.length}</span>
            </div>
            <ul>
              {rows.map((row) => {
                const on = row.id === selectedId;
                const fromScores = on && row.id === focusTeamId;
                return (
                  <li key={row.id} ref={row.id === focusTeamId ? focusRow : undefined} className={fromScores ? "ja-rf-fx" : undefined}>
                    <button
                      type="button"
                      className="ja-rf-jr"
                      aria-current={on ? "true" : undefined}
                      ref={(el) => {
                        if (el) rowButtons.current.set(row.id, el);
                        else rowButtons.current.delete(row.id);
                      }}
                      onClick={() => onPick(row.id)}
                    >
                      <span className="ja-rf-c1">
                        <b>{row.team?.number ?? "—"}</b>
                        <span>{row.team?.name ?? "team removed"}</span>
                      </span>
                      {row.worst ? <Pill kind={row.worst} id={row.worst.id} /> : <span />}
                      <span className="ja-rf-ct">
                        <FlagIcon />
                        {row.flags.length}
                        <span className="sr-only"> {row.flags.length === 1 ? "flag" : "flags"}</span>
                      </span>
                      <ChevronRight />
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {selected ? (
            <section className="ja-rf-det" aria-labelledby={headId}>
              <button type="button" className="ja-rf-back" ref={backButton} onClick={onBack}>
                <BackIcon />
                Flagged teams
              </button>
              <TeamHistory
                headId={headId}
                row={selected}
                kinds={kinds}
                panels={panels}
                busy={busy}
                onEdit={onEdit}
                onRemove={onRemove}
              />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** One team: who they are, how they have been flagged, a warning when a rule repeats, and every flag, newest first. */
function TeamHistory({
  headId,
  row,
  kinds,
  panels,
  busy,
  onEdit,
  onRemove,
}: {
  headId: string;
  row: FlaggedTeam;
  kinds: FlagKind[];
  panels: PublicPanel[];
  busy: boolean;
  onEdit: (flag: FlagRow) => void;
  onRemove: (flag: FlagRow) => void;
}) {
  const { team, flags } = row;
  const repeats = repeatedRules(flags, kinds);

  return (
    <>
      <div className="ja-rf-dh">
        <h2 id={headId}>
          <b>{team?.number ?? "—"}</b>
          <span>{team?.name ?? "team removed"}</span>
        </h2>
        <div className="ja-rf-dm">
          {teamTags(team, panels).map((tag) => (
            <span key={tag} className="jg-ptag">
              {tag}
            </span>
          ))}
          <span className="ja-rf-sums">
            {kindCounts(flags, kinds).map(({ kind, count }) => (
              <Pill key={kind.id} kind={kind} id={kind.id}>
                {kind.short} ×{count}
              </Pill>
            ))}
          </span>
        </div>
      </div>

      {repeats.length ? (
        <div className="jg-caution" role="note">
          <WarnIcon />
          <div>
            {repeats.map((r) => (
              <p key={r.rule}>
                <b>Repeated.</b> {r.text}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="ja-rf-hh">
        <h3 className="ja-sec">History</h3>
        <span>newest first</span>
      </div>
      <ol className="ja-rf-tlx">
        {historyOf(flags).map((f) => (
          <FlagEntry key={f.id} flag={f} team={team} teamFlags={flags} kinds={kinds} busy={busy} onEdit={onEdit} onRemove={onRemove} />
        ))}
      </ol>
    </>
  );
}

function FlagEntry({
  flag: f,
  team,
  teamFlags,
  kinds,
  busy,
  onEdit,
  onRemove,
}: {
  flag: FlagRow;
  team: Team | null;
  teamFlags: FlagRow[];
  kinds: FlagKind[];
  busy: boolean;
  onEdit: (flag: FlagRow) => void;
  onRemove: (flag: FlagRow) => void;
}) {
  const kind = kindOf(f.kind, kinds);
  const ruleset = getRuleset(f.ruleset);
  const repeating = repeatingOn(f, teamFlags);
  const match = matchReference(f.match_type, f.match_number);
  const field = fieldLabel(f.field);
  const day = otherDay(f.created_at);
  const label = flagLabel(f, team, kinds);

  return (
    <li className="ja-rf-tle">
      <span className="ja-rf-tt">
        {formatClock(f.created_at)}
        {day ? <small>{day}</small> : null}
      </span>
      <span className="ja-rf-tr">
        <i aria-hidden="true" className={`ja-rf-mk ${dotClass(kind?.color ?? "zinc")}`} />
      </span>
      <div className="ja-rf-bx">
        <div className="ja-rf-b1">
          <Pill kind={kind} id={f.kind} />
          {match ? (
            <span className="ja-rf-mf">
              <b>{match}</b>
              {field ? <span> · {field}</span> : null}
            </span>
          ) : null}
          {parseRuleList(f.rule).map((id) => (
            <span key={id} className="ja-rf-rc">
              <span className="ja-rf-ru" title={ruleDisplayLabel(id, ruleset.id) ?? id}>
                {id}
              </span>
              {repeating.includes(id) ? (
                <span className="ja-pill">
                  <WarnIcon />
                  Repeated
                </span>
              ) : null}
            </span>
          ))}
          {f.match_affecting ? <span className="jg-ptag ja-rf-ma">Match affecting</span> : null}
        </div>
        {f.body ? <p className="ja-rf-bn">“{f.body}”</p> : null}
        <div className="ja-rf-b3">
          <span className="ja-rf-fwho">{f.author}</span>
          <span className="ja-rf-fact">
            <button type="button" className="jg-quiet ja-rf-q" aria-haspopup="dialog" aria-label={`Edit flag: ${label}`} disabled={busy} onClick={() => onEdit(f)}>
              Edit
            </button>
            <button type="button" className="jg-quiet ja-rf-q" aria-haspopup="dialog" aria-label={`Remove flag: ${label}`} disabled={busy} onClick={() => onRemove(f)}>
              Remove
            </button>
          </span>
        </div>
      </div>
    </li>
  );
}

/* ---- Correct flag --------------------------------------------------------- */

/**
 * "Correct flag · 9882K": a native <dialog> opened with showModal() -- a bottom
 * sheet on a phone, a centred dialog from 1024px. Everything is a draft until
 * "Save correction", which is pinned under the scrolling fields.
 */
export function CorrectSheet({
  flag,
  team,
  kinds,
  fieldCount,
  correctorName,
  onSave,
  onClose,
}: {
  /** The flag being corrected; null while the sheet is shut. */
  flag: FlagRow | null;
  team: Team | null;
  /** Least to most serious. */
  kinds: FlagKind[];
  fieldCount: number;
  correctorName?: string | null;
  onSave: (id: string, patch: FlagReport) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const open = flag !== null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="ja-sheet ja-rfs"
      aria-modal="true"
      aria-labelledby={titleId}
      // Escape closes the dialog by itself; tell the tab. A close it asked for (open already false) is not news.
      onClose={() => {
        if (open) onClose();
      }}
      // A click whose target is the dialog itself landed on the backdrop.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {flag ? (
        <CorrectBody
          key={flag.id}
          titleId={titleId}
          flag={flag}
          team={team}
          kinds={kinds}
          fieldCount={fieldCount}
          correctorName={correctorName}
          onSave={onSave}
          onClose={onClose}
        />
      ) : null}
    </dialog>
  );
}

function CorrectBody({
  titleId,
  flag,
  team,
  kinds,
  fieldCount,
  correctorName,
  onSave,
  onClose,
}: {
  titleId: string;
  flag: FlagRow;
  team: Team | null;
  kinds: FlagKind[];
  fieldCount: number;
  correctorName?: string | null;
  onSave: (id: string, patch: FlagReport) => Promise<void>;
  onClose: () => void;
}) {
  const uid = useId();
  // A flag keeps the ruleset it was recorded under: a correction cannot move it.
  const ruleset = getRuleset(flag.ruleset);
  const [draft, setDraft] = useState<Correction>(() => startCorrection(flag));
  const [rulesOpen, setRulesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Correction>) => setDraft((d) => ({ ...d, ...patch }));

  const blocker = correctionBlocker({ flag, draft, kinds, fieldCount });
  const atCap = draft.rules.length >= MAX_FLAG_RULES;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Defence in depth: the button is already disabled for this, but the request must not depend on it.
    if (busy || blocker) return;
    setBusy(true);
    setError(null);
    try {
      await saveCorrection({ flag, draft, kinds, fieldCount, onSave });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="ja-sh-form" onSubmit={submit}>
        <div className="jg-grab" aria-hidden="true" />
        <div className="ja-sh-top">
          <h2 id={titleId}>Correct flag · {team?.number ?? "team removed"}</h2>
          <button type="button" className="ja-x" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="ja-cf-scroll">
          {error ? (
            <p className="ja-err" role="alert">
              {error}
            </p>
          ) : null}
          {/* One native switch for every field while a save is in flight. */}
          <fieldset disabled={busy} className="ja-rf-fs">
            <MatchFields
              rulesetId={ruleset.id}
              fieldCount={fieldCount}
              value={draft.match}
              onChange={(match) => set({ match })}
              idPrefix={`${uid}-m`}
              legacy={{ matchType: flag.match_type, field: flag.field }}
            />

            <div>
              <div className="ja-lab ja-rf-lab" id={`${uid}-rules`}>
                <span>Rules broken</span>
                {atCap ? <span className="ja-op">{`Limit of ${MAX_FLAG_RULES} reached`}</span> : null}
              </div>
              <div className="ja-rf-chips" role="group" aria-labelledby={`${uid}-rules`}>
                {ruleChipIds(ruleset.id, draft.rules).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="ja-rf-chip"
                    aria-pressed={draft.rules.includes(id)}
                    disabled={atCap && !draft.rules.includes(id)}
                    title={ruleDisplayLabel(id, ruleset.id) ?? id}
                    onClick={() => set({ rules: toggleRule(draft.rules, id) })}
                  >
                    {id}
                  </button>
                ))}
              </div>
              <button type="button" className="ja-rf-dd" aria-haspopup="dialog" onClick={() => setRulesOpen(true)}>
                <span className="ja-rf-dl">
                  All rules <em>{`· ${ruleset.rules.length} in ${ruleset.label}`}</em>
                </span>
                {draft.rules.length ? <span className="ja-rf-cnt">{`${draft.rules.length} selected`}</span> : null}
                <ChevronDown />
              </button>
            </div>

            {/* Counts only for Minor and Major (the server stores false for anything else); shown once a rule is picked, as on the referee's page. */}
            {draft.rules.length || canAffectMatch(draft.kind) ? (
              <label className="ja-rf-row">
                <span>
                  Match affecting<small>Minor and Major only</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="ja-rf-sw"
                  checked={draft.matchAffecting}
                  onChange={(e) => set({ matchAffecting: e.target.checked })}
                />
              </label>
            ) : null}

            <div>
              <label className="ja-lab ja-rf-lab" htmlFor={`${uid}-note`}>
                <span>Note</span>
                <span className="ja-op">Optional</span>
              </label>
              <textarea
                id={`${uid}-note`}
                className="ja-rf-area"
                rows={2}
                maxLength={500}
                value={draft.body}
                onChange={(e) => set({ body: e.target.value })}
              />
            </div>

            {/* Tapping a severity only selects it; "Save correction" is what saves. */}
            <SeverityButtons compact kinds={kinds} value={draft.kind} onChange={(kind) => set({ kind })} />
          </fieldset>
        </div>

        <div className="ja-cf-foot ja-rf-foot">
          {blocker ? (
            <p className="ja-rf-need" id={`${uid}-need`} role="status">
              {blocker}
            </p>
          ) : null}
          <button type="submit" className="ja-prim" disabled={busy || Boolean(blocker)} aria-describedby={blocker ? `${uid}-need` : undefined}>
            {busy ? "Saving…" : "Save correction"}
          </button>
          <p className="ja-rf-log">Logged as a correction by {correctorName ?? "the Judge Advisor"}</p>
        </div>
      </form>

      {/* Outside the form: its search box must not submit the correction on Enter. */}
      <AllRulesPicker
        open={rulesOpen}
        rulesetId={ruleset.id}
        value={draft.rules}
        onChange={(rules) => set({ rules })}
        onClose={() => setRulesOpen(false)}
      />
    </>
  );
}
