import viqrcFile from "../../config/rules/viqrc.json";
import v5rcFile from "../../config/rules/v5rc-override-2.1.json";
import specialsFile from "../../config/rules/event-specials.json";

/**
 * The rulesets a referee can cite, read from config/rules/*.json.
 *
 * The event runs VEX IQ and V5RC side by side, so a flag names a RULESET
 * first and then one or more rules from it. Each ruleset is one JSON file
 * (id, program, game, label, manual version, common-rule shortcuts, the
 * match types the program runs and the rules themselves); this module is the
 * only place those files are read.
 * The data lives in config, the same way rubrics.json does, so tests can
 * read the real rulesets directly rather than a hand-mirrored copy -- this
 * repo's tests run under plain `node --test` via tsx. A season's rules are
 * fixed by VEX, not something an event organizer customizes per event, so
 * unlike refereeFlags in config/event.json there is no admin UI
 * over these files.
 *
 * To add a new manual version: drop its JSON in config/rules/, import it
 * here and add it to RULESET_FILES. Titles are the official wording and are
 * never edited.
 */

export type Rule = {
  id: string;
  /** "<SG6>" -- how the id reads on screen. */
  displayId: string;
  category: string;
  /** The manual's own wording, verbatim. */
  officialTitle: string;
  /** A short referee-friendly label. Optional: only the IQ data has them,
   *  V5RC rules are shown by code and official title alone. */
  shortLabel?: string;
  /** Lowercase terms a referee might type. Partial, case-insensitive match. */
  searchKeywords: string[];
};

/** A kind of match a flag can be pinned to, as one ruleset offers it. */
export type MatchType = {
  /** Stored on a flag: "Q", "QF", "SKD". */
  id: string;
  label: string;
  /** Skills runs are one team alone; every other type is a Teamwork match. */
  group: "teamwork" | "skills";
  /** Its number is a bracket and a match ("2-1"), not a single number. */
  bracket: boolean;
};

export type Ruleset = {
  /** Stable id stored on a flag ("viqrc", "v5rc"). */
  id: string;
  program: string;
  game: string;
  /** What the dropdown says: "VEX IQ", "V5RC Override". */
  label: string;
  /** The manual edition the rule titles come from; null when not recorded. */
  manualVersion: string | null;
  /** Shortcut ids shown at the top of the picker. */
  commonRuleIds: string[];
  /** The match types a new flag can be pinned to under this program. */
  matchTypes: MatchType[];
  rules: Rule[];
};

/** The official Quick Reference categories, kept independently testable. */
export const QUICK_REFERENCE_RULE_CATEGORIES = [
  "Scoring Rules",
  "Specific Game Rules",
  "Safety Rules",
  "General Rules",
  "General Game Rules",
  "Robot Skills Challenge Rules",
  "Robot Rules",
  "Tournament Rules",
] as const;

/** Official categories followed by this event's intentional custom rules. */
export const RULE_CATEGORIES = [
  ...QUICK_REFERENCE_RULE_CATEGORIES,
  "Tournament Special",
] as const;

/** The categories the picker opens expanded; the rest start collapsed. */
export const DEFAULT_OPEN_RULE_CATEGORIES: readonly string[] = [
  "Scoring Rules",
  "Specific Game Rules",
  "General Game Rules",
];

/** More than this on one flag is a mis-tap or a wall of text, not a report. */
export const MAX_FLAG_RULES = 5;

/** A malformed entry is dropped rather than thrown -- a typo in the data
 *  file should not stop the app from starting on event morning. */
function parseRules(raw: unknown): Rule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): Rule | null => {
      const o = (entry ?? {}) as Record<string, unknown>;
      const id = String(o.id ?? "").trim().toUpperCase();
      const category = String(o.category ?? "").trim();
      const officialTitle = String(o.officialTitle ?? "").trim();
      const shortLabel = String(o.shortLabel ?? "").trim();
      if (!id || !category || !officialTitle) return null;

      const searchKeywords = Array.isArray(o.searchKeywords)
        ? o.searchKeywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean)
        : [];

      return {
        id,
        displayId: `<${id}>`,
        category,
        officialTitle,
        ...(shortLabel ? { shortLabel } : {}),
        searchKeywords: [...new Set([id.toLowerCase(), ...searchKeywords])],
      };
    })
    .filter((r): r is Rule => r !== null);
}

