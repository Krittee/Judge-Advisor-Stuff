import { kindCounts, type FlagKind } from "@/components/Flags";
import type { Ask } from "@/components/judge/logic";
import { liveRequestFor } from "@/lib/data";
import { normalizePit } from "@/lib/pit";
import { divisionsCompatible } from "@/lib/presets";
import { isPanelBlocked, panelBlocks } from "@/lib/roster";
import { canTransition, STATUS_META, type Status } from "@/lib/status";
import { normalizeTeamNumber } from "@/lib/teamNumber";
import type { ConflictRow, FlagRow, JudgeRow, PublicPanel, RequestRow, Team } from "@/lib/types";
import { strandedTeams } from "./conflictsLogic";
import { allowedPanels } from "./floorLogic";

/* The Judge Advisor Teams tab's decisions, kept out of the markup so they run
   as plain functions in tests/adminTeams.logic.test.mjs. Which panels a team
   may take is never worked out here: it is `allowedPanels` (the Floor's list)
   and `strandedTeams` (the Conflicts banner), both of which read the roster's
   `panelBlocks`. */

/** The in-page API caller (`call` in useAppState): resolves with the body, throws the server's message. */
export type Call = (url: string, options: { method?: string; body?: unknown }) => Promise<unknown>;

/* ---- the list -------------------------------------------------------------- */

export type Filters = { q: string; division: string; category: string };

/** The teams the filters leave: a number or name containing the text, in the division and the notebook type chosen. */
export function filterTeams(teams: Team[], f: Filters): Team[] {
  const q = f.q.trim().toLowerCase();
  return teams.filter((t) => {
    if (f.division && t.division !== f.division) return false;
    if (f.category && t.category !== f.category) return false;
    return !q || t.number.toLowerCase().includes(q) || t.name.toLowerCase().includes(q);
  });
}

/** How many of the two selects are set: the badge on a phone's Filters button. */
export const activeFilters = (f: Filters): number => (f.division ? 1 : 0) + (f.category ? 1 : 0);

/** A chip per notebook type with how many of `teams` are of it. */
export function notebookCounts<C extends { id: string }>(teams: Team[], categories: C[]): { category: C; count: number }[] {
  return categories.map((category) => ({ category, count: teams.filter((t) => t.category === category.id).length }));
}

/** A chip per panel (only the chosen division's when one is) with how many teams hold it. Counted over every team, not the filtered ones. */
export function panelLoad(teams: Team[], panels: PublicPanel[], division: string): { panel: PublicPanel; count: number }[] {
  const held = new Map<string, number>();
  for (const t of teams) if (t.panel_id) held.set(t.panel_id, (held.get(t.panel_id) ?? 0) + 1);
  return panels.filter((p) => !division || p.division === division).map((panel) => ({ panel, count: held.get(panel.id) ?? 0 }));
}

/**
 * The request that speaks for a team (the live one, else a finished one) and,
 * for a slot booking, when it is. A slot that was cancelled is not a time
 * anyone should turn up for, and `liveRequestFor` already leaves those out.
 */
export function interviewOf(teamId: string, requests: RequestRow[]): { request: RequestRow | null; bookedAt: string | null } {
  const request = liveRequestFor(teamId, requests) ?? requests.find((r) => r.team_id === teamId && r.status === "completed") ?? null;
  return { request, bookedAt: request?.kind === "slot" ? request.slot_start : null };
}

/** What the Panel column shows: a panel, "Unassigned", or "no panel left" when every panel that may judge the team is blocked from it. */
export type PanelCell = { kind: "panel"; name: string } | { kind: "unassigned" } | { kind: "none-left" };

/** The ids of the teams with no panel left to judge them. */
export function strandedIds(teams: Team[], panels: PublicPanel[], conflicts: ConflictRow[], judges: JudgeRow[]): Set<string> {
  return new Set(strandedTeams(teams, panels, panelBlocks(conflicts, judges)).map((t) => t.id));
}

export function panelCell(team: Team, panels: Pick<PublicPanel, "id" | "name">[], stranded: Set<string>): PanelCell {
  if (team.panel_id) return { kind: "panel", name: panels.find((p) => p.id === team.panel_id)?.name ?? "—" };
  return stranded.has(team.id) ? { kind: "none-left" } : { kind: "unassigned" };
}

/** A team's flags counted by severity, worst first, from the same helper the Referee tab's summary uses. */
export function flagPills(teamId: string, flags: FlagRow[], kinds: FlagKind[]): { kind: FlagKind; count: number }[] {
  return kindCounts(flags.filter((f) => f.team_id === teamId), kinds);
}

