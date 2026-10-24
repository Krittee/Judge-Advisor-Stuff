"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call } from "@/components/useAppState";
import type { AwardsJudgeView } from "@/lib/types";
import {
  applyPending,
  nominationKey,
  sendNomination,
  withoutMine,
  withSaved,
  type Me,
  type PendingTap,
} from "./nominations";

const NONE: AwardsJudgeView = { awards: [], nominations: [] };

/**
 * The judge's award nominations: the config's awards and their own panel's
 * nominations (GET /api/awards -- never a winner), and the writes.
 *
 * Asked for on mount, after every write, and every 15 s while the tab is
 * visible -- the cadence useScores keeps. `me` null (the Judge Advisor
 * looking at this screen) asks for nothing.
 *
 * `set` answers a chip at once: the tap is laid over the server's list
 * (applyPending) until the write returns, then the server's reply replaces
 * it. A failure leaves nothing laid over, so the chip is back as it was, and
 * the message comes back to the caller to show where the judge is looking.
 */
export function useNominations(me: Me | null) {
  const [data, setData] = useState<AwardsJudgeView>(NONE);
  const [taps, setTaps] = useState<Record<string, PendingTap>>({});
  /* Chips with a write in the air. A ref, as the page's `writing`: a second
     tap arrives before React has re-rendered anything, and would send the
     opposite write for a chip that has not finished saving the first. */
  const writing = useRef(new Set<string>());
  /* Bumped when a write lands. A read that started before it is older than the
     reply already applied, and would put the chip back for a moment. */
  const epoch = useRef(0);
  const judge = me?.judge;
  const panelId = me?.panelId;
  const [again, setAgain] = useState(0);

  useEffect(() => {
    if (!judge) return;

    let live = true;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      // ponytail: a failed poll keeps what was last read and the next one retries.
      const asked = epoch.current;
      call<AwardsJudgeView>("/api/awards", { method: "GET" })
        .then((d) => live && asked === epoch.current && setData({ awards: d.awards, nominations: d.nominations }))
        .catch(() => {});
    };

    load();
    const t = setInterval(load, 15_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", load);
    };
  }, [judge, again]);

  // Re-running the effect is a read now, then the 15 s poll starts over.
  const reload = useCallback(() => setAgain((n) => n + 1), []);

  const nominations = useMemo(
    () => (judge && panelId ? applyPending(data.nominations, Object.values(taps), { judge, panelId }) : []),
    [data.nominations, taps, judge, panelId],
  );

  /**
   * Nominate (`on`) or withdraw one award for one team, or -- with `reason`
   * -- change the reason on a nomination. Resolves to the error message, or
   * null when it saved. A repeat tap while the first is still saving is
   * dropped.
   */
  const set = useCallback(
    async (teamId: string, awardId: string, on: boolean, reason?: string): Promise<string | null> => {
      if (!judge || !panelId) return null;
      const key = nominationKey(awardId, teamId);
      if (writing.current.has(key)) return reason === undefined ? null : "Still saving. Try again in a moment.";
      writing.current.add(key);
      setTaps((t) => ({ ...t, [key]: { awardId, teamId, on } }));
      try {
        const saved = await sendNomination(call, { teamId, awardId, on, reason });
        setData((d) => ({
          ...d,
          nominations: saved
            ? withSaved(d.nominations, saved)
            : withoutMine(d.nominations, awardId, teamId, { judge, panelId }),
        }));
        return null;
      } catch (e) {
        return (e as Error).message;
      } finally {
        writing.current.delete(key);
        epoch.current += 1;
        setTaps((t) => Object.fromEntries(Object.entries(t).filter(([k]) => k !== key)));
        reload();
      }
    },
    [judge, panelId, reload],
  );

  return { awards: data.awards, nominations, set, reload };
}
