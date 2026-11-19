# Version 2.2.0 — Awards Desk (Marketing) — UI implementation prompt

Paste everything below the line into a Claude Code session opened in this repo
(or say: "Implement design/awards-desk/PROMPT.md").

---

Build the **UI** of Version 2.2.0: the Marketing role's read-only **Awards
Desk** (`/marketing`), the Judge Advisor's **Send to Marketing** controls on
the Awards tab, and the seventh door on "/". The design is final: match it,
don't redesign it. Commit locally only. Never push, open a PR or deploy.

The **backend is already built** on branch `claude/awards-desk-backend-921f59`
(role, `award_releases` store, `/api/awards/released`, the lock). Build on top
of it; don't change its routes or rules. Behaviour source of truth:
`docs/superpowers/specs/2026-11-19-awards-desk-design.md`. Where a mock and
this file disagree, this file wins.

**Commits, in order** (each a local commit with `npm test`, `tsc`, `eslint`
and `npm run build` green):
1. Marketing sign-in routing + the Awards Desk page `/marketing`.
2. JA Awards tab: Send / Sent / Recall / lock / Send all ready.
3. Door page: the seventh door.

## Sources

- **Visual spec:** static mocks in `design/awards-desk/`, dark (each takes a
  `theme` prop for light; light must work as well):
  - `reference-desk-wide.dc.html` (1280): the Awards Desk, direction
    **A · One list** (chosen).
  - `reference-desk-phone.dc.html` (790 = two 375 phones). **Left:** top of
    the page with the sticky division heading. **Right:** searching "1234".
  - `reference-ja-wide.dc.html` (1280): the JA Awards tab, **By award**,
    Middle School, direction **A · On each award** (chosen), side panel open
    on a sent award (Design · 2381C).
  - `reference-ja-phone.dc.html` (790 = two 375 phones). **Left:** the award
    list with Send / Sent · Recall. **Right:** the bottom sheet on a sent award.
  - `reference-ja-dialogs.dc.html` (1280): the Recall and Send all ready
    confirm dialogs, and the refused-send banner.
  - `reference-door.dc.html` (375 light + 1280 dark): "/" with the
    Marketing door.
  These are self-contained HTML mocks (`{{hole}}` template, not React). Read
  their `<style>` blocks for sizes, spacing and colours and their markup for
  structure and copy. Team data is sample data.
- **Live canvas:** https://claude.ai/artifact/Nhv45XWtvnnjLwCC768jWc, row
  "v2.2 · Awards Desk". Only the **A** boards (desk and JA), the Shared
  dialogs board and the Marketing door are chosen. B and C are not; ignore them.
- **Backend contract:** `/api/awards/released` (see the API table below) and
  the types `ReleaseTeam`, `ReleaseSnapshot`, `AwardReleaseRow`,
  `ReleasedView`, `ReleaseReply`, `SendAllReply` in `src/lib/types.ts`.
- **Code to copy patterns from:** `src/components/coordinator/` (closest
  read-mostly role console: header, sign out, theme toggle, polling),
  `src/components/admin/AwardsTab.tsx` + `awardsLogic.ts` + `useAwards.ts`
  (the Awards tab, `winnersOf`, `noWinnersOf`, `decidedCount`, the
  `write()` one-at-a-time guard), `src/components/ConfirmDialog.tsx`
  (`useConfirm`), `src/components/ui` (`Banner`),
  `src/components/door/DoorPage.tsx`, `src/components/SignInForm.tsx`.

## Look (unchanged rules)

Archivo (headings, team numbers) + Fira Sans, OKLCH tokens, dark by default,
light must work. Static and professional: **no playful motion** (no pulse,
spinner or slide; colour/background `transition` only). **Colour is signal:**
green (`--done`) = sent/complete; **caution** = the "Changed — was …" flag
and the "Marketing had …" line; danger = Recall's confirm button and refused
sends; muted grey = not sent / being updated / not ready; **accent blue =
interactive chrome only** (buttons, links, focus, pressed chips, the Seen
button). Never colour alone: every state also has words or an icon. Touch
targets ≥44px on phone, ≥32px on desktop. Tint mixes use
`color-mix(in srgb, …)`. Styles go in `globals.css` under a page-scoped class
(`.mk-*` for the desk; the JA additions inside the existing
`/* @ja-block awards */` block so `tests/adminCssScope.test.mjs` passes).

## API (already built — read only)

| Method | Who | Body | Reply |
|---|---|---|---|
| GET `/api/awards/released` | JA, marketing | — | `ReleasedView` `{ awards: {id,label,order,places}[], divisions, releases }`, `no-store`. No row = never sent. For marketing a `recalled` row has `teams: []`, `previous: null`. |
| PUT | JA | `{ awardId, division }` | `ReleaseReply`. 409 "<Label> in <division> is not decided yet. …" |
| POST | JA | — | `SendAllReply` `{ sent, skipped }`, every division × award |
| DELETE | JA | `{ awardId, division }` | `ReleaseReply` (recall). 404 if never sent |

