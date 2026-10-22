"use client";

import { useMemo } from "react";
import { STATUS_META } from "@/lib/status";
import { buildFloorPlan, comparePits, isMappablePit, parsePit } from "@/lib/pit";
import type { AppState } from "@/lib/types";
import { bestRequests, divisionClass, plural, statusClass, tileFor, type TileData } from "./board/boardLogic";
import { TileTime } from "./board/TileTime";

/**
 * The pit floor, seen from above ("Panel columns, refined", design/board-redesign/).
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
 *
 * Styles are the `bd-*` ones under `.board` in globals.css. The division
 * colours are the --cat-* tokens: labels, not states.
 */

type Placed = TileData;

export function PitMap({ state, hideDone }: { state: AppState; hideDone: boolean }) {
  const placed = useMemo<Placed[]>(() => {
    const best = bestRequests(state.requests);
    return state.teams.map((team) => tileFor(team, best.get(team.id)));
  }, [state.teams, state.requests]);

  // One grid across the whole floor, both divisions together, then turned
  // to face the way the hall actually does.
  const columns = useMemo(() => {
    const plan = buildFloorPlan(placed, (p) => p.team.pit);
    const facing = state.pitFloor.columns === "right-to-left" ? [...plan].reverse() : plan;

    // Number each cell from the row's own first position, then reverse for
    // bottom-to-top. The cell keeps its real position either way, so the
    // tile still says A5 wherever A5 has ended up on screen.
    return facing.map((col) => {
      const numbered = col.cells.map((cell, i) => ({ cell, position: col.from + i }));
      return {
        ...col,
        numbered: state.pitFloor.rows === "bottom-to-top" ? numbered.reverse() : numbered,
      };
    });
  }, [placed, state.pitFloor]);

  const mapped = placed.filter((p) => isMappablePit(p.team.pit));
  const unmapped = placed
    .filter((p) => !isMappablePit(p.team.pit))
    .sort((a, b) => a.team.number.localeCompare(b.team.number));

  // Only divisions with a team on the plan: "High School 0 pits" is noise on a TV.
  const perDivision = state.divisions
    .map((d) => ({
      division: d,
      tone: divisionClass(d, state.divisions),
      total: mapped.filter((p) => p.team.division === d).length,
      waiting: mapped.filter((p) => p.team.division === d && p.status === "requested").length,
    }))
    .filter((d) => d.total > 0);

  return (
    <div className="bd-pits">
      {columns.length ? (
        <section className="bd-floor">
          {columns.map(({ row, numbered }) => (
            <section key={row} className="bd-fc" aria-label={`Column ${row}`}>
              <div className="bd-fh">
                <b>{row}</b>
                <span>{plural(numbered.filter((n) => n.cell.length).length, "pit")}</span>
              </div>
              <div className="bd-fg">
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
              </div>
            </section>
          ))}
        </section>
      ) : (
        <p className="bd-none">
          No pits to show. Give teams a pit like <code>A1</code> in Admin → Teams and they will
          appear here.
        </p>
      )}

      {unmapped.length ? (
        <section className="bd-extra">
          <h3>No pit on the plan ({unmapped.length})</h3>
          <div className="bd-chips">
            {unmapped.map((tile) => (
              <span
                key={tile.team.id}
                title={`${tile.team.number} ${tile.team.name} · ${tile.team.division}`}
                className={`bd-chipn ${statusClass(tile.status)} ${divisionClass(tile.team.division, state.divisions)}`}
              >
                {tile.team.number}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="bd-keyrow bd-keyrow--pits">
        <StatusSwatches />
        <span className="bd-vr" aria-hidden="true" />
        {perDivision.map(({ division, tone, total, waiting }) => (
          <span key={division} className={`bd-ki ${tone}`}>
            <i className="bd-rg" aria-hidden="true" />
            {division}
            <span className="bd-mu">
              {plural(total, "pit")}
              {waiting ? ` · ${waiting} waiting` : ""}
            </span>
          </span>
        ))}
      </footer>
    </div>
  );
}

/** The status colours as a row of swatches, in the short words the tiles use. */
export function StatusSwatches() {
  const rows: [string, string][] = [
    ["bd-s-req", STATUS_META.requested.short],
    ["bd-s-en", STATUS_META.acknowledged.short],
    ["bd-s-int", STATUS_META.interviewing.short],
    ["bd-s-bk", STATUS_META.scheduled.short],
    ["bd-s-done", STATUS_META.completed.short],
    ["bd-s-none", "Not yet"],
  ];
  return (
    <>
      {rows.map(([cls, label]) => (
        <span key={cls} className="bd-ki">
          <i className={`bd-sw ${cls}`} aria-hidden="true" />
          {label}
        </span>
      ))}
    </>
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
  cell: Placed[];
  divisions: string[];
  hideDone: boolean;
}) {
  // A pit number nobody occupies. With one grid across the whole floor,
  // a blank really is a blank.
  if (!cell.length) {
    return (
      <div className="bd-pit bd-pit--empty">
        <span className="bd-pcode">
          {row}
          {position}
        </span>
      </div>
    );
  }

  // Hide completed removes the tile itself. An empty box of the same height
  // keeps every other tile where it was.
  const shown = hideDone ? cell.filter((p) => p.status !== "completed") : cell;
  if (!shown.length) return <div aria-hidden className="bd-pit bd-pit--gone" />;

  // Two teams on one pit: both numbers, so neither is hidden behind the other.
  if (shown.length > 1) {
    return (
      <div
        title={shown.map((p) => `${p.team.number} ${p.team.name} · ${p.team.division}`).join("\n")}
        className="bd-pit bd-pit--shared"
      >
        <div className="bd-shared-h">
          {row}
          {position} · {shown.length} teams
        </div>
        <div className="bd-shared-n">{shown.map((p) => p.team.number).join(" / ")}</div>
      </div>
    );
  }

  const tile = shown[0];
  const { team, status } = tile;
  const meta = status ? STATUS_META[status] : null;

  return (
    <div
      title={`${row}${position} · ${team.number} ${team.name} · ${team.division}${
        meta ? ` · ${meta.label}` : ""
      }`}
      className={`bd-pit ${statusClass(status)} ${divisionClass(team.division, divisions)}`}
    >
      <span className="bd-pcode">
        {row}
        {position}
      </span>
      <span className="bd-pnum">{team.number}</span>
      {meta ? (
        <span className="bd-ps">
          {meta.short} <TileTime tile={tile} className="bd-pt" />
        </span>
      ) : null}
    </div>
  );
}

export { comparePits, parsePit };
