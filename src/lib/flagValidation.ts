import { isValidMatchNumber, normalizeField, normalizeMatchNumber } from "./match";
import { isValidMatchType, matchTypes, refereeFlags, resolveFlagKind } from "./presets";
import {
  DEFAULT_RULESET_ID,
  getRuleset,
  isValidRuleId,
  isValidRulesetId,
  joinRuleList,
  MAX_FLAG_RULES,
  parseRuleList,
} from "./rules";

/**
 * A field is a division prefix and a number, "ES2" -- the same shape the
 * referee form builds from its two boxes. Creation and correction both
 * check it here, so a corrected field can only be one a referee could
 * have picked in the first place.
 */
export const FIELD_PREFIXES = ["ES", "MS", "HS", "BL", "SK"] as const;

const FIELD_PICK = new RegExp(`^(${FIELD_PREFIXES.join("|")})(\\d{1,4})$`);

export function isValidFieldPick(field: string): boolean {
  return FIELD_PICK.test(field);
}

/** Split a stored field back into the form's two boxes. Anything that is
 *  not a pick (a legacy free-text field) comes back empty, to be re-picked. */
export function splitField(field: string | null | undefined): { prefix: string; number: string } {
  const match = FIELD_PICK.exec(field ?? "");
  return match ? { prefix: match[1], number: match[2] } : { prefix: "", number: "" };
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
   *  IQ; a new flag has none and falls back to VEX IQ. */
  defaultRuleset?: string | null;
};

/** Validate and normalize every referee-editable report field. */
export function parseFlagFields(
  body: Record<string, unknown>,
  { allowLegacyRulelessKind = null, defaultRuleset = null }: ParseOptions = {},
): FlagFieldParseResult {
  const kind = resolveFlagKind(body.kind);
  // Optional: match, severity and (where required) rule are enough to
  // record a report. Keep any supplied context, capped for storage.
  const text = String(body.body ?? "").trim().slice(0, 500);

  const matchType = String(body.matchType ?? "").trim().toUpperCase();
  if (!isValidMatchType(matchType)) {
    return {
      ok: false,
      status: 400,
      error: `Pick which match this was — ${matchTypes()
        .map((t) => `${t.id} (${t.label})`)
        .join(", ")}.`,
    };
  }

  const matchNumber = normalizeMatchNumber(body.matchNumber);
  if (!isValidMatchNumber(matchNumber)) {
    return { ok: false, status: 400, error: "Enter the match number." };
  }

  const field = normalizeField(body.field).toUpperCase();
  if (!isValidFieldPick(field)) {
    return { ok: false, status: 400, error: "Pick which field this was — a division and a number, like ES2." };
  }

  // The ruleset decides which ids are real, so it is checked first. Missing
  // means "not told" (VEX IQ, or the flag's own on a correction); a name
  // that is present but unknown is a bad request, not a guess.
  const rawRuleset = String(body.ruleset ?? "").trim();
  if (rawRuleset && !isValidRulesetId(rawRuleset)) {
    return { ok: false, status: 400, error: "That's not a recognised ruleset." };
  }
  const ruleset = getRuleset(rawRuleset || defaultRuleset || DEFAULT_RULESET_ID);

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
