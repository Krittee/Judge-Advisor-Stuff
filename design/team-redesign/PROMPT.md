# Team page redesign (direction B, "Status board") — implementation prompt

Paste everything below the line into a Claude Code session opened in this repo
(or say: "Implement design/team-redesign/PROMPT.md").

---

Redesign the team page `/team/[number]` (`src/app/team/[number]/page.tsx`)
as the approved direction B, "Status board". The design is final; match it,
don't redesign it. Work on the `version-2.0` branch. This is a **UI-only**
change: no store, schema or API changes. One commit.

A team reaches this page from the landing page ("Pit ticket", already built)
by typing its number. It is used on a phone lying on the pit table, in a
loud room: the page must say where the team stands at a glance.

## Sources

- **Visual spec:** static mocks in `design/team-redesign/`, light theme by
  default (each has a `theme` prop; the moon/sun button flips it):
  - `reference-idle.dc.html` — 375 wide, nothing booked (full 1200px scroll)
  - `reference-booked.dc.html` — 375, holding the 10:40 slot
  - `reference-on-the-way.dc.html` — 375, judges on their way
  - `reference-wide.dc.html` — 1280, nothing booked
  They are self-contained HTML mocks (custom `{{hole}}` template, not React).
  Read their `<style>` blocks for sizes, spacing and colours, and their
  markup for structure and copy. Team, panel, judge and slot data in them is
  sample data. The OKLCH tokens in their `.jq` block are the same ones the
  landing page uses.
- **Live canvas:** https://claude.ai/artifact/Nhv45XWtvnnjLwCC768jWc, row
  "Team page · B · Status board" (rows A and C there are not chosen; ignore
  them).
- **The pattern to copy:** the landing page `src/app/page.tsx` and its
  `.landing` / `lp-*` block in `src/app/globals.css` (same top bar, tokens,
  buttons, theme toggle). Scope this page the same way: a `.teampage` root
  class and a `tp-*` prefix. Reuse the landing's top-bar markup/classes
  rather than copying them if they can be shared cleanly.
- **Today's behaviour lives in:** `src/app/team/[number]/page.tsx`,
  `src/components/SlotPicker.tsx` (`SlotPicker`, `PanelBusyLine`,
  `panelLoad`, `noSlotsLeftLine`), `src/lib/status.ts` (`STATUS_META`:
  `label`, `teamLabel`), `src/lib/data.ts` (`liveRequestFor`, `buildSlots`),
  `src/components/Language.tsx`, `src/components/ui.tsx` (`Elapsed`,
  `BookingTime`, `formatClock`, `Banner`).

## Keep (behaviour that must not regress)

- The number in the URL goes through `decodeURIComponent` +
  `normalizeTeamNumber`; the roster lookup is by that canonical form.
- Polling with `useAppState(4000)`.
- Before the first answer: "Loading…", or "Can't reach the server —
  retrying…" when offline (never "not on the list" over bad wifi; the poll
  keeps going and clears it).
- Team not found: "Team 9882K is not on the list." + "Check the number, or
  ask the Judge Advisor to add you." + "← Try another number" to `/`.
- No panel assigned: "No judge panel assigned yet — check with the Judge
  Advisor." in caution, and the request buttons disabled (as today,
  `disabled={busy || !team.panel_id}`). No booking section.
- **Ready early with a booking:** one PATCH to `/api/requests/<bookingId>`
  with `action: "ready-now"` turns the held slot into the queue request in
  place (never cancel-then-create). "Either gives up your 10:40 slot." stays
  under the buttons.
- Request without a booking: POST `/api/requests` with `kind: "queue"`,
  `language`, `message` (the optional note, max 280).
- Book a slot: POST with `kind: "slot"`, the slot language, `slotStart`,
  `slotEnd`. Slot rules stay `SlotPicker`'s / `buildSlots`': taken and
  passed slots can't be booked; a slot too close to another booking on the
  panel is blocked with its existing title; the team's own slot is marked;
  `noSlotsLeftLine` and the "Use Interview now instead…" message when
  nothing is left.
- Cancel is offered only while `requested` or `scheduled`, as today.
- "Earlier today": up to five of the team's other requests, status + time
  (`finished_at ?? cancelled_at ?? requested_at`).
- The busy line under the request is `PanelBusyLine` (its copy: "Panel is
  free right now" / "1 in interview · 2 already waiting (longest 6 min)").
  Don't invent queue positions or ETAs; the app has no such data.
- Errors from any action show in a dismissible danger banner and leave the
  page usable; buttons read "Sending…" while busy.

## The design

### Chrome
Top bar from the landing page: app mark, "Judge Queue", muted "VEX IQ ·
V5RC", theme toggle (≥44px). No sign-in, no avatar (a team is not a staff
role).

### 1 · Status panel (top of the page)
One large rounded panel (radius 24, padding 18/20; wide 28/32):
- First line "Team 9882K · Torque Titans" (Archivo 600 15); the request's
  language tag on the right when there is one.
