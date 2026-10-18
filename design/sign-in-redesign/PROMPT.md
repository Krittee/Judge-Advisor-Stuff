# Sign-in redesign — implementation prompt

Paste everything below the line into a Claude Code session opened in this repo
(or say: "Implement design/sign-in-redesign/PROMPT.md").

---

Implement the approved "Courtside credential" sign-in redesign for `/login`
(staff) and `/referee/login` (referee). The design is final; match it, don't
redesign it.

## Sources

- **Visual spec:** `design/sign-in-redesign/reference-signin.dc.html`. It is a
  self-contained HTML mock (custom `{{hole}}` template + `<sc-if>` blocks, not
  React). Read its `<style>` block for exact sizes, spacing, radii and colours,
  and its markup for structure and copy. One file covers every variant:
  `.jq--wide` = tablet/desktop, `.band--ref` = referee, `data-theme="dark"`.
- **Live canvas (all states side by side):**
  https://claude.ai/artifact/Nhv45XWtvnnjLwCC768jWc
- **Avatars (already in the repo):** `public/avatars/judge.jpg`,
  `queue-desk.jpg`, `judge-advisor.jpg`, `referee.jpg` — 320×320 JPEGs, ~20 KB
  each, cropped from `Pixel-Art-Role-Avatars-HD/`. Use plain `<img>` (not
  `next/image`), `alt=""` (the role name is always shown as text beside it).

## Files to change

- `src/components/SignInForm.tsx` — the whole visual rewrite lives here.
- `src/app/login/page.tsx`, `src/app/referee/login/page.tsx` — pass a
  `variant: "staff" | "referee"` prop (referee intro becomes
  "Referees sign in here to record flags during matches.").
- `src/app/globals.css` — only the new scoped tokens/classes below.
- Do not touch auth, `/api/session`, rate limiting or routing.

## Behaviour to keep exactly

- POST to `/api/session` via `call()`; on success route with `homeFor(role)`.
- Server error text goes in the error banner unchanged (it already returns
  "That code was not recognised." and "Too many attempts…").
- `nameRequired` from the path. `tests/authHardening.test.ts` greps for these
  exact snippets, so keep them verbatim:
  `usePathname()?.startsWith("/referee")`, `required={nameRequired}`,
  `nameRequired && !name.trim()`.
- Code input: one plain text field (codes vary in length — no segmented
  boxes), uppercase on input as today, `autoCapitalize="characters"`,
  `autoComplete="off"`, `spellCheck={false}`, `autoFocus`. Do not strip
  characters or cap the length below 64: codes come from env vars and panels.

## Layout (from the reference)

**Mobile (< 768px):** top row (56px) with "← Back to team view" link left and
the existing `<ThemeToggle />` right (both ≥ 44px). Below it the **pass** fills
the rest of the viewport (`min-h-dvh` flow, 16px side margins, radius 24px,
1px line border, soft shadow in light only).

- **Role band** at the top of the pass: lanyard slot pill (56×10, canvas
  coloured, top-centred), "Judge Queue" wordmark + mark, role word
  (`STAFF` / `REFEREE`, Archivo 700 13px, tracking 0.24em).
  - Staff band: accent blue; shows the **crew** — three 44px avatar tiles with
    labels "Judge", "Queue desk", "Judge Advisor".
  - Referee band: `--ref-band` ink with the 10px black/white diagonal stripe
    strip along its bottom edge; one 60px Referee avatar labelled "Referee".
  - Avatars: radius 22%, 2px white ring on the band.
- **Body:** h1 (Archivo 700 28px), intro (muted 15px), then the form:
  - "Access code" field: 64px tall, Archivo 600 26px, tracking 0.14em,
    1.5px border, radius 12px; error state = danger border.
  - Error banner sits directly **under the code field** (role="alert",
    danger tint, alert icon; clock icon for the rate-limit message).
  - "Your name" with right-aligned tag "Optional" / "Required" and the helper
    text (staff: "Shown to the Judge Advisor on the activity log."; referee:
    "Every flag you file is recorded under this name. Use your full name.").
  - Sign in button pinned to the bottom of the pass (`margin-top:auto`), 56px.

**Tablet/desktop (≥ 768px):** the pass turns landscape (780px wide, centred):
band becomes a 240px vertical strip on the left (wordmark top, crew stacked,
role word 26px at the bottom; referee stripes move to the strip's right
edge), form on the right with 40/44px padding, title 30px.

## Success state

When `/api/session` succeeds, call `router.prefetch(home)` and show the
welcome panel in place of the form for ~900 ms, then `router.push(home)`:
role avatar at 128px on its role tint, "Signed in as {Role}" (Archivo 700
24px), muted "Opening the queue…", and the static yellow "VERIFIED" stamp
(rotated −8°, overlapping the avatar's lower-right). No sign-out button.
Role names: `admin` → Judge Advisor, `judge` → Judge, `queuer` → Queue desk,
`referee` → Referee.

## Motion — subtle only

Only these, and only while the request is in flight:
1. 3px bar sliding along the bottom of the Sign in button ("Checking…").
2. A light shimmer sweeping across the role band.
3. Referee stripes moving like a barber pole.

No entrance, bob, shake, confetti or stamp animation (the user removed them as
unprofessional). Everything goes static under `prefers-reduced-motion`.

## Colours

Reuse the existing tokens in `globals.css` (`--canvas`, `--surface`, `--ink`,
`--ink-subtle`, `--line`, `--accent`, `--accent-ink`, `--danger`…) — the
reference's `--muted` = `--ink-subtle`, `--on-accent` = `--accent-ink`.
Add the role colours **scoped to the sign-in page only** (e.g. under a
`.signin` class), light and dark, values from the reference:
`--desk` (teal 185), `--ja` (violet 300), `--ref` (orange 55), `--sun`
(yellow 95), `--ref-band`, the role tints and `--field-line`.

Important: per the palette notes at the top of `globals.css`, colour inside
the app is signal — orange means "a team is waiting", violet means "active".
Keep these role colours on the sign-in page; do not reuse them as chips or
tiles elsewhere.

## Accessibility

Labels tied to inputs, `aria-invalid` + `aria-describedby` on the code field
when an error shows, `aria-busy` on the button while checking, visible focus
rings (2px accent outline, inputs: accent border + 3px ring), all targets
≥ 44px, WCAG AA text contrast in both themes, no horizontal scroll at 375px.

## Done when

- `npm run typecheck`, `npm run lint` and `npm test` pass.
- Checked in the browser at 375px and 1024px, light and dark, staff and
  referee: empty (button disabled), referee without name (disabled), wrong
  code (banner under the code field), checking, success panel → redirect.
  Dev codes: `JA2026` (Judge Advisor), `DESK01` (Queue desk), `REF001`
  (Referee), `ALPHA1` (a judge panel, if seeded).
- Nothing pushed, no PR opened, until the user approves.
