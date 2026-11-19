import { compareTeamNumbers } from "./teamNumber";
import type { AwardReleaseRow, AwardView, NoWinnerRow, ReleaseSnapshot, Team, WinnerRow } from "./types";

/** What the Judge Advisor has decided for one award in one division, or null while it is still open. */
export function decisionFor(
  award: AwardView,
  division: string,
  winners: WinnerRow[],
  noWinners: NoWinnerRow[],
  teams: Team[],
): ReleaseSnapshot | null {
  if (noWinners.some((n) => n.award_id === award.id && n.division === division)) return { teams: [], no_winner: true };
  const ids = new Set(winners.filter((w) => w.award_id === award.id && w.division === division).map((w) => w.team_id));
  const holders = teams.filter((t) => ids.has(t.id));
  if (holders.length !== award.places) return null;
  return {
    teams: holders
      .map((t) => ({ id: t.id, number: t.number, name: t.name }))
      .sort((a, b) => compareTeamNumbers(a.number, b.number)),
    no_winner: false,
  };
}

export function sameDecision(a: ReleaseSnapshot, b: ReleaseSnapshot): boolean {
  if (a.no_winner !== b.no_winner || a.teams.length !== b.teams.length) return false;
  const ids = new Set(a.teams.map((t) => t.id));
  return b.teams.every((t) => ids.has(t.id));
}

/** What a send records: nothing when it is already sent, the previous decision when a recalled one came back different. */
export function nextSend(
  current: AwardReleaseRow | undefined,
  snapshot: ReleaseSnapshot,
  now: string,
): { previous: ReleaseSnapshot | null; changedAt: string | null } | "unchanged" {
  if (!current) return { previous: null, changedAt: null };
  if (current.status === "sent") return "unchanged";
  if (sameDecision(current, snapshot)) return { previous: current.previous, changedAt: current.changed_at };
  return { previous: { teams: current.teams, no_winner: current.no_winner }, changedAt: now };
}

export function sentRelease(releases: AwardReleaseRow[], awardId: string, division: string): AwardReleaseRow | undefined {
  return releases.find((r) => r.status === "sent" && r.award_id === awardId && r.division === division);
}

export function sentHolding(releases: AwardReleaseRow[], teamId: string): AwardReleaseRow | undefined {
  return releases.find((r) => r.status === "sent" && r.teams.some((t) => t.id === teamId));
}
