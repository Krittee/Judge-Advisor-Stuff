# Judge Advisor console redesign — implementation prompt

Paste everything below the line into a Claude Code session opened in this repo
(or say: "Implement design/admin-redesign/PROMPT.md").

---

Redesign the Judge Advisor console `/admin` (`src/app/admin/page.tsx`) on
the `version-2.0` branch. The design is final; match it, don't redesign it.
This is a **UI-only** change: no store, schema or API changes.

The console is being designed **tab by tab**. This file covers:

1. **The shell** — top bar, grouped side rail, phone menu. Applies to every
   tab, including the ones not redesigned yet.
2. **Floor** (direction A, "Panel board").

More tabs will be added below as they are designed. Tabs that have no
section here yet keep their current content, just rendered inside the new
shell. Do the shell and Floor as **one commit**.

## Sources

- **Visual spec:** static mocks, dark theme, in `design/admin-redesign/`:
  - `reference-floor-wide.dc.html` — 1280 wide: rail + Floor panel board,
    with the "Move to panel…" popover open on 5150Z
  - `reference-floor-phone.dc.html` — 375 wide: Floor with the panel
    switcher (full-scroll capture)
  - `reference-phone-menu.dc.html` — 375 wide: the Sections menu sheet
  These are self-contained HTML mocks (custom `{{hole}}` template, not
  React). Read their `<style>` blocks for sizes, spacing and colours and
  their markup for structure and copy. Team data in them is sample data.
- **Live canvas:** https://claude.ai/artifact/Nhv45XWtvnnjLwCC768jWc, row
  "Judge Advisor · Floor" (A chosen; B and C are marked Not chosen).
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
