# "No winner" for an award — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Judge Advisor can mark any award in a division "No winner"; the board shows it, counts it as decided, and Clear undoes it.

**Architecture:** A new record kind `NoWinnerRow` with its own store methods (file + Postgres table `award_no_winner`) and its own route `/api/awards/no-winner`. The JA's `GET /api/awards` adds `noWinners`. Board logic treats a mark as decided.

**Tech Stack:** Next.js 15 route handlers, React 19, TypeScript, node:test via `npm test` (tsx).

**Spec:** `docs/superpowers/specs/2026-11-16-no-winner-award-design.md`

## Global Constraints

- Copy: status chip `No winner`; button `Mark no winner`; undo button `Clear`. Questions:
  `Mark <Award> as no winner?` (no holder) / `Mark <Award> as no winner? <number> will no longer be the winner.` (holder, confirmLabel `Mark no winner`);
  `Clear No winner on <Award>?` (confirmLabel `Clear`); give over a mark: `Give <Award> to <number> instead of No winner?` (confirmLabel `Replace No winner`).
- DB change additive only: `create table if not exists`, RLS enabled like `award_winners`. Do not alter `award_winners` (a parallel session is changing it).
- Judges never receive `noWinners` (their GET reply keys stay exactly `awards, nominations`).
- Test on a copy of data only; never touch `.data/`. Do not run `npm run build`. ESLint with `--ignore-pattern '.claude/**'`.
- Keep edits to `src/app/api/awards/winners/route.ts` to the one PUT change in Task 2.

## Review Focus

- Old `.data/state.json` without `noWinners` must load (`data.noWinners ??= []`).
- Marking no winner on an award a team holds removes that winner (both stores, via the route).
- Giving a team an award that is marked removes the mark.
- Day reset and full reset clear the marks in both stores (Postgres `resetAll` must name `award_no_winner`: it has no team FK to cascade from).
- An unknown award id or missing division is a 400; non-JA is 403 for PUT and DELETE.

---

### Task 1: Store — `NoWinnerRow` in types, file store, Postgres

**Files:**
- Modify: `src/lib/types.ts` (next to `WinnerRow`), `src/lib/db/types.ts` (next to `NewWinner` / `setWinner`), `src/lib/db/file.ts`, `src/lib/db/postgres.ts`
- Test: `tests/storeConformance.runtime.ts`, `tests/postgres-sql.test.mjs`

**Interfaces — Produces:**
- `type NoWinnerRow = { award_id: string; division: string; decided_by: string; decided_at: string }` (src/lib/types.ts)
- `type NewNoWinner = { awardId: string; division: string; decidedBy: string }` (src/lib/db/types.ts)
- Store: `listNoWinners(): Promise<NoWinnerRow[]>`; `setNoWinner(input: NewNoWinner): Promise<NoWinnerRow>` (upsert on award+division, refreshes decided_by/decided_at); `clearNoWinner(awardId: string, division: string): Promise<boolean>`.
- Postgres table: `award_no_winner (award_id text not null, division text not null, decided_by text not null, decided_at timestamptz not null default now(), primary key (award_id, division))`, plus `alter table award_no_winner enable row level security;`. `listNoWinners` orders `by decided_at, award_id, division`. `resetDay` and `resetAll` truncate lists include `award_no_winner`.
- File store: `noWinners: NoWinnerRow[]` in state, fresh state, `??= []` on load, cleared in `resetDay` and the full reset.

- [ ] **Step 1: Conformance test** `"an award can be marked no winner per division: marking again replaces it, clear removes it, resets clear it"` — set ES/design by "Alex", set again by "Sam" → one row, decided_by "Sam"; MS/design is a second row; `clearNoWinner("design", ES)` true then false; `resetDay()` then `listNoWinners()` deep-equals `[]`; again after `resetAll()`. Also assert `setNoWinner` leaves `listWinners()` untouched.
- [ ] **Step 2: postgres-sql tests** — migrate body contains the `award_no_winner` create table and its RLS line; set/list/clear SQL shapes; `resetDay` and `resetAll` SQL match `/\baward_no_winner\b/`.
- [ ] **Step 3:** Run `npm test` — new tests FAIL.
- [ ] **Step 4:** Implement in both stores.
- [ ] **Step 5:** `npm test` PASS (Postgres conformance runs only with `TEST_DATABASE_URL`; say if not run).
- [ ] **Step 6:** Commit.

### Task 2: API — `/api/awards/no-winner`, GET adds `noWinners`, winner PUT clears the mark

**Files:**
- Create: `src/app/api/awards/no-winner/route.ts`
- Modify: `src/app/api/awards/route.ts` (admin GET), `src/app/api/awards/winners/route.ts` (PUT only), `src/lib/types.ts` (`AwardsAdminView` gains `noWinners: NoWinnerRow[]`; `NoWinnerReply = { noWinner: NoWinnerRow }`)
- Test: `tests/awardsRoute.runtime.test.ts`

