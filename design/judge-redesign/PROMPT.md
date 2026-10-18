# Judge console redesign (direction A, "Up next") — implementation prompt

Paste everything below the line into a Claude Code session opened in this repo
(or say: "Implement design/judge-redesign/PROMPT.md").

---

Redesign the judge console `/judge` (`src/app/judge/page.tsx`) as the
approved direction A, "Up next". The design is final; match it, don't
redesign it. Work on the `version-2.0` branch. This is a **UI-only** change:
no store, schema or API changes. One commit.

## Sources

- **Visual spec:** static mocks, dark theme, 375 wide, in
  `design/judge-redesign/`:
  - `reference-up-next.dc.html` — Queue tab, a team is waiting (1100px
    full-scroll capture)
  - `reference-interviewing.dc.html` — Queue tab mid-interview, with the
    waiting alert row
  - `reference-sheet-notes.dc.html` — team sheet, Notes segment
  - `reference-sheet-rubric.dc.html` — team sheet, Interview rubric segment
  - `reference-scores.dc.html` — Scores tab (panel ranking)
  - `reference-today.dc.html` — Today tab (slot timeline)
  These are self-contained HTML mocks (custom `{{hole}}` template, not
  React). Read their `<style>` blocks for sizes, spacing and colours and
  their markup for structure and copy. The team data in them is sample data.
- **Live canvas:** https://claude.ai/artifact/Nhv45XWtvnnjLwCC768jWc, row
  "Judge console · A · Up next".
- **The pattern to copy:** the referee console redesign already built the
  same kind of phone shell. Read `src/components/referee/RefereeFrame.tsx`
  and the `.referee` / `.rf-*` block in `src/app/globals.css` first, and
  follow the same approach (a frame component, page-scoped classes, native
  `<dialog>` for sheets, `useConfirm()` from `src/components/ConfirmDialog.tsx`
  for confirmations, never `window.confirm`).
- **Today's behaviour lives in:** `src/app/judge/page.tsx`,
  `src/components/judging.tsx` (NotesDrawer, SignOutButton),
  `src/components/ScoreSheet.tsx`, `src/components/Rankings.tsx`,
  `src/lib/status.ts`, `src/lib/rubrics.ts`, `src/lib/data.ts`
  (`buildSlots`, `liveRequestFor`), `src/components/Flags.tsx`.

## Keep (behaviour that must not regress)

- Session gate: non-judge/non-admin → `/judge/login`. An admin who opens
  `/judge` still gets the "use the Judge Advisor console" notice (restyle it
  into the new frame).
- `advance()` / `summon()` guards: the synchronous `writing` ref against
  double taps, `from: request.status` on PATCH (409 on a stale screen), the
  button label switching to "Saving…" / "Adding…" while busy.
- Queue order inside a status: longest wait first, then team number.
- Scores are totalled per category with `rubricsFor` + `totalFor`
  (Ungraded excludes the notebook; say so on the sheet, as today).
