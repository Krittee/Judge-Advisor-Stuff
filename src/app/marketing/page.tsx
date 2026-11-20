"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { call } from "@/components/useAppState";
import { AwardsDesk } from "@/components/marketing/AwardsDesk";
import { hhmm, readSeen, readTab, writeSeen, writeTab } from "@/components/marketing/marketingLogic";
import { homeFor } from "@/components/SignInForm";
import type { Session } from "@/lib/auth";
import type { ReleasedView } from "@/lib/types";

/**
 * Marketing's page: the Awards Desk. It reads the awards the Judge Advisor has
 * sent (GET /api/awards/released, never a nomination or a winner) and writes
 * nothing to the server.
 *
 * Polled every 15 s while the tab is showing, as the Judge Advisor's awards
 * are, and again the moment it shows. A failed poll keeps the last good
 * answer. What Marketing has seen of a change is kept in this browser only.
 */

/** `window.localStorage` itself can throw on access (Safari private mode), so the read is guarded, not just the calls. */
function browserStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function MarketingPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [view, setView] = useState<ReleasedView | null>(null);
  const [lastGood, setLastGood] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  // Read once on this device; the first render here is "Loading…", so nothing differs between server and browser.
  const [tab, setTab] = useState<string | null>(() => readTab(browserStore()));
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const live = useRef(true);

  useEffect(() => {
    call<{ session: Session | null }>("/api/session", { method: "GET" })
      .then(({ session }) => {
        if (!session) {
          router.replace("/marketing/login");
          return;
        }
        // The Judge Advisor may look at it; the other roles have a console of their own.
        if (session.role !== "marketing" && session.role !== "admin") {
          router.replace(homeFor(session.role));
          return;
        }
        setSession(session);
      })
      .catch(() => router.replace("/marketing/login"));
  }, [router]);

  const reload = useCallback(async () => {
    try {
      const next = await call<ReleasedView>("/api/awards/released", { method: "GET" });
      if (!live.current) return;
      setView(next);
      setLastGood(hhmm(new Date().toISOString()));
      setFailed(false);
    } catch {
      if (live.current) setFailed(true);
    }
  }, []);

  const signedIn = session !== undefined;
  useEffect(() => {
    if (!signedIn) return;
    live.current = true;
    // A desk left open on a phone in someone's pocket should not ask all afternoon.
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
  }, [signedIn, reload]);

  // The set holds what was tapped this visit; the store holds what an earlier visit tapped.
  const isSeen = (key: string) => seen.has(key) || readSeen(browserStore(), key);
  const onSeen = (key: string) => {
    writeSeen(browserStore(), key);
    setSeen((s) => new Set(s).add(key));
  };

  const onTab = (key: string) => {
    writeTab(browserStore(), key);
    setTab(key);
  };

  if (session === undefined) {
    return <p className="p-10 text-center text-ink-faint">Loading…</p>;
  }

  return (
    <AwardsDesk
      name={session?.name ?? "Marketing"}
      view={view}
      lastGood={lastGood}
      failed={failed}
      query={query}
      onQuery={setQuery}
      tab={tab}
      onTab={onTab}
      isSeen={isSeen}
      onSeen={onSeen}
    />
  );
}
