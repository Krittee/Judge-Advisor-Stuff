"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { call } from "./useAppState";
import { Banner, Button } from "./ui";
import type { Rubric, ScalePoint } from "@/lib/rubrics";
import type { ScoreRow } from "@/lib/types";

/**
 * What a finished save should do to the sheet.
 *
 * A judge can tap several criteria before the first answer is back, and the
 * answers can arrive in any order. Each one is the server's merged row as of
 * that request, so only the newest request's answer describes the whole
 * burst: applying an older one would knock the later taps back out and leave
 * the total showing a score nobody entered. Failures are not rolled back to
 * the `score` prop for the same reason -- it is as stale as the old answer.
 * Instead, once the last request of a burst has settled, a burst that failed
 * anywhere asks the server what is actually stored.
 */
export function settleSave(s: {
  /** This request's number, from a counter bumped on every tap. */
  mine: number;
  /** The newest number issued so far. */
  newest: number;
  ok: boolean;
  /** Nothing else is still in flight. */
  drained: boolean;
  /** An earlier request in this burst failed. */
  burstFailed: boolean;
}) {
  const failed = s.burstFailed || !s.ok;
  const refetch = s.drained && failed;
  return {
    apply: s.ok && s.mine === s.newest,
    refetch,
    burstFailed: failed && !refetch,
  };
}

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
  // Every criterion with a save in flight ("all" for a clear), so a tap on
  // one never frees up another's buttons or hides that another is pending.
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const pendingNow = useRef(pending);
  const issued = useRef(0); // numbers saves so settleSave can tell the newest
  const burstFailed = useRef(false);
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

  function track(id: string, on: boolean) {
    const next = new Set(pendingNow.current);
    if (on) next.add(id);
    else next.delete(id);
    pendingNow.current = next;
    setPending(next);
  }

  /** Ask the server what is really stored for this rubric, and show that. */
  async function reload() {
    const at = issued.current;
    try {
      const { scores } = await call<{ scores: ScoreRow[] }>(`/api/scores?teamId=${teamId}`, {
        method: "GET",
      });
      if (at !== issued.current) return; // tapped again meanwhile; that save reports back
      const stored = scores.find((s) => s.rubric_id === rubric.id);
      if (stored) onSaved(stored);
      else {
        setValues({});
        onCleared(rubric.id);
      }
    } catch {
      setError("Could not confirm what was saved. Reopen this team to check your scores.");
    }
  }

  async function set(criterionId: string, value: number | null) {
    // Show the tap immediately; the request confirms it a moment later.
    const optimistic = { ...values };
    if (value === null) delete optimistic[criterionId];
    else optimistic[criterionId] = value;
    setValues(optimistic);

    const mine = ++issued.current;
    track(criterionId, true);
    setError(null);
    let saved: ScoreRow | null = null;
    try {
      saved = (
        await call<{ score: ScoreRow }>("/api/scores", {
          body: { teamId, rubricId: rubric.id, criterionId, value },
        })
      ).score;
    } catch (e) {
      setError((e as Error).message);
    }
    track(criterionId, false);

    const next = settleSave({
      mine,
      newest: issued.current,
      ok: saved !== null,
      drained: pendingNow.current.size === 0,
      burstFailed: burstFailed.current,
    });
    burstFailed.current = next.burstFailed;
    if (next.apply && saved) onSaved(saved);
    if (next.refetch) await reload();
  }

  /** Start this rubric over, leaving the other one alone. */
  async function clearAll() {
    track("all", true);
    setError(null);
    try {
      await call(`/api/scores?teamId=${teamId}&rubricId=${rubric.id}`, { method: "DELETE" });
      setValues({});
      setArmed(false);
      onCleared(rubric.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      track("all", false);
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
