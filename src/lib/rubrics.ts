import rubricFile from "../../config/rubrics.json";

/**
 * Scoring rubrics, read from config/rubrics.json.
 *
 * Topics only, deliberately: judges keep the printed rubric with its
 * listen-fors in front of them, and this is only where the points land.
 * Rubrics change between seasons, so they live in config rather than in
 * code.
 */

export type ScalePoint = { value: number; label: string; short: string };
export type Criterion = { id: string; label: string; section: string };

export type Rubric = {
  id: string;
  name: string;
  /** True while the criteria are a stand-in for the real rubric. */
  placeholder: boolean;
  scale: ScalePoint[];
  sections: { name: string; criteria: Criterion[] }[];
  criteria: Criterion[];
  /** Highest total this rubric can award. */
  max: number;
};

export type Band = { id: string; label: string; minPercent: number; color: string };

const raw = rubricFile as Record<string, unknown>;

const FALLBACK_SCALE: ScalePoint[] = [
  { value: 0, label: "Not Yet", short: "0" },
  { value: 1, label: "Yes", short: "1" },
  { value: 2, label: "Yes, with specifics", short: "2" },
];

function parseScale(input: unknown, fallback: ScalePoint[]): ScalePoint[] {
  if (!Array.isArray(input) || !input.length) return fallback;

  const points = input
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      const value = Number(o.value);
      if (!Number.isFinite(value)) return null;
      return {
        value,
        label: String(o.label ?? value),
        short: String(o.short ?? value),
      };
    })
    .filter((p): p is ScalePoint => p !== null)
    .sort((a, b) => a.value - b.value);

  return points.length ? points : fallback;
}

/**
 * A criterion's id is derived from its text, so scores stay attached to
 * the right row when the file is reordered. Renaming a criterion does
 * detach its scores — which is the honest outcome, since it is no longer
 * the same thing being measured.
 */
function criterionId(rubricId: string, label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${rubricId}:${slug}`;
}

let cached: Rubric[] | null = null;

export function rubrics(): Rubric[] {
  if (cached) return cached;

  const sharedScale = parseScale(raw.scale, FALLBACK_SCALE);
  const list = Array.isArray(raw.rubrics) ? raw.rubrics : [];

  cached = list
    .map((entry) => {
      const r = (entry ?? {}) as Record<string, unknown>;
      const id = String(r.id ?? "").trim();
      const name = String(r.name ?? "").trim();
      if (!id || !name) return null;

      const scale = parseScale(r.scale, sharedScale);
      const top = scale[scale.length - 1]?.value ?? 0;

      const sections = (Array.isArray(r.sections) ? r.sections : [])
        .map((s) => {
          const o = (s ?? {}) as Record<string, unknown>;
          const sectionName = String(o.name ?? "").trim();
          const criteria = (Array.isArray(o.criteria) ? o.criteria : [])
            .map((c) => String(c ?? "").trim())
            .filter(Boolean)
            .map((label) => ({ id: criterionId(id, label), label, section: sectionName }));
          return { name: sectionName, criteria };
        })
        .filter((s) => s.criteria.length);

      const criteria = sections.flatMap((s) => s.criteria);
      if (!criteria.length) return null;

      return {
        id,
        name,
        placeholder: Boolean(r.placeholder),
        scale,
        sections,
        criteria,
        max: criteria.length * top,
      };
    })
    .filter((r): r is Rubric => r !== null);

  return cached;
}

export function rubricById(id: string): Rubric | null {
  return rubrics().find((r) => r.id === id) ?? null;
}

/** The most any team can score across every rubric. */
export function grandTotalMax(): number {
  return rubrics().reduce((sum, r) => sum + r.max, 0);
}

const FALLBACK_BANDS: Band[] = [
  { id: "top", label: "Top", minPercent: 85, color: "emerald" },
  { id: "strong", label: "Strong", minPercent: 70, color: "sky" },
  { id: "middle", label: "Middle", minPercent: 50, color: "amber" },
  { id: "developing", label: "Developing", minPercent: 0, color: "zinc" },
];

export function bands(): Band[] {
  const list = Array.isArray(raw.bands) ? raw.bands : [];

  const parsed = list
    .map((b) => {
      const o = (b ?? {}) as Record<string, unknown>;
      const minPercent = Number(o.minPercent);
      if (!Number.isFinite(minPercent)) return null;
      return {
        id: String(o.id ?? o.label ?? minPercent),
        label: String(o.label ?? ""),
        minPercent: Math.max(0, Math.min(100, minPercent)),
        color: String(o.color ?? "zinc"),
      };
    })
    .filter((b): b is Band => b !== null)
    // Highest threshold first, so the first match is the right one.
    .sort((a, b) => b.minPercent - a.minPercent);

  return parsed.length ? parsed : FALLBACK_BANDS;
}

/**
 * Which colour band a total falls into.
 *
 * Returns null for a team nobody has scored yet — an unscored team is
 * not "developing", it is simply unknown, and colouring it would be a
 * lie on the ranking board.
 */
export function bandFor(total: number, max: number, scored: boolean): Band | null {
  if (!scored || max <= 0) return null;
  const percent = (total / max) * 100;
  return bands().find((b) => percent >= b.minPercent) ?? bands()[bands().length - 1];
}

/** Clamp a submitted point value to something this rubric actually offers. */
export function isValidPoint(rubric: Rubric, value: number): boolean {
  return rubric.scale.some((p) => p.value === value);
}

/**
 * The rubrics that actually apply to a team, given its category.
 *
 * A team whose notebook is Ungraded has no notebook mark — not a mark of
 * zero. Scoring them out of the full 76 would rank them below every team
 * whose notebook was merely weak, on the strength of a judgement nobody
 * made. So the rubric drops out of their total and out of the denominator
 * their colour band is worked against, and they are ranked on what was
 * actually judged.
 *
 * Which rubrics a category drops is set per category in config/event.json.
 */
export function rubricsFor(
  all: Rubric[],
  category: string | null | undefined,
  categories: { id: string; excludesRubrics?: string[] }[],
): Rubric[] {
  const excluded = categories.find((c) => c.id === category)?.excludesRubrics ?? [];
  if (!excluded.length) return all;

  const kept = all.filter((r) => !excluded.includes(r.id));
  // Never leave a team with nothing to be judged on: a category that
  // excluded every rubric would rank everyone at zero out of zero.
  return kept.length ? kept : all;
}

/** A team's total and denominator, counting only the rubrics that apply. */
export function totalFor(
  scores: { rubric_id: string; total: number; values?: Record<string, unknown> | null }[],
  applicable: Rubric[],
): { total: number; max: number; scored: boolean } {
  const ids = new Set(applicable.map((r) => r.id));
  const counted = scores.filter((s) => ids.has(s.rubric_id));
  return {
    total: counted.reduce((sum, s) => sum + s.total, 0),
    max: applicable.reduce((sum, r) => sum + r.max, 0),
    scored: counted.some((s) => Object.keys(s.values ?? {}).length > 0),
  };
}
