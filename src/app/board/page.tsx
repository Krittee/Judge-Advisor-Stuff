"use client";

import { useMemo, useState } from "react";
import { STATUS_META, type Status } from "@/lib/status";
import { useAppState } from "@/components/useAppState";
import { ConnectionDot, Elapsed, StatusLegend } from "@/components/ui";
import type { PublicPanel, RequestRow, Team } from "@/lib/types";

/**
 * Big-screen board. Meant for a TV in the judges' room, read from three
 * metres away. No interaction beyond one fullscreen button — anything a
 * passer-by could click is a liability on a shared screen.
 */
export default function BoardPage() {
  const { state, online } = useAppState(6000);
  const [hideDone, setHideDone] = useState(false);

  const byPanel = useMemo(() => groupByPanel(state.panels, state.teams, state.requests), [state]);

  const waiting = state.requests.filter((r) => r.status === "requested").length;
  const active = state.requests.filter((r) => r.status === "interviewing").length;
  const done = state.requests.filter((r) => r.status === "completed").length;

  return (
    <main className="min-h-screen px-6 py-5">
      <header className="mb-6 flex flex-wrap items-end gap-x-8 gap-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Judging Board</h1>

        <div className="flex gap-6 text-sm">
          <Tally label="Waiting" value={waiting} tone="text-orange-400" />
          <Tally label="In interview" value={active} tone="text-violet-400" />
          <Tally label="Complete" value={done} tone="text-emerald-400" />
        </div>

        <div className="ml-auto flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
              className="h-4 w-4 accent-indigo-500"
            />
            Hide completed
          </label>
          <ConnectionDot online={online} />
          <button
            onClick={() => document.documentElement.requestFullscreen?.()}
            className="rounded-lg bg-white/5 px-3 py-1.5 text-sm text-zinc-300 ring-1 ring-inset ring-white/10 hover:bg-white/10"
          >
            Fullscreen
          </button>
        </div>
      </header>

      <StatusLegend className="mb-6" />

      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        {byPanel.map(({ panel, teams }) => (
          <section
            key={panel?.id ?? "unassigned"}
            className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/10"
          >
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-xl font-semibold">{panel?.name ?? "Unassigned"}</h2>
              <span className="text-sm text-zinc-500">
                {panel?.room ? `${panel.room} · ` : ""}
                {teams.length} team{teams.length === 1 ? "" : "s"}
              </span>
            </div>

            {panel?.judges.length ? (
              <p className="mb-3 text-sm text-zinc-500">{panel.judges.join(" · ")}</p>
            ) : null}

            <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))]">
              {teams
                .filter((t) => !hideDone || t.status !== "completed")
                .map((t) => (
                  <TeamTile key={t.team.id} {...t} />
                ))}
            </div>
          </section>
        ))}
      </div>

      {!state.teams.length ? (
        <p className="mt-16 text-center text-zinc-500">
          No teams imported yet. Sign in as Judge Advisor to add them.
        </p>
      ) : null}
    </main>
  );
}

function TeamTile({
  team,
  status,
  since,
}: {
  team: Team;
  status: Status | null;
  since: string | null;
}) {
  const meta = status ? STATUS_META[status] : null;

  return (
    <div
      className={`rounded-xl px-3 py-2.5 ${
        meta ? meta.tile : "bg-white/[0.04] text-zinc-400 ring-1 ring-white/10"
      } ${status === "requested" ? "pulse-waiting" : ""}`}
    >
      <div className="text-2xl font-bold leading-tight tabular-nums">{team.number}</div>
      <div className="truncate text-sm opacity-90" title={team.name}>
        {team.name}
      </div>
      <div className="mt-1 text-xs font-medium opacity-80">
        {meta ? meta.short : "Not yet"}
        {since && status && status !== "completed" ? (
          <>
            {" · "}
            <Elapsed since={since} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function Tally({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
}

type TileData = { team: Team; status: Status | null; since: string | null };

/** Every team appears exactly once, showing its most relevant request. */
function groupByPanel(panels: PublicPanel[], teams: Team[], requests: RequestRow[]) {
  const best = new Map<string, RequestRow>();
  for (const r of requests) {
    const existing = best.get(r.team_id);
    if (!existing || rank(r.status) < rank(existing.status)) best.set(r.team_id, r);
  }

  const toTile = (team: Team): TileData => {
    const r = best.get(team.id);
    if (!r || r.status === "cancelled") return { team, status: null, since: null };
    return {
      team,
      status: r.status,
      since: r.started_at ?? r.acknowledged_at ?? r.requested_at,
    };
  };

  const sortTiles = (a: TileData, b: TileData) => {
    const ra = a.status ? STATUS_META[a.status].order : 99;
    const rb = b.status ? STATUS_META[b.status].order : 99;
    return ra - rb || a.team.number - b.team.number;
  };

  const groups = panels.map((panel) => ({
    panel,
    teams: teams.filter((t) => t.panel_id === panel.id).map(toTile).sort(sortTiles),
  }));

  const orphans = teams.filter((t) => !t.panel_id).map(toTile).sort(sortTiles);
  if (orphans.length) groups.push({ panel: null as unknown as PublicPanel, teams: orphans });

  return groups;
}

/** Lower rank wins when a team has more than one request on record. */
function rank(status: Status): number {
  return { requested: 0, acknowledged: 1, interviewing: 2, scheduled: 3, completed: 4, cancelled: 5 }[
    status
  ];
}
