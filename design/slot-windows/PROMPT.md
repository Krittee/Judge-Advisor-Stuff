# Slot windows: open–end per day, a break, two days (v2.2.0)

Chosen direction: **A · Day cards** (canvas row "v2.2 · Slot windows").
Reference boards in this folder: `reference-phones.dc.html` (JA sheet + desk
grid at 375), `reference-ja-wide.dc.html` (JA dialog at 1280).

## Why

Today a panel's slots are "first slot + minutes each + how many": 10:00, 15
min, 6 → 10:00 … 11:15. The JA thinks in hours instead: "Panel 2 takes
bookings 10:00–16:00, lunch 12:00–13:00", and the event runs over two days.
Staff should be able to book any slot inside those hours, on either day.

## Decided with the user

- **Who books:** staff, as now (queue desk, Coordinator, JA). Teams still
  have no sign-in and do not book.
- **Per panel.** Each panel has its own windows.
- **One window per day, plus an optional break** (e.g. lunch).
- **Fixed slots inside the window.** Slots run back to back from open, at the
  panel's "minutes each", skip the break, and stop at the end time.
- **Two days to start** (Day 1, Day 2). Stored so a Day 3 later is UI only.
- **Storage approach A:** one new field on the panel holding its days.

## Goals / non-goals / anti-goals

- Goal: the JA sets date, open, end and break per day; every booking surface
  shows and accepts only slots inside those windows.
- Goal: live Supabase data and the laptop JSON file keep loading unchanged.
- Non-goal: teams booking themselves; more than one break per day; per-day
  slot length; moving existing bookings when the JA re-times a panel (today's
  behaviour stays: a booking off the new grid keeps its time).
- Anti-goal: anything that rewrites or drops existing rows; a desk grid that
  wraps a row onto two lines; slots that can overlap.

## Data model

```ts
// src/lib/types.ts
export type SlotDay = {
  open_at: string;          // ISO instant
  end_at: string;           // ISO instant, same Bangkok day as open_at
  break_from: string | null; // ISO, both set or both null
  break_to: string | null;
};
Panel.slot_days: SlotDay[];  // [] = not set: fall back to the legacy fields
```

`slot_start_at`, `slot_minutes`, `slot_count` stay. `slot_minutes` is still
the slot length (both days).

### Reading (pure, `src/lib/data.ts`)

- `panelDays(panel)`: `slot_days` when non-empty, sorted by `open_at`. Else,
  when `slot_start_at` is set and `slot_count > 0`, one legacy day
  `{open_at: slot_start_at, end_at: start + count × minutes, break: null}`.
  Else `[]`. This is how existing panels keep exactly today's slots with no
  data migration.
- `slotTimes(panel)` walks each day: `t = open`; while `t + len ≤ end`: if a
  break exists and `t < break_to && t + len > break_from`, jump `t =
  break_to` and continue; else push `[t, t + len]`, `t += len`. So a slot
  ending exactly at `break_from` is kept, one crossing it is dropped, the
  afternoon restarts at `break_to`, and a slot crossing `end` is dropped.
- The `Pick<…>` these helpers take gains `slot_days` as **optional**, so
  old callers and tests keep compiling.
- `isRealSlot`, `buildSlots`, `hasNearbyBooking` (20-min walking gap) keep
  their logic; they read the new times through `slotTimes`.

### Writing (`/api/admin/panels` PATCH and POST)

- New body field `slotDays: {open_at, end_at, break_from, break_to}[]` with
  `slotMinutes`. Validate in one pure function (`parseSlotDays` in
  `data.ts`, unit-tested), 400 with a plain sentence naming the day on
  failure:
  - at most 7 days; each `open < end`, same Bangkok date
  - break: both or neither; `open ≤ break_from < break_to ≤ end`
  - no two days on the same Bangkok date; stored sorted
  - every day yields at least one slot; total slots ≤ 200
- On save the server also writes `slot_start_at = first open_at` (null when
  no days) and `slot_count = total slot count`. Every "booking off" check
  (`slot_count`) keeps working, and an older build sharing the database still
  sees bookings as on.
- **Booking off** = `slotDays: []` → `slot_days = []`, `slot_count = 0`,
  `slot_start_at = null` (so the legacy fallback does not revive it).
- Old bodies (`slotStartAt`/`slotCount` without `slotDays`) still work as
  today. They also clear `slot_days`, so the legacy fields win.

### Stores (both, additive)

- Postgres self-running migration, next to the 2.1.0 `languages` lines:
  `alter table panels add column if not exists slot_days jsonb not null default '[]'::jsonb;`
  Add `p.slot_days` to `PANEL_SELECT`; panel inserts leave it to the default.
  `updatePanel` builds `col = $n` dynamically, and node-postgres would send a
  JS array as a Postgres array, so `slot_days` must go as
  `JSON.stringify(value)` with a `::jsonb` cast. Test that path.
- File store: `p.slot_days ??= []` on load (as `languages` does), `[]` on
  create, stored as is on update.
- Presets/demo seed: unchanged (legacy fields, read through the fallback).

## Screens (direction A)