/* ---- the editor ------------------------------------------------------------ */

/** What the drawer (or the phone's sheet) edits. Starts as the team is; only "Save changes" sends it. */
export type TeamDraft = { number: string; name: string; pit: string; division: string; category: string; panelId: string };

export const startDraft = (team: Team): TeamDraft => ({
  number: team.number,
  name: team.name,
  pit: team.pit ?? "",
  division: team.division,
  category: team.category,
  panelId: team.panel_id ?? "",
});

/**
 * The one PATCH body for "Save changes": the team, and each of number, name,
 * pit, division, notebook and panel that the draft changes, tidied the way the server
 * tidies them. Null when nothing changed, which is what keeps Save disabled.
 *
 * Only the changed fields go, so saving a pit is never refused because the
 * panel the team already holds has since been declared conflicted.
 */
export function teamPatch(team: Team, draft: TeamDraft): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const number = normalizeTeamNumber(draft.number);
  if (number !== normalizeTeamNumber(team.number)) patch.number = number;
  const name = draft.name.trim();
  if (name !== team.name.trim()) patch.name = name;
  const pit = normalizePit(draft.pit);
  if (pit !== normalizePit(team.pit)) patch.pit = pit;
  if (draft.division !== team.division) patch.division = draft.division;
  if (draft.category !== team.category) patch.category = draft.category;
  if (draft.panelId !== (team.panel_id ?? "")) patch.panelId = draft.panelId || null;
  return Object.keys(patch).length ? patch : null;
}

export const isDirty = (team: Team, draft: TeamDraft): boolean => teamPatch(team, draft) !== null;

/**
 * The panel a move to `division` takes the team off: the one it holds, when it can't judge that
 * division. The server clears it (PATCH with a division and no panelId); this only says so, to ask first.
 */
export function panelLeft(team: Team, division: string, panels: PublicPanel[]): PublicPanel | null {
  const held = panels.find((p) => p.id === team.panel_id);
  return held && division !== team.division && !divisionsCompatible(division, held.division) ? held : null;
}

export const moveQuestion = (team: Pick<Team, "number">, division: string, left: Pick<PublicPanel, "name" | "division">): string =>
  `Move ${team.number} to ${division}? It comes off ${left.name} (${left.division}) and will need a panel.`;

/**
 * "Save changes": the whole edit in one PATCH, or nothing when nothing changed. Returns whether it sent; the
 * server's refusal is thrown. A division move that takes the team off the panel it holds asks first, unless the
 * panel was changed in the same edit (then the Judge Advisor has already chosen); a no sends nothing.
 */
export async function saveTeamAfterAsking(ask: Ask, call: Call, team: Team, draft: TeamDraft, panels: PublicPanel[]): Promise<boolean> {
  const patch = teamPatch(team, draft);
  if (!patch) return false;
  const left = draft.panelId === (team.panel_id ?? "") ? panelLeft(team, draft.division, panels) : null;
  if (left && !(await ask(moveQuestion(team, draft.division, left), { confirmLabel: "Move team" }))) return false;
  await call("/api/admin/teams", { method: "PATCH", body: { teamId: team.id, ...patch } });
  return true;
}

/**
 * The panels the select offers: the Floor's allowed list (division and conflicts), plus the team's own.
 * The Floor stops offering a panel that has become blocked as a place to move to; here it must stay
 * so the select shows where the team really is, marked, instead of reading "— none —".
 * `division` is the one being edited: the list follows it, and the held panel drops out when it can't judge it.
 */
export function panelOptions(
  team: Team,
  panels: PublicPanel[],
  conflicts: ConflictRow[],
  judges: JudgeRow[],
  division: string = team.division,
): { id: string; name: string; blocked: boolean }[] {
  const blocks = panelBlocks(conflicts, judges);
  const held = panelLeft(team, division, panels) ? null : team.panel_id;
  const allowed = new Set(allowedPanels({ ...team, division }, held, panels, conflicts, judges).map((p) => p.id));
  return panels
    .filter((p) => allowed.has(p.id) || p.id === held)
    .map((p) => ({ id: p.id, name: p.name, blocked: isPanelBlocked(blocks, p.id, team.id) }));
}

/* ---- closing with unsaved changes ------------------------------------------ */

export const discardQuestion = (team: Pick<Team, "number">): string => `Discard your changes to team ${team.number}?`;

