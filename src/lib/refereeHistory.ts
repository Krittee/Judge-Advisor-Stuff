import { matchReference, normalizeMatchNumber } from "./match";
import { getRuleset, parseRuleList } from "./rules";
import type { FlagRow } from "./types";

/** What the team's record already says about ONE of the rules being cited. */
export type RuleHistory = {
  rule: string;
  sameRule: FlagRow[];
  sameMatchSameRule: FlagRow[];
};

export type RefereeHistory = {
  /** One entry per rule being cited, in the order given -- including rules
   *  with no history, so the caller never has to guess which were checked. */
  byRule: RuleHistory[];
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
 *
 * A prior flag counts toward rule X only when it is the same team, the same
 * ruleset (a flag with none is VEX IQ) and X is one of the rules it cites:
 * IQ's SG6 and V5RC's SG6 are different rules that happen to share a code,
 * and a flag can cite several.
 */
export function refereeHistory(
  flags: FlagRow[],
  teamId: string | null | undefined,
  rules: string[],
  matchType: string,
  matchNumber: string,
  rulesetId?: string | null,
): RefereeHistory {
  if (!teamId) {
    return { byRule: [], eventTotals: new Map(), escalationReviewRequired: false };
  }

  // Good Conduct is deliberately absent: it is praise, not a prior
  // violation, even if an old or malformed record happens to carry a rule.
  const teamViolations = flags.filter((f) => f.team_id === teamId && f.kind !== "good");
  const sameRuleset = teamViolations.filter(
    (f) => getRuleset(f.ruleset).id === getRuleset(rulesetId).id,
  );
  // "Same match" is the whole reference, type and number: QF 2-1 and QF 2-2
  // are different matches, and so are Q3 and P3. The number is normalized the
  // way it was stored, which for a bracket keeps "1-12" apart from "11-2".
  const reference = (type: string | null, number: string | null) =>
    matchReference(type, normalizeMatchNumber(number, type, rulesetId));
  const currentMatch = reference(matchType, matchNumber);

  const byRule = parseRuleList(rules.join(",")).map((rule): RuleHistory => {
    const sameRule = sameRuleset.filter((f) => parseRuleList(f.rule).includes(rule));
    return {
      rule,
      sameRule,
      sameMatchSameRule: sameRule.filter(
        (f) => currentMatch !== null && reference(f.match_type, f.match_number) === currentMatch,
      ),
    };
  });

  const eventTotals = new Map<string, number>();
  for (const f of teamViolations) {
    eventTotals.set(f.kind, (eventTotals.get(f.kind) ?? 0) + 1);
  }

  return {
    byRule,
    eventTotals,
    escalationReviewRequired: byRule.some((h) => h.sameRule.some((f) => f.kind === "minor")),
  };
}
