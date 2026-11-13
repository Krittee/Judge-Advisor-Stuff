# Slot windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each panel gets a booking window per event day (date, open, end, optional break) for up to 2 days in the UI. Every booking surface offers and accepts only slots inside those windows.

**Architecture:** One new `slot_days` field on `Panel` (jsonb in Postgres, a plain array in the JSON file). A pure `panelDays()` reads it, falling back to the legacy start/count fields, and `slotTimes()` generates slots from it, so `buildSlots`, `isRealSlot` and both booking routes follow automatically. The UI changes are the JA slot dialog (day cards), day headings and a break row in the booking grids, and a weekday prefix on bookings shown on another day.

**Tech Stack:** Next.js 15, React 19, TypeScript, node:test via `tsx` (`npm test`), node-postgres.

**Spec:** `design/slot-windows/PROMPT.md` (read it first; it holds every rule and the "Settled after the builder review" section). Reference boards: `design/slot-windows/reference-phones.dc.html`, `design/slot-windows/reference-ja-wide.dc.html`.

## Global Constraints

- Work only in this worktree: `/Users/kritteesmac/Desktop/Claude/Local-Judge-Advisor-Stuff-claude-event-judge-booking-app-kcprxn/.claude/worktrees/slot-windows` (branch `claude/slot-windows`). Commit locally; never push.
- Database change additive only: `alter table panels add column if not exists slot_days jsonb not null default '[]'::jsonb;` inside the existing self-running migration block (next to the `languages` lines in `src/lib/db/postgres.ts`). No updates or deletes of existing rows.
- Bangkok time (`+07:00`, no DST). Reuse `bangkokDay` / `bangkokClock` from `src/lib/stepTimes.ts`; export its `OFFSET` if needed rather than redefining it.
- `src/lib/data.ts` stays importable from the browser (no store imports).
- Desk grid rows render on a single line (project rule in CLAUDE.md).
- No animation or transitions. Colour is signal: muted for break and passed, accent only for interactive chrome.
- Checks: `npm test`, `npm run typecheck`, `npx eslint . --ignore-pattern '.claude/**'`. Baseline is 1691 passing tests, and all of them must keep passing.
- Do not run `npm run build` while a dev server runs from this worktree. Never touch `.data/`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A JA types an end time before the open time, or a break outside the window.** Expect a 400 naming the day, with nothing saved. (Task 1: `parseSlotDays` tests; Task 2: the dialog shows the server's error.)
2. **A desk booking made from a page left open while the JA re-timed the panel.** Expect a 409 "not one of … slots", as today. (Task 1: a route test books an old-grid time after `slotDays` changed.)
3. **Turning booking off on a panel that had legacy start/count.** It must stay off and must not be revived by the fallback. (Task 1: a test where a PATCH with `slotDays: []` gives `slotTimes` = [] and `slot_count` = 0.)
4. **A browser outside Bangkok, such as a JA laptop on UTC.** The dialog's draft ↔ ISO must still give Bangkok wall times. (Task 2: a round-trip test that does not depend on `TZ`, using `+07:00` strings.)
5. **On Day 1, a team already booked for Day 2.** The desk list and team page must show "Sun 9:15 AM", not a bare "9:15 AM". (Task 3: `slotLabel` tests and one DeskView/BookingTime render assertion.)

---

### Task 1: Data model, slot generation, validation, stores, API

**Files:**
- Modify: `src/lib/types.ts` (add `SlotDay`, `Panel.slot_days`)
- Modify: `src/lib/data.ts` (`panelDays`, `slotTimes`, `buildSlots`, `isRealSlot` signatures, new `parseSlotDays`, `slotSummaryFields`)
- Modify: `src/lib/db/postgres.ts` (migration line, `PANEL_SELECT`, `updatePanel` jsonb param)
- Modify: `src/lib/db/file.ts` (load default, create default, update)
- Modify: `src/app/api/admin/panels/route.ts` (POST and PATCH accept `slotDays`)
- Test: `tests/slots.test.mjs`, a new `tests/slotDays.test.mjs`, `tests/postgres-sql.test.mjs`, `tests/storeConformance.runtime.ts`, `tests/adminPanels.runtime.test.tsx` (or the existing admin panels route test, whichever file holds `/api/admin/panels` route tests), and `tests/requestWorkflow.runtime.test.ts`

**Interfaces (produces):**
```ts
// types.ts
export type SlotDay = { open_at: string; end_at: string; break_from: string | null; break_to: string | null };
// Panel gains: slot_days: SlotDay[];
// data.ts
export type SlotFields = Pick<PublicPanel, "slot_start_at" | "slot_minutes" | "slot_count"> & { slot_days?: SlotDay[] };
export function panelDays(panel: SlotFields): SlotDay[];
export function slotTimes(panel: SlotFields): { start: Date; end: Date }[];   // existing name, new body
export function isRealSlot(panel: SlotFields, start: Date, end: Date): boolean;
export function buildSlots(panel: Pick<PublicPanel,"id"> & SlotFields, requests, teams, excludeRequestId?): Slot[];
export function parseSlotDays(raw: unknown, minutes: number): { days: SlotDay[] } | { error: string };
/** What a save writes besides slot_days: first open (or null) and the total slot count. */
export function slotSummaryFields(days: SlotDay[], minutes: number): { slot_start_at: string | null; slot_count: number };
export const MAX_SLOT_DAYS = 7; export const MAX_TOTAL_SLOTS = 200;
```

- [ ] **Step 1: Write the failing tests** in `tests/slots.test.mjs` (keep every existing test) and the new `tests/slotDays.test.mjs`. Use the spec's example: 15 min; Day 1 `2026-11-21T10:00+07:00`–`16:00`, break `12:00`–`13:00`; Day 2 `2026-11-22T09:00+07:00`–`12:00`.
  - `two days with a lunch break give 20 + 12 slots`: length 32. First is 10:00, Day 1's last morning slot is 11:45, the first afternoon slot is 13:00, Day 1's last is 15:45, and Day 2 runs 09:00 … 11:45.
  - `a slot ending exactly at the break is kept, one crossing it is dropped, afternoon restarts at break_to`: 20 min, open 10:00, break 11:00–11:30 gives slots 10:00, 10:20, 10:40 (ends 11:00), then 11:30. 11:00 and 11:20 are not slots.
  - `a slot crossing end is dropped; one ending exactly at end is kept`: open 10:00, end 10:50, 20 min gives [10:00, 10:20].
  - `legacy panel (no slot_days) gives today's slots`: the existing 13:00 × 20 × 4 case, with `slot_days: []` and with `slot_days` absent.
  - `slot_days wins over legacy fields when both are set`.
  - `isRealSlot` refuses 12:15 Day 1 (break), 09:07 Day 2 (off-grid), and 10:00 on `2026-11-23` (no Day 3). It accepts 09:15–09:30 Day 2.
  - `parseSlotDays` refuses each of these with the day named in the error: open ≥ end; open and end on different Bangkok dates; only one break field set; break outside the window; break_from ≥ break_to; two days on the same date; more than `MAX_SLOT_DAYS` days; a day that yields 0 slots; a total over `MAX_TOTAL_SLOTS`; a non-ISO string. It accepts `[]`, and returns the two days sorted when they are given in reverse order.
  - `slotSummaryFields` gives the first open and 32 for the example, and `{ slot_start_at: null, slot_count: 0 }` for `[]`.
- [ ] **Step 2: Run** `npx tsx --tsconfig tsconfig.test.json --test tests/slots.test.mjs tests/slotDays.test.mjs`. Expected: the new tests FAIL and the old ones pass.
- [ ] **Step 3: Implement in `data.ts`.** Write `panelDays` and `slotTimes` with the walk algorithm from the spec ("Reading"). `buildSlots` drops its `slot_count` early return and uses `slotTimes(panel).length === 0`. Add `parseSlotDays` and `slotSummaryFields`. Add `slot_days: SlotDay[]` to `Panel` in `types.ts`, and fix every compile error this causes (fixtures, presets, demo seed: add `slot_days: []`).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Write the failing store and route tests.**
  - `postgres-sql.test.mjs`: the migration SQL contains `add column if not exists slot_days jsonb not null default '[]'::jsonb`. Follow the file's existing pattern for the `languages` lines. Through the mock driver, `updatePanel(id, { slot_days: [...] })` sends a JSON string param bound as `$n::jsonb`.
  - `storeConformance.runtime.ts` (runs on the file store, and on Postgres when `TEST_DATABASE_URL` is set): a new panel has `slot_days` = []; `updatePanel` with the two example days round-trips them deep-equal; a request made on a Day 2 slot is accepted and one within 20 minutes of it on the same panel is refused (the existing gap rule, now across days).
  - File store: a state file whose panels lack `slot_days` loads with `slot_days: []`. Find the test that covers `languages ??= []` and mirror it.
  - Admin panels route tests:
    - PATCH `{ id, slotMinutes: 15, slotDays: [Day1, Day2] }` gives 200, with `slot_days` stored, `slot_count` 32 and `slot_start_at` = Day 1 open.
    - PATCH with an end before the open gives 400 with nothing changed.
    - PATCH `{ slotDays: [] }` on a panel with legacy `slot_count: 8` gives `slot_count` 0, `slot_start_at` null, and `slotTimes` = [].
    - PATCH `{ slotMinutes: 20 }` alone on a panel with days re-derives `slot_count`.
    - An old body `{ slotStartAt, slotCount }` clears `slot_days`.
  - `requestWorkflow.runtime.test.ts`: after the panel gets the example days, POST `/api/requests` kind `slot` at 12:15 Day 1 gives 409, and at Day 2 09:15–09:30 gives 200. A slot from the old legacy grid (pre-re-time) gives 409.
- [ ] **Step 6: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 7: Implement the stores and the route.**
  - Postgres: add the migration line, add `p.slot_days` to `PANEL_SELECT`, and in `updatePanel` map a `slot_days` value to `JSON.stringify(value)` with the assignment `slot_days = $n::jsonb`.
  - File store: `p.slot_days ??= []` on load, `[]` on create, `updatePanel` stores it.
  - Route, PATCH and POST:
    - When `slotDays` is in the body, `parseSlotDays` it (400 on error) and set `slot_days`, `slot_minutes`, plus the `slotSummaryFields` output.
    - When only `slotMinutes` changes on a panel with `slot_days`, recompute the summary from the stored days.
    - When an old `slotStartAt`/`slotCount` body arrives without `slotDays`, also set `slot_days = []`.
- [ ] **Step 8: Run** `npm test && npm run typecheck && npx eslint . --ignore-pattern '.claude/**'`. Expected: all pass, 1691 + new tests.
- [ ] **Step 9: Commit** with the message `Slot windows: per-day open/end/break on panels, both stores, panel API`.

### Task 2: JA slot dialog (Day cards) and panel summary

**Files:**
- Modify: `src/components/admin/panelsLogic.ts` (`SlotDraft`, `startSlotDraft`, `slotBody`, `slotsSummary`, `slotsHeader`, draft helpers)
- Modify: `src/components/admin/PanelsTab.tsx` (`SlotsDialog`/`SlotsBody`)
- Modify: `src/app/globals.css` (day-card styles in the `ja-` family)
- Test: `tests/adminPanels.logic.test.mjs`, `tests/adminPanels.runtime.test.tsx`

**Interfaces:**
- Consumes: `SlotDay`, `panelDays`, `slotTimes`, `MAX_SLOT_DAYS` (Task 1). The PATCH body is `{ slotMinutes, slotDays }`.
- Produces:
```ts
export type DayDraft = { date: string /* "2026-11-21" */; open: string /* "10:00" */; end: string; breakFrom: string | null; breakTo: string | null };
export type SlotDraft = { minutes: number; days: DayDraft[] };
export function startSlotDraft(p: SlotFields): SlotDraft;          // from panelDays, Bangkok wall time
export function dayFromDraft(d: DayDraft): SlotDay;                 // "+07:00" ISO
export function slotBody(d: SlotDraft): { slotMinutes: number; slotDays: SlotDay[] };
export function addDay(d: SlotDraft): SlotDraft;                    // next date, same hours as the last day
export function draftCount(d: SlotDraft): { perDay: { count: number; last: string | null }[]; total: number };
export function slotsSummary(p: SlotFields): string;                // "Day 1 10:00–16:00 · Day 2 09:00–12:00 · 15 min" | "Day 1 10:00–15:00 · 20 min" | "Booking slots off"
```

- [ ] **Step 1: Failing logic tests** in `adminPanels.logic.test.mjs`:
  - Draft round trip: a `slot_days` example gives a draft (`date "2026-11-21"`, `open "10:00"`, `breakFrom "12:00"`), and `slotBody` gives the identical ISO instants. This must hold under `TZ=UTC` and `TZ=America/New_York`, so assert on instants, not local strings.
  - A legacy panel (`slot_start_at` 10:00 Bangkok, 20 min, 8) gives one day 10:00–12:40 with no break.
  - `addDay` gives the next date with the same hours. A second `addDay` is capped at 2 days in the UI (the helper returns the draft unchanged).
  - `draftCount` gives 20 / last "15:45" and 12 / last "11:45", total 32.
  - `slotsSummary` covers one day, two days, and off (`slot_days` [] with `slot_count` 0).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement the logic.** Update the existing `slotsSummary` tests whose old wording ("8 slots from 10:00 · 20 min") the spec replaces.
- [ ] **Step 4: Failing render test** in `adminPanels.runtime.test.tsx`:
  - The dialog for a two-day panel shows "Day 1" and "Day 2" cards with date/time inputs labelled Date, Open, End, Break from, Break to, plus "20 slots · last 15:45", "32 slots in all" and a "Save slots · 32" button.
  - Removing Day 2's card removes it. "+ Add day" brings it back.
  - "Turn booking off" sends `slotDays: []`.
  - A 400 from the server shows in the dialog's alert.
- [ ] **Step 5: Implement the dialog** per `reference-phones.dc.html` (sheet on phone) and `reference-ja-wide.dc.html` (two cards side by side in a ~760px dialog on wide). Use real `type="date"` and `type="time"` inputs with `<label>`. "+ Add break" / remove-break toggles the break fields. The panel card's booking line uses the new `slotsSummary`, and `data-off` uses `slotTimes(panel).length === 0`.
- [ ] **Step 6: Run** `npm test && npm run typecheck && npx eslint . --ignore-pattern '.claude/**'`. Expected: PASS.
- [ ] **Step 7: Commit** with the message `Slot windows: JA day-card slot dialog and panel summary`.

### Task 3: Booking grids, Coordinator list, and day-aware booking times

**Files:**
- Modify: `src/components/desk/deskLogic.ts` (`slotGrid`), `src/components/desk/DeskSlots.tsx`
- Modify: `src/components/coordinator/coordinatorLogic.ts` (`slotsModel`), `src/components/coordinator/SlotsTab.tsx`
- Modify: `src/components/SlotPicker.tsx` (`noSlotsLeftLine` wording)
- Modify: `src/components/ui.tsx` (new `slotLabel`; `BookingTime` uses it)
- Modify (swap `formatClock(<slot start>)` to `slotLabel(…)`): `src/app/coordinator/page.tsx:109`, `src/app/queue/page.tsx:124,140,177,199`, `src/components/desk/deskLogic.ts:248`, `src/components/desk/DeskView.tsx:198,306,326,401,478,536,560`, `src/components/admin/InterviewControls.tsx:82`, `src/components/admin/FloorTab.tsx:381`, `src/components/admin/TeamsTab.tsx:1188`, `src/components/board/TileTime.tsx`, `src/components/board/BoardView.tsx:244` (width calc follows the label)
- Modify: `src/app/globals.css` (`dk-` day heading and break row)
- Test: `tests/deskLogic*.test.*` (whichever holds `slotGrid` tests), `tests/coordinatorLogic.test.ts`, `tests/slotPicker.runtime.test.tsx`, a new `tests/slotLabel.test.ts`

**Interfaces:**
- Consumes: `panelDays`, `buildSlots` (Task 1), `bangkokDay` (stepTimes).
- Produces:
```ts
// ui.tsx
export function slotLabel(iso: string | null, now?: number): string; // same Bangkok day → formatClock(iso); else "Sun " + formatClock(iso); null → "—"
// deskLogic.ts: SlotGrid gains
export type GridDay = { day: number /* 1-based, from panelDays order */; label: string /* "Day 1 · Sat 21 Nov" */; open: number; rows: SlotRow[]; breakAfterHour: string | null; breakLabel: string | null /* "12:00–13:00 · Break" */ };
export type SlotGrid = { days: GridDay[]; showDayHeadings: boolean; columns: number; shown: number; open: number; rows: SlotRow[] /* flat, kept for existing callers */ };
export function slotGrid(slots: Slot[], panel: SlotFields, ctx: SlotContext): SlotGrid; // second arg was slotMinutes
```

- [ ] **Step 1: Failing tests.**
  - `slotGrid` with the example panel at `now` = Day 1 11:00 gives 2 days, `showDayHeadings` true, Day 1 label "Day 1 · Sat 21 Nov", and the break after the 11:00 hour row, labelled "12:00–13:00 · Break". Day 2 has 12 open.
  - At `now` = Day 1 17:00, only Day 2 shows and it is still labelled "Day 2", with headings still on.
  - At `now` = Day 1 12:30 (morning passed), no break row shows, because nothing remains before it.
  - A one-day legacy panel gives `showDayHeadings` false and the same rows as today. Existing tests are updated only for the new second argument.
  - Coordinator `slotsModel` exposes the same `days` for `SlotsTab`.
  - `noSlotsLeftLine`: when all slots have passed it reads "No slots left — the rest have already passed".
  - `slotLabel`: the same day returns a clock only; Day 2 seen from Day 1 returns `"Sun "` + the clock; null returns "—". Pass `now` explicitly.
  - A DeskView or BookingTime render asserts that a Day 2 booking seen on Day 1 reads with "Sun".
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - DeskSlots renders, per day: a heading row (when `showDayHeadings`) "Day 1 · Sat 21 Nov · 6 open", the hour rows, and a full-width muted break row. Rows stay single-line.
  - SlotsTab renders the same headings and break row in its list.
  - Swap the listed `formatClock` slot call sites to `slotLabel`. Grid cell times stay clock-only (`slotTime`).
- [ ] **Step 4: Run** `npm test && npm run typecheck && npx eslint . --ignore-pattern '.claude/**'`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Slot windows: day headings and break row in booking grids, weekday on other-day bookings`.

### After Task 3 (Opus)

Review each task's diff against the spec. Then browser-check on a copy of `.data` (JA dialog at 1280 and 375, desk Book, Coordinator Slots), and check on the iPhone 17 simulator (desk + Coordinator). Add a "Version 2.1.3: slot windows" section to `RELEASE-NOTES-2.0-2.2.md` (including the rollback note), bump `package.json` to 2.1.3, and commit locally.
