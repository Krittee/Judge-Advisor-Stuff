# Referee console redesign (direction A, "Match first") — implementation prompt

Paste everything below the line into a Claude Code session opened in this repo
(or say: "Implement design/referee-redesign/PROMPT.md").

---

Redesign the referee console `/referee` (`src/app/referee/page.tsx`) as the
approved direction A, "Match first", and add the data changes it needs. The
design is final; match it, don't redesign it. Work on the `version-2.0`
branch. Do it in **two phases, each its own commit**: data first, then UI.

## Sources

- **Visual spec:** static mocks, dark theme, 375 wide. All are in
  `design/referee-redesign/`:
  - `reference-event-setup.dc.html` — one-time **Event setup** (program +
    number of fields)
  - `reference-report.dc.html` — main report screen (a 912px full-scroll
    capture)
  - `reference-match-sheet-v5rc.dc.html` — "Set the match" sheet, V5RC,
    Teamwork
  - `reference-match-sheet-viqrc.dc.html` — same sheet, VIQRC, Skills
  - `reference-all-rules.dc.html` — full "All rules" picker
  - `reference-all-teams.dc.html` — the "All teams" tab
  These are self-contained HTML mocks (custom `{{hole}}` template, not
  React). Read their `<style>` blocks for sizes, spacing and colours and
  their markup for structure and copy.
- **Live canvas:** https://claude.ai/artifact/Nhv45XWtvnnjLwCC768jWc — the
  "A · Match first" boards in the "Referee console" row.
- **Today's behaviour lives in:**
  - `src/app/referee/page.tsx`
  - `src/components/Flags.tsx` (RulesetPicker, RulePicker, FieldPicker,
    MatchAffectingCheck, FlagList, FlagSummary)
  - `src/lib/flagValidation.ts`, `src/lib/match.ts`, `src/lib/presets.ts`,
    `src/lib/rules.ts`, `src/lib/refereeHistory.ts`
  - `src/app/api/flags/route.ts`
  - the stores in `src/lib/db/` and `supabase/schema.sql`

## Phase 1 — data (own commit)

### 1a. Event setup: program and number of fields, set once per event

The **program** (ruleset: `v5rc` or `viqrc`) is no longer picked per match or
per device. It is chosen **once for the event**, when the head referee signs
in. Every referee then uses it. It can be changed for another event or day.
The **number of fields** is set at the same time: default 3, range 1–20.

- **Store:** there is no event-settings storage yet, so add one setup
  record:
  `RefereeSetup = { ruleset: string; field_count: number; set_by: string;
  set_on: string /* YYYY-MM-DD, event-local */; updated_at: string }`.
  - `Store` gets `getRefereeSetup(): Promise<RefereeSetup | null>` and
    `saveRefereeSetup(input): Promise<RefereeSetup>`.
  - **Postgres:** a single-row `referee_setup` table (or a small key/value
    `settings` table, whichever fits the store better), created by the
    runtime migration in `postgres.ts` and added to `supabase/schema.sql`
    with RLS enabled like the other tables.
  - **File store:** a `refereeSetup` key, defaulted in `migrate()`.
  - `resetAll()` clears it. `resetDay()` keeps it.
  - Cover it in `tests/storeConformance.runtime.ts`.
- **State and API:**
  - Include it in the loaded state (`state.refereeSetup`).
  - Add `PUT /api/referee-setup`. It validates the ruleset with
    `isValidRulesetId` and `field_count` as an integer from 1 to 20, sets
    `set_by` to the session name and `set_on` to today, and logs an activity
    entry ("Referee setup: V5RC, 3 fields").
- **Who may change it (decided by the user):** any signed-in **referee** or
  **Judge Advisor** (`canFlag` or `canAdminister`). The UI asks for
  confirmation, and the activity log records every change. There is no
  separate head-referee role.
- **When it is asked for:** after referee sign-in, if there is no setup, or
  its `set_on` is not today, show the **Event setup** screen. It is
  pre-filled with the last setup, so a multi-day event is one tap.
  Otherwise go straight to the console.
- **Flags:**
  - A new flag's ruleset comes from the setup: the server defaults to it
    when the request omits one.
  - A request naming a different ruleset than the current setup is
    rejected with "This event is set to {label}."
  - Existing flags keep their own ruleset. Corrections keep the flag's own
    ruleset, as today.

### 1b. Match types: Teamwork and Skills

Match types come in two groups, and the Teamwork group depends on the
event's program:

| Group | VIQRC | V5RC |
|---|---|---|
| **Teamwork** | P Practice, Q Qualification, F Final | P Practice, Q Qualification, R16 Round of 16, QF Quarterfinal, SF Semifinal, F Final |
| **Skills** (both programs) | Driver, Auto | Driver, Auto |

