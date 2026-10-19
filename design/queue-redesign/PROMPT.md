# Queue desk redesign (direction B, "Now / Book") — implementation prompt

Paste everything below the line into a Claude Code session opened in this repo
(or say: "Implement design/queue-redesign/PROMPT.md").

---

Redesign the queue desk `/queue` (`src/app/queue/page.tsx`) as the approved
direction B, "Now / Book". The design is final; match it, don't redesign it.
Work on the `version-2.0` branch. This is a **UI-only** change: no store,
schema or API changes. One commit.

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
- **The pattern to copy:** the referee console (`src/components/referee/
  RefereeFrame.tsx`, the `.referee` / `.rf-*` block in `globals.css`) and the
  judge console, if it has landed by the time you start
  (`src/components/judge/`, `.judge` / `.jg-*`). Reuse their chrome where
  it fits instead of writing a third copy.
- **Today's behaviour lives in:** `src/app/queue/page.tsx`,
  `src/components/SlotPicker.tsx` (`SlotPicker`, `panelLoad`,
  `PanelBusyLine`), `src/components/Language.tsx` (`LanguageCover`,
  `LanguageTag`), `src/lib/teamNumber.ts`, `src/lib/data.ts`
  (`liveRequestFor`, `buildSlots`), `src/components/ConfirmDialog.tsx`
  (`useConfirm`).

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
  goes away elsewhere (the existing `isRescheduling` effect).
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
- Top bar: desk avatar `public/avatars/queue-desk.jpg` (28px, rounded, ring
  in the desk role colour teal `oklch(0.740 0.110 185)` dark /
  `oklch(0.520 0.105 185)` light, as `--si-desk` in the sign-in block),
  "Queue desk" + the desk person's name, Live dot, Sign out. A 1px rule
  under it; no referee stripe. Teal is used for the avatar ring only.
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
  `LanguageCover` line, restyled muted.
- Waiting now list: rows with team number (Archivo 20px) + name, status
  chip (`STATUS_META` colours), elapsed time (orange when `requested`),
  language tag, panel. A `requested` row has a quiet "Undo" on the right and
  an orange-tinted border.

### Book mode (`reference-book`)
- Language `<select>` + note input side by side.
- "Panel N · M min slots" + "X of Y open", then the slot grid **inline**,
  one row per hour with the hour label on the left and the slots in fixed
  columns. Open slot = outlined button; taken = dimmed, struck-through time
  with the holder's team number, disabled; selected = accent fill with a
  check. Past slots are not shown. (Reuse `SlotPicker`'s slot data/logic;
  the markup is new.)
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
  **"Cancel booking"** + helper "Asks first". It opens `useConfirm()`
  ("Cancel 4410C's 11:00 booking?") and then `PATCH action: "cancel"`. This
  is now the only place a booking is cancelled from the desk.

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
  asks first.
- Keep every existing test green. Run `npm test`, `npm run typecheck`,
  `npm run lint` (0 warnings), `npm run build`.

## Done when

- `/queue` matches the four mocks at 375px in dark, and looks right in light.
- Checked in the browser (dev desk code `DESK01`, 375px mobile preset):
  request a team now in each language, undo it, book a slot, reschedule it,
  cancel it with the confirm, request-now a booked team, and see the
  no-panel and not-found states.
- One local commit on `version-2.0`. No push.
