# Event setup + blended awards — UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Judge Advisor's Event page, the JA Awards tab in a blended event, and the Awards Desk with a saved setup, on top of the built backend.

**Architecture:** Every change is gated on `state.eventSetup` (desk: `view.setup`); null/absent renders today's markup unchanged. Pure helpers go in `*Logic.ts` files (node-testable), components render them; the blended Awards board is its own component so the Standard board is not touched.

**Tech Stack:** Next.js App Router, React 19, TypeScript, plain CSS in `src/app/globals.css`, `node:test` via `tsx` (`renderToStaticMarkup` for markup tests).

**Spec:** `design/event-setup/PROMPT.md` (build spec — wins over mocks), boards `design/event-setup/reference-*.dc.html`, behaviour `docs/superpowers/specs/2026-11-20-event-setup-blended-awards-design.md`. Backend API: `src/lib/eventSetup.ts`, `PUT /api/event-setup`, `ReleasedView.setup/.sections`, `awardsLogic.ts` `format`/`heldByTeam` params (already landed, `8e68694`).

## Global Constraints

- No setup saved = today, pixel for pixel. Existing runtime/markup tests stay unchanged and green.
- Don't change backend routes or rules. One additive exception the build spec asks for: `ReleaseTeam.division?: string` (Task 3).
- No playful motion (colour/background `transition` only). Colour is signal: `--done` green = sent/fine; caution = blockers, "Marketing had …", "Already has …", "Changed — was …"; danger = refused writes (`Banner kind="error"`); muted = not set / not ready; accent blue = interactive chrome only. Every state has words or an icon.
- Touch targets ≥44px phone, ≥32px desktop. Tints via `color-mix(in srgb, …)`.
- JA CSS inside `/* @ja-block event */` (new) and `/* @ja-block awards */`; desk CSS under `.mk-*`. `tests/adminCssScope.test.mjs` must pass.
- Division tags reuse `divisionTag()` from `src/components/admin/floorLogic.ts` (neutral, never a colour per division).
- Destructive actions use `useConfirm()`. One write at a time (the `write()` guard pattern in `AwardsTab.tsx`).
- Each task ends with `npm test`, `npx tsc --noEmit`, `npx eslint src tests --ignore-pattern '.claude/**'` green and one local commit. `npm run build` is run by the reviewer (not while `next dev` runs). Never push.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never stage `Pixel-Art-Role-Avatars-HD/`.

## Review Focus

1. A program config no longer lists the saved program (`setupDivisions` → null): Event page and tab must fall back to `state.divisions`, not crash. → Task 1 test `eventLogic falls back when the saved program is gone`.
2. Event page while `/api/awards` hasn't answered yet: the Awards row must read "Checking…" (muted) and Save stay disabled, never "none decided". → Task 1 test.
3. Blended tab with a team whose division is not a setup division (left over): it still appears under whole-event awards; per-division halves just don't list it. → Task 2 test.
4. Desk release written before this build (no `division` on `ReleaseTeam`): no tag, no "undefined". → Task 3 test.
5. Recalled whole-event award shows "Recalled · Send again" in its block, and "Mark no winner"/"Clear" are disabled only while `sent`. → Task 2 test.

---

### Task 1: JA Event page, rail item, top-bar event title

