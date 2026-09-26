# Sept 25 release review

Carried over from [PR #3](https://github.com/Krittee/Judge-Advisor-Stuff/pull/3), which
compared two frozen snapshots (`release/judge-queue-2026-09-25` vs.
`review-base/judge-queue-2026-09-25`) so this release could be reviewed as one diff
after the fact. Merging that PR was never going to touch production — it existed only
to hold this review. Recorded here, on `backend-dev`, before those two snapshot
branches are deleted; also referenced from
[PR #4](https://github.com/Krittee/Judge-Advisor-Stuff/pull/4), which is what actually
merged into `main`.

## What changed

Publishes the current Judge Queue interface and booking updates, including mobile
layouts, theme and navigation refinements, and storage and booking behavior fixes.

This release deployed from `claude/event-judge-booking-app-kcprxn` at commit
`d9c24ed`, compared against the previous production commit (`00cdc17`).

## Validation (at the time)

- `npm test`: 316 passed, 1 skipped (Postgres conformance requires `TEST_DATABASE_URL`)
- `npm run build`: succeeded
- Vercel production deployment: Ready
- Production `/api/health`: `{"ok":true}`

## New features

- **Cross-division "Blended" judging** — a new `divisionsCompatible()` helper
  (`src/lib/presets.ts`) treats a division as compatible if it's an exact match *or*
  either side is a "blended" division (auto-detected by name via
  `/blend|mixed|combined/i`, overridable in `config/event.json`). Applied
  consistently in `db/file.ts` and `db/postgres.ts` (auto-assign, division-change
  unassignment), `server-state.ts` (judge visibility), and the admin teams / requests
  reassignment APIs — so a Blended team is judgeable without needing a dedicated panel.
- **Booking gap enforcement** — `BOOKING_GAP_MINUTES = 20` (`src/lib/data.ts`) blocks
  free slots within 20 minutes of another live booking on the same panel (judges need
  walking time between interviews). Enforced server-side in both stores on booking
  creation *and* on reassignment (previously reassignment wasn't re-validated at all);
  the UI shows blocked slots as disabled "too close" buttons in `SlotPicker.tsx`.
- **Shared nav** — `src/components/nav.tsx` (new) introduces `TabBar` and
  `ConsoleLinks`, replacing three separate page-local nav implementations (admin's
  tabs, judge's pills, and the now-deleted `RefereeNav.tsx`).
- **Live score totals** on judge queue cards via a new shared `useScores()` hook
  (`useAppState.ts`), plus a `BookingTime` countdown component (turns orange as a slot
  approaches) used across admin/judge/queue/board/team pages.
- Full re-theme to an OKLCH-based semantic design-token system in `globals.css`
  (`--ink`, `--surface`, per-status tone triples, a shared `tone.ts` color helper),
  replacing ~40 hand-maintained per-utility light-mode overrides.

## Bug fixes

- **Panel/division check bypass** (`api/admin/teams/route.ts`): a PATCH that changed a
  team's division *and* panel in the same request used to skip the compatibility check
  entirely — could silently assign a team to a panel that shouldn't judge it. Now
  always validated against the resulting division.
- **Judge double-submit race** (`judge/page.tsx`): a `useRef`-backed `Set` now blocks a
  second `advance()`/`summon()` call synchronously (before React's disabled-state
  re-render lands), fixing a real bug where double-tapping (e.g. on flaky venue wifi)
  could skip a status in the interview state machine.
- **Stale UI after concurrent refresh** (`useAppState.ts`): `refresh()` used to
  silently no-op if a poll was already in flight, so a write could appear to do
  nothing until the next 4s tick. It now shares the in-flight promise so every caller
  gets a completed refresh.
- **Orphaned flags on team delete** (`db/file.ts`): deleting a team didn't clear its
  flags or null its activity rows, unlike Postgres's cascade/set-null behavior — flags
  could silently persist under a dead team id and keep counting toward "repeat
  violation" history. Fixed, and covered by a new cross-backend conformance suite plus
  a dedicated parity test.
- Duplicate/confusing UI on the public team page: one full-width "Request a judge —
  {language}" button per language collapsed into a single heading with concise
  per-language buttons.

## Access control (worth a second look)

- `api/admin/activity/route.ts`: activity-log read access tightened from
  `canReadNotes` to `canAdminister`.
- `server-state.ts`: judge visibility is widened across the division wall so a judge
  can see a panel holding a blended team they're allowed to see — explicitly scoped to
  team/panel display only; notes/scores/flags stay on the narrower per-panel wall.

## Self-disclosed risk

- `db/postgres.ts`: the new 20-minute gap check in `createRequest` is
  check-then-insert with no transaction/advisory lock (the exact-time case still has a
  DB unique-index backstop). Flagged as a low-likelihood-at-event-scale race to
  revisit with an advisory lock if it ever bites.

## Tests

- New cross-backend conformance suite (`tests/storeConformance.runtime.ts`, 578
  lines) asserting the file and Postgres stores behave identically: delete cascades,
  one-request-per-team/slot invariants, the division wall + auto-assign, score
  save/clear semantics, uniqueness constraints.
- Dedicated tests for the blended-division feature, the booking gap, booking urgency,
  team-delete parity, and structural theme/contrast checks.
- `TEST_DATABASE_URL` deliberately kept separate from `DATABASE_URL` so a careless
  `npm test` run can't `resetAll()` a live production database.

## Also included

- Two Google Fonts added (Archivo, Fira Sans) specifically to make team-number
  identifiers legible (distinguishing `1 l I` and `0 O`).
- Mobile responsiveness: sticky first column + hidden low-priority columns in the
  admin Teams table; viewport-relative (`vw`/`vh`/`clamp()`) sizing throughout the
  board page.

Note: `package.json`/`package-lock.json` drop `@supabase/ssr` and
`@supabase/supabase-js` as dependencies, but no Supabase-related logic appeared
elsewhere in that diff — flagged at the time as worth confirming these were already
unused (dead dependency cleanup) rather than part of an in-flight, only-partially
committed migration.

## What happened after

The Teams-table mobile responsiveness noted above still let the Team and Name columns
consume up to 134% of a phone's screen width in practice. That follow-on fix shipped
separately in [PR #4](https://github.com/Krittee/Judge-Advisor-Stuff/pull/4).
