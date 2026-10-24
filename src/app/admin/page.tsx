"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { liveRequestFor } from "@/lib/data";
import { ActivityTab } from "@/components/admin/ActivityTab";
import { AdminFrame, railCounts, type AdminTab as Tab } from "@/components/admin/AdminFrame";
import { AwardsTab } from "@/components/admin/AwardsTab";
import { decidedText, pickDivision } from "@/components/admin/awardsLogic";
import { ConflictsTab } from "@/components/admin/ConflictsTab";
import { FloorTab } from "@/components/admin/FloorTab";
import { ImportTab } from "@/components/admin/ImportTab";
import { PanelsTab } from "@/components/admin/PanelsTab";
import { RefereeTab } from "@/components/admin/RefereeTab";
import { ScoresTab } from "@/components/admin/ScoresTab";
import { scoredText } from "@/components/admin/scoresLogic";
import { TeamsTab } from "@/components/admin/TeamsTab";
import { useAwards } from "@/components/admin/useAwards";
import { useConfirm } from "@/components/ConfirmDialog";
import { TeamSheet } from "@/components/judge/TeamSheet";
import { call, useAppState, useScores } from "@/components/useAppState";
import { Banner } from "@/components/ui";
import type { Session } from "@/lib/auth";
import { rankTeams } from "@/lib/ranking";