function parseMatchTypes(raw: unknown): MatchType[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): MatchType | null => {
      const o = (entry ?? {}) as Record<string, unknown>;
      const id = String(o.id ?? "").trim();
      if (!id) return null;
      return {
        id,
        label: String(o.label ?? id),
        group: o.group === "skills" ? "skills" : "teamwork",
        bracket: o.bracket === true,
      };
    })
    .filter((t): t is MatchType => t !== null);
}

/** Event specials (TS1-TS3) go after the official categories of EVERY
 *  ruleset, so a sportsmanship report is available whichever is selected. */
const EVENT_SPECIALS = parseRules((specialsFile as { rules?: unknown }).rules);

function parseRuleset(raw: unknown): Ruleset | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const label = String(o.label ?? "").trim();
  if (!id || !label) return null;

  const version = String(o.manualVersion ?? "").trim();
  const rules = [...parseRules(o.rules), ...EVENT_SPECIALS];
  const known = new Set(rules.map((r) => r.id));

  return {
    id,
    program: String(o.program ?? "").trim(),
    game: String(o.game ?? "").trim(),
    label,
    manualVersion: version || null,
    // A shortcut to a rule that is not in the file would render as nothing
    // useful, so it is dropped here rather than at every call site.
    commonRuleIds: (Array.isArray(o.commonRuleIds) ? o.commonRuleIds : [])
      .map((r) => String(r).trim().toUpperCase())
      .filter((r) => known.has(r)),
    matchTypes: parseMatchTypes(o.matchTypes),
    rules,
  };
}

const RULESET_FILES: unknown[] = [viqrcFile, v5rcFile];

export const RULESETS: Ruleset[] = RULESET_FILES.map(parseRuleset).filter(
  (r): r is Ruleset => r !== null,
);

/** Flags recorded before rulesets existed have none, and they ARE IQ. */
export const DEFAULT_RULESET_ID = "viqrc";

const INDEX = new Map(RULESETS.map((rs) => [rs.id, new Map(rs.rules.map((r) => [r.id, r]))]));

/** Unknown or missing resolves to VEX IQ, never throws. */
export function getRuleset(id?: string | null): Ruleset {
  return RULESETS.find((r) => r.id === id) ?? RULESETS.find((r) => r.id === DEFAULT_RULESET_ID) ?? RULESETS[0];
}

/** True only for an id that names a real ruleset (the API rejects the rest). */
export function isValidRulesetId(id: unknown): boolean {
  return typeof id === "string" && RULESETS.some((r) => r.id === id);
}

/** Recorded before Driver and Auto were told apart. Still valid on a flag
 *  that already holds it, never offered for a new one. */
const LEGACY_MATCH_TYPES: MatchType[] = [
  { id: "SK", label: "Skills", group: "skills", bracket: false },
];

/** The type a ruleset offers, or a legacy one; null for anything else. */
export function findMatchType(id: string | null | undefined, rulesetId?: string | null): MatchType | null {
  return (
    getRuleset(rulesetId).matchTypes.find((t) => t.id === id) ??
    LEGACY_MATCH_TYPES.find((t) => t.id === id) ??
    null
  );
}

/** Whether this type's number is a bracket and a match ("2-1"). It depends
 *  on the program: Final is a plain number in VEX IQ and a bracket in V5RC. */
export function isBracketMatch(id: string | null | undefined, rulesetId?: string | null): boolean {
  return findMatchType(id, rulesetId)?.bracket === true;
}

/** "Override Manual v2.1"; just the label when no version is recorded.
 *  The version comes from the data file, never from a component. */
