"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { Banner, formatClock } from "@/components/ui";
import { useRubricScoring } from "@/components/useRubricScoring";
import { useTeamRecord } from "@/components/useTeamRecord";
import type { Rubric } from "@/lib/rubrics";
import type { AppState, FlagRow, RequestRow, ScoreRow, Team } from "@/lib/types";
import { BandPill, CheckIcon, CloseIcon, WarnIcon } from "./parts";
import { flagDetail, rubricShort, sectionMax, type Ask } from "./logic";

/**
 * The team sheet: everything a judge records about one team, in a bottom
 * sheet. Private notes, the referee flags on the team, and one segment per
 * rubric. Judges and the Judge Advisor only -- the endpoints behind every
 * segment refuse anyone else, and refuse a judge looking at a team outside
 * their own panel.
 *
 * A native <dialog> opened with showModal(), as the referee's match sheet is:
 * the focus trap, Escape, `aria-modal` semantics and the inert page behind it
 * come with it. The body only exists while a team is open, so each opening
 * loads that team fresh.
 */
export function TeamSheet({
  team,
  onClose,
  ...rest
}: {
  /** The team to show; null keeps the sheet closed. */
  team: Team | null;
  onClose: () => void;
} & Omit<BodyProps, "team">) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const open = team !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="jg-sheet"
      aria-modal="true"
      aria-labelledby={titleId}
      // Escape closes the dialog by itself; tell the page. A close the page
      // asked for (no team any more) is not news.
      onClose={() => {
        if (open) onClose();
      }}
      // A click whose target is the dialog itself landed on the backdrop.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {team ? <Body key={team.id} team={team} titleId={titleId} onClose={onClose} {...rest} /> : null}
    </dialog>
  );
}

type BodyProps = {
  team: Team;
  /** The team's live request: notes are filed against it. */
  request: RequestRow | null;
  categories: AppState["categories"];
  languages: AppState["languages"];
  flags: FlagRow[];
  flagKinds: AppState["flagKinds"];
  ask: Ask;
};

