"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { call, useAppState } from "@/components/useAppState";
import { formatClock } from "@/components/ui";
import { CoordinatorView } from "@/components/coordinator/CoordinatorView";
import { saveLanguages, tabFrom, tabHref, withPending, type CoordinatorTab, type Pending } from "@/components/coordinator/coordinatorLogic";
import { homeFor } from "@/components/SignInForm";
import type { Session } from "@/lib/auth";
import type { Slot, Team } from "@/lib/types";

/**
 * The coordinator's page. A coordinator walks the pits: they set which
 * language each team is interviewed in, put a team into the queue, or book it
 * onto a slot. They never advance an interview, never see notes, scores or
 * messages, and can change nothing a team already holds -- that is the queue
 * desk's.
 *
 * What is drawn is in components/coordinator/CoordinatorView.tsx (direction B,
 * "Teams + Slots", design/coordinator-redesign/). This page keeps the polling
 * and every write. The tab is in the URL (?tab=slots) so a reload keeps it.
 */
export default function CoordinatorPage() {
  return (
    <Suspense fallback={<p className="p-10 text-center text-ink-faint">Loading…</p>}>
      <Coordinator />
    </Suspense>
  );
}

function Coordinator() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = tabFrom(params.get("tab"));
  const { state, online, refresh } = useAppState(4000);
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  const [query, setQuery] = useState("");
  const [division, setDivision] = useState("");
  const [notAskedOnly, setNotAskedOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [panelPick, setPanelPick] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  /** Languages tapped and sent but not yet confirmed, by team: the chip shows them at once. */
  const [pending, setPending] = useState<Pending>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    call<{ session: Session | null }>("/api/session", { method: "GET" })
      .then(({ session }) => {
        if (!session) {
          router.replace("/coordinator/login");
          return;
        }
        // The Judge Advisor may do all of it; the other roles have a console of their own.
        if (session.role !== "coordinator" && session.role !== "admin") {
          router.replace(homeFor(session.role));
          return;
        }
        setSession(session);
      })
      .catch(() => router.replace("/coordinator/login"));
  }, [router]);

  const teams = useMemo(() => withPending(state.teams, pending), [state.teams, pending]);

  const clearNotes = () => {
    setError(null);
    setOk(null);
  };

  function goTab(next: CoordinatorTab) {
    clearNotes();
    router.replace(tabHref(next));
  }

  /**
   * A poll already under way may have started before the write landed and
   * answer with the old value; asking twice means one began after it, so a
   * chip does not fall back for a moment before settling.
   */
  async function refreshAfterWrite() {
    await refresh();
    await refresh();
  }

  const saveTeamLanguages = (team: Team, next: string[]) => {
    clearNotes();
    return saveLanguages(team.id, next, {
      send: (body) => call("/api/team-language", { method: "PATCH", body }),
      setPending,
      refresh: refreshAfterWrite,
      onError: setError,
    });
  };

  /** `done` is what the banner says; `after` runs only if the server accepted it. */
  async function submit(body: Record<string, unknown>, done: string, after: () => void) {
    setBusy(true);
    clearNotes();
    try {
      await call("/api/requests", { body });
      setOk(done);
      after();
      await refreshAfterWrite();
    } catch (e) {
      // The server's own words, e.g. "Already booked — the queue desk can change it."
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const request = (team: Team, language: string) =>
    submit({ teamNumber: team.number, kind: "queue", language }, `Team ${team.number} added to the queue.`, () => setOpenId(null));

  const book = (team: Team, slot: Slot, language: string) =>
    submit(
      { teamNumber: team.number, kind: "slot", language, slotStart: slot.start, slotEnd: slot.end },
      `Team ${team.number} booked for ${formatClock(slot.start)}.`,
      () => {
        setPicked(null);
        setChosenId(null);
      },
    );

  function bookTime(team: Team) {
    setChosenId(team.id);
    setPanelPick(team.panel_id);
    setPicked(null);
    goTab("slots");
  }

  if (session === undefined) {
    return <p className="p-10 text-center text-ink-faint">Loading…</p>;
  }

  return (
    <CoordinatorView
      name={session?.name}
      online={online}
      teams={teams}
      panels={state.panels}
      requests={state.requests}
      languages={state.languages}
      divisions={state.divisions}
      tab={tab}
      onTab={goTab}
      query={query}
      onQuery={setQuery}
      division={division}
      onDivision={setDivision}
      notAskedOnly={notAskedOnly}
      onNotAskedOnly={setNotAskedOnly}
      openId={openId}
      onOpen={setOpenId}
      onLanguages={saveTeamLanguages}
      onRequest={request}
      onBookTime={bookTime}
      chosenId={chosenId}
      panelPick={panelPick}
      onPanelPick={(id) => {
        setPanelPick(id);
        setPicked(null);
      }}
      picked={picked}
      onPick={setPicked}
      onBook={book}
      busy={busy}
      error={error}
      ok={ok}
    />
  );
}
