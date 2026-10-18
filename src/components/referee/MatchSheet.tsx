"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MatchFields } from "@/components/MatchFields";
import { matchIsSet, type CurrentMatch } from "./logic";

/**
 * "Set the match": a bottom sheet for the match and field every flag is pinned
 * to. The referee edits a draft and commits it with "Use this match", so
 * backing out leaves the match as it was.
 *
 * A native <dialog> opened with showModal() supplies the focus trap, Escape,
 * `aria-modal` semantics and the inert page behind it, and hands focus back to
 * whatever opened it when it closes. This adds the backdrop click and keeps
 * `open` in step. The draft lives in Body, which only exists while the sheet is
 * open, so each opening starts from the current match.
 */
export function MatchSheet({
  open,
  rulesetId,
  fieldCount,
  value,
  onUse,
  onClose,
}: {
  open: boolean;
  rulesetId: string;
  fieldCount: number;
  /** The match in force now. */
  value: CurrentMatch;
  onUse: (match: CurrentMatch) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="rf-sheet"
      aria-modal="true"
      aria-labelledby={titleId}
      // Escape closes the dialog by itself; tell the caller. A close the caller
      // asked for (open already false) is not news.
      onClose={() => {
        if (open) onClose();
      }}
      // A click whose target is the dialog itself landed on the backdrop.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open ? (
        <Body
          titleId={titleId}
          rulesetId={rulesetId}
          fieldCount={fieldCount}
          value={value}
          onUse={onUse}
          onClose={onClose}
        />
      ) : null}
    </dialog>
  );
}

function Body({
  titleId,
  rulesetId,
  fieldCount,
  value,
  onUse,
  onClose,
}: {
  titleId: string;
  rulesetId: string;
  fieldCount: number;
  value: CurrentMatch;
  onUse: (match: CurrentMatch) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ready = matchIsSet(draft, rulesetId, fieldCount);

  return (
    <div className="rf-sheet-in">
      <div className="rf-grab" aria-hidden="true" />
      <div className="rf-sh-h">
        <h2 id={titleId}>Set the match</h2>
        <button type="button" className="rf-x" aria-label="Close" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <MatchFields rulesetId={rulesetId} fieldCount={fieldCount} value={draft} onChange={setDraft} idPrefix="rf-sheet" />

      <div className="rf-sheet-foot">
        <button type="button" className="rf-prim rf-prim--accent" disabled={!ready} onClick={() => onUse(draft)}>
          Use this match
        </button>
        <p className="rf-cap">Stays set for every team you flag until you change it.</p>
      </div>
    </div>
  );
}
