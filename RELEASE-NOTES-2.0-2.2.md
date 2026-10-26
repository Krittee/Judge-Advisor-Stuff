# Judge Queue 2.0 → 2.2: what changed, and how it works

Written 2026-10-25. Covers everything built after Version 1 (the default
branch, `claude/event-judge-booking-app-kcprxn`, at `61cf67a`):

| Branch | Commits | What it is |
|---|---|---|
| `version-2.0` | 68, `c7cb8fa` … `333b49d` | The v2.0 redesign of every page, the audit hardening, and the follow-ups. |
| `version-2.2` | `version-2.0` + 9, … `6e96ace` | Awards, and new Judge Advisor tools in the Teams drawer. |

**Released as Version 2.0 on 2026-10-26** (`package.json` 2.0.0): PR
[#9](https://github.com/Krittee/Judge-Advisor-Stuff/pull/9) merged `version-2.2`
(which holds all of `version-2.0`) into the default branch as `dc84741`.
Vercel deployed it to judge-advisor-stuff.vercel.app. Version 1 is kept as tag
`v1.0.0` and the GitHub release "Version 1.0 (old version)". See §8 for the
launch itself.

---

## 1. Version 2.0: the redesign

Every page was redesigned. Each one was mocked first, as 2–3 directions on
the design canvas. You picked one, it was written up as a spec in
`design/<page>-redesign/PROMPT.md`, then it was built and reviewed.

| Page | URL | Direction chosen | What it is now |
|---|---|---|---|
| Door page | `/` | B, "Five doors" | "Who are you?" with five doors (Team, Judge, Referee, Queue desk, Judge Advisor) and a Live board card whose sample tiles explain the colours. The Team door reads "Check your judging status". |
| Sign-in | `/judge/login`, `/referee/login`, `/queue/login`, `/admin/login` | "Courtside credential" pass | One sign-in door per role, each with its pixel avatar. |
| Team ticket | `/team` | "Pit ticket" | Type the team number, then Continue. |
| Team page | `/team/<number>` | B, "Status board" | **Read-only.** A details row (number, name, pit, division, notebook, panel), a big panel in the status colour, a five-step track, and "Earlier today". |
| Live board | `/board` | A, "Panel columns, refined" | A column per panel, requesting teams first, a big "N waiting" block, and a Pit floor view. No motion. One back link top-left, named for your role. |
| Queue desk | `/queue` | B, "Now / Book" | Look up a team, then **Now** (one Request button per language) or **Book** (the panel's slot grid). Reschedule, cancel, plus Waiting now, Booked later and All teams. |
| Judge console | `/judge` | A, "Up next" | The panel's queue with a hero card for the next team, team sheets with both rubrics, scores, and today. |
| Referee console | `/referee` | "Match first" | Set the match, pick team, rule and severity, Record. The head referee sets up the day here. |
| Judge Advisor console | `/admin` | One direction per tab | A rail with Floor, Referee, Teams, Panels, Conflicts, Import, Scores, Awards (2.2) and Activity. |

### Judge Advisor console, tab by tab

- **Floor:** every panel live, as a panel board.
- **Referee:** flagged teams with their history, and correct-then-save for flags.
- **Teams:** a read-only table with an **Edit team** drawer (see §4.3 for 2.2).
- **Panels:** a roster board beside the panel cards. Codes, divisions, judges.
- **Conflicts:** recorded **per judge**. A panel inherits its judges'
  conflicts (see §3.4).
- **Import:** one box for the team list, showing new, updated and skipped
  counts. A re-import keeps whatever the sheet leaves blank.
- **Scores:** a ranked list plus compare-two, using the judge's own team sheet.
- **Activity:** a timeline by hour, filterable by kind, team and who.

### Other 2.0 changes

- **Head referee:** a separate code (`HEAD_REFEREE_CODE`). The head referee
  sets the day's program and number of fields; other referees wait until it's set.
- **Alliance (Red/Blue) removed** on purpose. The full version is kept in
  `5df7386` (data) and `28b5020` (UI).
- **Language label:** "Thai" instead of "ไทย (Thai)". Since labels are now
  English text, the JA screens no longer mark them `lang="th"`.
- **Confirmations:** every "are you sure?" is an in-page dialog
  (`useConfirm`), never the browser's `window.confirm`.

---

## 2. The audit (on `version-2.0`)

A security and robustness audit, `3903243`, plus a status table in
`FULL_APPLICATION_BUG_AUDIT.md` covering all 32 original findings: 25 fixed,
3 partly, 1 superseded, 1 reversed and 1 not a bug by your decision, and 1
deferred.

- **Who may do what is enforced in the API, not just hidden in the UI**
  (see §3.1).
- **The team page is read-only.** Teams ask the queue desk in person.
- **Two-part writes are atomic:**
  - Reassigning a request moves the request and its team together.
  - A panel's division change saves the panel, team releases and roster in
    one transaction. It refuses to release a team that has a live request.
- **Judge sessions** end when the panel's code changes or a new Bangkok day
  starts (see §3.3).
- **Flag corrections** are limited to the head referee and the Judge Advisor.
- **Score taps** in quick succession read the stored score back, so the
  total can't go stale.
- **Panel codes** come from `crypto.getRandomValues`.

---

## 3. Core logic

### 3.1 Roles and permissions (enforced in the API)

| Role | Signs in with | Create request or booking | Change early booking | Move interview status | Notes and scores | Awards |
|---|---|---|---|---|---|---|
| Team / public | nothing | — | — | — | — | — |
| Queue desk | `QUEUER_CODE` + name | any team | cancel, reschedule, ready-now (requested or scheduled only) | — | — | — |
| Judge | the panel's code + name | — | — | own panel: on the way → started → finished | own panel | nominate completed, non-conflicted teams on own panel; withdraw own |
| Referee | `REFEREE_CODE` + name | — | — | — | — | (their Good conduct flags count, §3.6) |
| Head referee | `HEAD_REFEREE_CODE` + name | — | — | — | — | as referee |
| Judge Advisor | `ADMIN_CODE` (up to 4) | any team | anything | anything, incl. reset and reopen; correct step times | all | everything: see, nominate any team, remove any nomination, decide winners |

- The JA is second in command of the whole event. The head referee heads the field.
- Only the JA can reopen a completed or cancelled request.

### 3.2 How an interview moves

```
Booked (scheduled) ─┐
                    ├─▶ Requesting ─▶ On the way ─▶ Interviewing ─▶ Complete
Walk-up request ────┘   (orange)      (blue)        (violet)        (green)
```

- **Two ways in.** Request now (the walk-up queue) or book a time (a slot on
  the team's panel, 20 minutes by default).
- **Hard rules in the data layer.** One live request per team; one team per
  panel slot; a 20-minute gap between bookings on a panel; no booking a slot
  that has already ended.
- **Ready now.** A booking turns into a queue request in one step, freeing its slot.
- **Compare-and-set.** Every status change sends the status it was based on.
  If another screen moved the request first, the change is refused with a
  409 instead of overwriting it.
- **Colours** are the same everywhere: grey booked, orange requesting, blue
  on the way, violet interviewing, green complete.

### 3.3 Sessions and codes

- **Format.** A session is a signed cookie, valid for up to 16 hours.
- **Judges.** A judge's cookie also carries an HMAC of the panel's current
  code and the **Bangkok calendar day**. Changing the panel's code, or
  midnight in Bangkok, ends it.
- **Code rotation.** Moving a judge off a panel, or removing one, gives that
  panel a **new code**, which signs everyone on it out. The JA screen shows
  the new code.
- **Production safety.** Production refuses the dev codes and a placeholder
  `SESSION_SECRET`. Sign-in is rate-limited.

### 3.4 Conflicts

- **Declared per judge**, ideally before panels exist. A judge roster holds
  each judge's conflicts.
- **Inherited by panels.** A panel inherits all its judges' conflicts, using
  one rule: `panelBlocks` in `src/lib/roster.ts`. A conflicted team can't be
  assigned to that panel, and a judge on it can't see the team's notes or nominate it.
- **Name matching.** Judge names match trimmed and case-insensitive:
  `judgeKey`.

### 3.5 Team page "today"

- "Earlier today" lists only requests from the current **Bangkok event day**
  (`sameEventDay`).
- With no live request, the page shows the team's latest request from today
  only. A team last interviewed on another day reads "No request yet".

### 3.6 Awards (2.2)

- **The awards.** 11, in presentation order, from `config/event.json`:
  Excellence, Design, Innovate, Think, Amaze, Build, Create, Judges, Inspire,
  Sportsmanship, Energy.
- **Decided per division.** Divisions are a hard wall.
- **A nomination** is one row: award, team, panel, the nominator's name,
  an optional reason (≤500 characters), and a role (`judge` or `admin`).
- **Judges nominate** right after Finish, or later from the Done list.
  - The team must be on their panel, have a completed interview, and have
    no conflict with that panel.
  - Each chip tap saves at once, and reverts if the save fails.
  - Two judges on one panel nominating the same team show as "×2".
- **One judge, one nomination.** "Dana", "dana" and " Dana " are the same
  judge (the `judgeKey` rule). Re-nominating under another spelling updates
  the one row; any spelling can withdraw it.
- **Good conduct counts toward Sportsmanship.**
  - A team with **2 or more Good conduct flags** counts as a Sportsmanship
    nominee, shown with a green dot. The rule is in `src/lib/awards.ts`.
  - Referees don't nominate directly (your decision).
  - A team with Good ×2 and a DQ or Major flag is still a nominee. The side
    panel shows the worst flag in amber as a warning.
- **The Judge Advisor can nominate and remove** (to move teams into the
  right award).
  - Nominate **any team in the division** for any award, with no interview
    needed: "Add team…" in By award, "Also nominate for…" in the side panel.
  - **Remove any nomination**, a judge's or its own. It asks first. A
    removed judge nomination disappears from that judge's screen too.
  - JA nominations have no panel, show as "JA", appear under All panels only,
    and are never sent to judges.
- **Winners**, one per award and division, are set by the JA only.
  - The team must be in that division and nominated: by a judge, by the JA,
    or, for Sportsmanship, through Good conduct ×2.
  - "Already has …" is a **warning, not a block**.
  - Replacing or clearing a winner asks first.
  - With nothing nominating the selected team any more, the Give button
    gives way to "Nominate for <award>".
- **Secrecy.**
  - Nominations and winners are **never in `/api/state`**, which teams, the
    desk and the public board read.
  - `/api/awards` gives the JA everything. A judge gets only their own
    panel's judge nominations, with no `winners` key. Everyone else gets 403.
  - The Activity tab, where award changes are logged, is JA-only.
- **The board.**
  - **Matrix:** nominated teams × nominated awards; empty award columns are
    hidden and named under the table.
  - **By award:** every award, marked Decided, N nominees or Open.
  - **Side panel:** judges' and the JA's reasons, Good conduct flags, other
    nominees, and Give / Clear winner. It becomes a bottom sheet on phones.
  - **Rail count:** "decided / 11" for the open division.

### 3.7 Judge Advisor Teams drawer (2.2)

- **No live request:** Request · English / Request · Thai (queue now), or
  Book a time on the team's panel, using the desk's slot grid and rules.
- **Booked:** the field shows the slot time, with Change time (reschedule)
  and Cancel booking (asks first).
- **Walk-up:** the same field reads **Requested** with the time, e.g. "Requested 4:00 PM".
- **Step times.** The JA can correct each step a request reached (requested,
  on the way, started, finished, cancelled), through a JA-only `set-times`
  action.
  - The times must be on the request's own Bangkok day and in order. The
    status isn't touched.
  - The change is compare-and-set like other status changes, and logged as
    e.g. "corrected times: finished 15:25 → 15:40".
  - The rules live in `src/lib/stepTimes.ts`, shared by the server and the drawer.
- **Unchanged:** "Reset to…" for status.

---

## 4. Data and API changes

### 4.1 Storage

Both stores are kept in step: Postgres (tables created and migrated on start)
and the JSON file `.data/state.json`. Conformance tests run against the file
store everywhere, and against Postgres only with `TEST_DATABASE_URL`.

- **Judge roster** with per-judge conflicts.
- **Activity** entries carry a kind, the actor's role and the team number.
  Kind `award` is new.
- **`nominations`** (2.2):
  - A unique index per judge on (award, team, panel, lower(btrim(judge))),
    applied after a migration that removes duplicates.
  - A `role` column, plus a partial unique index for JA rows (no panel).
- **`award_winners`** (2.2): unique per (award, division).
- **Deletes and resets.** Deleting a team removes its nominations and winner.
  Deleting a panel leaves its nominations with no panel. A day reset clears
  nominations and winners, the same way it clears scores.

### 4.2 Routes added or changed

| Route | Change |
|---|---|
| `POST /api/requests` | Queue desk or JA only. |
| `PATCH /api/requests/[id]` | Role gates per action. `reassign` is atomic. `reopen` is JA only. **`set-times`** is new and JA only. |
| `PATCH /api/flags` | Head referee or JA only. |
| `GET/POST/DELETE /api/awards` | New. Scoped GET; judges and the JA nominate; judges withdraw their own; the JA removes any by id. |
| `PUT/DELETE /api/awards/winners` | New. JA only. |
| `/api/state` | Unchanged in shape. Has no award data, and never will. |

---

## 5. Your decisions along the way

- Teams are read-only. They ask the queue desk in person.
- The desk may change any early booking, whoever made it.
- Conflicts belong to judges, not panels.
- Booked board tiles stay plain, with no "due soon" cue.
- The All teams list at the desk narrows to the picked team until the box is cleared.
- Awards: "Already has …" warns and doesn't block; no notebook-eligibility rule.
- Awards: no referee nominations. Good conduct ×2 counts toward Sportsmanship instead.
- Awards: a DQ or Major next to Good conduct is a warning only.
- The JA books, reschedules and corrects times in the Teams drawer; judges stay as they were.
- The JA may nominate any team and remove any nomination.
- "Earlier today" means today only, in Bangkok time.
- `FULL_APPLICATION_BUG_AUDIT.md` is kept, with a status table.

---

## 6. Review and checks

- **Reviewed and passed:**
  - Every v2.0 page, by a separate reviewer session.
  - The audit and its follow-ups (group A).
  - The four Awards commits (group B). The one finding there, judge names,
    was fixed in `21cdf19`.
  - The re-review of `21cdf19`, `6184d08` and `333b49d`.
  - `fb3aae3` (Teams drawer) went to the reviewer, but its verdict isn't
    recorded here.
- **Not sent to the reviewer:** `869f5da` (the Requested time) and `6e96ace`
  (JA nominations); both were covered by the pre-launch reviews below.
- **Pre-launch reviews (2026-10-26):**
  - Security review of the whole branch: no exploitable findings.
  - Correctness review: 8 findings. The top three were fixed in `3e8fd0b`:
    the Postgres migration now runs in one transaction behind an advisory
    lock, the reschedule Activity line uses Bangkok time, and the team page's
    "today" uses the same clock as its history. The other five are in §7.
  - Over-engineering review: about 1,250 lines of dead code, the duplicate
    `supabase/schema.sql` / `seed.sql` and overlapping docs removed in `3068de7`.
- **Checks before release:** 1583 tests (1582 pass, 1 skipped); typecheck,
  lint and build clean in a clean worktree. Against a real Postgres (Neon):
  1642 tests, all pass, none skipped.
- **Browser walk-throughs** on copies of the data, at 1280 and 375, in dark
  and light, for every feature above; then on the Vercel preview of PR #9 (§8).

---

## 7. Known limits and open items

**Before the next event:**
- **Database plan.** Every open screen re-reads every team, request and flag
  every 4–6 seconds. For 130 teams over two days that is roughly 6–7 GB of
  database egress per hour, about 100 GB in all: far past Supabase's free
  5 GB, inside Pro's 250 GB. Put Supabase on Pro for the event month (it also
  stops free-tier pausing and adds daily backups). See DEPLOY.md, "Free tier
  limits, honestly".
- **Load the event** on the live site (it starts empty): teams, panels, judges
  and conflicts. Have the head referee choose the program and fields once.
- **Confirm the live database** first: signed in as Judge Advisor,
  `/api/health` names the database host. Between the merge and a later redeploy
  the live team count went from 20 (old test rows) to 0, and the cause wasn't
  pinned down.
- Run `TEST_DATABASE_URL=… npm test` again after any change to
  `src/lib/db/postgres.ts`.

**Known and accepted:**
- **Team page wording.** After "Interview complete — thank you!" the page
  still says "Please ask the queue desk to request a judge…".
- **Referee names are typed, not verified.** Referees share one code, which
  affects flag authorship.
- **A shared panel code** lets anyone who learns it in. Removing one judge
  signs the whole panel out.
- **Awards panel filter:** a single-panel filter hides flag-only and JA-only
  nominees. They show under All panels.
- **Withdrawn winners.** A judge can withdraw under a standing winner; the
  board shows "Withdrawn".
- **Old file data.** Nominations saved before `21cdf19` aren't de-duplicated
  on load. Your real data has none.
- **Teams drawer:** unsaved time edits reset if the request changes, and
  aren't warned about on close. The booked time uses device time, while
  Times uses Bangkok time; they agree on a Bangkok device.
- **Unlikely Postgres code collision.** Panel-code rotation doesn't check
  other panels' codes (1 in 32⁸).

**Open from the correctness review** (real, not fixed before release):
- A Judge Advisor reopen of a cancelled booking keeps its slot and skips the
  20-minute gap; if the slot was re-booked, the error wrongly says the team
  already has a live request.
- A judge can nominate a team that a different panel interviewed (after a
  reassignment).
- Preset panels in `config/event.json` would get their slot times in the
  server's timezone (UTC on Vercel). Latent while the list is empty.
- `/api/state` returns the raw database error to anyone when the database is
  down.

(The fifth, the Bangkok-day formatter copied three times, went in the cleanup.)

**After this event:**
- Cache the full state on the server for a second or two, so many screens
  share one database read: about 5–10× less egress.

**Deferred:**
- BUG-027 (Postgres TLS verification).
- BUG-018b (retiming a panel's slot grid with bookings already on it).
- BUG-013 (individual referee codes).
- The open audit question on what the public `/api/state` should carry.

**Open questions for you:**
- Middle School ring colour vs the interviewing violet on the board.
- From PR #8: "Match affecting" appears once a rule is picked; DQ has no
  confirm step; the DQ chip colour in dark mode.
- Judge console polish, only if wanted: the row "×" label, "0 / 76" for an
  unscored team, long category text at 320–375px.

---

## 8. The launch (2026-10-26)

**Vercel settings made for 2.0:**
- `HEAD_REFEREE_CODE` added for Production and Preview.
- Preview's `DATABASE_URL` points at a separate Neon test database, so PR
  previews never touch the live Supabase.
- Function Region set to **Singapore (`sin1`)**, next to the Supabase database
  (`ap-southeast-1`). Requests went from about 1 second (`sin1::iad1`) to
  about 0.2 seconds (`sin1::sin1`).

**Preview walk-through** (PR #9 preview, separate database, test team `TEST1`),
all passed:
- Door page, `/api/health`, Live board, team ticket and read-only team page.
- Judge Advisor: import, roster judge, panel, booking slots, Awards (give
  Design), Scores, Activity (all 11 events, Bangkok time).
- Queue desk: book a slot, then ready-now into the queue.
- Judge: on the way → interviewing → complete; two quick score taps saved
  as 3/76; nominate for Design; the judge's award data has no winners.
- Head referee: day setup (VIQRC, 3 fields), match Q1 field 1, Good conduct
  flag, Edit rights on flags.
- Phone width (375) in light and dark; nothing spills sideways. The shared
  state carries no award data and no panel codes.

**Merge and release:** PR #9 merged as `dc84741`; production deployed at
14:20 UTC. Live checks: the 2.0 door page, `/api/health` OK (2.0's schema
changes applied to Supabase), no award data or panel codes in the public
state.

**Rollback** if ever needed: Vercel → Deployments → the last Version 1
production deployment → ⋯ → Instant Rollback. 2.0's database changes only
add tables and columns, so Version 1 should keep running on them (not tested).
