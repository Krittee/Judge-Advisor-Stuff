# Fixes

Every bug fix or small change made since Version 2.0 went live, newest first. Each entry gives the problem, the cause, what changed, how it was tested, the commit and the status.

| Date | Fix | Commit | iPhone checked | Status |
|---|---|---|---|---|
| 2026-10-31 | [Blended division shows as BLN](#blended-division-shows-as-bln-2026-10-31) | `600a5e8` | Not needed | Local, not pushed |
| 2026-10-31 | [Judging Board: colour key above Unassigned](#judging-board-colour-key-above-unassigned-2026-10-31) | `4a001a8` | Not needed | Local, not pushed |
| 2026-10-31 | [Team page: a way back, and no details strip](#team-page-a-way-back-and-no-details-strip-2026-10-31) | `be78288` | Not yet | Local, not pushed |
| 2026-10-31 | [Head referee can remove a flag](#head-referee-can-remove-a-flag-2026-10-31) | `ebbd0ab` | Not yet | Local, not pushed |
| 2026-10-31 | [Referee: keyboard hides the team being typed](#referee-keyboard-hides-the-team-being-typed-2026-10-31) | `cf7d3a5` | Skipped | Local, not pushed |
| 2026-10-31 | [Referee console scrolls the whole page on iPhone Safari](#referee-console-scrolls-the-whole-page-on-iphone-safari-2026-10-31) | `4415991` | Not yet | Local, not pushed |
| 2026-10-31 | [Referee Today tab: show only today's flags](#referee-today-tab-show-only-todays-flags-2026-10-31) | `e465303` | Yes | Local, not pushed |
| 2026-10-31 | [JA phone Sections sheet was empty](#ja-phone-sections-sheet-was-empty-2026-10-31) | `cfd7eb5` | Yes | Local, not pushed |

---

## Blended division shows as BLN (2026-10-31)

### Problem / request

The user: "I saw Division for Blended still show as blended while the others like Middle School use MS. Make Blended be BLN." `divisionTag()` shortened multi-word divisions to initials but returned one-word divisions whole, on purpose, so Blended stayed "Blended".

### What changed

- `src/components/admin/floorLogic.ts`: `divisionTag()` returns "BLN" for Blended (trimmed, any case); other one-word divisions still stay whole. Doc comment updated.
- `tests/adminConflicts.logic.test.mjs`: Blended, blended and " BLENDED " give "BLN"; "Open" stays "Open"; MS/ES/HS/D1/D12 unchanged.
- `tests/adminAwards.runtime.test.tsx`: the Awards division chip now reads "BLN" (full name kept for screen readers).

Every short division label already goes through `divisionTag`, so there was no hand-rolled copy to unify. Screens that now show "BLN": JA Teams list (Div column, panel picker hints), JA Panels tags, JA Floor "Move to panel…" rows, Conflicts (team and panel labels, roster groups), Awards division chips, Scores division filter (short label), and the referee console's team tags. Unchanged, still full names: panel headers on Floor and the judge console, the Judging Board and its colour key, pit map tooltips, queue desk, team page, setup forms. Blended's compatibility logic is not touched.

### How it was tested

- `npm test`: 1584 tests, 1583 pass, 0 fail, 1 skipped. `npx eslint src tests`: clean.
- In the browser, on a copy of the local data (not `.data/`) with two teams and one panel set to Blended: the Teams list shows "BLN" in the Div column beside "ES" and "MS"; the Panels tab tags read ES, ES, MS, BLN; Floor panel headers still say "Blended".

### Commit and branch

- Change: `600a5e8` on `claude/blended-bln-b74f84`.

### Status

Committed locally. NOT pushed or deployed.

### Follow-ups

- None.

---

## Judging Board: colour key above Unassigned (2026-10-31)

### Problem / request

On the Judging Board's "By panel" view (`/board`), the "What the colours mean" key sat in the right column after the Unassigned card. With many unassigned teams (17 in the user's screenshot), Unassigned pushed the key below the fold of the big screen, where nobody saw it. The user chose "top of the right column" over a one-line key strip under the header, as the smallest change during the event.

### What changed

- `src/components/board/BoardView.tsx`: the two children of `.bd-side` are swapped, so `<ColourKey/>` comes first and the Unassigned `PanelCard` second. No CSS change: nothing in `globals.css` depended on the order, and the phone rule `.bd-side .bd-key { display: none; }` still hides the key.
- `tests/board.runtime.test.tsx`: the "a division with no teams is not in the By panel key" test now reads only the key's own `<section>`. Before, it sliced to the end of the page, which now also takes in the Unassigned card.

The Pit floor view and the `.bd-pkey` status line are unchanged.

### How it was tested

- `npm test`: 1584 tests, 1583 pass, 0 fail, 1 skipped. `npx eslint src tests`: clean.
- In the browser, on a copy of the local data (not `.data/`) with 17 unassigned teams added:
  - Big screen (1920×1080), light and dark: the key is at the top of the right column and Unassigned (17 teams) follows it.
  - Laptop (1440×900), dark: same order, with the key fully visible above the fold.
  - Tablet (900px): the right column becomes a two-across grid, with the key first and Unassigned beside it.
  - Phone (375px): the key is still hidden (`display: none`).
- Fullscreen: the in-app browser blocks the Fullscreen API, so it was checked as a 1920×1080 viewport, which is the same layout without the browser bars. Not checked on the real big screen.

### Commit and branch

- Change: `4a001a8` on `claude/board-key-top-423390`.

### Status

Committed locally. NOT pushed or deployed.

### Follow-ups

- None.

---

## Team page: a way back, and no details strip (2026-10-31)

### Problem / request

The user, from a desktop screenshot of team 9852Z's page: "this page doesnt have the back door", and "do not need to show what is inside the greenbox". The team page had no way back out. Under the header, a strip read `9852Z | PSP S P³ I K E | Pit BLENDED | Elementary School | Developing | No panel`, repeating what the card below says. Also fixed, on the user's OK: after "Interview complete" the page still said "Please ask the queue desk to request a judge…".

The team page is public by team number (no team sign-in), reached from the "Find your team" ticket at `/team`, so the way back is a link to `/team`, not "Sign out". From there, "← All doors" leads to `/`.

### What changed

- `src/components/team/TeamView.tsx`: "← Change team" link to `/team` at the top of the page (the ticket page's `.lp-back` style); the details strip (`TeamDetails`) removed; the queue-desk note is hidden when the request is completed; `categories` prop dropped (only the strip used it).
- `src/app/team/[number]/page.tsx`: stops passing `categories`.
- `src/app/globals.css`: `.tp-meta` rules removed; `.teampage .lp-back` placement (spans both columns from 1024px); `align-content: start` on the desktop grid so the new row doesn't push the cards down.
- `tests/teamPage.runtime.test.tsx`: the four strip tests replaced with tests for the link, the strip being gone, and the note hidden after completion (kept for cancelled and no request).
- `tests/teamPage.logic.test.mjs`: the team-page CSS block may also style `lp-back`.

The user chose to drop pit, division and notebook category: they now show nowhere on the team page (teams know their own). Number, name and panel are still on the card.

### How it was tested

- `npm test`: 1584 tests, 1583 pass, 0 fail, 1 skipped. `npx eslint src tests`: clean. `npx tsc --noEmit`: clean.
- In the browser, on a copy of the local data (not `.data/`), at desktop (1440px) and phone (375px) width, light and dark:
  - Team with no panel and no request (1115): link at top, no strip, "No judge panel assigned yet" and the queue-desk note show.
  - Team with a panel and a live request (1101): same, with the panel on the card.
  - Team whose interview completed today (1108): "Interview complete — thank you!" and no queue-desk note; "See the full board →" stays.
  - Clicking "← Change team" opened "Find your team" at `/team`.
- The first build had a large gap above the cards at desktop width (the grid rows stretched to fill the page); fixed with `align-content: start`.
- Not checked on a real iPhone.

### Commit and branch

- Change: `be78288` on `claude/team-page-back-strip-981993`.

### Status

Committed locally. NOT pushed or deployed.

### Follow-ups

- Desktop layout: the card sits on the left and the note and board link sit alone on the right. The user chose to leave it for now.
- On a phone, the queue-desk note also shows while a request is live ("Judges have been notified"); unchanged here.

---

## Head referee can remove a flag (2026-10-31)

### Problem / request

The user: "add head ref - remove flag - authorization". Only the Judge Advisor could remove (delete) a referee flag. The head referee could already correct one, but had to ask the JA to remove a wrong one. The head referee heads the field, so they should be able to remove flags too.

### What changed

- `src/lib/auth.ts`: new `canRemoveFlag` (Judge Advisor or head referee); `canFlag` comment updated.
- `src/app/api/flags/route.ts`: DELETE uses `canRemoveFlag`; the 403 now reads "Only the head referee or the Judge Advisor can remove a flag."; doc comments updated. The Activity log entry is unchanged and names whoever removed it.
- `src/components/Flags.tsx`: `FlagList` takes an optional `onRemove` and shows a red **Remove** next to **Edit**; the two wrap together at the right on a phone.
- `src/app/referee/page.tsx`: the head referee gets Remove on every flag (Today tab and "Already on <team>"), behind the same confirm the JA gets.
- `README.md`, `RELEASE-NOTES-2.0-2.2.md`: the permission text and API table now say head referee or JA removes.
- `tests/flagsRoute.runtime.test.ts`, `tests/flags.test.mjs`, `tests/flagsRendering.runtime.test.tsx`, `tests/refereePage.source.test.mjs`: new and updated tests.

### Who can do what now

| Who | Raise a flag | Correct a flag | Remove a flag |
|---|---|---|---|
| Referee | Yes | No | No (no button; the API says 403) |
| Head referee | Yes | Yes | **Yes** (new) |
| Judge Advisor | No | Yes | Yes |
| Judge, queue desk, team, signed out | No | No | No (403) |

The confirm reads "Remove this flag? The judges will stop seeing it." with **Cancel** and a red **Remove flag**. Each removal is logged to Activity, for example `removed a flag: warning · Morgan Head · Head referee`.

### How it was tested

- `npm test`: 1585 tests, 1584 pass, 0 fail, 1 skipped. `npx eslint src tests`: clean. `npx tsc --noEmit`: clean.
- New route test: ordinary referee, judge, queue desk and a signed-out caller each get 403 and the flag stays; the head referee removes one (200, Activity shows "Head referee"); the JA removes another.
- In the browser, on a copy of the local data (not `.data/`), at phone width (375px):
  - Ordinary referee: Today tab shows flags with no Edit or Remove; a direct `DELETE /api/flags` from that sign-in returned 403.
  - Head referee: Edit and Remove on every flag. Cancel kept the flag; Remove flag removed it and the list refreshed.
  - Dark mode: the Remove text and the row are readable.
  - JA: `DELETE /api/flags` returned 200 and removed a flag.
  - Activity had both removals, with the right name and role.
- The first build let Remove wrap onto its own line at the left at 375px; fixed by keeping Edit and Remove together.
- Not checked on a real iPhone.

### Commit and branch

- Change: `ebbd0ab` on `claude/head-ref-remove-flag-43e7d7`.

### Status

Committed locally. NOT pushed or deployed.

### Follow-ups

- Check the Remove button on a real phone after the deploy.
- Ordinary referees still can't remove their own mistaken flag; they ask the head referee or JA. That was intended.

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

