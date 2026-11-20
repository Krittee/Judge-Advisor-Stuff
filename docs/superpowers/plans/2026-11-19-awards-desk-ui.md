# Awards Desk UI (2.2.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Marketing role's read-only Awards Desk (`/marketing`), the Judge Advisor's Send / Recall / lock controls on the Awards tab, and the seventh "Marketing" door, on top of the finished backend.

**Architecture:** Pure logic in `marketingLogic.ts` (new) and `awardsLogic.ts` (extended), unit-tested with `node:test`; views are prop-driven React components rendered to static markup in runtime tests; pages own polling and writes, as the coordinator and Awards tab already do. No route or rule on the server changes.

**Tech Stack:** Next.js App Router, React, TypeScript, plain CSS in `src/app/globals.css`, `node:test` via `tsx`.

**Spec:** `design/awards-desk/PROMPT.md` (the build spec; wins over the mocks) · behaviour: `docs/superpowers/specs/2026-11-19-awards-desk-design.md` · visual: `design/awards-desk/reference-*.dc.html` (read their `<style>` blocks for sizes and their markup for structure and copy) · backend contract: `src/lib/types.ts` (`ReleaseTeam`, `ReleaseSnapshot`, `AwardReleaseRow`, `ReleasedView`, `ReleaseReply`, `SendAllReply`).

## Global Constraints

- Commit locally only. Never push, open a PR, comment or deploy. Never commit `Pixel-Art-Role-Avatars-HD/`.
- Don't change any `/api/*` route, `src/lib/auth.ts` rule or store.
- Each commit green: `npm test`, `npx tsc --noEmit`, `npx eslint . --ignore-pattern '.claude/**'`, `npm run build` (never while `next dev` runs from this checkout).
- Archivo (headings, team numbers) + Fira Sans; existing OKLCH tokens; dark by default, light must work.
- No playful motion: no pulse, spinner, slide; only `transition` on colour/background.
- Colour is signal: green `--done` = sent; caution = "Changed — was …" and "Marketing had …"; danger = Recall confirm button and refused sends; muted grey = not sent / being updated / not ready; accent blue = interactive chrome only (buttons, links, focus, pressed chips, Seen). Every state also has words or an icon.
- Touch targets ≥44px on phone (<1024px), ≥32px on desktop. Tints use `color-mix(in srgb, …)`.
- Desk styles: `.mk` / `.mk-*` in `globals.css`, placed **before** the first `/* @ja-block */` marker (next to `.co`), so `tests/adminCssScope.test.mjs` does not count them. JA additions go inside the existing `/* @ja-block awards */` block with `ja-aw-*` names.
- Destructive actions (Recall) go through `useConfirm()`.
- Status words exactly as PROMPT.md: "Not sent yet", "Being updated", "No winner", "Changed — was 1234A", "Seen", "N of M sent", "Send to Marketing", "Sent 10:58", "Recall", "Recalled 10:51", "Send again", "Pick a winner to send", "Pick both winners to send", "Send all ready (N)", "Nothing is ready to send", "Recall it from Marketing first.".
- Times are local `HH:MM`, 24-hour, two digits each.

## Review Focus

1. **A recalled row never shows a team on the desk**, even if a stale `teams` slips through: the desk decides from `status`, not from `teams.length`. → Task 1 test `rowState: recalled ignores teams`.
2. **localStorage throws (Safari private mode, blocked storage)**: the desk still renders and Seen still hides the line for this page load. → Task 1 test `seen store survives a throwing storage`.
3. **A second change to the same award flags again** after the first was marked Seen (new `changed_at` = new key). → Task 1 test `a newer changed_at is unseen again`.
4. **The JA taps Send / Recall twice quickly, or a poll lands mid-write**: one write at a time (the existing `write()` guard), and both `/api/awards` and `/api/awards/released` reload after it. → Task 2 source test `send and recall go through write()`.
5. **Award config changed after sends** (a release row for an award id no longer in `awards`): desk and JA ignore that row; counts use config awards only. → Task 1 test `sentCount ignores unknown awards`; Task 2 test `readyToSend only config awards`.

---

### Task 1: Marketing sign-in and the Awards Desk (commit 1)

