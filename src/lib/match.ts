/**
 * Match number and field, as a referee types them while standing at the
 * table between matches.
 *
 * Neither is validated against a live match schedule — this app has no
 * idea what match is running — so both are exactly what the referee
 * types, tidied up enough to sort and compare cleanly later.
 */

/** VEX events run long before a 4-digit match number would be needed. */
const MAX_MATCH_NUMBER_LENGTH = 4;

/** "Field 1", "Red", "A" — a label, not a code, so length is generous. */
const MAX_FIELD_LENGTH = 40;

export function normalizeMatchNumber(input: unknown): string {
  const digits = String(input ?? "")
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "");
  return digits.slice(0, MAX_MATCH_NUMBER_LENGTH);
}

export function isValidMatchNumber(value: string): boolean {
  return value.length > 0 && value.length <= MAX_MATCH_NUMBER_LENGTH && /^\d+$/.test(value);
}

/** Strip anything a match number may not contain, for use while typing. */
export function filterMatchNumberInput(input: string): string {
  return normalizeMatchNumber(input);
}

export function normalizeField(input: unknown): string {
  return String(input ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_FIELD_LENGTH);
}

export function isValidField(value: string): boolean {
  return value.length > 0 && value.length <= MAX_FIELD_LENGTH;
}

/**
 * "Q23" — the compact reference a referee, a judge and a head referee all
 * read the same way. The match type's own id doubles as its short code,
 * since that is exactly the letter the config already hands out (P/Q/F).
 */
export function matchReference(matchType: string | null, matchNumber: string | null): string | null {
  if (!matchType || !matchNumber) return null;
  return `${matchType}${matchNumber}`;
}
