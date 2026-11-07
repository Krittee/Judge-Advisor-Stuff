"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { call, useAppState } from "@/components/useAppState";
import { formatClock } from "@/components/ui";
import { CoordinatorView } from "@/components/coordinator/CoordinatorView";
import { tabFrom, type CoordinatorTab } from "@/components/coordinator/coordinatorLogic";
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

  const clearNotes = () => {
    setError(null);
    setOk(null);
  };

  function goTab(next: CoordinatorTab) {
    clearNotes();
    router.replace(next === "slots" ? "/coordinator?tab=slots" : "/coordinator");
  }

  /**
   * One write: busy while it is out, then one poll. `done` is what the banner
   * says; `after` runs only if the server accepted it. A chip lights when the
   * poll brings the saved list, as in the Judge Advisor's drawer.
   */
  async function run(write: () => Promise<unknown>, done?: string, after?: () => void) {
    setBusy(true);
    clearNotes();
    try {
      await write();
      if (done) setOk(done);
      after?.();
      await refresh();
    } catch (e) {
      // The server's own words, e.g. "Already booked — the queue desk can change it."
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const saveTeamLanguages = (team: Team, languages: string[]) =>
    run(() => call("/api/team-language", { method: "PATCH", body: { teamId: team.id, languages } }));

  const submit = (body: Record<string, unknown>, done: string, after: () => void) => run(() => call("/api/requests", { body }), done, after);

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
      teams={state.teams}
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
