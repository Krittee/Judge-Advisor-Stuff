/**
 * The colour vocabulary the config files speak, mapped onto the palette
 * the interface actually uses.
 *
 * `config/event.json` and `config/rubrics.json` let an organiser name a
 * colour -- "amber", "rose" -- for a notebook category, a referee flag or
 * a score band. Those names used to be turned into Tailwind utilities in
 * three separate components, each with its own copy of the table and its
 * own drift. They resolve here instead, once, onto the semantic tokens,
 * so a colour means the same thing wherever it lands and both themes are
 * handled by the token rather than by a per-utility override.
 *
 * The distinction that keeps the board readable:
 *
 *   SOLID fill   a live queue status -- something is happening now
 *   TINTED fill  an attribute of a team -- a band, a category, a flag
 *
 * Only the first kind competes for attention, which is why a referee flag
 * in orange never reads as "this team is waiting", even though waiting is
 * also orange. One is a filled tile, the other a hairline pill.
 */

/** Tinted pill: an attribute, not a state. */
const TONES: Record<string, string> = {
  emerald: "bg-done/18 text-done-quiet ring-done/40",
  sky: "bg-enroute/18 text-enroute-quiet ring-enroute/40",
  amber: "bg-caution/18 text-caution-quiet ring-caution/40",
  orange: "bg-waiting/18 text-waiting-quiet ring-waiting/40",
  violet: "bg-active/18 text-active-quiet ring-active/40",
  rose: "bg-danger/18 text-danger-quiet ring-danger/40",
  fuchsia: "bg-active/18 text-active-quiet ring-active/40",
  teal: "bg-done/18 text-done-quiet ring-done/40",
  zinc: "bg-off text-off-ink ring-line",
};

/** Solid, for the button a referee taps to record one. */
const SOLIDS: Record<string, string> = {
  emerald: "bg-done text-done-ink hover:bg-done-quiet",
  sky: "bg-enroute text-enroute-ink hover:bg-enroute-quiet",
  amber: "bg-caution text-waiting-ink hover:bg-caution-quiet",
  orange: "bg-waiting text-waiting-ink hover:bg-waiting-quiet",
  violet: "bg-active text-active-ink hover:bg-active-quiet",
  rose: "bg-danger text-danger-ink hover:bg-danger-quiet",
  fuchsia: "bg-active text-active-ink hover:bg-active-quiet",
  teal: "bg-done text-done-ink hover:bg-done-quiet",
  zinc: "bg-surface-2 text-ink-muted hover:bg-surface",
};

/** A solid bar, for places too tight for a pill. */
const RAILS: Record<string, string> = {
  emerald: "bg-done",
  sky: "bg-enroute",
  amber: "bg-caution",
  orange: "bg-waiting",
  violet: "bg-active",
  rose: "bg-danger",
  fuchsia: "bg-active",
  teal: "bg-done",
  zinc: "bg-line-strong",
};

/** An unknown colour name falls back to neutral rather than disappearing. */
export function tone(color: string | undefined): string {
  return TONES[color ?? ""] ?? TONES.zinc;
}

export function toneSolid(color: string | undefined): string {
  return SOLIDS[color ?? ""] ?? SOLIDS.zinc;
}

export function toneRail(color: string | undefined): string {
  return RAILS[color ?? ""] ?? RAILS.zinc;
}
