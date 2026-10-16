import { isValidMatchNumber, normalizeField, normalizeMatchNumber } from "./match";
import { isValidMatchType, matchTypes, refereeFlags, resolveFlagKind } from "./presets";
import { isValidRuleId } from "./rules";

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

export type ParsedFlagFields = {
  kind: string;
  text: string;
  matchType: string;
  matchNumber: string;
  field: string;
  rule: string | null;
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
};

/** Validate and normalize every referee-editable report field. */
export function parseFlagFields(
  body: Record<string, unknown>,
  { allowLegacyRulelessKind = null }: ParseOptions = {},
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

  const rawRule = String(body.rule ?? "").trim().toUpperCase();
  if (rawRule && !isValidRuleId(rawRule)) {
    return { ok: false, status: 400, error: "That's not a recognised rule." };
  }

  // Good Conduct describes positive behavior, not a violated rule. Drop a
  // valid but stale selector value rather than allowing it to contaminate
  // repeated-violation history.
  const rule = kind === "good" ? null : rawRule || null;

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

  return { ok: true, kind, text, matchType, matchNumber, field, rule };
}
