import type { Status } from "@/lib/status";
import { compareTeamNumbers } from "@/lib/teamNumber";
import type { PublicPanel, RequestRow, Team } from "@/lib/types";

/**
 * What the board decides, apart from how it is drawn: which request stands
 * for a team, the order of the tiles, the notebook marker, the wait text.
 * Pure, so each can be checked without a browser (tests/board.logic.test.mjs).
 */

/** One team as the board shows it. */
export type TileData = {
  team: Team;
  status: Status | null;
  /** When it last moved: started, else acknowledged, else requested. */
  since: string | null;
  /** Set only for a slot still being held, so the tile can show its clock time. */
  slotStart: string | null;
  requestedAt: string | null;
};

/** Lower rank wins when a team has more than one request on record. */
export function rank(status: string): number {
  return (
    { requested: 0, acknowledged: 1, interviewing: 2, scheduled: 3, completed: 4, cancelled: 5 }[
      status
    ] ?? 9
  );
}

/** Every team's most relevant request: requested beats acknowledged beats interviewing... */
export function bestRequests(requests: RequestRow[]): Map<string, RequestRow> {
  const best = new Map<string, RequestRow>();
  for (const r of requests) {
    const existing = best.get(r.team_id);
    if (!existing || rank(r.status) < rank(existing.status)) best.set(r.team_id, r);
  }
  return best;
}

/** A cancelled request counts as none. */
export function tileFor(team: Team, r: RequestRow | undefined): TileData {
  if (!r || r.status === "cancelled") {
    return { team, status: null, since: null, slotStart: null, requestedAt: null };
  }
  return {
    team,
    status: r.status,
    since: r.started_at ?? r.acknowledged_at ?? r.requested_at ?? null,
    slotStart: r.status === "scheduled" ? (r.slot_start ?? null) : null,
    requestedAt: r.requested_at ?? null,
  };
}

/* The board's own order, which is not STATUS_META.order (other pages use
   that one): who needs a judge first, then who is nearly there, then the
   rest of the day. */
const BOARD_RANK: Record<string, number> = { requested: 0, acknowledged: 1, interviewing: 2, scheduled: 3, none: 4, completed: 5 };

/** A missing or unreadable time sorts last. */
function at(iso: string | null): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? Infinity : t;
}

/**
 * Requesting (longest wait first), on the way, interviewing, booked (by slot
 * time), not yet, complete. Team number breaks every tie.
 */
export function boardOrder(a: TileData, b: TileData): number {
  const ra = BOARD_RANK[a.status ?? "none"] ?? BOARD_RANK.none;
  const rb = BOARD_RANK[b.status ?? "none"] ?? BOARD_RANK.none;
  if (ra !== rb) return ra - rb;

  const [ta, tb] =
    a.status === "requested"
      ? [at(a.requestedAt), at(b.requestedAt)]
      : a.status === "scheduled"
        ? [at(a.slotStart), at(b.slotStart)]
        : [0, 0];
  if (ta !== tb) return ta < tb ? -1 : 1;

  return compareTeamNumbers(a.team.number, b.team.number);
}

export type PanelGroup = { panel: PublicPanel | null; teams: TileData[] };

/** Every team appears exactly once, showing its most relevant request. */
export function groupByPanel(panels: PublicPanel[], teams: Team[], requests: RequestRow[]): PanelGroup[] {
  const best = bestRequests(requests);
  const tiles = (list: Team[]) => list.map((t) => tileFor(t, best.get(t.id))).sort(boardOrder);

  const groups: PanelGroup[] = panels.map((panel) => ({
    panel,
    teams: tiles(teams.filter((t) => t.panel_id === panel.id)),
  }));

  const orphans = tiles(teams.filter((t) => !t.panel_id));
  if (orphans.length) groups.push({ panel: null, teams: orphans });

  return groups;
}

export type Marker = "full" | "half" | "hollow";

/* The shapes in the order the config lists the notebook categories, used for
   any id the board does not know by name. */
const MARKER_ORDER: Marker[] = ["full", "half", "hollow"];

/* By meaning where it is known: config/event.json lists Developing first, so
   position alone would draw it filled. */
const MARKER_BY_ID: Record<string, Marker> = {
  "fully-developed": "full",
  developing: "half",
  ungraded: "hollow",
};

/** Filled for Fully Developed, half for Developing, hollow for Ungraded. */
export function notebookMarker(categoryId: string, categories: { id: string }[]): Marker {
  const known = MARKER_BY_ID[categoryId];
  if (known) return known;
  return MARKER_ORDER[categories.findIndex((c) => c.id === categoryId)] ?? "hollow";
}

/** The colour-key rows, in shape order. */
export function markerKey<T extends { id: string }>(categories: T[]): (T & { marker: Marker })[] {
  return categories
    .map((c) => ({ ...c, marker: notebookMarker(c.id, categories) }))
    .sort((a, b) => MARKER_ORDER.indexOf(a.marker) - MARKER_ORDER.indexOf(b.marker));
}

/** The wait on a requesting tile, split so the number can be set large. */
export function waitParts(mins: number): { value: string; unit: string } {
  if (mins < 1) return { value: "<1", unit: "min" };
  if (mins < 60) return { value: String(mins), unit: "min" };
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return { value: m ? `${h}h ${m}m` : `${h}h`, unit: "" };
}

/** Which colour class a tile wears. */
export function statusClass(status: Status | null): string {
  switch (status) {
    case "requested":
      return "bd-s-req";
    case "acknowledged":
      return "bd-s-en";
    case "interviewing":
      return "bd-s-int";
    case "scheduled":
      return "bd-s-bk";
    case "completed":
      return "bd-s-done";
    default:
      return "bd-s-none";
  }
}

/** The ring / marker colour for a division: the nth division wears the nth --cat-* token. */
export function divisionClass(division: string, divisions: string[]): string {
  return `bd-dv-${(Math.max(0, divisions.indexOf(division)) % 4) + 1}`;
}

/** The divisions that have at least one of these teams, in config order: the keys list only those. */
export function divisionsInUse(divisions: string[], teams: { division: string }[]): string[] {
  return divisions.filter((d) => teams.some((t) => t.division === d));
}

/** "1 team", "12 teams". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The board opens in a new tab from the consoles, so browser Back is no way
 * home: it links to where this viewer came from. `label` is the destination's
 * name; the page draws the arrow and says "Back to ..." to a screen reader.
 */
export function backLinkFor(role: string): { href: string; label: string } {
  switch (role) {
    case "admin":
      return { href: "/admin", label: "Judge Advisor" };
    case "queuer":
      return { href: "/queue", label: "Queue desk" };
    case "judge":
      return { href: "/judge", label: "My panel" };
    case "referee":
      return { href: "/referee", label: "Referee" };
    default:
      return { href: "/", label: "Home" };
  }
}