- Define the lists per program in the rules files (`config/rules/*.json`),
  read through `src/lib/rules.ts` / `presets.ts`. Each type carries its
  group (`teamwork` | `skills`).
- **Skills:** store Driver and Auto as two match types, `SKD` (Driver
  skills) and `SKA` (Auto skills), with `match_number` holding the run
  number. Keep the legacy `SK` valid for old flags and show it as
  "Skills".
- `isValidMatchType(type, rulesetId)` validates against the flag's ruleset.
  Old flags with P/Q/F/SK stay valid.
- **Elimination numbers (V5RC R16/QF/SF/F):** bracket + match, stored in
  `match_number` as `"2-1"`. Shown as "QF 2-1".
  - `normalizeMatchNumber` / `isValidMatchNumber` / `filterMatchNumberInput`
    in `src/lib/match.ts` take the match type into account.
  - Plain numbers (max 4 digits) stay as they are for P/Q, VIQRC F and the
    Skills runs.
  - `matchReference` adds a space for multi-letter types ("QF 2-1",
    "R16 3-1"). It keeps "Q23" unchanged, and Skills reads "Driver 1" /
    "Auto 2".
- `refereeHistory` "same match" comparisons use the full reference (type +
  number), so QF 2-1 and QF 2-2 count as different matches.

### 1c. Fields: just a number, up to the event's field count

- New flags store `field` as a plain number string `"1"`…`"N"`, where N is
  the setup's `field_count`. Shown as "Field 2".
- The division prefix (ES/MS/HS/BL/SK, `FIELD_PREFIXES`) is no longer picked.
- Validation:
  - an integer from 1 to `field_count`;
  - legacy prefixed values ("HS2") on old flags still load and display;
  - a correction that leaves the field unchanged keeps them.
- Error text: "Pick the field — 1 to {N}."

### Phase 1 tests

Update the tests that already cover flags, matches and the store:
- `tests/flags.test.mjs`
- `tests/flagsRoute.runtime.test.ts`
- `tests/flagMigration.runtime.test.ts`
- `tests/storeConformance.runtime.ts`
- `tests/refereeRules.runtime.test.ts`
- `tests/refereeRuleFeature.test.mjs`
- `tests/match.test.mjs`
- `tests/flagsRendering.runtime.test.tsx`
- `tests/eventBoundary.runtime.test.ts`
- `tests/teamDeleteParity.runtime.test.ts`
- `tests/postgres-sql.test.mjs`, if it checks the flags migration SQL

Include these cases:
- setup save / load / reset;
- a flag defaults to the setup's ruleset, and a mismatched ruleset gets 400;
- "QF 2-1" round-trips;
- a V5RC-only type rejected on VIQRC and the reverse;
- a field above `field_count` → 400;
- legacy flags (`SK`, "HS2" field) still load and render.

## Phase 2 — UI (own commit)

Rebuild `/referee` to the reference. The logic and API calls stay the same
as today apart from the new fields.

0. **Event setup screen** (`reference-event-setup.dc.html`):
   - **When:** shown after sign-in when there is no setup for today (see
     1a). It can also be reached later from the match sheet's "Change" link
     or a menu item.
   - **Layout:**
     - eyebrow "TODAY'S EVENT";
     - title "Set up refereeing";
     - intro "Choose once for this event. Every referee will use it. You can
       change it for another event or day.";
     - two large program cards (V5RC / VIQRC);
     - a **Number of fields** stepper (−/+, 48px buttons, default 3) with a
       preview row of field chips;
     - "Set by {name} · applies to all referees";
     - "Start refereeing" button.
   - **Changing an existing setup:** asks "Change the program for everyone
     at this event?" first.
   - **On save:** calls `PUT /api/referee-setup`. This replaces
     `RulesetPicker` and its `localStorage` key, so remove both.
1. **Chrome:** keep `TopBar` (title "Referee", the referee's name, online
   dot, `SignOutButton to="/referee/login"`), add the 6px referee stripe strip
   under it, and a bottom tab bar with Report (`/referee`), All teams
   (`/referee/teams`) and Today. Today can be an anchor to the "Flagged
   today" section, or a third view if simpler.
2. **Pinned "Current match" bar:** shows e.g. "QF 2-1 · Field 2", a small
   read-only program tag ("V5RC"), and a Change button that opens the **Set
   the match** bottom sheet:
   - **No program line:** the program is shown only as the bar's read-only
     tag and is changed from Event setup (the row at the foot of Report).
   - **Group:** a "Teamwork | Skills" segmented control.
   - **Teamwork:** the program's type chips. A number stepper for single
     numbers, or "Bracket" + "Match" inputs for V5RC eliminations.
   - **Skills:** a "Driver | Auto" segmented control + "Run #".
   - **Field:** chips 1…N from the setup (48px squares), with the note
     "{N} fields · set in event setup".
   - **Confirm:** "Use this match", with the caption "Stays set for every
     team you flag until you change it."
   - The sheet is a real dialog: focus trap, Escape and backdrop close it,
     `aria-modal`.
   - Match and field persist after each recorded flag.
