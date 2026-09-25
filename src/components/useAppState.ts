"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState, ScoreRow } from "@/lib/types";
import type { Rubric } from "@/lib/rubrics";

const EMPTY: AppState = {
  panels: [],
  teams: [],
  requests: [],
  divisions: [],
  categories: [],
  languages: [],
  conflicts: [],
  pitFloor: { columns: "right-to-left", rows: "bottom-to-top" },
  matchTypes: [],
  flagKinds: [],
  flags: [],
  viewer: {
    role: "team",
    name: null,
    panelId: null,
    panelName: null,
    division: null,
    canAdvance: false,
    canReadNotes: false,
    canAdminister: false,
    canFlag: false,
    canReadFlags: false,
  },
  serverTime: "",
};

/**
 * Poll /api/state and hand the result to whichever screen asked for it.
 *
 * Polling rather than websockets is a deliberate choice: it survives flaky
 * venue wifi, reconnects with no special handling, and an unchanged board
 * costs a 304. Tabs that are not visible stop polling entirely.
 */
export function useAppState(intervalMs = 4000) {
  const [state, setState] = useState<AppState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const etag = useRef<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  const poll = useCallback(async () => {
    try {
      const headers: HeadersInit = {};
      if (etag.current) headers["If-None-Match"] = etag.current;

      const res = await fetch("/api/state", { headers, cache: "no-store" });

      if (res.status === 304) {
        setOnline(true);
        return;
      }
      if (!res.ok) {
        setOnline(false);
        return;
      }

      const tag = res.headers.get("ETag");
      if (tag) etag.current = tag;
      setState((await res.json()) as AppState);
      setOnline(true);
    } catch {
      setOnline(false);
    } finally {
      setLoaded(true);
    }
  }, []);

  /**
   * One poll at a time, but a caller that awaits this always gets a
   * finished poll.
   *
   * This used to return immediately when a poll was already in flight.
   * Every screen does `await call(...)` then `await refresh()` after an
   * action, so whenever that collided with the 4-second timer -- better
   * than a one-in-four chance -- the refresh was silently skipped and the
   * judge watched a stale card until the next tick. That is the "I tapped
   * it and nothing happened" the judges reported: the write had already
   * landed. Sharing the promise keeps the single-flight guard and makes
   * the await mean what it reads like.
   */
  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const run = poll();
    inFlight.current = run;
    try {
      await run;
    } finally {
      inFlight.current = null;
    }
  }, [poll]);

  useEffect(() => {
    refresh();
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(refresh, intervalMs);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh, intervalMs]);

  return { state, loaded, online, refresh };
}

/** POST/PATCH/DELETE helper that surfaces the API's error message as-is. */
export async function call<T = unknown>(
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: options.method ?? "POST",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

/**
 * Rubric scores for every team the caller is allowed to see.
 *
 * Separate from useAppState because scores are not queue state: they
 * change when a judge taps a criterion, not when the board moves, and
 * only the two screens that show them need to ask. Scoping is the
 * endpoint's job -- a judge gets their own panel's teams and no others.
 *
 * `enabled` exists so a screen that only shows scores on one tab does not
 * poll for them while that tab is closed. The judge console leaves it on:
 * it wants each team's total on the queue card as well.
 */
export function useScores({ enabled = true }: { enabled?: boolean } = {}) {
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let live = true;
    const load = () => {
      // A judge console left open on a phone in someone's pocket should
      // not be asking for scores all afternoon; the same rule useAppState
      // applies to the queue itself.
      if (document.visibilityState === "hidden") return;
      call<{ scores: ScoreRow[]; rubrics: Rubric[] }>("/api/scores", { method: "GET" })
        .then((d) => {
          if (!live) return;
          setScores(d.scores);
          setRubrics(d.rubrics);
          setError(null);
        })
        .catch((e) => live && setError((e as Error).message))
        .finally(() => live && setLoaded(true));
    };

    load();
    const t = setInterval(load, 15_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", load);
    };
  }, [enabled]);

  return { scores, rubrics, error, loaded };
}