/** The Judge Advisor's console: every panel at once, and the tools to unstick it. */
export default function AdminPage() {
  const router = useRouter();
  const { state, online, refresh } = useAppState(4000);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("floor");
  const [error, setError] = useState<string | null>(null);
  /* The team whose sheet (notes, scores, flags) is open: the judge console's
     TeamSheet, opened from Scores, Floor's Notes and the Teams drawer. */
  const [sheetId, setSheetId] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();
  /* Set when the Conduct column on Scores sends you to a team's flags, so
     the Referee tab knows which one to scroll to and mark. */
  const [focusFlagTeam, setFocusFlagTeam] = useState<string | null>(null);
  /* Likewise the "N conflicts" pill on a judge's row in Panels: the Conflicts
     tab opens with that judge selected. */
  const [focusJudge, setFocusJudge] = useState<string | null>(null);
  /* Only while the Scores tab is open: nothing else on this console reads
     rubric totals, so polling for them behind the other five tabs would
     be a request every 15 seconds that nothing renders. */
  const scoreData = useScores({ enabled: tab === "scores" });
  /* Winners are not in /api/state (they stay secret until the ceremony), so the
     rail's "3/11" comes from here: asked on every section, and only once the
     session is known to be the Judge Advisor's. The division it counts is the
     one the Awards board has open. */
  const awards = useAwards({ enabled: Boolean(session) });
  const [awardDivision, setAwardDivision] = useState<string | null>(null);
  /* Ranked once, by the same rankTeams the judge console uses, and only while
     Scores is open: no other tab reads it. */
  const ranked = useMemo(
    () => (tab === "scores" ? rankTeams(state.teams, scoreData.scores, scoreData.rubrics, state.categories) : []),
    [tab, state.teams, scoreData.scores, scoreData.rubrics, state.categories],
  );

  useEffect(() => {
    call<{ session: Session | null }>("/api/session", { method: "GET" })
      .then(({ session }) => {
        if (session?.role !== "admin") {
          router.replace("/admin/login");
          return;
        }
        setSession(session);
      })
      .catch(() => router.replace("/admin/login"));
  }, [router]);

  if (session === undefined) {
    return <p className="p-10 text-center text-ink-faint">Loading…</p>;
  }

  /* The shell orders the sections by the Judge Advisor's day rather than
     alphabetically, and groups them: what is happening now, then the roster
     behind it, then the record of both. The counts are what turn eight
     words into something you can triage -- "Conflicts" says nothing,
     "Conflicts 2" sends you there. Floor's is only the teams actually
     waiting, Conflicts' only the judges' (older whole-panel entries are not
     counted); a total that is merely large is not a reason to look. */
  const division = pickDivision(awardDivision, state.divisions, awards.data?.nominations ?? [], state.teams);
  const counts = {
    ...railCounts(state),
    ...(awards.data?.awards.length ? { awards: decidedText(awards.data.winners, awards.data.awards, division) } : {}),
  };
  const sheetTeam = state.teams.find((t) => t.id === sheetId) ?? null;

  return (
    <>
      <AdminFrame
        name={session?.name}
        online={online}
        tab={tab}
        counts={counts}
        scoredNote={tab === "scores" && scoreData.loaded && !scoreData.error ? scoredText(ranked) : undefined}
        onTab={(id) => {
          // A marked judge or team belongs to the trip you took to see it.
          if (id !== tab) setFocusJudge(null);
          if (id !== tab) setFocusFlagTeam(null);
          setTab(id);
        }}
      >
        {/* The redesigned tabs fill the width the rail leaves; the older ones keep the width and padding they had. */}
        <div className={tab === "floor" || tab === "conflicts" || tab === "panels" || tab === "flags" || tab === "teams" || tab === "import" || tab === "awards" || tab === "scores" || tab === "log" ? "ja-pad" : "mx-auto max-w-7xl px-4 py-5"}>
          {error ? (
            <div className="mb-4">
              <Banner kind="error" onDismiss={() => setError(null)}>
                {error}
              </Banner>
            </div>
          ) : null}

          {tab === "floor" ? (
            <FloorTab state={state} refresh={refresh} onError={setError} onNotes={(team) => setSheetId(team.id)} />
          ) : null}
          {tab === "scores" ? (
            <ScoresTab
              ranked={ranked}
              state={state}
              rubricList={scoreData.rubrics}
              loaded={scoreData.loaded}
              error={scoreData.error}
              sheetId={sheetId}
              onOpenTeam={(team) => setSheetId(team.id)}
              onOpenFlags={(team) => {
                setFocusFlagTeam(team.id);
                setTab("flags");
              }}
            />
          ) : null}
          {tab === "awards" ? (
            <AwardsTab
              state={state}
              data={awards.data}
              error={awards.error}
              reload={awards.reload}
              division={division}
              onDivision={setAwardDivision}
              onError={setError}
            />
          ) : null}
          {tab === "teams" ? (
            <TeamsTab
              state={state}
              refresh={refresh}
              onError={setError}
              onOpenFlags={(teamId) => {
                setFocusFlagTeam(teamId);
                setTab("flags");
              }}
              onOpenSheet={setSheetId}
            />
          ) : null}
          {tab === "panels" ? (
            <PanelsTab
              state={state}
              refresh={refresh}
              onError={setError}
              onOpenConflicts={(judgeId) => {
                setFocusJudge(judgeId);
                setTab("conflicts");
              }}
            />
          ) : null}
          {tab === "conflicts" ? (
            <ConflictsTab state={state} refresh={refresh} onError={setError} focusJudgeId={focusJudge} />
          ) : null}
          {tab === "flags" ? (
            <RefereeTab
              state={state}
              refresh={refresh}
              onError={setError}
              focusTeamId={focusFlagTeam}
              adminName={session?.name}
            />
          ) : null}
          {tab === "import" ? (
            <ImportTab refresh={refresh} onError={setError} divisions={state.divisions} />
          ) : null}
          {tab === "log" ? <ActivityTab state={state} onOpenSheet={setSheetId} /> : null}
        </div>

        {/* Inside the frame, so the sheet gets the .admin tokens its styles read (--jg-field and the rest). */}
        <TeamSheet
          team={sheetTeam}
          request={sheetTeam ? liveRequestFor(sheetTeam.id, state.requests) : null}
          categories={state.categories}
          languages={state.languages}
          flags={state.flags}
          flagKinds={state.flagKinds}
          ask={ask}
          onClose={() => {
            setSheetId(null);
            // Scores shows the totals the sheet just wrote; its own poll is up to 15 s away.
            if (tab === "scores") scoreData.reload();
          }}
        />
        {dialog}
      </AdminFrame>
    </>
  );
}
