# Judge Advisor console redesign — implementation prompt

Paste everything below the line into a Claude Code session opened in this repo
(or say: "Implement design/admin-redesign/PROMPT.md").

---

Redesign the Judge Advisor console `/admin` (`src/app/admin/page.tsx`) on
the `version-2.0` branch. The design is final; match it, don't redesign it.
The console is being designed **tab by tab**. This file covers:

1. **The shell** — top bar, grouped side rail, phone menu. Applies to every
   tab, including the ones not redesigned yet. UI only.
2. **Floor** (direction A, "Panel board"). UI only.
3. **Conflicts** (direction C, "One form + table") — conflicts move from
   panels to individual judges. **Data + UI**, see its section.
4. **Referee** (direction C, "Team + history"). UI only.
5. **Teams** (direction B, "Table + team drawer"). UI only.
6. **Panels** (direction B, "Roster board"). UI only, but it **needs the
   judge roster** from the Conflicts data phase.
7. **Import** (direction A, "One box"). UI, plus a small change to the
   import response (per-line skip reasons, new/updated counts).
8. **Scores** (direction C, "Ranked + compare"). UI only. Also: every
   "Notes" / row click on this console opens the **judge console's team
   sheet** instead of the old NotesDrawer (user decision).

More tabs will be added below as they are designed. Tabs that have no
section here yet keep their current content, just rendered inside the new
shell.

**Commits, in order:** (1) shell + Floor; (2) Conflicts data; (3) Conflicts
UI; (4) Referee; (5) Teams; (6) Panels; (7) Import; (8) Scores + team
sheet. Each is one local
commit with every check green. If you are only asked to do part of this
file, do the parts in that order.

## Sources

- **Visual spec:** static mocks, dark theme, in `design/admin-redesign/`:
  - `reference-floor-wide.dc.html` — 1280 wide: rail + Floor panel board,
    with the "Move to panel…" popover open on 5150Z
  - `reference-floor-phone.dc.html` — 375 wide: Floor with the panel
    switcher (full-scroll capture)
  - `reference-phone-menu.dc.html` — 375 wide: the Sections menu sheet
  - `reference-conflicts-wide.dc.html` — 1280 wide: Conflicts, list by
    judge + pinned record form
  - `reference-conflicts-phone.dc.html` — 375 wide: Conflicts with the
    record sheet open
  - `reference-referee-wide.dc.html` — 1280 wide: Referee, flagged teams
    + the selected team's history
  - `reference-referee-phone.dc.html` — 375 wide: Referee, flagged-team
    list
  - `reference-referee-edit-sheet.dc.html` — 375 wide: the "Correct flag"
    sheet (also used at 1280 as a dialog)
  - `reference-teams-wide.dc.html` — 1280 wide: Teams table with the
    9882K drawer open
  - `reference-teams-phone.dc.html` — 375 wide: Teams list with the edit
    sheet open
  - `reference-teams-event-data.dc.html` — **only for the expanded "Event
    data" section at the bottom** (its table is the rejected direction A —
    ignore it)
  - `reference-panels-wide.dc.html` — 1280 wide: judge roster beside the
    panel cards
  - `reference-panels-phone.dc.html` — 375 wide: Panels, Judges segment
  - `reference-panels-add-judge-confirm.dc.html` — 375 wide: adding a
    judge who has conflicts with teams on that panel
  - `reference-import-wide.dc.html` — 1280 wide: Import, filled box +
    result
  - `reference-import-phone.dc.html` — 375 wide: Import
  - `reference-scores-wide.dc.html` — 1280 wide: ranked list + compare
    panel (8080V vs 1108)
  - `reference-scores-phone.dc.html` — 375 wide: ranked list with two
    picked and the pinned Compare bar
  These are self-contained HTML mocks (custom `{{hole}}` template, not
  React). Read their `<style>` blocks for sizes, spacing and colours and
  their markup for structure and copy. Team data in them is sample data.
- **Live canvas:** https://claude.ai/artifact/Nhv45XWtvnnjLwCC768jWc, row
  "Judge Advisor · Floor" (A chosen) and "Judge Advisor · Conflicts (by
  judge)" (C chosen), "Judge Advisor · Referee" (C chosen) and "Judge
  Advisor · Teams" (B chosen), "Judge Advisor · Panels" (B chosen),
  "Judge Advisor · Import" (A chosen), "Judge Advisor · Scores" (C
  chosen). Boards marked "Not chosen" are
  exploration only.
- **Patterns to reuse, not copy:** the judge console
  (`src/components/judge/`, `.judge` / `.jg-*` in `globals.css`): status
  pills, flag pills, the advance-button colour rule, `cancelCopy` /
  `cancelAfterAsking`, `minutesSince`, the 30 s redraw tick. The referee
  and judge consoles for `<dialog>` sheets and `useConfirm()`.
