"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildSlots, liveRequestFor } from "@/lib/data";
import { completedTeamIds, type QueueCard } from "@/lib/judgeQueue";
import { rankTeams } from "@/lib/ranking";
import { call, useAppState, useScores } from "@/components/useAppState";
import { useConfirm } from "@/components/ConfirmDialog";
import { Banner } from "@/components/ui";
import { JudgeFrame } from "@/components/judge/JudgeFrame";
import { QueueTab } from "@/components/judge/QueueTab";
import { ScoresTab } from "@/components/judge/ScoresTab";
import { TeamSheet } from "@/components/judge/TeamSheet";
import { TodayTab } from "@/components/judge/TodayTab";
import { cancelAfterAsking, type JudgeTab } from "@/components/judge/logic";
import type { Session } from "@/lib/auth";
import type { RequestRow, Team } from "@/lib/types";

/**
 * The judges' working screen ("Up next"): one panel's queue with whoever is
 * next as the hero card, the single next action as its primary button, and
 * the Scores and Today tabs behind it. The chrome is JudgeFrame; the tabs and
 * the team sheet are in src/components/judge/.
 */
export default function JudgePage() {
  const router = useRouter();
  const { state, loaded, online, refresh } = useAppState(4000);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [tab, setTab] = useState<JudgeTab>("queue");
  const { ask, dialog } = useConfirm();
  /* On for every tab: the Scores tab ranks them, and the hero card shows each
     team's running total so a judge about to interview can see where the team
     already stands without leaving the queue. */
  const scoreData = useScores();

  // The waits, "in 4 min" and the Today rule read the clock when they draw;
  // this draws the screen again every 30 s so they do not go stale between polls.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const now = Date.now();

  useEffect(() => {
    call<{ session: Session | null }>("/api/session", { method: "GET" })
      .then(({ session }) => {
        if (!session || (session.role !== "judge" && session.role !== "admin")) {
          router.replace("/judge/login");
          return;
        }
        setSession(session);
      })
      .catch(() => router.replace("/judge/login"));
  }, [router]);

  const panelId = session?.role === "judge" ? session.panelId : null;
  const panel = state.panels.find((p) => p.id === panelId);

  const myTeams = useMemo(
    () => state.teams.filter((t) => t.panel_id === panelId),
    [state.teams, panelId],
  );

  /* Ranked once, for the Scores tab and for the total on each card. Totalled
     against the rubrics this team's category is actually judged on -- an
     Ungraded notebook is unmarked, not zero -- so the number on the card reads
     the same as the one in the sheet and the rankings. */
  const ranked = useMemo(
    () => rankTeams(myTeams, scoreData.scores, scoreData.rubrics, state.categories),
    [myTeams, scoreData.scores, scoreData.rubrics, state.categories],
  );

  const cards = useMemo<QueueCard[]>(
    () =>
      ranked.map(({ team, total, max, scored }) => ({
        team,
        request: liveRequestFor(team.id, state.requests),
        score: { total, max, scored },
      })),
    [ranked, state.requests],
  );

  const completed = useMemo(() => completedTeamIds(state.requests), [state.requests]);
  const interviewed = myTeams.filter((t) => completed.has(t.id)).length;
  const waiting = cards.filter(({ request }) => request?.status === "requested").length;

  const slots = useMemo(
    () => (panel ? buildSlots(panel, state.requests, state.teams) : []),
    [panel, state.requests, state.teams],
  );

  /**
   * Rows with a write already in the air.
   *
   * A ref, not the `busy` state, because `busy` only stops a second tap
   * once React has re-rendered the button as disabled -- and the taps that
   * cause this arrive faster than that, from a judge who thinks the first
   * one missed. Advance walks a status machine, so a duplicate does not
   * merely repeat: it steps the team an extra place, from "on our way"
   * straight past "interviewing". Checked and claimed synchronously here,
   * so the second tap has already lost by the time it calls anything.
   */
  const writing = useRef(new Set<string>());

  async function advance(request: RequestRow, action = "advance", extra = {}) {
    if (writing.current.has(request.id)) return;
    writing.current.add(request.id);
    setBusy(request.id);
    setError(null);
    try {
      await call(`/api/requests/${request.id}`, {
        method: "PATCH",
        // `from`: the status this card is showing. If another screen has
        // moved the request on since, the server refuses (409) rather than
        // advancing it a second time from under whoever got there first.
        body: { action, from: request.status, ...extra },
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      writing.current.delete(request.id);
      setBusy(null);
    }
  }

  async function summon(team: Team) {
    if (writing.current.has(team.id)) return;
    writing.current.add(team.id);
    setBusy(team.id);
    setError(null);
    try {
      await call("/api/requests", { body: { teamNumber: team.number, kind: "queue" } });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      writing.current.delete(team.id);
      setBusy(null);
    }
  }

  if (!session) {
    return <p className="p-10 text-center text-ink-faint">Loading…</p>;
  }

  if (session.role === "admin") {
    return (
      <JudgeFrame name={session.name} online={online} advisor>
        <p className="jg-note">
          You are signed in as Judge Advisor. Use the{" "}
          <a href="/admin" className="jg-link">
            Judge Advisor console
          </a>{" "}
          to see every panel at once.
        </p>
      </JudgeFrame>
    );
  }

  const sheetTeam = myTeams.find((t) => t.id === sheetId) ?? null;
  const open = (team: Team) => setSheetId(team.id);

  return (
    <JudgeFrame
      name={session.name}
      online={online}
      panel={panel ?? (session.role === "judge" ? { name: session.panelName, division: "" } : undefined)}
      interviewed={{ done: interviewed, total: myTeams.length }}
      tab={tab}
      onTab={setTab}
      waiting={waiting}
    >
      {error ? (
        <Banner kind="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      ) : null}

      {!loaded ? <p className="jg-empty">Loading…</p> : null}

      {loaded && tab === "queue" ? (
        <QueueTab
          cards={cards}
          completed={completed}
          categories={state.categories}
          languages={state.languages}
          flags={state.flags}
          flagKinds={state.flagKinds}
          now={now}
          busy={busy}
          onAdvance={(request) => advance(request)}
          onCancel={(team, request) => cancelAfterAsking(ask, team, () => advance(request, "cancel"))}
          onSummon={summon}
          onOpen={open}
        />
      ) : null}

      {loaded && tab === "scores" ? (
        <ScoresTab
          panelName={panel?.name ?? "Your panel"}
          rows={ranked}
          categories={state.categories}
          rubricList={scoreData.rubrics}
          loaded={scoreData.loaded}
          error={scoreData.error}
          /* Conduct here too: a judge ranking their own panel is asking the
             same question the Judge Advisor asks at deliberation. */
          flags={state.flags}
          flagKinds={state.flagKinds}
          onOpen={open}
        />
      ) : null}

      {loaded && tab === "today" && panel ? (
        <TodayTab
          panel={panel}
          slots={slots}
          teams={state.teams}
          panelTeams={myTeams}
          requests={state.requests}
          categories={state.categories}
          now={now}
          onOpen={open}
        />
      ) : null}

      <TeamSheet
        team={sheetTeam}
        request={sheetTeam ? liveRequestFor(sheetTeam.id, state.requests) : null}
        categories={state.categories}
        languages={state.languages}
        flags={state.flags}
        flagKinds={state.flagKinds}
        ask={ask}
        onClose={() => setSheetId(null)}
      />
      {dialog}
    </JudgeFrame>
  );
}
