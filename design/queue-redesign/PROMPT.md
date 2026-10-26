# Queue desk redesign (direction B, "Now / Book") — implementation prompt

Paste everything below the line into a Claude Code session opened in this repo
(or say: "Implement design/queue-redesign/PROMPT.md").

---

Redesign the queue desk `/queue` (`src/app/queue/page.tsx`) as the approved
direction B, "Now / Book". The design is final; match it, don't redesign it.
Work on the `version-2.0` branch. This is a **UI-only** change: no store,
schema or API changes. One commit.

Amended 2026-10-22 against later work (judge console, team page, Live board,
door page): the desk's own slot grid replaces `SlotPicker`'s default
picker, the slot states and empty states the mocks leave out are added, the
cancel confirm gets a `cancelLabel`, the chrome follows the judge console,
and the status chips use the fill + ink pairs.

## Sources

- **Visual spec:** static mocks, dark theme, 375 wide, in
  `design/queue-redesign/`:
  - `reference-now.dc.html` — Now mode: team number, lookup line, note,
    one Request button per interview language, Waiting now list
  - `reference-book.dc.html` — Book mode: language select + note, the
    panel's slot grid inline, pinned Book button, Booked later list (900px
    full-scroll capture)
  - `reference-states.dc.html` — the lookup's four other states, stacked:
    already waiting, already booked, no panel yet, not found (1242px)
  - `reference-reschedule.dc.html` — moving a booking, with Cancel inside
  These are self-contained HTML mocks (custom `{{hole}}` template, not
  React). Read their `<style>` blocks for sizes, spacing and colours and
  their markup for structure and copy. Team data in them is sample data.
- **Live canvas:** https://claude.ai/artifact/Nhv45XWtvnnjLwCC768jWc, row
  "Queue desk · B · Now / Book (chosen)". The A and C boards in that row are
  marked "Not chosen": ignore them.
- **The pattern to copy:** the judge console's top bar
  (`src/components/judge/JudgeFrame.tsx`, `.jg-top` in `globals.css`) is
  the closest match for the desk's chrome; the referee console
  (`src/components/referee/RefereeFrame.tsx`, `.rf-*`) is the other. The
  team page (`src/components/team/`, `.teampage` / `.tp-*`) and Live board
  (`.board` / `.bd-*`) show the status fill + ink pairs. Copy their
  patterns where they fit instead of inventing new ones.
- **Today's behaviour lives in:** `src/app/queue/page.tsx`,
  `src/components/SlotPicker.tsx` (`SlotPicker`, `panelLoad`,
  `PanelBusyLine`, `noSlotsLeftLine`), `src/components/Language.tsx`
  (`LanguageCover`, `LanguageTag`, `hasLanguageGap`),
  `src/lib/teamNumber.ts`, `src/lib/data.ts` (`liveRequestFor`,
  `buildSlots`), `src/components/ConfirmDialog.tsx` (`useConfirm`, which
  takes `confirmLabel`, `cancelLabel`, `danger`).
- **Routes:** "/" is the door page; its Queue desk door goes to
  `/queue/login`. Nothing about the desk's routes changes.

## Keep (behaviour that must not regress)

- Session gate → `/queue/login`; sign out to `/queue/login`.
- The desk can queue teams and book slots, undo a mis-entry, reschedule and
  cancel bookings. It **never** advances an interview and **never** sees
  notes or scores.
- Team-number input filtering and normalising (`filterTeamNumberInput`,
  `normalizeTeamNumber`).
- **Request now while booked** turns that booking into the request in place
  (`PATCH action: "ready-now"`), one call, never cancel-then-create.
- **Reschedule** is one call (`PATCH action: "reschedule"`), and drops back
  to a normal booking if the team number on screen changes or the booking
  goes away elsewhere (the existing `isRescheduling` effect). Starting a
  reschedule from the Booked later list still brings the top of the page
  into view, but with a plain `window.scrollTo({ top: 0 })`: no smooth
  scroll.
- Undo (`PATCH action: "cancel"`) only while the request is `requested`.
- The success / error messages after each action (today's `ok` / `error`
  banners): keep the wording, restyle them.
