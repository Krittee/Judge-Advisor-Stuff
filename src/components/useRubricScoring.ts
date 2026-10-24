"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { call } from "./useAppState";
import type { Rubric } from "@/lib/rubrics";
import type { ScoreRow } from "@/lib/types";

/**
 * What a finished save should do to the sheet.
 *
 * A judge can tap several criteria before the first answer is back, and the
 * answers can arrive in any order. An older request may save last, so even
 * the newest response can miss a criterion. Once overlapping saves settle,
 * read the combined row back from the server. Failures also need a readback;
 * the `score` prop can be stale.
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
  /** At least two saves in this burst were in flight together. */
  burstOverlapped: boolean;
}) {
  const failed = s.burstFailed || !s.ok;
  const refetch = s.drained && (failed || s.burstOverlapped);
  return {
    apply: s.ok && s.mine === s.newest,
    refetch,
    burstFailed: failed && !refetch,
  };
}

/**
 * One rubric's scoring for one team: the values on screen, the per-tap
 * saves and the clear-all, with no markup of its own.
 *
 * Each tap saves immediately: a judge mid-interview should never be
 * wondering whether their last tap was kept.
 */
export function useRubricScoring({
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
  const burstOverlapped = useRef(false);
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

  /** Save one criterion; `null` clears it. */
  async function set(criterionId: string, value: number | null) {
    // Show the tap immediately; the request confirms it a moment later.
    const optimistic = { ...values };
    if (value === null) delete optimistic[criterionId];
    else optimistic[criterionId] = value;
    setValues(optimistic);

    if (pendingNow.current.size > 0) burstOverlapped.current = true;
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
      burstOverlapped: burstOverlapped.current,
    });
    burstFailed.current = next.burstFailed;
    if (next.apply && saved) onSaved(saved);
    if (next.refetch) {
      burstOverlapped.current = false;
      await reload();
    }
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

  return {
    /** criterion id -> the value showing now (optimistic until confirmed) */
    values,
    total,
    answered,
    /** criterion ids with a save in flight, plus "all" while a clear is */
    pending,
    error,
    /** The inline "are you sure" of the clear button; drops itself after 8s. */
    armed,
    setArmed,
    set,
    clearAll,
  };
}