- **Today's behaviour:** `src/app/admin/page.tsx` (`AdminPage`, `FloorTab`),
  `src/components/nav.tsx` (`TabBar`), `src/components/Language.tsx`
  (`LanguageCover`), `src/lib/presets.ts` (`divisionsCompatible`),
  `src/lib/status.ts`.

## Keep (behaviour that must not regress)

- Session gate: non-admin → `/admin/login`; sign out → `/admin/login`.
- The 8 sections and their counts: Floor (number of `requested`, urgent),
  Conflicts (count), Referee (flag count), Teams (count), Panels (count),
  Import, Scores, Activity. `useScores` only runs while Scores is open.
- Scores → "conduct" link → Referee tab focusing that team
  (`focusFlagTeam`), cleared when you leave via another section.
- A notes/scores view for the admin, opened from Floor's "Notes". Until
  the Scores phase lands it is the old NotesDrawer; the Scores phase
  switches it to the judge console's team sheet (see Scores).
- Floor actions, all with `from: request.status` on the PATCH:
  - **reassign** — only panels in a compatible division
    (`divisionsCompatible`) and not conflicted with the team, plus its
    current panel;
  - **advance** — `NEXT_STATUS`;
  - **cancel** — now **asks first** (`cancelAfterAsking` with the status
    wording from the judge console).
- Floor's language warning (`LanguageCover` with `asking`).
- Floor's link to `/board` (new tab).
- Floor empty state: "Nothing in flight. Teams will appear here as they
  request judges."
- Polling via `useAppState(4000)`.

## The shell

### Top bar
JA avatar `public/avatars/judge-advisor.jpg` (28px, rounded) ringed in
`--accent` — **not** the sign-in violet, because violet means "interviewing"
on this console. "Judge Advisor" + the admin's name, Live dot, Sign out,
theme toggle where the other consoles put it.

### Side rail (≥ 1024px wide)
A fixed ~224px left column under the top bar, three groups with small-caps
labels:

- **LIVE** — Floor, Conflicts, Referee
- **SETUP** — Teams, Panels, Import
- **RESULTS** — Scores, Activity

Each item: a 22px stroke icon (from the mock), the label, and the count on
the right. Floor's count is an orange badge (it is the "teams requesting"
count, the same signal as the waiting colour); every other count is
neutral text. The current item gets an accent-tinted background and a 3px
accent bar on the left, and `aria-current="page"`. The rail is a `<nav>`
with `aria-label="Judge Advisor sections"`.

### Phone (< 1024px)
No rail. The top bar gets a 44px menu button (`aria-label="Sections"`)
before the avatar. Under the top bar, a slim bar shows the current section
name with its count (Floor: "3 requesting" in the orange badge).

The menu button opens a **bottom sheet** (native `<dialog>`, like the judge
team sheet): grab handle, title "Sections", close X, the same three groups
as 52px rows with icons and counts, current item marked as in the rail.
Under the list: "<name> · Judge Advisor" and a quiet "Sign out". Picking a
section closes the sheet. See `reference-phone-menu.dc.html`.

Section state can stay in React state as today; no routing change needed.

## Floor (direction A, "Panel board")

### Top strip
Event-wide counts as big numbers with status dots: Requesting, On the way,
Interviewing, Complete (from `STATUS_META`). On the right, "Open big-screen
board ↗" (link to `/board`, `target="_blank"`, `rel="noopener"`).

### One column per panel (wide)
Panels in their configured order, side by side, filling the width
(4 across at 1280; wrap or scroll horizontally beyond what fits — keep each
column ≥ 240px).

**Column header:** panel name (Archivo), division tag, the panel's
languages as tags ("EN only" when it covers one), the judges' names, and a
load line: "2 waiting · with 2011A" / "none waiting · going to 3141P" /
"1 waiting · panel free" (waiting count in the waiting colour).

When any request on that panel asks for a language the panel does not
cover, the header also shows a caution pill "<language> not covered".

**Cards in a column, in this order:** interviewing, then on the way, then
requesting (longest wait first), then booked (by slot time). Each card:

- team number (Archivo) + name;
- status pill, elapsed time (orange when requesting) or the booked slot
  time, language tag;
- referee flag pills (`FlagSummary`-equivalent, judge-console style);
- requesting cards get the waiting tint (12% fill, 45% ring), as in the
  judge console;
- the language warning as a caution box when `LanguageCover` would warn:
  "Panel 3 interviews in English only — this team asked for ไทย.";
