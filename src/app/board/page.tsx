"use client";

import { useMemo, useState } from "react";
import { STATUS_META, type Status } from "@/lib/status";
import { useAppState } from "@/components/useAppState";
import { compareTeamNumbers } from "@/lib/teamNumber";
import { BookingTime, ConnectionDot, Elapsed, StatusLegend } from "@/components/ui";
import { CategoryDot, CategoryLegend } from "@/components/CategoryChip";
import { ConsoleLinks } from "@/components/nav";
import { PitMap } from "@/components/PitMap";
import type { PublicPanel, RequestRow, Team, TeamCategoryView } from "@/lib/types";

/**
 * Big-screen board. Meant for a TV in the judges' room, read from three
 * metres away. No interaction beyond one fullscreen button — anything a
 * passer-by could click is a liability on a shared screen.
 */
export default function BoardPage() {
  const { state, online } = useAppState(6000);
  const [hideDone, setHideDone] = useState(false);
  const [tab, setTab] = useState<"queue" | "pits">("queue");

  const byPanel = useMemo(() => groupByPanel(state.panels, state.teams, state.requests), [state]);

  const waiting = state.requests.filter((r) => r.status === "requested").length;
  const active = state.requests.filter((r) => r.status === "interviewing").length;
  const done = state.requests.filter((r) => r.status === "completed").length;

  return (
    <main className="board min-h-screen px-[2vw] py-[1.5vh]">
      {/* The room reads the tiles; this row is for whoever set the screen
          up. It is deliberately the smallest thing here -- every pixel it
          takes is a pixel off the only content anyone is looking at from
          the back of the hall. */}
      <header className="mb-[1.5vh] flex flex-wrap items-center gap-x-6 gap-y-3">
        <h1 className="board-heading">Judging Board</h1>

        <div className="flex gap-0.5 rounded-lg bg-surface p-0.5 ring-1 ring-inset ring-line">
          {(
            [
              ["queue", "By panel"],
              ["pits", "Pit floor"],
            ] as ["queue" | "pits", string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                tab === id ? "bg-surface-2 text-ink" : "text-ink-subtle hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* The one number the board exists to show. A count of teams stood
            waiting is the reason anyone glances up, so it is set at the
            size of the thing it is about -- and it disappears entirely at
            zero rather than sitting there reading "0 waiting", which is
            the board quietly saying everything is fine. */}
        {waiting > 0 ? (
          <p className="flex items-baseline gap-2.5 rounded-xl bg-waiting px-3.5 py-1 text-waiting-ink">
            <span className="board-number leading-none">{waiting}</span>
            <span className="board-meta uppercase tracking-wide">
              waiting for a judge
            </span>
          </p>
        ) : (
          <p className="board-meta rounded-xl bg-surface px-3.5 py-2 uppercase tracking-wide text-ink-subtle ring-1 ring-inset ring-line">
            Nobody waiting
          </p>
        )}

        <div className="flex items-baseline gap-5 text-ink-subtle">
          <Tally label="In interview" value={active} tone="text-active-quiet" />
          <Tally label="Complete" value={done} tone="text-done-quiet" />
        </div>

        <div className="ml-auto flex items-center gap-3 text-sm">
          <label className="flex cursor-pointer items-center gap-2 text-ink-subtle">
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Hide completed
          </label>
          <ConnectionDot online={online} />
          {/* Whoever opened this on a laptop still has to get back. */}
          <ConsoleLinks role={state.viewer.role} current="/board" />
          <button
            onClick={() => document.documentElement.requestFullscreen?.()}
            className="rounded-lg bg-surface px-3 py-1.5 text-ink-muted ring-1 ring-inset ring-line transition hover:bg-surface-2"
          >
            Fullscreen
          </button>
        </div>
      </header>

      {/* Legends belong to setup, not to the room: collapsed by default so
          they cost one line instead of two, and still there for the first
          time somebody asks what violet means. */}
      <details className="mb-[1.5vh] text-sm">
        <summary className="inline-flex cursor-pointer text-ink-faint transition hover:text-ink-subtle">
          What the colours mean
        </summary>
        <div className="mt-2 flex flex-wrap items-center gap-x-8 gap-y-2">
          <StatusLegend />
          <CategoryLegend categories={state.categories} />
        </div>
      </details>

      {tab === "pits" ? <PitMap state={state} hideDone={hideDone} /> : null}

      {/* Panels size to their own content rather than to the tallest one,
          so a panel with three teams no longer leaves a half-screen of
          empty box next to a panel with twelve. */}
      <div
        className={`[column-fill:balance] gap-[1.4vw] [column-width:min(34rem,92vw)] ${
          tab === "queue" ? "" : "hidden"
        }`}
      >
        {byPanel.map(({ panel, teams }) => {
          const shown = teams.filter((t) => !hideDone || t.status !== "completed");
          return (
            <section
              key={panel?.id ?? "unassigned"}
              className="mb-[1.4vw] inline-block w-full break-inside-avoid rounded-xl bg-surface p-[0.9vw] ring-1 ring-inset ring-line"
            >
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="board-heading">{panel?.name ?? "Unassigned"}</h2>
                <span className="board-meta text-ink-faint">
                  {shown.length}/{teams.length}
                </span>
              </div>

              {/* Always say who is judging, even when nobody has been named
                  yet — a blank line reads as "no panel here" rather than
                  "nobody has filled this in". */}
              <p className="board-meta mb-2.5 font-normal text-ink-faint">
                {panel?.judges.length ? panel.judges.join(" · ") : <span className="italic">NA</span>}
              </p>

              <div className="grid gap-[0.5vw] [grid-template-columns:repeat(auto-fill,minmax(min(clamp(8rem,11vw,15rem),100%),1fr))]">
                {shown.map((t) => (
                  <TeamTile key={t.team.id} {...t} categories={state.categories} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {!state.teams.length ? (
        <p className="mt-16 text-center text-ink-faint">
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
  slotStart,
  categories,
}: {
  team: Team;
  status: Status | null;
  since: string | null;
  slotStart: string | null;
  categories: TeamCategoryView[];
}) {
  const meta = status ? STATUS_META[status] : null;

  return (
    <div
      className={`relative overflow-hidden rounded-lg px-[0.7vw] py-[0.5vw] ${
        meta
          ? meta.tile
          : /* Not in the queue yet: present but idle. Kept a step brighter
               than the faintest ink because a projector flattens contrast
               and this is still a team number somebody may need to find. */
            "bg-surface-2 text-ink-subtle ring-1 ring-inset ring-line"
      } ${status === "requested" ? "pulse-waiting" : ""}`}
    >
      <div className="board-number">{team.number}</div>
      <div className="mt-0.5 flex items-center gap-1.5">
        {/* A dot, not a stripe down the edge. The notebook category is the
            least urgent thing on this tile and it used to be the only one
            with a bar of solid colour to itself. */}
        <CategoryDot category={team.category} categories={categories} />
        <span className="board-name truncate opacity-90" title={team.name}>
          {team.name}
        </span>
      </div>
      <div className="board-meta mt-1 flex flex-wrap items-center gap-x-1 opacity-85">
        {meta ? meta.short : "Not yet"}
        {/* A booking's own clock time, not how long ago it was made: the
            tile used to read "Booked · 3h", which says nothing about when
            anyone is due. It turns orange as the slot comes up. */}
        {slotStart ? (
          <BookingTime slotStart={slotStart} status="scheduled" size="sm" />
        ) : since && status && status !== "completed" ? (
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
    <span className="flex items-baseline gap-1.5">
      <span className={`board-heading ${tone}`}>{value}</span>
      <span className="text-xs uppercase tracking-wide text-ink-faint">{label}</span>
    </span>
  );
}

type TileData = {
  team: Team;
  status: Status | null;
  since: string | null;
  /** Set only for a slot still being held, so the tile can count down. */
  slotStart: string | null;
};

/** Every team appears exactly once, showing its most relevant request. */
function groupByPanel(panels: PublicPanel[], teams: Team[], requests: RequestRow[]) {
  const best = new Map<string, RequestRow>();
  for (const r of requests) {
    const existing = best.get(r.team_id);
    if (!existing || rank(r.status) < rank(existing.status)) best.set(r.team_id, r);
  }

  const toTile = (team: Team): TileData => {
    const r = best.get(team.id);
    if (!r || r.status === "cancelled") {
      return { team, status: null, since: null, slotStart: null };
    }
    return {
      team,
      status: r.status,
      since: r.started_at ?? r.acknowledged_at ?? r.requested_at,
      slotStart: r.status === "scheduled" ? r.slot_start : null,
    };
  };

  const sortTiles = (a: TileData, b: TileData) => {
    const ra = a.status ? STATUS_META[a.status].order : 99;
    const rb = b.status ? STATUS_META[b.status].order : 99;
    return ra - rb || compareTeamNumbers(a.team.number, b.team.number);
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
