/**
 * Pit codes.
 *
 * A pit is a letter and a number — A1, B7, C12. That shape is what makes
 * a floor plan possible without anyone drawing one: the letter is the
 * row, the number is the position along it, and the grid falls out.
 */

export type PitCode = { row: string; position: number; label: string };

const PIT = /^([A-Z])\s*0*(\d{1,3})$/;

/** Tidy what someone typed: "a 1", "A01" and "A1" are the same pit. */
export function normalizePit(input: unknown): string | null {
  const raw = String(input ?? "")
    .replace(/\s+/g, "")
    .toUpperCase()
    // Tolerate the older free-text style so existing rosters still parse.
    .replace(/^PIT/, "");

  if (!raw) return null;

  const match = PIT.exec(raw);
  if (!match) return raw.slice(0, 12); // keep it, just don't pretend it maps

  const [, row, position] = match;
  return `${row}${Number(position)}`;
}

export function parsePit(pit: string | null): PitCode | null {
  if (!pit) return null;
  const match = PIT.exec(pit.toUpperCase());
  if (!match) return null;

  const [, row, position] = match;
  return { row, position: Number(position), label: `${row}${Number(position)}` };
}

export function isMappablePit(pit: string | null): boolean {
  return parsePit(pit) !== null;
}

/** Reading order: down the rows, along each one. */
export function comparePits(a: string | null, b: string | null): number {
  const pa = parsePit(a);
  const pb = parsePit(b);

  if (!pa && !pb) return (a ?? "").localeCompare(b ?? "");
  if (!pa) return 1; // unmappable pits sort to the end
  if (!pb) return -1;

  return pa.row.localeCompare(pb.row) || pa.position - pb.position;
}

/**
 * Lay the pits out as rows.
 *
 * Each row is drawn across its own span only, from its first position to
 * its last. Positions outside that span belong to somebody else: drawing
 * them as empty pits would say a pit is free when another division is
 * standing in it. A gap inside the span is still a real empty pit.
 *
 * Two teams on one pit are both kept, in the same cell, so neither can
 * silently disappear from the plan.
 */
export function buildFloorPlan<T>(
  items: T[],
  pitOf: (item: T) => string | null,
): { row: string; cells: T[][]; from: number; to: number }[] {
  const placed = new Map<string, Map<number, T[]>>();

  for (const item of items) {
    const pit = parsePit(pitOf(item));
    if (!pit) continue;

    const row = placed.get(pit.row) ?? new Map<number, T[]>();
    row.set(pit.position, [...(row.get(pit.position) ?? []), item]);
    placed.set(pit.row, row);
  }

  return [...placed.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([row, cells]) => {
      const taken = [...cells.keys()].sort((a, b) => a - b);
      const from = taken[0];
      const to = taken[taken.length - 1];
      return {
        row,
        // An empty array is a pit nobody is on; more than one entry is a clash.
        cells: Array.from({ length: to - from + 1 }, (_, i) => cells.get(from + i) ?? []),
        from,
        to,
      };
    });
}
