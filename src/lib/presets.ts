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
};

export const DEFAULT_DIVISION = "Division 1";

type RawPreset = {
  divisions?: unknown;
  panels?: unknown;
};

const raw = presetFile as RawPreset;

/** The divisions this event runs. Always at least one. */
export function presetDivisions(): string[] {
  const list = Array.isArray(raw.divisions)
    ? raw.divisions.map((d) => String(d).trim()).filter(Boolean)
    : [];
  return list.length ? unique(list) : [DEFAULT_DIVISION];
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
    panels.push({
      name,
      // An unknown division would strand the panel where no team can
      // reach it, so fall back to the first configured one.
      division: divisions.includes(wanted) ? wanted : divisions[0],
      code,
      judges: Array.isArray(p.judges)
        ? p.judges.map((j) => String(j).trim()).filter(Boolean).slice(0, 12)
        : [],
    });
  }

  return panels;
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}