**Files:**
- Create: `src/components/marketing/marketingLogic.ts`
- Create: `src/components/marketing/AwardsDesk.tsx` (pure view)
- Create: `src/app/marketing/page.tsx` (session check, polling, Seen state)
- Create: `src/app/marketing/login/page.tsx`
- Modify: `src/components/SignInForm.tsx` (`homeFor`, `ROLES.marketing`, `Avatar`)
- Modify: `src/app/globals.css` (`.mk-*`; `.si-av--ph` for the dashed pass avatar)
- Test: `tests/marketingLogic.test.ts`, `tests/marketingPage.runtime.test.tsx`

**Interfaces:**
- Consumes: `ReleasedView`, `AwardReleaseRow`, `ReleaseSnapshot`, `ReleaseTeam` from `@/lib/types`; `call` from `@/components/useAppState`; `SignOutButton` from `@/components/judging`; `homeFor` from `@/components/SignInForm`.
- Produces (`marketingLogic.ts`):
  - `type DeskRow = { award: ReleasedView["awards"][number]; release: AwardReleaseRow | null; state: "sent" | "no-winner" | "recalled" | "not-sent"; teams: ReleaseTeam[]; change: Change | null }`
  - `type Change = { awardId: string; label: string; division: string; key: string; nowText: string; wasText: string; wasNumbers: string }`
  - `rowState(release: AwardReleaseRow | null): DeskRow["state"]`
  - `seenKey(r: Pick<AwardReleaseRow, "award_id" | "division" | "changed_at">): string` → `mk-seen:<award_id>:<division>:<changed_at>`
  - `snapshotText(s: ReleaseSnapshot, withName: boolean): string` → `"No winner"`, `"7700B Polar Bots"` (one team, withName), `"1234A, 60601D"` (several, or !withName)
  - `changesOf(view: ReleasedView, isSeen: (key: string) => boolean): Change[]` — division order then award order
  - `deskRows(view: ReleasedView, division: string, isSeen: (key: string) => boolean): DeskRow[]` — every config award by `order`
  - `sentCount(view: ReleasedView, division: string): number` and `countText(n: number, m: number): string` → `"7 of 11 sent"`
  - `matchRow(row: DeskRow, query: string): boolean` — trimmed, case-insensitive; award label or a **current** team's number/name; `previous` never
  - `highlight(text: string, query: string): { text: string; hit: boolean }[]`
  - `resultsText(n: number): string` → `"1 result"` / `"3 results"`
  - `hhmm(iso: string): string`
  - `readSeen(store: Pick<Storage, "getItem"> | null, key: string): boolean` and `writeSeen(store: Pick<Storage, "setItem"> | null, key: string): void` — both swallow throws
- Produces (`AwardsDesk.tsx`): `AwardsDesk(props: { name: string; view: ReleasedView | null; lastGood: string | null; failed: boolean; query: string; onQuery(q: string): void; isSeen(key: string): boolean; onSeen(key: string): void })`

- [ ] **Step 1: Write the failing logic tests** in `tests/marketingLogic.test.ts`, using a `ReleasedView` fixture with three divisions, 11 awards (Judges with `places: 2`), and these rows in Middle School: Excellence sent with `previous` (was 1234A) and `changed_at`; Design sent; Innovate recalled; Create sent `no_winner: true`; Judges sent with two teams; plus one row for an award id not in `awards`.
  - `rowState`: sent → `"sent"`; sent+no_winner → `"no-winner"`; recalled → `"recalled"`; `null` → `"not-sent"`.
  - `rowState: recalled ignores teams`: a recalled row with `teams: [x]` → `deskRows(...)` row has `state: "recalled"` and `teams: []`.
  - `countText(sentCount(view, "Middle School"), 11) === "4 of 11 sent"` (recalled not counted); `sentCount ignores unknown awards`.
  - `changesOf` returns one item for Middle School Excellence with `nowText === "7700B Polar Bots"`, `wasText === "1234A"`; a Judges change gives `nowText "1234A, 60601D"`, `wasText "1234A, 5150X"`; to/from No winner gives `"No winner"`. `isSeen` returning true for its key removes it.
  - `seenKey({award_id:"excellence",division:"Middle School",changed_at:"2026-11-19T03:58:00.000Z"}) === "mk-seen:excellence:Middle School:2026-11-19T03:58:00.000Z"`; `a newer changed_at is unseen again`.
  - `matchRow`: `"7700b"` matches Excellence; `" polar "` matches; `"design"` matches by label; `"1234A"` does **not** match Excellence (only the was team); empty query matches all.
  - `highlight("Polar Bots","lar")` → `[{text:"Po",hit:false},{text:"lar",hit:true},{text:" Bots",hit:false}]`.
  - `seen store survives a throwing storage`: `readSeen({getItem(){throw new Error()}}, k) === false`; `writeSeen({setItem(){throw new Error()}}, k)` does not throw; `readSeen(null, k) === false`.
