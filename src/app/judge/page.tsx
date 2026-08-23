"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { buildSlots, liveRequestFor } from "@/lib/data";
import { NEXT_STATUS, STATUS_META, type Status } from "@/lib/status";
import { call, useAppState } from "@/components/useAppState";
import { compareTeamNumbers } from "@/lib/teamNumber";
import {
  Banner,
  Button,
  Elapsed,
  formatClock,
  StatusChip,
  TopBar,
} from "@/components/ui";
import type { Session } from "@/lib/auth";
import { NotesDrawer, SignOutButton } from "@/components/judging";
import type { RequestRow, Team } from "@/lib/types";

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
    return myTeams
      .map((team) => ({ team, request: liveRequestFor(team.id, state.requests) }))
      .sort((a, b) => {
        const ra = a.request ? STATUS_META[a.request.status].order : 90;
        const rb = b.request ? STATUS_META[b.request.status].order : 90;
        if (ra !== rb) return ra - rb;
        // Within a status, longest wait first — nobody gets forgotten.
        const ta = a.request?.requested_at ?? "";
        const tb = b.request?.requested_at ?? "";
        return ta.localeCompare(tb) || compareTeamNumbers(a.team.number, b.team.number);
      });
  }, [myTeams, state.requests]);

  const slots = useMemo(
    () => (panel ? buildSlots(panel, state.requests, state.teams) : []),
    [panel, state.requests, state.teams],
  );

  const completedCount = myTeams.filter((t) => {
    const r = state.requests.find((x) => x.team_id === t.id && x.status === "completed");
    return Boolean(r);
  }).length;

  async function advance(request: RequestRow, action = "advance", extra = {}) {
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
      setBusy(null);
    }
  }

  async function summon(team: Team) {
    setBusy(team.id);
    setError(null);
    try {
      await call("/api/requests", { body: { teamNumber: team.number, kind: "queue" } });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (session === undefined) {
    return <p className="p-10 text-center text-zinc-500">Loading…</p>;
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
        right={<SignOutButton />}
      />

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{panel?.name ?? "Your panel"}</h1>
            <p className="text-sm text-zinc-500">
              Signed in as {session?.name} · {completedCount}/{myTeams.length} interviewed
            </p>
          </div>
          {slots.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">
                Today&apos;s slots
              </summary>
              <ul className="mt-2 space-y-1 text-zinc-400">
                {slots.map((s) => (
                  <li key={s.start}>
                    {formatClock(s.start)} —{" "}
                    {s.takenBy ? `Team ${s.takenBy.teamNumber}` : "open"}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        {error ? (
          <Banner kind="error" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        ) : null}

        {!myTeams.length ? (
          <Banner kind="info">
            No teams are assigned to this panel yet. The Judge Advisor assigns them from the admin
            console.
          </Banner>
        ) : null}

        <ul className="space-y-3">
          {cards.map(({ team, request }) => (
            <li
              key={team.id}
              className={`rounded-2xl p-4 ring-1 ring-inset ${
                request?.status === "requested"
                  ? "bg-orange-500/10 ring-orange-500/40"
                  : "bg-white/[0.03] ring-white/10"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold tabular-nums">{team.number}</span>
                    {request ? <StatusChip status={request.status} size="sm" /> : null}
                  </div>
                  <div className="truncate text-zinc-300">{team.name}</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {team.pit ? `${team.pit} · ` : ""}
                    {request ? (
                      request.kind === "slot" && request.slot_start ? (
                        `Slot ${formatClock(request.slot_start)}`
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
                    <p className="mt-2 rounded-lg bg-black/30 px-3 py-2 text-sm text-zinc-300">
                      “{request.message}”
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setNotesFor(team)}>
                    Notes
                  </Button>

                  {request && NEXT_STATUS[request.status] ? (
                    <Button
                      variant={nextVariant(request.status)}
                      size="sm"
                      disabled={busy === request.id}
                      onClick={() => advance(request)}
                    >
                      {nextLabel(request.status)}
                    </Button>
                  ) : null}

                  {!request ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === team.id}
                      onClick={() => summon(team)}
                    >
                      Add to queue
                    </Button>
                  ) : null}

                  {request && request.status !== "completed" ? (
                    <button
                      onClick={() => advance(request, "cancel")}
                      disabled={busy === request.id}
                      className="text-xs text-zinc-500 hover:text-rose-400"
                    >
                      cancel
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
