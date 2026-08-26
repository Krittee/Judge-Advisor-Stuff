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

/**
 * Read a list of team numbers written out by hand.
 *
 * A panel asked "any teams you're affiliated with?" writes the answer down
 * however they like — commas, spaces, semicolons, one per line, or a mix —
 * so all of those separate. Numbers are normalised and de-duplicated, and
 * order is preserved so what comes back can be read against what was typed.
 */
export function parseTeamNumberList(input: string): string[] {
  const seen = new Set<string>();
  for (const raw of String(input ?? "").split(/[\s,;]+/)) {
    const number = normalizeTeamNumber(raw);
    if (number) seen.add(number);
  }
  return [...seen];
}

/**
 * Find suffixes that have come adrift from their number.
 *
 * In a list, a space separates entries — so "9882 K" reads as two entries,
 * 9882 and K, rather than one team. Left alone that records a conflict
 * against team 9882, who may well exist and be someone else entirely, while
 * 9882K stays judgeable. No VIQRC team is a bare letter or two, so treat
 * those as a stray space and make the caller ask rather than guess.
 */
export function danglingSuffixes(input: string): string[] {
  return parseTeamNumberList(input).filter((n) => n.length <= 2 && !/\d/.test(n));
}
