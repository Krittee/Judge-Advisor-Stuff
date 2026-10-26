import { primaryAction } from "@/components/judge/logic";
import { hasLanguageGap } from "@/components/Language";
import { liveRequestFor } from "@/lib/data";
import { divisionsCompatible } from "@/lib/presets";
import type { Status } from "@/lib/status";
import { compareTeamNumbers } from "@/lib/teamNumber";
import { isPanelBlocked, panelBlocks } from "@/lib/roster";
import type { AppState, ConflictRow, JudgeRow, PublicPanel, RequestRow, Team } from "@/lib/types";

/* The Judge Advisor Floor's decisions, kept out of the markup so they run as
   plain functions in tests/adminFloor.logic.test.mjs. */

/** One team on the board, with the request that puts it there. */
export type FloorCard = { team: Team; request: RequestRow };

/** A panel and the teams in flight on it. `panel` is null for requests whose panel was deleted. */
export type FloorColumn = { panel: PublicPanel | null; cards: FloorCard[] };

/** The key of the column for requests with no panel. */
export const NO_PANEL = "none";
export const columnKey = (column: FloorColumn): string => column.panel?.id ?? NO_PANEL;

// Interviewing first, then on the way, then waiting, then booked.
const RANK: Partial<Record<Status, number>> = {
  interviewing: 0,
  acknowledged: 1,
  requested: 2,
  scheduled: 3,
};

/**
 * A column's cards: interviewing, on the way, requesting (longest wait
 * first), then booked by slot. Ties fall back to team number so the order
 * never shuffles between polls.
 */
export function orderCards(cards: FloorCard[]): FloorCard[] {
  const key = ({ request }: FloorCard) =>
    request.status === "scheduled" ? (request.slot_start ?? "") : request.requested_at;
  return [...cards].sort(
    (a, b) =>
      (RANK[a.request.status] ?? 9) - (RANK[b.request.status] ?? 9) ||
      key(a).localeCompare(key(b)) ||
      compareTeamNumbers(a.team.number, b.team.number),
  );
}

/**
 * One column per panel, in the panels' own order. Requests whose panel was
 * deleted ("Deleting a panel orphans its teams and requests") get a column
 * of their own at the end, so a waiting team never drops off the board.
 */
export function buildColumns(
  panels: PublicPanel[],
  teams: Team[],
  requests: RequestRow[],
): FloorColumn[] {
  const live = teams.flatMap((team) => {
    const request = liveRequestFor(team.id, requests);
    return request ? [{ team, request }] : [];
  });
  const known = new Set(panels.map((p) => p.id));
  const columns = panels.map((panel) => ({
    panel,
    cards: orderCards(live.filter((c) => c.request.panel_id === panel.id)),
  }));
  const orphans = live.filter((c) => !c.request.panel_id || !known.has(c.request.panel_id));
  return orphans.length ? [...columns, { panel: null, cards: orderCards(orphans) }] : columns;
}

/**
 * The load line under a panel's name: "2 waiting · with 2011A",
 * "none waiting · going to 3141P", "1 waiting · panel free".
 */
export function loadLine(cards: FloorCard[]): {
  waiting: number;
  waitingText: string;
  status: string;
  text: string;
} {
  const waiting = cards.filter((c) => c.request.status === "requested").length;
  const interviewing = cards.find((c) => c.request.status === "interviewing");
  const going = cards.find((c) => c.request.status === "acknowledged");
  const status = interviewing
    ? `with ${interviewing.team.number}`
    : going
      ? `going to ${going.team.number}`
      : "panel free";
  const waitingText = waiting ? `${waiting} waiting` : "none waiting";
  return { waiting, waitingText, status, text: `${waitingText} · ${status}` };
}

/**
 * The languages requested on this panel that it has not said it covers, in
 * the order they first appear. A panel with no stated cover has no gaps.
 */
export function uncoveredLanguages(panel: Pick<PublicPanel, "languages"> | null, cards: FloorCard[]): string[] {
  if (!panel) return [];
  return [
    ...new Set(
      cards.map((c) => c.request.language).filter((l) => hasLanguageGap(panel.languages, l)),
    ),
  ];
}

/**
 * Where this interview may be moved: panels in the team's division (or a
 * blended one) that are not blocked from it -- by a whole-panel conflict, or
 * by a conflict of any judge sitting on the panel; the API refuses the rest
 * -- plus the panel it is on now, unless a conflict has since blocked that
 * one too: the interview has to leave it, so it is not offered as a target.
 */
