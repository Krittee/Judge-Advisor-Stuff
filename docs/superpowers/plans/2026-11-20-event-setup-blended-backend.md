# Event setup + blended awards (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A JA-only event setup (program + Standard/Blended) stored in both stores, and award decisions keyed by one scope helper so a blended event gives Excellence and Design per division and every other award once under `"Whole event"`.

**Architecture:** One pure, client-safe module `src/lib/eventSetup.ts` holds `WHOLE_EVENT`, the setup's divisions and the award-scope helper; routes load `event_setup` once per request and pass its format/divisions into pure helpers. Stores read their own `event_setup` row where they call `divisionsCompatible` internally (no module cache). No setup saved ⇒ every helper returns today's answer.

**Tech Stack:** Next.js App Router route handlers, TypeScript, file store + Postgres store, `node:test` via `tsx` (`npm test`).

**Spec:** `docs/superpowers/specs/2026-11-20-event-setup-blended-awards-design.md` (approved, `dcfc3ac`).

## Global Constraints

- No setup saved = today's behaviour, bit for bit. Every existing test passes **unchanged** (do not edit an existing assertion).
- `WHOLE_EVENT = "Whole event"` (exact string).
- `event_setup` row: `program` (a `config/event.json` `programs` label), `format` `"standard" | "blended"`, `set_by`, `updated_at`. One row (`id = 1` check), RLS on, cleared by `resetAll` (wipe), kept by `resetDay`.
- Save refused `409 "Clear the awards first."` while any winner, any No winner, or any release with status `sent` exists. Saving deletes `recalled` release rows.
- Only `config/event.json` `awards` entries are touched (add `"blendedScope": "division"` to `excellence` and `design`). Never touch `refereeFlags` (another branch edits it).
- Request status is spelled `completed`. No page/component/CSS work (UI session does that); `src/components/admin/awardsLogic.ts` pure functions and `src/components/useAppState.ts` initial state are in scope.
- Copy in the existing route style: short sentences, `Team 1234A`, award labels.
- Commit locally after each task on `claude/blended-backend-c6182b`; never push.
- Tests: new files only (plus new `test(...)` blocks appended to `tests/postgres-sql.test.mjs`). Runtime tests copy the harness from `tests/awardsReleased.runtime.test.ts` (own `DATA_FILE` in `tmpdir()`, `SEED_DEMO=false`, `delete DATABASE_URL`).

## Review Focus