- A caps label naming the status (`STATUS_META[s].label`, uppercased by CSS,
  tracking 0.2em), then the big sentence (`teamLabel`, Archivo 700 28px;
  40px wide).
- The big time (Archivo 700 72px, 96px wide, tabular figures):
  - scheduled → the slot time ("Booked slot" above, "10:40");
  - requested / acknowledged → time since `requested_at` ("Requested" above,
    "4 min" + small "ago");
  - interviewing → time since `started_at` ("Started" above).
  A completed or cancelled request is not live (`liveRequestFor` drops it),
  so after an interview the page is back to Idle, and the finished
  interview shows under "Earlier today" with its green chip.
- Footer under a hairline: "**Panel 2** · Middle School" and the judges'
  names (or the no-panel caution line).
- **Colour:** the panel is filled with the status colour (grey scheduled,
  orange requested, blue acknowledged, violet interviewing) with ink chosen per theme so text passes AA (the mocks show
  scheduled and acknowledged; derive the others from the same tokens and
  check contrast). **Idle** (no live request and no booking) is a neutral
  surface panel with a line border: no status colour, since there is no
  status. Its sentence is "Ask for a judge" and the busy line sits under it.

### 2 · Track
A card under the panel listing the five steps: Booked → Requested → On the
way → Interviewing → Complete (vertical on phone, horizontal on wide).
- Current step: filled marker in its status colour, label in ink, bold.
- Steps passed: ticked marker; the time shows at the right where the app
  knows it (e.g. Requested "4 min ago", Booked "10:40").
- Booked when the team never booked (queued directly): dashed marker, muted
  ("not used").
- Future steps: hollow markers, muted.
- Idle: all hollow, caption "Not in the queue yet".
- A visually hidden heading names the list for screen readers.

### 3 · Actions (below the track)
- **Idle:** "Which language would you like to be interviewed in?" + a
  segmented control of the event's languages (only when there is more than
  one), the note field, then the accent "Request a judge" button (52px).
  Then a collapsible section "Book a time with Panel 2 instead" (open by
  default when nothing is booked, as drawn): slot-language chips and the
  slot grid (3 columns on phone, 4 wide; taken slots dashed, struck through,
  "Taken", disabled).
- **Booked:** "Ready before your slot?", the note field, the same language
  question with one accent button per language (one language: a single
  "We're ready now" button). Each sends straight away, as today. "Either
  gives up your 10:40 slot." under them, then the busy line, a rule, and
  "Cancel this booking" (outline button).
- **Live request** (requested / acknowledged / interviewing): no request
  buttons. "Cancel this request" (outline) only while `requested`.
- **Cancel asks first** with `useConfirm()` ("Cancel your 10:40 booking?" /
  "Cancel your request for a judge?"), per the console rule that
  irreversible actions ask; today's page doesn't ask.
- "Earlier today" (caps heading) as rows: status chip + time.
- "See the full board →" link to `/board` at the bottom.

### Wide (≥1024px)
Two columns (`reference-wide`): status panel and track left; actions,
booking section and the board link right. Between 768 and 1023, single
column centred at max 560px.

## Rules

- Colour is signal (top of `globals.css`): status colours only where a
  status is shown (panel fill, track marker, history chips); accent only for
  interactive chrome (buttons, chips, links, focus); danger only for errors.
  "Request a judge" is accent, not orange.
- Light and dark both work, from the same tokens as the landing page.
- No motion: no pulse, spin or `@keyframes`; hover/focus colour transitions
  only, off under `prefers-reduced-motion`.
- Touch targets ≥44px; real `<button>`s, a real `<label>` for the note
  (visually hidden is fine), `aria-pressed` on the segmented control and
  chips, `aria-expanded` on the collapsible, focus rings visible.
- `SlotPicker` is shared with other pages: restyle it for this page through
  page-scoped CSS or a small variant prop, and don't change how it looks
  anywhere else. Share logic, not copies.
- No horizontal scroll at 375px.

## Tests (must fail if the change is reverted)

- A pure helper (e.g. `trackSteps(current, history)`) for the track:
  current/passed/future/not-used per status, and the idle case.
- A runtime render test in the style of `tests/adminTeams.runtime.test.tsx`:
  idle shows "Ask for a judge" and the neutral panel; booked shows the
  panel's scheduled colour class, "10:40" and "Cancel this booking";
  acknowledged shows "Judges are on their way to you" and no request
  buttons; not found and no-panel copy; Cancel asks first and a "no" sends
  nothing.
- `/team/[number]` stays in `tests/mobile.test.mjs`. Keep every existing
  test green: `npm test`, `npm run typecheck`, `npm run lint` (0 warnings),
  `npm run build`.

## Done when

- The page matches the four mocks at 375 and 1280, light and dark.
- Checked in the browser at 375 and 1280 on a demo team: request a judge
  (pick Español, add a note), cancel it (asks first), book a slot, "We're
  ready now" from the booking (one PATCH, slot given up), watch the panel
  change colour as a judge moves the request on, a team with no panel, an
  unknown number, and the offline line.
- Other pages using `SlotPicker` look exactly as before.
- One local commit on `version-2.0`. No push.