- [ ] **Step 2: Run** `npx tsx --tsconfig tsconfig.test.json --test tests/marketingLogic.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `marketingLogic.ts`** to the interfaces above.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Write the failing markup tests** in `tests/marketingPage.runtime.test.tsx` (pattern: `tests/coordinatorPage.runtime.test.tsx`, `renderToStaticMarkup` inside `AppRouterContext`):
  - renders "Awards Desk", "Marketing · signed in as Ploy" (name "Ploy") and just "Marketing" (name "Marketing").
  - recalled Innovate row text contains "Being updated" and no team number from its snapshot.
  - Excellence row contains "Changed — was 1234A" and a `Seen` button; the box `Changed since sent` lists it with "Seen is kept on this device"; with `isSeen = () => true` the box is absent.
  - Middle School heading shows "4 of 11 sent"; a never-sent row shows "Not sent yet".
  - query "7700B": shows "1 result", "Search looks at what Marketing has now", hides other divisions, and the box is still shown; query "zzz": `No award or team matches "zzz".`
  - `failed: true, lastGood: "10:59"` → "Couldn't reach the server. Showing what you had at 10:59."; status line "Checks every 15 s · last 10:59".
  - empty `divisions` → "No divisions yet."; empty `awards` → "No awards are set up."
  - source checks: `src/app/marketing/page.tsx` redirects to `/marketing/login` without a session and lets `marketing` and `admin` through; `homeFor("marketing") === "/marketing"`; `src/app/coordinator/page.tsx` still refuses non-coordinator/admin (unchanged).
- [ ] **Step 6: Run** `npx tsx --tsconfig tsconfig.test.json --test tests/marketingPage.runtime.test.tsx` → FAIL.
- [ ] **Step 7: Implement** `AwardsDesk.tsx` from `reference-desk-wide.dc.html` (1280) and `reference-desk-phone.dc.html` (375): header (brand bar like the coordinator's, dashed placeholder avatar `border: 1.5px dashed var(--rail)`, no image; title; who line; Sign out via `SignOutButton to="/marketing/login"`; theme toggle docks as on other consoles), search `type="search"` with a ≥44px clear button, status line, danger line on failed poll, Changed box, division sections (phone: sticky opaque heading with hairline), rows (Judges: two teams stacked; wide-only `HH:MM` column; phone: tag + Seen wrap to a second line). Highlight uses a neutral tile (`--tile`-like), never accent.
- [ ] **Step 8: Implement** `src/app/marketing/page.tsx`: `GET /api/session` → no session → `/marketing/login`; role not `marketing`/`admin` → `homeFor(role)`. Poll `GET /api/awards/released` on load, every 15 000 ms while visible, pause on hidden, refetch on `visibilitychange` visible (copy `useAwards`' shape). Keep the last good view and its `hhmm` on failure. Seen: a `Set<string>` in state seeded from `readSeen(window.localStorage …)` (wrap the `localStorage` access itself in try/catch → `null`), `onSeen` adds to the set and `writeSeen`s.
- [ ] **Step 9: Implement** `src/app/marketing/login/page.tsx` (title "Marketing sign in", intro "Marketing signs in here to see the awards as the Judge Advisor sends them.", `door="marketing"`); in `SignInForm.tsx` `homeFor("marketing")` → `"/marketing"`, `ROLES.marketing.avatar` → `null` and `Avatar` draws `<span className="si-av si-av--ph" aria-hidden="true" />` when null (style it with the dashed border in `globals.css`); drop the placeholder comment.
- [ ] **Step 10: Run** both test files → PASS, then the full gate (Global Constraints).
- [ ] **Step 11: Commit** `git commit -m "Awards Desk: Marketing sign-in and the /marketing desk"` (with the attribution line).

### Task 2: JA Awards tab — Send / Sent / Recall / lock / Send all ready (commit 2)

**Files:**
- Modify: `src/components/admin/awardsLogic.ts` (new pure helpers)
- Modify: `src/components/admin/useAwards.ts` (also fetch released)
- Modify: `src/components/admin/AwardsTab.tsx` (`AwardsTab`, `AwardsBoard`, `AwardLists`, `MatrixView`, `NomineePanel`)
- Modify: `src/app/admin/page.tsx` (pass `released`)
- Modify: `src/components/ConfirmDialog.tsx` (`body?: React.ReactNode`)
- Modify: `src/components/ui.tsx` (`Banner` inner div gets `whitespace-pre-line`, so multi-line messages show one per line)
- Modify: `src/app/globals.css` (inside `/* @ja-block awards */`)
- Test: `tests/adminAwards.logic.test.mjs`, `tests/adminAwards.runtime.test.tsx` (fixtures in `tests/adminAwards.fixtures.ts`), `tests/confirmDialog.test.tsx`

**Interfaces:**
- Consumes: `winnersOf`, `noWinnersOf`, `isFull` (already in `awardsLogic.ts`), `AwardReleaseRow`, `ReleasedView`, `SendAllReply`.
- Produces (`awardsLogic.ts`):
  - `type SendState = "sent" | "recalled" | "ready" | "not-ready"`
  - `isReady(award: Pick<AwardView, "id" | "places">, division: string, winners: WinnerRow[], noWinners: Marks): boolean`
  - `releaseOf(releases: AwardReleaseRow[], awardId: string, division: string): AwardReleaseRow | null`
  - `sendState(award, division, winners, noWinners, releases): SendState` (sent wins over ready)
  - `readyToSend(awards, divisions: string[], winners, noWinners, releases): { award: AwardView; division: string }[]` — what POST will send; length = button number
  - `sentCountIn(releases, awards, division): number` → for "· N sent to Marketing"
  - `snapshotLine(s: ReleaseSnapshot): string` → `"4455F Spark Plugs"`, `"1234A Gear Grinders, 60601D Iron Owls"`, `"No winner"`
  - `sendAllLines(items, winners, noWinners, teams, releases): { key: string; text: string; was: string | null }[]` — `text` = `"<Award> · <Division> · <number> <name>"` (Judges both; No winner "No winner"); `was` = `snapshotLine(release)` when a release exists and differs from the decision now, else `null`
  - `notReadyLines(awards, division, winners, noWinners, releases): string[]` → `"Energy isn't ready: no winner yet."` / `"Judges isn't ready: only one winner."`
  - `skippedText(skipped: SendAllReply["skipped"], asked: Set<string>, awards): string | null` — one line per skipped `awardId|division` that was in the dialog: `"<Label> · <Division> was not sent: it changed while you were sending. Check it and send again."`, joined by `"\n"`
  - `recallQuestion(label, division): { question: string; body: string }` → question `Recall <Label> from Marketing?`, body `Marketing will see <Label> · <Division> as "Being updated" until you send it again. You can then change the winner.`
- Produces (`useAwards.ts`): returns `{ data, released: ReleasedView | null, error, reload }`; `reload` fetches both with `Promise.all`.
- Produces (`ConfirmDialog.tsx`): `ConfirmOptions.body?: React.ReactNode`, rendered under the question.

- [ ] **Step 1: Write the failing logic tests** in `tests/adminAwards.logic.test.mjs`:
  - `isReady`: one winner on a 1-place award → true; Judges (places 2) with 1 → false, with 2 → true; No winner mark → true; nothing → false.
  - `sendState`: sent release → `"sent"` (even when ready); recalled release → `"recalled"`; ready, no release → `"ready"`; else `"not-ready"`.
  - `readyToSend` across two divisions returns every ready, not-sent pair (a recalled + ready one included, a sent one excluded); `readyToSend only config awards`.
  - `sendAllLines`: a recalled Excellence (snapshot 4455F) now decided for 7700B → `was === "4455F Spark Plugs"`; same decision → `was === null`.
  - `notReadyLines` and `skippedText` exact strings above; `skippedText` ignores an item not in `asked` and returns `null` when none.
- [ ] **Step 2: Run** `npx tsx --tsconfig tsconfig.test.json --test tests/adminAwards.logic.test.mjs` → FAIL.
- [ ] **Step 3: Implement** the helpers in `awardsLogic.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Write the failing markup tests** in `tests/adminAwards.runtime.test.tsx` (render `AwardsBoard` with a new `released` prop) and `tests/confirmDialog.test.tsx`:
  - By award: a ready award's header has a button "Send to Marketing"; a not-ready one has "Pick a winner to send" and no Send button; Judges with one winner → "Pick both winners to send".
  - Sent award: "Sent 10:58", a "Recall" button, an element with `aria-label="Locked: sent to Marketing"`; its "Mark no winner"/"Clear" button is `disabled` with `title="Recall it from Marketing first."`.
  - Recalled award: "Recalled 10:51", "Send again" (disabled when not ready), and "Marketing had 4455F Spark Plugs".
  - Meta line ends with "· 1 sent to Marketing"; filter bar has "Send all ready (3)"; at 0 it is `disabled` with `title="Nothing is ready to send"`.
  - Matrix: a sent award's column header carries the lock label.
  - `NomineePanel` on a sent award: "Clear winner" and "Give …" disabled, text "Recall it from Marketing first. Sent to Marketing at 10:31."; the Remove link is not disabled.
  - `ConfirmDialog` renders `body` under the question; an existing caller without `body` renders as before.
  - Source test `send and recall go through write()`: in `AwardsTab.tsx` the `/api/awards/released` calls appear only inside `write(` jobs.
