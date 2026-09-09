import rulesFile from "../../config/rules.json";

/**
 * The VIQRC Level Up Quick Reference rule list, read from config/rules.json.
 *
 * A referee searches this by id, number or plain-English keyword to pick
 * what a violation was against. The data lives in config, the same way
 * rubrics.json does, so tests can read the real ruleset directly rather
 * than a hand-mirrored copy -- this repo's tests run under plain
 * `node --test` with no TypeScript loader (see tests/flags.test.mjs).
 * The season's ruleset is fixed by VEX, not something an event organizer
 * customizes per event, so unlike refereeFlags/matchTypes in
 * config/event.json there is no admin UI over this file.
 */

export type Rule = {
  id: string;
  /** "<SG6>" -- how the id reads on screen. */
  displayId: string;
  category: string;
  /** The Quick Reference's own wording. Kept apart from shortLabel so the
   *  referee-friendly label never has to be the whole sentence. */
  officialTitle: string;
  /** What a referee actually reads day to day: "<SG6> Possession / Plowing". */
  shortLabel: string;
  /** Lowercase terms a referee might type. Partial, case-insensitive match. */
  searchKeywords: string[];
};

/** Category order, exactly as the Quick Reference groups them. */
export const RULE_CATEGORIES = [
  "Scoring Rules",
  "Specific Game Rules",
  "Safety Rules",
  "General Rules",
  "General Game Rules",
  "Robot Skills Challenge Rules",
  "Robot Rules",
  "Tournament Rules",
] as const;

/**
 * Shortcuts shown at the top of the selector. Reference the same Rule
 * objects as the full list -- never a duplicate copy -- so correcting a
 * rule's wording in one place can never leave the other stale.
 */
export const COMMON_FIELD_RULE_IDS = ["SG6", "SG7", "GG4", "GG10", "GG12", "SG2", "S1"] as const;

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
      if (!id || !category || !officialTitle || !shortLabel) return null;

      const searchKeywords = Array.isArray(o.searchKeywords)
        ? o.searchKeywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean)
        : [];

      return {
        id,
        displayId: `<${id}>`,
        category,
        officialTitle,
        shortLabel,
        searchKeywords: [...new Set([id.toLowerCase(), ...searchKeywords])],
      };
    })
    .filter((r): r is Rule => r !== null);
}

export const RULES: Rule[] = parseRules(rulesFile);

const BY_ID = new Map(RULES.map((r) => [r.id, r]));

export function findRule(id: string | null | undefined): Rule | null {
  if (!id) return null;
  return BY_ID.get(String(id).trim().toUpperCase()) ?? null;
}

export function isValidRuleId(id: unknown): boolean {
  return typeof id === "string" && BY_ID.has(id.trim().toUpperCase());
}

/** "<SG6> Possession / Plowing", or null when there is no rule to show. */
export function ruleDisplayLabel(id: string | null | undefined): string | null {
  const found = findRule(id);
  return found ? `${found.displayId} ${found.shortLabel}` : null;
}

export function commonFieldRules(): Rule[] {
  return COMMON_FIELD_RULE_IDS.map((id) => BY_ID.get(id)).filter((r): r is Rule => Boolean(r));
}

/**
 * Search by id, display id, short label, official title or keyword.
 * Partial and case-insensitive throughout -- "plow" must find SG6, "hand"
 * must find every hands-related rule.
 */
export function searchRules(query: string): Rule[] {
  const q = query.trim().toLowerCase();
  if (!q) return RULES;
  return RULES.filter(
    (r) =>
      r.id.toLowerCase().includes(q) ||
      r.displayId.toLowerCase().includes(q) ||
      r.shortLabel.toLowerCase().includes(q) ||
      r.officialTitle.toLowerCase().includes(q) ||
      r.searchKeywords.some((k) => k.includes(q)),
  );
}
