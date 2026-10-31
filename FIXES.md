# Fixes

Every bug fix or small change made since Version 2.0 went live, newest first. Each entry gives the problem, the cause, what changed, how it was tested, the commit and the status.

| Date | Fix | Commit | iPhone checked | Status |
|---|---|---|---|---|
| 2026-10-31 | [Referee: keyboard hides the team being typed](#referee-keyboard-hides-the-team-being-typed-2026-10-31) | `cf7d3a5` | Skipped | Local, not pushed |
| 2026-10-31 | [Referee console scrolls the whole page on iPhone Safari](#referee-console-scrolls-the-whole-page-on-iphone-safari-2026-10-31) | `4415991` | Not yet | Local, not pushed |
| 2026-10-31 | [Referee Today tab: show only today's flags](#referee-today-tab-show-only-todays-flags-2026-10-31) | `e465303` | Yes | Local, not pushed |
| 2026-10-31 | [JA phone Sections sheet was empty](#ja-phone-sections-sheet-was-empty-2026-10-31) | `cfd7eb5` | Yes | Local, not pushed |

---

## Referee: keyboard hides the team being typed (2026-10-31)

### Problem

On the live site, on some phones, tapping **Team to flag** in the Referee console (`/referee`) opened the keyboard and squashed the app into the space above it. The header and the CURRENT MATCH bar stayed full size, the Record bar and the tabs sat right under them, and the form between them was about one line tall. Only the "Team to flag" label showed, cut off. The referee couldn't see the team number they were typing or the team it matched. The user: "some phones have this problem and they cannot see the team they are choosing".

### Root cause

The referee screen is a phone app shell: `.referee` is exactly one screen tall (`height: 100dvh`) and only `.rf-body` scrolls. Five parts are pinned around it at full size: header 73px, stripe 6px, match bar 109px (two rows on a phone), Record bar 98px, tabs 65px, 351px in all.

On most iPhones the keyboard slides over the page and nothing shrinks. Some phones shrink the page to the space above the keyboard instead (iOS 26.0 Safari has reported WebKit bugs where the page height changes around the keyboard, and some Android browsers resize the page by default). That leaves about 400–440px. The pinned parts don't shrink, so `.rf-body` got about 90px, and iOS 26's floating autofill bar (key / card / location) covered part of that.

### What changed

- `src/app/globals.css`: one `@media (pointer: coarse) and (max-height: 500px)` block. While a text field in `.rf-body` has focus, it hides the header, stripe, "VIQRC · N fields" pill, Record bar, tabs and floating theme toggle. They come back on blur. Phones that don't shrink (taller than 500px) and desktops (fine pointer) are untouched.
- `src/components/referee/RefereeFrame.tsx`: a `visualViewport` resize listener scrolls the focused field back into view, for fields lower in the form, like the note box, that the shrink pushes out of sight.

It works with the earlier `min-h-dvh` body fix (`4415991`): the page still can't scroll as a whole.

### How it was tested

- **Chromium simulation:** local dev server on a copy of the data (not `.data/`), 390px wide with touch emulation. A 440px-tall window stands in for the space above the keyboard in the user's screenshot.
  - **Before the fix:** reproduced the squash. `.rf-body` measured 89px, with only the label and the top of the input showing.
  - **After the fix:** with Team to flag focused, `.rf-body` is 383px. The typed "1101", the matched "Iron Hawks · Elementary School · Pit A1" and its flags, and the rule chips all show. Blur brings the Record bar (98px) and tabs (65px) back.
  - **Note box:** focused at full height, then shrunk to 440px (the order a keyboard opens in). The note box scrolled into view.
  - **All teams search:** the same rule applies. The search and its result show (checked in dark mode).
  - **Full phone height (844px):** focusing a field changes nothing. **Desktop (1024px):** the Record bar and tabs stay while typing, and the page doesn't scroll.
  - **Set match sheet and All rules picker:** already fine at 440px (each scrolls on its own), so unchanged.
- `npm test`: 1582 pass, 0 fail, 1 skipped. `eslint src tests` and `tsc --noEmit`: clean.
- **Real phone:** not checked. A desktop browser has no real on-screen keyboard. A local server on the same Wi-Fi was offered, and the user chose to skip the phone check.

### Commit and branch

- Fix: `cf7d3a5` on `claude/fix-ref-keyboard-f90990`.

### Status

Committed locally. NOT pushed or deployed.

### Follow-ups

- Watch for it on a phone that showed the problem after the deploy (the phone check was skipped).
- The judge and Judge Advisor phone screens use the same shell. Their text fields are in pop-up sheets that scroll on their own, so they're likely fine, but check them on a squashing phone.

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

