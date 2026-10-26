import { isBracketMatch } from "./rules";

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

/** Each half of an elimination "2-1": a bracket or a match past 99 does not happen. */
const MAX_BRACKET_PART_LENGTH = 2;

const BRACKET_NUMBER = /^\d{1,2}-\d{1,2}$/;

/** "Field 1", "Red", "A" — a label, not a code, so length is generous. */
const MAX_FIELD_LENGTH = 40;

/**
 * Whether a number is a plain one ("23") or a bracket and a match ("2-1")
 * depends on the match type, and on the program for Final (see
 * isBracketMatch), so every function below takes the type and ruleset the
 * number belongs to. Left out, the number is a plain one.
 */
export function normalizeMatchNumber(
  input: unknown,
  matchType?: string | null,
  rulesetId?: string | null,
): string {
  if (isBracketMatch(matchType, rulesetId)) {
    // Whatever separates the two numbers ("2-1", "2 1", "2/1") becomes a dash.
    const [bracket = "", match] = String(input ?? "").match(/\d+/g) ?? [];
    const part = (digits: string) => digits.replace(/^0+(?=\d)/, "").slice(0, MAX_BRACKET_PART_LENGTH);
    return match === undefined ? part(bracket) : `${part(bracket)}-${part(match)}`;
  }
  const digits = String(input ?? "")
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "");
  return digits.slice(0, MAX_MATCH_NUMBER_LENGTH);
}

export function isValidMatchNumber(
  value: string,
  matchType?: string | null,
  rulesetId?: string | null,
): boolean {
  if (isBracketMatch(matchType, rulesetId)) return BRACKET_NUMBER.test(value);
  return value.length > 0 && value.length <= MAX_MATCH_NUMBER_LENGTH && /^\d+$/.test(value);
}

/** Strip anything a match number may not contain, for use while typing. */
export function filterMatchNumberInput(
  input: string,
  matchType?: string | null,
  rulesetId?: string | null,
): string {
  const typed = normalizeMatchNumber(input, matchType, rulesetId);
  // "2-" has to survive the keystroke before the match number is typed.
  const awaitingMatch =
    isBracketMatch(matchType, rulesetId) && !typed.includes("-") && /\d\D+$/.test(input.trim());
  return awaitingMatch ? `${typed}-` : typed;
}

export function normalizeField(input: unknown): string {
  return String(input ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_FIELD_LENGTH);
}

/** "Field 2" for a picked field. A legacy value ("HS2") reads as it was
 *  recorded; null when there is none. */
export function fieldLabel(field: string | null | undefined): string | null {
  if (!field) return null;
  return /^\d+$/.test(field) ? `Field ${field}` : field;
}

/** What a Skills run is called. The ids are fixed, so the words are too. */
const SKILLS_WORDS: Record<string, string> = { SKD: "Driver", SKA: "Auto", SK: "Skills" };

/**
 * "Q23" — the compact reference a referee, a judge and a head referee all
 * read the same way. The match type's own id doubles as its short code,
 * since that is exactly the letter the config already hands out (P/Q/F).
 * A longer code gets a space ("QF 2-1") and a Skills run is named in words
 * ("Driver 1", "Auto 2", and "Skills 3" for a flag from before the two were
 * told apart).
 */
export function matchReference(matchType: string | null, matchNumber: string | null): string | null {
  if (!matchType || !matchNumber) return null;
  const skills = SKILLS_WORDS[matchType];
  if (skills) return `${skills} ${matchNumber}`;
  return matchType.length > 1 ? `${matchType} ${matchNumber}` : `${matchType}${matchNumber}`;
}
