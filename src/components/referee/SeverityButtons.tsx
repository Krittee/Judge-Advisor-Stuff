"use client";

import { useId } from "react";
import type { FlagKind } from "@/components/Flags";
import { DISQUALIFIED_KIND } from "@/lib/flagValidation";
import { toneRail, toneSolid } from "@/lib/tone";

/**
 * "How serious?": one big button per kind, filled in its severity colour.
 * Tapping only selects it -- the Record button below the form is what saves --
 * so a slip costs nothing. The colour is the severity and the label says it
 * too, so nobody taps "Major" meaning "Good".
 *
 * `compact` is the Judge Advisor's Correct flag sheet: the same select-then-
 * confirm buttons in one row of five, a dot in the kind's colour until it is
 * chosen and the whole button filled once it is. Styles: .ja-sev5 / .ja-sv.
 */
export function SeverityButtons({
  kinds,
  value,
  onChange,
  escalateId,
  compact = false,
}: {
  /** Least to most serious. */
  kinds: FlagKind[];
  /** The selected kind's id, if one is. */
  value: string | null;
  onChange: (id: string) => void;
  /** The kind to ring as a visual nudge when a review is due. Never selects it. */
  escalateId?: string | null;
  compact?: boolean;
}) {
  const labelId = useId();

  if (compact) {
    return (
      <div>
        <div className="ja-lab" id={labelId}>
          Severity
        </div>
        <div className="ja-sev5" role="group" aria-labelledby={labelId}>
          {kinds.map((k) => {
            const on = value === k.id;
            return (
              <button
                key={k.id}
                type="button"
                aria-pressed={on}
                title={k.label}
                onClick={() => onChange(k.id)}
                className={`ja-sv ${on ? toneSolid(k.color) : "bg-surface text-ink hover:bg-surface-2"}`}
              >
                <i aria-hidden="true" className={on ? "bg-current" : toneRail(k.color)} />
                {k.short}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="rf-lab" id="rf-sev-l">
        <span>How serious?</span>
      </div>
      <div className="rf-sev" role="group" aria-labelledby="rf-sev-l">
        {kinds.map((k) => {
          const on = value === k.id;
          return (
            <button
              key={k.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(k.id)}
              className={`rf-sv ${toneSolid(k.color)} ${k.id === DISQUALIFIED_KIND ? "rf-sv--wide" : ""} ${
                escalateId === k.id ? "ring-2 ring-offset-2 ring-offset-canvas ring-caution" : ""
              }`}
            >
              {on ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              ) : null}
              {k.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