- Notes are private to judges and the Judge Advisor (keep that line).
- Each rubric tap saves (ScoreSheet's per-tap save and "clear" stay).
- Polling via `useAppState(4000)` and `useScores()`.
- **The admin console** (`src/app/admin/page.tsx`) also uses `NotesDrawer`
  and `Rankings`. Its look and behaviour must not change in this task (it
  gets its own redesign later). Share logic, not markup: if you need the
  ranking order or the score-loading code, reuse/extract it rather than
  copying it.

## The design

### Chrome (every tab) — `JudgeFrame`
- Top bar: judge avatar `public/avatars/judge.jpg` (28px, rounded, ring in
  `--accent`), "Judge" + the judge's name, Live dot (the `online` state),
  Sign out (→ `/judge/login`). **No referee stripe.**
- Panel bar: small caps "Your panel", panel name big (Archivo), division tag,
  and "N/M interviewed" on the right.
- Bottom tab bar: **Queue** (badge = number of teams in `requested`, orange,
  hidden at 0), **Scores**, **Today**. Same icon style and active indicator
  as the referee tab bar, but the active colour is `--accent` (judge role
  colour), not the referee orange.

### Queue tab
- **Hero card ("Up next")** — picked by a pure function
  `pickHero(cards)` in a new `src/lib/judgeQueue.ts`:
  1. a team in `interviewing`, else
  2. a team in `acknowledged` (on the way), else
  3. the longest-waiting `requested` team, else
  4. the next `scheduled` slot (earliest `slot_start`), else none.
  Every other team goes in the list below. (This changes today's rule,
  where a waiting team always sorts first: while judges are with a team,
  that team is the hero, and waiting teams are surfaced by the alert row.)
- Hero content: eyebrow ("Up next" / "On the way" / "Now interviewing"),
  status chip, team number (Archivo ~40px), name, category, language, pit,
  wait/slot time, score total + band chip, referee flag summary + one-line
  flag text, the team's message (quoted, sunken box). Card tint follows the
  status: waiting = `--waiting` 12% fill + 45% ring, interviewing = the
  `--active` equivalent, others neutral surface.
- **Primary action**: full width, 56px. Its fill is the colour of the status
  it moves the team TO: "On our way" → `--enroute`, "Start interview" →
  `--active`, "Finish interview" → `--done` (with the matching `-ink`).
  Same rule for the compact 44px action buttons in list rows.
- Secondary: "Notes & scores" (outline) opens the team sheet. While
  interviewing it becomes the larger two-line "Open team sheet" button (see
  `reference-interviewing`). "Cancel request" is a quiet text button and now
  **asks first** via `useConfirm()`.
- **Waiting alert row** (only when the hero is NOT a waiting team and ≥1 team
  is `requested`): orange-tinted row "N teams waiting · 9882K 8 min, …" with
  a "View" link that scrolls to the Waiting section.
- **List sections**, in this order, each with a small caps header + count
  and a status dot: **Waiting**, **With us** (on the way / interviewing, if
  not the hero), **Booked** (time chip; "in N min" when due within 10 min),
  **Not in queue** ("+ Add to queue" 44px ghost button), **Done** (collapsed
  `<details>` listing the team numbers). Empty sections are omitted.
- A list row: team number (Archivo 20px), name (truncated), meta line
  (category · pit, or waiting time in orange), right-aligned action or a
  chevron. Tapping the row (not the action button) opens the team sheet.
- No teams on the panel: keep today's notice, restyled.

### Team sheet (replaces NotesDrawer on this page only)
- Native `<dialog>` bottom sheet, nearly full height, grab handle, close X,
  Escape closes. Header: team number + name + "category · language · pit",
  total "N / M" + band chip. Muted "Private to judges and the Judge
  Advisor." and the Ungraded note when it applies.
- Segmented control (two-line buttons): **Notes** (count) | one segment per
  rubric with its score "22/64", or "not scored".
- **Notes**: referee flags for the team (caution style: kind · rules ·
  match — reported by name), then notes newest first (author · time, body),
  then a pinned composer: 3-row textarea "Add a note for the panel…" and a
  full-width "Save note" button (accent fill: it's chrome, not a status).
- **Rubric segment**: sections with subtotals; each criterion shows its
  text, then a full-width row of big scale buttons (≥48px; 0/1/2 for the
  interview, 1–4 for the notebook) with the selected one in accent, and the
  selected label underneath in muted text (labels from `config/rubrics.json`,
  e.g. "Heard, with Specifics"), or "Not scored". Footer line: "Saved · each
  tap saves" and a quiet "Clear <rubric> scores" (asks first).

### Scores tab
- "<Panel> ranking", "N of M scored", band legend chips (Top ≥85%, Strong
  ≥70%, Middle ≥50%, Emerging).
- Ranked rows: rank, team number, name (+ "notebook only" when the interview
  is unscored), flag chip when the team has flags, total "/max" + band chip,
  chevron → team sheet. Unscored teams last with "—" rank and "not scored".
- Ranking order = what `Rankings.tsx` uses today (points). Reuse that logic.

### Today tab
- "Today's slots", "Panel · N min each", "N of M booked".
- Timeline from `buildSlots`: time column + card. Booked slot: team number +
  name + status chip (Complete / Booked / In progress / etc. from
  `STATUS_META`), "in N min" when due soon; open slot: dashed "Open"; past
  open slots dimmed. A static "NOW hh:mm" rule at the current time
  (recomputed on each poll; no animation).
- Teams completed before the first slot shown can collapse into one line as
  in the mock.

## Rules

- Colour is signal (see the top of `globals.css`): status colours only for
  status, caution for referee flags, band colours for score bands, accent
  for interactive chrome only. Don't introduce new hues; orange (waiting)
  and violet (active) mean only that.
- Use the existing theme tokens so **light theme works too** (the mocks are
  dark only; derive light from the same tokens, as the referee page did).
- No playful motion: no animation besides existing quiet loading feedback.
- Touch targets ≥44px. Real `<button>`s, labelled icon buttons, focus rings.
- Page-scoped styles (e.g. `.judge` / `.jg-*`) in `globals.css`, like
  `.referee` / `.rf-*`.

## Tests (must fail if the change is reverted)

- `tests/judgeQueue.test.mjs`: `pickHero` for each rule (interviewing beats
  waiting; acknowledged beats waiting; oldest waiting; next booked slot;
  none) and the section grouping.
- A runtime render test in the style of `tests/refereePage.runtime.test.tsx`:
  the hero shows the waiting team with "On our way", the Queue badge count,
  the alert row appears when interviewing with teams waiting, Cancel asks
  first.
- Keep every existing test green. Run `npm test`, `npm run typecheck`,
  `npm run lint` (0 warnings), `npm run build`.

## Done when

- `/judge` matches the six mocks at 375px in dark, and looks right in light.
- Checked in the browser (dev panel code `ALPHA1`, 375px mobile
  preset): advance a team through On our way → Start interview → Finish,
  add a team to the queue, cancel with confirm, save a note, score a
  criterion, open Scores and Today.
- `/admin` looks and behaves exactly as before.
- One local commit on `version-2.0`. No push.
