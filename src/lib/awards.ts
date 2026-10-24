import type { FlagRow } from "./types";

/* The one rule that lets referees speak for an award: referees do not nominate,
   but a team they flagged for Good conduct twice or more counts as nominated
   for Sportsmanship. The winners route checks it and the Judge Advisor's board
   draws it, so both read it here. Fixed on purpose, not configurable. */

/** The award referees' Good conduct flags count toward (config/event.json). */
export const SPORTSMANSHIP = "sportsmanship";

/** The flag kind that counts (config/event.json's refereeFlags). */
export const GOOD_CONDUCT = "good";

/** Good conduct flags it takes to count as nominated. */
export const GOOD_CONDUCT_MIN = 2;

/** team id -> how many Good conduct flags, for the teams that have at least GOOD_CONDUCT_MIN. */
export function goodConductTeams(flags: Pick<FlagRow, "team_id" | "kind">[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of flags) if (f.kind === GOOD_CONDUCT) counts.set(f.team_id, (counts.get(f.team_id) ?? 0) + 1);
  return new Map([...counts].filter(([, n]) => n >= GOOD_CONDUCT_MIN));
}
