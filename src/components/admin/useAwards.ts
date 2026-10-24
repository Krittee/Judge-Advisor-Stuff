"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "@/components/useAppState";
import type { AwardsAdminView } from "@/lib/types";

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
 */
export function useAwards({ enabled = true }: { enabled?: boolean } = {}) {
  const [data, setData] = useState<AwardsAdminView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);

  const reload = useCallback(async () => {
    try {
      const next = await call<AwardsAdminView>("/api/awards", { method: "GET" });
      if (!live.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (live.current) setError((e as Error).message);
    }
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

  return { data, error, reload };
}
