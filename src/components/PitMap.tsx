"use client";

import { useMemo } from "react";
import { STATUS_META, type Status } from "@/lib/status";
import { buildFloorPlan, comparePits, isMappablePit, parsePit } from "@/lib/pit";
import { CategoryRail } from "./CategoryChip";
import type { AppState, RequestRow, Team } from "@/lib/types";

/**
 * The pit floor, seen from above.
 *
 * Two things have to read at once from across a room, so they use
 * different channels rather than competing for the same one:
 *
 *   division  splits the floor into blocks, each with its own colour
 *   status    fills the pit tile itself, same colours as the queue board
 *
 * Pit codes are a letter and a number, so the letter is the row and the
 * number is the position along it. Nobody has to draw a plan.
 */

const DIVISION_TONES = [
  { ring: "ring-sky-500/40", head: "text-sky-300", dot: "bg-sky-400" },
  { ring: "ring-fuchsia-500/40", head: "text-fuchsia-300", dot: "bg-fuchsia-400" },
  { ring: "ring-teal-500/40", head: "text-teal-300", dot: "bg-teal-400" },
  { ring: "ring-orange-500/40", head: "text-orange-300", dot: "bg-orange-400" },
];

export function divisionTone(division: string, divisions: string[]) {
  const i = Math.max(0, divisions.indexOf(division));
  return DIVISION_TONES[i % DIVISION_TONES.length];
}

type Placed = { team: Team; status: Status | null };

export function PitMap({
  state,
  hideDone,
}: {
  state: AppState;
  hideDone: boolean;
}) {
  const placed = useMemo<Placed[]>(() => {
    const best = new Map<string, RequestRow>();
    for (const r of state.requests) {
      const current = best.get(r.team_id);
      if (!current || rank(r.status) < rank(current.status)) best.set(r.team_id, r);
    }

    return state.teams.map((team) => {
      const r = best.get(team.id);
      const status = !r || r.status === "cancelled" ? null : (r.status as Status);
      return { team, status };
    });
  }, [state.teams, state.requests]);

  const divisions = state.divisions;
  const unmapped = placed
    .filter((p) => !isMappablePit(p.team.pit))
    .sort((a, b) => a.team.number.localeCompare(b.team.number));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {divisions.map((d) => {
            const tone = divisionTone(d, divisions);
            return (
              <span key={d} className="flex items-center gap-1.5 text-zinc-400">
                <span className={`h-3 w-3 rounded-sm ${tone.dot}`} />
                {d}
              </span>
            );
          })}
        </span>
      </div>

      {divisions.map((division) => (
        <DivisionFloor
          key={division}
          division={division}
          divisions={divisions}
          placed={placed.filter((p) => p.team.division === division)}
          categories={state.categories}
          hideDone={hideDone}
        />
      ))}

      {unmapped.length ? (
        <section className="rounded-2xl bg-white/[0.02] p-4 ring-1 ring-inset ring-white/10">
          <h3 className="mb-2 text-sm font-semibold text-zinc-400">
            No pit on the plan ({unmapped.length})
          </h3>
          <p className="mb-3 text-xs text-zinc-600">
            These teams have no pit set, or one that is not a letter and a number like{" "}
            <code className="text-zinc-500">A1</code>.
          </p>
          <div className="flex flex-wrap gap-2">
            {unmapped.map(({ team, status }) => (
              <span
                key={team.id}
                className={`rounded-lg px-2 py-1 text-sm tabular-nums ${
                  status ? STATUS_META[status].tile : "bg-white/5 text-zinc-500"
                }`}
              >
                {team.number}
                {team.pit ? <span className="ml-1 opacity-70">({team.pit})</span> : null}
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DivisionFloor({
  division,
  divisions,
  placed,
  categories,
  hideDone,
}: {
  division: string;
  divisions: string[];
  placed: Placed[];
  categories: AppState["categories"];
  hideDone: boolean;
}) {
  const tone = divisionTone(division, divisions);
  const rows = useMemo(() => buildFloorPlan(placed, (p) => p.team.pit), [placed]);

  const mapped = placed.filter((p) => isMappablePit(p.team.pit));
  const waiting = mapped.filter((p) => p.status === "requested").length;

  if (!rows.length) return null;

  return (
    <section className={`rounded-2xl bg-white/[0.03] p-4 ring-2 ring-inset ${tone.ring}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className={`text-lg font-semibold ${tone.head}`}>{division}</h3>
        <span className="text-sm text-zinc-500">
          {mapped.length} pit{mapped.length === 1 ? "" : "s"}
          {waiting ? <span className="ml-2 text-orange-400">{waiting} waiting</span> : null}
        </span>
      </div>

      <div className="space-y-1.5 overflow-x-auto">
        {rows.map(({ row, cells, from, to }) => (
          <div key={row} className="flex items-stretch gap-1.5">
            <span
              className={`flex w-7 shrink-0 items-center justify-center rounded-md bg-white/5 text-sm font-bold ${tone.head}`}
            >
              {row}
            </span>
            {cells.map((cell, i) => (
              <PitCell
                key={i}
                position={i + 1}
                row={row}
                cell={cell}
                // Outside this division's span the pit belongs to another
                // division; it is spacing here, not an empty pit.
                outside={i + 1 < from || i + 1 > to}
                categories={categories}
                hideDone={hideDone}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function PitCell({
  row,
  position,
  cell,
  outside,
  categories,
  hideDone,
}: {
  row: string;
  position: number;
  cell: Placed | null;
  outside: boolean;
  categories: AppState["categories"];
  hideDone: boolean;
}) {
  // Another division's stretch of this row: hold the column so the rows
  // stay aligned, but say nothing about it.
  if (outside) {
    return <div className="min-w-[3.5rem] flex-1" aria-hidden />;
  }

  // An empty slot inside this division's span: a pit nobody occupies.
  if (!cell) {
    return (
      <div className="min-w-[3.5rem] flex-1 rounded-md border border-dashed border-white/[0.07] px-1 py-2 text-center">
        <span className="text-[10px] text-zinc-700">
          {row}
          {position}
        </span>
      </div>
    );
  }

  const { team, status } = cell;
  const show = status && !(hideDone && status === "completed") ? status : null;
  const meta = show ? STATUS_META[show] : null;

  return (
    <div
      title={`${row}${position} · ${team.number} ${team.name}${meta ? ` · ${meta.label}` : ""}`}
      className={`relative min-w-[3.5rem] flex-1 overflow-hidden rounded-md py-2 pl-2 pr-1 text-center ${
        meta ? meta.tile : "bg-white/[0.05] text-zinc-300 ring-1 ring-inset ring-white/10"
      } ${show === "requested" ? "pulse-waiting" : ""}`}
    >
      <CategoryRail category={team.category} categories={categories} />
      <div className="text-[10px] font-medium opacity-70">
        {row}
        {position}
      </div>
      <div className="truncate text-sm font-bold tabular-nums leading-tight">{team.number}</div>
    </div>
  );
}

/** Lower rank wins when a team has more than one request on record. */
function rank(status: string): number {
  return (
    { requested: 0, acknowledged: 1, interviewing: 2, scheduled: 3, completed: 4, cancelled: 5 }[
      status
    ] ?? 9
  );
}

export { comparePits, parsePit };