- a full-width **advance button** filled with the colour of the status it
  moves the team to ("On our way" / "Start interview" / "Finish"), with the
  busy label while saving, and a 44px "⋯" button next to it.

**The "⋯" menu** (a popover anchored to the button, like the mock): "Move
to panel…", "Notes", "Cancel request" (danger-quiet, asks first). "Move to
panel…" shows the allowed panels as rows (name, division, languages) and a
caption "Only <division> panels without a conflict"; picking one sends the
reassign. Escape and clicking outside close it. If no other panel is
allowed, the row is disabled with that reason.

**Empty column:** a panel with nothing in flight shows a quiet "Nothing in
flight" in the column body, so the column still shows the panel's judges.

### Phone
Instead of columns, a **panel switcher** under the top strip: one chip per
panel ("P1 · 1 team", …), the selected one in accent, an orange pip on a
chip whose panel has teams requesting and a caution dot on one with a
language gap (each with sr-only text). Below it, the selected panel's
column header and cards exactly as on wide. The top strip becomes a
4-cell grid; the board link sits under it. Default selection: the panel
with the longest-waiting request, else the first panel.

## Conflicts (direction C, "One form + table") — data + UI

### Why it changes
A Judge Advisor collects conflicts **judge by judge, before panels are
formed**: "which teams are you affiliated with?". Today a conflict can only
exist against a panel (`conflicts.panel_id NOT NULL`), with the judge's name
as a label. From now on a conflict belongs to a **judge**, and a panel is
blocked from a team when **any judge on it** has a conflict with that team.
Decisions (user, 2026-10-20):

- There is a **judge roster**. Conflicts point at a judge id, never at a
  typed name, so spelling can't silently break a block.
- Adding a conflicted judge to a panel that already has the team
  (assigned, or with a live request or booking) **asks first, then takes
  the team off**, exactly as declaring a conflict does today.
- Existing **panel-only conflicts keep working** and are shown as their own
  group, "Whole panel (older entries)".

### Phase 2 — data (own commit)

**Judge roster.** New `JudgeRow = { id: string; name: string; note: string
| null; panel_id: string | null; created_at: string }`. A judge sits on at
most one panel.
- `Store` gets `listJudges()`, `addJudge({ name, note? })`,
  `updateJudge(id, patch)` (name, note, panel_id) and `removeJudge(id)`.
- **Postgres:** a `judges` table (FK `panel_id → panels on delete set
  null`), created by the runtime migration in `postgres.ts` and added to
  `supabase/schema.sql` with RLS enabled like the other tables.
- **File store:** a `judges` key, defaulted in `migrate()`.
- `resetAll()` clears judges; `resetDay()` keeps them.
- Names are trimmed and unique case-insensitively (refuse a duplicate with
  a clear 409, as other stores do).

**Panel membership comes from the roster.** `PublicPanel.judges: string[]`
stays in the API shape (the board, team page and judge console read it),
but it is now the names of the roster judges whose `panel_id` is that
panel, in roster order. The Panels tab's judges text field keeps working
until the Panels tab is redesigned: saving it finds-or-creates each name in
the roster and sets/clears `panel_id` to match the list. Presets do the
same. Migrate: for every existing panel, create roster judges from its
current `judges` array (dedupe by name). Whether the old `panels.judges`
column is kept as a write-through copy or dropped is your call; both stores
must agree, and nothing may read it as the source of truth afterwards.

**Conflicts.** `ConflictRow` gains `judge_id: string | null` and
`panel_id` becomes `string | null`. Exactly one of the two is set: a judge
conflict (new) or a whole-panel conflict (legacy). Unique on (judge_id,
team_id) and on (panel_id, team_id). Deleting a panel deletes its
whole-panel conflicts (as today) but **never** a judge's conflicts.
`judge_name` stays readable on legacy rows; new rows don't write it.

**One rule for "is this panel blocked from this team?".** Add a pure
helper in `src/lib/conflicts.ts`:

```ts
/** Every (panel, team) pair that may not meet: whole-panel conflicts, plus
 *  each judge conflict mapped through that judge's current panel. */
export function panelBlocks(conflicts: ConflictRow[], judges: JudgeRow[]):
  { panel_id: string; team_id: string; conflict_id: string }[]
```

