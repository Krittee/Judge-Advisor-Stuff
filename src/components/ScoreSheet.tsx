"use client";

import { Banner, Button } from "./ui";
import { useRubricScoring } from "./useRubricScoring";
import type { Rubric, ScalePoint } from "@/lib/rubrics";
import type { ScoreRow } from "@/lib/types";

export { settleSave } from "./useRubricScoring";

/**
 * One rubric's worth of scoring for one team.
 *
 * Topics only — the judges have the printed rubric with its listen-fors
 * in front of them, and this is only where the points land. Each tap
 * saves immediately: a judge mid-interview should never be wondering
 * whether their last tap was kept.
 */
export function ScoreSheet({
  rubric,
  teamId,
  score,
  onSaved,
  onCleared,
}: {
  rubric: Rubric;
  teamId: string;
  score: ScoreRow | null;
  onSaved: (score: ScoreRow) => void;
  onCleared: (rubricId: string) => void;
}) {
  const { values, total, answered, pending, error, armed, setArmed, set, clearAll } =
    useRubricScoring({ rubric, teamId, score, onSaved, onCleared });

  return (
    <div className="space-y-4">
      {rubric.placeholder ? (
        <Banner kind="info">
          These criteria are a placeholder. Replace them with your real rubric in{" "}
          <code>config/rubrics.json</code>.
        </Banner>
      ) : null}

      {error ? <Banner kind="error">{error}</Banner> : null}

      <div className="flex items-baseline justify-between">
        <span className="text-sm text-ink-subtle">
          {answered} of {rubric.criteria.length} scored
        </span>
        <span className="text-2xl font-bold tabular-nums">
          {total}
          <span className="text-base font-normal text-ink-faint"> / {rubric.max}</span>
        </span>
      </div>

      {answered ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-danger/8 p-3 ring-1 ring-inset ring-danger/25">
          {armed ? (
            <>
              <Button variant="danger" size="sm" disabled={pending.size > 0} onClick={clearAll}>
                {pending.has("all") ? "Clearing…" : `Yes, clear all ${answered}`}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setArmed(false)}>
                Cancel
              </Button>
              <span className="text-xs text-danger-quiet">
                {rubric.name} only — the other rubric is untouched.
              </span>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setArmed(true)}>
                Clear score
              </Button>
              <span className="text-xs text-ink-faint">
                Wipes this rubric so you can start it over. Tap any single value again to clear
                just that one.
              </span>
            </>
          )}
        </div>
      ) : null}

      {rubric.sections.map((section) => (
        <section key={section.name}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {section.name}
          </h4>
          <ul className="space-y-2">
            {section.criteria.map((criterion) => (
              <li
                key={criterion.id}
                className="rounded-xl bg-surface p-3 ring-1 ring-inset ring-line"
              >
                <p className="mb-2 text-sm text-ink">{criterion.label}</p>
                <div className="flex flex-wrap gap-2">
                  {rubric.scale.map((point) => (
                    <ScoreButton
                      key={point.value}
                      point={point}
                      selected={values[criterion.id] === point.value}
                      busy={pending.has(criterion.id) || pending.has("all")}
                      onClick={() =>
                        set(
                          criterion.id,
                          // Tapping the chosen value again clears it.
                          values[criterion.id] === point.value ? null : point.value,
                        )
                      }
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ScoreButton({
  point,
  selected,
  busy,
  onClick,
}: {
  point: ScalePoint;
  selected: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={selected ? "Tap again to clear" : point.label}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${
        selected
          ? "bg-accent text-white ring-2 ring-accent"
          : "bg-surface text-ink-muted ring-1 ring-inset ring-line hover:bg-surface-2"
      }`}
    >
      <span className="mr-1.5 font-bold tabular-nums">{point.short}</span>
      <span className="text-xs opacity-80">{point.label}</span>
    </button>
  );
}