While an award is `sent`, the winners and no-winner routes answer **409
"Recall it from Marketing first."**; a team delete / division change in a
sent snapshot answers 409 "Recall <Label> from Marketing first.".

## 1 · Marketing sign-in and the Awards Desk (`/marketing`, direction A)

**Routing.** `/marketing/login` uses `SignInForm` like the other roles (its
placeholder `marketing` entry exists: give it the dashed placeholder avatar,
not the coordinator art). `homeFor("marketing")` → `/marketing`.
`/marketing` without a marketing (or admin) session redirects to the login.
Activity / nav labels: "Marketing".

**Data.** `GET /api/awards/released` on load, then every **15 s** while the
tab is visible (pause on `visibilitychange` hidden; re-fetch on show). Keep
the last good answer on a failed poll and show a quiet danger line under the
status line: "Couldn't reach the server. Showing what you had at 10:59."
Never show winners from any other source.

**Header** (from the mock): brand bar like the other consoles, the
Marketing **dashed placeholder avatar** (`border: 1.5px dashed var(--rail)`,
no image), title "Awards Desk", "Marketing · signed in as <name>" (just
"Marketing" when the name is the default), Sign out, theme toggle.

**Toolbar.** Search field "Search team number, name or award" (type
`search`, a clear button ≥44px on phone), then the status line
"Checks every 15 s · last 10:59" (time of the last good answer, `HH:MM`).

**"Changed since sent" box** (caution, pinned above the divisions; hidden
when empty). Header: "Changed since sent", the count, and the muted note
"Seen is kept on this device". One line per **unseen** change across all
divisions, in division then award order:
"Middle School · Excellence  now **7700B** Polar Bots · was **1234A**" and a
**Seen** button (accent outline). For the Judges Award: "now 1234A, 60601D ·
was 1234A, 5150X". A change to/from No winner reads "now No winner" /
"was No winner".
- A change is a row with `status: "sent"`, `previous !== null`,
  `changed_at !== null`.
- **Seen** is stored only on this device: `localStorage` key
  `mk-seen:<award_id>:<division>:<changed_at>` = "1", every read/write in
  `try/catch` (private mode → nothing is remembered; the flag simply shows
  until the next page load). A newer `changed_at` is a new key, so a later
  change flags again. Seen removes the line from the box and the tag from
  the row at once.
- The box stays visible while searching (it is a safety signal).

