"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildSlots, liveRequestFor } from "@/lib/data";
import { rubricsFor, totalFor } from "@/lib/rubrics";
import { NEXT_STATUS, STATUS_META, type Status } from "@/lib/status";
import { call, useAppState, useScores } from "@/components/useAppState";
import { compareTeamNumbers } from "@/lib/teamNumber";
import {
  Banner,
  BookingTime,
  Button,
  Elapsed,
  formatClock,
  StatusChip,
  TopBar,
} from "@/components/ui";
import type { Session } from "@/lib/auth";
import { NotesDrawer, SignOutButton } from "@/components/judging";
import { Rankings } from "@/components/Rankings";
import { TabBar } from "@/components/nav";
import { BandChip } from "@/components/BandChip";
import { CategoryChip } from "@/components/CategoryChip";
import { LanguageTag } from "@/components/Language";
import { FlagList, FlagSummary } from "@/components/Flags";
import type { RequestRow, ScoreRow, Team } from "@/lib/types";

/**
 * The judges' working screen. One panel's queue, oldest orange at the top,
 * with the single next action as the primary button on each card.
 */
export default function JudgePage() {
  const router = useRouter();
  const { state, online, refresh } = useAppState(4000);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<Team | null>(null);
  const [view, setView] = useState<"queue" | "scores">("queue");
  /* On for both views: the Scores tab ranks them, and the queue card shows
     each team's running total so a judge about to interview can see where
     the team already stands without leaving the queue. */
  const scoreData = useScores();

  useEffect(() => {
    call<{ session: Session | null }>("/api/session", { method: "GET" })
      .then(({ session }) => {
        if (!session || (session.role !== "judge" && session.role !== "admin")) {
          router.replace("/login");
          return;
        }
        setSession(session);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  const panelId = session?.role === "judge" ? session.panelId : null;
  const panel = state.panels.find((p) => p.id === panelId);

  const myTeams = useMemo(
    () => state.teams.filter((t) => t.panel_id === panelId),
    [state.teams, panelId],
  );

  const cards = useMemo(() => {
    const byTeam = new Map<string, ScoreRow[]>();
    for (const s of scoreData.scores) {
      byTeam.set(s.team_id, [...(byTeam.get(s.team_id) ?? []), s]);
    }

    return myTeams
      .map((team) => ({
        team,
        request: liveRequestFor(team.id, state.requests),
        /* Totalled against the rubrics this team's category is actually
           judged on -- an Ungraded notebook is unmarked, not zero -- so the
           number on the card reads the same as the one in the drawer and
           the rankings rather than being a third opinion. */
        score: totalFor(
          byTeam.get(team.id) ?? [],
          rubricsFor(scoreData.rubrics, team.category, state.categories),
        ),
      }))
      .sort((a, b) => {
        const ra = a.request ? STATUS_META[a.request.status].order : 90;
        const rb = b.request ? STATUS_META[b.request.status].order : 90;
        if (ra !== rb) return ra - rb;
        // Within a status, longest wait first — nobody gets forgotten.
        const ta = a.request?.requested_at ?? "";
        const tb = b.request?.requested_at ?? "";
        return ta.localeCompare(tb) || compareTeamNumbers(a.team.number, b.team.number);
      });
  }, [myTeams, state.requests, state.categories, scoreData.scores, scoreData.rubrics]);

  const slots = useMemo(
    () => (panel ? buildSlots(panel, state.requests, state.teams) : []),
    [panel, state.requests, state.teams],
  );

  const waitingCount = cards.filter(({ request }) => request?.status === "requested").length;

  const completedCount = myTeams.filter((t) => {
    const r = state.requests.find((x) => x.team_id === t.id && x.status === "completed");
    return Boolean(r);
  }).length;

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
        body: { action, ...extra },
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

  if (session === undefined) {
    return <p className="p-10 text-center text-ink-faint">Loading…</p>;
  }

  if (session?.role === "admin") {
    return (
      <>
        <TopBar title="Judge Queue" subtitle="Judge Advisor" online={online} />
        <main className="mx-auto max-w-lg px-5 py-10">
          <Banner kind="info">
            You are signed in as Judge Advisor. Use the{" "}
            <a href="/admin" className="underline">
              Judge Advisor console
            </a>{" "}
            to see every panel at once.
          </Banner>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar
        title="Judge Queue"
        subtitle={panel ? `${panel.name} · ${panel.division}` : undefined}
        online={online}
        role={state.viewer.role}
        current="/judge"
        right={<SignOutButton />}
      />

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{panel?.name ?? "Your panel"}</h1>
            <p className="text-sm text-ink-faint">
              Signed in as {session?.name} · {completedCount}/{myTeams.length} interviewed
            </p>
          </div>
          {slots.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-ink-subtle hover:text-ink">
                Today&apos;s slots
              </summary>
              <ul className="mt-2 space-y-1 text-ink-subtle">
                {slots.map((s) => (
                  <li key={s.start} className="flex items-center gap-2">
                    {/* Only a held slot counts down -- an open slot at 10:20
                        is not something anyone has to be anywhere for. */}
                    {s.takenBy ? (
                      <>
                        <BookingTime
                          slotStart={s.start}
                          status={s.takenBy.status}
                          size="sm"
                        />
                        <span>Team {s.takenBy.teamNumber}</span>
                      </>
                    ) : (
                      <>
                        <span className="tabular-nums">{formatClock(s.start)}</span>
                        <span className="text-ink-faint">open</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        {/* The same tab component the Judge Advisor's console uses, with
            the same badge rule: the count is how many teams on this panel
            are stood waiting right now. */}
        <div className="border-b border-line">
          <TabBar
            label="Judge views"
            active={view}
            onSelect={setView}
            items={[
              { id: "queue", label: "Queue", count: waitingCount, urgent: waitingCount > 0 },
              { id: "scores", label: "Scores" },
            ]}
          />
        </div>

        {error ? (
          <Banner kind="error" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        ) : null}

        {view === "scores" ? (
          <Rankings
            teams={myTeams}
            categories={state.categories}
            scores={scoreData.scores}
            rubricList={scoreData.rubrics}
            loaded={scoreData.loaded}
            error={scoreData.error}
            onOpenTeam={setNotesFor}
            /* Conduct here too: a judge ranking their own panel is asking
               the same question the Judge Advisor asks at deliberation.
               No click-through -- the wording is already on the queue card,
               and judges have no referee tab to send them to. */
            flags={state.flags}
            flagKinds={state.flagKinds}
          />
        ) : null}

        {view === "queue" && !myTeams.length ? (
          <Banner kind="info">
            No teams are assigned to this panel yet. The Judge Advisor assigns them from the admin
            console.
          </Banner>
        ) : null}

        <ul className={`space-y-3 ${view === "queue" ? "" : "hidden"}`}>
          {cards.map(({ team, request, score }) => (
            <li
              key={team.id}
              className={`rounded-2xl p-4 ring-1 ring-inset ${
                request?.status === "requested"
                  ? "bg-waiting/12 ring-waiting/45"
                  : "bg-surface ring-line"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {/* Wraps: on a narrow phone the number, category, language
                      and a long status label do not fit on one line. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="text-2xl font-bold tabular-nums">{team.number}</span>
                    <CategoryChip category={team.category} categories={state.categories} />
                    {request ? (
                      <>
                        <LanguageTag
                          language={request.language}
                          languages={state.languages}
                          size="md"
                        />
                        <StatusChip status={request.status} size="sm" />
                      </>
                    ) : null}
                    {/* What a referee saw. On the header because it should
                        reach the judge before they start, not after. */}
                    <FlagSummary
                      flags={state.flags.filter((f) => f.team_id === team.id)}
                      kinds={state.flagKinds}
                    />
                    {/* Where the team already stands, for a judge about to
                        interview them. Read-only: scoring is still the
                        rubric sheet in the drawer, and this is the one
                        number those sheets add up to. */}
                    {score.max > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-sm tabular-nums text-ink-subtle">
                          <span className="font-semibold text-ink">{score.total}</span>/
                          {score.max}
                        </span>
                        <BandChip total={score.total} max={score.max} scored={score.scored} />
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-ink-muted">{team.name}</div>
                  <div className="mt-1 text-xs text-ink-faint">
                    {team.pit ? `${team.pit} · ` : ""}
                    {request ? (
                      request.kind === "slot" && request.slot_start ? (
                        <BookingTime
                          slotStart={request.slot_start}
                          status={request.status}
                          size="sm"
                          label={request.status === "scheduled" ? "Booked" : "Slot"}
                        />
                      ) : (
                        <>
                          waiting <Elapsed since={request.requested_at} />
                        </>
                      )
                    ) : (
                      "no request yet"
                    )}
                  </div>
                  {request?.message ? (
                    <p className="mt-2 rounded-lg bg-sunken px-3 py-2 text-sm text-ink-muted">
                      “{request.message}”
                    </p>
                  ) : null}
                  {state.flags.some((f) => f.team_id === team.id) ? (
                    <div className="mt-2">
                      <FlagList
                        flags={state.flags.filter((f) => f.team_id === team.id)}
                        kinds={state.flagKinds}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setNotesFor(team)}>
                    Notes
                  </Button>
                  {/* The label changes, not just the colour: a disabled
                      button on venue wifi reads as a dead button, which is
                      what had judges tapping again. `busy` is keyed by the
                      row being written, so the second tap has nothing to
                      submit to. */}
                  {request && NEXT_STATUS[request.status] ? (
                    <Button
                      variant={nextVariant(request.status)}
                      size="sm"
                      disabled={busy === request.id}
                      onClick={() => advance(request)}
                    >
                      {busy === request.id ? "Saving…" : nextLabel(request.status)}
                    </Button>
                  ) : null}

                  {!request ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === team.id}
                      onClick={() => summon(team)}
                    >
                      {busy === team.id ? "Adding…" : "Add to queue"}
                    </Button>
                  ) : null}

                  {request && request.status !== "completed" ? (
                    <button
                      onClick={() => advance(request, "cancel")}
                      disabled={busy === request.id}
                      className="text-xs text-ink-faint hover:text-danger-quiet disabled:text-ink-faint"
                    >
                      {busy === request.id ? "…" : "cancel"}
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </main>

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

function nextLabel(status: Status): string {
  const next = NEXT_STATUS[status];
  if (next === "acknowledged") return "On our way";
  if (next === "interviewing") return "Start interview";
  if (next === "completed") return "Finish";
  return "Advance";
}

function nextVariant(status: Status): "primary" | "success" | "warn" {
  const next = NEXT_STATUS[status];
  if (next === "completed") return "success";
  if (next === "acknowledged") return "warn";
  return "primary";
}
