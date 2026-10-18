import { isValidMatchNumber, normalizeField, normalizeMatchNumber } from "./match";
import { isValidMatchType, matchTypes, refereeFlags, resolveFlagKind } from "./presets";
import {
  DEFAULT_RULESET_ID,
  findMatchType,
  getRuleset,
  isValidRuleId,
  isValidRulesetId,
  joinRuleList,
  MAX_FLAG_RULES,
  parseRuleList,
  RULESETS,
} from "./rules";
import type { FlagRow } from "./types";

/** The most fields an event can have. Also what a field is checked against
 *  before any setup has been saved. */
export const MAX_FIELD_COUNT = 20;

/** A field is its number, 1 to the event's field count. Creation and
 *  correction both check it here, so a corrected field can only be one a
 *  referee could have picked in the first place. (A flag recorded with an
 *  older value keeps it through a correction; see parseFlagFields.) */
export function isValidFieldPick(field: string, fieldCount: number = MAX_FIELD_COUNT): boolean {
  return /^\d{1,2}$/.test(field) && Number(field) >= 1 && Number(field) <= fieldCount;
}

/** The kind id for a disqualification. Nothing in the app ever suggests it:
 *  it is recorded only when a referee taps it. */
export const DISQUALIFIED_KIND = "dq";

/** Only these kinds can be marked as having affected the match. */
export const MATCH_AFFECTING_KINDS: readonly string[] = ["minor", "major"];

/**
 * What the browser sends to POST and PATCH /api/flags. `rules` is the list
 * the picker holds; the server also still accepts the old single `rule`
 * string, and never reads a manual version from the client.
 */
export type FlagReport = {
  kind: string;
  body: string;
  matchType: string;
  matchNumber: string;
  field: string;
  ruleset: string;
  rules: string[];
  matchAffecting: boolean;
};

export type ParsedFlagFields = {
  kind: string;
  text: string;
  matchType: string;
  matchNumber: string;
  field: string;
  /** The rule ids comma-joined for storage, or null. */
  rule: string | null;
  /** The rule ids as a list, validated against `ruleset`. */
  rules: string[];
  ruleset: string;
  /** Set here from the ruleset, so a client can never claim an edition. */
  manualVersion: string | null;
  matchAffecting: boolean;
};

export type FlagFieldParseResult =
  | ({ ok: true } & ParsedFlagFields)
  | { ok: false; status: 400; error: string };

type ParseOptions = {
  /**
   * A legacy rule-less Minor/Major may still have its text or match corrected
   * without inventing historical data. It may not change into another
   * rule-requiring kind without supplying a real rule.
   */
  allowLegacyRulelessKind?: string | null;
  /** The ruleset to assume when the request names none. A correction passes
   *  the flag's own, so an older client cannot silently move a V5RC flag to
   *  IQ; a new flag has none and takes the event's, else VEX IQ. */
  defaultRuleset?: string | null;
  /** The program the event is set to, for a NEW flag: it is the ruleset when
   *  the request names none, and naming another is refused. A correction does
   *  not pass it -- a flag keeps the ruleset it was recorded under. */
  eventRuleset?: string | null;
  /** How many fields the event has. With no setup saved yet, MAX_FIELD_COUNT. */
  fieldCount?: number | null;
  /** A correction: the flag as it is on record. What it already holds -- a
   *  legacy match type or field -- may be sent back
   *  unchanged, because refusing it would make the flag uncorrectable. */
  existing?: FlagRow | null;
};

