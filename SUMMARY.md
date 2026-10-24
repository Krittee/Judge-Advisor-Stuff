# Judge Queue: summary

Judge Queue runs judging at a VEX robotics event (VEX IQ / V5RC). Teams get
interviewed by judge panels; the app keeps the queue for those interviews,
books interview times, holds the judges' rubric scores, takes referee
reports from the field, and shows everything on a live board for the room.

It is a website (no app to install) that works on phones, laptops and a TV.
State as of 2026-10-22, branch `version-2.0` (the v2.0 redesign, not yet
released; the live Version 1 is on the default branch).

---

## Who uses it

| Role | Signs in with | What they do |
|---|---|---|
| **Team** | nothing (public) | Opens `/team`, types its number, follows its status. |
| **Queue desk** | `QUEUER_CODE` (dev `DESK01`) + name | Puts teams in the queue now or books them a time; undo, reschedule, cancel early bookings. Never moves an interview on, never sees notes or scores. |
| **Judge** | their panel's code (dev `ALPHA1`) | Works their own panel's queue, interviews teams, scores them. Only their own panel. |
| **Referee** | `REFEREE_CODE` (dev `REF001`) + name | Flags what they saw on the field against a team and a rule. |
| **Head referee** | `HEAD_REFEREE_CODE` (dev `HREF01`) + name | A referee who also sets the day's program and fields, and corrects filed flags. Heads the field. |
| **Judge Advisor (JA)** | `ADMIN_CODE` (dev `JA2026`), up to 4 codes | Runs judging for the event: teams, panels, conflicts, imports, scores, activity. Second in command of the whole event. |

Permissions are enforced in the API routes, not just hidden in the UI.

---

## The pages

| URL | Who | What it is |
|---|---|---|
| `/` | everyone | **Door page**, "Who are you?": five doors (Team, Judge, Referee, Queue desk, Judge Advisor) and a Live board card whose sample tiles explain the colours. |
| `/team` | teams | **Team ticket**: type the team number, Continue. |
| `/team/<number>` | teams | **Team page**, "Status board": a big panel in the status colour, the five-step track (Booked → Requested → On the way → Interviewing → Complete), panel and judges, and "Earlier today". |
| `/board` | everyone | **Live board** for the TV: a column per panel, requesting teams first and wide, a big "N waiting for a judge" block, a Pit floor view, Hide completed, Fullscreen. No motion. |
| `/queue` | queue desk | **Queue desk**, "Now / Book": team number with a lookup line; Now = one Request button per language; Book = the panel's slot grid; reschedule and cancel; Waiting now, Booked later and All teams lists. |
| `/judge` | judges | **Judge console**, "Up next": the panel's queue, team sheets with both rubrics, scores, today. |
| `/referee` | referees | **Referee console**, "Match first": set the match, pick a team, rule and severity, Record; All teams; Today. Head referee does event setup here. |
| `/admin` | Judge Advisor | **Judge Advisor console**: Floor (every panel live), Teams, Panels, Conflicts, Referee, Import, Scores, Activity. |
| `/judge/login`, `/referee/login`, `/queue/login`, `/admin/login` | staff | One sign-in door per role. (`/login` also works, unlinked.) |

---

## How an interview moves

```
Booked (scheduled) ─┐
                    ├─▶ Requesting ─▶ On the way ─▶ Interviewing ─▶ Complete
Walk-up request ────┘   (orange)      (blue)        (violet)        (green)
```

- **Two ways in:** *request now* (walk-up queue) or *book a time* (a slot on
  the team's panel; 20-minute slots by default, back to back).
- **Ready early:** a booked team can be moved into the queue now; the booking
  turns into the request in one step and its slot frees up.
- **Judges move it on** for their own panel (acknowledge → start → finish).
  The JA can move any request, correct it, or reopen it.
- **Undo / cancel** only while nobody has picked it up yet.
- Two hard rules hold in the data layer: **one live request per team**, and
  **one team per panel slot**.

Colours mean the same thing everywhere: grey booked, orange requesting, blue
on the way, violet interviewing, green complete.

---

## What else it does

- **Interview languages.** Each event lists its languages (English, Thai);
  a team asks in one, each panel says which it covers, and a mismatch is
  flagged, not blocked.
- **Conflicts of interest.** Declared per judge before panels exist; a panel
  inherits its judges' conflicts and can't be given those teams.
- **Scoring.** Two official rubrics per team: Engineering Notebook (16
  criteria, 1–4, 64 points) and Team Interview (6 criteria, 0–2, 12 points),
  76 in all, with colour bands and rankings. Judges and the JA only.
- **Notebook category.** Developing / Fully Developed / Ungraded per team.
- **Referee flags.** Good conduct, Warning, Minor, Major, Disqualified, each
  tied to a match (Teamwork or Skills, type, number, field) and to rules from
  the VIQRC / V5RC rulebooks (`config/rules/`).
- **Pit floor.** Teams placed by pit code; the board can show the floor in the
  venue's orientation.
- **Import.** The JA imports the team list from a spreadsheet; re-import keeps
  what wasn't in the sheet.
- **Activity log.** Every change, by kind, team and who, as an hourly timeline.
- **Light and dark** themes on every page; phone-first layouts.

---

## How it's built

- **Next.js 15 + React 19 + TypeScript**, Tailwind 4 plus page-scoped CSS
  blocks in `src/app/globals.css` (`.landing`, `.doorpage`, `.teampage`,
  `.board`, `.desk`, `.judge`, `.referee`, Judge Advisor `@ja-block`s).
- **Storage:** Postgres when `DATABASE_URL` is set (tables created on first
  run), otherwise one JSON file, `.data/state.json`. Only `src/lib/db/` knows
  which.
- **Sync by polling** `/api/state` (4 s consoles, 6 s board, 304 when
  nothing changed); survives flaky venue wifi with no websockets.
- **Auth:** signed session cookie (`jose`); access codes from env vars.
  Production refuses the dev codes and a missing `SESSION_SECRET`.
- **Config:** `config/event.json` (divisions, languages, slots, notebook
  categories, pit floor), `config/rubrics.json`, `config/rules/`.
- **Code map:** `src/app/` routes and API; `src/components/<area>/` per page
  (`door`, `team`, `board`, `desk`, `judge`, `referee`, `admin`) with a
  pure `*Logic.ts` beside each view; `src/lib/` for data, auth, rules,
  rubrics, roster, conflicts.
- **Tests:** ~1350 Node test-runner tests (`npm test`), plus `typecheck`,
  `lint`, `build`. The Postgres conformance test needs `TEST_DATABASE_URL`.

Run it: `npm install && npm run dev` → http://localhost:3000 (boots with demo
data). Deploy: Vercel + a free Postgres, see `DEPLOY.md`; laptop setup in
`RUNNING.md`.

---

## Where things stand

- **v2.0 redesign:** every page above is rebuilt and reviewed (sign-in doors,
  door page, team ticket and page, Live board, queue desk with All teams,
  judge, referee and Judge Advisor consoles). All local commits on
  `version-2.0`; nothing pushed. Releasing 2.0 means merging into the default
  branch.
- **Audit pass** (`AUDIT_STATUS.md`, committed): the public team page is
  read-only (only the desk or JA can create or change requests), API
  permissions are tightened, reassignments and panel edits are atomic, and
  flag corrections are limited to the head referee and JA.
- **Known gaps:** the Postgres SQL has never run against a real database
  (run the conformance tests before an event); referee names are typed, not
  verified; team status is public to anyone who knows a number.