- [ ] **Step 6: Run** both files → FAIL.
- [ ] **Step 7: Implement** in `AwardsTab.tsx` from `reference-ja-wide.dc.html`, `reference-ja-phone.dc.html`, `reference-ja-dialogs.dc.html`:
  - `AwardsTab` gets `released: ReleasedView | null`; handlers via `write()`: `onSend(awardId)` → PUT `{awardId, division}`; `onRecall(awardId)` → `ask(question, { body, confirmLabel: "Recall", danger: true })` then DELETE; `onSendAll()` → `ask("Send N awards to Marketing?" | "Send 1 award to Marketing?", { body: <list of sendAllLines + caution sub-lines + muted notReadyLines>, confirmLabel: "Send N" })` then POST, then `onError(skippedText(...))` if non-null (after the reload).
  - `AwardsBoard`/`AwardLists`/`MatrixView`/`NomineePanel` get the release state as props; controls per PROMPT.md §2 exactly; lock reuses the existing `LockIcon`; Send buttons accent outline; phone buttons ≥44px; Send all ready full width above the list on phone.
  - `useAwards` + `admin/page.tsx` pass `released`.
- [ ] **Step 8: Run** the files → PASS, then the full gate.
- [ ] **Step 9: Commit** `git commit -m "Awards tab: send to Marketing, recall, lock and Send all ready"`.