export function allowedPanels(
  team: Pick<Team, "id" | "division">,
  currentPanelId: string | null,
  panels: PublicPanel[],
  conflicts: Pick<ConflictRow, "id" | "panel_id" | "judge_id" | "team_id">[],
  judges: Pick<JudgeRow, "id" | "panel_id">[] = [],
): PublicPanel[] {
  const blocks = panelBlocks(conflicts, judges);
  return panels.filter(
    (p) =>
      !isPanelBlocked(blocks, p.id, team.id) && (p.id === currentPanelId || divisionsCompatible(team.division, p.division)),
  );
}

/**
 * "Panel A has a conflict with 1101 — move it": the line on a card whose live
 * request sits on a panel that a conflict now bars from the team (the conflict
 * came after the request, or the judge moved there). Declaring it does not
 * move the request, so the Floor says so until the Judge Advisor does.
 */
export function conflictNote(
  panel: Pick<PublicPanel, "id" | "name"> | null,
  team: Pick<Team, "id" | "number">,
  conflicts: Pick<ConflictRow, "id" | "panel_id" | "judge_id" | "team_id">[],
  judges: Pick<JudgeRow, "id" | "panel_id">[] = [],
): string | null {
  if (!panel || !isPanelBlocked(panelBlocks(conflicts, judges), panel.id, team.id)) return null;
  return `${panel.name} has a conflict with ${team.number} — move it`;
}

/** The column the phone opens on: the longest-waiting request's panel, else the first. */
export function defaultColumnKey(columns: FloorColumn[]): string | null {
  let best: { key: string; at: string } | null = null;
  for (const column of columns) {
    for (const { request } of column.cards) {
      if (request.status === "requested" && (!best || request.requested_at < best.at)) {
        best = { key: columnKey(column), at: request.requested_at };
      }
    }
  }
  return best?.key ?? (columns[0] ? columnKey(columns[0]) : null);
}

/** "Panel 2" is "P2" on a phone chip; any other name is kept whole. */
export function chipLabel(name: string): string {
  const m = /^panel\s+(\S+)$/i.exec(name.trim());
  return m ? `P${m[1]}` : name;
}

/**
 * A division as a tag: "Middle School" is "MS", "Elementary School" "ES",
 * "Division 1" "D1". A one-word division ("Blended") has no shorter form and
 * stays whole. Where room is tight, as in the "Move to panel…" rows, so the
 * panel's name keeps its line.
 */
export function divisionTag(division: string): string {
  const words = division.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return division.trim();
  return words.map((w) => (/^\d+$/.test(w) ? w : [...w][0].toUpperCase())).join("");
}

export const teamCount = (n: number): string => `${n} ${n === 1 ? "team" : "teams"}`;

/** What a panel can interview in, as tags: "EN only" for one language, else one tag each. */
export function coverTags(
  panel: Pick<PublicPanel, "languages">,
  languages: AppState["languages"],
): { id: string; text: string }[] {
  const short = (id: string) => languages.find((l) => l.id === id)?.short ?? id;
  return panel.languages.map((id) => ({
    id,
    text: panel.languages.length === 1 ? `${short(id)} only` : short(id),
  }));
}

/** "Panel 3 interviews in English only — this team asked for Thai." */
export function gapNote(
  panel: Pick<PublicPanel, "name" | "languages">,
  languages: AppState["languages"],
  asking: string,
): string {
  const label = (id: string) => languages.find((l) => l.id === id)?.label ?? id;
  const covered = panel.languages.map(label).join(", ");
  return `${panel.name} interviews in ${covered}${panel.languages.length === 1 ? " only" : ""} — this team asked for ${label(asking)}.`;
}

/** The step a card's big button takes. The card is narrow, so the last step is "Finish". */
export function cardAction(status: Status): { to: Status; label: string } | null {
  const action = primaryAction(status);
  return action && action.to === "completed" ? { ...action, label: "Finish" } : action;
}

/** When the card's clock started: the wait, the time on the way, or the time in the room. */
export function sinceFor(request: RequestRow): string | null {
  switch (request.status) {
    case "requested":
      return request.requested_at;
    case "acknowledged":
      return request.acknowledged_at ?? request.updated_at;
    case "interviewing":
      return request.started_at ?? request.updated_at;
    default:
      return null;
  }
}

/** The phone chip's spoken label: "Panel 3, 2 teams, 1 waiting, Thai not covered". */
export function chipSpeech(
  column: FloorColumn,
  languages: AppState["languages"],
): string {
  const { waiting } = loadLine(column.cards);
  const label = (id: string) => languages.find((l) => l.id === id)?.label ?? id;
  const gaps = uncoveredLanguages(column.panel, column.cards);
  return [
    column.panel?.name ?? "No panel",
    teamCount(column.cards.length),
    waiting ? `${waiting} waiting` : null,
    gaps.length ? `${gaps.map(label).join(", ")} not covered` : null,
  ]
    .filter(Boolean)
    .join(", ");
}
