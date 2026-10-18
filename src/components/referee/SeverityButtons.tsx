"use client";

import type { FlagKind } from "@/components/Flags";
import { DISQUALIFIED_KIND } from "@/lib/flagValidation";
import { toneSolid } from "@/lib/tone";

/**
 * "How serious?": one big button per kind, filled in its severity colour.
 * Tapping only selects it -- the Record button below the form is what saves --
 * so a slip costs nothing. The colour is the severity and the label says it
 * too, so nobody taps "Major" meaning "Good".
 */
export function SeverityButtons({
  kinds,
  value,
  onChange,
  escalateId,
}: {
  /** Least to most serious. */
  kinds: FlagKind[];
  /** The selected kind's id, if one is. */
  value: string | null;
  onChange: (id: string) => void;
  /** The kind to ring as a visual nudge when a review is due. Never selects it. */
  escalateId?: string | null;
}) {
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
