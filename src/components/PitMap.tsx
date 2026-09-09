"use client";

import { useMemo } from "react";
import { STATUS_META, type Status } from "@/lib/status";
import { buildFloorPlan, comparePits, isMappablePit, parsePit } from "@/lib/pit";
import type { AppState, RequestRow, Team } from "@/lib/types";

/**
 * The pit floor, seen from above.
 *
 * One floor, not one per division: at a real event the two divisions are
 * interleaved across the same aisles, so splitting them into blocks would
 * draw a floor that does not exist. Colour tells them apart instead.
 *
 * Two channels, so they do not fight:
 *
 *   division  the ring around the tile, always present
 *   status    the tile fill, same colours as the queue board
 *
 * Notebook type is deliberately absent here. It matters in the judging
 * room, not when you are working out who is standing where, and a third
 * encoding on a tile this size costs more than it gives.
 *
 * Pit codes are a letter and a number, so the letter is a column and the
 * number is the position down it. Nobody has to draw a plan.
 *
 * Which way round it is drawn comes from config/event.json, because the
 * plan is a picture of a real room and rooms do not all run the same way.
 * Only the drawing flips — a pit is still A1 and still sorts as A1.
 */

const DIVISION_TONES = [
  { ring: "ring-sky-400", dot: "bg-sky-400", text: "text-sky-300" },
  { ring: "ring-fuchsia-400", dot: "bg-fuchsia-400", text: "text-fuchsia-300" },
  { ring: "ring-teal-400", dot: "bg-teal-400", text: "text-teal-300" },
  { ring: "ring-orange-300", dot: "bg-orange-300", text: "text-orange-200" },
];

export function divisionTone(division: string, divisions: string[]) {
  const i = Math.max(0, divisions.indexOf(division));
  return DIVISION_TONES[i % DIVISION_TONES.length];
}

type Placed = { team: Team; status: Status | null };

export function PitMap({ state, hideDone }: { state: AppState; hideDone: boolean }) {
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

  // One grid across the whole floor, both divisions together, then turned
  // to face the way the hall actually does.
  const columns = useMemo(() => {
    const plan = buildFloorPlan(placed, (p) => p.team.pit);
    const facing = state.pitFloor.columns === "right-to-left" ? [...plan].reverse() : plan;

    if (state.pitFloor.rows === "bottom-to-top") {
      // Reverse the cells but keep each one's real position, so the tile
      // still says A1 wherever A1 has ended up on screen.
      return facing.map((col) => ({
        ...col,
        numbered: col.cells.map((cell, i) => ({ cell, position: i + 1 })).reverse(),
      }));
    }
    return facing.map((col) => ({
      ...col,
      numbered: col.cells.map((cell, i) => ({ cell, position: i + 1 })),
    }));
  }, [placed, state.pitFloor]);

  const mapped = placed.filter((p) => isMappablePit(p.team.pit));
  const unmapped = placed
    .filter((p) => !isMappablePit(p.team.pit))
    .sort((a, b) => a.team.number.localeCompare(b.team.number));

  const perDivision = state.divisions.map((d) => ({
    division: d,
    tone: divisionTone(d, state.divisions),
    total: mapped.filter((p) => p.team.division === d).length,
    waiting: mapped.filter((p) => p.team.division === d && p.status === "requested").length,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {perDivision.map(({ division, tone, total, waiting }) => (
          <span key={division} className="flex items-center gap-2">
            <span className={`h-3 w-3 rounded-sm ${tone.dot}`} />
            <span className={tone.text}>{division}</span>
            <span className="text-zinc-500">
              {total} pit{total === 1 ? "" : "s"}
              {waiting ? <span className="ml-1.5 text-orange-400">{waiting} waiting</span> : null}
            </span>
          </span>
        ))}
      </div>

      {columns.length ? (
        <section className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/10">
          <div className="flex flex-wrap gap-2">
            {columns.map(({ row, numbered }) => (
              // Compress to fit rather than wrapping a lone aisle onto its
              // own line, but never stretch past a pit's worth of width.
              <div
                key={row}
                className="flex min-w-[4.75rem] max-w-[8rem] flex-1 flex-col gap-1.5"
              >
                {numbered.map(({ cell, position }) => (
                  <PitCell
                    key={position}
                    row={row}
                    position={position}
                    cell={cell}
                    divisions={state.divisions}
                    hideDone={hideDone}
                  />
                ))}
                <span className="rounded-md bg-white/5 py-1 text-center text-sm font-bold text-zinc-300">
                  {row}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="rounded-2xl bg-white/[0.02] px-4 py-8 text-center text-sm text-zinc-600">
          No pits to show. Give teams a pit like <code className="text-zinc-500">A1</code> in
          Admin → Teams and they will appear here.
        </p>
      )}

      {unmapped.length ? (
        <section className="rounded-2xl bg-white/[0.02] p-4 ring-1 ring-inset ring-white/10">
          <h3 className="mb-2 text-sm font-semibold text-zinc-400">
            No pit on the plan ({unmapped.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {unmapped.map(({ team, status }) => {
              const tone = divisionTone(team.division, state.divisions);
              return (
                <span
                  key={team.id}
                  title={`${team.number} ${team.name} · ${team.division}`}
                  className={`rounded-lg px-2 py-1 text-sm tabular-nums ring-2 ${tone.ring} ${
                    status ? STATUS_META[status].fill : "bg-white/5 text-zinc-400"
                  }`}
                >
                  {team.number}
                </span>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PitCell({
  row,
  position,
  cell,
  divisions,
  hideDone,
}: {
  row: string;
  position: number;
  cell: Placed | null;
  divisions: string[];
  hideDone: boolean;
}) {
  // A pit number nobody occupies. With one grid across the whole floor,
  // a blank really is a blank.
  if (!cell) {
    return (
      <div className="flex h-[3.25rem] items-center justify-center rounded-md border border-dashed border-white/[0.07]">
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
  const tone = divisionTone(team.division, divisions);

  return (
    <div
      title={`${row}${position} · ${team.number} ${team.name} · ${team.division}${
        meta ? ` · ${meta.label}` : ""
      }`}
      className={`flex h-[3.25rem] flex-col justify-center overflow-hidden rounded-md px-1 text-center ring-2 ${
        tone.ring
      } ${meta ? meta.fill : "bg-white/[0.05] text-zinc-300"} ${
        show === "requested" ? "pulse-waiting" : ""
      }`}
    >
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
