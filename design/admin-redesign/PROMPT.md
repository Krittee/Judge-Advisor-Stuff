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

More tabs will be added below as they are designed. Tabs that have no
section here yet keep their current content, just rendered inside the new
shell.

**Commits, in order:** (1) shell + Floor; (2) Conflicts data; (3) Conflicts
UI; (4) Referee. Each is one local commit with every check green. If you are only asked
to do part of this file, do the parts in that order.

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
  These are self-contained HTML mocks (custom `{{hole}}` template, not
  React). Read their `<style>` blocks for sizes, spacing and colours and
  their markup for structure and copy. Team data in them is sample data.
- **Live canvas:** https://claude.ai/artifact/Nhv45XWtvnnjLwCC768jWc, row
  "Judge Advisor · Floor" (A chosen) and "Judge Advisor · Conflicts (by
  judge)" (C chosen) and "Judge Advisor · Referee" (C chosen). Boards marked "Not chosen" are exploration only.
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
- NotesDrawer for the admin (until the Scores/Teams redesign replaces it),
  opened from Floor's "Notes".
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
- **Panels tab (until its redesign):** saving a panel's judges asks first
  when `dryRun` reports `takenOff` ("Adding Priya Nair takes 9882K off
  Panel 2 — she has a conflict with them."), then saves.

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
