"use client";

import { useEffect, useMemo, useState } from "react";
import { call } from "./useAppState";
import { Banner, Button } from "./ui";
import type { Rubric, ScalePoint } from "@/lib/rubrics";
import type { ScoreRow } from "@/lib/types";

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
  const [values, setValues] = useState<Record<string, number>>(score?.values ?? {});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    setValues(score?.values ?? {});
  }, [score]);

  // Never leave a live "clear everything" button sitting around.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 8000);
    return () => clearTimeout(t);
  }, [armed]);

  const total = useMemo(
    () => rubric.criteria.reduce((sum, c) => sum + (Number(values[c.id]) || 0), 0),
    [rubric, values],
  );
  const answered = rubric.criteria.filter((c) => values[c.id] !== undefined).length;

  async function set(criterionId: string, value: number | null) {
    // Show the tap immediately; the request confirms it a moment later.
    const optimistic = { ...values };
    if (value === null) delete optimistic[criterionId];
    else optimistic[criterionId] = value;
    setValues(optimistic);

    setSaving(criterionId);
    setError(null);
    try {
      const { score: saved } = await call<{ score: ScoreRow }>("/api/scores", {
        body: { teamId, rubricId: rubric.id, criterionId, value },
      });
      onSaved(saved);
    } catch (e) {
      setValues(score?.values ?? {}); // put it back the way it was
      setError((e as Error).message);
    } finally {
      setSaving(null);
    }
  }

  /** Start this rubric over, leaving the other one alone. */
  async function clearAll() {
    setSaving("all");
    setError(null);
    try {
      await call(`/api/scores?teamId=${teamId}&rubricId=${rubric.id}`, { method: "DELETE" });
      setValues({});
      setArmed(false);
      onCleared(rubric.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(null);
    }
  }

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
        <span className="text-sm text-zinc-400">
          {answered} of {rubric.criteria.length} scored
        </span>
        <span className="text-2xl font-bold tabular-nums">
          {total}
          <span className="text-base font-normal text-zinc-500"> / {rubric.max}</span>
        </span>
      </div>

      {answered ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-rose-500/[0.06] p-3 ring-1 ring-inset ring-rose-500/20">
          {armed ? (
            <>
              <Button variant="danger" size="sm" disabled={saving !== null} onClick={clearAll}>
                {saving === "all" ? "Clearing…" : `Yes, clear all ${answered}`}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setArmed(false)}>
                Cancel
              </Button>
              <span className="text-xs text-rose-200">
                {rubric.name} only — the other rubric is untouched.
              </span>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setArmed(true)}>
                Clear score
              </Button>
              <span className="text-xs text-zinc-500">
                Wipes this rubric so you can start it over. Tap any single value again to clear
                just that one.
              </span>
            </>
          )}
        </div>
      ) : null}

      {rubric.sections.map((section) => (
        <section key={section.name}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {section.name}
          </h4>
          <ul className="space-y-2">
            {section.criteria.map((criterion) => (
              <li
                key={criterion.id}
                className="rounded-xl bg-white/[0.04] p-3 ring-1 ring-inset ring-white/[0.07]"
              >
                <p className="mb-2 text-sm text-zinc-200">{criterion.label}</p>
                <div className="flex flex-wrap gap-2">
                  {rubric.scale.map((point) => (
                    <ScoreButton
                      key={point.value}
                      point={point}
                      selected={values[criterion.id] === point.value}
                      busy={saving === criterion.id}
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
          ? "bg-indigo-500 text-white ring-2 ring-indigo-300"
          : "bg-white/5 text-zinc-300 ring-1 ring-inset ring-white/10 hover:bg-white/10"
      }`}
    >
      <span className="mr-1.5 font-bold tabular-nums">{point.short}</span>
      <span className="text-xs opacity-80">{point.label}</span>
    </button>
  );
}
