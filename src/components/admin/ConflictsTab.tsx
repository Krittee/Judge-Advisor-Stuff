"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import { CheckIcon, ChevronDown, CloseIcon, WarnIcon } from "@/components/judge/parts";
import { call } from "@/components/useAppState";
import { panelBlocks } from "@/lib/roster";
import type { AppState } from "@/lib/types";
import {
  canRecord,
  conflictGroups,
  judgeOptionGroups,
  judgeStatus,
  panelTag,
  recordConflicts,
  resultLines,
  strandedTeams,
  withdrawAfterAsking,
  withdrawQuestion,
  type ConflictLine,
  type RecordInput,
  type RecordResult,
} from "./conflictsLogic";
import { divisionTag } from "./floorLogic";

/* Small glyphs from the Conflicts mocks. The judge console's own (check, warn, close, chevron) are reused. */
function Glyph({ size = 16, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const BlockIcon = () => (
  <Glyph size={14}>
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6l12.8 12.8" />
  </Glyph>
);
const MinusIcon = () => (
  <Glyph>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12h8" />
  </Glyph>
);
const AlertIcon = ({ size = 16 }: { size?: number }) => (
  <Glyph size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.2v.01" />
  </Glyph>
);

const RESULT_ICON = {
  ok: <CheckIcon />,
  warn: <WarnIcon />,
  mute: <MinusIcon />,
  bad: <AlertIcon />,
} as const;

/** The record form's state, shared by the pinned panel (wide) and the bottom sheet (phone), which show one form at a time. */
function useRecorder(judges: AppState["judges"], refresh: () => Promise<void>, startOn = "") {
  const [picked, setPicked] = useState(startOn);
  const [name, setName] = useState("");
  const [judgeNote, setJudgeNote] = useState("");
  const [teamNumbers, setTeamNumbers] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecordResult | null>(null);

  // With nobody on the roster yet the only thing to do is add the first judge.
  const choice = picked === "new" || judges.some((j) => j.id === picked) ? picked : judges.length ? "" : "new";
  const input: RecordInput = { judge: choice, name, judgeNote, teamNumbers, note };

  async function submit() {
    if (busy || !canRecord(input)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await recordConflicts(call, input, async (judge) => {
        // The judge exists now: stay on them, so a failed recording is retried, not re-created.
        setPicked(judge.id);
        setName("");
        setJudgeNote("");
        await refresh();
      });
      setResult(res);
      setTeamNumbers("");
      setNote("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return {
    choice, setPicked, name, setName, judgeNote, setJudgeNote, teamNumbers, setTeamNumbers, note, setNote,
    busy, error, result, ok: canRecord(input), submit,
  };
}
type Recorder = ReturnType<typeof useRecorder>;

/**
 * The Conflicts section: who is affiliated with which teams, collected judge
 * by judge before panels are formed. The list is grouped by judge; the form
 * to record more is pinned to the right from 1024px and is a bottom sheet
 * behind a pinned button on a phone. Which panel a conflict blocks is never
 * worked out here -- it comes from `panelBlocks`, so a judge who moves takes
 * their blocks with them.
 */
export function ConflictsTab({
  state,
  refresh,
  onError,
  focusJudgeId = null,
}: {
  state: AppState;
  refresh: () => Promise<void>;
  onError: (message: string | null) => void;
  /** The judge the Panels tab's "N conflicts" pill sent you for: their group is marked and the record form starts on them. */
  focusJudgeId?: string | null;
}) {
  const { ask, dialog } = useConfirm();
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const sheetDialog = useRef<HTMLDialogElement>(null);
  const sheetTitle = useId();
  const asideId = useId();
  const sheetId = useId();
  const rec = useRecorder(state.judges, refresh, focusJudgeId ?? "");

  const blocks = useMemo(() => panelBlocks(state.conflicts, state.judges), [state.conflicts, state.judges]);
  const { byJudge, legacy } = useMemo(
    () => conflictGroups(state.conflicts, state.judges, state.panels, state.teams, blocks),
    [state.conflicts, state.judges, state.panels, state.teams, blocks],
  );
  const stranded = useMemo(() => strandedTeams(state.teams, state.panels, blocks), [state.teams, state.panels, blocks]);

  // Arriving from Panels: bring that judge's group into view and put the keyboard on it. The frame scrolls a new section to its top in
  // an effect of its own that runs after this one, so the scroll waits a frame.
  const focusGroup = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = focusGroup.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => el.scrollIntoView?.({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [focusJudgeId]);

  // A native <dialog> opened with showModal(), as the judge's team sheet is.
  useEffect(() => {
    const el = sheetDialog.current;
    if (!el) return;
    if (sheet && !el.open) el.showModal();
    else if (!sheet && el.open) el.close();
  }, [sheet]);

  // A phone turned past the rail's breakpoint: the pinned form is on screen again, so the sheet has no business open.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const close = (e: MediaQueryListEvent) => {
      if (e.matches) setSheet(false);
    };
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);

  function withdraw(id: string, question: string) {
    return withdrawAfterAsking(ask, question, async () => {
      setWithdrawing(id);
      onError(null);
      try {
        await call(`/api/conflicts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        await refresh();
      } catch (e) {
        onError((e as Error).message);
      } finally {
        setWithdrawing(null);
      }
    });
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    return rec.submit();
  };

  return (
    <div className="ja-cf">
      {dialog}
      <div className="ja-cf-main">
        {stranded.length ? (
          <section className="ja-str" role="alert" aria-labelledby={`${asideId}-st`}>
            <AlertIcon size={20} />
            <div>
              <h2 id={`${asideId}-st`}>
                {stranded.length === 1 ? "One team has" : `${stranded.length} teams have`} no panel left to judge them
              </h2>
              <p>
                Every panel in {stranded.length === 1 ? "its" : "their"} division is conflicted, so auto-assign skips{" "}
                {stranded.length === 1 ? "it" : "them"}. Move a panel into the division, or withdraw a conflict.
              </p>
            </div>
            <p className="ja-str-t">
              {stranded.map((t, i) => (
                <Fragment key={t.id}>
                  {i ? " · " : null}
                  <b>{t.number}</b> ({divisionTag(t.division)})
                </Fragment>
              ))}
            </p>
          </section>
        ) : null}

        {byJudge.length || legacy.length ? (
          <section aria-labelledby={`${asideId}-ls`}>
            <h2 className="sr-only" id={`${asideId}-ls`}>
              Conflicts by judge
            </h2>
            <div className="ja-gl">
              {byJudge.map(({ judge, panel, rows }) => (
                <section
                  key={judge.id}
                  ref={judge.id === focusJudgeId ? focusGroup : undefined}
                  className={judge.id === focusJudgeId ? "ja-grp ja-fx" : "ja-grp"}
                  tabIndex={judge.id === focusJudgeId ? -1 : undefined}
                  aria-labelledby={`g-${judge.id}`}
                >
                  <header className="ja-gh">
                    <h3 id={`g-${judge.id}`}>{judge.name}</h3>
                    {panel ? <span className="jg-ptag">{panelTag(panel)}</span> : null}
                    <span className="ja-blk">
                      {panel ? (
                        <>
                          <BlockIcon />
                          Blocks {panel.name}
                        </>
                      ) : (
                        "Not on a panel yet"
                      )}
                    </span>
                    <span className="ja-gn">
                      {rows.length} {rows.length === 1 ? "conflict" : "conflicts"}
                    </span>
                  </header>
                  <ul>
                    {rows.map((line) => (
                      <Row
                        key={line.conflict.id}
                        line={line}
                        label={`Withdraw conflict: ${line.team?.number ?? "team removed"}, ${judge.name}`}
                        disabled={withdrawing !== null}
                        onWithdraw={() =>
                          withdraw(line.conflict.id, withdrawQuestion({ ...line, judge, panel }, state.conflicts, state.judges))
                        }
                      />
                    ))}
                  </ul>
                </section>
              ))}

              {legacy.length ? (
                <section className="ja-grp" aria-labelledby={`${asideId}-old`}>
                  <header className="ja-gh ja-old">
                    <h3 id={`${asideId}-old`}>Whole panel (older entries)</h3>
                    <span className="ja-gn">
                      {legacy.length} {legacy.length === 1 ? "entry" : "entries"}
                    </span>
                    <p className="ja-sub">Apply to every judge on the panel, not one judge.</p>
                  </header>
                  <ul>
                    {legacy.map(({ panel, ...line }) => (
                      <Row
                        key={line.conflict.id}
                        line={line}
                        tag={panel ? panelTag(panel) : "No panel"}
                        label={`Withdraw conflict: ${line.team?.number ?? "team removed"}, whole ${panel?.name ?? "panel"}`}
                        disabled={withdrawing !== null}
                        onWithdraw={() =>
                          withdraw(line.conflict.id, withdrawQuestion({ ...line, judge: null, panel }, state.conflicts, state.judges))
                        }
                      />
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </section>
        ) : (
          <p className="ja-empty">
            No conflicts yet. Ask each judge which teams they&apos;re affiliated with, and record the answers.
          </p>
        )}
      </div>

      {/* From 1024px the form is pinned to the right. */}
      <aside className="ja-aside" aria-labelledby={`${asideId}-h`}>
        <form className="ja-fc" onSubmit={submit}>
          <h2 id={`${asideId}-h`}>Record conflicts</h2>
          <Fields uid={asideId} rec={rec} state={state} rows={3} />
          <button type="submit" className="ja-prim" disabled={rec.busy || !rec.ok}>
            {rec.busy ? "Recording…" : "Record conflicts"}
          </button>
          <RecordingResult result={rec.result} panels={state.panels} />
        </form>
      </aside>

      {/* On a phone a button pinned to the bottom opens it as a sheet. */}
      <div className="ja-pin">
        <button type="button" className="ja-prim" aria-haspopup="dialog" onClick={() => setSheet(true)}>
          Record conflicts
        </button>
      </div>

      <dialog
        ref={sheetDialog}
        className="ja-sheet ja-cfs"
        aria-modal="true"
        aria-labelledby={sheetTitle}
        // Escape closes the dialog by itself; tell the tab. A close it asked for (sheet already false) is not news.
        onClose={() => {
          if (sheet) setSheet(false);
        }}
        // A click whose target is the dialog itself landed on the backdrop.
        onClick={(e) => {
          if (e.target === e.currentTarget) setSheet(false);
        }}
      >
        {sheet ? (
          <form className="ja-sh-form" onSubmit={submit}>
            <div className="jg-grab" aria-hidden="true" />
            <div className="ja-sh-top">
              <h2 id={sheetTitle}>Record conflicts</h2>
              <button type="button" className="ja-x" aria-label="Close" onClick={() => setSheet(false)}>
                <CloseIcon />
              </button>
            </div>
            <div className="ja-cf-scroll">
              <Fields uid={sheetId} rec={rec} state={state} rows={2} />
              <RecordingResult result={rec.result} panels={state.panels} />
            </div>
            <div className="ja-cf-foot">
              <button type="submit" className="ja-prim" disabled={rec.busy || !rec.ok}>
                {rec.busy ? "Recording…" : "Record conflicts"}
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}

/** One conflict: team number and name, the note in quotes, "needs a panel", and Withdraw (which asks first). */
function Row({
  line,
  tag,
  label,
  disabled,
  onWithdraw,
}: {
  line: ConflictLine;
  /** The panel tag of an older whole-panel entry, in the note's place. */
  tag?: string;
  label: string;
  disabled: boolean;
  onWithdraw: () => void;
}) {
  const { conflict, team } = line;
  return (
    <li className="ja-cr">
      <div className="ja-cm">
        <p className="ja-c1">
          <b>{team?.number ?? "—"}</b>
          <span className="ja-tn">{team?.name ?? "team removed"}</span>
        </p>
        {conflict.note || tag || (team && !team.panel_id) ? (
          <p className="ja-c2">
            {conflict.note ? <span className="ja-nt">“{conflict.note}”</span> : null}
            {tag ? <span className="jg-ptag ja-nt">{tag}</span> : null}
            {team && !team.panel_id ? (
              <span className="ja-pill ja-fg">
                <WarnIcon />
                needs a panel
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      <button type="button" className="ja-wd" aria-haspopup="dialog" aria-label={label} disabled={disabled} onClick={onWithdraw}>
        Withdraw
      </button>
    </li>
  );
}

/** Judge (grouped by panel, or a new one), team numbers and the optional note. */
function Fields({ uid, rec, state, rows }: { uid: string; rec: Recorder; state: AppState; rows: number }) {
  const groups = useMemo(() => judgeOptionGroups(state.judges, state.panels), [state.judges, state.panels]);
  const status = judgeStatus(rec.choice, state.judges, state.panels);

  return (
    <>
      {rec.error ? (
        <p className="ja-err" role="alert">
          {rec.error}
        </p>
      ) : null}

      <div className="ja-fl">
        <label className="ja-lab" htmlFor={`${uid}-judge`}>
          Judge
        </label>
        <div className="ja-selw">
          <select id={`${uid}-judge`} className="ja-in ja-sel" value={rec.choice} onChange={(e) => rec.setPicked(e.target.value)}>
            {rec.choice === "" ? (
              <option value="" disabled>
                Choose a judge…
              </option>
            ) : null}
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.judges.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value="new">+ New judge…</option>
          </select>
          <ChevronDown />
        </div>
        {status ? (
          <span className="ja-blk">
            {status.blocks ? <BlockIcon /> : null}
            {status.text}
          </span>
        ) : null}
      </div>

      {rec.choice === "new" ? (
        <>
          <div className="ja-fl">
            <label className="ja-lab" htmlFor={`${uid}-name`}>
              Judge&apos;s name
            </label>
            <input
              id={`${uid}-name`}
              className="ja-in"
              type="text"
              maxLength={80}
              autoComplete="off"
              placeholder="e.g. Priya Nair"
              value={rec.name}
              onChange={(e) => rec.setName(e.target.value)}
            />
          </div>
          <div className="ja-fl">
            <label className="ja-lab" htmlFor={`${uid}-jnote`}>
              About them <span className="ja-op">(optional)</span>
            </label>
            <input
              id={`${uid}-jnote`}
              className="ja-in"
              type="text"
              maxLength={280}
              autoComplete="off"
              placeholder="e.g. volunteer from the robotics club"
              value={rec.judgeNote}
              onChange={(e) => rec.setJudgeNote(e.target.value)}
            />
          </div>
        </>
      ) : null}

      <div className="ja-fl">
        <label className="ja-lab" htmlFor={`${uid}-nums`}>
          Team numbers
        </label>
        <textarea
          id={`${uid}-nums`}
          className="ja-in ja-ta"
          rows={rows}
          placeholder="1234, 5678, 9882K"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${uid}-nums-h`}
          value={rec.teamNumbers}
          onChange={(e) => rec.setTeamNumbers(e.target.value.toUpperCase())}
        />
        <p className="ja-hint" id={`${uid}-nums-h`}>
          commas, spaces or one per line
        </p>
      </div>

      <div className="ja-fl">
        <label className="ja-lab" htmlFor={`${uid}-note`}>
          Note <span className="ja-op">(optional)</span>
        </label>
        <input
          id={`${uid}-note`}
          className="ja-in"
          type="text"
          maxLength={280}
          autoComplete="off"
          placeholder="e.g. coaches this team, parent of a member"
          aria-describedby={`${uid}-note-h`}
          value={rec.note}
          onChange={(e) => rec.setNote(e.target.value)}
        />
        <p className="ja-hint" id={`${uid}-note-h`}>
          Only when you enter one team
        </p>
      </div>
    </>
  );
}

/** "Last recording": every number reported under one heading. Announced politely when it appears. */
export function RecordingResult({ result, panels }: { result: RecordResult | null; panels: AppState["panels"] }) {
  const id = useId();
  const lines = result ? resultLines(result, panels) : [];
  return (
    <div role="status">
      {lines.length ? (
        <section className="ja-res" aria-labelledby={id}>
          <h3 className="ja-sec" id={id}>
            Last recording
          </h3>
          <ul>
            {lines.map((l) => (
              <li key={l.kind} className={`ja-r-${l.kind}`}>
                {RESULT_ICON[l.kind]}
                <span>
                  {l.lead}
                  {l.numbers.map((n, i) => (
                    <Fragment key={n}>
                      {i ? ", " : null}
                      <b>{n}</b>
                    </Fragment>
                  ))}
                  {l.tail}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