3. **Team to flag (the first thing picked; no alliance):**
   - The referee cannot know which teams play in a match, so they simply
     type or pick the one team they are flagging. There is no alliance or
     roster step (the user decided this).
   - Big team-number input (Archivo), labelled "Team to flag".
   - Under it, one muted summary line for the matched team: "{name} ·
     {division} · Pit {pit}", with its existing-flag pill(s) on the right
     (from `FlagSummary`).
   - No "Flagged this match" chips or recent-team shortcuts: the referee
     picks every team by hand (the user decided this).
   - "No team with that number." stays.
4. **What happened:**
   - Common-rule chips (`commonRuleIds` of the event's program),
     multi-select, with `aria-pressed`.
   - Under them a full-width **"All rules · {n} in {ruleset}"** button with a
     "{k} selected" pill. It opens the full **All rules** picker (full screen
     or full-height sheet):
     - back arrow and "Done (k)";
     - sticky search box that matches id and title, as `RulePicker` does now;
     - "Common" group first;
     - then every category as a collapsible group with its count;
     - rows of 48px+ with a checkbox;
     - bottom bar "k rules selected · ids" + Done.
   - Keep `MAX_FLAG_RULES`.
   - A collapsed "Add a note" row (the existing optional note, 500 chars).
   - The match-affecting toggle (`role="switch"`), shown only when a rule is
     picked, as today.
5. **Repeated-violation callout:** same logic as today
   (`refereeHistory`), restyled as in the mock. It stays display-only and
   never selects a severity.
6. **"How serious?" — big conduct buttons:**
   - The last section of the scrolling body.
   - The user wants these big and easy to hit, so no compact strip.
   - A 2-column grid, gap 8px. Each button is at least 56px tall, Archivo 600
     16px, radius 12px, with the full label and filled in its severity tone
     (`toneSolid`):
     - row 1: "Good conduct" | "Warning";
     - row 2: "Minor violation" | "Major violation";
     - row 3: "Disqualified", spanning both columns.
   - Tapping a button only **selects** it: `aria-pressed`, a 3px ink outline
     with 2px offset, and a check icon before the label.
   - Keep the escalation highlight logic (`maxSeverity`) on the button.
7. **Confirm bar pinned above the tabs:**
   - Only the full-width confirm button that saves, e.g. "Record Minor ·
     9882K", 52px, tinted in the selected severity.
   - Disabled until the severity, team, match,
     field and any required rule are set. One line says what is missing.
   - This replaces today's save-on-tap buttons.
8. **After saving:**
   - The success banner, as today.
   - Clear the note, rules, match-affecting and severity.
   - Keep the team number, so the referee can flag the same team again, plus
     the match and field.
9. **"Already on {team}"** (`FlagList` with corrections) and **"Flagged
    today"** stay, below the form or on the Today tab. Corrections offer the
    same Teamwork/Skills types and field chips as the form.

10. **All teams tab** (`/referee/teams`, `reference-all-teams.dc.html`):
    restyle to match. Same top bar, stripe and bottom tabs (All teams
    active), no match bar.
    - Sticky search ("Search number, name or pit").
    - Filter row: division select as a pill, "Flagged only" toggle chip,
      and the "{shown} of {total} teams" count.
    - Caption "Tap a team to flag it on Report."
    - Full-width team rows (64px+): number, name, a "{division} · Pit"
      line, `FlagSummary` pills and a chevron.
    - The behaviour stays as today: search by number, name or pit; tapping a
      team opens `/referee?team=…` on Report with that team filled in.

## Colours and constraints

- **Tokens:** reuse the existing ones and the existing severity tones
  (`toneSolid`).
- **Motion:** none beyond hover/focus transitions.
- **Accessibility:** 44px+ targets, visible focus rings, labels on every
  input, AA contrast in light and dark, no horizontal scroll at 375px.

## Done when

- `npm run typecheck`, `npm run lint` and `npm test` pass.
- Checked in the browser at 375px, light and dark:
  - the first referee sign-in of the day shows Event setup;
  - set V5RC with 3 fields, then a second referee goes straight to the
    console using V5RC;
  - set QF 2-1 / Field 2, then flag 9882K Minor with GG17 + SG6;
  - flag a second team in the same match;
  - switch to Skills → Driver, run 1, and flag a team;
  - change the setup to VIQRC with 4 fields and confirm the Teamwork types
    become P/Q/F and field 4 appears;
  - the All rules picker: search, select, Done;
  - a correction on an existing flag changes its match and field;
  - a legacy flag ("SK", "HS2") still shows.
- Nothing pushed, no PR opened, until the user approves.
