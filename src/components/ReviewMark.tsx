"use client";

import { useId, useState } from "react";
import { call } from "@/components/useAppState";
import { formatClock } from "@/components/ui";
import type { ReviewMark, Team } from "@/lib/types";
import type { Ask } from "./judge/logic";
import { clearMarkAfterAsking, mayChangeMark, REASON_MAX, saveMark, type MarkViewer } from "./reviewMarkLogic";

/**
 * The review mark's pieces, shared by the judge team sheet and the Teams
 * drawer: the pennant, the "Mark for review" button with its reason box, and
 * the red note once a team is marked. Danger red (the app's danger
 * tokens), never a referee severity or a status colour; no motion.
 */

/** A pennant: pole and triangle, not the referee's rectangular flag. Labelled where it stands alone, hidden inside a labelled control. */
export function Pennant({ size = 16, label, className = "" }: { size?: number; label?: string; className?: string }) {
  return (
    <svg
      className={`rv-pn ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <path d="M6 21V3" />
      <path d="M6 4.5l12 5-12 5" fill="currentColor" />
    </svg>
  );
}

/** The small read-only pennant that sits after a marked team's name. */
export const MarkedPennant = ({ size = 14 }: { size?: number }) => <Pennant size={size} label="Marked for review" />;

type ViewProps = {
  team: Pick<Team, "number">;
  mark: ReviewMark | undefined;
  /** The viewer may edit or clear this mark (mayChangeMark). */
  canChange: boolean;
  /** The reason being typed; null while the box is shut. */
  draft: string | null;
  busy: boolean;
  /** For the input's label. */
  inputId: string;
  onDraft: (next: string | null) => void;
  onSave: () => void;
  onClear: () => void;
};

/** What the control draws, from props alone. */
export function ReviewMarkView({ team, mark, canChange, draft, busy, inputId, onDraft, onSave, onClear }: ViewProps) {
  const editor =
    draft === null ? null : (
      <div className="rv-ed">
        <label htmlFor={inputId}>Reason (optional)</label>
        <input
          id={inputId}
          className="rv-in"
          type="text"
          autoComplete="off"
          autoFocus
          maxLength={REASON_MAX}
          placeholder="What should the JA look at?"
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            // Inside the Teams drawer's form Enter would save the team, and Escape would close the drawer.
            if (e.key === "Enter") {
              e.preventDefault();
              onSave();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onDraft(null);
            }
          }}
        />
        <div className="rv-ea">
          <button type="button" className="rv-save" disabled={busy} onClick={onSave}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="rv-cancel" disabled={busy} onClick={() => onDraft(null)}>
            Cancel
          </button>
        </div>
        <p className="rv-hint">Only judges and the Judge Advisor see this. The team never does.</p>
      </div>
    );

  if (!mark) {
    return (
      <div className="rv">
        {draft === null ? (
          <button type="button" className="rv-tg" onClick={() => onDraft("")}>
            <Pennant />
            Mark for review
          </button>
        ) : (
          editor
        )}
      </div>
    );
  }

  return (
    <div className="rv">
      <div className="rv-note" role="note" aria-label={`Marked for review: ${team.number}`}>
        <div className="rv-nh">
          <Pennant />
          <p>
            <b>
              Marked for review by {mark.set_by} · {formatClock(mark.set_at)}
            </b>
            {mark.reason ? <> — {mark.reason}</> : null}
          </p>
        </div>
        {canChange && draft === null ? (
          <div className="rv-na">
            <button type="button" className="rv-lk" disabled={busy} onClick={() => onDraft(mark.reason ?? "")}>
              Edit reason
            </button>
            <button type="button" className="rv-lk" disabled={busy} onClick={onClear}>
              Clear
            </button>
          </div>
        ) : null}
      </div>
      {canChange ? editor : null}
    </div>
  );
}

/**
 * The control for one team: "Mark for review" when it is not marked, the
 * red note when it is. Writes with PUT and DELETE /api/review-marks, then
 * `refresh()`; a refusal goes to `onError`, which the host shows in its own banner.
 */
export function ReviewMarkControl({
  team,
  mark,
  viewer,
  ask,
  refresh,
  onError,
}: {
  team: Pick<Team, "id" | "number">;
  mark: ReviewMark | undefined;
  viewer: MarkViewer;
  ask: Ask;
  refresh: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  /** One write, then a refresh; false (a refusal, or a no to the question) leaves things as they were. */
  async function run(write: () => Promise<unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    onError(null);
    try {
      if ((await write()) === false) return false;
      await refresh();
      return true;
    } catch (e) {
      onError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <ReviewMarkView
      team={team}
      mark={mark}
      canChange={mark ? mayChangeMark(mark, viewer) : true}
      draft={draft}
      busy={busy}
      inputId={inputId}
      onDraft={setDraft}
      onSave={async () => {
        if (draft !== null && (await run(() => saveMark(call, team.id, draft)))) setDraft(null);
      }}
      onClear={() => void run(() => clearMarkAfterAsking(ask, call, team))}
    />
  );
}
