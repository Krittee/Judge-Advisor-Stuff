# Team landing page redesign — implementation prompt

Paste everything below the line into a Claude Code session opened in this repo
(or say: "Implement design/landing-redesign/PROMPT.md").

---

Implement the approved "Pit ticket" redesign of the team landing page `/`
(`src/app/page.tsx`). It is the teams' front door and the companion to the
"Courtside credential" sign-in pass already built on `version-2.0`. The
design is final; match it, don't redesign it.

## Sources

- **Visual spec:** `design/landing-redesign/reference-landing.dc.html`. It is a
  self-contained HTML mock (custom `{{hole}}` template + `<sc-if>` blocks, not
  React). Read its `<style>` block for exact sizes, spacing, radii and colours,
  and its markup for structure and copy. One file covers every variant:
  `.jq--wide` = tablet/desktop, `data-theme="dark"`. Its links already point at
  the real routes.
- **Live canvas:** https://claude.ai/artifact/Nhv45XWtvnnjLwCC768jWc — row
  "Team landing page · Pit ticket" (mobile light / dark / error, wide light /
  dark).
- **Avatars:** `public/avatars/*.jpg` (the role avatars already used by the sign-in pass, plus `live-board.jpg` for the Live board card).
- **Existing pieces to reuse:** `<ThemeToggle />`, `STATUS_META` from
  `src/lib/status.ts`, `filterTeamNumberInput` / `isValidTeamNumber` from
  `src/lib/teamNumber.ts`, the app's colour tokens, and the sign-in pass's
  `.signin` tokens/classes in `globals.css` where they match (avatar ring,
  focus ring, banner, button).

## Files to change

- `src/app/page.tsx` — the whole rewrite lives here.
- `src/app/globals.css` — new classes scoped under a `.landing` root class
  (prefix e.g. `lp-`), following how `.signin` / `si-` is scoped. Don't change
  existing tokens.
- Nothing else: no routing, data or auth changes. Do not change the sign-in
  doors; they are already built.

## Behaviour to keep exactly

- Team number input: `filterTeamNumberInput` on change, clear the error on
  typing, `autoFocus`, `autoCapitalize="characters"`, `autoCorrect="off"`,
  `autoComplete="off"`, `spellCheck={false}`, `enterKeyHint="go"`,
  `maxLength={12}`.
- Submit: if `!isValidTeamNumber(number)` show the error
  "Enter your team number, for example 1234 or 9882K."; otherwise
  `router.push(`/team/${encodeURIComponent(number)}`)`. (The mock's
  "Opening team…" line is only a stand-in for navigation; don't add it.)
- Continue disabled while the field is empty.

## Layout (from the reference)

**Mobile (< 768px)**
1. **Top row:** app mark + "Judge Queue" + muted "VEX IQ · V5RC"; theme toggle
   right (≥ 44px).
2. **The ticket card** (16px side margins, radius 24px, line border, soft
   shadow in light only):
   - Top: h1 "Find your team" + intro "Enter your team number to book a
     judging slot or call for a judge now."
   - Perforation: dashed rule with two punched semicircle notches on the card
     edges.
   - Bottom: label "Team number", the big centred input (Archivo 700,
     tracking 0.12em, placeholder "1234A"), error banner directly under the
     input (role="alert", input gets `aria-invalid` + `aria-describedby`), and
     a full-width "Continue" button.
3. **"What the colours mean"** card: 2-column grid of the five legend items
   (Scheduled, Requesting a judge, Judges on their way, Interview in progress,
   Interview complete). Use `STATUS_META[s].label` and `STATUS_META[s].dot`;
   don't hard-code new status colours.
4. **Live board card** → **`/board`**, directly under the legend (the board is
   where those colours appear, and it is for teams and spectators, not
   staff). A full-width link card like the staff rows (min-height 56px,
   surface, line border, radius 14px, accent border on hover/focus):
   - 40px rounded tile (radius 12px, `overflow:hidden`) showing the pixel-art
     board image `public/avatars/live-board.jpg` (`alt=""`, cover-fit);
   - "Live board" (Archivo 600 16px) with a small static **LIVE** pill
     (accent outline, Archivo 700 10px, tracking 0.16em) and a muted line
     "See every team's judging status";
   - chevron at the end. No pulsing dot and no live counts.
5. **Staff doors** (quiet, below the team task):
   - Heading "JUDGES", then ONE prominent card → **`/judge/login`**: Judge
     avatar 40px, "Judge sign in", sub "Panel code from your Judge Advisor",
     chevron; light accent tint background and accent-mixed border (values in
     the reference), full accent border on hover/focus. Judges are the largest
     group, which is why this card leads.
   - Heading "EVENT TEAM", then two rows:
     - "Event team sign in" → **`/login`** (the all-staff door). Judge Advisor
       and Queue desk avatars overlapping (32px), sub "Judge Advisors and
       queue desk".
     - "Referee sign in" → **`/referee/login`**. Referee avatar, sub "Record
       flags during matches".
   - Use `next/link` for all four links (Live board included). Avatars are
     decorative (`alt=""`).

**Tablet/desktop (≥ 768px):** two columns (max-width ~920px, centred): the
ticket on the left (title 36px, taller input); on the right, stacked: the
legend, the Live board card, then the staff doors.

The per-role doors `/queue/login` and `/admin/login` stay as they are; they
are not linked from this page.

## Motion

None beyond hover/focus colour transitions, and those switch off under
`prefers-reduced-motion`. (The old `pulse-waiting` legend dot is not used
here.)

## Accessibility

Real `<label htmlFor>` on the input, visible focus rings (2px accent outline;
input: accent border + 3px ring, danger ring in the error state), all targets
≥ 44px, WCAG AA text contrast in both themes, no horizontal scroll at 375px,
the whole mobile page fits a 375×812 screen without scrolling in the empty
and error states.

## Done when

- `npm run typecheck`, `npm run lint` and `npm test` pass (`/` is already in
  the mobile page list in `tests/mobile.test.mjs`).
- Checked in the browser at 375px and 1024px, light and dark: empty (Continue
  disabled), typed (e.g. `9882K` → goes to `/team/9882K`), invalid (e.g. `-12`
  → banner under the field), and all four links land on the right door.
- Nothing pushed, no PR opened, until the user approves.
