# Door page redesign (direction B, "Five doors" + key 2, "Sample tiles") — implementation prompt

Paste everything below the line into a Claude Code session opened in this repo
(or say: "Implement design/door-redesign/PROMPT.md").

---

Turn `/` into the Judge Queue's front door: one door per role, as the
approved direction B, "Five doors", with the colour key drawn as sample
tiles inside the Live board card (key option 2). The team-number entry that
`/` shows today (the built "Pit ticket", `design/landing-redesign/`) moves
to `/team`, where the Team door leads. The design is final; match it, don't
redesign it. Work on the `version-2.0` branch. **UI and routing only:** no
store, schema, auth or API changes. One commit.

## Sources

- **Visual spec:** `design/door-redesign/`, both from the canvas row
  "Door page · B · "What the colours mean"", option "Key 2 · Sample tiles":
  - `reference-door-phone.dc.html` — 375 wide, light
  - `reference-door-wide.dc.html` — 1280×800, dark
  Self-contained HTML mocks (custom `{{hole}}` template, not React). Read
  their `<style>` for sizes, spacing and colours, their markup for structure
  and copy. Their avatar paths already point at `public/avatars/*.jpg`.
- **Live canvas:** https://claude.ai/artifact/Nhv45XWtvnnjLwCC768jWc, rows
  "Door page "/" · B · Five doors (chosen)" and the key row (key 2). Rows
  marked "Not chosen" are to be ignored.
- **Existing pieces:** the landing page `src/app/page.tsx` and its
  `.landing` / `lp-*` block in `globals.css` (tokens, top bar, theme toggle,
  Live board card, avatar tiles: reuse); the sign-in pass
  `src/components/SignInForm.tsx` and the role colours / avatar table in
  `design/sign-in-redesign/PROMPT.md`; the Live board tiles in
  `src/components/board/` (status fill + ink pairs: reuse the same values
  for the sample tiles, including the complete tint mixed **in sRGB**, not
  oklch, so it stays green).

## Routes

| Route | Becomes |
|---|---|
| `/` | The door page (new). |
| `/team` | **New route** (`src/app/team/page.tsx`): today's Pit ticket team-number entry, moved, see below. |
| `/team/[number]` | Unchanged (the team page). |
| `/judge/login`, `/referee/login`, `/queue/login`, `/admin/login`, `/login` | Unchanged sign-in doors. `/login` (all-staff) stays reachable but is no longer linked from `/`. |
| `/board` | Unchanged. |

## The door page (`/`)

- Top bar as the landing: app mark, "Judge Queue", muted "VEX IQ · V5RC",
  theme toggle (≥44px).
- Title "Who are you?" and the muted line "Choose your door".
- **Five door cards**, in this order (most people first), each a `next/link`
  to its door:
  | Door | Goes to | Line | Visual |
  |---|---|---|---|
  | Team | `/team` | "Book a time or call a judge" | neutral tile with the ticket glyph (no avatar, no ring); small muted caption under the card: "Opens the team ticket" |
  | Judge | `/judge/login` | "Panel code from your Judge Advisor" | `/avatars/judge.jpg`, accent ring |
  | Referee | `/referee/login` | "Referees and the head referee" | `/avatars/referee.jpg`, the striped ink ring |
  | Queue desk | `/queue/login` | "Check teams in and book times" | `/avatars/queue-desk.jpg`, teal `--desk` ring |
  | Judge Advisor | `/admin/login` | "Runs judging for the event" | `/avatars/judge-advisor.jpg`, violet `--ja` ring |
  Phone: one column of full-width cards (avatar left, name + line, chevron),
  ≥64px tall. ≥1024px: five equal cards in one row, avatar on top, content
  centred (`reference-door-wide`). Avatars are decorative (`alt=""`); the
  role colour only rings the avatar.