### Task 3: Seventh door "Marketing" (commit 3)

**Files:**
- Modify: `src/components/door/DoorPage.tsx`
- Modify: `src/app/globals.css` (`.dp-*` wide grid, `.dp-av--ph`)
- Test: `tests/doorPage.runtime.test.tsx`, `tests/doorPage.css.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DOORS[6] = { name: "Marketing", line: "Awards as the Judge Advisor sends them", href: "/marketing/login", ring: "mk" }` with no `avatar` → draws `<span className="dp-av dp-av--ph" aria-hidden="true" />`.

- [ ] **Step 1: Write the failing tests**: markup has seven doors in order Team, Judge, Referee, Queue desk, Coordinator, Judge Advisor, Marketing; the Marketing link goes to `/marketing/login` and has a `dp-av--ph` span and no `<img>`; Coordinator still uses `/avatars/coordinator.jpg`; only the Team door has "Opens the team ticket". CSS test: at the existing wide breakpoint `.dp-doors` uses `repeat(8, minmax(0, 1fr))`, `.dp-cell` spans 2, `.dp-cell:nth-child(5)` starts at column 2, cards keep `min-height: 224px`.
- [ ] **Step 2: Run** `npx tsx --tsconfig tsconfig.test.json --test tests/doorPage.runtime.test.tsx tests/doorPage.css.test.mjs` → FAIL.
- [ ] **Step 3: Implement** from `reference-door.dc.html` (ignore its old Coordinator placeholder). Row gap unchanged; "Opens the team ticket" stays clear of row 2. Phone: one more list row.
- [ ] **Step 4: Run** → PASS, then the full gate.
- [ ] **Step 5: Commit** `git commit -m "Door page: the seventh door, Marketing"`.

### Task 4: Review, browser check, record (Opus, not a subagent)

