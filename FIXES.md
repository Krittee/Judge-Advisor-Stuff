# Fixes

Every bug fix or small change made since Version 2.0 went live, newest first. Each entry gives the problem, the cause, what changed, how it was tested, the commit and the status.

| Date | Fix | Commit | iPhone checked | Status |
|---|---|---|---|---|
| 2026-11-22 | [Awards Desk showed Middle School under both VEX IQ and V5RC](#awards-desk-showed-middle-school-under-both-vex-iq-and-v5rc-2026-11-22) | `002c231` | Not needed (no layout change) | Live in 2.2.1 (PR #20, 2026-11-22); replaced in 2.2.2 by the IQ / V5RC Middle School split |
| 2026-11-21 | [Awards send time shows NaN:NaN, and audit cleanup](#awards-send-time-shows-nannan-and-audit-cleanup-2026-11-21) | `bb0ef0f`..`fcd4930` | Not needed (no layout change) | Live in 2.2.0 (PR #19, 2026-11-21) |
| 2026-11-20 | [Event setup and blended awards (UI)](#event-setup-and-blended-awards-ui-2026-11-20) | `e2e1ad6`..`89b0d7c` | Not yet (375 preview only) | Live in 2.2.0 (PR #19, 2026-11-21) |
| 2026-11-20 | [Event setup and blended awards (backend)](#event-setup-and-blended-awards-backend-2026-11-20) | `f22f50e`..`84d586a` | Not needed (no UI yet) | Live in 2.2.0 (PR #19, 2026-11-21) |
| 2026-11-20 | [Door page: Team \| Staff groups](#door-page-team--staff-groups-2026-11-20) | `7f0d2de` | Not yet (375px preview only) | Live in 2.2.0 (PR #19, 2026-11-21) |
| 2026-11-20 | [Referee: Major removed, DQ stands alone](#referee-major-removed-dq-stands-alone-2026-11-20) | `329fcc8` | Not yet (375 preview) | Live in 2.2.0 (PR #19, 2026-11-21) |
| 2026-11-20 | [Awards Desk UI (2.2.0)](#awards-desk-ui-220-2026-11-20) | `c02e7c3`..`2d83b19` | iPhone Simulator only | Live in 2.2.0 (PR #19, 2026-11-21) |
| 2026-11-19 | [Awards Desk backend (2.2.0)](#awards-desk-backend-220-2026-11-19) | `d5b1807`..`f9cc675` | Not needed (no UI yet) | Live in 2.2.0 (PR #19, 2026-11-21) |
| 2026-11-16 | [Team sheet: Good conduct shows as a warning](#team-sheet-good-conduct-shows-as-a-warning-2026-11-16) | `fa039dd` | Not yet | Live in 2.1.4 (PR #18, 2026-11-16) |
| 2026-11-16 | [Judge Advisor can fix or delete a judge's note](#judge-advisor-can-fix-or-delete-a-judges-note-2026-11-16) | `ef84422` | Not yet | Live in 2.1.4 (PR #18, 2026-11-16) |
| 2026-11-16 | [Judges Award can have two winners](#judges-award-can-have-two-winners-2026-11-16) | `c04c9b3` | Not needed | Live in 2.1.4 (PR #18, 2026-11-16) |
| 2026-11-16 | [Awards: mark an award "No winner"](#awards-mark-an-award-no-winner-2026-11-16) | `1d9aa15`..`c68fecd` | Not yet (phone-width preview only) | Live in 2.1.4 (PR #18, 2026-11-16) |
| 2026-11-13 | [Coordinator page scrolls past its tab bar](#coordinator-page-scrolls-past-its-tab-bar-2026-11-13) | `259cabb` | Simulator only | Live in 2.1.2 |
| 2026-11-13 | [Coordinator sign-in: COORDINATOR word clipped](#coordinator-sign-in-coordinator-word-clipped-2026-11-13) | `f4793fb` | Not needed | Live in 2.1.2 |
| 2026-11-08 | [New teams start Ungraded](#new-teams-start-ungraded-2026-11-08) | `3b9d670` | Not needed | Live in 2.1.1 |
| 2026-10-31 | [Blended division shows as BLN](#blended-division-shows-as-bln-2026-10-31) | `600a5e8` | Not needed | Live in 2.0.1 |
| 2026-10-31 | [Judging Board: colour key above Unassigned](#judging-board-colour-key-above-unassigned-2026-10-31) | `4a001a8` | Not needed | Live in 2.0.1 |
| 2026-10-31 | [Team page: a way back, and no details strip](#team-page-a-way-back-and-no-details-strip-2026-10-31) | `be78288` | Not yet | Live in 2.0.1 |
| 2026-10-31 | [Head referee can remove a flag](#head-referee-can-remove-a-flag-2026-10-31) | `ebbd0ab` | Not yet | Live in 2.0.1 |
| 2026-10-31 | [Referee: keyboard hides the team being typed](#referee-keyboard-hides-the-team-being-typed-2026-10-31) | `cf7d3a5` | Skipped | Live in 2.0.1 |
| 2026-10-31 | [Referee console scrolls the whole page on iPhone Safari](#referee-console-scrolls-the-whole-page-on-iphone-safari-2026-10-31) | `4415991` | Not yet | Live in 2.0.1 |
| 2026-10-31 | [Referee Today tab: show only today's flags](#referee-today-tab-show-only-todays-flags-2026-10-31) | `e465303` | Yes | Live in 2.0.1 |
| 2026-10-31 | [JA phone Sections sheet was empty](#ja-phone-sections-sheet-was-empty-2026-10-31) | `cfd7eb5` | Yes | Live in 2.0.1 |

---

## Awards Desk showed Middle School under both VEX IQ and V5RC (2026-11-22)

### Problem / request

With no event setup saved, one VEX IQ Middle School send showed under the V5RC tab too and counted in both tabs ("VEX IQ · 20 of 22 sent", "V5RC · 10 of 22 sent").

### Root cause

Awards are decided and sent per (award, division name), and "Middle School" is one name shared by VEX IQ and V5RC in `config/event.json`. With no setup saved the desk split the divisions into program tabs, so Middle School landed in both. One event runs one program, so the program cannot be told apart from the division name.

### Fix

- With no setup saved the desk is one list, each division once, with no VEX IQ / V5RC / Blended / Other tabs (`GET /api/awards/released` always returns one "All" tab). `programTabs` is removed.
- Saving the setup on the Event page behaves as before: it gives the program title and only that program's divisions.
- `programs` in `config/event.json` are now only the programs the Judge Advisor picks on the Event page; its comment says so.

### Testing

- New test: with no setup, a sent Middle School award shows in one "All" tab with Middle School once (failed before the fix: three tabs, Middle School under VEX IQ and V5RC). The existing no-setup desk test now expects one "All" tab; the two `programTabs` tests are removed.

### Commit / status

`002c231` on `claude/ms-overlap-bug-a9af88`. Not merged, not pushed.

---

## Awards send time shows NaN:NaN, and audit cleanup (2026-11-21)

### Problem / request

A ponytail audit of 2.2.x found one bug and 17 over-engineering cuts; the user approved all of them. The bug: a send time that does not parse showed "NaN:NaN" on the Awards Desk row and on the JA Awards tab ("Sent NaN:NaN", and in the recall dialog).

### Root cause

`hhmm` in `marketingLogic.ts` formatted any `Date` without checking it was valid. The Event page had its own copy with the check, so only that page was safe.

### Fix

- `hhmm` returns a blank for a time that does not parse; the Event page now uses the same `hhmm`.
- Cleanup, no other behaviour change: one shared route test harness and marketing fixtures; source-text and copied-CSS tests dropped; one `storeGet`/`storeSet` pair for Seen and the remembered tab; one `sentUnder` counter for the four "N sent" counts; `sendAllLines` uses `sameDecision`/`snapshotLine`; `Change.wasNumbers`, `tabLabel`, `pickText`, `ReleasedAward.order`, `ReleasedProgram` and `ReleaseStatus` removed; one parse for the send/recall route; `event_setup` in the one reset truncate.
- A send now always records each team's division on the snapshot (it used to only with a saved event setup). Nothing on screen changes: the desk shows the tag only on Whole event rows with a setup.
- Net 188 lines fewer (src 50, tests 138).

### Testing

- New test: `hhmm("not a time")` is blank (failed with "NaN:NaN" before the fix).
- `npm test`: 2000 tests before, 1994 after (1993 pass, 1 skipped). Seven source-text/CSS-value tests removed, one added; no behaviour test lost. `tsc` and eslint clean; `npm run build` passes.
- Browser, built app on a copy of the data: JA Awards tab shows "Sent HH:MM", "Pick a winner to send", "1 sent to Marketing"; `/marketing` shows the counts in config order, no division tag without a setup, and the chosen tab survives a reload.

### Commit / status

`bb0ef0f`, `66dc5d3`, `fcd4930` on `claude/audit-cuts-22-13220b`. Not merged, not pushed.

---

## Event setup and blended awards (UI) (2026-11-20)

### Problem / request

The screens for the event setup the backend added: the Judge Advisor's Event page, the JA Awards tab in a blended event, and the Awards Desk with a saved setup. The user picked Event page C "Four tiles + preview", Awards tab C "Award order", and the desk as mocked (`design/event-setup/PROMPT.md`).

### Root cause

Not a bug: new screens on top of the backend (`claude/blended-backend-c6182b`, merged into this branch).

### What changed

Plan `docs/superpowers/plans/2026-11-20-event-setup-blended-ui.md`. Everything is gated on a saved setup; with none, every screen is as before (the only visible change is the new Event rail item).

- **Event page** (`EventTab.tsx`, `eventLogic.ts`, `AdminFrame.tsx`):
  - "Event" comes first in the Setup rail group.
  - Four tiles (VEX IQ / V5RC × Standard / Blended) form a radio group with arrow keys.
  - The preview shows how awards group per division / "Whole event".
  - The "Before you can save" checklist covers Awards, Teams and Panels, with "Open …" links.
  - A refused save shows the server message, with its `outside` lists.
  - The top bar shows "Judge Queue · VEX IQ · Blended" once a setup is saved.
- **Awards tab, blended** (`BlendedAwards.tsx`, `AwardsTab.tsx`, `awardsLogic.ts`):
  - Blocks follow the award order. Excellence and Design are split into a half per division, each with its own Send / Recall / lock / No winner.
  - Every other award is one "Whole event" block.
  - "Nominees from" (All / ES / MS) filters nominee rows only.
  - The Matrix has a column per key.
  - The side panel reads "<Award> · <scope>".
  - Send all ready lines read "<Award> · <scope> · …".
  - The rail and meta count event-wide ("3/13").
- **Awards Desk** (`AwardsDesk.tsx`, `marketingLogic.ts`): with a setup there are no tabs. The page shows the event title and line, then sections (divisions, then "Whole event") with "N of M sent". Whole-event rows tag each team ES / MS, and the Changed box reads "<scope> · <Award>".
- **Snapshot:** `ReleaseTeam.division?`, written only when a setup is saved (`decisionFor(..., withDivision)`). With no setup the stored snapshot is exactly as in 2.2.0.
- **Pickers:** the Floor, Teams and Conflicts checks pass the event format (blended: any panel takes any team). The Panels pickers offer "Whole event" in a blended event, and a new panel defaults to it.
- **Existing test edits** (all source-text or count pins of what the spec changes):
  - `adminPage.runtime` rail goes from 9 to 10 sections (approved by the user).
  - Four pinned call strings in `adminTeams.runtime` (now passing `format`).
  - One count line in `adminEvent.logic` (this branch's own test).

### How it was tested

- `npm test`: 2000 tests, 1999 pass, 0 fail, 1 skipped (real-Postgres suite). `npx tsc --noEmit`, `npx eslint src tests --ignore-pattern '.claude/**'` and `npm run build` are clean.
- Browser preview on scratch copies of `.data/state.json` (never `.data/`), at 1280 and 375, dark and light:
  - Event page: not set, VEX IQ Standard saved, VEX IQ Blended saved, refused by a High School panel, refused by awards, and a server 409.
  - Awards tab: Standard, and Blended (halves, Whole event blocks, filter, Matrix, side panel, Send all, Recalled, locks).
  - Awards Desk: unset (tabs), Standard, and Blended (tags, Changed, search).
  - Panels pickers in Blended.
- Each task was reviewed by an Opus reviewer, followed by a whole-branch review. Its one Important finding ("15 of 13" with no setup) is fixed in `89b0d7c`.

### Branch / commits

`claude/blended-ui-d3aac8`:
- `837ef42`: merge of the backend.
- `031dba9`: design.
- `64631b3`: plan.
- `e2e1ad6` + `b3b71d9`: Event page.
- `7ec7008` + `6e41b00`: Awards tab.
- `1c23044`: desk.
- `bbd4e8d`: pickers.
- `89b0d7c`: final review fixes.
- Plus this entry.

### Status

Built and committed locally. Not pushed, not merged into main.

### Follow-ups

- Real Postgres run on Neon (new `event_setup` table, `division` inside the `teams` jsonb).
- Optional tidying: split the shared award pieces out of `AwardsTab.tsx` (`AwardsTab` ↔ `BlendedAwards` import each other; this is safe at runtime).
- Check on an iPhone.

---

## Event setup and blended awards (backend) (2026-11-20)

### Problem / request

A blended event (e.g. IQ Blended: Elementary and Middle School together) gives Excellence and Design once per division and every other award once for the whole event. Every award decision was keyed by (award, division), so a blended event could only have one Excellence. The user's idea: the Judge Advisor sets the event up first (program, format), with the divisions inside it. This entry is the server side only; the screens come in a UI session.

### Root cause

Not a bug: "Blended" was just another division name, and nothing knew which awards span the whole event.

### What changed

Spec `docs/superpowers/specs/2026-11-20-event-setup-blended-awards-design.md`, plan `docs/superpowers/plans/2026-11-20-event-setup-blended-backend.md`.

- Event setup: one `event_setup` row (program from `config/event.json` `programs`, format standard/blended) in both stores, RLS on, cleared by Wipe everything, kept by Reset the day. `PUT /api/event-setup`, JA only, refused with "Clear the awards first." while any award is decided or sent, and with a list while a team or panel sits outside the program's divisions. Saving drops recalled releases. Read through `/api/state` (`eventSetup`).
- Award scope: `"blendedScope": "division"` on Excellence and Design in `config/event.json`; every other award is decided under the key "Whole event" in a blended event. One helper (`src/lib/eventSetup.ts`) decides the keys for the winners and No winner routes, Send all ready, the Awards Desk reply (`setup`, `sections`) and the Awards tab logic counts.
- A whole-event winner may be any team in the event; the Judges Award keeps two places for the whole event. Send / Recall / Changed / lock unchanged; a team holding only whole-event sent awards may change division.
- A saved setup's divisions are the event's divisions: `/api/state`, panel creation, team edits and CSV import (a new team with no division gets the program's first). In a blended event any panel may judge any team, and a new panel defaults to "Whole event".
- No setup saved: everything behaves and replies exactly as 2.2.0 (judges' award list and the desk reply keep their old keys).

### How it was tested

- `npm test`: 1923 tests, 1922 pass, 0 fail, 1 skipped (real-Postgres suite). `tsc` and eslint (`--ignore-pattern '.claude/**'`) clean. No existing test edited.
- New tests: `tests/eventSetup.lib.test.mjs`, `tests/eventSetupStore.runtime.test.ts`, `tests/eventSetupRoute.runtime.test.ts`, `tests/blendedAwards.runtime.test.ts`, `tests/blendedAwardsLogic.test.mjs`; additions to `tests/postgres-sql.test.mjs` and `tests/storeConformance.runtime.ts`.
- On a scratch copy of `.data/state.json` (original checksum unchanged), through the real route handlers: VEX IQ refused by one High School panel, V5RC by 16 teams and 2 panels; after moving the panel, VEX IQ · Blended saved, divisions became ES + MS, the desk showed ES 2 · MS 2 · Whole event 9, a judge saw all 24 teams, Send all ready walked 13 awards.

### Branch / commits

`claude/blended-backend-c6182b`: `73b2b82` (plan), `f22f50e` (helper, config), `f201c81` (stores), `ccca2af` (route, state, divisions, lock), `5561d79` + `3635b6f` (award routes), `8e68694` (Awards tab logic), `84d586a` (store conformance cases), plus this entry.

### Status

Built and committed locally. Not pushed. Waiting on the UI session.

### Follow-ups

- Real Postgres run on Neon (new table; needs the hotspot) before release.
- UI: Setup screen, Awards tab "Whole event" section, desk title and sections; pass the format to the client `divisionsCompatible` callers (`conflictsLogic.ts`, `teamsLogic.ts`, `floorLogic.ts`).
- The setup save is check-then-write (a `ponytail:` note in the route), like the award lock.
- No way to clear a setup back to "none" except Wipe everything.

---

## Door page: Team | Staff groups (2026-11-20)

### Problem / request

The user: "since we have 7 pages including team page and staffs page can it be separate like -> Team | Staffs to make it more symmetrical". The door page "/" showed seven doors in one list (Team, then six staff roles), laid out 4 + 3 on wide screens, which looked lopsided.

### Root cause

Not a bug: the 2.2.0 Marketing door made it seven, and the 8-half-column 4 + 3 grid was the old layout for an odd count.

### Decision

The user picked "Side by side" for wide screens and "Two wide" for phones from two sketches each.

### What changed

- `src/components/door/DoorPage.tsx`: the doors are split into two `<section>`s, each with an `<h2>` label (Team, Staff) and its own list labelled by it. Card markup, the Team caption, the Live board and the colour key are unchanged, and so is the link order.
- `src/app/globals.css` (door block):
  - New `.dp-split`, `.dp-gt` (quiet uppercase label in `--ink-subtle`, not accent), `.dp-grp--*` and `.dp-doors--*`.
  - Phone (< 1024px): the Team row as before, then the staff doors two across as avatar over name. The hint and chevron are clipped visually but kept for screen readers.
  - Wide (≥ 1024px): Team | 1px divider | Staff 3 × 2. The Team card fills both rows and is exactly one staff card wide (`calc((100% - 81px) / 4)`). The old 4 + 3 rules are gone.
- `tests/doorPage.runtime.test.tsx`: new test for the two labelled groups and which doors each holds.
- `tests/doorPage.css.test.mjs`: the 4 + 3 layout test is replaced by tests for the split, the two-wide phone grid, the clipped hint and the label colour.

### How it was tested

- `npm test`: 1875 tests, 1874 pass, 0 fail, 1 skipped (the same skip as before). `npx tsc --noEmit`: clean. `npx eslint src tests --ignore-pattern '.claude/**'`: clean. `npm run build`: clean.
- Browser preview on a copy of `.data/state.json` in the session scratchpad (never `.data/`):
  - 1280px, dark and light: all seven cards measure 259.8px wide, the staff cards are 224px tall, and the Team card is 464px (both rows).
  - 375px, light and dark: the Team card is 343 × 72, and the staff cards are 168 × 98. No name is clipped, there is no horizontal scroll, and the hints are still in the accessibility tree.
  - No console errors.

### Commit

`7f0d2de` on `claude/door-team-staff-258f85`. Not pushed.

---

## Referee: Major removed, DQ stands alone (2026-11-20)

### Problem / request

User: "on Referee page DQ and Major Violation is the same". In VEX a Major violation is a disqualification, so the user asked to remove Major and keep DQ, with Minor taking its place.

### Root cause

Two flag kinds for one ruling: `config/event.json` `refereeFlags` (and the `FLAG_FALLBACK` copy in `src/lib/presets.ts`) listed both "Major violation" and "Disqualified". On top of that the DQ chip was a faint grey ink tint (`bg-ink/12`), so it read as no worse than the red Major one.

### What changed

- `config/event.json`, `src/lib/presets.ts`: the `major` kind is gone. Kinds left: Good conduct, Warning, Minor violation, Disqualified (DQ keeps severity 4).
- `src/lib/presets.ts`: new `LEGACY_FLAG_KINDS` (`major` and `major violation` read as `dq`) and `canonicalFlagKind(id)`. `resolveFlagKind` goes through it first, so a stale phone posting "major" records a DQ, never Good conduct.
- `src/lib/db/file.ts`, `src/lib/db/postgres.ts`: `listFlags` reads stored `major` flags as `dq`. That one funnel feeds AppState `flags`, `/api/flags`, the PATCH and DELETE routes, and the awards route. Stored rows are not rewritten and `match_affecting` is kept.
- `src/components/Flags.tsx`: `kindOf` and `kindCounts` resolve through the alias, so old "major" activity-log lines (`activityLogic.ts` uses `kindOf`) show the DQ pill instead of nothing.
- `src/components/referee/SeverityButtons.tsx`, `src/app/globals.css`: Good conduct and Warning share the top row; Minor and DQ each take a full row (`rf-sv--wide` on kinds with `requiresRule`), still the 56px buttons. The Judge Advisor's compact row (`.ja-sv`) now sizes its four buttons evenly (`flex: 1 1 0`).
- `src/app/referee/page.tsx`: the repeat-violation ring now goes on DQ, the most severe kind. It is only a ring and never selects it.
- `src/lib/flagValidation.ts`: `MATCH_AFFECTING_KINDS` is `["minor"]`. The switch says "Minor only" on the referee page and in `RefereeTab.tsx`. Comments updated in `refereeLogic.ts`, `types.ts`, `referee/logic.ts`; `docs/onboarding/referee.md` updated.
- `src/lib/tone.ts`: the DQ pill (`black`) is now solid, `bg-ink text-canvas ring-ink`. It is the one deliberate solid chip, because DQ is the gravest flag.

### How it was tested

- New `tests/flagDqStandsAlone.test.ts` (no Major kind, stale "major" resolves to DQ not Good, DQ tone differs from rose and is solid) and a store conformance case "a flag stored as the retired Major kind is read back as DQ" in `tests/storeConformance.runtime.ts` (runs on the file store, and on Postgres when configured). Both failed before the change.
- Existing tests that used "major" were moved to "minor" or "dq"; the ones that assert legacy handling (old log lines, stale POSTs) now expect DQ.
- `npm test` 1875 pass, 0 fail, 1 skipped (Postgres-only); `npx tsc --noEmit`, `npx eslint . --ignore-pattern '.claude/**'` clean; `npm run build` passes.
- Browser at 375 wide, dark and light, on a copy of the data: the four buttons sit as asked, all 56px tall; a Major recorded before the change shows as DQ (team chip "DQ ×2"); the DQ chip is solid (white on dark, black on light). No console or server errors on a fresh server. Not checked on an iPhone.

### Commit and branch

- Branch `claude/referee-dq-major-92956f`, commit `329fcc8`.

### Status

Built on `claude/referee-dq-major-92956f`, not pushed. Not checked on an iPhone.

---

## Awards Desk UI (2.2.0) (2026-11-20)

### Problem / request

The pages for the Awards Desk backend above: Marketing's read-only Awards Desk, the Judge Advisor's controls to send and recall awards, and a door for Marketing on "/".

### Root cause

Not a bug: new feature (Version 2.2.0).

### What changed

Build spec `design/awards-desk/PROMPT.md` (boards `design/awards-desk/reference-*.dc.html`), plan `docs/superpowers/plans/2026-11-19-awards-desk-ui.md`.

- `/marketing/login` and `/marketing`. Marketing lands on its own desk. The desk shows one section per division ("N of M sent") with one line per award: the team(s), "No winner", "Being updated" (recalled, never a team) or "Not sent yet". It checks every 15 s while the tab is visible and keeps the last good answer when a check fails. A "Changed since sent" box sits above the divisions and each changed row is tagged "Changed — was …"; Seen hides it and is kept only in that browser. Search covers team number, name and award, and never the old team. Logic is in `src/components/marketing/marketingLogic.ts`.
- JA Awards tab, By award: each award's header shows Send to Marketing (when decided), Sent HH:MM · Recall with a lock, Recalled · Send again with "Marketing had …", or "Pick a winner to send". A sent award's Mark no winner / Clear and the side panel's Clear winner / Give are disabled ("Recall it from Marketing first."). The matrix shows the lock on sent columns. Recall and Send all ready (N, event-wide) ask first through `useConfirm`. Send all refusals show in the danger banner. `ConfirmOptions` gained `body?: ReactNode`, and `Banner` keeps line breaks.
- Recalled shows no time: the server records only the send time, and the recall is in Activity.
- Door page: seventh door "Marketing" after Judge Advisor. The wide layout is 4 + 3, centred.
- Marketing avatar: the user's art, cropped inside its frame to 320 × 320 (`public/avatars/marketing.jpg`), on the sign-in pass, the door (desk teal ring, like the Coordinator) and the desk's top bar.
- Program tabs (user request, 2026-11-20): the desk has VEX IQ (Elementary + Middle School), V5RC (Middle + High School) and Blended tabs at every size; Middle School shows in both programs. Set in `config/event.json` `programs`; Blended is the event's blended divisions, and a division in neither lands in an Other tab. GET `/api/awards/released` gained `programs` (additive). Each tab shows "N of M sent"; the tab is remembered on the device (`mk-tab`). Changed since sent stays above the tabs for every division; a search looks across all tabs and lists each division once. Commits `319b1c7`, `2d83b19`.

### How it was tested

- `npm test`: 1860 tests, 1859 pass, 1 skipped (the real-Postgres suite). `tsc`, eslint (`--ignore-pattern '.claude/**'`) and `npm run build` clean.
- New and changed tests: `tests/marketingLogic.test.ts`, `tests/marketingPage.runtime.test.tsx`, plus additions to `tests/adminAwards.logic.test.mjs`, `tests/adminAwards.runtime.test.tsx`, `tests/confirmDialog.test.tsx`, `tests/doorPage.runtime.test.tsx`, `tests/doorPage.css.test.mjs` and `tests/mobile.test.mjs`.
- Browser (file store, a scratch copy of `.data/state.json`), at 1280 dark and 375 light:
  - Marketing signed in with `MKTG01`. The desk showed sent, recalled, No winner, two-team Judges, not-sent and changed rows. Search hid the recalled and old teams. Seen survived a reload. The division heading stuck on the phone.
  - JA: Send, Recall (dialog then DELETE), Send all ready (dialog then POST, count to 0 and disabled), and the lock on Mark no winner / Clear and in the side panel / phone sheet. Buttons are 44px on the phone.
  - Door at both widths.

### Branch / commits

`claude/awards-desk-ui-e125c3` (on top of the backend branch): `34edfd7` (spec), `fe4f21a` (plan), `c02e7c3` (desk), `4a574e6` + `f32e3bf` (JA tab), `8a123da` + `6925842` (door), the Marketing avatar (this commit), plus this entry.

### Status

Built and committed locally. Not pushed. Not checked on a real iPhone.

### Follow-ups

- If the JA wants the recall time, the backend needs a `recalled_at` field.

---

## Awards Desk backend (2.2.0) (2026-11-19)

### Problem / request

At the last event marketing waited for the Judge Advisor to finish every award and send one late list, which delayed the ceremony backdrop. 2.2.0 adds a read-only Marketing role whose Awards Desk shows only the awards the JA has sent. This entry covers the server side only; the pages come in a separate UI session.

### Root cause

Not a bug: there was no way to hand a finished award to marketing without also exposing every undecided pick.

### What changed

Spec `docs/superpowers/specs/2026-11-19-awards-desk-design.md`, plan `docs/superpowers/plans/2026-11-19-awards-desk-backend.md`.

- Role: `marketing`, signed in with `MARKETING_CODE` (dev default `MKTG01`, refused in production like every published code; listed in `scripts/doctor.mjs` and `.env.example`). Name optional. Every `can*` helper and every existing route refuses it. `/api/state` now nulls staff names for marketing, as it does for the public.
- Storage (both stores): `award_releases`, one row per award per division, with a snapshot of the teams sent (id, number, name), `no_winner`, `previous`, `status` sent/recalled, `sent_at`, `sent_by`, `changed_at`. Postgres: `create table if not exists`, RLS on; both resets name it. Old state files load with `awardReleases` = `[]`.
- API: `/api/awards/released` — GET for marketing and the JA (`no-store`; a recalled row is emptied for marketing), PUT sends one award (409 unless every place is filled or No winner), POST sends every ready award not already sent, DELETE recalls. Sends and recalls go to Activity (`award`). Send rules in `src/lib/releases.ts`.
- Lock: while sent, winners and No winner PUT/DELETE answer 409 "Recall it from Marketing first."; deleting a team in a sent award, or moving it to another division (edit or paste), answers 409 "Recall <award> from Marketing first."
- Reset the day and Wipe everything both clear the sends.
- One placeholder outside the server: `src/components/SignInForm.tsx` has a `marketing` entry (coordinator avatar) so the role map compiles; the UI session must route marketing to the Awards Desk and give it its own avatar.

### How it was tested

- `npm test` with `DATA_FILE` on a scratch copy of `.data/state.json`: 1801 tests, 1800 pass, 1 skipped (real-Postgres suite, run separately below). `tsc` and eslint (`--ignore-pattern '.claude/**'`) clean.
- Real Postgres on the Neon test project: `tests/storePostgres.runtime.test.ts` 66/66 pass, release conformance included.
- New tests: `tests/marketing.runtime.test.ts`, `tests/releases.test.ts`, `tests/releasesMigration.runtime.test.ts`, `tests/awardsReleased.runtime.test.ts`; additions to `tests/storeConformance.runtime.ts` and `tests/postgres-sql.test.mjs`.

### Branch / commits

`claude/awards-desk-backend-921f59`: `d5b1807` (role), `305852a` (store), `ac72726` (routes), `f9cc675` (lock), plus this entry.

### Status

Built and committed locally. Not pushed. Waiting on the UI session.

### Follow-ups

- UI: `/marketing` and `/marketing/login`, the JA's Send / Recall / Send all ready controls, and the sign-in routing for marketing.
- The lock is check-then-write (a `ponytail:` note in `src/app/api/awards/shared.ts`); a send landing in between could slip one change through.

---

## Team sheet: Good conduct shows as a warning (2026-11-16)

### Problem / request

Reported on Version 2.1.3. A referee filed a Good conduct flag on 1852A. The Judge Advisor's Teams list showed it as a green "Good ×1" chip, which is right. But the team sheet (the panel with Notes · Notebook · Interview, "Private to judges and the Judge Advisor.") showed the same flag in an amber warning box with a ⚠ icon: "Good conduct · P5 — reported by Pim". Judges and the JA could read a compliment as a problem.

### Root cause

`TeamSheet.tsx` drew every flag as `<div class="jg-caution">` with `WarnIcon`, whatever its kind. The chip elsewhere takes its colour from the flag kind's `color` in `config/event.json` (`refereeFlags`) through `tone()` in `src/lib/tone.ts`, so the two disagreed. The team sheet is the only place that draws the flag detail box. Judges and the JA (Scores, Floor notes, Teams drawer, Activity) all open the same `TeamSheet`, so one fix covers all of them.

### Decision

The user chose "each its own colour". Every flag box wears its kind's colour, from the same `tone(kind.color)` the chip uses: Good is green with a ✓, Warning amber, Minor orange, Major red, DQ ink, and those four keep the ⚠. A team with several flags shows one box per flag, worst first (highest severity, then newest), so a mixed team shows its violations above its Good conduct.

### What changed

- `src/components/judge/TeamSheet.tsx`: each flag box is `jg-flag ring-1 ring-inset` plus `tone(kind?.color)`. The icon is `CheckIcon` for `GOOD_CONDUCT` (from `src/lib/awards.ts`) and `WarnIcon` otherwise. Boxes are listed with `flagsWorstFirst`.
- `src/components/judge/logic.ts`: new `flagsWorstFirst(flags, kinds)` holds the sort that was inside `leadFlag`. `leadFlag` now returns its first item, so the rule exists once.
- `src/app/globals.css`: new `.jg-flag` (the `.jg-caution` layout without its own colours; the tone classes supply fill, ink and ring). `.jg-caution` is unchanged for its other uses.
- `tests/judgePage.logic.test.mjs`: new test for `flagsWorstFirst`: mixed order, unknown kind last, input not mutated, `leadFlag` agrees, empty list.
- `tests/adminScores.runtime.test.tsx`: the team sheet snapshot now expects the new box class for its Warning flag. The icon and everything else are unchanged.

### How it was tested

- `npm test`: 1741 tests, 1740 pass, 0 fail, 1 skipped (the same skip as before). `npx tsc --noEmit`: clean. `npx eslint . --ignore-pattern '.claude/**'`: clean.
- Browser preview on a copy of `.data/state.json` in the session scratchpad (never `.data/`), signed in as the Judge Advisor, opening team sheets from the Teams drawer. A Good conduct flag was added to 1115 on the copy so one team had only Good conduct.
  - Before: 1115 showed the amber ⚠ box (dark desktop and light phone).
  - After: 1115 (Good only) is green with ✓ at light phone width. 1108 (Warning ×2 and Good) shows two amber Warnings, then a green Good, in light desktop and dark phone. 1101 (DQ, Minor, Warning) shows DQ in ink, Minor orange and Warning amber, in that order, in dark desktop. No console errors.
- Not checked on a real iPhone or the simulator. Not yet confirmed by the user.

### Commit and branch

- Change: `claude/conduct-green-695821`, commit `fa039dd` (this entry is in the same commit).

### Status

Live in 2.1.4 (PR #18, merged `ff04220`, 2026-11-16). Not checked on an iPhone.

### Follow-ups

- Check on a real iPhone once merged and deployed (needs approval).
- The snapshot test's comment still says "TeamSheet.tsx changed in comments only", which was already stale. Worth a one-line tidy next time that test is touched.
## Judge Advisor can fix or delete a judge's note (2026-11-16)

### Problem / request

Reported on Version 2.1.3. Judges cannot delete or change a note once it is saved, which is intended, but sometimes a note is added by mistake (wrong team, wrong text) and nobody could fix it. Request: keep judges unable to change notes, and let the Judge Advisor correct or delete any judge's note.

Decisions made with the user before building:
- An edited note keeps its author and time, and shows "edited by <JA> · <time>" to everyone, judges included.
- The old text is kept in the Activity log, which only the Judge Advisor can read.
- Delete asks first, and can be undone.

### Root cause

Not a bug: notes were append-only by design. `/api/notes` had only GET and POST, and neither store had a way to update or remove a note.

### What changed

- `src/app/api/notes/route.ts`:
  - New `PATCH` (`{ id, body }` edits, `{ id, restore: true }` undoes a delete) and `DELETE ?id=` (soft delete).
  - Only the Judge Advisor role passes (`canAdminister`). Judges and signed-out callers get 403 "Only the Judge Advisor can change or delete a note." An unknown note gets 404, and empty text gets 400.
  - Each change writes an Activity line naming the JA and the note's author: "edited a note by X" (detail "Was: <old text>"), "deleted a note by X" and "restored a note by X" (detail: the text). GET and POST are unchanged.
- `src/lib/types.ts`: `Note` gets optional `edited_at`, `edited_by`, `deleted_at`.
- `src/lib/db/types.ts`, `src/lib/db/file.ts` and `src/lib/db/postgres.ts`:
  - New `getNote`, `updateNote`, `deleteNote` and `restoreNote`.
  - `listNotes` skips deleted notes, so judges, the Scores note counts and everything else stop seeing a note once it is deleted.
  - Postgres gets three `alter table notes add column if not exists` lines (nullable, no default) in the store's own migration, so it is additive and existing notes are untouched. Old file-store rows work without the new fields.
- `src/components/useTeamRecord.ts`: `editNote`, `deleteNote` and `restoreNote`, plus the list of notes deleted while the sheet is open.
- `src/components/judge/TeamSheet.tsx`:
  - New `canFixNotes` prop (set only by `src/app/admin/page.tsx`). Each note gets Edit and Delete.
  - Edit swaps in a focused text box with Save and Cancel.
  - Delete asks "Delete this note by X?" through the existing confirm dialog, then shows "Note by X deleted · Undo" in its place until the sheet closes.
  - The note row is now `NoteItem`.
- `src/app/globals.css`: small `.jg-nacts`, `.jg-nact`, `.jg-ne` and `.jg-nx` rules using existing tokens only, so they work in light and dark.

### How it was tested

- New `tests/notesFix.runtime.test.ts`: judge PATCH and DELETE get 403, signed-out gets 403, JA edit records the old text in the Activity log, 400 for empty text, 404 for an unknown note, and delete then restore as seen by the JA and a judge.
- `tests/storeConformance.runtime.ts`: update, delete, restore, and list skipping deleted notes, for both stores.
- `tests/adminScores.runtime.test.tsx`: Edit and Delete render only with `canFix`; the "edited by" line shows for judges; the judge page never passes `canFixNotes`. `tests/coordinator.runtime.test.ts` now also covers the new PATCH and DELETE handlers.
- `npm test`: 1745 pass, 0 fail, 1 skipped. The skipped one is the real-Postgres suite: **not run**, because `TEST_DATABASE_URL` was not set. `tsc` and `eslint` are clean.
- Browser preview on a scratch copy of the data (never `.data/`), signed in as the JA, on desktop width in dark mode and phone width in light mode:
  - Edit, then Save: the text changed and showed "edited by".
  - Delete asked first, then showed the Undo line, and the tab count changed to "no notes".
  - Undo brought the note back.
  - All three changes appeared in the Activity log with the old text.
- Against the same server, signed in with a real judge code: PATCH and DELETE gave 403, a signed-out call gave 403, and the judge still read the note with its "edited by" marker.
- Not checked on a real iPhone, and not yet confirmed by the user.

### Branch / commit

`claude/ja-edit-notes-a9614a`, commit `ef84422` (local only).

### Status

Live in 2.1.4 (PR #18, merged `ff04220`, 2026-11-16). The Postgres columns were added on the first request after deploy (additive). Not checked on an iPhone.

### Follow-ups

- There is no screen listing notes deleted in earlier sessions. Undo lasts only while the sheet stays open, after which the text survives in the Activity log and the database row.
- Run the real-Postgres conformance suite (`TEST_DATABASE_URL`) before release.
## Judges Award can have two winners (2026-11-16)

### Problem / request

Reported on Version 2.1.3: some events give two Judges Awards, but the Awards board let the Judge Advisor pick only one winner per award per division. Picking a second team replaced the first.

### Root cause

One winner per (award, division) was built in at every level: the Postgres `award_winners` primary key was `(award_id, division)`, both stores' `setWinner` replaced the holder, and the board logic (`winnersOf`) held one row per award.

### What changed

Decisions agreed with the user: the count is fixed in config, it applies per division (both winners may come from the same division), a third pick is refused with "clear one first", and the award shows "1 of 2 winners" until both are picked.

- `config/event.json`: the `judges` award gets `"winners": 2`. Any award without it has one winner.
- `src/lib/types.ts`, `src/lib/presets.ts`: `AwardView.places` (1 to 10, default 1), read from the config's `winners`. It is named `places` so a judge's `/api/awards` reply still never contains the word "winner".
- `src/lib/db/postgres.ts`: the `award_winners` key is now `(award_id, division, team_id)`. A guarded step in `migrate()` swaps the key only while the old two-column key exists, so it is safe to re-run. Existing rows are unique on the old key, so nothing is lost. `setWinner` takes `places`: with 1 it still replaces the holder (in one transaction), with more it adds the team beside the others. `clearWinner` takes an optional `teamId`.
- `src/lib/db/file.ts`, `src/lib/db/types.ts`: the same store semantics. The JSON file needs no migration.
- `src/app/api/awards/winners/route.ts`: PUT refuses a winner beyond the award's places with 409 ("Judges already has its 2 winners in <division>. Clear one first."). DELETE takes an optional `teamId`, so clearing one Judges winner keeps the other.
- `src/components/admin/awardsLogic.ts`: `winnersOf` returns a list per award. An award counts as decided (status, the "x/11" count) only when all its places are filled, and shows "1 of 2 winners" in between. `Detail.full` and `fullText` are new, and Clear sends the team.
- `src/components/admin/AwardsTab.tsx`: when the award is full, the side panel shows "Judges has 2 winners. Clear one to give it to 1115." in place of the Give button.
- Tests: `awards.config`, `adminAwards.logic`, `awardsRoute.runtime` (the second winner is accepted, a third gets 409, Design still replaces, a clear by team keeps the other, and the judge-secrecy check is unchanged in strength), `storeConformance.runtime`, `postgres-sql`, and `judgeNominate.runtime` fixtures.

### How it was tested

- `npm test`: 1749 tests, 1748 pass, 0 fail, 1 skipped. The skip is the real-Postgres conformance suite, which was **not run** because `TEST_DATABASE_URL` was not set. The key migration and the transaction are covered only by the SQL-text tests and the file store.
- `tsc --noEmit` and `eslint . --ignore-pattern '.claude/**'` are clean.
- Browser preview on a copy of `.data/state.json` (scratchpad `DATA_FILE`, never `.data/`), signed in as the Judge Advisor:
  - Two Judges winners were given and a third was refused (409).
  - The board showed both winners, "Decided", and 1/11 in the rail, and the third nominee's panel showed the "clear one" note.
  - Clearing one winner changed the status to "1 of 2 winners" and the rail to 0/11, kept the other winner, and brought Give back.
- No iPhone check: the layout is unchanged apart from one line of text. The user has not confirmed it yet.

### Branch / commit

`claude/judges-award-two-b405c9`, one local commit. Not pushed.

### Status

Live in 2.1.4 (PR #18, merged `ff04220`, 2026-11-16). Combined with the "No winner" change in merge `130a8d3`. The real-Postgres suite passed on Neon first (1835/1835), then the live Supabase key change applied on deploy.

### Follow-ups

- Run the real-Postgres conformance suite (`TEST_DATABASE_URL`) before release.
- Two simultaneous PUTs could both take the last place: the cap is checked in the route, not by a lock. There is a single Judge Advisor, so this is accepted for now.
## Awards: mark an award "No winner" (2026-11-16)

### Problem / request

Reported on 2.1.3: "In the awards, sometimes no team is nominated for an award. Can you have something like 'No Team' or something that shows this award has no winner?" On the JA's Awards board an award nobody won just sat at "Open" or "N nominees", so the JA couldn't tell "not decided yet" from "deliberately not given", and the "N of 11 decided" count could never reach 11.

### Root cause

A winner record had to name a real team (`award_winners.team_id` is required and is linked to the teams table), so there was no way to record "no team".

### What changed

The user chose: any award can be marked (even one with nominees), the wording is "No winner", and it's saved in its own new table. Design and plan: `docs/superpowers/specs/2026-11-16-no-winner-award-design.md`, `docs/superpowers/plans/2026-11-16-no-winner-award.md`.

- Storage (both stores): `listNoWinners` / `setNoWinner` / `clearNoWinner`, one mark per award per division. Postgres adds `award_no_winner` with `create table if not exists` and RLS on. The migration only adds, so live Supabase data is untouched, and `award_winners` is unchanged. The file store defaults `noWinners` to `[]` for old state files. Day reset and full reset clear the marks.
- API: new `src/app/api/awards/no-winner/route.ts` (PUT marks, DELETE clears, JA only, logged in Activity). Marking an award a team holds takes it off that team. `PUT /api/awards/winners` now also clears a mark when a team is given that award ("instead of No winner" in Activity). The JA's `GET /api/awards` adds `noWinners`; a judge's reply is unchanged and never sees it.
- Board: each award in "By award" has a **Mark no winner** button at the foot of its card. A marked award shows a green "No winner" chip in the decided style and a **Clear** button. Every action asks first. The Matrix header shows a dash instead of the decided tick. "N of 11 decided", the division chips and the side-menu count all include marks.
- Files: `src/lib/types.ts`, `src/lib/db/types.ts`, `src/lib/db/file.ts`, `src/lib/db/postgres.ts`, `src/app/api/awards/no-winner/route.ts` (new), `src/app/api/awards/route.ts`, `src/app/api/awards/winners/route.ts` (PUT only), `src/components/admin/awardsLogic.ts`, `src/components/admin/AwardsTab.tsx`, `src/app/admin/page.tsx`, `src/app/globals.css`. Tests: `tests/storeConformance.runtime.ts`, `tests/postgres-sql.test.mjs`, `tests/awardsRoute.runtime.test.ts`, `tests/adminAwards.logic.test.mjs`, `tests/adminAwards.runtime.test.tsx`, `tests/refereeRuleFeature.test.mjs` (one regex: `resetAll` now names `award_no_winner`).

### How it was tested

- `npm test`: 1755 tests, 1754 pass, 1 skipped. The skip is the real-Postgres conformance suite, which was **not run** (no `TEST_DATABASE_URL`); the Postgres SQL is covered by the mocked tests only. `tsc` and eslint (`--ignore-pattern '.claude/**'`) are clean.
- Browser preview on a copy of `.data/state.json` in the scratchpad (never `.data/`), signed in as the JA, at desktop width and at 375 px phone width. Checked: marking Design moved the counts to 1/11 and showed the chip and Clear; giving a nominee the award removed the mark, and marking again took it off the team; the Matrix dash; Clear brought it back to "1 nominee" and 0/11; Activity read "marked Design no winner", "gave Design to 1101 · instead of No winner", "marked Design no winner · instead of 1101"; `/api/state` carries no marks. The first build crowded the card header at 1024 px (title over the chip). Moving the button to its own row at the foot of the card fixed it.
- Not checked on a real iPhone. The user has not confirmed it yet.

### Branch / commits

`claude/no-winner-award-7e1ad9`: `1d9aa15` (store), `5322810` (API), `006acc2` (board), `c68fecd` (button row), plus this entry.

### Status

Live in 2.1.4 (PR #18, merged `ff04220`, 2026-11-16). Combined with the two-winner change in merge `130a8d3`. Not checked on an iPhone.

### Follow-ups

- Merge with the parallel "two Judges Award winners" change (`judges-award-two`): both touch `src/app/api/awards/winners/route.ts` (here, the PUT only), `src/lib/types.ts`, `awardsLogic.ts` and `AwardsTab.tsx`. Once Judges Award can have two winners, decide whether marking it "No winner" should clear both (the no-winner route clears via `clearWinner(award, division)`).
- Run the real-Postgres conformance suite against the throwaway Neon project before release.
- The Matrix legend has no entry for the dash. It could gain one if the dash isn't clear enough on its own.

---

## Coordinator page scrolls past its tab bar (2026-11-13)

### Problem / request

Reported on the live Coordinator console (`/coordinator`, Version 2.1.1), in a desktop browser about 1000 px wide. Scrolling down the Teams tab made the whole page "go over". The Teams / Slots tab bar ended up partway up the screen with a large empty grey area below it, the team cards were cut off at the tab bar, and the browser's scrollbar showed the page as taller than the screen. Expected: the tab bar stays pinned to the bottom and only the team list scrolls.

### Root cause

The console is an app shell (`.co`: `height: 100dvh; overflow: hidden`) with the list scrolling inside `.co-body`. Each EN/TH language chip has a hidden screen-reader label (`<span class="sr-only">`, which Tailwind makes `position: absolute`). Nothing between those labels and `<body>` was positioned, so their containing block was `<body>`, and `.co-body`'s overflow did not clip them. They sat where the cards are laid out, up to about 2,000 px down, and made the document that tall (measured: document 2,025 px on a 552 px window, while `.co` and `<body>` were both 552 px). A wheel or trackpad scroll over the header, the tab bar or the page scrollbar then scrolled the document and slid the whole shell up.

It was not the iOS 100vh issue: the shell already uses `100dvh`. Only the Coordinator leaked. Judge, Referee and the Judge Advisor console measured exactly one screen tall, and the Slots tab was fine. The queue desk scrolls the whole page by design and is unchanged.

### What changed

- `src/app/globals.css`: `.co-body` gets `position: relative`, with a short comment. The scroller is now the containing block for absolutely positioned descendants, so the labels scroll and clip with the list.
- `tests/coordinatorShell.css.test.mjs` (new): asserts the `.co-body` rule has `position: relative` and `overflow-y: auto`. It fails on the old CSS and passes on the new.

### How it was tested

- Browser preview on a scratch data file (demo roster, never `.data/`), signed in as a coordinator.
- Before: reproduced at 1000×552 light and 375×700 dark. Wheeling over the tab bar scrolled the document up to 1,473 px, and the shell slid off the screen.
- After, at 1000×552 light and 375×700 dark, on both tabs: the document height equals the window (552 / 700). Wheeling over the list, the tab bar and the header, and even a forced `window.scrollTo(0, 350)`, leave the page at 0. The list still scrolls to its last card with the tab bar at the bottom of the window.
- Other consoles re-measured after the change, with the same results as before: Judge, Referee and Judge Advisor at 552 / 552; the queue desk is still its normal document scroll.
- `npm test`: 1691 tests, 1690 pass, 0 fail, 1 skipped (the same skip as before). `npx tsc --noEmit`: clean. `npm run lint` (`eslint .`): clean.
- iPhone 17 simulator (iOS 27.2), 2026-11-13, both fixes together on copied data: the Teams and Slots lists stop at their last item, with the tab bar pinned to the bottom and no empty space. Not checked on a real iPhone yet.

### Commit and branch

- Change: `259cabb` on `claude/co-scroll-fix-59d632`.

### Status

Live in 2.1.2 (PR #16, 2026-11-13).

### Follow-ups

- Check on a real iPhone and on the live site once it is merged and deployed (needs approval).
- The Judge, Referee and Judge Advisor shells have the same unpositioned-scroller pattern but don't leak today, because their hidden labels sit inside positioned elements. If a bare `sr-only` is ever added to one of their lists, the same bug would come back there.

## Coordinator sign-in: COORDINATOR word clipped (2026-11-13)

### Problem

On `/coordinator/login` (Version 2.1.1), in the two-column layout (768px and wider), the large spaced-out role word at the bottom of the teal panel ran past the panel's right edge and showed only as "COORDINATO".

### Root cause

From 768px up, the band (`.si-band`) is always 240px wide with 28px padding, leaving 184px. The word (`.si-role`) was a fixed `font-size: 26px` with `letter-spacing: 0.2em`. "COORDINATOR" is one 11-letter word that cannot wrap, and it measured 255px. The other doors fit: their longest single words are 7 letters or fewer (REFEREE 162px, ADVISOR 157px; "Judge Advisor" and "Queue desk" wrap between words). The band never changes width, so the problem was word length, not screen width.

### What changed

- `src/components/SignInForm.tsx` (`Band`): the role word now carries `--si-letters`, the letter count of the label's longest word (Coordinator 11; Referee and Judge Advisor 7; Judge, Queue desk and Staff 5).
- `src/app/globals.css` (the `min-width: 768px` block only): `.si-band` gets `container-type: inline-size`, and `.si-role` is `font-size: min(26px, 100cqi / var(--si-letters, 7))`, which allows about 1em per letter. Words of 7 letters or fewer still come out at 26px; COORDINATOR is about 16.7px (164px wide). Phone styles are untouched.
- `tests/doorPage.runtime.test.tsx`: one regression test. It renders the coordinator door and checks `--si-letters:11`, and checks that the 768px block keeps the container and the `min(26px, 100cqi / var(--si-letters` font-size.

### How it was tested

- Browser preview on a scratch data file (not `.data/`). All six doors (`/login`, `/admin/login`, `/judge/login`, `/queue/login`, `/referee/login`, `/coordinator/login`) were measured at 768, 1024, 1280 and 375px. Before: COORDINATOR was 255px in a 184px space, clipped. After: nothing is clipped at any of those widths. The other five doors are still 26px at 768px and up and 13px on phone, unchanged. Screenshots were taken before and after, in light and dark.
- Phone (375px): the word is the small 13px label in the top row there. It fit before and still fits.
- `npm test`: 1691 tests, 1690 pass, 0 fail, 1 skipped (the same skip as before).
- `npx tsc --noEmit`: clean. `npx eslint .`: clean.
- iPhone 17 simulator (iOS 27.2), 2026-11-13, both fixes together on copied data: the phone layout (portrait and landscape) shows the full word. The two-column layout never appears on iPhone; it was re-checked at 1024px in the browser. Real iPhone: not checked. The user has not yet confirmed the fix on the live page.

### Branch / commit

`claude/co-login-word-0bfa4d`, commit `f4793fb`.

### Status

Live in 2.1.2 (PR #16, 2026-11-13).

### Follow-ups

- If any role label gains a longer single word, it shrinks automatically. No per-role CSS is needed.

---

## New teams start Ungraded (2026-11-08)

### Problem / request

The user: "If the engineering notebook is set to developing when imported I want it to be ungraded at first". The default notebook type is the first entry of `teamCategories`, which was Developing, so a new team, or an import row with a blank notebook cell, was classed Developing. The user chose: only new teams get the new default; an explicit "Developing" in the sheet stays Developing; existing teams are unchanged.

### What changed

- `config/event.json`: `ungraded` moved to the top of `teamCategories`, so the order is now ungraded, developing, fully-developed. Nothing else in the file changed.
- `tests/adminImport.route.runtime.test.ts`: the "a new team gets the default notebook type" expectation is now `ungraded` (was `developing`).
- `tests/rubrics.test.mjs`: the classification-list test expects the config order, Ungraded, Developing, Fully Developed (was Developing, Fully Developed, Ungraded).
- `src/components/board/boardLogic.ts`, `tests/board.logic.test.mjs`: two comments no longer say the config lists Developing first. The board picks notebook markers by id, so Ungraded stays a hollow ring.

No app code changed. A re-import with a blank notebook cell still keeps the team's stored type, because `fallbackCategory` is null there. The Postgres column default `'developing'` in `src/lib/db/postgres.ts` is untouched: the app always supplies a category, so that default never applies.

### How it was tested

- `npm test`: before the change, 2 failures (the two expectations above). After it, 1690 tests, 1689 pass, 0 fail, 1 skipped (the same skip as before).
- `npx tsc --noEmit -p .`: clean, no errors.
- `npx eslint src tests`: clean, no problems.
- Not checked in the browser: no dev server or build was run.

### Commit and branch

- Change: `3b9d670` on `claude/event-judge-booking-app-kcprxn`.

### Status

Live in 2.1.1 (PR #15, 2026-11-08). The 32 teams already on the live site keep their stored type.

---

## Blended division shows as BLN (2026-10-31)

### Problem / request

The user: "I saw Division for Blended still show as blended while the others like Middle School use MS. Make Blended be BLN." `divisionTag()` shortened multi-word divisions to initials but returned one-word divisions whole, on purpose, so Blended stayed "Blended".

### What changed

- `src/components/admin/floorLogic.ts`: `divisionTag()` returns "BLN" for Blended (trimmed, any case); other one-word divisions still stay whole. Doc comment updated.
- `tests/adminConflicts.logic.test.mjs`: Blended, blended and " BLENDED " give "BLN"; "Open" stays "Open"; MS/ES/HS/D1/D12 unchanged.
- `tests/adminAwards.runtime.test.tsx`: the Awards division chip now reads "BLN" (full name kept for screen readers).

Every short division label already goes through `divisionTag`, so there was no hand-rolled copy to unify. Screens that now show "BLN": JA Teams list (Div column, panel picker hints), JA Panels tags, JA Floor "Move to panel…" rows, Conflicts (team and panel labels, roster groups), Awards division chips, Scores division filter (short label), and the referee console's team tags. Unchanged, still full names: panel headers on Floor and the judge console, the Judging Board and its colour key, pit map tooltips, queue desk, team page, setup forms. Blended's compatibility logic is not touched.

### How it was tested

- `npm test`: 1584 tests, 1583 pass, 0 fail, 1 skipped. `npx eslint src tests`: clean.
- In the browser, on a copy of the local data (not `.data/`) with two teams and one panel set to Blended: the Teams list shows "BLN" in the Div column beside "ES" and "MS"; the Panels tab tags read ES, ES, MS, BLN; Floor panel headers still say "Blended".

### Commit and branch

- Change: `600a5e8` on `claude/blended-bln-b74f84`.

### Status

Live in 2.0.1 (PRs #10–#13, 2026-10-31).

### Follow-ups

- None.

---

## Judging Board: colour key above Unassigned (2026-10-31)

### Problem / request

On the Judging Board's "By panel" view (`/board`), the "What the colours mean" key sat in the right column after the Unassigned card. With many unassigned teams (17 in the user's screenshot), Unassigned pushed the key below the fold of the big screen, where nobody saw it. The user chose "top of the right column" over a one-line key strip under the header, as the smallest change during the event.

### What changed

- `src/components/board/BoardView.tsx`: the two children of `.bd-side` are swapped, so `<ColourKey/>` comes first and the Unassigned `PanelCard` second. No CSS change: nothing in `globals.css` depended on the order, and the phone rule `.bd-side .bd-key { display: none; }` still hides the key.
- `tests/board.runtime.test.tsx`: the "a division with no teams is not in the By panel key" test now reads only the key's own `<section>`. Before, it sliced to the end of the page, which now also takes in the Unassigned card.

The Pit floor view and the `.bd-pkey` status line are unchanged.

### How it was tested

- `npm test`: 1584 tests, 1583 pass, 0 fail, 1 skipped. `npx eslint src tests`: clean.
- In the browser, on a copy of the local data (not `.data/`) with 17 unassigned teams added:
  - Big screen (1920×1080), light and dark: the key is at the top of the right column and Unassigned (17 teams) follows it.
  - Laptop (1440×900), dark: same order, with the key fully visible above the fold.
  - Tablet (900px): the right column becomes a two-across grid, with the key first and Unassigned beside it.
  - Phone (375px): the key is still hidden (`display: none`).
- Fullscreen: the in-app browser blocks the Fullscreen API, so it was checked as a 1920×1080 viewport, which is the same layout without the browser bars. Not checked on the real big screen.

### Commit and branch

- Change: `4a001a8` on `claude/board-key-top-423390`.

### Status

Live in 2.0.1 (PRs #10–#13, 2026-10-31).

### Follow-ups

- None.

---

## Team page: a way back, and no details strip (2026-10-31)

### Problem / request

The user, from a desktop screenshot of team 9852Z's page: "this page doesnt have the back door", and "do not need to show what is inside the greenbox". The team page had no way back out. Under the header, a strip read `9852Z | PSP S P³ I K E | Pit BLENDED | Elementary School | Developing | No panel`, repeating what the card below says. Also fixed, on the user's OK: after "Interview complete" the page still said "Please ask the queue desk to request a judge…".

The team page is public by team number (no team sign-in), reached from the "Find your team" ticket at `/team`, so the way back is a link to `/team`, not "Sign out". From there, "← All doors" leads to `/`.

### What changed

- `src/components/team/TeamView.tsx`: "← Change team" link to `/team` at the top of the page (the ticket page's `.lp-back` style); the details strip (`TeamDetails`) removed; the queue-desk note is hidden when the request is completed; `categories` prop dropped (only the strip used it).
- `src/app/team/[number]/page.tsx`: stops passing `categories`.
- `src/app/globals.css`: `.tp-meta` rules removed; `.teampage .lp-back` placement (spans both columns from 1024px); `align-content: start` on the desktop grid so the new row doesn't push the cards down.
- `tests/teamPage.runtime.test.tsx`: the four strip tests replaced with tests for the link, the strip being gone, and the note hidden after completion (kept for cancelled and no request).
- `tests/teamPage.logic.test.mjs`: the team-page CSS block may also style `lp-back`.

The user chose to drop pit, division and notebook category: they now show nowhere on the team page (teams know their own). Number, name and panel are still on the card.

### How it was tested

- `npm test`: 1584 tests, 1583 pass, 0 fail, 1 skipped. `npx eslint src tests`: clean. `npx tsc --noEmit`: clean.
- In the browser, on a copy of the local data (not `.data/`), at desktop (1440px) and phone (375px) width, light and dark:
  - Team with no panel and no request (1115): link at top, no strip, "No judge panel assigned yet" and the queue-desk note show.
  - Team with a panel and a live request (1101): same, with the panel on the card.
  - Team whose interview completed today (1108): "Interview complete — thank you!" and no queue-desk note; "See the full board →" stays.
  - Clicking "← Change team" opened "Find your team" at `/team`.
- The first build had a large gap above the cards at desktop width (the grid rows stretched to fill the page); fixed with `align-content: start`.
- Not checked on a real iPhone.

### Commit and branch

- Change: `be78288` on `claude/team-page-back-strip-981993`.

### Status

Live in 2.0.1 (PRs #10–#13, 2026-10-31).

### Follow-ups

- Desktop layout: the card sits on the left and the note and board link sit alone on the right. The user chose to leave it for now.
- On a phone, the queue-desk note also shows while a request is live ("Judges have been notified"); unchanged here.

---

## Head referee can remove a flag (2026-10-31)

### Problem / request

The user: "add head ref - remove flag - authorization". Only the Judge Advisor could remove (delete) a referee flag. The head referee could already correct one, but had to ask the JA to remove a wrong one. The head referee heads the field, so they should be able to remove flags too.

### What changed

- `src/lib/auth.ts`: new `canRemoveFlag` (Judge Advisor or head referee); `canFlag` comment updated.
- `src/app/api/flags/route.ts`: DELETE uses `canRemoveFlag`; the 403 now reads "Only the head referee or the Judge Advisor can remove a flag."; doc comments updated. The Activity log entry is unchanged and names whoever removed it.
- `src/components/Flags.tsx`: `FlagList` takes an optional `onRemove` and shows a red **Remove** next to **Edit**; the two wrap together at the right on a phone.
- `src/app/referee/page.tsx`: the head referee gets Remove on every flag (Today tab and "Already on <team>"), behind the same confirm the JA gets.
- `README.md`, `RELEASE-NOTES-2.x.md`: the permission text and API table now say head referee or JA removes.
- `tests/flagsRoute.runtime.test.ts`, `tests/flags.test.mjs`, `tests/flagsRendering.runtime.test.tsx`, `tests/refereePage.source.test.mjs`: new and updated tests.

### Who can do what now

| Who | Raise a flag | Correct a flag | Remove a flag |
|---|---|---|---|
| Referee | Yes | No | No (no button; the API says 403) |
| Head referee | Yes | Yes | **Yes** (new) |
| Judge Advisor | No | Yes | Yes |
| Judge, queue desk, team, signed out | No | No | No (403) |

The confirm reads "Remove this flag? The judges will stop seeing it." with **Cancel** and a red **Remove flag**. Each removal is logged to Activity, for example `removed a flag: warning · Morgan Head · Head referee`.

### How it was tested

- `npm test`: 1585 tests, 1584 pass, 0 fail, 1 skipped. `npx eslint src tests`: clean. `npx tsc --noEmit`: clean.
- New route test: ordinary referee, judge, queue desk and a signed-out caller each get 403 and the flag stays; the head referee removes one (200, Activity shows "Head referee"); the JA removes another.
- In the browser, on a copy of the local data (not `.data/`), at phone width (375px):
  - Ordinary referee: Today tab shows flags with no Edit or Remove; a direct `DELETE /api/flags` from that sign-in returned 403.
  - Head referee: Edit and Remove on every flag. Cancel kept the flag; Remove flag removed it and the list refreshed.
  - Dark mode: the Remove text and the row are readable.
  - JA: `DELETE /api/flags` returned 200 and removed a flag.
  - Activity had both removals, with the right name and role.
- The first build let Remove wrap onto its own line at the left at 375px; fixed by keeping Edit and Remove together.
- Not checked on a real iPhone.

### Commit and branch

- Change: `ebbd0ab` on `claude/head-ref-remove-flag-43e7d7`.

### Status

Live in 2.0.1 (PRs #10–#13, 2026-10-31).

### Follow-ups

- Check the Remove button on a real phone after the deploy.
- Ordinary referees still can't remove their own mistaken flag; they ask the head referee or JA. That was intended.

---

## Referee: keyboard hides the team being typed (2026-10-31)

### Problem

On the live site, on some phones, tapping **Team to flag** in the Referee console (`/referee`) opened the keyboard and squashed the app into the space above it. The header and the CURRENT MATCH bar stayed full size, the Record bar and the tabs sat right under them, and the form between them was about one line tall. Only the "Team to flag" label showed, cut off. The referee couldn't see the team number they were typing or the team it matched. The user: "some phones have this problem and they cannot see the team they are choosing".

### Root cause

The referee screen is a phone app shell: `.referee` is exactly one screen tall (`height: 100dvh`) and only `.rf-body` scrolls. Five parts are pinned around it at full size: header 73px, stripe 6px, match bar 109px (two rows on a phone), Record bar 98px, tabs 65px, 351px in all.

On most iPhones the keyboard slides over the page and nothing shrinks. Some phones shrink the page to the space above the keyboard instead (iOS 26.0 Safari has reported WebKit bugs where the page height changes around the keyboard, and some Android browsers resize the page by default). That leaves about 400–440px. The pinned parts don't shrink, so `.rf-body` got about 90px, and iOS 26's floating autofill bar (key / card / location) covered part of that.

### What changed

- `src/app/globals.css`: one `@media (pointer: coarse) and (max-height: 500px)` block. While a text field in `.rf-body` has focus, it hides the header, stripe, "VIQRC · N fields" pill, Record bar, tabs and floating theme toggle. They come back on blur. Phones that don't shrink (taller than 500px) and desktops (fine pointer) are untouched.
- `src/components/referee/RefereeFrame.tsx`: a `visualViewport` resize listener scrolls the focused field back into view, for fields lower in the form, like the note box, that the shrink pushes out of sight.

It works with the earlier `min-h-dvh` body fix (`4415991`): the page still can't scroll as a whole.

### How it was tested

- **Chromium simulation:** local dev server on a copy of the data (not `.data/`), 390px wide with touch emulation. A 440px-tall window stands in for the space above the keyboard in the user's screenshot.
  - **Before the fix:** reproduced the squash. `.rf-body` measured 89px, with only the label and the top of the input showing.
  - **After the fix:** with Team to flag focused, `.rf-body` is 383px. The typed "1101", the matched "Iron Hawks · Elementary School · Pit A1" and its flags, and the rule chips all show. Blur brings the Record bar (98px) and tabs (65px) back.
  - **Note box:** focused at full height, then shrunk to 440px (the order a keyboard opens in). The note box scrolled into view.
  - **All teams search:** the same rule applies. The search and its result show (checked in dark mode).
  - **Full phone height (844px):** focusing a field changes nothing. **Desktop (1024px):** the Record bar and tabs stay while typing, and the page doesn't scroll.
  - **Set match sheet and All rules picker:** already fine at 440px (each scrolls on its own), so unchanged.
- `npm test`: 1582 pass, 0 fail, 1 skipped. `eslint src tests` and `tsc --noEmit`: clean.
- **Real phone:** not checked. A desktop browser has no real on-screen keyboard. A local server on the same Wi-Fi was offered, and the user chose to skip the phone check.

### Commit and branch

- Fix: `cf7d3a5` on `claude/fix-ref-keyboard-f90990`.

### Status

Live in 2.0.1 (PRs #10–#13, 2026-10-31).

### Follow-ups

- Watch for it on a phone that showed the problem after the deploy (the phone check was skipped).
- The judge and Judge Advisor phone screens use the same shell. Their text fields are in pop-up sheets that scroll on their own, so they're likely fine, but check them on a squashing phone.

---

## Referee console scrolls the whole page on iPhone Safari (2026-10-31)

### Problem

On the live site, on an iPhone in Safari, scrolling the Referee console (`/referee`) broke the layout:

- The top row (Referee, name, Live, Sign out) slid off the top of the screen. The moon theme toggle stayed behind, floating over the striped bar and the "Set match" button.
- A blank grey strip appeared under the tab bar (Report / All teams / Today), above Safari's own toolbar.

Only the body (Team to flag down to the Record bar) should scroll. The header, match bar, Record bar and tabs should stay put.

### Root cause

The page `<body>` had Tailwind's `min-h-screen`, which is `100vh`. On iPhone Safari, `100vh` is taller than the visible screen, because it doesn't count Safari's toolbar. The referee shell (`.referee`) is correctly sized to the visible screen (`100dvh`), so the body was a little taller than the screen, and the whole page could scroll by the difference.

Two things triggered that scroll: tapping the Today tab, which jumps to "Flagged today" with `scrollIntoView` and scrolls every scrollable ancestor, including the page; and a swipe that starts on a part that doesn't scroll (the match bar, Record bar or tabs). The header moved up with the page. The theme toggle is pinned to the screen, so it stayed where it was. The extra empty body height showed up under the tabs.

It didn't show on a Mac, where `100vh` equals the visible height.

### What changed

- `src/app/layout.tsx`: body `min-h-screen` → `min-h-dvh` (no taller than the visible screen), plus a one-line comment explaining why.

This is the root layout, so it covers every page. The judge console and the Judge Advisor screens use the same full-screen setup and had the same hidden page scroll, so this fixes them too. Desktop is unaffected, because there `100vh` and `100dvh` are equal.

### How it was tested

- **Chromium simulation:** local dev server on a copy of the data (not `.data/`), at mobile width (375×812).
  - **Before the fix:** I made the body 40px taller than the screen, as iPhone Safari does, then tapped Today. The page scrolled 40px, the header disappeared and a 40px gap opened under the tabs, matching the user's screenshot.
  - **After the fix:** tapping Today scrolls only the body. The header stays at the top and the tabs reach the bottom edge.
  - **Also checked:** All teams scrolled to the bottom, dark mode, desktop width (1024px), and the head-referee view.
- `npm test`: 1582 pass, 0 fail, 1 skipped. `npm run lint`: clean.
- **Real iPhone:** not yet confirmed on a real iPhone. A local server on the same network was offered for that check.

### Commit and branch

- Fix: `4415991` on `claude/fix-ref-mobile-scroll-a19545`.

### Status

Live in 2.0.1 (PRs #10–#13, 2026-10-31).

### Follow-ups

- Confirm on a real iPhone in Safari before or after the deploy.

---

## Referee Today tab: show only today's flags (2026-10-31)

### Problem / request

On a phone, the Referee console's **Today** tab still showed the report form.
The user asked: "in today I need it shown only flagged, no need to show team or
others I want all the ref to see what are flagged".

### What it was before

- Today was not a screen of its own. It was a link to `/referee#today`, which
  scrolled down the Report page to the "Flagged today" section at the bottom.
- So the CURRENT MATCH bar, the whole form (team, rules, note, severity
  buttons) and the pinned "Set the match and field first." + Record bar were
  always on screen, with the list underneath.
- The list already held every referee's flags for today. `/api/state` sends
  referees all flags (`canReadFlags` in `src/lib/auth.ts`), so the server side
  did not need to change.

### What changed

- `src/components/referee/RefereeFrame.tsx`: the Today tab now links to
  `/referee?tab=today` instead of an anchor; the page tells the frame which
  tab is current.
- `src/app/referee/page.tsx`: with `?tab=today` it shows only "Flagged today".
  The match bar, the form and the Record bar are hidden. Tapping a team number
  opens Report with that team filled in.
- `tests/refereePage.source.test.mjs`: updated for the new Today link.

The user's answers:

- The CURRENT MATCH bar is hidden on Today.
- Good conduct entries stay in the list (all flags, not just violations).
- Every referee sees every referee's flags for today.

Also kept: the head referee and Judge Advisor still get their Edit button on
each flag. The match and team a referee has entered are kept when they switch
to Today and back. Report and All teams are unchanged. No CSS changes.

### How it was tested

- Local dev server on a copy of the data (not `.data/`).
- Signed in as two referees, a head referee and an ordinary referee. Each
  recorded a flag, and both saw both flags on Today with no form showing.
- Report, All teams, the team-number tap and the head referee's Edit sheet
  all worked.
- Phone and desktop widths in light and dark mode, with no console errors.
- `npm test` (1582 pass, 0 fail, 1 skipped), `npm run lint` and
  `npx tsc --noEmit` all clean.
- The user checked it on their own iPhone in Safari against the local server:
  looks right.

### Commit and branch

- `e465303`, Referee Today tab: show only today's flags
- Branch `claude/ref-today-flags-only-bf67dd`

### Status

Live in 2.0.1 (PRs #10–#13, 2026-10-31).

### Follow-ups

- The hidden JSX blocks in `page.tsx` were not re-indented, to keep the diff
  small while the mobile-scroll fix touched the same files. A whitespace-only
  tidy can follow after the event.

---

## JA phone Sections sheet was empty (2026-10-31)

### Problem

On an iPhone (Safari, about 390px wide), tapping the ☰ button in the Judge Advisor console (`/admin`) opened the "Sections" sheet, but the sheet was empty. It showed only the grab handle, the title with its ×, and the footer. Floor, Referee, Teams, Panels, Conflicts, Import, Scores, Awards, Activity and the Other consoles links were missing. The desktop left rail was fine.

### Root cause

The sheet (`.ja-sheet`) has only a `max-height`, no fixed height, so it is as tall as its contents. The section list inside it (`.ja-sh-list`) used `flex: 1; min-height: 0`, which means "start at 0px and grow into leftover space". A sheet that sizes to its contents has no leftover space. Chrome still sizes the sheet around the list, but iPhone Safari counted the list as 0px tall, so it vanished. The judge's team sheet (`.jg-sheet`) uses the same layout but has a fixed `height`, which is why it worked.

The JA record sheets and the Awards phone drawer were set up the same way, so they were exposed to the same problem.

### What changed

- `src/app/globals.css`, `.ja-sh-list`: `flex: 1` → `flex: auto` (the Sections list), plus a comment explaining why.
- `src/app/globals.css`, `.ja-sh-form`: `flex: 1` → `flex: auto` (record sheets: Conflicts, Referee, Panels, Teams, Scores).
- `src/app/globals.css`, `.ja-cf-scroll`: `flex: 1` → `flex: auto` (the scrolling fields in those record sheets).
- `src/app/globals.css`, `.ja-aw-sheet .ja-aw-dr`: `flex: 1` → `flex: auto` (the Awards phone drawer).

`flex: auto` starts each part at its real content height. `max-height` still caps the sheet, and `min-height: 0` with `overflow-y: auto` still lets the body shrink and scroll.

### How it was tested

- Browser pane (Chromium), local dev server on a copy of the data, phone width 375px:
  - The Sections sheet lists every section with counts; Other consoles shows when you scroll.
  - Tapping a section switches the tab and closes the sheet. ×, Escape and tapping the dimmed background close it, and it reopens each time.
  - The Conflicts record sheet shows all its fields. Forced short, the fields scroll and the button stays pinned.
  - The Awards drawer shows the full nominee details.
  - Dark mode looks right.
- Desktop width 1280px: the left rail is unchanged and the ☰ button stays hidden.
- `npm test`: 1582 pass, 0 fail, 1 skipped. `npm run lint`: clean.
- The user checked it on their real iPhone in Safari, against the local dev server: the list shows and tapping a section works.

The bug itself could not be reproduced on this Mac: Chromium and this Mac's newer WebKit both drew the sheet correctly even before the fix.

### Commit and branch

- Fix commit: `cfd7eb5`
- Branch: `claude/fix-ja-mobile-sections-bffe04`

### Status

Live in 2.0.1 (PRs #10–#13, 2026-10-31).

### Follow-ups

None required. The user checked only the Sections sheet on the iPhone; the record sheets and Awards drawer were checked in the browser pane only.

