# Awards board (v2.2, direction C4 "Matrix + By award") — implementation prompt

Paste everything below the line into a Claude Code session opened in this repo
(or say: "Implement design/awards-redesign/PROMPT.md").

---

Add **awards** to Judge Queue. Judges nominate teams they interviewed into
award categories, and the Judge Advisor sees every nomination on a new
**Awards** board and decides the winners. The design is final: match it,
don't redesign it. Work locally on top of `version-2.0` (on the branch the
user names for v2.2). This is **data + API + UI**. Never push.

## Sources

- **Visual spec:** static mocks in `design/awards-redesign/`. Each draws the
  same screen twice: dark above, light below. Light must work as well as dark.
  - `reference-awards-board.dc.html`: the JA board at 1280. On the left is
    the **Matrix** view and on the right the **By award** view, with the
    Excellence × 7700B side panel open in both.
  - `reference-judge-nominate.dc.html`: the judge at 375. On the left is the
    Queue right after an interview finishes, with the award chips. On the
    right is the Queue later, where each Done row lists its nominations with
    Edit / Nominate.
  These are self-contained HTML mocks (a custom `{{hole}}` template, not
  React). Read their `<style>` blocks for sizes, spacing and colours, and
  their markup and `renderVals()` data for structure and copy. The event in
  them is sample data: Middle School, Panel 2 (Sam Rivera, Priya Nair) and
  Panel 3 (Lena Ortiz, Ken Ito), and 18 nominations for 9 teams.
- **Live canvas:** https://claude.ai/artifact/Nhv45XWtvnnjLwCC768jWc, row
  "Awards board (v2.2) · C", artboards **C4** (the JA board) and
  **C · judge nominates**. Rows A and B and the C, C2 and C3 JA boards
  were not chosen; ignore them.
- **Patterns to copy:**
  - The JA console shell in `src/components/admin/AdminFrame.tsx`
    (`SECTION_GROUPS`, `railCounts`) and the `/* @ja-block <name> */` CSS
    blocks (`tests/adminCssScope.test.mjs`).
  - The Scores tab (`ScoresTab.tsx`, `scoresLogic.ts`) for filters and the
    compare panel.
  - The judge console in `src/components/judge/` (`QueueTab.tsx` hero and
    Done section, `TeamSheet.tsx` `<dialog>` sheet, `logic.ts`).
  - The notes route `src/app/api/notes/route.ts` for scoping (`canReadNotes`,
    `refuseIfOutOfScope`, `blockedTeams`/`loadBlocks` for conflicts).
  - The store in `src/lib/db/` (`types.ts` interface, `file.ts`,
    `postgres.ts`, `tests/storeConformance.runtime.ts`).

## The awards (config)

Add `awards` to `config/event.json`, in this order. It is also the
presentation order. Ids are stable once used, and labels can be renamed:

| id | label | short | blurb |
|---|---|---|---|
| excellence | Excellence | Exc | Overall excellence in the Engineering Notebook, Team Interview and competition performance. |
| design | Design | Des | An organized, student-driven Engineering Design Process. |
| innovate | Innovate | Inn | A novel, well-documented part of the robot design or gameplay strategy. |
| think | Think | Thk | Coding, programming and software development. |
| amaze | Amaze | Amz | A highly capable, competitive, consistently performing robot. |
| build | Build | Bld | Robot construction, craftsmanship, reliability and attention to detail. |
| create | Create | Cre | A creative engineering solution to this season's game. |
| judges | Judges | Jdg | Qualities worth recognising that may not fit another award. |
| inspire | Inspire | Ins | The passion, enthusiasm and spirit of the program. |
| sportsmanship | Sportsmanship | Spt | Respect, professionalism, fairness and positive conduct all event. |
| energy | Energy | Enr | Enthusiasm, excitement, positivity and spirit that lift the event for others. |

Parse it the way the other config lists are parsed, and reject duplicate
ids. Send `awards` (id, label, short, blurb) to judges and the JA only.

## Data

- **Nomination**, one per judge:
  `{ id, award_id, team_id, panel_id, judge (the session name, like a note's author), reason: string | null, created_at, updated_at }`.
  - **Key:** unique on (award_id, team_id, panel_id, judge). Two judges on
    one panel nominating the same team is "2 judges".
  - **Removed with:** a team that is deleted. A deleted panel sets
    panel_id to null, as scores do.
- **Winner**:
  `{ award_id, division, team_id, decided_by, decided_at }`, unique on
  (award_id, division). Awards are decided **per division** (divisions are a
  hard wall).
