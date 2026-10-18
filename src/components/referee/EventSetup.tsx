"use client";

import { useState } from "react";
import { Banner } from "@/components/ui";
import { MAX_FIELD_COUNT } from "@/lib/flagValidation";
import { RULESETS } from "@/lib/rules";
import type { RefereeSetup } from "@/lib/types";
import { DEFAULT_FIELD_COUNT } from "./logic";

/**
 * Event setup: which program the event runs and how many fields it has, chosen
 * once for every referee rather than per match or per device. Pre-filled from
 * the last setup, so the second day of an event is one tap.
 */
export function EventSetup({
  setup,
  name,
  busy,
  error,
  onSave,
  onCancel,
}: {
  /** The last setup, if there is one. */
  setup: RefereeSetup | null;
  /** Who is setting it: it is recorded under their name. */
  name: string;
  busy: boolean;
  error: string | null;
  onSave: (ruleset: string, fieldCount: number) => void;
  /** Only when this was opened on purpose: a day's first setup cannot be skipped. */
  onCancel?: () => void;
}) {
  // No program is assumed when there is no earlier setup: the wrong one would
  // be taken for a default, and every referee would flag against it.
  const [ruleset, setRuleset] = useState(setup?.ruleset ?? "");
  const [count, setCount] = useState(setup?.field_count ?? DEFAULT_FIELD_COUNT);

  return (
    <form
      className="rf-setup"
      onSubmit={(e) => {
        e.preventDefault();
        if (ruleset && !busy) onSave(ruleset, count);
      }}
    >
      <main className="rf-body">
        <div>
          <p className="rf-eyebrow">Today&apos;s event</p>
          <h1 className="rf-h1">Set up refereeing</h1>
          <p className="rf-intro">
            Choose once for this event. Every referee will use it. You can change it for another event or day.
          </p>
        </div>

        {error ? <Banner kind="error">{error}</Banner> : null}

        <div>
          <div className="rf-lab" id="rf-program-l">
            <span>Program</span>
          </div>
          <div className="rf-cards" role="group" aria-labelledby="rf-program-l">
            {RULESETS.map((r) => (
              <button
                key={r.id}
                type="button"
                className="rf-pc"
                aria-pressed={ruleset === r.id}
                onClick={() => setRuleset(r.id)}
              >
                <span className="rf-pt">
                  <b>{r.program}</b>
                  <span>
                    {r.label} · {r.rules.length} rules
                  </span>
                </span>
                <span className="rf-ck" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="rf-lab" id="rf-fields-l">
            <span>Number of fields</span>
          </div>
          <div className="rf-stepper" role="group" aria-labelledby="rf-fields-l">
            <button
              type="button"
              className="rf-sb"
              aria-label="Fewer fields"
              disabled={count <= 1}
              onClick={() => setCount(count - 1)}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M5 12h14" />
              </svg>
            </button>
            <output className="rf-fnum" aria-label="Fields">
              {count}
            </output>
            <button
              type="button"
              className="rf-sb"
              aria-label="More fields"
              disabled={count >= MAX_FIELD_COUNT}
              onClick={() => setCount(count + 1)}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
          <div className="rf-prev" aria-hidden="true">
            {Array.from({ length: count }, (_, i) => (
              <span key={i}>Field {i + 1}</span>
            ))}
          </div>
          <p className="rf-hint">Most events run 2–4 fields. Add more if yours does.</p>
        </div>
      </main>

      <div className="rf-abar">
        <p className="rf-by">Set by {name} · applies to all referees</p>
        <button type="submit" className="rf-prim rf-prim--accent" disabled={!ruleset || busy}>
          {busy ? "Saving…" : "Start refereeing"}
        </button>
        {onCancel ? (
          <button type="button" className="rf-link" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
