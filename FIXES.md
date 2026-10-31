# Fixes

Every bug fix or small change made since Version 2.0 went live, newest first. Each entry gives the problem, the cause, what changed, how it was tested, the commit and the status.

| Date | Fix | Commit | iPhone checked | Status |
|---|---|---|---|---|
| 2026-10-31 | [Referee console scrolls the whole page on iPhone Safari](#referee-console-scrolls-the-whole-page-on-iphone-safari-2026-10-31) | `4415991` | Not yet | Local, not pushed |
| 2026-10-31 | [Referee Today tab: show only today's flags](#referee-today-tab-show-only-todays-flags-2026-10-31) | `e465303` | Yes | Local, not pushed |
| 2026-10-31 | [JA phone Sections sheet was empty](#ja-phone-sections-sheet-was-empty-2026-10-31) | `cfd7eb5` | Yes | Local, not pushed |

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

Committed locally and merged into the main branch locally. NOT pushed or deployed.

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

Committed locally and merged into the main branch
(`claude/event-judge-booking-app-kcprxn`) locally. **Not pushed or deployed.**

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

Committed locally, and merged into the main branch locally. NOT pushed or deployed.

### Follow-ups

None required. The user checked only the Sections sheet on the iPhone; the record sheets and Awards drawer were checked in the browser pane only.

