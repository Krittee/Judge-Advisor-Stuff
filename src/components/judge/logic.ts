import { matchReference } from "@/lib/match";
import { parseRuleList } from "@/lib/rules";
import { NEXT_STATUS, type Status } from "@/lib/status";
import { compareTeamNumbers } from "@/lib/teamNumber";
import type { Rubric } from "@/lib/rubrics";
import type { FlagRow, RequestRow, Slot, Team, TeamCategoryView } from "@/lib/types";

/* The judge console's decisions, kept out of the markup so they run as plain
   functions in tests/judgePage.logic.test.mjs. */

export type JudgeTab = "queue" | "scores" | "today";

/** The shared in-page confirm (useConfirm's `ask`). */
export type Ask = (
  question: string,
  options?: { confirmLabel?: string; danger?: boolean },
) => Promise<boolean>;

/** How soon a booked slot starts "in N min" on its row. */
export const DUE_SOON_MINUTES = 10;

const ACTION_LABEL: Partial<Record<Status, string>> = {
  acknowledged: "On our way",
  interviewing: "Start interview",
  completed: "Finish interview",
};

/**
 * The one button a team offers: it moves the team to `to`, and is drawn in
 * that status's colour. Null once there is nothing left to do.
 */
export function primaryAction(status: Status): { to: Status; label: string } | null {
  const to = NEXT_STATUS[status];
  const label = to ? ACTION_LABEL[to] : undefined;
  return to && label ? { to, label } : null;
}

/** "in 4 min" inside the last ten minutes, "due now" once started, else nothing. */
export function dueText(slotStart: string | null, now: number): string | null {
  if (!slotStart) return null;
  const ms = Date.parse(slotStart) - now;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "due now";
  const min = Math.ceil(ms / 60_000);
  return min <= DUE_SOON_MINUTES ? `in ${min} min` : null;
}

/** "Developing · Pit 22". */
export function teamMeta(team: Team, categories: TeamCategoryView[]): string {
  return [
    categories.find((c) => c.id === team.category)?.label,
    team.pit ? `Pit ${team.pit}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "GG17 · Q19": the rules broken and the match, without who reported it. */
export function flagDetail(f: FlagRow): string {
  return [parseRuleList(f.rule).join(", "), matchReference(f.match_type, f.match_number)]
    .filter(Boolean)
    .join(" · ");
}

/** The flag worth one line on a card: the most serious, then the newest. */
export function leadFlag(
  flags: FlagRow[],
  kinds: { id: string; severity: number }[],
): FlagRow | null {
  const severity = (f: FlagRow) => kinds.find((k) => k.id === f.kind)?.severity ?? -1;
  return (
    [...flags].sort(
      (a, b) => severity(b) - severity(a) || b.created_at.localeCompare(a.created_at),
    )[0] ?? null
  );
}

/**
 * Cancelling is not undoable from this screen, so it asks first and only
 * sends once the answer is yes. `ask` is the shared in-page confirm
 * (useConfirm), never window.confirm.
 */
export async function cancelAfterAsking(
  ask: Ask,
  team: Pick<Team, "number">,
  cancel: () => Promise<void>,
): Promise<boolean> {
  const yes = await ask(`Cancel ${team.number}'s request? They leave the queue.`, {
    confirmLabel: "Yes, cancel request",
    danger: true,
  });
  if (yes) await cancel();
  return yes;
}

/** A rubric's one-word name for a tight button: "Engineering Notebook" is "Notebook". */
export function rubricShort(rubric: Pick<Rubric, "name">): string {
  return rubric.name.trim().split(/\s+/).at(-1) ?? rubric.name;
}

/** The points a section can award, for its "4/6" subtotal. */
export function sectionMax(rubric: Rubric, criteriaCount: number): number {
  return criteriaCount * (rubric.scale[rubric.scale.length - 1]?.value ?? 0);
}

/**
 * Where Today's "now" rule goes: before the first slot yet to start, and at
 * the end once every slot has.
 */
export function nowIndex(slots: Pick<Slot, "start">[], now: number): number {
  const i = slots.findIndex((s) => Date.parse(s.start) > now);
  return i === -1 ? slots.length : i;
}

/**
 * Teams on this panel interviewed before its first slot began, who therefore
 * hold no slot in the timeline: the one "Before 10:00 · … complete" line.
 */
export function completedBeforeSlots(
  slots: Slot[],
  requests: RequestRow[],
  teams: Team[],
): { before: string; teams: Team[] } | null {
  if (!slots.length) return null;
  const first = Date.parse(slots[0].start);
  const inGrid = new Set(slots.flatMap((s) => (s.takenBy ? [s.takenBy.teamId] : [])));
  const done = new Set(
    requests
      .filter((r) => r.status === "completed" && Date.parse(r.finished_at ?? r.updated_at) < first)
      .map((r) => r.team_id),
  );
  const early = teams
    .filter((t) => done.has(t.id) && !inGrid.has(t.id))
    .sort((a, b) => compareTeamNumbers(a.number, b.number));
  return early.length ? { before: slots[0].start, teams: early } : null;
}

/** "10:40" and "AM" apart, so the Today column stays narrow; a 24-hour locale has no period. */
export function clockParts(iso: string): { time: string; period: string } {
  const parts = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).formatToParts(
    new Date(iso),
  );
  return {
    time: parts
      .filter((p) => p.type !== "dayPeriod")
      .map((p) => p.value)
      .join("")
      .trim(),
    period: parts.find((p) => p.type === "dayPeriod")?.value ?? "",
  };
}
