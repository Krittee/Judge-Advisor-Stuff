import { isValidMatchNumber } from "@/lib/match";
import { isValidFieldPick, type FlagReport } from "@/lib/flagValidation";
import { findMatchType } from "@/lib/rules";
import type { Session } from "@/lib/auth";
import type { RefereeSetup } from "@/lib/types";

/**
 * The referee console's decisions, as plain functions so each can be checked
 * without a browser: when the event setup is asked for, what a save sends, and
 * what stops the Record button.
 */

/** What the setup screen starts on when nothing has been set yet. */
export const DEFAULT_FIELD_COUNT = 3;

/** The match the referee is working, which every flag is pinned to until it is
 *  changed. The same three strings as MatchFields' draft. */
export type CurrentMatch = { matchType: string; matchNumber: string; field: string };

/**
 * This device's calendar date as YYYY-MM-DD.
 *
 * Built from the local getters on purpose. toISOString() is UTC, so a referee
 * in Thailand opening the app after midnight would be told it is still
 * yesterday -- and the setup would be asked for at the wrong hour.
 */
export function localDate(day: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}`;
}

/** Whether this session may set the event up: the head referee or the Judge
 *  Advisor. The same rule as canSetUpRefereeing in auth.ts, which a page
 *  cannot import (it reads cookies) -- the API refuses anyone else regardless. */
export function canSetUp(session: Session | null | undefined): boolean {
  return session?.role === "admin" || (session?.role === "referee" && session.head === true);
}

/** The Event setup screen shows until a setup exists for today: none at all, or
 *  one saved on an earlier day (the referee device's date, see parseRefereeSetup). */
export function needsEventSetup(setup: RefereeSetup | null, today: string): boolean {
  return setup === null || setup.set_on !== today;
}

/** The body of PUT /api/referee-setup. `today` is this device's date, since the
 *  server has no event timezone to ask. */
export function setupRequest(ruleset: string, fieldCount: number, today: string = localDate()) {
  return { ruleset, field_count: fieldCount, today };
}

/** The question asked before changing a setup other referees are already using
 *  today. Null when there is nothing to ask: a first setup, a new day's
 *  re-confirm (nobody is working from yesterday's), or no change at all. */
export function setupChangeQuestion(
  existing: RefereeSetup | null,
  next: { ruleset: string; fieldCount: number },
  today: string,
): string | null {
  if (!existing || existing.set_on !== today) return null;
  if (existing.ruleset !== next.ruleset) return "Change the program for everyone at this event?";
  if (existing.field_count !== next.fieldCount) return "Change the number of fields for everyone at this event?";
  return null;
}

/** Whether the match and field are complete enough to pin a flag to. The same
 *  checks the server makes, so a ready match is never refused for its shape. */
export function matchIsSet(match: CurrentMatch, rulesetId: string, fieldCount: number): boolean {
  return (
    findMatchType(match.matchType, rulesetId) !== null &&
    isValidMatchNumber(match.matchNumber, match.matchType, rulesetId) &&
    isValidFieldPick(match.field, fieldCount)
  );
}

/**
 * What is still missing before a flag can be recorded, as the one line shown
 * above the Record button; null when nothing is. Match first, then the team,
 * then the severity, and last the rule that Minor, Major and Disqualified need.
 */
export function recordBlocker(p: {
  match: CurrentMatch;
  rulesetId: string;
  fieldCount: number;
  hasTeam: boolean;
  kind: { label: string; requiresRule: boolean } | null;
  rules: string[];
}): string | null {
  if (!matchIsSet(p.match, p.rulesetId, p.fieldCount)) return "Set the match and field first.";
  if (!p.hasTeam) return "Enter a team number.";
  if (!p.kind) return "Pick how serious it was.";
  if (p.kind.requiresRule && !p.rules.length) return `${p.kind.label} needs at least one rule — pick it under What happened.`;
  return null;
}

/** The Record button: "Record Minor · 9882K". */
export function recordLabel(kind: { short: string } | null, team: { number: string } | null): string {
  if (!kind) return "Record";
  if (!team) return `Record ${kind.short}`;
  return `Record ${kind.short} · ${team.number}`;
}

/** The body of POST /api/flags. The ruleset is always the event's, which the
 *  server insists on. */
export function recordPayload(p: {
  teamId: string;
  kind: string;
  body: string;
  match: CurrentMatch;
  rulesetId: string;
  rules: string[];
  matchAffecting: boolean;
}): FlagReport & { teamId: string } {
  return {
    teamId: p.teamId,
    kind: p.kind,
    body: p.body,
    matchType: p.match.matchType,
    matchNumber: p.match.matchNumber,
    field: p.match.field,
    ruleset: p.rulesetId,
    rules: p.rules,
    matchAffecting: p.matchAffecting,
  };
}