function Body({
  team,
  request,
  categories,
  languages,
  flags,
  flagKinds,
  ask,
  titleId,
  onClose,
}: BodyProps & { titleId: string; onClose: () => void }) {
  // null until a segment is picked: the sheet opens on the interview while
  // one is under way, on the notes otherwise.
  const [picked, setPicked] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // The notes, scores and totals are loaded and saved by the hook NotesDrawer shares.
  const {
    notes,
    draft,
    setDraft,
    busy,
    error,
    rubrics,
    scores,
    setScores,
    saveNote,
    total,
    max,
    scored,
    excludedLabel,
    categoryLabel,
  } = useTeamRecord(team, request?.id ?? null, categories);

  async function saveAndShow() {
    // Newest first: take the judge to the note just saved.
    if (await saveNote()) scroller.current?.scrollTo({ top: 0 });
  }

  const tab =
    picked ??
    (request?.status === "interviewing" ? rubrics.find((r) => r.id === "interview")?.id : undefined) ??
    "notes";
  const rubric = rubrics.find((r) => r.id === tab) ?? null;

  const mine = flags
    .filter((f) => f.team_id === team.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const newestFirst = [...notes].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const language = languages.find((l) => l.id === request?.language)?.short;
  const sub = [categoryLabel, language, team.pit ? `Pit ${team.pit}` : null].filter(Boolean).join(" · ");

  return (
    <>
      <div className="jg-grab" aria-hidden="true" />
      <div className="jg-sh-top">
        <div className="jg-sh-h">
          <div className="jg-sh-id">
            <h2 id={titleId}>{team.number}</h2>
            <p className="jg-nm">{team.name}</p>
            {sub ? <p className="jg-sub">{sub}</p> : null}
          </div>
          {max > 0 ? (
            <div className="jg-sh-tot">
              <b>
                {total} <small>/ {max}</small>
              </b>
              {scored ? <BandPill total={total} max={max} scored /> : <span className="jg-ns">not scored</span>}
            </div>
          ) : null}
          <button type="button" className="jg-x" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <p className="jg-priv">Private to judges and the Judge Advisor.</p>
        {/* Say why the denominator is smaller, rather than leaving a judge to
            wonder whether scores went missing. */}
        {excludedLabel ? (
          <p className="jg-priv jg-excl">
            {excludedLabel} is not counted for this team — {categoryLabel ?? "excluded"}.
          </p>
        ) : null}

        <div className="jg-seg" role="group" aria-label="Team sheet sections">
          <button type="button" aria-pressed={tab === "notes"} onClick={() => setPicked("notes")}>
            <span>Notes</span>
            <small>{notes.length === 1 ? "1 note" : notes.length ? `${notes.length} notes` : "no notes"}</small>
          </button>
          {rubrics.map((r) => {
            const s = scores.find((x) => x.rubric_id === r.id);
            return (
              <button key={r.id} type="button" aria-pressed={tab === r.id} onClick={() => setPicked(r.id)}>
                <span>{rubricShort(r)}</span>
                <small>{s && Object.keys(s.values ?? {}).length ? `${s.total}/${r.max}` : "not scored"}</small>
              </button>
            );
          })}
        </div>
      </div>

      {rubric ? (
        <RubricSegment
          key={rubric.id}
          rubric={rubric}
          team={team}
          score={scores.find((s) => s.rubric_id === rubric.id) ?? null}
          ask={ask}
          onSaved={(saved) =>
            setScores((prev) => [...prev.filter((s) => s.rubric_id !== saved.rubric_id), saved])
          }
          onCleared={(rubricId) => setScores((prev) => prev.filter((s) => s.rubric_id !== rubricId))}
        />
      ) : (
        <>
          <div className="jg-sh-scroll" ref={scroller}>
            {error ? <Banner kind="error">{error}</Banner> : null}
            {mine.map((f) => {
              const kind = flagKinds.find((k) => k.id === f.kind);
              const detail = flagDetail(f);
              return (
                <div key={f.id} className="jg-caution" role="note">
                  <WarnIcon />
                  <div>
                    <p>
                      <b>{kind?.label ?? f.kind}</b>
                      {detail ? ` · ${detail}` : ""} — reported by {f.author}
                    </p>
                    {f.body ? <p className="jg-fb">{f.body}</p> : null}
                  </div>
                </div>
              );
            })}
            {newestFirst.length ? (
              <ul className="jg-nl" aria-label="Notes">
                {newestFirst.map((n) => (
                  <li key={n.id} className="jg-nn">
                    <p className="jg-nh">
                      <b>{n.author}</b>
                      <span aria-hidden="true">·</span>
                      <span>{formatClock(n.created_at)}</span>
                    </p>
                    <p className="jg-nb">{n.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="jg-none">No notes yet.</p>
            )}
          </div>
          <div className="jg-sh-foot">
            <label className="sr-only" htmlFor="jg-note">
              Add a note
            </label>
            <textarea
              id="jg-note"
              className="jg-ta"
              rows={3}
              placeholder="Add a note for the panel…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="button" className="jg-prim" disabled={busy || !draft.trim()} onClick={saveAndShow}>
              {busy ? "Saving…" : "Save note"}
            </button>
          </div>
        </>
      )}
    </>
  );
}

/**
 * One rubric: the criteria in their sections, a row of big scale buttons for
 * each, and the footer that says each tap saves. The saving itself is
 * useRubricScoring, shared with the Judge Advisor's ScoreSheet.
 */
export function RubricSegment({
  rubric,
  team,
  score,
  ask,
  onSaved,
  onCleared,
}: {
  rubric: Rubric;
  team: Team;
  score: ScoreRow | null;
  ask: Ask;
  onSaved: (score: ScoreRow) => void;
  onCleared: (rubricId: string) => void;
}) {
  const { values, answered, pending, error, set, clearAll } = useRubricScoring({
    rubric,
    teamId: team.id,
    score,
    onSaved,
    onCleared,
  });
  const labelId = useId();
  const saving = pending.size > 0;

  async function clear() {
    const ok = await ask(
      `Clear all ${answered} ${rubricShort(rubric)} scores for ${team.number}? The other rubric is untouched.`,
      { confirmLabel: "Clear scores", danger: true },
    );
    if (ok) await clearAll();
  }

  return (
    <>
      <div className="jg-sh-scroll">
        {rubric.placeholder ? (
          <Banner kind="info">
            These criteria are a placeholder. Replace them with your real rubric in{" "}
            <code>config/rubrics.json</code>.
          </Banner>
        ) : null}
        {error ? <Banner kind="error">{error}</Banner> : null}

        {rubric.sections.map((section) => {
          const got = section.criteria.reduce((sum, c) => sum + (Number(values[c.id]) || 0), 0);
          return (
            <Fragment key={section.name}>
              <div className="jg-sx">
                <h3>{section.name}</h3>
                <span className="jg-st">
                  <b>{got}</b>/{sectionMax(rubric, section.criteria.length)}
                </span>
              </div>
              <ul className="jg-crs">
                {section.criteria.map((c) => {
                  const chosen = rubric.scale.find((p) => p.value === values[c.id]);
                  const busy = pending.has(c.id) || pending.has("all");
                  return (
                    <li key={c.id} className="jg-cr">
                      <p className="jg-cl" id={`${labelId}-${c.id}`}>
                        {c.label}
                      </p>
                      <div
                        className="jg-sv"
                        role="group"
                        aria-labelledby={`${labelId}-${c.id}`}
                        style={{ gridTemplateColumns: `repeat(${rubric.scale.length}, minmax(0, 1fr))` }}
                      >
                        {rubric.scale.map((p) => (
                          <button
                            key={p.value}
                            type="button"
                            aria-pressed={chosen?.value === p.value}
                            aria-label={`${p.short}, ${p.label}`}
                            disabled={busy}
                            // Tapping the chosen value again clears it.
                            onClick={() => set(c.id, chosen?.value === p.value ? null : p.value)}
                          >
                            {p.short}
                          </button>
                        ))}
                      </div>
                      <p className="jg-cc">{chosen ? chosen.label : "Not scored"}</p>
                    </li>
                  );
                })}
              </ul>
            </Fragment>
          );
        })}
      </div>
      <div className="jg-sh-foot">
        <div className="jg-sf">
          <p>
            <CheckIcon />
            {saving ? "Saving…" : answered ? "Saved · each tap saves" : "Each tap saves"}
          </p>
          {answered ? (
            <button type="button" className="jg-quiet" disabled={saving} onClick={clear}>
              Clear {rubricShort(rubric)} scores
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
