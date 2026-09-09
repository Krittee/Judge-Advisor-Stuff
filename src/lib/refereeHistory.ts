import { normalizeMatchNumber } from "./match";
import type { FlagRow } from "./types";

export type RefereeHistory = {
  sameRule: FlagRow[];
  sameMatchSameRule: FlagRow[];
  eventTotals: Map<string, number>;
  escalationReviewRequired: boolean;
};

/**
 * Calculate referee history inside the application's current event store.
 *
 * This application intentionally has one active event per store. Starting a
 * new event means using the existing "Wipe everything" operation before the
 * new roster is imported. Team ids then form the event boundary without
 * adding a second event/database architecture.
 */
export function refereeHistory(
  flags: FlagRow[],
  teamId: string | null | undefined,
  rule: string | null,
  matchType: string,
  matchNumber: string,
): RefereeHistory {
  if (!teamId) {
    return {
      sameRule: [],
      sameMatchSameRule: [],
      eventTotals: new Map(),
      escalationReviewRequired: false,
    };
  }

  // Good Conduct is deliberately absent: it is praise, not a prior
  // violation, even if an old or malformed record happens to carry a rule.
  const teamViolations = flags.filter((f) => f.team_id === teamId && f.kind !== "good");
  const sameRule = rule ? teamViolations.filter((f) => f.rule === rule) : [];
  const normalizedCurrentMatch = normalizeMatchNumber(matchNumber);
  const sameMatchSameRule = sameRule.filter(
    (f) =>
      f.match_type === matchType &&
      normalizeMatchNumber(f.match_number) === normalizedCurrentMatch,
  );

  const eventTotals = new Map<string, number>();
  for (const f of teamViolations) {
    eventTotals.set(f.kind, (eventTotals.get(f.kind) ?? 0) + 1);
  }

  return {
    sameRule,
    sameMatchSameRule,
    eventTotals,
    escalationReviewRequired: sameRule.some((f) => f.kind === "minor"),
  };
}