**Files:**
- Create: `src/components/admin/eventLogic.ts`, `src/components/admin/EventTab.tsx`, `tests/adminEvent.logic.test.mjs`, `tests/adminEvent.runtime.test.tsx`
- Modify: `src/components/admin/AdminFrame.tsx` (`AdminTab` + `"event"`, Setup group = Event, Teams, Panels, Conflicts, Import; Event icon = the mock's calendar stroke icon; new optional prop `setup?: Pick<EventSetup,"program"|"format"> | null` for the wide top-bar title and the phone section-bar muted label on the Event tab only), `src/app/admin/page.tsx` (render `EventTab`, add `"event"` to the `ja-pad` list, pass `setup`), `src/app/globals.css` (new `/* @ja-block event */`, top-bar title styles in `/* @ja-block shell */`)

**Interfaces — Produces (`eventLogic.ts`):**
- `type Tile = { program: string; format: EventFormat; title: string; divisions: string[]; awardCount: number; line: string }`
- `tiles(programs: Program[], awards: Pick<AwardView,"label"|"blendedScope">[]): Tile[]` — programs × [standard, blended], config order. Standard line: `` `${11*n} awards · every award per division` `` (use real `awards.length`); Blended: `` `${d*n+w} awards · ${dLabels joined " and "} per division, ${w} for the whole event` ``.
- `previewGroups(divisions: string[], format: EventFormat, awards: Pick<AwardView,"label"|"places"|"blendedScope">[]): { key: string; labels: string[] }[]` — one per `scopeKeys`, labels via `awardsUnder`, `"Judges (2)"` when `places > 1`.
- `type Row = { id: "awards"|"teams"|"panels"; ok: boolean | null; text: string; items?: { id: string; main: string; tag?: string }[] }` (`ok: null` = still loading)
- `checklist(next: {program;format}, ctx: { awards: AwardsAdminView|null; released: ReleasedView|null; teams: Team[]; panels: PublicPanel[] }): Row[]` — copy exactly from PROMPT.md §1 "Before you can save". Panels tested against `divisionChoices(next, true).options`.
- `outsideRows(outside: { teams: {id;number;division}[]; panels: {id;name;division}[] }, teams: Team[]): Row[]` — rebuilds the Teams/Panels rows from a 409 reply (names from `teams` by id).
- `canSave(picked, saved, rows): boolean` — picked set, differs from saved, every row `ok === true`.
- `EventTab({ state, awards, released, refresh, onError, onOpenTab }: { state: AppState; awards: AwardsAdminView|null; released: ReleasedView|null; refresh: () => Promise<void> | void; onError: (m: string|null) => void; onOpenTab: (t: AdminTab) => void })`.

- [ ] **Step 1: Write failing logic tests** in `tests/adminEvent.logic.test.mjs` using `presetPrograms()` and `awards()` from config: `tiles` returns 4 tiles in order VEX IQ·Standard, VEX IQ·Blended, V5RC·Standard, V5RC·Blended with `awardCount` 22, 13, 22, 13; `previewGroups(["Elementary School","Middle School"], "blended", …)` → keys ES, MS, "Whole event" with 2, 2, 9 labels and "Judges (2)" in Whole event; standard → 11 labels each; `checklist` with one winner + one sent release → awards row `ok:false`, text contains "Clear the awards first." and "1 of 22 decided, 1 sent to Marketing"; a High School team under VEX IQ → teams row lists it; all fine → three `ok:true`; awards null → awards row `ok:null`; `canSave` false when picked equals saved, true only when changed and all ok; saved program missing from programs → `tiles` still 4 and checklist falls back without throwing.
- [ ] **Step 2: Run** `npx tsx --tsconfig tsconfig.test.json --test tests/adminEvent.logic.test.mjs` → FAIL (module missing).
- [ ] **Step 3: Implement `eventLogic.ts`.**
- [ ] **Step 4: Write markup tests** in `tests/adminEvent.runtime.test.tsx` (`renderToStaticMarkup`): no setup → notice "Not set up yet." with the preset divisions, no `aria-checked="true"` tile, Save `disabled`, hint "Pick a program and format to save."; saved VEX IQ·Blended → that tile has `aria-checked="true"` and "Saved", footer "Set by"; `role="radiogroup"` with 4 `role="radio"`; `SECTION_GROUPS` Setup ids are `["event","teams","panels","conflicts","import"]`; `AdminFrame` with `setup={null}` renders no `setupLabel` text, with a setup renders "VEX IQ · Blended". For the 409 path, export the pure `outsideRows` and assert the lists (the click is browser-checked).
- [ ] **Step 5: Implement `EventTab.tsx`** per PROMPT.md §1 and `reference-setup-*.dc.html`: radiogroup with arrow-key move, preview (chips wide / text lines phone), checklist with "Open Awards/Teams/Panels" calling `onOpenTab`, Save inside a one-at-a-time guard ("Saving…"), PUT `/api/event-setup` `{program, format}` via `call`; on 200 `await refresh()`; on error `onError(message)` and, when the error body has `outside`, replace the Teams/Panels rows with `outsideRows`. Check how `call` in `src/components/useAppState.ts` surfaces the JSON body of a 409; if it only throws the message, read `outside` with a plain `fetch` in this one place. Then the AdminFrame/page wiring and CSS.
- [ ] **Step 6: Run all checks** (`npm test`, `npx tsc --noEmit`, eslint) → green, existing counts + new.
- [ ] **Step 7: Commit** `git commit -m "Event page: JA event setup, rail item, top-bar title"`.

### Task 2: JA Awards tab in a blended event (C · Award order)

**Files:**
- Create: `src/components/admin/BlendedAwards.tsx` (the blended board), `tests/adminAwardsBlended.runtime.test.tsx`
- Modify: `src/components/admin/awardsLogic.ts` (only the new helpers below), `src/components/admin/AwardsTab.tsx` (branch to the blended board; export the pieces it reuses), `src/app/admin/page.tsx` (rail count), `src/app/globals.css` (`@ja-block awards`), `tests/blendedAwardsLogic.test.mjs` (new cases)

**Interfaces:**
- Consumes: `WHOLE_EVENT`, `awardKeys`, `awardsUnder`, `scopeKeys`, `setupLabel` (eventSetup.ts); `decidedCount/decidedText/readyToSend/notReadyLines(..., format)`, `heldByTeam`, `nominationsIn/conductIn` (WHOLE_EVENT = every team), `buildAwardPanels(..., held)`, `buildMatrix(..., held)`, `detailFor(sel, {..., format})`, `giveAfterAsking/clearAfterAsking({..., division: key})`, `sendState`, `releaseOf`, `recallQuestion(label, key)` (awardsLogic.ts).
- Produces (`awardsLogic.ts`): `eventDecided(winners, awards, divisions, noWinners, format): { decided: number; total: number }` summing `decidedCount` over `scopeKeys` (total = Σ `awardsUnder(...).length`, 13 for VEX IQ Blended); `eventDecidedText(...)` → `"12/13"`; `eventSentCount(releases, awards, divisions, format): number`; `type BlendedSel = Sel & { key: string }`.
- `AwardsTab` gains no new props: it reads `state.eventSetup` (add `"eventSetup"` to its `Slice`). When `state.eventSetup?.format === "blended"` it renders `<BlendedBoard …>` with the same `write()`, `ask`, send/recall handlers but every action takes the key explicitly (`onSend(awardId, key)`, `onRecall(awardId, key)`, `onMarkNoWinner(awardId, key)`, `onClearNoWinner(awardId, key)`, give/clear pass `division: key`). Send all ready passes `format` to `readyToSend`/`notReadyLines`; the dialog lines read "<Award> · <key> · …".

- [ ] **Step 1: Failing logic tests** in `tests/blendedAwardsLogic.test.mjs`: `eventDecidedText` → "12/13" for a fixture with 12 of 13 keys decided; `eventSentCount` counts sent rows across ES, MS and "Whole event".
- [ ] **Step 2: Implement** the helpers; run → PASS.
- [ ] **Step 3: Failing markup tests** in `tests/adminAwardsBlended.runtime.test.tsx` (fixture: VEX IQ Blended, ES + MS teams, a release map): Excellence block has two halves each with its own "Send to Marketing" (or "Pick a winner to send"); an Innovate block carries the "Whole event" label and lists nominees from both divisions with their tags; "Nominees from" chips All/ES/MS, and with MS picked an ES winner still shows but ES non-winner nominees don't; meta contains "VEX IQ · Blended", "12 of 13" decided and "sent to Marketing"; Matrix headers include "Excellence ES" and "Excellence MS" and the ES team's MS-Excellence cell is not a button; a team with Excellence · MS nominated for Energy shows "Already has Excellence · Middle School"; a recalled Innovate shows "Recalled" and an enabled "Mark no winner"; a sent one shows the lock and disabled "Mark no winner" with `title="Recall it from Marketing first."`; a team in a non-setup division appears under Innovate only. Read `AwardsTab.tsx` source and assert the PUT body uses the key (`{ awardId, division: key }`).
- [ ] **Step 4: Implement `BlendedAwards.tsx`** per PROMPT.md §2 and `reference-awards-*.dc.html`: config-order blocks; per-division award = one block, header + muted "Given once per division", halves side by side on wide (hairline) / stacked on phone, each half reusing the existing award-list body for that key (extract a single-award body out of `AwardLists` if needed, keeping `AwardLists`' markup byte-identical for Standard); whole-event blocks full width, keyed `WHOLE_EVENT`; build every block in full. Matrix: columns per key ("Excellence ES"/"Excellence MS"), other-division cells empty and not clickable. Side panel/sheet eyebrow "<Award> · <key>". "Nominees from" filters nominee rows only. Panel chips, Matrix | By award and "Send all ready (N)" as built. Phone order per PROMPT.md §2 "Phone".
- [ ] **Step 5: Rail count** in `page.tsx`: when blended use `eventDecidedText`; otherwise unchanged.
- [ ] **Step 6: Run all checks**; existing `adminAwards.runtime.test.tsx` unchanged and green.
- [ ] **Step 7: Commit** `git commit -m "Awards tab: blended event, award order with per-division halves"`.

### Task 3: Awards Desk with a saved setup (+ team division in snapshots)

**Files:**
- Modify: `src/lib/types.ts` (`ReleaseTeam` + `division?: string`), `src/lib/releases.ts` (`decisionFor` writes `division: t.division`), `src/components/marketing/marketingLogic.ts`, `src/components/marketing/AwardsDesk.tsx`, `src/app/globals.css` (`.mk-*`), `tests/marketingLogic.test.ts`, `tests/marketingPage.runtime.test.tsx` (new cases only)

**Interfaces — Produces (`marketingLogic.ts`):**
- `sectionsOf(view: ReleasedView): { key: string; awards: ReleasedAward[] }[]` — `view.sections` mapped to awards in config `order`.
- `sectionRows(view, section, isSeen): DeskRow[]` — like `deskRows` but only the section's awards, keyed by `section.key`.
- `sectionCount(view, section): string` → `countText(sent, section.awardIds.length)`.
- `eventLine(view): string` — Blended: `` `${labels joined " and "} for each division · every other award for the whole event` `` (labels = awards of `view.sections[0].awardIds`, in order); Standard: `"Every award for each division"`.
- `changesOf` walks `sections` keys when present (so a whole-event change appears, its line "<scope> · <Award>").

- [ ] **Step 1: Failing tests**: `decisionFor` snapshot teams carry `division`; `sectionsOf` on a blended view → keys ES, MS, "Whole event"; `sectionCount` → "1 of 2 sent" / "5 of 9 sent"; `eventLine` blended/standard copy; desk markup with `view.setup` → no `role="tablist"`, title "VEX IQ · Blended", sections in order, a Whole event row shows its team's tag "ES", a row with no `division` shows no tag, division-section rows show no tag; no `setup` → tablist as before (existing tests unchanged).
- [ ] **Step 2: Implement** the type, snapshot field, logic and desk per PROMPT.md §3 and `reference-desk-*.dc.html`: no tab bar, brand line `setupLabel`, event title (22px wide / 19px phone) + muted `eventLine`, Changed box unchanged above sections, sticky section headings on phone with "N of M sent" + bar, one-line rows truncating the name, never the number or tag; search groups results by section.
- [ ] **Step 3: Run all checks** (including `awardsReleased.runtime.test.ts`, `storeConformance`) → green.
- [ ] **Step 4: Commit** `git commit -m "Awards Desk: event title and sections with a saved setup"`.

### Task 4: Format-aware division pickers and compatibility

**Files:**
- Modify: `src/components/admin/conflictsLogic.ts:68`, `teamsLogic.ts:169,184`, `floorLogic.ts:122` (pass `format` through to `divisionsCompatible`; each function gains a trailing `format?: EventFormat | null` and its tab caller passes `state.eventSetup?.format`), `PanelsTab.tsx` (add-panel and edit pickers use `divisionChoices(state.eventSetup, true)`: options + default `fallback`, so a blended panel defaults to "Whole event"), `TeamsTab.tsx` (picker uses `divisionChoices(state.eventSetup, false).options`), `ImportTab.tsx` (default division shown = `divisionChoices(setup, false).fallback`)
- Test: `tests/adminTeams.logic.test.mjs`, `tests/adminPanels.runtime.test.tsx`, `tests/adminFloor.logic.test.mjs`, `tests/adminConflicts.logic.test.mjs` (new cases only)

- [ ] **Step 1: Failing tests**: with `format: "blended"` an ES team may move to an MS panel (floor options include it, teams-logic returns no clash, conflicts logic counts it); without format, behaviour unchanged; panels add form under a blended setup offers "Whole event" and pre-selects it.
- [ ] **Step 2: Implement**; run all checks → green.
- [ ] **Step 3: Commit** `git commit -m "Pickers: event format in division checks and choices"`.

### Task 5 (reviewer, Opus): browser check, build, FIXES

- [ ] Launch config in this worktree pointing `next dev` at a scratch COPY of `.data/` (never `.data/` itself); check at 1280 and 375, dark and light: Event page (unset, VEX IQ Standard, VEX IQ Blended, refused states), Awards tab Standard and Blended, Awards Desk Standard / Blended / unset.
- [ ] Stop the dev server; `npm run build` green.
- [ ] `FIXES.md` entry (newest first) with branch, shas, test counts; commit.
