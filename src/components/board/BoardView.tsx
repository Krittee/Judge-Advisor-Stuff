"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { STATUS_META } from "@/lib/status";
import { ConsoleLinks } from "@/components/nav";
import { PitMap, StatusSwatches } from "@/components/PitMap";
import { ThemeToggle } from "@/components/ThemeToggle";
import { formatClock } from "@/components/ui";
import type { AppState, TeamCategoryView } from "@/lib/types";
import {
  divisionClass,
  divisionsInUse,
  groupByPanel,
  markerKey,
  notebookMarker,
  plural,
  statusClass,
  waitParts,
  type Marker,
  type PanelGroup,
  type TileData,
} from "./boardLogic";
import { TileTime } from "./TileTime";

/**
 * The Live board, drawn ("Panel columns, refined", design/board-redesign/).
 *
 * Meant for a TV in the judges' room, read from about three metres, and for
 * a phone opened from the landing page. Everything it shows comes in as
 * props, so the page keeps the polling and this can be rendered to markup.
 * Styles are the `bd-*` ones under `.board` in globals.css.
 *
 * No motion anywhere: waiting stands out by fill, size and position.
 */

export type BoardTab = "queue" | "pits";

export type BoardViewProps = {
  state: AppState;
  online: boolean;
  view: BoardTab;
  hideDone: boolean;
  onView: (view: BoardTab) => void;
  onHideDone: (hide: boolean) => void;
};

export function BoardView({ state, online, view, hideDone, onView, onHideDone }: BoardViewProps) {
  const groups = useMemo(
    () => groupByPanel(state.panels, state.teams, state.requests),
    [state.panels, state.teams, state.requests],
  );

  const waiting = state.requests.filter((r) => r.status === "requested").length;
  const active = state.requests.filter((r) => r.status === "interviewing").length;
  const done = state.requests.filter((r) => r.status === "completed").length;

  const unassigned = groups.find((g) => !g.panel);
  const panels = groups.filter((g) => g.panel);

  return (
    <div className="board">
      <header className="bd-hd">
        <div className="bd-hl">
          <div className="lp-brand bd-brand">
            <span className="lp-mark" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                <path d="M5 7h14M5 12h10M5 17h6" />
              </svg>
            </span>
            <span className="lp-brand-n">Judge Queue</span>
            <span className="lp-brand-s">VEX IQ · V5RC</span>
          </div>
          <h1 className="bd-title">Judging Board</h1>
        </div>

        {/* The one number the board exists to show: solid orange, the biggest
            thing on screen. At zero it goes quiet rather than reading "0". */}
        {waiting > 0 ? (
          <p className="bd-wait">
            <b>{waiting}</b>
            <span>waiting for a judge</span>
          </p>
        ) : (
          <p className="bd-wait bd-wait--none">Nobody waiting</p>
        )}

        <ul className="bd-tal">
          <li className="bd-t-int">
            <b>{active}</b>
            <span>in interview</span>
          </li>
          <li className="bd-t-done">
            <b>{done}</b>
            <span>complete</span>
          </li>
        </ul>

        {/* Whoever set the screen up. Small and muted: the room reads the tiles. */}
        <div className="bd-chrome">
          <div className="bd-crow">
            <div className="bd-seg" role="group" aria-label="Board view">
              {(
                [
                  ["queue", "By panel"],
                  ["pits", "Pit floor"],
                ] as [BoardTab, string][]
              ).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={view === id} onClick={() => onView(id)}>
                  {label}
                </button>
              ))}
            </div>
            <ThemeToggle />
          </div>
          <div className="bd-crow">
            <label className="bd-chk">
              <input type="checkbox" checked={hideDone} onChange={(e) => onHideDone(e.target.checked)} />
              Hide completed
            </label>
            <LiveDot online={online} />
            {/* Whoever opened this on a laptop still has to get back. */}
            <span className="bd-links">
              <ConsoleLinks role={state.viewer.role} current="/board" />
            </span>
            <button type="button" className="bd-fs" onClick={() => document.documentElement.requestFullscreen?.()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
              Fullscreen
            </button>
          </div>
        </div>
      </header>

      <main className="bd-main">
        {view === "pits" ? (
          <PitMap state={state} hideDone={hideDone} />
        ) : (
          <>
            <div className="bd-body">
              <div className="bd-panels">
                {panels.map((g) => (
                  <PanelCard key={g.panel!.id} group={g} hideDone={hideDone} state={state} />
                ))}
              </div>
              <div className="bd-side">
                {unassigned ? <PanelCard group={unassigned} hideDone={hideDone} state={state} /> : null}
                <ColourKey categories={state.categories} divisions={state.divisions} used={divisionsInUse(state.divisions, state.teams)} />
              </div>
            </div>
            <p className="bd-pkey">
              <StatusSwatches />
            </p>
          </>
        )}

        {!state.teams.length ? (
          <p className="bd-none">No teams imported yet. Sign in as Judge Advisor to add them.</p>
        ) : null}
      </main>
    </div>
  );
}

