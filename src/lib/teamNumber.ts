/**
 * Team numbers are not numbers.
 *
 * Plenty of programmes label teams with a letter suffix — 9882K, 1234A —
 * so the identifier is text that usually starts with digits. Everything
 * here exists to make that behave the way people expect anyway: 100
 * before 20, and 9882K right after 9882.
 */

/** Longest sensible identifier. Generous; real ones are 3-6 characters. */
const MAX_LENGTH = 12;

const VALID = /^[A-Z0-9][A-Z0-9-]*$/;

/**
 * Tidy up what someone typed.
 *
 * Case-folding is what lets a team find themselves after typing 9882k on
 * a phone keyboard, and stops 9882k and 9882K becoming two teams in the
 * roster.
 */
export function normalizeTeamNumber(input: unknown): string {
  return String(input ?? "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .slice(0, MAX_LENGTH);
}

export function isValidTeamNumber(value: string): boolean {
  return value.length > 0 && value.length <= MAX_LENGTH && VALID.test(value);
}

/** Strip anything a team number may not contain, for use while typing. */
export function filterTeamNumberInput(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, MAX_LENGTH);
}

/**
 * Order team numbers the way a person reading a list would.
 *
 * Compares the leading digits numerically so 100 sorts after 20, then
 * falls back to the remainder so 1234A comes before 1234B. Identifiers
 * with no leading digits sort to the end, alphabetically.
 */
export function compareTeamNumbers(a: string, b: string): number {
  const [, digitsA = "", restA = ""] = /^(\d*)(.*)$/.exec(a ?? "") ?? [];
  const [, digitsB = "", restB = ""] = /^(\d*)(.*)$/.exec(b ?? "") ?? [];

  // No leading digits sorts last; two of those compare as plain text.
  const numA = digitsA === "" ? Number.POSITIVE_INFINITY : Number(digitsA);
  const numB = digitsB === "" ? Number.POSITIVE_INFINITY : Number(digitsB);

  if (numA !== numB) return numA < numB ? -1 : 1;
  return restA.localeCompare(restB);
}