- **Live board card with sample tiles** (key 2), under the doors:
  - The card's link row: the board tile image (`/avatars/live-board.jpg`),
    "Live board" + the static LIVE pill, "See every team's judging status",
    chevron. The whole row is the link to `/board` (≥56px).
  - Under it, inside the same card (one border around both): a muted line
    "Each team shows on the board as a tile in one of these colours." and
    five sample tiles for one sample team, `1234A`: Booked `10:40`,
    Requesting `3 min`, On the way, Interviewing, Complete. Each tile: the
    status fill and ink exactly as on the Live board, the number, the status
    word (`STATUS_META[s].short` where it fits the mock's words), the time
    where shown. Phone: 3 + 2 (the last two wider); wide: one row of five in
    a centred card.
  - The tiles are a key, not controls: not focusable, no hover. Give the
    group an accessible name ("What the colours mean") and each tile a text
    label a screen reader reads as one phrase ("Booked, 10:40").
  - The old separate "What the colours mean" card is gone.
- No staff rows, no team-number input on this page.

## The team ticket (`/team`)

Move today's `src/app/page.tsx` Pit ticket here, **behaviour unchanged**
(the number input's filtering, `autoFocus`, validation copy "Enter your team
number, for example 1234 or 9882K.", disabled Continue while empty,
`router.push(`/team/${encodeURIComponent(number)}`)`). Changes:
- Drop the staff rows (Judges / Event team / Referee); they live on `/` now.
- Drop its "What the colours mean" card (the key lives in the Live board
  card on `/`). Keep its Live board card.
- Add a quiet back link at the top, "← All doors" → `/`, ≥44px target.
- Keep the `.landing` / `lp-*` styles (rename only if you must; don't
  restyle).

## Links that change

- `src/components/SignInForm.tsx`: the pass's back link reads "Back to all
  doors" (still `href="/"`).
- `src/components/team/TeamView.tsx`: "← Try another number" on the
  not-found screen goes to `/team`, not `/`.
- `src/components/ui.tsx` `TopBar` brand link stays `/` (the front door).
- Search for any other `href="/"` / `push("/")` meant for teams and point it
  at `/team`; staff-facing ones stay `/`.

## Rules

- No motion: no `@keyframes`, no `animation`; hover/focus colour transitions
  only, off under `prefers-reduced-motion`.
- Colour is signal: status colours only on the sample tiles; role colours
  only on avatar rings; accent only for interactive chrome.
- Light and dark from the shared tokens (the mocks show phone light, wide
  dark; both must work in both themes).
- Touch targets ≥44px; text ≥4.5:1, including small muted lines and the ink
  on every sample tile (both themes).
- No horizontal scroll at 375px; on a 375×812 phone the five doors are all
  on the first screen.
- Scope new styles under a `.doorpage` root with a `dp-*` prefix, in their
  own block in `globals.css` (follow the CSS-scope test pattern the admin
  and team blocks use).

## Tests (must fail if reverted)

- Runtime render of `/`: five door links in order with the right `href`s
  (`/team`, `/judge/login`, `/referee/login`, `/queue/login`,
  `/admin/login`), the Live board link to `/board`, five sample tiles with
  the five status words, no team-number input, no `/login` link.
- `/team`: renders the ticket, the input behaviour test from the landing
  moves with it (empty → disabled, invalid → error copy, valid → pushes
  `/team/<n>`), has the "← All doors" link, has no staff rows.
- Not-found team page links to `/team`; the sign-in back link says "Back to
  all doors".
- Contrast: each sample tile's ink/fill pair ≥4.5:1 in both themes; the
  complete tint's hue stays green (the board's hue-guard test pattern).
- No animation on `/` or `/team`.
- `tests/mobile.test.mjs`: add `/team` to the mobile page list; keep `/`.
- `npm test`, `npm run typecheck`, `npm run lint` (0 warnings),
  `npm run build` all clean.

## Done when

- `/` matches the two mocks (375 light, 1280 dark) and looks right in the
  other theme; `/team` looks like today's ticket minus the staff rows and
  key, with the back link.
- Checked in the browser on a COPY of the data (dev server with `DATA_FILE`
  pointing at a scratch copy, never the user's `.data`) at 375 and 1280:
  every door lands on the right page; Team → `/team` → a number → the team
  page; unknown number → "Try another number" → `/team`; sign-in pass back
  link → `/`.
- One local commit on `version-2.0`. No push.