/** The connection dot. Static: ConnectionDot's offline state pulses, and the board does not move. */
function LiveDot({ online }: { online: boolean }) {
  return (
    <span className={`bd-live${online ? "" : " bd-live--off"}`} title={online ? "Live" : "Reconnecting…"}>
      <span className="bd-ld" aria-hidden="true" />
      {online ? "Live" : "Reconnecting"}
    </span>
  );
}

function PanelCard({ group, hideDone, state }: { group: PanelGroup; hideDone: boolean; state: AppState }) {
  const { panel, teams } = group;
  const shown = teams.filter((t) => !hideDone || t.status !== "completed");
  const id = `bd-pn-${panel?.id ?? "unassigned"}`;
  const firstQuiet = shown.findIndex(isQuiet);

  return (
    <section
      className={`bd-panel ${panel ? divisionClass(panel.division, state.divisions) : ""}`}
      aria-labelledby={id}
    >
      <header>
        <div className="bd-pr">
          <h2 id={id}>{panel?.name ?? "Unassigned"}</h2>
          {panel ? (
            <span className="bd-pd">
              <i className="bd-dvs" aria-hidden="true" />
              {panel.division}
            </span>
          ) : null}
          <span className="bd-pcount">
            {shown.length < teams.length ? `${shown.length} of ${plural(teams.length, "team")}` : plural(teams.length, "team")}
          </span>
        </div>
        {/* Always say who is judging, even when nobody has been named yet: a
            blank line reads as "no panel here" rather than "nobody filled this in". */}
        <p className="bd-pj">
          {!panel ? (
            "No panel yet"
          ) : panel.judges.length ? (
            panel.judges.join(" · ")
          ) : (
            <span className="bd-na">NA</span>
          )}
        </p>
      </header>

      <ul className={`bd-g2${panel ? "" : " bd-g2--one"}`}>
        {shown.map((tile, i) => (
          <TileView key={tile.team.id} tile={tile} categories={state.categories} first={i === firstQuiet} />
        ))}
      </ul>
    </section>
  );
}

/** Not yet and complete: full tiles on a TV, number-only chips on a phone. */
const isQuiet = (t: TileData) => t.status === null || t.status === "completed";

/* How many characters of the time's own font size sit beside the number (the
   gap included), so the number can shrink to fit instead of clipping. Elapsed
   is read at render time, so assume its longest ("1h 15m"). */
const ELAPSED_CHARS = 7;