**Interfaces — Consumes:** Task 1 store methods. **Produces:**
- `PUT /api/awards/no-winner` body `{ awardId, division }` → `{ noWinner }`. JA only (`canAdminister`, 403 `Only the Judge Advisor can decide an award.`); 400 if missing award/division or award unknown. Clears any team winner for (award, division) via `clearWinner`, then `setNoWinner`. If it was already marked and nobody held it, write/log nothing and return the existing row. Logs `kind: "award"`, `teamId` = former winner's id or null, action `marked <Award label> no winner`, detail `<division>` or `<division> · instead of <number>`.
- `DELETE /api/awards/no-winner` body `{ awardId, division }` → `RemoveReply`. JA only; 400 when missing. Logs `cleared No winner on <Award label>` only when removed.
- Winners PUT: after the nomination check and before writing, if a mark exists for (award, division), `clearNoWinner` it (log detail `<division> · instead of No winner`). The "same team already" early return stays first.
- Use `fields`, `awardLabel` from `../shared` and `actorParts` like the winners route.

- [ ] **Step 1: Route tests** — non-JA sessions get 403 on PUT and DELETE; 400 on missing division / unknown award; JA marks design ES → `listNoWinners` has it and `listWinners` lost the held winner; PUT `/api/awards/winners` for a nominee on that award removes the mark; DELETE clears (removed true, then false); admin GET keys are exactly `["awards","nominations","noWinners","winners"]` (update the existing keys assertion); judge GET keys stay `["awards","nominations"]` and text has no `no winner`.
- [ ] **Step 2:** `npm test` — FAIL. **Step 3:** implement. **Step 4:** `npm test` PASS. **Step 5:** commit.

### Task 3: Board — counts, chip, buttons, Matrix sign

**Files:**
- Modify: `src/components/admin/awardsLogic.ts`, `src/components/admin/AwardsTab.tsx`, `src/app/admin/page.tsx` (rail count), `src/app/globals.css` only if a style is needed (reuse `ja-aw-cst ja-aw-ok` and existing button classes first)
- Test: `tests/adminAwards.logic.test.mjs`, `tests/adminAwards.runtime.test.tsx`, `tests/adminAwards.fixtures.ts` (fixtures gain `noWinners: []`), `tests/adminPage.runtime.test.tsx` if it builds an `AwardsAdminView`

**Interfaces — Consumes:** `AwardsAdminView.noWinners`, the Task 2 route. **Produces:**
- `decidedCount(winners, awards, division, noWinners: Pick<NoWinnerRow,"award_id"|"division">[] = [])` and `decidedText(...same)` count an award decided if it has a winner **or** a mark in that division.
- `buildAwardPanels(..., noWinner: Set<string> = new Set())` (set of award ids marked in this division): marked panel has `decided: true`, `status: "No winner"`, and a new field `noWinner: boolean`. Nominees still listed.
- `buildMatrix(..., noWinner = new Set())`: a column for a marked award has `decided: true, noWinner: true`; the header shows a "no winner" sign (an em-dash glyph with `aria-label="no winner"`) instead of the tick. Do not add columns for marked awards that have no nominations.
- `markNoWinnerAfterAsking(ask, call, { award, division, holder: Team | null })` → PUT `/api/awards/no-winner`; `clearNoWinnerAfterAsking(ask, call, { award, division })` → DELETE. `giveAfterAsking` pick gains optional `noWinner?: boolean`: when true (and no current holder) ask the give-over-mark question before PUT. Copy per Global Constraints.
- `AwardLists` per section header: when `noWinner`, a `Clear` button; otherwise a `Mark no winner` button (hidden while busy-disabled like other writes). Wired through `AwardsBoard` props `onMarkNoWinner(awardId)` / `onClearNoWinner(awardId)` and in `AwardsTab` via the existing `write(...)` wrapper. The JA board header "N of 11 decided" and division tags pass `noWinners`. `src/app/admin/page.tsx` passes `awards.data.noWinners`.
- Detail side panel: `onGive` passes `noWinner` for the selected award so the question shows.

- [ ] **Step 1: Logic tests** — `decidedText` counts a mark (`"2/11"` with one winner + one mark, other division unaffected); `buildAwardPanels` marked award → status `"No winner"`, decided true; matrix column flag; question strings exactly as in Global Constraints; `markNoWinnerAfterAsking` sends nothing on a no.
- [ ] **Step 2: Runtime test** — board with a marked award shows chip text `No winner` and a `Clear` button; an unmarked award shows `Mark no winner`; clicking it (ask → yes) calls PUT `/api/awards/no-winner` with `{awardId, division}`.
- [ ] **Step 3:** FAIL → implement → `npm test` PASS, `npx tsc --noEmit`, `npx eslint . --ignore-pattern '.claude/**'` clean.
- [ ] **Step 4:** Commit.