export function manualLabel(ruleset: Ruleset): string {
  return ruleset.manualVersion ? `${ruleset.game} Manual v${ruleset.manualVersion}` : ruleset.label;
}

function findRule(id: string | null | undefined, rulesetId?: string | null): Rule | null {
  if (!id) return null;
  return INDEX.get(getRuleset(rulesetId).id)?.get(String(id).trim().toUpperCase()) ?? null;
}

export function isValidRuleId(id: unknown, rulesetId?: string | null): boolean {
  return typeof id === "string" && findRule(id, rulesetId) !== null;
}

/** "<SG6> — Possession is limited to …": the code, an em dash, then the
 *  manual's own title. Null when there is no rule to show. */
export function ruleDisplayLabel(id: string | null | undefined, rulesetId?: string | null): string | null {
  const found = findRule(id, rulesetId);
  return found ? `${found.displayId} — ${found.officialTitle}` : null;
}

export function commonFieldRules(rulesetId?: string | null): Rule[] {
  return getRuleset(rulesetId)
    .commonRuleIds.map((id) => findRule(id, rulesetId))
    .filter((r): r is Rule => r !== null);
}

/**
 * Search by id, display id, short label, official title or keyword.
 * Partial and case-insensitive throughout -- "SG" lists every Specific Game
 * rule (the id carries the prefix), "holding" finds GG17, "plow" finds
 * IQ's SG6.
 */
export function searchRules(query: string, rulesetId?: string | null): Rule[] {
  const rules = getRuleset(rulesetId).rules;
  const q = query.trim().toLowerCase();
  if (!q) return rules;
  return rules.filter(
    (r) =>
      r.id.toLowerCase().includes(q) ||
      r.displayId.toLowerCase().includes(q) ||
      r.officialTitle.toLowerCase().includes(q) ||
      (r.shortLabel ?? "").toLowerCase().includes(q) ||
      r.searchKeywords.some((k) => k.includes(q)),
  );
}

/**
 * Group rules by category in the manual's order. A category a future manual
 * adds that is not in RULE_CATEGORIES still appears, after the known ones,
 * rather than vanishing from the picker.
 */
export function groupRulesByCategory(rules: Rule[]): { category: string; rules: Rule[] }[] {
  const byCategory = new Map<string, Rule[]>();
  for (const r of rules) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
  const rank = (category: string) => {
    const i = (RULE_CATEGORIES as readonly string[]).indexOf(category);
    return i === -1 ? RULE_CATEGORIES.length : i;
  };
  return [...byCategory.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([category, list]) => ({ category, rules: list }));
}

/** Whether a category's rules show: a search opens every section so a hit is
 *  never hidden inside a closed one; otherwise the referee's own toggles rule. */
export function isCategoryOpen(category: string, query: string, open: ReadonlySet<string>): boolean {
  return query.trim() !== "" || open.has(category);
}

/** Tap a rule: removes it when selected, adds it at the end otherwise, and
 *  ignores an add past MAX_FLAG_RULES. */
export function toggleRule(selected: string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((r) => r !== id);
  return selected.length >= MAX_FLAG_RULES ? selected : [...selected, id];
}

/* ------------------------------------------------------------------ *
 * A flag stores its rules as one comma-joined text column ("GG17,SG9"),
 * so the column type did not have to change for multi-rule flags and a
 * legacy single-rule flag is already a valid one-item list.
 * ------------------------------------------------------------------ */

/** "GG17, sg9,GG17" -> ["GG17", "SG9"]: trimmed, uppercased, de-duplicated. */
export function parseRuleList(rule: string | null | undefined): string[] {
  if (!rule) return [];
  return [
    ...new Set(
      rule
        .split(",")
        .map((r) => r.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

/** The inverse of parseRuleList; null when there is nothing to store. */
export function joinRuleList(ids: string[]): string | null {
  const joined = parseRuleList(ids.join(","));
  return joined.length ? joined.join(",") : null;
}
