"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Banner } from "@/components/ui";
import type { AwardView, NominationRow, Team } from "@/lib/types";
import { clockParts } from "./logic";
import { myAwards, myReason, type Finished, type Me } from "./nominations";
import { CheckIcon, CloseIcon, StatusPill } from "./parts";

/* Where a judge nominates the teams they interviewed for awards: the card the
   Queue shows right after Finish, and the small sheet the Done rows open. The
   awards come from config/event.json through GET /api/awards -- no label or
   blurb is written here. Styles: .jg-fin, .jg-ach and .jg-nsheet in globals.css. */

/** The longest reason the API keeps (REASON_MAX in app/api/awards/shared.ts). */
const REASON_MAX = 500;

/**
 * One chip per award, two to a row. Pressed is this judge's own nomination:
 * the accent fill and a check. Each tap goes straight to `onToggle` with the
 * state it wants, `on`; there is no Save.
 */
export function AwardChips({
  team,
  awards,
  pressed,
  onToggle,
}: {
  team: Pick<Team, "number">;
  awards: AwardView[];
  /** The ids of the awards this judge has nominated the team for. */
  pressed: ReadonlySet<string>;
  onToggle: (awardId: string, on: boolean) => void;
}) {
  return (
    <div className="jg-agrid" role="group" aria-label={`Awards for ${team.number}`}>
      {awards.map((a) => {
        const on = pressed.has(a.id);
        return (
          <button
            key={a.id}
            type="button"
            className="jg-ach"
            aria-pressed={on}
            title={a.blurb}
            onClick={() => onToggle(a.id, !on)}
          >
            <CheckIcon />
            <span>{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The question over the chips, in the card and in the sheet. */
function Ask({ team }: { team: Pick<Team, "number"> }) {
  return (
    <p className="jg-fq">
      Nominate {team.number} for an award?
      <small>Each tap saves. The Judge Advisor decides.</small>
    </p>
  );
}

/**
 * The hero slot right after an interview finishes: a green card with the
 * team, the question and the chips. Done collapses it (the page remembers
 * that for the team); Add a reason opens the reason sheet.
 */
export function FinishedCard({
  finished,
  awards,
  pressed,
  onToggle,
  onDone,
  onReason,
}: {
  finished: Finished;
  awards: AwardView[];
  pressed: ReadonlySet<string>;
  onToggle: (awardId: string, on: boolean) => void;
  onDone: () => void;
  onReason: () => void;
}) {
  const { team } = finished.card;
  return (
    <section className="jg-hero jg-t-done jg-fin" aria-label="Interview finished">
      <div className="jg-hero-top">
        <span className="jg-eyebrow">Interview finished · {clockParts(finished.at).time}</span>
        <StatusPill status="completed" short />
      </div>
      <div>
        <h2 className="jg-hn">{team.number}</h2>
        <p className="jg-hname">{team.name}</p>
      </div>
      <Ask team={team} />
      <AwardChips team={team} awards={awards} pressed={pressed} onToggle={onToggle} />
      <div className="jg-hrow">
        <button type="button" className="jg-ghost jg-lg" onClick={onDone}>
          Done
        </button>
        <button type="button" className="jg-lnk" onClick={onReason}>
          Add a reason
        </button>
      </div>
    </section>
  );
}

/** Which half of the sheet it opens on: the chips (a Done row's Edit) or the reasons (Add a reason). */
export type NominateView = "chips" | "reasons";

type BodyProps = {
  awards: AwardView[];
  /** The panel's nominations, with any tap still saving laid over them. */
  nominations: NominationRow[];
  me: Me;
  /** Nominate, withdraw or give a reason; resolves to the error message, or null when it saved. */
  onSet: (teamId: string, awardId: string, on: boolean, reason?: string) => Promise<string | null>;
};

/**
 * The sheet a Done row's Edit / Nominate opens, with the same chips as the
 * card, and the reasons for the awards the judge has pressed. A native
 * <dialog> opened with showModal(), as TeamSheet is: the focus trap, Escape
 * and the inert page come with it. A modal covers the page's error banner, so
 * a failed write is shown inside.
 */
export function NominateSheet({
  team,
  view,
  onClose,
  ...rest
}: {
  /** The team to show; null keeps the sheet closed. */
  team: Team | null;
  view: NominateView;
  onClose: () => void;
} & BodyProps) {
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
      className="jg-sheet jg-nsheet"
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
      {team ? <Body key={`${team.id}:${view}`} team={team} first={view} titleId={titleId} onClose={onClose} {...rest} /> : null}
    </dialog>
  );
}

function Body({
  team,
  first,
  awards,
  nominations,
  me,
  onSet,
  titleId,
  onClose,
}: BodyProps & { team: Team; first: NominateView; titleId: string; onClose: () => void }) {
  const [view, setView] = useState(first);
  const [error, setError] = useState<string | null>(null);
  const pressed = myAwards(nominations, team.id, me);

  async function toggle(awardId: string, on: boolean) {
    setError(null);
    const failed = await onSet(team.id, awardId, on);
    if (failed) setError(failed);
  }

  return (
    <>
      <div className="jg-grab" aria-hidden="true" />
      <div className="jg-sh-top">
        <div className="jg-sh-h">
          <div className="jg-sh-id">
            <h2 id={titleId}>{team.number}</h2>
            <p className="jg-nm">{team.name}</p>
          </div>
          <button type="button" className="jg-x" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
      </div>

      {view === "chips" ? (
        <>
          <div className="jg-sh-scroll">
            {error ? <Banner kind="error">{error}</Banner> : null}
            <Ask team={team} />
            <AwardChips team={team} awards={awards} pressed={pressed} onToggle={toggle} />
          </div>
          <div className="jg-sh-foot">
            <div className="jg-hrow">
              <button type="button" className="jg-ghost jg-lg" onClick={onClose}>
                Done
              </button>
              <button type="button" className="jg-lnk" onClick={() => setView("reasons")}>
                Add a reason
              </button>
            </div>
          </div>
        </>
      ) : (
        <Reasons
          team={team}
          awards={awards.filter((a) => pressed.has(a.id))}
          nominations={nominations}
          me={me}
          onSet={onSet}
          error={error}
          setError={setError}
          onClose={onClose}
        />
      )}
    </>
  );
}

/** One optional textarea per pressed award; Save sends the ones that changed. */
function Reasons({
  team,
  awards,
  nominations,
  me,
  onSet,
  error,
  setError,
  onClose,
}: BodyProps & {
  team: Team;
  /** Only the awards the judge has pressed. */
  awards: AwardView[];
  error: string | null;
  setError: (message: string | null) => void;
  onClose: () => void;
}) {
  const id = useId();
  const stored = (awardId: string) => myReason(nominations, awardId, team.id, me);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(awards.map((a) => [a.id, stored(a.id)])),
  );
  const [saving, setSaving] = useState(false);
  const changed = awards.filter((a) => (drafts[a.id] ?? "").trim() !== stored(a.id));

  async function save() {
    setSaving(true);
    setError(null);
    const results = await Promise.all(
      changed.map((a) => onSet(team.id, a.id, true, (drafts[a.id] ?? "").trim())),
    );
    setSaving(false);
    const failed = results.find(Boolean);
    if (failed) setError(failed);
    else onClose();
  }

  return (
    <>
      <div className="jg-sh-scroll">
        {error ? <Banner kind="error">{error}</Banner> : null}
        {awards.length ? (
          awards.map((a) => (
            <div key={a.id} className="jg-rsn">
              <label htmlFor={`${id}-${a.id}`}>Why {a.label}?</label>
              <small>{a.blurb}</small>
              <textarea
                id={`${id}-${a.id}`}
                className="jg-ta"
                rows={3}
                maxLength={REASON_MAX}
                placeholder="Optional. The Judge Advisor reads it."
                value={drafts[a.id] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
              />
            </div>
          ))
        ) : (
          <p className="jg-none">Nominate {team.number} for an award first, then say why.</p>
        )}
      </div>
      <div className="jg-sh-foot">
        <button type="button" className="jg-prim" disabled={saving || !changed.length} onClick={save}>
          {saving ? "Saving…" : "Save reasons"}
        </button>
        <button type="button" className="jg-quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  );
}