**Divisions.** One section per division in config order (`divisions` from
the reply). Heading: division name + "N of M sent" (M = number of awards;
N = rows with `status: "sent"`; recalled doesn't count) and a thin green
progress bar. On phone the heading is **sticky** (opaque background,
hairline under it).

**Award rows.** Every award in config `order`, one row each:
award label (fixed column) · team number (Archivo, bold, tabular) · team
name · on wide only, the sent time `HH:MM` (muted, right).
- sent → its team (Judges Award: two teams stacked in the same row, sorted
  as the server sends them).
- sent with `no_winner` → "No winner" (muted).
- `recalled` → "Being updated" (muted, small pencil/clock icon), **no team**.
- no row → the whole row greyed, "Not sent yet" (text still ≥4.5:1).
- unseen change → the row also carries the caution tag
  "Changed — was 1234A" and its own **Seen** button (same action as the box).
  On phone the tag + Seen wrap to a second line.

**Search.** Case-insensitive, trimmed, matches a row's **current** team
numbers, team names or the award label (a "was" team never matches). While a
query is set: hide non-matching rows and divisions with no match, show
"N result(s)" and the muted note "Search looks at what Marketing has now";
highlight the matched part of a team number/name with a neutral tile (not
accent). No match: "No award or team matches "<q>"." Empty query restores
everything.

**Empty / edge states.** No divisions: "No divisions yet." No awards in the
config: "No awards are set up." Nothing sent yet: every row "Not sent yet",
each heading "0 of 11 sent" (no special banner).

**Read-only.** No other controls. Marketing never writes to the server.

## 2 · JA Awards tab (direction A, "On each award")

Everything that exists stays. Add, in `AwardsTab`:

**Data.** Also fetch `GET /api/awards/released` with the tab's existing
`/api/awards` load, and reload both after every write (inside the existing
`write()` guard, so one write at a time). Helpers in `awardsLogic.ts`
(pure, unit-tested):
- `isReady(awardId, division)`: winners in that division === `places`
  (Judges Award 2) **or** marked No winner.
- `sendState(...)`: `"sent" | "recalled" | "ready" | "not-ready"` (sent wins
  over ready; a recalled award is `"recalled"`, with Send again enabled only
  when it is ready).
- `readyToSend()`: every division × award that is ready and not `sent`
  (this is what POST will send; its count is the button's number).

**Meta line.** Append "· N sent to Marketing" (this division) to the
existing "Middle School · all panels · 10 of 11 decided" line. The rail count
and the Division chips keep their **decided** counts (unchanged).

**Filter bar.** On the right, after Matrix | By award: **Send all ready (3)**
(primary). The count is event-wide (all divisions). Disabled with
`title="Nothing is ready to send"` at 0. Phone: full width above the list.

**By award, each award's header** (right side, from the mock):
- `ready` → "Send to Marketing" (accent outline button). Sends at once (no
  confirm: it is reversible with Recall).
- `sent` → a green tick "Sent 10:58" and a quiet "Recall" text button; a
  lock icon beside the award title (`aria-label="Locked: sent to Marketing"`).
- `recalled` → "Recalled 10:51" (muted) and "Send again" (accent outline,
  disabled until ready), and under the header a caution line
  "Marketing had 4455F Spark Plugs" (the row's snapshot; "No winner" if it
  was). Sending it again records a change on the server.
- `not-ready` → muted "Pick a winner to send" (Judges Award with one winner:
  "Pick both winners to send"). No button.
- **Locked (sent):** "Mark no winner" / "Clear" are disabled
  (`disabled` + `title="Recall it from Marketing first."`). Nominee rows still
  open the side panel.

**Matrix view.** A sent award's column header shows the lock icon after its
tick/dash (with the same label). Nothing else changes.

**Side panel / phone sheet on a sent award.** Show the winner as today, but
"Clear winner" and "Give … to …" are disabled, and under them, with the
lock icon: "Recall it from Marketing first. Sent to Marketing at 10:31."
Nominating and the Remove links stay enabled (nominations don't change the
sent decision, and the server doesn't lock them).

**Recall** (`useConfirm`): question "Recall <Award> from Marketing?", body
"Marketing will see <Award> · <Division> as "Being updated" until you send
it again. You can then change the winner.", buttons Cancel / **Recall**
(danger). On yes → DELETE.

**Send all ready** (`useConfirm`): title "Send N awards to Marketing?"
(singular "Send 1 award…"), then a list, one line per item:
"<Award> · <Division> · <team number> <team name>" (Judges: both teams;
No winner: "No winner"). An item whose award was sent before with a
different decision gets a caution sub-line "Changes what Marketing has: was
4455F Spark Plugs". Below the list, muted, the not-ready awards of the
**current** division: "Energy isn't ready: no winner yet." Buttons Cancel /
**Send N** (accent). On yes → POST. `ConfirmDialog` today takes a plain
string; add an optional `body?: React.ReactNode` to `ConfirmOptions` and
render it under the question (keep every existing caller unchanged; add a
runtime test for the body).

**Results and errors.** After POST, if `skipped` has items that were in the
dialog, show the danger `Banner` "Think was not sent: it changed while you
were sending. Check it and send again." (one line per skipped award, by
label · division). Any 409 from a write shows its server message in the same
Banner (the existing `onError`). Every send and recall is already logged by
the server.

**Phone.** Same controls inside the stacked award list (buttons ≥44px), the
side panel is the existing bottom sheet with the lock note.

## 3 · Door page: seventh door "Marketing"

From `reference-door.dc.html`: add after Judge Advisor, so the order is
Team, Judge, Referee, Queue desk, Coordinator, Judge Advisor, **Marketing**
(today's code order plus one). `{ name: "Marketing", line: "Awards as the
Judge Advisor sends them", href: "/marketing/login" }`, **dashed placeholder
avatar** (no image; the user will draw the art). The Coordinator door keeps
its real avatar (`/avatars/coordinator.jpg`; the mock shows the old
placeholder, ignore that). Wide (≥ the existing breakpoint): a 4-column grid
with the second row's three cards centred (8 half-columns, each card spans 2;
cards 5–7 start at column 2), same row gap; keep all cards equal height
(min-height 224px) and keep "Opens the team ticket" clear of row 2. Phone:
one more row in the list. Nothing else on "/" changes.

## Tests (add, keep the rest green)

- `awardsLogic`: `isReady` (single winner, Judges 1 of 2 = not ready, 2 of 2,
  No winner), `sendState` for sent / recalled / ready / not-ready,
  `readyToSend` across divisions.
- Desk logic (a small `marketingLogic.ts`): row state per release (sent,
  No winner, recalled, never sent), "N of M sent", changes list, search
  (number, name, award; never the "was" team), Seen key.
- Markup: the desk shows no team for a recalled row; the JA header shows Send
  only when ready, the lock and disabled controls when sent; `ConfirmDialog`
  renders `body`.
- `marketing` session: `/marketing` renders, other consoles still refuse it
  (the backend tests cover the routes).

## Not in this build

Backdrop, slides, print or export; marketing writes; a live view of picks.