/** Validate and normalize every referee-editable report field. */
export function parseFlagFields(
  body: Record<string, unknown>,
  {
    allowLegacyRulelessKind = null,
    defaultRuleset = null,
    eventRuleset = null,
    fieldCount = null,
    existing = null,
  }: ParseOptions = {},
): FlagFieldParseResult {
  const kind = resolveFlagKind(body.kind);
  // Optional: match, severity and (where required) rule are enough to
  // record a report. Keep any supplied context, capped for storage.
  const text = String(body.body ?? "").trim().slice(0, 500);

  // The ruleset decides which match types and rule ids are real, so it is
  // checked first. Missing means "not told" (the event's program, VEX IQ if
  // there is none, or the flag's own on a correction); a name that is present
  // but unknown is a bad request, not a guess.
  const rawRuleset = String(body.ruleset ?? "").trim();
  if (rawRuleset && !isValidRulesetId(rawRuleset)) {
    return { ok: false, status: 400, error: "That's not a recognised ruleset." };
  }
  if (eventRuleset && rawRuleset && rawRuleset !== eventRuleset) {
    return { ok: false, status: 400, error: `This event is set to ${getRuleset(eventRuleset).label}.` };
  }
  const ruleset = getRuleset(rawRuleset || defaultRuleset || eventRuleset || DEFAULT_RULESET_ID);

  const matchType = String(body.matchType ?? "").trim().toUpperCase();
  // A flag may keep the type it holds even when the program no longer offers
  // it (the legacy "SK"); a different one has to be offered.
  const type =
    isValidMatchType(matchType, ruleset.id) || existing?.match_type === matchType
      ? findMatchType(matchType, ruleset.id)
      : null;
  if (!type) {
    return {
      ok: false,
      status: 400,
      error: `Pick which match this was — ${matchTypes(ruleset.id)
        .map((t) => `${t.id} (${t.label})`)
        .join(", ")}.`,
    };
  }

  const matchNumber = normalizeMatchNumber(body.matchNumber, matchType, ruleset.id);
  if (!isValidMatchNumber(matchNumber, matchType, ruleset.id)) {
    return {
      ok: false,
      status: 400,
      error: type.bracket ? "Enter the bracket and match, like 2-1." : "Enter the match number.",
    };
  }

  // A field is a number, 1 to the event's count -- unless it is the one the
  // flag already holds, which may be a legacy "HS2" or a number the event has
  // since outgrown.
  const rawField = normalizeField(body.field);
  const maxField = fieldCount ?? MAX_FIELD_COUNT;
  const keepsField = rawField !== "" && rawField === existing?.field;
  if (!keepsField && !isValidFieldPick(rawField, maxField)) {
    return { ok: false, status: 400, error: `Pick the field — 1 to ${maxField}.` };
  }
  const field = keepsField ? rawField : String(Number(rawField));

  // `rules` is the list; a bare `rule` string is the legacy single-rule shape.
  const requested = parseRuleList(
    Array.isArray(body.rules) ? body.rules.map((r) => String(r)).join(",") : String(body.rule ?? ""),
  );
  if (requested.length > MAX_FLAG_RULES) {
    return { ok: false, status: 400, error: `Pick at most ${MAX_FLAG_RULES} rules.` };
  }
  const unknown = requested.find((r) => !isValidRuleId(r, ruleset.id));
  if (unknown) {
    return { ok: false, status: 400, error: `${unknown} is not a recognised ${ruleset.label} rule.` };
  }

  // Good Conduct describes positive behavior, not a violated rule. Drop a
  // valid but stale selector value rather than allowing it to contaminate
  // repeated-violation history.
  const rules = kind === "good" ? [] : requested;
  const rule = joinRuleList(rules);

  if (!rule) {
    const kindMeta = refereeFlags().find((k) => k.id === kind);
    if (kindMeta?.requiresRule && allowLegacyRulelessKind !== kind) {
      return {
        ok: false,
        status: 400,
        error: `Pick which rule was violated — required for ${kindMeta.label}.`,
      };
    }
  }

  // Meaningful only for the kinds that can affect a match; anything else is
  // stored false so a stale tick can never ride along.
  const matchAffecting = body.matchAffecting === true && MATCH_AFFECTING_KINDS.includes(kind);

  return {
    ok: true,
    kind,
    text,
    matchType,
    matchNumber,
    field,
    rule,
    rules,
    ruleset: ruleset.id,
    manualVersion: ruleset.manualVersion,
    matchAffecting,
  };
}

export type RefereeSetupParseResult =
  | { ok: true; ruleset: string; fieldCount: number; today: string }
  | { ok: false; status: 400; error: string };

/**
 * Validate the body of PUT /api/referee-setup.
 *
 * `today` is the CLIENT's own calendar date. The app has no event timezone
 * and the server runs in UTC, so asking the server what day it is would roll
 * over mid-afternoon in Thailand; the referee's device is standing in the
 * room the setup describes. Only its shape is checked here.
 * ponytail: the device clock decides the day. Add an event timezone setting
 * if that ever matters.
 */
export function parseRefereeSetup(body: Record<string, unknown>): RefereeSetupParseResult {
  const ruleset = String(body.ruleset ?? "").trim();
  if (!isValidRulesetId(ruleset)) {
    return {
      ok: false,
      status: 400,
      error: `Pick the program — ${RULESETS.map((r) => r.program).join(" or ")}.`,
    };
  }

  const fieldCount = body.field_count;
  if (
    typeof fieldCount !== "number" ||
    !Number.isInteger(fieldCount) ||
    fieldCount < 1 ||
    fieldCount > MAX_FIELD_COUNT
  ) {
    return { ok: false, status: 400, error: `Set the number of fields — 1 to ${MAX_FIELD_COUNT}.` };
  }

  // A real calendar date: "2026-02-30" has the right shape and rolls over to
  // March, so the round trip is what rejects it.
  const today = String(body.today ?? "").trim();
  const day = new Date(`${today}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== today) {
    return { ok: false, status: 400, error: "Send today's date as YYYY-MM-DD." };
  }

  return { ok: true, ruleset, fieldCount, today };
}