- Booking language defaults to the first configured language.
- `LanguageCover` warns when a panel does not cover the chosen language.
- Lists: "Waiting now" = `requested` + `acknowledged`, oldest first (as
  today; the mock's "Interviewing" row only shows the row style). "Booked
  later" = `scheduled`, by slot time.
- Polling via `useAppState(4000)`.

## The design

### Chrome
- Top bar, built like the judge console's `.jg-top`: desk avatar
  `public/avatars/queue-desk.jpg` (28px, rounded), "Queue desk" + the desk
  person's name, the Live dot ("Live" / "Reconnecting" from
  `useAppState`'s `online`), Sign out to `/queue/login`, and room on the
  right for the theme toggle that docks there. A 1px rule under it; no
  referee stripe.
- The avatar ring is the desk role colour, teal `oklch(0.740 0.110 185)`
  dark / `oklch(0.520 0.105 185)` light. `--si-desk` only exists inside
  `.signin` / `.landing`, so define the desk's own (e.g. `--dk-desk`)
  under `.desk` with those values, light under
  `:root[data-theme="light"] .desk`. Teal is used for the avatar ring only.
- Mode bar (pinned): a 2-button segmented control **Now | Book**, the
  selected one filled with `--accent`. No bottom tab bar (the desk is one
  page).

### Shared top of both modes
- "Team number" label + the big uppercase input (Archivo, 32px, letter
  spaced, 52px tall), as `reference-now`.
- Lookup line under it (not a card): **name** · category · pit, and a second
  line "Panel N · division · <busy> · next free **hh:mm**".
  - `<busy>` is `panelLoad`'s numbers in muted text ("2 waiting", "1 in
    interview"; "free now" when neither).
  - "next free" is the first open future slot on that panel from
    `buildSlots`; omit it when the panel has none. Put that in a small pure
    helper with a test.

### Now mode (`reference-now`)
- Optional note input ("Optional note for the judges").
- One full-width-pair accent button per configured language:
  "Request · English", "Request · ไทย" (56px). Under them the
  `LanguageCover` line, restyled muted (its gap rule is `hasLanguageGap`;
  don't write another).
- Waiting now list: rows with team number (Archivo 20px) + name, status
  chip, elapsed time (orange when `requested`), language tag, panel. A
  `requested` row has a quiet "Undo" on the right and an orange-tinted
  border.

### Status chips
Every status chip on the desk (Waiting now rows, the already-waiting
state, the Booked later time chip) wears the status fill with the ink that
clears AA on it, in both themes, the way the team page and Live board do:
a class per status that sets `--c` (fill) and `--ci` (ink), e.g.
`.dk-s-waiting { --c: var(--waiting); --ci: var(--waiting-ink); }`.
Labels come from `STATUS_META`. Booked is `--booked-quiet`, which has no
app-wide ink token: copy the other pages and define `--dk-booked-ink`
(`oklch(0.200 0.014 265)` dark, `oklch(0.975 0.004 265)` light), like
`--tp-booked-ink`.

### Book mode (`reference-book`)
- Language `<select>` + note input side by side.
- "Panel N · M min slots" + "X of Y open", then the slot grid **inline**,
  one row per hour with the hour label on the left and the slots in fixed
  columns. Past slots are not shown. The slot states, in this order of
  precedence (the same order `SlotPicker` uses today):
  - **theirs**: held by the team on screen (e.g. an earlier, finished
    interview): dimmed, disabled, "theirs" under the time. While
    rescheduling, the booking being moved is "current" instead (below).
  - **taken**: dimmed, struck-through time with the holder's team number,
    disabled, `title` "Taken by team <n> — <status>".
  - **too close** (`slot.blocked`: within 20 minutes of another booking on
    the panel, so judges can walk between interviews): dimmed,
    struck-through time, "too close" under it, disabled, with the same
    `title` sentence the picker uses today.
  - **open**: outlined button.
  - **selected**: accent fill with a check.
  Taken, too close and theirs all look "off"; only the small line under
  the time tells them apart. No status colours on slots.
- Empty states, in place of the grid (caution box, as the other warnings):
  - Panel has no slots set up: "**Panel N has no bookable times set up
    yet.** Use Request now instead, or ask the Judge Advisor to add times
    (Panels → Panel N → Booking slots)."
  - Slots exist but none is open: the `noSlotsLeftLine` sentence ("No slots
    left — 3 taken, 2 already passed"). The pinned Book button stays
    disabled.
- Build the grid as a desk component (e.g. `src/components/desk/
  DeskSlots.tsx`) on `buildSlots`'s data; pass `excludeRequestId` while
  rescheduling, as today. Don't add a variant to `SlotPicker`: see
  "SlotPicker" below.
- Pinned bar: "Book hh:mm · <team>" (accent, 56px), disabled until a slot is
  picked.
- Booked later list: time chip (booked grey), team number + name, panel,
  quiet "Reschedule" on the right. **No Cancel on the row.**

### Lookup states (`reference-states`) — these replace the actions
- **Already waiting** (live request, not `scheduled`): status chip with
  elapsed time + language tag, caution "Already in the queue. A team can't
  be added twice.", Request buttons hidden, quiet "Undo request" + helper
  "Only before judges acknowledge" (shown only while `requested`).
- **Already booked**: caution "Booked for hh:mm on Panel N." Actions:
  "Reschedule" (outline) and "Request now instead" (accent), helper
  "Requesting now frees their hh:mm slot." "Request now instead" uses the
  same per-language choice as Now mode: when the event has more than one
  language, the button becomes the per-language pair ("Now · English" /
  "Now · ไทย"), preselecting none. (The mock shows a single button; follow
  this rule.)
- **No panel yet**: caution "No judge panel assigned yet. Ask the Judge
  Advisor." Request buttons shown disabled.
- **Not found** (a complete-looking number with no team): input gets the
  danger border, line "No team <n> at this event." in `--danger-quiet`. No
  buttons. Don't show this while the number is still being typed (empty
  input shows nothing).

### Reschedule (`reference-reschedule`)
- Entered from a Booked later row's "Reschedule" or the already-booked
  state's button: switches to Book mode with the team filled in.
- An accent-tinted bar at the top of the body: "Moving <team> from hh:mm"
  with a quiet "Stop" (cancels rescheduling, not the booking).
- Slot grid as Book mode; the current slot is outlined in accent with
  "current" under it and cannot be picked.
- Helper under the grid: "Language and note stay as booked."
- Pinned: "Move to hh:mm" (accent), and under it a quiet danger text button
  **"Cancel booking"** + helper "Asks first". It opens `useConfirm()` with
  "Cancel 4410C's 11:00 booking?" and
  `{ confirmLabel: "Cancel booking", cancelLabel: "Keep it", danger: true }`
  (the team page's wording, so the dialog never shows "Cancel" next to
  "Cancel booking"), then `PATCH action: "cancel"`. This is now the only
  place a booking is cancelled from the desk.

## SlotPicker

Today only `/queue` uses `SlotPicker`'s default picker (the team page uses
`variant="team"`). Once the desk has its own grid, delete what only the
default used, in the same commit:
- in `src/components/SlotPicker.tsx`: the default branch, `SlotButton`,
  `Legend`, and the default "no bookable times" box. `SlotPicker` keeps the
  team tiles; make `variant` required or drop it, whichever leaves less code
  (`TeamView.tsx` and its tests must still pass).
- `PanelBusyLine`'s coloured output: the desk's lookup line writes
  `panelLoad`'s numbers itself, muted, so only the team page's `plain`
  line is left. Drop the `plain` prop and the colours; it always renders
  plain.
- in `tests/slotPickerVariant.runtime.test.tsx`: the desk half (the pinned
  markup, its empty states, "the queue page does not ask for the team
  variant or the plain busy line"), and cut the busy-line test down to the
  plain output. Keep the team-variant tests.
- Keep `noSlotsLeftLine`, `panelLoad`, `PanelBusyLine` and
  `tests/slotPicker.runtime.test.tsx` (its last test reads
  `noSlotsLeftLine(slots, now)`, which the team branch still calls).

## Rules

- Colour is signal (see the top of `globals.css`): status colours only for
  status chips/dots, caution for the warnings above, danger-quiet for "not
  found" and "Cancel booking", accent for interactive chrome (the Now/Book
  control, primary buttons, selected slot, focus). Teal only on the avatar
  ring. Don't introduce new hues.
- Light theme must work, from the existing tokens (mocks are dark only).
- No playful motion; touch targets ≥44px; real `<button>` / `<label>` /
  `<select>`; `aria-pressed` on the segmented control and slot buttons.
- Page-scoped styles (e.g. `.desk` / `.dk-*`) appended to `globals.css`.
  Several tests read `globals.css` by regex (`theme.test.mjs`,
  `mobile.test.mjs`); append after the existing blocks and keep them green.
- Never `window.confirm`; use `useConfirm()`.

## Tests (must fail if the change is reverted)

- A pure test for the lookup state (`waiting` / `booked` / `no-panel` /
  `not-found` / `ready`) and for "next free slot".
- A runtime render test in the style of `tests/refereePage.runtime.test.tsx`:
  Now shows one Request button per language; an already-booked team shows
  Reschedule + Request now instead; Book mode's Book button stays disabled
  until a slot is picked; Booked later rows have no Cancel; Cancel booking
  asks first, with "Cancel booking" / "Keep it".
- A render test for the desk's slot grid on fixed 2099 slots (like
  `slotPickerVariant`'s fixture): theirs, taken, too close, open and
  selected each render as specified and only open slots are enabled; the
  booking being moved shows "current" and is disabled; no slots set up and
  none left show their empty-state sentences.
- Keep every existing test green, except the desk tests the SlotPicker
  section deletes. Run `npm test`, `npm run typecheck`, `npm run lint`
  (0 warnings), `npm run build`.

## Done when

- `/queue` matches the four mocks at 375px in dark, and looks right in light.
- Checked in the browser (dev desk code `DESK01`, 375px mobile preset):
  request a team now in each language, undo it, book a slot, reschedule it,
  cancel it with the confirm, request-now a booked team, and see the
  no-panel and not-found states.
- One local commit on `version-2.0`. No push.
