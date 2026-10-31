# JA phone Sections sheet was empty (2026-10-31)

## Problem

On an iPhone (Safari, about 390px wide), tapping the ☰ button in the Judge Advisor console (`/admin`) opened the "Sections" sheet, but the sheet was empty. It showed only the grab handle, the title with its ×, and the footer. Floor, Referee, Teams, Panels, Conflicts, Import, Scores, Awards, Activity and the Other consoles links were missing. The desktop left rail was fine.

## Root cause

The sheet (`.ja-sheet`) has only a `max-height`, no fixed height, so it is as tall as its contents. The section list inside it (`.ja-sh-list`) used `flex: 1; min-height: 0`, which means "start at 0px and grow into leftover space". A sheet that sizes to its contents has no leftover space. Chrome still sizes the sheet around the list, but iPhone Safari counted the list as 0px tall, so it vanished. The judge's team sheet (`.jg-sheet`) uses the same layout but has a fixed `height`, which is why it worked.

The JA record sheets and the Awards phone drawer were set up the same way, so they were exposed to the same problem.

## What changed

- `src/app/globals.css`, `.ja-sh-list`: `flex: 1` → `flex: auto` (the Sections list), plus a comment explaining why.
- `src/app/globals.css`, `.ja-sh-form`: `flex: 1` → `flex: auto` (record sheets: Conflicts, Referee, Panels, Teams, Scores).
- `src/app/globals.css`, `.ja-cf-scroll`: `flex: 1` → `flex: auto` (the scrolling fields in those record sheets).
- `src/app/globals.css`, `.ja-aw-sheet .ja-aw-dr`: `flex: 1` → `flex: auto` (the Awards phone drawer).

`flex: auto` starts each part at its real content height. `max-height` still caps the sheet, and `min-height: 0` with `overflow-y: auto` still lets the body shrink and scroll.

## How it was tested

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

## Commit and branch

- Fix commit: `cfd7eb5`
- Branch: `claude/fix-ja-mobile-sections-bffe04`

## Status

Committed locally, and merged into the main branch locally. NOT pushed or deployed.

## Follow-ups

None required. The user checked only the Sections sheet on the iPhone; the record sheets and Awards drawer were checked in the browser pane only.
