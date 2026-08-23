/**
 * Judge panel codes.
 *
 * Read aloud across a noisy room, so the alphabet skips characters that
 * sound or look alike: no 0/O, no 1/I.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizePanelCode(input: unknown): string {
  return String(input ?? "")
    .replace(/\s+/g, "")
    .toUpperCase()
    .slice(0, 16);
}

export function randomPanelCode(length = 6): string {
  return Array.from(
    { length },
    () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
  ).join("");
}