- [ ] Review each task's diff against PROMPT.md and the boards before the next task starts.
- [ ] Browser check on a **copy** of the data: copy `.data/state.json` to the scratchpad, add a `.claude/launch.json` entry `awards-ui` (`DATA_FILE=<copy>`, `npm run dev -- -p 3700`, port 3700) from this worktree. At 1280 and 375, dark and light: Marketing sign-in with `MKTG01`; desk with sent / recalled / never-sent / changed rows, search, Seen; JA tab Send, Recall dialog, lock message, Send all ready dialog. Screenshots of the desk and the JA tab.
- [ ] Add a FIXES.md row and section "Awards Desk UI (2.2.0)" in the backend entry's format; commit `Awards Desk UI: fix record`.

---

## Follow-up (2026-11-20): split the Awards Desk by program

User request: the Marketing Awards Desk is split into **VEX IQ** and **V5RC**, as **tabs at every size**. VEX IQ = Elementary School + Middle School. V5RC = Middle School + High School, so Middle School shows in both tabs with the same awards. **Blended** gets a tab of its own, holding the blended divisions as set up for the event.

### Task 5: Program tabs on the Awards Desk

**Files:**
- Modify: `config/event.json` (new key `programs`, plus a `_comment` line)
- Modify: `src/lib/presets.ts` (`presetPrograms()`)
- Modify: `src/lib/types.ts` (`ReleasedView.programs`)
- Modify: `src/app/api/awards/released/route.ts` (GET adds `programs`; nothing else changes)
- Modify: `src/components/marketing/marketingLogic.ts`, `src/components/marketing/AwardsDesk.tsx`, `src/app/marketing/page.tsx`, `src/app/globals.css` (`.mk-*`)
- Test: `tests/marketingLogic.test.ts`, `tests/marketingPage.runtime.test.tsx`, `tests/awardsReleased.runtime.test.ts`

**Interfaces:**
- `config/event.json`: `"programs": [{ "label": "VEX IQ", "divisions": ["Elementary School", "Middle School"] }, { "label": "V5RC", "divisions": ["Middle School", "High School"] }]`
- `presetPrograms(): { label: string; divisions: string[] }[]`: from config, trimmed and de-duplicated; `[]` when the key is missing.
- `ReleasedView.programs: { label: string; divisions: string[] }[]`: the server builds the tabs in this order.
  1. Each configured program, keeping only the divisions in `eventDivisions` (in event order), dropped if empty.
  2. `"Blended"` = `blendedDivisions()` that are in the event (the existing JA/config setting), dropped if empty.
  3. `"Other"` = any event division in no program and not blended, dropped if empty, so a division the JA adds is never lost.
  With no `programs` config: `[{ label: "All", divisions }]`, and the desk draws no tab bar.
- `marketingLogic.ts`: `tabKey(label: string): string` (lower-case slug), `pickTab(programs, saved: string | null): string` (the saved one if it still exists, else the first).

**Behaviour (desk):**
- A tab bar under the status line: one tab per program (`role="tablist"`, each `role="tab"` with `aria-selected`), styled like the JA's Matrix | By award toggle (`.ja-aw-vt` look, `.mk-tabs` classes). ≥44px on phone, 36px on desktop. The label carries its sent count: "VEX IQ · 7 of 22 sent", where Middle School counts once per tab it is in.
- The tab is remembered on this device: `localStorage` key `mk-tab`, with try/catch like Seen.
- The **Changed since sent** box stays above the tabs and lists changes from **every** division (safety signal, unchanged).
- Only the selected tab's division sections show, in its order.
- **Search** looks across **all** tabs while a query is set. The tab bar is hidden and results are grouped by division, each division once (Middle School not doubled). "N results" counts each award row once. Clearing the query brings the tabs back on the same tab.
- One tab only (no `programs` config): no tab bar, same page as today.

- [ ] Step 1: failing tests:
  - route GET returns `programs` with VEX IQ [ES, MS], V5RC [MS, HS], Blended [Blended]; an extra division "Open" lands in "Other".
  - `pickTab`: falls back to the first tab when the saved one is gone.
  - markup: the tab bar shows 3 tabs with the counts; the V5RC tab shows Middle School and High School only; a search for an MS team shows Middle School once and no tab bar.
- [ ] Step 2: implement. Step 3: full gate. Step 4: commit "Awards Desk: VEX IQ, V5RC and Blended tabs".