function TileView({ tile, categories, first }: { tile: TileData; categories: TeamCategoryView[]; first: boolean }) {
  const { team, status } = tile;
  const meta = status ? STATUS_META[status] : null;
  const big = status === "requested";
  const quiet = isQuiet(tile);

  // --num-len drives the fit-to-tile shrink of .bd-n (globals.css): a plain
  // size reads a 4-digit number fine but clips a longer one (a real
  // 6-character number was cut to its first five).
  const reserve = big
    ? 4 // "NN min" at the wait's size, which --bd-tf names for this tile
    : tile.slotStart
      ? formatClock(tile.slotStart).length + 1
      : tile.since && status && status !== "completed"
        ? ELAPSED_CHARS
        : 0;
  const style = { "--num-len": team.number.length, "--bd-rc": reserve } as CSSProperties;

  const category = categories.find((c) => c.id === team.category);
  const name = (
    <span className="bd-nm">
      {category ? <MarkerDot marker={notebookMarker(category.id, categories)} label={category.label} /> : null}
      <span className="bd-nt" title={team.name}>
        {team.name}
      </span>
    </span>
  );

  const cls = `bd-tile ${statusClass(status)}${big ? " bd-tile--big" : ""}${quiet ? " bd-tile--q" : ""}${
    first ? " bd-tile--q1" : ""
  }`;

  if (big) {
    return (
      <li className={cls} style={style}>
        <div className="bd-l">
          <span className="bd-n">{team.number}</span>
          <span className="bd-st">{STATUS_META.requested.label}</span>
          {name}
        </div>
        <BigWait since={tile.since} />
      </li>
    );
  }

  return (
    <li className={cls} style={style}>
      <div className="bd-tr">
        <span className="bd-n">{team.number}</span>
        <TileTime tile={tile} className="bd-tt" />
      </div>
      <div className="bd-st">{meta ? meta.short : "Not yet"}</div>
      {name}
    </li>
  );
}

/** "11 min" at the size of the thing it is about; re-read every 15 seconds like Elapsed. */
function BigWait({ since }: { since: string | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const mins = since ? Math.round((Date.now() - Date.parse(since)) / 60000) : NaN;
  if (!Number.isFinite(mins)) return null;

  const { value, unit } = waitParts(Math.max(0, mins));
  return (
    <div className="bd-r">
      <b className={unit ? undefined : "bd-long"} suppressHydrationWarning>
        {value}
      </b>
      {unit ? (
        <>
          {" "}
          <span suppressHydrationWarning>{unit}</span>
        </>
      ) : null}
    </div>
  );
}

/** Filled, half or hollow, in the ink colour: no hue, so it never competes with status. */
function MarkerDot({ marker, label }: { marker: Marker; label: string }) {
  const shape = marker === "full" ? "f" : marker === "half" ? "d" : "u";
  return <span className={`bd-nb bd-nb--${shape}`} role="img" aria-label={label} />;
}

/** `divisions` is the whole config list (a division's colour is its position in it); `used` is what gets listed. */
function ColourKey({ categories, divisions, used }: { categories: TeamCategoryView[]; divisions: string[]; used: string[] }) {
  const statuses: [string, string][] = [
    ["bd-s-req", "Requesting a judge"],
    ["bd-s-en", "Judges on the way"],
    ["bd-s-int", "Interviewing"],
    ["bd-s-bk", "Booked slot"],
    ["bd-s-done", "Complete"],
    ["bd-s-none", "Not yet in the queue"],
  ];
  return (
    <section className="bd-key" aria-labelledby="bd-key-t">
      <h2 id="bd-key-t">What the colours mean</h2>
      <ul>
        {statuses.map(([cls, label]) => (
          <li key={cls}>
            <i className={`bd-sw ${cls}`} aria-hidden="true" />
            {label}
          </li>
        ))}
        {markerKey(categories).map((c, i) => (
          <li key={c.id} className={i === 0 ? "bd-gap" : undefined}>
            <i className={`bd-nb bd-nb--${c.marker === "full" ? "f" : c.marker === "half" ? "d" : "u"}`} aria-hidden="true" />
            {c.label}
          </li>
        ))}
        {used.map((d, i) => (
          <li key={d} className={`${divisionClass(d, divisions)}${i === 0 ? " bd-gap" : ""}`}>
            <i className="bd-rg" aria-hidden="true" />
            {d}
          </li>
        ))}
      </ul>
    </section>
  );
}
