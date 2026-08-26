import presetFile from "../../config/event.json";
import { normalizePanelCode } from "./panelCode";

/**
 * Preset panels, read from config/event.json.
 *
 * These seed the roster the first time the app starts with no panels, so
 * you can set your divisions and judge codes once in a file you can edit
 * and re-deploy. After the first run the admin console owns them —
 * editing the file again will not overwrite what is already there.
 */

export type PresetPanel = {
  name: string;
  division: string;
  code: string;
  judges: string[];
  /** ISO timestamp of the first bookable slot, or null for walk-up only. */
  slotStartAt: string | null;
  slotMinutes: number;
  slotCount: number;
};

export const DEFAULT_DIVISION = "Division 1";

export type TeamCategory = { id: string; label: string; color: string };
export type Language = { id: string; label: string; short: string };

type RawPreset = {
  divisions?: unknown;
  languages?: unknown;
  teamCategories?: unknown;
  booking?: unknown;
  panels?: unknown;
};

type Booking = { startTime: string; slotMinutes: number; slotCount: number };

const BOOKING_FALLBACK: Booking = { startTime: "09:00", slotMinutes: 15, slotCount: 12 };

const raw = presetFile as RawPreset;

/** The divisions this event runs. Always at least one. */
export function presetDivisions(): string[] {
  const list = Array.isArray(raw.divisions)
    ? raw.divisions.map((d) => String(d).trim()).filter(Boolean)
    : [];
  return list.length ? unique(list) : [DEFAULT_DIVISION];
}

const LANGUAGE_FALLBACK: Language[] = [
  { id: "en", label: "English", short: "EN" },
  { id: "th", label: "ไทย (Thai)", short: "TH" },
];

/** The languages interviews are conducted in. Always at least one. */
export function languages(): Language[] {
  const list = Array.isArray(raw.languages) ? raw.languages : [];

  const parsed = list
    .map((l) => {
      const o = (l ?? {}) as Record<string, unknown>;
      const id = String(o.id ?? "").trim().toLowerCase();
      if (!id) return null;
      return {
        id,
        label: String(o.label ?? id),
        short: String(o.short ?? id).toUpperCase().slice(0, 4),
      };
    })
    .filter((l): l is Language => l !== null);

  return parsed.length ? parsed : LANGUAGE_FALLBACK;
}

export function defaultLanguage(): string {
  return languages()[0].id;
}

/** Map free text onto a real language, by id, short code or label. */
export function resolveLanguage(input: unknown): string {
  const wanted = String(input ?? "").trim().toLowerCase();
  if (!wanted) return defaultLanguage();

  const match = languages().find(
    (l) =>
      l.id.toLowerCase() === wanted ||
      l.short.toLowerCase() === wanted ||
      l.label.toLowerCase() === wanted,
  );
  return match ? match.id : defaultLanguage();
}

const CATEGORY_FALLBACK: TeamCategory[] = [
  { id: "developing", label: "Developing", color: "amber" },
  { id: "fully-developed", label: "Fully Developed", color: "violet" },
];

/**
 * The two kinds of team, kept apart by colour everywhere a team appears.
 *
 * Configured rather than hard-coded so the labels can match whatever the
 * event calls them; the ids are what gets stored, so those should stay
 * put once teams are assigned.
 */
export function teamCategories(): TeamCategory[] {
  const list = Array.isArray(raw.teamCategories) ? raw.teamCategories : [];

  const parsed = list
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      const id = String(o.id ?? "").trim();
      if (!id) return null;
      return {
        id,
        label: String(o.label ?? id),
        color: String(o.color ?? "zinc"),
      };
    })
    .filter((c): c is TeamCategory => c !== null);

  return parsed.length ? parsed : CATEGORY_FALLBACK;
}

/** What a team is until someone says otherwise. */
export function defaultCategory(): string {
  return teamCategories()[0].id;
}

/** Map free text onto a real category, by id or by label. */
export function resolveCategory(input: unknown): string {
  const wanted = String(input ?? "").trim().toLowerCase();
  if (!wanted) return defaultCategory();

  const match = teamCategories().find(
    (c) => c.id.toLowerCase() === wanted || c.label.toLowerCase() === wanted,
  );
  return match ? match.id : defaultCategory();
}

/** The booking grid every preset panel starts with. */
function bookingDefaults(): Booking {
  const raw2 = (raw.booking ?? {}) as Record<string, unknown>;
  const startTime = String(raw2.startTime ?? BOOKING_FALLBACK.startTime);

  return {
    startTime: /^\d{1,2}:\d{2}$/.test(startTime) ? startTime : BOOKING_FALLBACK.startTime,
    slotMinutes: clamp(raw2.slotMinutes, 3, 120, BOOKING_FALLBACK.slotMinutes),
    slotCount: clamp(raw2.slotCount, 0, 60, BOOKING_FALLBACK.slotCount),
  };
}

/**
 * Turn "09:00" into a real timestamp on the day the panels are created.
 *
 * A clock time is what someone editing a config file wants to write; a
 * date they would have to remember to change every event is not.
 */
function resolveStart(startTime: string, slotCount: number): string | null {
  if (slotCount <= 0) return null;

  const [hours, minutes] = startTime.split(":").map(Number);
  const when = new Date();
  when.setHours(hours, minutes, 0, 0);
  return when.toISOString();
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Panels to create on first run.
 *
 * A malformed entry is dropped rather than thrown: a typo in a config
 * file should not stop the app from starting on event morning.
 */
export function presetPanels(): PresetPanel[] {
  if (!Array.isArray(raw.panels)) return [];

  const divisions = presetDivisions();
  const defaults = bookingDefaults();
  const seen = new Set<string>();
  const panels: PresetPanel[] = [];

  for (const entry of raw.panels) {
    if (!entry || typeof entry !== "object") continue;
    const p = entry as Record<string, unknown>;

    const name = String(p.name ?? "").trim().slice(0, 80);
    const code = normalizePanelCode(p.code);
    if (!name || !code || seen.has(code)) continue;
    seen.add(code);

    const wanted = String(p.division ?? "").trim();
    // A panel may override any part of the shared booking grid.
    const slotMinutes = clamp(p.slotMinutes, 3, 120, defaults.slotMinutes);
    const slotCount = clamp(p.slotCount, 0, 60, defaults.slotCount);
    const startTime = String(p.startTime ?? defaults.startTime);

    panels.push({
      name,
      // An unknown division would strand the panel where no team can
      // reach it, so fall back to the first configured one.
      division: divisions.includes(wanted) ? wanted : divisions[0],
      code,
      judges: Array.isArray(p.judges)
        ? p.judges.map((j) => String(j).trim()).filter(Boolean).slice(0, 12)
        : [],
      slotMinutes,
      slotCount,
      slotStartAt: resolveStart(
        /^\d{1,2}:\d{2}$/.test(startTime) ? startTime : defaults.startTime,
        slotCount,
      ),
    });
  }

  return panels;
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}
