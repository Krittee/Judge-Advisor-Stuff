# Live board redesign (direction A, "Panel columns, refined") — implementation prompt

Paste everything below the line into a Claude Code session opened in this repo
(or say: "Implement design/board-redesign/PROMPT.md").

---

Redesign the Live board `/board` (`src/app/board/page.tsx` and
`src/components/PitMap.tsx`) as the approved direction A, "Panel columns,
refined". The design is final; match it, don't redesign it. Work on the
`version-2.0` branch. This is a **UI-only** change: no store, schema or API
changes. One commit.

The board runs on a TV in the judges' room, read from about three metres
away, and teams and spectators open it on phones from the landing page's
"Live board" card. Same layout as today (a column per panel, a pit-floor
view), made calmer and easier to read at distance, with no motion.

## Sources

- **Visual spec:** static mocks in `design/board-redesign/`, dark theme by
  default (each has a `theme` prop; light must work too):
  - `reference-tv.dc.html` — 1920×1080, By panel view
  - `reference-pits.dc.html` — 1920×1080, Pit floor view
  - `reference-phone.dc.html` — 375 wide, By panel view (full 1588px scroll)
  Self-contained HTML mocks (custom `{{hole}}` template, not React). Read
  their `<style>` blocks for sizes, spacing and colours and their markup for
  structure and copy. The event in them is sample data (38 teams, 11:42, 4
  waiting). Their OKLCH tokens are the ones the landing and team pages use.
- **Live canvas:** https://claude.ai/artifact/Nhv45XWtvnnjLwCC768jWc, row
  "Live board · A · Panel columns, refined" (rows B and C are not chosen;
  ignore them).
- **Pattern to copy:** the landing page `src/app/page.tsx` and its
  `.landing` / `lp-*` block in `globals.css`: scope this page the same way
  (`.board` root, `bd-*` classes), replacing today's `.board-*` rules.
- **Today's behaviour lives in:** `src/app/board/page.tsx` (`groupByPanel`,
  `rank`, `TeamTile`, `Tally`), `src/components/PitMap.tsx`
  (`buildFloorPlan`, division tones, `pitFloor` direction from
  `config/event.json`), `src/lib/status.ts`, `src/components/ui.tsx`
  (`ConnectionDot`, `BookingTime`, `Elapsed`), `src/components/nav.tsx`
  (`ConsoleLinks`), `src/components/CategoryChip.tsx`.

## Keep (behaviour that must not regress)

- `useAppState(6000)` polling; public page, no sign-in.
- Every team appears exactly once, showing its most relevant request
  (`groupByPanel` + `rank`: requested beats acknowledged beats
  interviewing beats scheduled beats completed; cancelled counts as none).
- Teams with no panel appear in an "Unassigned" group.
- The time on a tile: a held booking shows its slot clock time
  (`BookingTime`), a live request the elapsed time since it last moved
  (`started_at ?? acknowledged_at ?? requested_at`), a completed one none.
- The header's waiting count = requests in `requested`; it reads "Nobody
  waiting" at zero instead of "0". In interview / complete tallies.
- "Hide completed" (unchecked by default), the By panel / Pit floor toggle,
  the connection dot, `ConsoleLinks` for staff who opened it from a
  console, and the Fullscreen button.
- Pit floor: letter = column, number = position; the direction comes from
  `pitFloor` in config; division shown as the ring, status as the fill; the
  existing `buildFloorPlan` / `comparePits` / `isMappablePit` logic.
- Long team numbers must fit their tile (today's `--num-len` fit, BUG fix
  for a 6-character number clipped to five). Keep that guarantee.
- "No teams imported yet. Sign in as Judge Advisor to add them." when the
  roster is empty.

## The design

### Header (one slim strip)
- Left: app mark + "Judge Queue · VEX IQ · V5RC" small, and "Judging Board"
  (Archivo 700).
- The waiting block, the largest thing on screen: solid `--waiting` fill,
  the count at 96px Archivo 700 and "WAITING FOR A JUDGE" at 28px caps
  beside it (at 1920 wide; scale with the viewport). At zero: a quiet
  surface pill "Nobody waiting".
- Tallies: "3 in interview" (violet number), "8 complete" (green number).
- Right corner, small and muted: the By panel / Pit floor segmented
  toggle, Hide completed, "● Live", console links, Fullscreen, theme toggle.

