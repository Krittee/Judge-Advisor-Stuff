# Version 2.1.0 — Coordinator role + team interview language — implementation prompt

Paste everything below the line into a Claude Code session opened in this repo
(or say: "Implement design/coordinator-redesign/PROMPT.md").

---

Build Version 2.1.0 on the `version-2.1.0` branch: a per-team **interview
language** (EN, TH or both) and a new **Coordinator (CO)** role with its own
phone console and a door on "/". The design is final: match it, don't
redesign it. Commit locally only. Never push.

**Commits, in order** (each one local commit with `npm test`, `tsc`,
`eslint` and `npm run build` green):
1. Team language: data, API, JA Teams tab, Floor picker, auto-assign.
2. Team language on the queue desk and the public team page.
3. Coordinator role: auth, sign-in, permissions, activity label.
4. Coordinator console `/coordinator` (direction B, "Teams + Slots").
5. Door page: the sixth door.

## Sources

- **Visual spec:** static mocks in `design/coordinator-redesign/`, dark
  unless noted (each takes a `theme` prop for light):
  - `reference-language-co.dc.html` (790 wide, two phones). **Left:** the
    CO team list with the `EN` / `TH` toggle chips (direction A, "Two
    chips", **chosen for the CO**). **Right:** the queue desk team card and
    the public team page header showing the team's language.
  - `reference-language-ja.dc.html` (1280): the JA Teams tab with the
    language count strip, Lang column, caution on a panel that doesn't
    cover the team, and the English | Thai | Both switch in the drawer
    (direction C, "Pit sweep", **chosen for the JA**). Use only its
    language parts; the rest of that board is today's Teams tab and is
    already built.
  - `reference-console.dc.html` (790 wide, two phones): the CO console,
    direction B, **Teams** tab (one row opened inline) and **Slots** tab
    (one panel's day, a slot picked, pinned Book bar).
  - `reference-door-phone.dc.html` (375, light) and
    `reference-door-wide.dc.html` (1280, dark): "/" with the Coordinator
    door.
  These are self-contained HTML mocks (`{{hole}}` template, not React).
  Read their `<style>` blocks for sizes, spacing and colours and their
  markup for structure and copy. Team data in them is sample data. Where a
  mock and this file disagree, this file wins.
- **Live canvas:** https://claude.ai/artifact/Nhv45XWtvnnjLwCC768jWc, rows
  "v2.1 · Team interview language", "v2.1 · Coordinator console" and
  "v2.1 · Door page". Boards titled "Not chosen" are ignored; in the
  console row only **B** is chosen.
- **Code to copy patterns from:** `src/components/Language.tsx`
  (`LanguageTag`, `LanguageCover`, `hasLanguageGap`), `src/app/queue/page.tsx`
  + `src/components/desk/*` (lookup, request buttons per language,
  `DeskSlots` grid, `deskLogic`), `src/lib/data.ts` (`buildSlots`,
  `liveRequestFor`), `src/components/admin/TeamsTab.tsx` +
  `teamsLogic.ts`, `FloorTab.tsx` + `floorLogic.ts`, `src/lib/auth.ts`
  (roles, `resolveCode`, the permissions table), `src/lib/server-state.ts`
  (what each role sees), `src/components/door/DoorPage.tsx`,
  `src/components/SignInForm.tsx`, `src/components/nav.tsx`.
  `grep -rn queuer src` lists every place a role list matters.

## Look (unchanged rules)

Archivo + Fira Sans, OKLCH tokens, dark by default, light must work. No
playful motion. **Colour is signal:** status colours only for status
(orange waiting, blue on the way, violet interviewing, green complete, grey
booked), caution for warnings, accent for interactive chrome. **Language is
not a status:** tags are neutral (`LanguageTag` style); a selected language
control is accent like any selected control. "Not asked" is muted, never
caution by itself. Touch targets ≥44px on phone, ≥32px on desktop.
Tint mixes use `color-mix(in srgb, …)`. Styles go in `globals.css` under a
page-scoped class, like the other consoles.

## 1 · Team language — data

- `Team.languages: string[]` in `src/lib/types.ts`, same shape as
  `Panel.languages`: `[]` = not asked yet, `["en"]`, `["th"]`,
  `["en","th"]` = both. Ids come from `config/event.json` `languages`;
  unknown ids are dropped on write, order follows the config.
- Postgres: `alter table teams add column if not exists languages text[]
  not null default '{}'` in the migration list, plus the selects/inserts
  (`src/lib/db/postgres.ts`). File store: default `[]` when the field is
  missing on read (`src/lib/db/file.ts`). Existing data loads unchanged.
- One helper next to `hasLanguageGap` in `Language.tsx` (or a server-safe
  lib file if the server needs it):
  `teamFitsPanel(team: string[], panel: string[]): boolean` = true when
  either list is empty or they share an id. Everything below uses it; a
  misfit is flagged, never blocked.
- One write path for both roles: `PATCH /api/team-language` with
  `{ teamId, languages }`, allowed for `admin` and `coordinator` only
  (403 otherwise). Writes an activity entry ("Language for 7700B: Thai").
  The JA's other team edits stay on `/api/admin/teams`.
- **Import:** unchanged. A re-import never clears `languages`.

## 1 · Team language — Judge Advisor (direction C, "Pit sweep")

From `reference-language-ja.dc.html`:
- **Count strip** under the panel-load chips: `Language` label, then
  `EN n`, `TH n`, `Both n`, `Not asked n` as `aria-pressed` filter
  buttons (one at a time; pressing the pressed one clears it). Counts follow
  the other filters (division etc.). "EN" counts teams whose list is exactly
  `["en"]`; "Both" counts both. This is the Teams tab's language filter;
  no separate select.
- **Lang column** after Div: neutral tag `EN`, `TH`, `EN + TH`, or muted
  "Not asked". The header reads "Lang" with `title="Interview language"`.
- **Panel cell:** a caution triangle (with an accessible label "Panel 3
  doesn't cover English") when `!teamFitsPanel`.
- **Drawer:** "Interview language" radiogroup `English | Thai | Both`
  above "Judge panel", plus a quiet "Clear" (sets `[]`). Saves on change
  through `/api/team-language`, like the drawer's other immediate edits.
  The Judge panel hint adds "Covering English: Panel 2" (the compatible
  panels that fit); a caution line under the select when the chosen panel
  doesn't fit, ending "You can keep it."
- **Auto-assign:** prefers, within the division and without conflicts, the
  least-loaded panel that fits the team's language; falls back to today's
  choice when none fits. Add "Matches language where it can." next to the
  button. Both stores (`autoAssignTeams` in file and postgres).
- **Floor "Move to panel…"** popover (not mocked): each panel option shows
  its language tags; an option that doesn't fit the team gets the caution
  word "Doesn't cover TH". Still selectable.
- Phone layout of the Teams tab: the strip wraps; the tag sits on the
  team's row; the switch is in the edit sheet in the same place.

## 2 · Team language — queue desk and team page

From the right phone of `reference-language-co.dc.html`:
- **Desk team card:** the team's language as a read-only tag next to the
  lookup line. Request buttons: the team's single language is the primary
  (filled) button, the other is outlined underneath; "both" or not asked
  keeps today's equal buttons. The Book language select defaults to the
  team's first language when the team has one (else today's default). The
  desk still can't change the team's language.
- **Public team page** (`src/components/team/TeamView.tsx`): one line in
  the header card: "Interview in English", "Interview in Thai" or
  "Interview in English or Thai", with the tag(s). Nothing when not asked.

## 3 · Coordinator role

- `ROLES` gains `"coordinator"`; `Session` gains
  `{ role: "coordinator"; name: string }`. Code from env
  `COORDINATOR_CODE`, dev default `COORD1`, resolved in `resolveCode`
  after the queue desk. Default name "Coordinator". Sign-in at
  `/coordinator/login` (same `SignInForm`, `CREW` gets the role; avatar is
  the placeholder box until the user supplies art — no image, a dashed
  rounded box like the door). Sign out back to `/coordinator/login`.
- **Permissions** (update the table comment in `auth.ts`):
  `coordinator: create = yes; advance = no; cancel = no; notes = no;
  admin = no`, plus `team language = yes`. Concretely:
  - `POST /api/requests` (request now, book a slot): allowed, same
    validation as the desk. Only for a team with **no live request**:
    a team already waiting or booked is refused (409, "Already booked —
    the queue desk can change it.").
  - `PATCH /api/requests/[id]` (cancel, reschedule, ready-now, advance):
    refused. `canCancel` stays desk + JA.
  - `PATCH /api/team-language`: allowed.
  - Everything else (admin routes, notes, scores, flags, awards): refused.
- **What the CO sees** (`server-state.ts`): like the desk, but **without**
  the messages teams leave for judges (as the referee). Staff fields on.
- Activity: `actorLabel` → `coordinator:<name>`; `ROLE_NAMES` gets
  "Coordinator", so the Activity tab shows it as the actor's role.
- Nav / board role switches (`nav.tsx`, `boardLogic.ts`): treat it like
  the desk (it's staff, not a judge).
- Tests: extend the auth/permissions tests for every rule above (one
  runtime test per route decision is enough).

## 4 · Coordinator console `/coordinator` (direction B, "Teams + Slots")

Phone-first (375), works wider by centring at the phone width like the
desk. From `reference-console.dc.html`. Polls with `useAppState(4000)`.

- **Top bar:** placeholder avatar box, "Coordinator" + event line, Live
  indicator and sign-out as on the desk.
- **Bottom tab bar** (64px, two tabs, icon + label, `aria-current="page"`
  on the active one): **Teams** and **Slots**. The tab is in the URL
  (`?tab=slots`) so a reload keeps it.
- **Teams tab** (left phone + `reference-language-co.dc.html` left phone):
  - Search (team number or name, number input filtered like the desk's),
    division select, "Not asked n" toggle.
  - Every team: number, name, division, pit, status pill (status fill + ink
    pairs, as the board), and the `EN` / `TH` toggle chips (46×44). Tapping
    a chip saves at once (`/api/team-language`); both lit = both; none lit
    = dashed chips + muted "Ask". Failed saves show the desk's error banner
    and the chip reverts.
  - Tapping the row (not the chips) opens it inline: "Request · Thai"
    (primary, the team's language) and "Request · English" (outlined),
    "Panel 3 interviews in Thai" (`LanguageCover`), and an accent "Book a
    time" text button that switches to Slots with this team chosen and its
    panel shown. One row open at a time.
  - Not asked: the request buttons are disabled with "Set the language
    first".
  - No panel: buttons disabled, "No panel yet — the Judge Advisor assigns
    one."
  - Waiting or booked: no buttons; the status pill plus the muted line
    "To change it, ask the queue desk."
  - Success / error banners: the desk's wording.
- **Slots tab** (right phone):
  - Panel switcher chips (Panel 1 … n), defaulting to the chosen team's
    panel, else the first. Header: "Panel 3 · MS", its language tags,
    "7 of 11 open".
  - One row per slot today, past slots left out (as `DeskSlots`): time,
    then either the team holding it with its status pill (read-only, no
    cancel/move) or "Open" with an outlined "Book" button.
  - "Book" is enabled only when a team is chosen **and** the slot is on
    that team's panel. Pressing it picks the slot (accent border, filled
    "Picked"); the pinned bar above the tab bar reads "Booking for
    **7700B** · TH" with "Book 10:40". Booking language = the team's
    language; for "both", the first of its languages the panel covers.
  - No team chosen: the pinned bar reads "Choose a team on the Teams tab"
    and Book buttons are disabled.
  - Too-close / taken states and their wording: reuse `deskLogic` /
    `SlotPicker` helpers (`TOO_CLOSE_TITLE`, `takenTitle`,
    `noSlotsLeftLine`).
- The CO never sees notes, scores, messages, cancel, reschedule or undo.

## 5 · Door page "/"

From `reference-door-phone.dc.html` / `reference-door-wide.dc.html`: a
sixth door **Coordinator**, after Queue desk, line "Walk the pits:
languages and bookings", `href="/coordinator/login"`. Its avatar spot is
the same size and radius as the others, a 1.5px dashed border in `--rail`,
empty — the user will draw the icon later. Add a `placeholder` flag to the
`Door` type rather than reusing `ring: null` (that means "Team door" and
drives the "Opens the team ticket" caption). Wide layout: 3 × 2 doors.
Update `tests/doorPage.*` for six doors.

## Keep (must not regress)

- The desk's permissions and flows; "request now while booked" stays
  desk-only.
- Divisions are a hard wall; conflicts are per judge; a language misfit is
  only ever a caution.
- Import keeps existing values for blank cells.
- `SlotPicker`'s default output (pinned by
  `tests/slotPickerVariant.runtime.test.tsx`).
- Test on a copy of the data (`DATA_FILE`), never the user's `.data`.