- Add both to the store interface, the file store and Postgres (tables plus
  indexes, in the same style as `scores`), with conformance tests.
- **Never put either in `/api/state`.** That payload goes to teams, the
  desk and the public board, and winners must stay secret until the
  ceremony. Serve them from their own routes.

## API (`/api/awards`)

- **GET:**
  - The **JA** gets every nomination plus the winners.
  - A **judge** gets their own panel's nominations only, without winners
    and without other panels.
  - **Anyone else** gets 403.
- **POST** `{ awardId, teamId, reason? }` (judge only) nominates as the
  signed-in judge. Refuse when any of these hold:
  - the team is not on the judge's panel
  - the team has no completed interview (`completedTeamIds`)
  - the team is conflicted for this panel (`blockedTeams`)
  - the award id is unknown

  Re-posting is idempotent. A reason of at most 500 characters may be
  added or changed.
- **DELETE** `{ awardId, teamId }` (judge only) withdraws your own
  nomination.
- **PUT** `/api/awards/winners` `{ awardId, division, teamId }` (JA only)
  sets or replaces the winner. The team must be in that division and
  nominated for that award. **DELETE** `{ awardId, division }` clears it.
- Log every write in Activity under a new kind `award` (add it to
  `ActivityKind`, `KIND_NAMES` "Awards"). Example entries: "nominated 7700B
  for Excellence", "withdrew…", "gave Design to 2088C", "cleared Design".
  The Activity tab is JA-only, so winners don't leak.
- Rate limits and body limits follow the existing write routes.

## The design

### JA: Awards board (`reference-awards-board`)

- **Rail:** a new **Awards** item under Results, between Scores and
  Activity, with a trophy icon and the count "3/11" (awards decided in the
  selected division).
- **Header:**
  - The title "Awards", then the meta line "Middle School · all panels ·
    3 of 11 decided · 18 nominations for 9 teams".
  - At the right, a muted lock line: "Winners stay private to you until
    the ceremony".
- **Filter bar:**
  - **Division** chips (ES/MS/HS/Blended, from `divisions`, each with
    "decided/11").
  - **Panel** chips: "All panels" (the default, combined) plus one chip
    per panel in that division.
  - At the right, the **Matrix | By award** segmented toggle. Remember the
    choice per viewer in `localStorage`, wrapped in try/catch.
- **Matrix view:**
  - **Rows:** only teams with at least one nomination, sorted by
    nomination count, then team number. Each row shows the team number, the
    name (or "Has Amaze" in green text when the team won something), and a
    panel tag (P2).
  - **Columns:** only awards that have at least one nomination. The header
    is the short name in an `<abbr title>` with the full name, and a green
    tick under it when the award is decided. Under the table, a note names
    any hidden column: "Energy has no nominations yet, so its column is
    hidden."
  - **Cells:** a plain ink dot means nominated (no counts in the cell), a
    green filled tick means winner, and an empty cell means not nominated.
    A cell is a button that opens the side panel, and the selected cell gets
    an accent ring.
- **By award view:**
  - A two-column grid of award panels in config order, every award shown.
  - **Each panel's header:** the name and "Decided" (green) /
    "2 nominees" / "Open".
  - **Rows:** number, name, a caution icon when the team already won
    another award, the panel tag, "1 judge" or "2 judges", and a Winner chip
    on the winner (green tint row).
  - "No nominations yet" when the award is empty. A row is a button that
    opens the side panel, and the selected row gets an accent tint plus a
    left bar.
- **Side panel** (340px, the same in both views):
  - **Header:** the eyebrow "Excellence · Middle School", then the team
    number and name, then "Notebook 55/64 · Interview 11/12 · 66/76" with
    the band pill.
  - **Why Panel N nominated them:** each judge's name and quoted reason
    ("No reason given" when empty).
  - **Also nominated for …:** referee flags, with "Good conduct ×N"
    green and the worst caution amber, or "No referee flags".
  - **Other nominees for this award:** each with "1 judge", plus the
    caution "Already has Amaze" when it applies.
  - **The button:** primary, "Give Excellence to 7700B", and under it
    "You can change it until the ceremony."
  - **On the winner:** a green "Winner" chip and a quiet "Clear winner"
    link instead of the button.
  - **Confirms:** replacing an existing winner, or clearing one, asks first
    with `useConfirm()` ("Give Design to 7700B instead of 2088C?").
