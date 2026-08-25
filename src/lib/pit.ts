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
 * Every row runs from 1 to the widest position anywhere on the floor, so
 * the columns line up between rows and a gap reads as a gap rather than
 * shifting everything after it along.
 */
export function buildFloorPlan<T>(
  items: T[],
  pitOf: (item: T) => string | null,
): { row: string; cells: (T | null)[]; from: number; to: number }[] {
  const placed = new Map<string, Map<number, T>>();
  let widest = 0;

  for (const item of items) {
    const pit = parsePit(pitOf(item));
    if (!pit) continue;

    const row = placed.get(pit.row) ?? new Map<number, T>();
    row.set(pit.position, item);
    placed.set(pit.row, row);
    widest = Math.max(widest, pit.position);
  }

  return [...placed.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([row, cells]) => {
      const taken = [...cells.keys()].sort((a, b) => a - b);
      return {
        row,
        cells: Array.from({ length: widest }, (_, i) => cells.get(i + 1) ?? null),
        // The span this row actually occupies. Positions outside it belong
        // to somebody else — drawing them as empty pits would say a pit is
        // free when another division is standing in it.
        from: taken[0],
        to: taken[taken.length - 1],
      };
    });
}