1. Blended setup saved, then a panel labelled `"Whole event"` — the judge's `/api/state` must still list every team in the event (format makes the wall open), not none. → Task 3 test.
2. Switching Blended → Standard while a panel is labelled `"Whole event"` — refused with that panel in the list, not silently stranding it. → Task 3 test.
3. Winners PUT with a real division for a whole-event award in a blended event (old client) — 400, never a second Innovate. → Task 4 test.
4. A team holding only a whole-event **sent** award changes division → allowed; deleting it → still locked. → Task 3 test.
5. CSV import of a new team with no division under a V5RC setup lands in `Middle School` (program's first), not `Elementary School`. → Task 2 test.

---

## File map

- Create `src/lib/eventSetup.ts` — pure: `WHOLE_EVENT`, `setupDivisions`, `awardKeys`, `awardKey`, `awardsUnder`, `scopeKeys`, `awardPairs`, `keyError`, `divisionChoices`, `setupLabel`.
- Modify `src/lib/types.ts` — `EventFormat`, `EventSetup`, `AwardView.blendedScope?`, `AppState.eventSetup`, `ReleasedView.setup` + `.sections`.
- Modify `src/lib/presets.ts` — `parseAwards` reads `blendedScope`; `divisionsCompatible(team, panel, format?)`.
- Modify `config/event.json` — `blendedScope` on Excellence and Design (+ one `_comment` line).
- Modify `src/lib/roster.ts` — `planAssignments(..., format?)`.
- Modify `src/lib/db/types.ts`, `file.ts`, `postgres.ts` — `getEventSetup`, `saveEventSetup`; table + RLS + wipe; format-aware internal wall; import default division.
- Create `src/app/api/event-setup/route.ts` — `PUT` (JA only).
- Modify `src/lib/server-state.ts`, `src/components/useAppState.ts`, `src/app/api/admin/panels/route.ts`, `src/app/api/admin/teams/route.ts`, `src/app/api/requests/[id]/route.ts`, `src/app/api/awards/shared.ts`, `src/lib/releases.ts`.
- Modify `src/app/api/awards/winners/route.ts`, `no-winner/route.ts`, `released/route.ts`.
- Modify `src/components/admin/awardsLogic.ts`.
- Tests: `tests/eventSetup.lib.test.mjs`, `tests/eventSetupStore.runtime.test.ts`, `tests/eventSetupRoute.runtime.test.ts`, `tests/blendedAwards.runtime.test.ts`, `tests/blendedAwardsLogic.test.mjs`, appended blocks in `tests/postgres-sql.test.mjs`.

---

### Task 1: Types, config and the pure scope helper

**Files:** Create `src/lib/eventSetup.ts`; modify `src/lib/types.ts`, `src/lib/presets.ts`, `config/event.json`, `src/lib/roster.ts`; test `tests/eventSetup.lib.test.mjs`.

**Interfaces — Produces:**
```ts
// types.ts
export type EventFormat = "standard" | "blended";
export type EventSetup = { program: string; format: EventFormat; set_by: string; updated_at: string };
// AwardView gains:  blendedScope?: "division";   (key present ONLY when config says "division")

// eventSetup.ts  (imports only presets + types; client-safe)
export const WHOLE_EVENT = "Whole event";
type Setup = Pick<EventSetup, "program" | "format"> | null | undefined;
type Scoped = Pick<AwardView, "blendedScope">;
/** The saved program's divisions; null with no setup, or a program config no longer lists. */
export function setupDivisions(setup: Setup, programs?: Program[] /* default presetPrograms() */): string[] | null;
/** The keys an award is decided under. */
export function awardKeys(award: Scoped, divisions: string[], format?: EventFormat | null): string[];
/** The one key a team's decision on this award goes under. */
export function awardKey(award: Scoped, teamDivision: string, format?: EventFormat | null): string;
/** The awards decided under one key: all of them unless blended. */
export function awardsUnder<A extends Scoped>(awards: A[], key: string, format?: EventFormat | null): A[];
/** The board's keys: divisions, then WHOLE_EVENT when blended. */
export function scopeKeys(divisions: string[], format?: EventFormat | null): string[];
/** Every (award, key) pair, key-major then config order: what Send all ready walks. */
export function awardPairs<A extends Scoped>(awards: A[], divisions: string[], format?: EventFormat | null): { award: A; division: string }[];
/** Why `division` is the wrong key for this award under this setup; null when fine, ALWAYS null with no setup. */
export function keyError(award: Pick<AwardView, "label" | "blendedScope">, division: string, setup: Setup): string | null;
/** What a team (forPanel=false) or panel (true) may be filed under: setup divisions (+ WHOLE_EVENT for a blended panel), else presetDivisions(); `fallback` is WHOLE_EVENT for a blended panel, else the first option. */
export function divisionChoices(setup: Setup, forPanel: boolean): { options: string[]; fallback: string };
/** "VEX IQ · Blended" / "V5RC · Standard". */
export function setupLabel(setup: Pick<EventSetup, "program" | "format">): string;
// presets.ts
export function divisionsCompatible(teamDivision: string, panelDivision: string, format?: EventFormat | null): boolean; // "blended" → true, else unchanged
// roster.ts
planAssignments(pending, panels, load, perPanel, blocks, format?: EventFormat | null) // passes format to divisionsCompatible
```
Rules: blended ⇔ `format === "blended"`. In blended, `blendedScope === "division"` awards → `divisions`/`team division`; others → `[WHOLE_EVENT]`/`WHOLE_EVENT`. `awardsUnder(awards, WHOLE_EVENT, "blended")` = non-division awards; `awardsUnder(awards, realDivision, "blended")` = division awards. `keyError` messages: whole-event award with another key → `"<Label> is given once for the whole event. Use \"Whole event\"."`; division award (or any award in Standard) with a key not in `setupDivisions` → `"<Label> is given in each division. Pick one of <list joined ', '>."`.

- [ ] **Step 1: Write failing tests** in `tests/eventSetup.lib.test.mjs`:
  - `awards()` has `blendedScope: "division"` on exactly `["excellence","design"]`; `parseAwards([{id:"x"}])` still deep-equals `[{ id:"x", label:"x", short:"x", blurb:"", places:1 }]` (no extra key).
  - `setupDivisions({program:"VEX IQ",format:"blended"})` → `["Elementary School","Middle School"]`; V5RC → `["Middle School","High School"]`; `null` → `null`; unknown program → `null`.
  - `awardKeys(excellence, [ES,MS], "blended")` → `[ES,MS]`; `awardKeys(judges, [ES,MS], "blended")` → `["Whole event"]`; `awardKeys(judges, [ES,MS], "standard")` and `(…, null)` → `[ES,MS]`.
  - `awardKey(innovate, MS, "blended")` → `"Whole event"`; `awardKey(design, MS, "blended")` → `MS`; `awardKey(innovate, MS, undefined)` → `MS`.
  - `scopeKeys([ES,MS],"blended")` → `[ES,MS,"Whole event"]`; standard/null → `[ES,MS]`.
  - `awardPairs(awards(), [ES,MS], "blended")` length `2*2 + 9 = 13`, and `excellence` appears twice, `judges` once with division `"Whole event"`; `awardPairs(awards(), [ES,MS], null)` length `22` in division-major order (first 11 are ES).
  - `keyError(innovate, MS, {program:"VEX IQ",format:"blended"})` matches `/whole event/`; `keyError(excellence, "Whole event", sameSetup)` matches `/each division/`; `keyError(excellence, "High School", VEX IQ standard)` non-null; `keyError(anything, "Anything", null)` → `null`.
  - `divisionChoices(null,false)` → `{ options: presetDivisions(), fallback: presetDivisions()[0] }`; `divisionChoices(VEX IQ blended, true)` → `{ options:[ES,MS,"Whole event"], fallback:"Whole event" }`; `divisionChoices(V5RC standard, true)` → `{ options:[MS,HS], fallback: MS }`.
  - `divisionsCompatible(ES, HS)` false; `divisionsCompatible(ES, HS, "blended")` true; `divisionsCompatible(ES, "Blended")` true (unchanged).
  - `setupLabel({program:"VEX IQ",format:"blended"})` → `"VEX IQ · Blended"`.
- [ ] **Step 2:** `npx tsx --tsconfig tsconfig.test.json --test tests/eventSetup.lib.test.mjs` → FAIL (module missing).
- [ ] **Step 3:** Implement. `config/event.json`: add `"blendedScope": "division"` to the `excellence` and `design` objects and one `_comment` line: `"An award with \"blendedScope\": \"division\" is given in each division even in a Blended event; every other award is given once for the whole event."` Touch nothing else in that file.
- [ ] **Step 4:** Run the new test → PASS; `npm test` → all pass; `npx tsc --noEmit` clean.
- [ ] **Step 5:** Commit `Event setup: types, scope helper and blendedScope config`.

### Task 2: Stores — `event_setup` row and a format-aware wall

**Files:** Modify `src/lib/db/types.ts`, `src/lib/db/file.ts`, `src/lib/db/postgres.ts`; test `tests/eventSetupStore.runtime.test.ts`, append to `tests/postgres-sql.test.mjs`.

**Interfaces — Consumes:** Task 1 `EventSetup`, `setupDivisions`, `divisionsCompatible(…, format)`, `planAssignments(…, format)`. **Produces (Store):**
```ts
getEventSetup(): Promise<EventSetup | null>;
/** Replaces the one record and deletes every `recalled` award_releases row, in one write. resetDay keeps it, resetAll clears it. */
saveEventSetup(input: { program: string; format: EventFormat; setBy: string }): Promise<EventSetup>;
```
Postgres DDL (in `migrate()` next to `referee_setup`, plus `alter table event_setup enable row level security;`):
```sql
create table if not exists event_setup (
  id         int primary key default 1 check (id = 1),
  program    text not null,
  format     text not null check (format in ('standard', 'blended')),
  set_by     text not null,
  updated_at timestamptz not null default now()
);
```
`saveEventSetup` in Postgres: `withClient` running the upsert (`on conflict (id) do update`, `updated_at = now()`) and `delete from award_releases where status = 'recalled'`. `resetAll` truncate list gains `event_setup`. File store: `eventSetup: EventSetup | null` in state, `??= null` on load, null in `resetAll`.

Format-aware internals (each reads the store's own setup once per call):
- `upsertTeams`: a new team with no division gets `(setupDivisions(setup) ?? presetDivisions())[0]`; the "keep panel on division change" check passes `setup?.format`. Postgres: `$6` becomes that default; the SQL `exists (...)` gains `or $10::boolean` (true when blended).
- `autoAssignTeams` (both): pass format to its two `divisionsCompatible` calls and to `planAssignments`.
- `updatePanel` division change (both): pass format to the release filter.

- [ ] **Step 1: Write failing tests** (`tests/eventSetupStore.runtime.test.ts`, file store):
  - `getEventSetup()` → `null` on a fresh file; after `saveEventSetup({program:"VEX IQ",format:"blended",setBy:"Alex"})` returns `{program:"VEX IQ",format:"blended",set_by:"Alex", updated_at: <ISO string>}` and `getEventSetup()` deep-equals it.
  - A `recalled` release row and a `sent` one exist (create via `sendRelease` + `recallRelease`); after `saveEventSetup`, `listReleases()` has only the `sent` one.
  - `resetDay()` keeps the setup; `resetAll()` makes it `null`.
  - Review Focus 5: V5RC standard setup saved, `upsertTeams([{ number:"100A", name:null, pit:null, division:null, category:null, languages:null }])` → team division `"Middle School"`; with no setup → `"Elementary School"`.
  - Blended: an ES team held by an HS panel; `upsertTeams` moving it to MS keeps `panel_id`; `autoAssignTeams(10, false, "Elementary School")` assigns an MS team to an HS panel; `updatePanel(hsPanel, {division:"Middle School"})` keeps its ES team. Same three with no setup behave as today (panel lost / not assigned / released).
  - `postgres-sql.test.mjs` (appended): migrate text matches the DDL regex above and contains `alter table event_setup enable row level security;`; `resetAll` SQL contains `event_setup`; `resetDay` SQL does not.
- [ ] **Step 2:** Run both files → FAIL.
- [ ] **Step 3:** Implement in both stores.
- [ ] **Step 4:** New tests PASS; `npm test` all pass; `tsc` clean.
- [ ] **Step 5:** Commit `Event setup: event_setup row in both stores`.

### Task 3: `/api/event-setup`, state, divisions, panels/teams/requests, team lock

**Files:** Create `src/app/api/event-setup/route.ts`; modify `src/lib/server-state.ts`, `src/components/useAppState.ts`, `src/lib/types.ts` (AppState), `src/app/api/admin/panels/route.ts`, `src/app/api/admin/teams/route.ts`, `src/app/api/requests/[id]/route.ts`, `src/app/api/awards/shared.ts`, `src/lib/releases.ts`; test `tests/eventSetupRoute.runtime.test.ts`.

**Interfaces — Consumes:** Tasks 1–2. **Produces:**
```ts
// server-state.ts
export function eventDivisions(panels: Panel[], teams: Team[], setup?: Pick<EventSetup,"program"|"format"> | null): string[]; // setupDivisions(setup) ?? today's list
// AppState gains:  eventSetup: EventSetup | null;  // null for an anonymous caller; set_by "" for marketing; full for staff
// releases.ts
export function sentHolding(releases, teamId, divisionScopedOnly = false): AwardReleaseRow | undefined; // true skips rows with division === WHOLE_EVENT
// awards/shared.ts
export async function teamLockMessage(teamId: string, divisionChange = false): Promise<string | null>;
```
**Route `PUT /api/event-setup`** body `{ program, format }`:
1. `!canAdminister` → 403 `"Only the Judge Advisor can set up the event."`
2. `program` not a `presetPrograms()` label → 400 `"Pick a program: VEX IQ or V5RC."` (labels joined `" or "`); `format` not standard/blended → 400 `"Pick Standard or Blended."`
3. Same program and format as stored → 200 `{ setup }`, nothing written or logged.
4. Any winner, No winner, or `sent` release → 409 `{ error: "Clear the awards first." }`.
5. Teams with a division not in `setupDivisions(new)`, panels not in `divisionChoices(new, true).options` → 409 `{ error: "Move or remove the teams and panels outside <program> first.", outside: { teams: {id,number,division}[], panels: {id,name,division}[] } }`.
6. `saveEventSetup`; log `kind: "setup"`, action `Event setup: <setupLabel>`, detail `was <setupLabel(previous)>` or null. Reply 200 `{ setup }`.
(`ponytail:` comment: check-then-write is not atomic, as `refuseIfSent`.)

Elsewhere (load `getEventSetup()` once per request):
- `loadState`: add to its `Promise.all`; `eventDivisions(…, setup)`; both `divisionsCompatible` calls get `setup?.format`.
- Panels POST/PATCH and teams import/PATCH/autoAssign: replace both local `resolveDivision`s with `divisionChoices(setup, forPanel)` (`options.includes(wanted) ? wanted : fallback`). With no setup this is exactly today's.
- Teams PATCH assign/division paths and requests reassign: pass `setup?.format` to `divisionsCompatible`.
- Division change (PATCH and import paste) calls `teamLockMessage(id, true)`; team delete keeps `teamLockMessage(id)`.

- [ ] **Step 1: Write failing tests** (`tests/eventSetupRoute.runtime.test.ts`):
  - Non-JA (queuer, judge, marketing) → 403; bad program / format → 400 with the copy above.
  - Saves VEX IQ blended → 200, `/api/state` as admin has `eventSetup.program === "VEX IQ"`, `divisions` `[ES, MS]` (no `"High School"`, no `"Blended"`); as marketing `eventSetup.set_by === ""`; anonymous `eventSetup === null`; activity has `Event setup: VEX IQ · Blended`.
  - Re-save identical → 200 and no second activity row.
  - A winner exists → 409 `"Clear the awards first."`; same for a No winner and for a `sent` release; a `recalled` release alone does not block and is gone after save.
  - An Elementary team exists, saving V5RC → 409 and `outside.teams[0].number` is that team; Review Focus 2: blended saved, panel POST with no division → `division === "Whole event"`; then saving VEX IQ standard → 409 listing that panel.
  - Review Focus 1: blended setup, panel in `"Whole event"`, ES + MS teams → that panel's judge `/api/state` lists both teams.
  - Panel POST `division:"High School"` under VEX IQ → stored as fallback (`"Whole event"` blended / `ES` standard); team PATCH assign ES team to MS panel → 200 in blended, 409 in standard; requests reassign across divisions → allowed in blended.
  - Review Focus 4: a team in only a whole-event sent release → division PATCH 200; DELETE team → 409 `"Recall <Label> from Marketing first."`; a team in a division-scoped sent release → division PATCH 409 (today's).
  - No setup: panel POST `division:"Blended"` stays `"Blended"`; `/api/state.eventSetup === null` and `divisions` unchanged.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; `useAppState.ts` initial state gains `eventSetup: null`.
- [ ] **Step 4:** New tests PASS; `npm test` all pass; `tsc` clean.
- [ ] **Step 5:** Commit `Event setup: JA route, state and setup divisions`.

### Task 4: Award routes on the scope helper

**Files:** Modify `src/app/api/awards/winners/route.ts`, `no-winner/route.ts`, `released/route.ts`, `src/lib/types.ts` (ReleasedView); test `tests/blendedAwards.runtime.test.ts`.

**Interfaces — Consumes:** Tasks 1–3. **Produces:**
```ts
export type ReleasedSection = { key: string; awardIds: string[] };
export type ReleasedView = { awards; divisions; programs; releases;
  /** program + format, or null with no setup saved. */ setup: Pick<EventSetup, "program" | "format"> | null;
  /** The desk's sections in order: scopeKeys(divisions, format) each with awardsUnder(...) ids. With no setup: one per division, every award. */ sections: ReleasedSection[] };
```
- Winners PUT: after the award lookup, `keyError(award, division, setup)` → 400 with it. Team check: skip it when `division === WHOLE_EVENT` and the setup is blended (any team in the event); else today's check and copy. `places` unchanged (Judges Award 2 for the whole event). Full-message `in ${division}` reads `in Whole event` — accepted.
- No-winner PUT and released PUT: `keyError` → 400 before anything else that reads the key. DELETEs unchanged.
- Released GET: `setup`, `sections`; with setup saved `programs = programTabs(divisions, [], [])` (one "All" tab); no setup: `programs` exactly as today. Released POST walks `awardPairs(awards(), eventDivisions(panels, teams, setup), setup?.format)`.
- `decisionFor`, `nextSend`, `refuseIfSent` need no change: they are keyed.

- [ ] **Step 1: Write failing tests** (`tests/blendedAwards.runtime.test.ts`, VEX IQ blended saved, ES teams `1A`,`2A`, MS teams `3B`,`4B`, all nominated as needed):
  - Two Excellence: winners PUT excellence ES→`1A` and excellence MS→`3B` both 200; `GET /api/awards` winners has two `excellence` rows.
  - Review Focus 3: winners PUT innovate with `division: ES` → 400 `/whole event/`; with `"Whole event"` and team `3B` → 200; then team `1A` replaces it (single place); excellence with `"Whole event"` → 400 `/each division/`.
  - Judges two places whole-event: `1A` and `3B` (different divisions) both 200; a third → 409 `"Judges already has its 2 winners in Whole event. Clear one first."`.
  - No-winner PUT think `"Whole event"` → 200; think `MS` → 400.
  - Send/recall/Changed on `"Whole event"`: PUT released innovate whole-event → 200 row `division:"Whole event"`; winners PUT then 409 `"Recall it from Marketing first."`; DELETE recalls; change winner; PUT again → `previous` set, `changed_at` non-null.
  - Send all ready: decide every pair; POST → `sent.length === 13`, no `skipped`; second POST → 13 `already sent`.
  - Desk reply shape: GET as marketing → `setup` `{program:"VEX IQ",format:"blended"}`, `sections.map(s=>s.key)` `[ES, MS, "Whole event"]`, `sections[0].awardIds` `["excellence","design"]`, `sections[2].awardIds.length === 9`, `programs` `[{label:"All", divisions:[ES,MS]}]`.
  - Standard (VEX IQ standard saved): innovate with `ES` → 200; with `"Whole event"` → 400; `sections` = 2 × 11 ids.
  - No setup: `setup === null`, `sections.length === eventDivisions` count, every `awardIds.length === 11`; winners PUT with division `"Whole event"` → today's 400 team-not-in-division copy.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** New tests PASS; `npm test` all pass (incl. `awardsReleased`, `awardsRoute`, `marketing` runtime tests unchanged); `tsc` clean.
- [ ] **Step 5:** Commit `Blended awards: winners, No winner and the desk on the scope helper`.

### Task 5: `awardsLogic` counts and keys

**Files:** Modify `src/components/admin/awardsLogic.ts`; test `tests/blendedAwardsLogic.test.mjs`.

**Interfaces — Consumes:** Task 1. **Produces** (every new parameter optional and trailing; omitted ⇒ today's result):
```ts
decidedCount(winners, awards, division, noWinners = [], format?: EventFormat | null): number   // counts awardsUnder(awards, division, format)
decidedText(winners, awards, division, noWinners = [], format?)                                 // "n/<awardsUnder length>"
nominationsIn(nominations, teams, division, panelId)   // division === WHOLE_EVENT → every team
conductIn(flags, teams, division, panelId)            // same
/** Every award a team holds, under any key. */
export function heldByTeam(winners: WinnerRow[]): Map<string, WinnerRow[]>;   // award id → rows across all keys
buildMatrix(..., noWinner, held: Map<string, WinnerRow[]> = decided)          // `has` reads `held`
buildAwardPanels(..., noWinner, held: Map<string, WinnerRow[]> = decided)
Everything.format?: EventFormat | null                                        // detailFor: key = awardKey(award, team.division, format); nominations/conduct read under that key; `has` from heldByTeam(winners) when blended, else today's
giveAfterAsking / clearAfterAsking pick gains  division?: string               // body division = pick.division ?? team.division
readyToSend(awards, divisions, winners, noWinners, releases, format?)         // walks awardPairs
notReadyLines(awards, division, winners, noWinners, releases, format?)        // over awardsUnder
```
- [ ] **Step 1: Write failing tests** (`tests/blendedAwardsLogic.test.mjs`, reuse `tests/adminAwards.fixtures.ts` builders where they fit):
  - `decidedText(winners, awards(), ES, [], "blended")` → `"1/2"` with only excellence ES decided; `decidedText(…, "Whole event", …, "blended")` → `"0/9"`; no format → `"1/11"`.
  - `nominationsIn(noms, teams, "Whole event")` returns nominations from ES and MS teams.
  - `detailFor({awardId:"innovate",teamId:esTeam}, {…, format:"blended"})`: `others` includes an MS nominee; `current` is the whole-event holder from MS; `has` lists ES Excellence held by the team.
  - `readyToSend(awards(), [ES,MS], winners, noWinners, [], "blended")` lists innovate once with `division:"Whole event"`.
  - `giveAfterAsking` with `division:"Whole event"` sends that division in the PUT body.
  - Without format every function above returns what it does today (one assertion each).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** New tests PASS; `npm test` all pass (esp. `adminAwards.logic`, `adminAwards.runtime` unchanged); `tsc` clean.
- [ ] **Step 5:** Commit `Blended awards: Awards tab logic counts and keys`.

### Task 6 (controller): verify and record

- [ ] `npm test`, `npx tsc --noEmit`, `npx eslint . --ignore-pattern '.claude/**'` — all clean.
- [ ] Data-copy smoke: copy `.data/` store to the scratchpad, `DATA_FILE=<copy>` script calling the route handlers (no dev server): save setup on the real roster shape, expect `outside` lists or 200; confirm `.data/` untouched (`git status`, mtime).
- [ ] `FIXES.md`: row + section "Event setup and blended awards (backend)".
- [ ] Shared-notes hand-over `blended-backend-api.md` with the final types/routes for the UI session (and the client logic files that still call `divisionsCompatible` without a format: `conflictsLogic.ts`, `teamsLogic.ts`, `floorLogic.ts`).
- [ ] Commit `Event setup + blended awards: record the fix`.

## Not in this plan (deliberate)
- Clearing a setup back to "none" (wipe does it); add a DELETE if the JA asks.
- Client-side `divisionsCompatible` callers: the UI session passes `state.eventSetup?.format`.
- Neon run: needs the hotspot; owed before release.
