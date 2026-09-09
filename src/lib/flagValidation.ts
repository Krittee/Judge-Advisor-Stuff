import { isValidField, isValidMatchNumber, normalizeField, normalizeMatchNumber } from "./match";
import { isValidMatchType, matchTypes, refereeFlags, resolveFlagKind } from "./presets";
import { isValidRuleId } from "./rules";

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
  const text = String(body.body ?? "").trim().slice(0, 500);
  if (!text) {
    return {
      ok: false,
      status: 400,
      error: "Say what you saw — judges read this without you there to explain.",
    };
  }

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

  const field = normalizeField(body.field);
  if (!isValidField(field)) {
    return { ok: false, status: 400, error: "Enter which field this was." };
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