/** Leaving a team's editor (close, another row, Open in Referee): nothing to ask unless there are unsaved changes. True when it is fine to go. */
export async function leaveAfterAsking(ask: Ask, team: Team, draft: TeamDraft): Promise<boolean> {
  if (!isDirty(team, draft)) return true;
  return ask(discardQuestion(team), { confirmLabel: "Discard changes", danger: true });
}

/** Open in Referee: leave for the Referee section with this team selected, after asking if there are unsaved changes. Returns whether it went. */
export async function openInRefereeAfterAsking(ask: Ask, team: Team, draft: TeamDraft, open: (teamId: string) => void): Promise<boolean> {
  if (!(await leaveAfterAsking(ask, team, draft))) return false;
  open(team.id);
  return true;
}

/* ---- the interview status override ----------------------------------------- */

/** What the Judge Advisor's status override can move a request to.
 *  "scheduled" is left out -- getting back there needs a slot_start too,
 *  which this override was never meant to reconstruct. */
export const RESETTABLE_STATUSES: Status[] = ["requested", "acknowledged", "interviewing", "completed", "cancelled"];

/**
 * Which existing action actually gets a status right, rather than always
 * set-status: "reopen" clears the stale acknowledged/started/finished
 * timestamps a completed or cancelled request is still carrying (set-status
 * alone does not), and "cancel" is what stamps cancelled_at. Those two are
 * held to the transition table (status.ts): reopen only a finished request,
 * cancel only an open one. Where the table would refuse -- stepping a live
 * request back to "requested", or cancelling one that already completed --
 * set-status covers it, and is unrestricted for an admin session.
 */
export function resetAction(from: Status, status: Status): "reopen" | "cancel" | "set-status" {
  return status === "requested" && canTransition("reopen", from)
    ? "reopen"
    : status === "cancelled" && canTransition("cancel", from)
      ? "cancel"
      : "set-status";
}

export const resetQuestion = (team: Pick<Team, "number">, status: Status): string =>
  `Set team ${team.number}'s interview to "${STATUS_META[status].label}"?\n\nThis overrides what the judges set.`;

/**
 * The override, asked first. `from` is the status the row is showing, so a
 * stale screen is refused by the server. Returns whether it sent.
 */
export async function resetStatusAfterAsking(ask: Ask, call: Call, team: Pick<Team, "number">, request: Pick<RequestRow, "id" | "status">, status: Status): Promise<boolean> {
  if (!(await ask(resetQuestion(team, status), { confirmLabel: "Reset status" }))) return false;
  const action = resetAction(request.status, status);
  await call(`/api/requests/${request.id}`, {
    method: "PATCH",
    body: { action, from: request.status, ...(action === "set-status" ? { status } : {}) },
  });
  return true;
}

/* ---- Remove team ----------------------------------------------------------- */

export const removeQuestion = (team: Pick<Team, "number">): string => `Remove team ${team.number} and all its requests?`;

/** Remove team, asked first; nothing is sent on a no. Returns whether it sent. */
export async function removeTeamAfterAsking(ask: Ask, call: Call, team: Pick<Team, "id" | "number">): Promise<boolean> {
  if (!(await ask(removeQuestion(team), { confirmLabel: "Remove team", danger: true }))) return false;
  await call(`/api/admin/teams?teamId=${team.id}`, { method: "DELETE" });
  return true;
}

/* ---- the two resets -------------------------------------------------------- */

export type ResetAction = "resetDay" | "resetAll";

export const RESETS: Record<ResetAction, { question: string; confirmLabel: string }> = {
  resetDay: {
    question: "Clear today's requests, notes, scores and activity?\n\nTeams, panels and event-wide referee history are kept.",
    confirmLabel: "Clear today",
  },
  resetAll: {
    question:
      "Delete the ENTIRE EVENT — teams, panels, requests, notes, scores and referee history?\n\nUse this before importing a new event. This cannot be undone.",
    confirmLabel: "Wipe everything",
  },
};

/** Reset the day / Wipe everything, asked first; nothing is sent on a no. Returns whether it sent. */
export async function resetAfterAsking(ask: Ask, call: Call, action: ResetAction): Promise<boolean> {
  const { question, confirmLabel } = RESETS[action];
  if (!(await ask(question, { confirmLabel, danger: true }))) return false;
  await call("/api/admin/teams", { method: "PATCH", body: { action } });
  return true;
}

/* ---- storage --------------------------------------------------------------- */

export type Health = { ok: boolean; storage?: string; location?: string; persistent?: boolean; error?: string };

/** The words on the collapsed Event data row when storage is down (it turns danger-coloured too). */
export const STORAGE_DOWN = "Storage is not reachable";
