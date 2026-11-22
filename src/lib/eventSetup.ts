import { presetDivisions, presetPrograms, type Program } from "./presets";
import type { AwardView, EventFormat, EventSetup } from "./types";

/**
 * Event setup helpers: which key (a division, or "Whole event") an award is
 * decided under. Pure and client-safe. Standard events key every award by
 * division; a Blended one keys only the `blendedScope: "division"` awards that
 * way and decides the rest once.
 */

export const WHOLE_EVENT = "Whole event";

type Setup = Pick<EventSetup, "program" | "format"> | null | undefined;
type Scoped = Pick<AwardView, "blendedScope">;

const perDivision = (award: Scoped, format?: EventFormat | null) => format !== "blended" || award.blendedScope === "division";

/** The saved program's divisions; null with no setup, or a program config no longer lists. */
export function setupDivisions(setup: Setup, programs: Program[] = presetPrograms()): string[] | null {
  return (setup && programs.find((p) => p.label === setup.program)?.divisions) || null;
}

/** The keys an award is decided under. */
export function awardKeys(award: Scoped, divisions: string[], format?: EventFormat | null): string[] {
  return perDivision(award, format) ? divisions : [WHOLE_EVENT];
}

/** The one key a team's decision on this award goes under. */
export function awardKey(award: Scoped, teamDivision: string, format?: EventFormat | null): string {
  return perDivision(award, format) ? teamDivision : WHOLE_EVENT;
}

/** The awards decided under one key: all of them unless blended. */
export function awardsUnder<A extends Scoped>(awards: A[], key: string, format?: EventFormat | null): A[] {
  return format === "blended" ? awards.filter((a) => (a.blendedScope === "division") === (key !== WHOLE_EVENT)) : awards;
}

/** The board's keys: divisions, then WHOLE_EVENT when blended. */
export function scopeKeys(divisions: string[], format?: EventFormat | null): string[] {
  return format === "blended" ? [...divisions, WHOLE_EVENT] : divisions;
}

/** Every (award, key) pair, key-major then config order: what Send all ready walks. */
export function awardPairs<A extends Scoped>(awards: A[], divisions: string[], format?: EventFormat | null): { award: A; division: string }[] {
  return scopeKeys(divisions, format).flatMap((division) => awardsUnder(awards, division, format).map((award) => ({ award, division })));
}

/** Why `division` is the wrong key for this award under this setup; null when fine, ALWAYS null with no setup. */
export function keyError(award: Pick<AwardView, "label" | "blendedScope">, division: string, setup: Setup): string | null {
  const divisions = setupDivisions(setup);
  if (!setup || !divisions) return null;
  if (!perDivision(award, setup.format)) return division === WHOLE_EVENT ? null : `${award.label} is given once for the whole event. Use "${WHOLE_EVENT}".`;
  return divisions.includes(division) ? null : `${award.label} is given in each division. Pick one of ${divisions.join(", ")}.`;
}

/** What a team (forPanel=false) or panel (true) may be filed under: setup divisions (+ WHOLE_EVENT for a blended panel), else presetDivisions(); `fallback` is WHOLE_EVENT for a blended panel, else the first option. */
export function divisionChoices(setup: Setup, forPanel: boolean): { options: string[]; fallback: string } {
  const options = setupDivisions(setup) ?? presetDivisions();
  const whole = forPanel && setup?.format === "blended";
  return whole ? { options: [...options, WHOLE_EVENT], fallback: WHOLE_EVENT } : { options, fallback: options[0] };
}

/**
 * Which option `wanted` names: an exact match (any case), else the one option that ends with it as whole
 * words ("Middle School" for "IQ Middle School"). An array when several end that way (ambiguous), null for none.
 */
export function matchDivision(wanted: string, options: string[]): string | string[] | null {
  const w = wanted.trim().toLowerCase();
  if (!w) return null;
  const exact = options.find((o) => o.toLowerCase() === w);
  if (exact) return exact;
  const ends = options.filter((o) => o.toLowerCase().endsWith(` ${w}`));
  return ends.length > 1 ? ends : (ends[0] ?? null);
}

/** The reason an ambiguous division is refused. */
export const ambiguousDivision = (wanted: string, options: string[]): string =>
  `"${wanted}" could be ${options.join(" or ")}. Save the program on the Event page first, or write the full name.`;

/** "VEX IQ · Blended" / "V5RC · Standard". */
export function setupLabel(setup: Pick<EventSetup, "program" | "format">): string {
  return `${setup.program} · ${setup.format === "blended" ? "Blended" : "Standard"}`;
}
