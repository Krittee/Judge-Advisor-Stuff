# Referee console scrolls the whole page on iPhone Safari (2026-10-31)

## Problem

On the live site, on an iPhone in Safari, scrolling the Referee console (`/referee`) broke the layout:

- The top row (Referee, name, Live, Sign out) slid off the top of the screen. The moon theme toggle stayed behind, floating over the striped bar and the "Set match" button.
- A blank grey strip appeared under the tab bar (Report / All teams / Today), above Safari's own toolbar.

Only the body (Team to flag down to the Record bar) should scroll. The header, match bar, Record bar and tabs should stay put.

## Root cause

The page `<body>` had Tailwind's `min-h-screen`, which is `100vh`. On iPhone Safari, `100vh` is taller than the visible screen, because it doesn't count Safari's toolbar. The referee shell (`.referee`) is correctly sized to the visible screen (`100dvh`), so the body was a little taller than the screen, and the whole page could scroll by the difference.

Two things triggered that scroll: tapping the Today tab, which jumps to "Flagged today" with `scrollIntoView` and scrolls every scrollable ancestor, including the page; and a swipe that starts on a part that doesn't scroll (the match bar, Record bar or tabs). The header moved up with the page. The theme toggle is pinned to the screen, so it stayed where it was. The extra empty body height showed up under the tabs.

It didn't show on a Mac, where `100vh` equals the visible height.

## What changed

- `src/app/layout.tsx`: body `min-h-screen` → `min-h-dvh` (no taller than the visible screen), plus a one-line comment explaining why.

This is the root layout, so it covers every page. The judge console and the Judge Advisor screens use the same full-screen setup and had the same hidden page scroll, so this fixes them too. Desktop is unaffected, because there `100vh` and `100dvh` are equal.

## How it was tested

- **Chromium simulation:** local dev server on a copy of the data (not `.data/`), at mobile width (375×812).
  - **Before the fix:** I made the body 40px taller than the screen, as iPhone Safari does, then tapped Today. The page scrolled 40px, the header disappeared and a 40px gap opened under the tabs, matching the user's screenshot.
  - **After the fix:** tapping Today scrolls only the body. The header stays at the top and the tabs reach the bottom edge.
  - **Also checked:** All teams scrolled to the bottom, dark mode, desktop width (1024px), and the head-referee view.
- `npm test`: 1582 pass, 0 fail, 1 skipped. `npm run lint`: clean.
- **Real iPhone:** not yet confirmed on a real iPhone. A local server on the same network was offered for that check.

## Commit and branch

- Fix: `4415991` on `claude/fix-ref-mobile-scroll-a19545`.

## Status

Committed locally and merged into the main branch locally. NOT pushed or deployed.

## Follow-ups

- Confirm on a real iPhone in Safari before or after the deploy.