### By panel (`reference-tv`)
- One column per panel, then a narrow right column holding the
  Unassigned group and the colour key. Each panel card: name (28px), a
  division marker (small square in the division colour) + division name,
  "12 teams" on the right, judges' names under it ("NA" in italics when
  none, as today).
- Tiles in a two-column grid inside each panel, **sorted for the board**:
  requesting (longest wait first), on the way, interviewing, booked (by
  slot time), not yet, complete; team number breaks ties. This is the
  board's own order (don't change `STATUS_META.order`, other pages use it).
- **Requesting tiles span both columns** and are taller (120px at 1920):
  number 64px, "REQUESTING A JUDGE" caps, the wait as "11 min" with the
  number at 84px, solid orange fill with dark ink.
- Other tiles (100px): number 44px + the time on the right (slot clock or
  "5 min"), the status word (`STATUS_META.short`), and the name with the
  notebook marker. Fills: on the way blue, interviewing violet, booked grey,
  complete a quiet green tint, not yet a plain surface with a line border.
  Ink on every fill passes AA in both themes.
- **Notebook marker:** a small circle in the ink colour, filled for Fully
  Developed, half-filled for Developing, hollow for Ungraded. No hue, so it
  never competes with status. Map categories to the three shapes by their
  config order (first/second/third); label them in the key.
- Colour key card at the bottom of the right column: the five statuses +
  not yet, the three notebook markers, the division colours.

### Pit floor (`reference-pits`)
- Same header with Pit floor selected. Columns A–D (from the data, in the
  configured direction) with a "10 pits" count each; each pit a wide row
  tile: pit code small at the left, team number large, the status word +
  time on the right; fill = status, 2px ring = division colour. Empty pit
  codes show as a dashed gap so the floor keeps its shape.
- A one-line key along the bottom: statuses, then each division with "13
  pits · 1 waiting".

### Phone (<768px, `reference-phone`)
- Header: "Judging Board", "● Live", theme toggle; the waiting block
  full-width below; tallies under it; the toggle and Hide completed in one
  row. No Fullscreen and no console links on a phone.
- Panel sections stacked. Live and booked teams as two-column tiles
  (requesting full width). Not yet and complete teams as compact chips,
  four per row, number only (complete chips in the complete tint).
- The key at the bottom.

### Between phone and TV
The layout is fluid: sizes scale with the viewport like today's
`clamp(…vw…)` board variables, so the same page fits a 1366 laptop, a
1080p TV and a 4K TV. The mock values are the 1920-wide targets. Panels
wrap to more rows rather than shrinking tiles below a 44px number.

## Rules

- **No motion.** Drop today's `pulse-waiting` on the board (and its CSS if
  nothing else uses it). Waiting stands out by fill, size and position.
  Hover/focus colour transitions only, off under `prefers-reduced-motion`.
- Colour is signal: status colours only for status, division colours only
  for the division marker/ring, accent only for interactive chrome.
- Light and dark from the shared tokens; dark is the default look the mocks
  show, but the page follows the app's theme like every other page.
- Touch targets ≥44px on phone; at least 4.5:1 text contrast.
- No horizontal scroll at 375px.
- Open question for the user, **don't change it in this task**: the Middle
  School division ring (`--cat-2`, magenta) sits close to the interviewing
  violet on the pit floor. Keep the existing `--cat-*` tokens.

## Tests (must fail if the change is reverted)

- A pure `boardOrder` (or similar) helper: requesting by longest wait, then
  on the way, interviewing, booked by slot time, not yet, complete; ties by
  number. And the notebook marker mapping by category order.
- A runtime render test: requesting tiles get the wide class and "11 min";
  the waiting block shows the count, or "Nobody waiting" at zero; Hide
  completed removes complete tiles; no element on the page has a CSS
  animation (the pulse is gone); the empty-roster line.
- Keep `tests/pitMap.runtime.test.tsx`, `pit.test.mjs`, `pitFloor.test.mjs`
  green (update their markup expectations only where the design changed).
  `npm test`, `npm run typecheck`, `npm run lint` (0 warnings),
  `npm run build`.

## Done when

- `/board` matches the three mocks at 1920×1080 (By panel and Pit floor)
  and 375, in dark, and looks right in light.
- Checked in the browser at 375, 1366 and 1920 with the demo data: a team
  requesting appears first in its panel and wide; move it on from the judge
  console and watch its tile change; Hide completed; Pit floor; the
  6-character team number fits; Fullscreen.
- One local commit on `version-2.0`. No push.