1. **JA → Panels → Booking slots dialog** (`SlotsDialog` in
   `PanelsTab.tsx`, logic in `panelsLogic.ts`). This is the same Modal, as a
   sheet on phone and a centred dialog on wide (see the reference boards):
   - "Minutes each", plus a live total ("32 slots in all").
   - One card per day: "Day 1" with Date (`type="date"`), Open and End
     (`type="time"`) on one line, and Break from/to on one line with a
     remove-break button. With no break the card shows "Break · none" and
     "+ Add break". Under each card, a live count line: "20 slots · last
     15:45", computed with `slotTimes` on the draft.
   - "+ Add day" while there is one day: Day 2 = the next date, with Day 1's
     hours. Day 2 has a remove button. "2 days for now" is the cap in the UI.
   - A quiet "Turn booking off" link, which saves `[]`. The footer reads
     "Save slots · N".
   - Times are Bangkok wall time. Draft ↔ ISO uses `+07:00` (the same
     constant `stepTimes.ts` uses: export and reuse `bangkokDay` /
     `bangkokClock`). The draft opens from `panelDays(panel)`, so a legacy
     panel opens showing its Day 1 window.
   - The panel card summary (`slotsSummary`) reads "Day 1 10:00–16:00 · Day
     2 09:00–12:00 · 15 min", with one day omitted when there is only one,
     and "Booking slots off" otherwise.
2. **Booking grid** (`DeskSlots` + `slotGrid` in `deskLogic.ts`). Used by
   the desk Book tab, the desk reschedule flow, and the JA's
   `InterviewControls`:
   - When the panel has 2+ days, each day gets a heading row: "Day 1 · Sat
     21 Nov · 6 open". A one-day panel looks exactly as today.
   - A day with a break gets one full-width muted row, "12:00–13:00 ·
     Break", between its last morning hour row and its first afternoon row.
     It only appears while slots still show on both sides.
   - Day numbers come from the panel's day order, so Day 2 is still "Day 2"
     after Day 1 has passed. A passed day disappears, as passed slots do
     today.
   - Rows stay on one line (project rule).
3. **Coordinator Slots tab** (`SlotsTab.tsx`, `slotsModel`): the same day
   headings and break row in its list.
4. **"No slots left" line** (`noSlotsLeftLine`): drop "today": "No slots
   left — the rest have already passed". The other two wordings stay.
5. **A booking shown on another day.** Today a slot time is clock-only, so
   on Day 1 a Day 2 booking would read "9:15 AM". Add one helper,
   `slotLabel(iso, now)`, which returns the clock alone on the same Bangkok
   day and "Sun 9:15 AM" otherwise. Use it wherever a booked `slot_start` is
   shown: `BookingTime` (ui.tsx, which the team page, desk lists, JA and
   judge use), board `TileTime`, the "booked for …" toasts (coordinator,
   queue, JA), and the judge's due line. Grid cells stay clock-only, since
   their day heading says the day.

## Booking validation

`/api/requests` (create) and `/api/requests/[id]` (reschedule) already
refuse anything `isRealSlot` rejects, plus slots already passed. With
`slotTimes` reading the windows, a time inside the break, after the end, on
a third day, or off the grid on Day 2 is refused with no route change. Both
stores keep the 20-minute gap rule.

## Tests (must exist)

- `tests/slots.test.mjs`: two days; break edges (ends exactly at break kept,
  crossing dropped, restart at `break_to`); ending exactly at `end` kept,
  crossing dropped; the legacy fallback gives the same output as today;
  `isRealSlot` refuses a break time, a Day 2 off-grid time and a Day 3 time,
  and accepts a Day 2 slot.
- `parseSlotDays`: each refusal above, sorting, and the 200 cap.
- `panelsLogic`: draft ↔ body round trip in Bangkok time, `slotsSummary`
  for one day, two days and off.
- `deskLogic` `slotGrid`: day headings and the break row; a one-day panel
  unchanged (existing tests still pass).
- Stores: `slot_days` round-trips on the file store and Postgres (mock
  driver), a legacy row with no `slot_days` loads as `[]`, and the
  migration line is present (`postgres-sql.test.mjs`).
- Routes: `/api/admin/panels` refuses a bad day and saves a good one (with
  `slot_count`/`slot_start_at` synced); `/api/requests` refuses a
  break-time slot and accepts a Day 2 slot.
- `slotLabel`: same day → clock; other day → weekday + clock.

## Settled after the builder review (Opus's calls)

- **Re-deriving `slot_count`.** The server recomputes `slot_count` and
  `slot_start_at` whenever a PATCH changes `slotMinutes` or `slotDays` on a
  panel that has `slot_days`. A PATCH with `slotMinutes` alone re-derives
  from the stored days.
- **An older build on the same database** only happens on a rollback. It
  would see a two-day panel as back-to-back slots from Day 1's open. That is
  accepted, and noted in the release notes. A rollback should be followed by
  the JA re-saving slots.
- **Legacy panels** (no `slot_days`) are read exactly as today, even one that
  crosses midnight. Re-saving one in the dialog gives identical slots,
  because a legacy end is `start + count × minutes` and so divides exactly.
- **Day headings** show whenever the panel has 2+ days configured, even when
  only Day 2 is left (it still reads "Day 2"). A one-day panel gets none.
- **Direct readers of the old fields**, confirmed by grep, are only
  `data.ts` (`buildSlots`' early return on `slot_count`, which should go
  through `slotTimes`/`panelDays` instead) and `panelsLogic.ts`
  (summary/header/draft). The team page, judge and board all read slots
  through `buildSlots`/`slotTimes` or the request's own `slot_start`.

## Left to the builder

CSS class names (reuse the `ja-` and `dk-` families and the existing day-card
look from the board); exact component split; where `slotLabel` lives
(next to `formatClock` in `ui.tsx` is fine).

## Done when

`npm test`, `npm run typecheck`, and
`npx eslint . --ignore-pattern '.claude/**'` all pass. It is then checked in
the browser on a copy of the data, and on the iPhone 17 simulator (desk Book
tab and Coordinator Slots tab), with a short section in the release notes.
Commit locally only.
