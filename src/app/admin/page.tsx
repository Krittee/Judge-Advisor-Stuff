"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { liveRequestFor } from "@/lib/data";
import { AdminFrame, railCounts, type AdminTab as Tab } from "@/components/admin/AdminFrame";
import { ConflictsTab } from "@/components/admin/ConflictsTab";
import { FloorTab } from "@/components/admin/FloorTab";
import { ImportTab } from "@/components/admin/ImportTab";
import { PanelsTab } from "@/components/admin/PanelsTab";
import { RefereeTab } from "@/components/admin/RefereeTab";
import { TeamsTab } from "@/components/admin/TeamsTab";
import { call, useAppState, useScores } from "@/components/useAppState";
import { Banner, formatClock } from "@/components/ui";
import { NotesDrawer } from "@/components/judging";
import { Rankings } from "@/components/Rankings";
import type { Session } from "@/lib/auth";
import type { ActivityRow, Team } from "@/lib/types";

/** The Judge Advisor's console: every panel at once, and the tools to unstick it. */
export default function AdminPage() {
  const router = useRouter();
  const { state, online, refresh } = useAppState(4000);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("floor");
  const [error, setError] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<Team | null>(null);
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
  const counts = railCounts(state);

  return (
    <>
      <AdminFrame
        name={session?.name}
        online={online}
        tab={tab}
        counts={counts}
        onTab={(id) => {
          // A marked judge or team belongs to the trip you took to see it.
          if (id !== tab) setFocusJudge(null);
          if (id !== tab) setFocusFlagTeam(null);
          setTab(id);
        }}
      >
        {/* The redesigned tabs fill the width the rail leaves; the older ones keep the width and padding they had. */}
        <div className={tab === "floor" || tab === "conflicts" || tab === "panels" || tab === "flags" || tab === "teams" || tab === "import" ? "ja-pad" : "mx-auto max-w-7xl px-4 py-5"}>
          {error ? (
            <div className="mb-4">
              <Banner kind="error" onDismiss={() => setError(null)}>
                {error}
              </Banner>
            </div>
          ) : null}

          {tab === "floor" ? (
            <FloorTab state={state} refresh={refresh} onError={setError} onNotes={setNotesFor} />
          ) : null}
          {tab === "scores" ? (
            <Rankings
              teams={state.teams}
              categories={state.categories}
              scores={scoreData.scores}
              rubricList={scoreData.rubrics}
              loaded={scoreData.loaded}
              error={scoreData.error}
              panelName={Object.fromEntries(state.panels.map((p) => [p.id, p.name]))}
              onOpenTeam={setNotesFor}
              flags={state.flags}
              flagKinds={state.flagKinds}
              onOpenFlags={(team) => {
                setFocusFlagTeam(team.id);
                setTab("flags");
              }}
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
          {tab === "log" ? <ActivityTab /> : null}
        </div>
      </AdminFrame>

      {notesFor ? (
        <NotesDrawer
          team={notesFor}
          requestId={liveRequestFor(notesFor.id, state.requests)?.id ?? null}
          categories={state.categories}
          onClose={() => setNotesFor(null)}
        />
      ) : null}
    </>
  );
}

/* ==================================================================== */
/* Activity — who did what, for when the floor gets confusing            */
/* ==================================================================== */

function ActivityTab() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      call<{ activity: ActivityRow[] }>("/api/admin/activity", { method: "GET" })
        .then(({ activity }) => {
          setRows(activity);
          // A later success is the recovery; without this the banner from
          // one dropped poll stayed up, hiding the log, for good.
          setError(null);
        })
        .catch((e) => setError((e as Error).message));
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  if (error) return <Banner kind="error">{error}</Banner>;

  return (
    <ul className="divide-y divide-line rounded-xl ring-1 ring-inset ring-line">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
          <span className="w-20 shrink-0 text-ink-faint">{formatClock(r.created_at)}</span>
          <span className="w-48 shrink-0 truncate text-ink-subtle">{r.actor}</span>
          <span className="text-ink">{r.action}</span>
          {r.detail ? <span className="text-ink-faint">{r.detail}</span> : null}
        </li>
      ))}
      {!rows.length ? (
        <li className="px-4 py-8 text-center text-sm text-ink-faint">Nothing logged yet.</li>
      ) : null}
    </ul>
  );
}