Every place that today checks `c.panel_id === <panel> && c.team_id ===
<team>` must go through `panelBlocks` (or a `isPanelBlocked` wrapper) so
the rule lives once. Today's call sites:
- `src/lib/conflicts.ts` (`isConflicted`)
- `src/lib/server-state.ts` (judge's barred teams)
- `src/app/api/conflicts/route.ts` (judge filter, "was holding it",
  bulk "already declared", unassign on declare)
- `src/app/api/requests/[id]/route.ts` (reassign refusal)
- `src/app/api/admin/teams/route.ts` (assign refusal)
- `src/app/api/notes/route.ts`, `src/app/api/scores/route.ts` (judge
  views)
- the auto-assign in `src/lib/db/file.ts` and `src/lib/db/postgres.ts`
- `src/app/admin/page.tsx` (Floor reassign list, Teams, stranded check)
Grep for `panel_id ===` and `listConflicts` to be sure none is missed.

**API.**
- `GET/POST/PATCH/DELETE /api/admin/judges` (admin only) for the roster.
- `POST /api/conflicts` takes `{ judgeId, teamNumbers, note? }` (bulk, the
  note applies only when exactly one team is given) and returns
  `{ judge, recorded, unchanged, notFound, takenOff }` where `takenOff` is
  the teams that came off the judge's current panel. Keep accepting the old
  `{ panelId, … }` body so legacy behaviour and its tests survive.
- Setting a judge's `panel_id` (roster PATCH or the Panels judges field)
  returns `takenOff` for the teams that join the block; the client asks
  first (see UI), so add a `dryRun: true` flag that reports `takenOff`
  without writing.
- `AppState` gains `judges: JudgeRow[]` (admin only; judges and desk don't
  need it).
- Activity log entries for: judge added/renamed/moved/removed, conflict
  recorded/withdrawn (who, which judge, which teams).

**Data tests (must fail if reverted):** `panelBlocks` (judge on a panel,
judge with no panel → no block, judge moved → block follows, legacy panel
conflict, panel deleted keeps judge conflicts); store conformance for the
roster and the new conflict shape in `tests/storeConformance.runtime.ts`;
the migration from `panels.judges`; a route test that a judge on Panel 2
with a conflict on 9882K makes `PATCH /api/requests/:id` reassign to
Panel 2 refuse, and moving that judge to Panel 3 lifts it; Postgres SQL
covered in `tests/postgres-sql.test.mjs`.

### Phase 3 — UI (own commit)

Visual spec: `reference-conflicts-wide.dc.html` (1280) and
`reference-conflicts-phone.dc.html` (375, record sheet open).

- **Rail:** "Conflicts" with the count of judge conflicts (legacy entries
  not counted).
- **Stranded alert** on top, as today (danger tint): teams with no panel
  left in their division, now computed with `panelBlocks`.
- **Record form** — pinned right panel at ≥1024px; on a phone a full-width
  "Record conflicts" button pinned at the bottom opens it as a bottom-sheet
  `<dialog>`:
  - **Judge** — a `<select>` grouped by panel ("Panel 1 · HS", …, then "Not
    on a panel"), plus a last option "+ New judge…" that swaps in a name
    (+ optional note) field and creates the judge on submit. Under it a
    one-line status: "Blocks Panel 2" or "Not on a panel yet".
  - **Team numbers** — textarea, "commas, spaces or one per line".
  - **Note (optional)** — "Only when you enter one team".
  - **Record conflicts** — primary (accent).
  - **Last recording** box: "Recorded for Priya Nair: 9882K, 7700B" (done
    green), "Priya Nair is on Panel 2, so 7700B comes off it and needs a
    panel" (caution), "Already recorded: …" (muted), "No team with that
    number — check these: …" (danger-quiet).
- **List grouped by judge** — only judges with conflicts, in roster order.
  Group header: judge name, panel tag (neutral) or "Not on a panel yet",
  "Blocks Panel N", "N conflicts". Rows: team number + name, note in
  quotes, a "needs a panel" caution pill when the team is unassigned, and
  **Withdraw** (asks first: "Withdraw Priya Nair's conflict with 9882K?
  Panel 2 will be able to judge them again.").
- **"Whole panel (older entries)"** group last, sub-line "Apply to every
  judge on the panel, not one judge.", rows with team, panel tag, Withdraw.
- **Empty state:** "No conflicts yet. Ask each judge which teams they're
  affiliated with, and record the answers."
- **Panels tab:** if the Panels section below isn't built yet, saving a
  panel's judges text asks first when `dryRun` reports `takenOff`, then
  saves. The Panels redesign replaces that with the roster board.

**UI tests (must fail if reverted):** the judge select groups by panel and
creates a new judge via "+ New judge…"; the result box shows all four
kinds of line; Withdraw asks first and sends nothing when declined; the
legacy group renders; the phone sheet opens from the pinned button.

**Done when (Conflicts):** in the browser (dev code `JA2026`) record two
conflicts for a judge on a panel and see a team come off it; record one for
a judge with no panel and see no block until you add them to a panel in
the Panels tab (which asks first); withdraw one; the Floor "Move to panel…"
list and the judge console both honour the block.

## Referee (direction C, "Team + history") — UI only

Today's behaviour: `FlagsTab` in `src/app/admin/page.tsx`, `FlagList` /
`FlagSummary` / the inline edit in `src/components/Flags.tsx`,
`MatchFields`, `src/lib/refereeHistory.ts` (repeat detection). Reuse the
referee console's pieces for the sheet (`src/components/referee/` —
`MatchSheet`, `SeverityButtons`) rather than copying them.

### Keep
- Counts per severity across the event (from `flagKinds`, worst first).
- The caption: "Recorded by referees on their own page. Judges see these
  against the teams they are judging; teams and the queue desk do not."
- Remove asks first ("Remove this flag? The judges will stop seeing it.").
- A correction can only produce values the referee's own form could
  (same match types for the ruleset, fields 1..N from the event setup,
  rules from the ruleset); legacy values on old flags are sent back as they
  are, as `FlagList` does today.
- Arriving from Scores' conduct link (`focusFlagTeam`) selects that team
  and scrolls it into view; it stays selected until you pick another team
  or leave the section.
- Empty state: "No referee has flagged anything yet."

### Layout (≥1024px)
- **Count strip** across the top: five big numbers with severity dots
  (Disqualified, Major violation, Minor violation, Warning, Good conduct),
  then the caption.
- **Left column (~340px), "Flagged teams":** one row per team with flags,
  sorted worst severity first, then most flags. Row: team number, name,
  the worst severity as a pill, and a flag icon + count. The selected row
  gets the accent bar and tint (as the rail). Default selection: the
  focused team if arriving from Scores, else the first row.
- **Right pane, the selected team:** number + name, tags (division, pit,
  panel), severity summary pills ("Minor ×1", "Warning ×1"). A caution
  box when a rule repeats, built from `refereeHistory`: "**Repeated.** GG17
  twice: Q12 (Warning), Q19 (Minor)". Then **History, newest first** as a
  vertical timeline: time on the left, a dot in the severity colour, and a
  card with severity pill, match · field, rule chips, a "Repeated" caution
  tag on the repeating rule, a neutral "Match affecting" tag when set, the
  note, the referee's name, and quiet Edit / Remove.

### Phone (<1024px)
The count strip becomes a 5-cell row; below it the flagged-teams list
(full width). Tapping a team opens its history as a full screen with a
back button (same content as the right pane). Arriving from Scores opens
that team directly.

### Correct flag sheet
Edit opens a `<dialog>` — a bottom sheet on a phone, a centred dialog at
≥1024px — titled "Correct flag · <team>", per
`reference-referee-edit-sheet.dc.html`: match type segment + match number,
field chips (from the event setup's field count), rule chips + "All rules"
picker, match-affecting switch (Minor and Major only, as the referee
console), note, and the five compact severity buttons.

**Behaviour change, on purpose:** severity buttons only **select**; a
pinned **"Save correction"** (accent) saves the whole correction. This
matches the referee console (select, then confirm) instead of today's
"tapping a severity saves". Under the button, muted: "Logged as a
correction by <admin name>". The PATCH body and the activity log entry
stay as today.

### Colour
Severity colours only on severity pills, dots and buttons; caution for
"Repeated"; accent for selection, focus and the save button. Use dark ink
on the Major (red) fill wherever white would fall under 4.5:1 at its text
size (it measures about 3.5:1 at 12px); check the same pill in the referee
console and fix it there too if it uses white.

### Tests (must fail if reverted)
Team ordering (worst first, then count); default selection with and
without `focusFlagTeam`; the repeat box text from `refereeHistory`;
severity buttons in the sheet don't save until "Save correction"; Remove
asks first and sends nothing when declined; phone list → team → back.

## Teams (direction B, "Table + team drawer") — UI only

Today's behaviour: `TeamsTab`, `EditableCell`, `StorageHealth`,
`DangerZone` in `src/app/admin/page.tsx`; `PATCH /api/admin/teams`;
`resetRequestStatus` (reopen / cancel / set-status, held to
`canTransition`).

### Keep
- Filter by number or name; Division and Notebook selects; "48 teams · 4
  panels".
- Auto-assign: "Max per panel" (1–40) + "Auto-assign N unassigned",
  disabled at 0; it works within each division and skips conflicted panels
  (after the Conflicts data phase: through `panelBlocks`).
- Notebook count chips; per-panel load chips, plus "Unassigned N" in
  caution.
- Editing number, name, pit, notebook and panel, with the server's refusals
  shown (duplicate number, conflicted panel, other division). The panel
  select offers only compatible panels without a block, plus "— none —".
- The interview status override, using `resetRequestStatus`'s action
  choice exactly as today, and asking first.
- Remove team asks first: "Remove team 9882K and all its requests?"
- Pit hint: "Pits read as a letter and a number (A1), which places a team
  on the board's floor plan."

### Layout (≥1024px)
- Toolbar, chips and helper line ("Select a team to edit its number, name,
  pit, panel and notebook.") as `reference-teams-wide.dc.html`.
- **Read-only table**: team, name, pit, notebook, division, panel (or a
  caution "Unassigned" pill / a danger "no panel left" pill when every
  compatible panel is blocked), booked time, interview status pill, flag
  pills (**severity colours**, as on the Referee tab — not caution).
  Rows are buttons: clicking one opens the drawer; the selected row gets
  the accent bar and tint. Keyboard: Enter/Space opens, Escape closes.
- **Drawer** (~368px, right side, pushes the table narrower rather than
  covering it) for the selected team, titled "Edit team · <number> <name>":
  - Team number + Pit side by side, Name; pit hint under them.
  - Division (read-only tag) and Booked (read-only).
  - Notebook select.
  - Judge panel select + helper "<division> panels without a conflict".
  - Interview: status pill + "Reset to…" select, and a caution box
    "Overrides what judges set. Use when a status is stuck." Choosing a
    value asks first, then applies immediately (it is not part of Save).
  - Flags: severity pills + "Open in Referee ↗" (switches to the Referee
    section with that team selected, like Scores' conduct link).
  - "Remove team" (danger-quiet) + "Asks first. Removes <n> and all its
    requests."
  - Pinned **"Save changes"** (accent) saves number, name, pit, notebook
    and panel together in one PATCH; disabled until something changed.
    Closing the drawer with unsaved changes asks first.

### Phone (<1024px)
Filter box + a "Filters" button (opens the division/notebook selects in a
sheet; badge shows how many are active) + Auto-assign. Rows become compact
two-line rows. Tapping a row opens the same editor as a bottom-sheet
`<dialog>` (`reference-teams-phone.dc.html`).

### Event data (bottom of Teams, collapsed)
A `<details>`-style section "Event data · Storage and resets", closed by
default, holding today's `StorageHealth` and `DangerZone` ("Reset the
day", "Wipe everything", both asking first), styled as the expanded state
in `reference-teams-event-data.dc.html`. **If storage is unreachable**, the
collapsed summary row turns danger-coloured and says "Storage is not
reachable" so the failure is never hidden; open it for the details.

### Tests (must fail if reverted)
Drawer opens from a row and saves all five fields in one PATCH; Save is
disabled with no changes; status override asks first and uses reopen /
cancel / set-status as today; Remove asks first; the panel select hides
blocked and other-division panels; the "no panel left" pill; Event data is
closed by default and turns danger when storage fails.

## Panels (direction B, "Roster board") — UI only

Needs the judge roster and `dryRun`/`takenOff` from the Conflicts data
phase. Today's behaviour: `PanelsTab`, `PanelCard`, `DeleteAllPanels` in
`src/app/admin/page.tsx`; `/api/admin/panels` (POST create, PATCH, PUT
presets, DELETE).

### Keep
- Add panel (name + division); "Add preset panels" with its caption
  ("Creates anything in config/event.json that is missing. Never
  overwrites a panel you already have.").
- Each panel's **judge sign-in code**, shown large with a Copy button.
- "Interviews in" language toggles; "Not stated — no request will be
  flagged." when none.
- Division change asks first ("Move Panel 3 to HS? Its MS teams become
  unassigned.").
- Booking slot grid: first slot start, minutes each, how many ("0 for
  walk-up queue only"), Save slot grid; header "Booking slots (8)" /
  "(off)".
- Delete panel asks first ("Delete Panel 3? Its teams become
  unassigned."). Deleting a panel sets its judges' `panel_id` to null; it
  never deletes judges or their conflicts.
- Delete all panels: two clicks (arm, then "Every judge code stops working
  immediately. Your teams stay, unassigned." with Delete all / Cancel).

### Layout (≥1024px)
- **Left column (~380px), "Judges · N"** with "+ New judge" (name + optional
  note; adds to the roster only, panel "— none —"). Rows grouped: "Not on a
  panel (n)" first, then one group per panel ("Panel 2 · MS (2)"). Each
  row: name, a neutral "N conflicts" pill (links to Conflicts with that
  judge selected), and a compact **Panel select** (— none — / Panel 1…N).
  Changing the select moves the judge:
  - run the `dryRun` first; if it reports `takenOff`, open the confirm in
    `reference-panels-add-judge-confirm.dc.html` — "Add Priya Nair to
    Panel 3?", "She has conflicts with 2 teams on Panel 3. Adding her takes
    them off it.", the team list with notes, caution "They'll need another
    panel.", Cancel (focused) / **"Add and take teams off"** (accent). On
    Cancel the select snaps back.
  - with nothing to take off, it saves at once (no confirm). Moving a
    judge to "— none —" also saves at once.
  - a row overflow "⋯" holds Rename and **Remove from roster** (asks first;
    if they have conflicts: "Removing Jordan Kim also withdraws 1
    conflict.").
- **Right: panel cards** (2-column grid): name, division tag, team count;
  code block + Copy; "Judges · set from the roster" (read-only names, or
  "No judges yet" in caution — a panel with no judges can't sign in
  anyone useful); languages toggles; a one-line slots summary ("8 slots
  from 10:00 · 20 min" / "Booking slots off") with **Edit** opening a small
  dialog holding the slot-grid fields; division select (asks first);
  Delete panel (danger-quiet).
- Under the cards: the Add panel form. At the bottom: Add preset panels +
  caption, and Delete all panels.

### Phone (<1024px)
A segmented control **Judges | Panels** at the top.
- **Judges** (`reference-panels-phone.dc.html`): helper "Pick a panel for
  each judge. A judge sits on one panel at most.", the grouped roster with
  a Panel select per row, "+ New judge" pinned at the bottom.
- **Panels** (not mocked): the same panel cards stacked full width, then
  Add panel, presets and Delete all at the end.

### Tests (must fail if reverted)
Roster grouping (not on a panel first, then by panel order); moving a
judge with `takenOff` opens the confirm and Cancel restores the select
and sends nothing; moving without `takenOff` saves directly; "+ New
judge" adds with no panel; Remove from roster asks first; Delete panel
leaves its judges in the roster with no panel; the two-click Delete all.

## Import (direction A, "One box")

Today's behaviour: `ImportTab` in `src/app/admin/page.tsx`,
`readSpreadsheet` (`src/lib/spreadsheet.ts`), `POST /api/admin/teams`
(`parseTeams` / `splitRow` in `src/app/api/admin/teams/route.ts`).

### Keep
- Choose a file (.xlsx .csv .tsv .txt), drag-and-drop onto the box, or
  paste — all land in the same mono textarea. After a file loads, the
  info line "Loaded <file> · N rows".
- Format: `number, name, pit, division` (optional fifth column: notebook
  type, as today). Tabs work; a header row is skipped; re-importing
  updates teams instead of duplicating them; a blank division falls back
  to the first configured one.
- "Spread across panels evenly" + "max N per panel" (disabled when off).
- Import is disabled while the box is empty and reads "Importing…" while
  busy.

### Layout
Per `reference-import-wide.dc.html`: a **format card** (the format line
in mono on the left, three short bullets on the right: division per team,
pit like A1, re-importing updates), then the **drop-zone card** (Choose a
file + "or drag one here · .xlsx .csv .tsv · or paste below", the
textarea; the whole card shows the accent dashed border while dragging),
the info line, the options row with **Import** (accent) on the right,
then the result. Phone (`reference-import-phone.dc.html`): the same,
stacked, Import full width.

### Result (small API change)
- `POST /api/admin/teams` returns, in addition to today's fields,
  `created` and `updated` counts (an existing team number is an update)
  and `skippedLines: { line: number; text: string; reason: string }[]`.
  `parseTeams` records the reason instead of only counting:
  - "no team number" (blank first cell),
  - "no digit in the team number" (header-like),
  - "team number has characters other than A–Z, 0–9 and -".
  The **first line** being skipped for having no digit is a header row:
  skip it silently (not reported), as today. Keep `skipped` for
  compatibility.
- Success box (done green): "Imported **46 teams**, 12 new · 34 updated ·
  assigned 9 to panels." (the "assigned" part only when auto-assign was
  on).
- When lines were skipped, a caution box under it: "**2 lines skipped**"
  and one entry per line: "Line 17 · no team number".

### Tests (must fail if reverted)
`parseTeams` reports each skip reason with its line number and doesn't
report a header row; the route returns `created` / `updated`; the UI shows
both boxes; Import stays disabled on an empty box.

## Scores (direction C, "Ranked + compare") — UI only

Today's behaviour: `Rankings.tsx`, `rankTeams` in `src/lib/ranking.ts`,
`bandFor` / `rubricsFor` / `totalFor` in `src/lib/rubrics.ts`,
`useScores` (only while Scores is open).

### Keep
- Ranking order from `rankTeams`: scored first, then points (not percent),
  then team number; unscored teams last with rank "—" and "not scored".
- Each team totalled and banded against the rubrics its category is
  judged on (Ungraded: notebook "excluded", total /12).
- Conduct → Referee with that team selected (`focusFlagTeam`).
- "N of M scored" and the band legend (Top ≥85%, Strong ≥70%, Middle
  ≥50%, Emerging).

### Layout (≥1024px), per `reference-scores-wide.dc.html`
- Title row: "Scores", "Showing N teams · S of M scored", band legend.
- **Filter chips** (new, client-side): Notebook (All / each category) and
  Division (All / each division). Filters narrow the list; rank numbers
  stay the event-wide rank (so "4" means 4th overall even when filtered).
- **Left (~440px): ranked list.** Row: checkbox, rank, team number +
  name, total "/max", band pill, and the team's **worst conduct pill** (if
  any; DQ must be visible without opening anything). Unscored rows are
  muted and their checkbox is disabled. Clicking the row (not the
  checkbox) opens the team sheet. Header: "N selected · Compare" and
  "Clear".
- **Compare is two teams.** Once two are ticked, the other checkboxes are
  disabled (with a title "Compare two at a time"); un-ticking one frees
  them. With fewer than two ticked (including on first load), the right
  side shows a quiet hint: "Tick two teams to compare them".
- **Right: compare panel** for the two teams: header per team (number,
  name, "Rank 2 · Panel 2"); Total + band + percent (one decimal); then
  for each rubric the rubric total and **one row per rubric section**
  (section subtotals computed client-side from `ScoreRow.values` and the
  rubric's `sections`), higher value bold, ties not bold, "excluded" for an
  out-of-scope rubric; Notes: "3 notes" + "Open team sheet" (fetch the two
  teams' notes with the existing `/api/notes?teamId=`); Conduct: severity
  pills linking to Referee, or "None".

### Phone (<1024px), per `reference-scores-phone.dc.html`
Filters behind a "Filters" button (badge only when a filter is on); the
ranked list with checkboxes; when two are picked a pinned bar "2 selected ·
**Compare**" opens the compare panel as a full-screen view with a back
button (same content, two narrow columns).

### Team sheet for the whole console
Replace `NotesDrawer` on this console with the judge console's
`TeamSheet` (`src/components/judge/TeamSheet.tsx`) — Notes · rubric
segments, flags — opened from Scores rows, the compare panel, Floor's
"Notes" and the Teams drawer's flags area. The Judge Advisor can read and
score exactly as with the drawer today (same APIs). If `TeamSheet` needs
the judge console's chrome or judge-only props, extract what both need
rather than copying it. When nothing uses `NotesDrawer` any more, delete
it.

### Tests (must fail if reverted)
Filters narrow the list but keep overall rank numbers; a third checkbox
is disabled while two are ticked; section subtotals match the stored
values; the higher value per row is bold and ties aren't; the worst
conduct pill shows on the row; rows open the team sheet (not the old
drawer).

## Rules

- Colour is signal (top of `globals.css`): status colours only for status;
  caution for language gaps and conflict warnings; accent for interactive
  chrome (current section, selected chip, focus, links). Don't introduce
  new hues. One new token is allowed: the accent tint for the current rail
  item (`--accent` at ~14%).
- Light theme must work, from the existing tokens (mocks are dark only).
- No playful motion. Touch targets ≥44px on phone, ≥32px on desktop.
- Page-scoped styles (e.g. `.ja` / `.ja-*`) appended after the existing
  blocks in `globals.css` (`theme.test.mjs` and `mobile.test.mjs` read it).
- Never `window.confirm`; use `useConfirm()`.

## Tests (must fail if the change is reverted)

- A pure test for the Floor's per-panel grouping and order (interviewing,
  on the way, requesting by wait, booked by slot), the load line, the
  allowed-reassign list (division + conflicts + current), and the
  language-gap check per panel.
- A runtime render test in the style of `tests/judgePage.runtime.test.tsx`:
  the rail marks Floor current with the requesting badge; a requesting card
  has "On our way"; "⋯" → "Move to panel…" lists only allowed panels;
  Cancel asks first and sends nothing when declined; the phone menu opens
  and picking a section switches it.
- Keep every existing test green. Run `npm test`, `npm run typecheck`,
  `npm run lint` (0 warnings), `npm run build`.

## Done when

- `/admin` Floor matches the mocks at 1280 and 375 in dark, and looks right
  in light; every other tab still works inside the new shell.
- Checked in the browser (dev code `JA2026`): rail and phone menu switch
  sections; advance, move to another panel, cancel with confirm, open
  Notes; the language-gap pill and warning appear for a request in a
  language its panel does not cover.
- One local commit on `version-2.0`. No push.
