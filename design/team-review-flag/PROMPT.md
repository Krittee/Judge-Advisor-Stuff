# Team review flag: mark a team for review (v2.2.4)

Chosen direction: **B · Mark with a reason** (canvas row "v2.2.4 · Team
review flag · B"). Reference boards in this folder: `reference-phones.dc.html`
(judge queue, judge team sheet while marking, JA Teams at 375) and
`reference-ja-wide.dc.html` (JA Teams page + drawer at 1280).

## Why

The user: "I need a flagged team from judge -> make a small arrow for the
judge and JA to be able to flag the team where it's marked for maybe
investigation." A judge who sees something worth a closer look (pit answers
that don't match the notebook, a robot that looks adult-built) needs one
quiet way to put it in front of the Judge Advisor, with a line saying why.

## Naming (do not mix up)

"Flags" already means **referee conduct flags** (`FlagRow`, `/api/flags`,
the Flags column, severity colours). This feature is the **review mark**:
UI words "Mark for review", "Marked for review", "For review". Code names
`ReviewMark`, `reviewMarks`, `review_marks`, `/api/review-marks`. Its glyph is
a **pennant** (pole + triangle), not the referee's rectangular flag, and its
colour is the **caution** amber (`--warn`, `--caution-*` / the app's caution
tokens), never a severity or status colour.

## Decided with the user (2026-11-24)

- **One mark per team**, with an **optional one-line reason**.
- **Who sets it:** a judge, for a team in **their own panel** only (same rule
  as notes and nominations), and the JA, for any team.
- **Who clears or edits it:** the **judge who set it**, or the **JA**. Other
  judges on the panel see it read-only.
- **Who sees it:** judges (own panel's teams) and the JA only. Never the team,
  the queue desk, referees, head referee, Coordinator or Marketing.

## Goals / non-goals / anti-goals

- Goal: a judge marks a team from the team sheet in two taps (+ optional
  reason); the JA sees every marked team at the top of the Teams page.
- Goal: refused by the API for any role or team not allowed (403), and
  absent from `/api/state` for those roles.
- Non-goal: per-judge marks or counts (option C); a history of past marks;
  notifying anyone; a mark on the referee side.
- Anti-goal: anything that looks like a referee flag; any motion; showing the
  mark to the team.

## Data model

```ts
// src/lib/types.ts
export type ReviewMark = {
  team_id: string;          // primary key: one mark per team
  reason: string | null;    // trimmed, ≤ 140 chars, "" → null
  set_by: string;           // judge or JA display name
  set_by_role: "judge" | "admin";
  set_at: string;           // ISO instant (updated on edit)
};
AppState.reviewMarks: ReviewMark[];
```

Storage follows the store pattern: `src/lib/db/types.ts` (`Store`), the JSON
file store and `src/lib/db/postgres.ts` (`review_marks` table, `team_id text
primary key references teams(id) on delete cascade`, created in `migrate()`).
Removing a team, wiping event data and the Middle School mover must not leave
a mark pointing at nothing.

## API

`/api/review-marks`:
- `PUT { teamId, reason? }`: set or edit. Judge: team must be in their panel;
  if a mark exists and was set by someone else, 403 (read-only for them).
  JA: any team, may edit any mark; whoever saves becomes `set_by`, so the
  strip always names who last wrote the reason.
- `DELETE { teamId }`: clear. Judge: only a mark they set, on their panel's
  team. JA: any.
- Every other role, or signed out: 403.

`/api/state`: `reviewMarks` = all marks for the JA; the judge's own panel's
teams' marks for a judge; `[]` for everyone else.

## Screens

### Judge team sheet (phone; reference-phones, frame b)

- Under the "Private to judges and the Judge Advisor." line, a small
  outlined button **"Mark for review"** with the pennant (≥44px tall).
- Tap → an inline box: label "Reason (optional)", one-line input
  (placeholder "What should the JA look at?", max 140), **Save** (primary)
  and **Cancel**, and the line "Only judges and the Judge Advisor see this.
  The team never does."
- Marked: the button is replaced by an amber note block: "Marked for review
  by <name> · <time>" then the reason, with **Edit reason** and **Clear**
  links when the viewer is the setter or the JA (see reference-ja-wide
  drawer). Clear asks first via `useConfirm()` ("Clear the review mark on
  9882K?").

### Judge queue (phone; frame a)

- A small read-only amber pennant right after the team name on the hero
  card, queue rows, booked rows and not-in-queue rows when that team is
  marked, plus a thin amber left edge on the row. `aria-label="Marked for
  review"`. No control on the row itself.

### JA Teams page (1280; reference-ja-wide)

- **For review strip** above the filters when ≥1 team is marked: heading
  "For review · N" with the pennant and the note "Marked by judges and the
  Judge Advisor. The teams do not see this." One card per mark, newest first:
  number + name, "<who> · <time>", reason (2 lines, ellipsis), **Clear**
  (asks first) and **Open** (selects the team / opens its drawer). Cards wrap
  in a 3-column grid.
- Table: the pennant after the team name for marked teams.
- Drawer: the amber note block at the top (as in the sheet), or a "Mark for
  review" button when not marked.

### JA Teams page (375; frame c)

- The strip collapses to a single amber bar "N teams marked for review" with
  a chevron; tap expands the card list (shown expanded in the reference).
  Collapsed by default on phone.
- Rows show the pennant after the team name.

## Accessibility

Real `<button>`s; the pennant is `aria-hidden` inside labelled controls, and
`role="img" aria-label="Marked for review"` where it stands alone. Amber text
on the dark surface must pass 4.5:1 (use the caution ink token). Touch targets
≥44px on phone, ≥32px on desktop.