- **"Already has …"** is a caution, not a block: the JA decides.
- **Phone** (JA console at 375): use the console's phone pattern. The
  Matrix scrolls horizontally inside its own box with the team column
  sticky. By award is one column. The side panel becomes a bottom sheet.
  This is not mocked; follow the Scores tab's phone layout.

### Judge: nominate (`reference-judge-nominate`)

- **Right after the interview:** when the judge finishes an interview (the
  existing Finish advance), the Queue hero becomes a green-tinted
  **"Interview finished · 10:58"** card with a "Complete" chip, the team
  number and name, and "Nominate 7700B for an award?" with "Each tap
  saves. The Judge Advisor decides."
- **The chips:** 11 award chips in a two-column grid, 46px tall. Pressed
  means *your* nomination: accent fill and a check. Each tap POSTs or
  DELETEs at once. On failure, show the error banner and revert the chip.
- **The buttons:**
  - **Done** (ghost) collapses the card. Keep that per team in memory and
    don't store it.
  - **Add a reason** opens a small sheet (`<dialog>`, as `TeamSheet`
    does) with one optional textarea per pressed award.
- **What goes on as usual:** waiting teams stay below the card as today.
  When another team requests a judge, the normal hero takes over and the
  nominate card moves into the Done row.
- **Done section:** each completed team row shows its panel's nominations
  on one line with a trophy icon ("Excellence ×2 · Design", where ×2 means
  two judges) and an **Edit** link, or "No nominations" with **Nominate**.
  Either link opens the same chip grid in a bottom sheet.
- **Rules for judges:**
  - Only completed, non-conflicted teams on your panel can be nominated.
  - Judges never see winners or other panels' nominations.

## Rules

- **Colour is signal:**
  - Green means winner and decided.
  - Amber caution means the team already holds an award or has a referee
    caution.
  - Accent blue is for buttons, toggles, pressed chips and the selected
    cell only.
  - The nomination dot is ink, with no hue.
- **Tints:** `color-mix(in srgb, …)`.
- **No motion:** hover and focus colour transitions only, and none under
  `prefers-reduced-motion`.
- **Sizes and access:** touch targets of at least 44px (matrix cells
  38×44), text contrast of at least 4.5:1, and no horizontal page scroll at
  375 (only the matrix box scrolls).
- **Accessibility:** cells and rows are real buttons with labels such as
  "7700B, Excellence: nominated" / "…: winner". The toggle and chips use
  `aria-pressed`.
- **Copy:** the award names, blurbs and short names come from config, not
  from the code.

## Tests (must fail if the change is reverted)

- **Config:** `awards` parses in order and duplicate ids are rejected.
- **Store conformance** (file and Postgres SQL):
  - nominate is idempotent and the reason updates
  - withdraw works
  - one winner per (award, division), and a replacement takes its place
  - deleting a team removes its nominations
- **Route scoping:**
  - A judge can't nominate a team on another panel, a team that isn't
    interviewed yet, or a conflicted team.
  - A judge's GET never contains winners or other panels' nominations.
  - Only the JA can set or clear winners, and a winner must be a
    nominee in that division.
  - `/api/state` contains no nominations and no winners.
- **Pure logic:**
  - matrix rows and columns (nominated only, hidden empty columns, sort
    order)
  - "already has" detection
  - per-division decided counts
- **Runtime renders:**
  - The Matrix | By award toggle swaps the views and both open the same
    side panel.
  - Replacing a winner asks through `useConfirm`.
  - The judge chip grid appears after Finish, a tap saves, and the Done
    row lists the nominations.
- **Checks:** keep the existing suites green, and `npm test`,
  `npm run typecheck`, `npm run lint` (0 warnings) and `npm run build`
  all pass.

## Open questions for the user (ask, don't decide)

1. Can a team win only one judged award (so "Already has …" should block
   instead of warning), and is Excellence an exception?
2. Do Excellence, Design or others require a Fully Developed notebook? If
   so, should the board flag ineligible nominees?
3. Should referees (or the head referee) also nominate for Sportsmanship
   and Energy, beyond showing Good conduct flags?

## Done when

- `/admin` → Awards matches `reference-awards-board` at 1280 in dark and
  light (both views and the side panel), and works at 375.
- The judge console matches `reference-judge-nominate` at 375 in dark and
  light.
- Checked in the browser on a copy of the data:
  - a judge finishes an interview, nominates with taps and adds a reason
  - a second judge on the panel makes it "2 judges"
  - the JA sees it in both views and gives the award, and the matrix
    shows the tick
  - replacing the winner asks first
  - a judge's network responses carry no winners
- Local commits only, on the v2.2 branch. No push.
