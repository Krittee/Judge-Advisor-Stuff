"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "@/components/useAppState";
import type { AwardsAdminView, ReleasedView } from "@/lib/types";

/**
 * Every nomination and every winner, for the Judge Advisor.
 *
 * Not part of `useAppState` on purpose: /api/state goes to teams, the desk and
 * the public board, and the winners stay secret until the ceremony. They are
 * asked of /api/awards, which only the Judge Advisor gets them from. The page
 * owns this one, because the rail counts the decided awards on every section.
 *
 * Polled every 15 s while the tab is showing, as the scores are. `reload`
 * asks now and resolves once the answer is in, so a write can wait for it.
 * A failed poll keeps the last good answer and sets `error`; the next good
 * one clears it.
 *
 * It also reads /api/awards/released, what the Judge Advisor has sent to
 * Marketing, together with the awards: the two are asked at once and each
 * keeps its own last good answer, so a failure of one never blanks the other.
 */
export function useAwards({ enabled = true }: { enabled?: boolean } = {}) {
  const [data, setData] = useState<AwardsAdminView | null>(null);
  const [released, setReleased] = useState<ReleasedView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);

  const reload = useCallback(async () => {
    // Each ask answers with its value or its error, so one failing leaves the other's answer in place.
    const settle = <T,>(ask: Promise<T>) => ask.then((value) => ({ value }), (e: Error) => ({ error: e.message }));
    const [awards, sent] = await Promise.all([
      settle(call<AwardsAdminView>("/api/awards", { method: "GET" })),
      settle(call<ReleasedView>("/api/awards/released", { method: "GET" })),
    ]);
    if (!live.current) return;
    if ("value" in awards) setData(awards.value);
    if ("value" in sent) setReleased(sent.value);
    setError("error" in awards ? awards.error : "error" in sent ? sent.error : null);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    live.current = true;
    // A console left open on a phone in someone's pocket should not ask all afternoon.
    const tick = () => {
      if (document.visibilityState !== "hidden") void reload();
    };
    tick();
    const t = setInterval(tick, 15_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      live.current = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled, reload]);

  return { data, released, error, reload };
}
