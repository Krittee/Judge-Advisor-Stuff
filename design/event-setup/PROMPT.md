# Version 2.2.x — Event setup + blended awards — UI implementation prompt

Paste everything below the line into a Claude Code session opened in this repo
(or say: "Implement design/event-setup/PROMPT.md").

---

Build the **UI** for event setup and blended awards: the Judge Advisor's new
**Event** page (Setup group), the **Awards tab** in a blended event, and the
**Awards Desk** with a saved setup. The design is final: match it, don't
redesign it. Commit locally only. Never push, open a PR or deploy.

**Behaviour source of truth:**
`docs/superpowers/specs/2026-11-20-event-setup-blended-awards-design.md`.
**Server side** is built on branch `claude/blended-backend-c6182b`
(plan `docs/superpowers/plans/2026-11-20-event-setup-blended-backend.md`):
`EventSetup`, `AppState.eventSetup`, `PUT /api/event-setup`,
`src/lib/eventSetup.ts` (`WHOLE_EVENT`, `setupDivisions`, `awardKeys`,
`awardKey`, `awardsUnder`, `scopeKeys`, `awardPairs`, `divisionChoices`,
`setupLabel`), `ReleasedView.setup` / `.sections`. Build on top of it; don't
change its rules. The plan's **Task 5** (`awardsLogic.ts`: `format` on
`decidedCount`/`decidedText`/`readyToSend`/`notReadyLines`/`detailFor`,
`heldByTeam`, `division` on `giveAfterAsking`/`clearAfterAsking`,
`nominationsIn`/`conductIn` for `WHOLE_EVENT`) is the logic this UI calls: if
it hasn't landed on that branch, build it first exactly as the plan states
(its own commit and tests). Where a mock and this file disagree, this file wins.

**Commits, in order** (each a local commit with `npm test`, `tsc`, `eslint`
and `npm run build` green):
1. JA console: the Event page + rail item + event title in the top bar.
2. JA Awards tab in a blended event (direction **C · Award order**).
3. Awards Desk with a saved setup (+ the snapshot's team division, below).
4. Pass `state.eventSetup?.format` to the client `divisionsCompatible`
   callers (`conflictsLogic.ts`, `teamsLogic.ts`, `floorLogic.ts`) and offer
   `divisionChoices(setup, …)` in the Teams / Panels division pickers and the
   Import preview (a blended panel defaults to "Whole event").

**No setup saved = today, pixel for pixel.** Every change below is gated on
`state.eventSetup` (desk: on `view.setup`). A **Standard** setup keeps
today's per-division screens, using the setup's divisions.

## Sources

- **Visual spec** (static mocks, dark; each has a `theme` prop for light;
  light must work too):
  - `reference-setup-wide.dc.html` (1280): the Event page, **C · Four tiles
    + preview**. Top frame: saved VEX IQ · Blended. Bottom frame: VEX IQ ·
    Standard picked, refused because awards are decided.
  - `reference-setup-phone.dc.html` (3 × 375): not set yet · saved ·
    V5RC · Blended picked, refused because of Elementary School teams and a
    panel.
  - `reference-awards-wide.dc.html` (1280): the Awards tab, blended, **C ·
    Award order**, By award, side panel on Design · Elementary School.
  - `reference-awards-phone.dc.html` (2 × 375): split Excellence/Design
    cards · whole-event awards.
  - `reference-desk-wide.dc.html` (1280) and `reference-desk-phone.dc.html`
    (2 × 375: blended with "Whole event" pinned · V5RC · Standard).
  These are self-contained HTML mocks (`{{hole}}` template, not React). Read
  their `<style>` for sizes, spacing and colours, their markup for structure
  and copy. Team data, panel names, quotes and counts are sample data.
- **Live canvas:** https://claude.ai/artifact/Nhv45XWtvnnjLwCC768jWc, rows
  "v2.2 · Event setup + blended awards · 1/2/3". Only boards marked
  "(chosen)" count; A and B are not chosen, ignore them.
- **Code to copy patterns from:** `src/components/admin/AdminFrame.tsx`
  (`SECTION_GROUPS`, rail counts, phone section bar), `src/app/admin/page.tsx`
  (tab switch), `src/components/referee/EventSetup.tsx` (pressed cards with
  a check), `src/components/admin/AwardsTab.tsx` + `awardsLogic.ts` +
  `useAwards.ts` (Send / Sent · Recall / lock / Send all ready, the
  `write()` one-at-a-time guard, side panel / sheet),
  `src/components/marketing/AwardsDesk.tsx` + `marketingLogic.ts`,
  `src/components/ui` (`Banner`).

## Look (unchanged rules)

Archivo + Fira Sans, OKLCH tokens, dark by default, light must work. No
playful motion (colour/background `transition` only). **Colour is signal:**
green (`--done`) = sent / fine; **caution** = blockers, "Marketing had …",
"Already has …", "Changed — was …"; danger = refused writes (existing
`Banner`); muted = not set / not ready; **accent blue = interactive chrome
only** (buttons, links, focus, the picked tile and pressed chips). Never
colour alone: every state has words or an icon. Touch targets ≥44px phone,
≥32px desktop. Tints: `color-mix(in srgb, …)`. JA styles go inside the
existing `@ja-block` blocks (`/* @ja-block awards */` for the tab, a new
`/* @ja-block event */` for the page) so `tests/adminCssScope.test.mjs`
passes; desk styles stay under `.mk-*`. Division tags (ES / MS / HS) reuse
the existing small neutral tag (`divisionTag()`), never a colour per division.

## 1 · JA console: the Event page

**Rail.** `AdminTab` gains `"event"`. `SECTION_GROUPS` Setup becomes
**Event**, Teams, Panels, Conflicts, Import (today's code order plus Event
first; the mocks show Conflicts under Live from an older board: follow the
code). Icon: the mock's calendar stroke icon. No count. The phone Sections
menu and section bar follow automatically. The Awards rail count: with a
blended setup it is event-wide decided "12/13" (`decidedText` over every
scope key); otherwise as today.

**Top bar event title.** When a setup is saved, the wide top bar shows, after
the JA identity and a hairline divider, the brand mark + "Judge Queue" +
muted `setupLabel(setup)` ("VEX IQ · Blended"), as in the mock. On phone, the
section bar shows the muted `setupLabel` at its right on the Event page only.
Nothing when no setup.

**Page** (`EventTab.tsx`, pure helpers in `eventLogic.ts`). Header "Event
setup", intro "Pick what this event runs. It decides the divisions and how
awards are given."

- **Not set yet** (no `state.eventSetup`): a neutral info notice first: "Not
  set up yet. The event uses the divisions from the config (<presetDivisions
  joined ", ">) and gives every award once per division, as today." No tile
  picked. The preview reads "Pick a program and format to see the awards.";
  no checklist; Save disabled with the hint "Pick a program and format to
  save."
- **Tiles**: one radio group (`role="radiogroup"`, each tile a
  `role="radio"` button with `aria-checked`, arrow keys move) of
  `programs × [Standard, Blended]` in config order: VEX IQ · Standard,
  VEX IQ · Blended, V5RC · Standard, V5RC · Blended. 2 × 2 on wide, one
  column on phone (each ≥64px). Each tile: title (Archivo), divisions joined
  " + ", muted line — Standard: "<11 × n> awards · every award per division";
  Blended: "<d × n + w> awards · Excellence and Design per division, <w> for
  the whole event" (compute from config: d = awards with
  `blendedScope: "division"`, w = the rest, n = the program's divisions;
  name the d awards by label). The **saved** tile carries a small green
  "Saved" tag (tick + word); the **picked** tile has the accent border + check.
  Pre-pick the saved one.
- **Preview** (right column on wide, a compact block under the tiles on
  phone), title "On the Awards tab and the Awards Desk": for the picked tile,
  one group per `scopeKeys(divisions, format)` with its award labels
  (`awardsUnder`), Judges shown as "Judges (2)" when `places > 1`; wide uses
  neutral chips with "N awards" at the right, phone uses one text line per
  group. Blended adds the muted line "Any panel can interview any team."
- **"Before you can save"** checklist (only once something is picked and
  differs from the saved setup; when the picked tile equals the saved one,
  show all three rows green). Three rows, icon + label + words:
  - **Awards** — fine when no winner, no "No winner" and no `sent` release
    (from `/api/awards` and `/api/awards/released`, loaded when the page
    opens): "none decided". Else caution: "**Clear the awards first.** <x> of
    <y> decided, <s> sent to Marketing." + link "Open Awards" (switches tab).
  - **Teams** — fine when every team's division is in the picked program's
    divisions: "all in the program's divisions". Else caution "<n> teams are
    in <division(s)>, which <program> doesn't have" + the list (number in
    Archivo, name, division tag) + "Open Teams".
  - **Panels** — same test against `divisionChoices(next, true).options`;
    caution "<Panel name> · <division>" lines + "Open Panels".
- **Save** "Save event setup" (accent), disabled while any row is caution or
  nothing changed, with the muted hint "Fix the items above to save." when
  blocked. No confirm (nothing decided means nothing is lost). PUT
  `/api/event-setup` `{ program, format }` inside a one-at-a-time guard
  ("Saving…"); on 200 reload state. On 409 show the server message in the
  danger `Banner` and, when the reply has `outside`, refresh the checklist
  from it (names from `state.teams` by id). The client checks are a
  convenience; the server is the rule.
- Footer muted "Set by <set_by> at <HH:MM of updated_at>" when saved.

## 2 · JA Awards tab in a blended event (direction C, "Award order")

Only when `state.eventSetup?.format === "blended"`; Standard and no setup
keep today's tab.

**Filter bar.** The Division chips are replaced by **"Nominees from"**: All ·
ES · MS (one per setup division, `divisionTag` labels with the full name as
`title`; pressed = accent chrome; default All; kept in component state). It
only filters nominee rows (by the team's division); decisions, winners and
Send controls always show. Panel chips, Matrix | By award and **Send all
ready (N)** stay as built (N = `readyToSend(..., format)`, event-wide).

**Meta line.** "<setupLabel> · <panel or all panels> · **12 of 13** decided
· <nominations text> · **8** sent to Marketing" (counts over every scope key).

**By award.** One column of blocks in config order (the ceremony order):
- **Per-division awards** (`blendedScope: "division"`, i.e. Excellence and
  Design): one block, header = award label + muted "Given once per division"
  on the right; body = **two halves side by side on wide** (one per setup
  division, divided by a hairline), stacked sub-sections on phone. Each half
  has its own sub-header (division name, its lock icon when sent, "Decided"
  line) and its own Send to Marketing / Sent 10:12 · Recall / Recalled · Send
  again / "Pick a winner to send", its own "Marketing had …" caution line,
  its own winner + nominee rows (that division's teams) and its own "Mark no
  winner" / "Clear". Every action passes that half's division as the key.
  On wide the half header stacks the division name above its send controls.
- **Whole-event awards**: one full-width block each, a small neutral
  "Whole event" label after the title, nominees from every division (each
  row with its division tag), keyed `WHOLE_EVENT`. Judges Award: two places
  for the whole event (its "Pick both winners to send" rule unchanged).
- The mock shows Build, Create, Inspire and Sportsmanship as compact
  one-line blocks only to save space: build every block in full, as today.
- "Already has <Award> · <scope>" caution on a nominee looks across every
  key (`heldByTeam`), e.g. 7700B nominated for Energy: "Already has
  Excellence · Middle School".
- Lock, disabled "Mark no winner"/"Clear" with
  `title="Recall it from Marketing first."`, Recall confirm and Send all
  ready dialog: unchanged; the dialog's lines read "<Award> · <scope> · …"
  where scope is the division or "Whole event".

**Matrix.** Rows = nominated teams from every division (number, name,
division tag), filtered by Nominees from. Columns in config order; each
per-division award gets one column **per division** headed "Excellence ES",
"Excellence MS" (a cell for a team of the other division is empty and not
clickable); every other award one column. Column tick/dash and lock as built,
per key.

**Side panel / phone sheet.** As built. Its eyebrow reads "<Award> ·
<scope>" ("Design · Elementary School", "Innovate · Whole event"); "Give …
to …" and "Clear winner" send that key; the other-nominees list shows the
key's nominees with division tags. The mock's "Not sent to Marketing yet"
note is not required.

**Phone.** Same order: "Send all ready (N)" full width, Matrix | By award,
"Nominees from" chips (three equal ≥44px buttons), meta line, then the
cards; a per-division award card stacks its divisions as sub-sections.

## 3 · Awards Desk with a saved setup

When `view.setup` is present (absent = today: program tabs, unchanged):

- **No tab bar.** The brand line reads `setupLabel(view.setup)`.
- **Event title** under the poll line: `setupLabel` (Archivo, 22px wide /
  19px phone) and one muted line: Blended "Excellence and Design for each
  division · every other award for the whole event" (name the
  `blendedScope: "division"` awards from the reply's award list, in order);
  Standard "Every award for each division".
- **Changed since sent** box: unchanged, above the sections; its line reads
  "<scope> · <Award>" ("Whole event · Innovate …" for a whole-event change).
- **Sections** = `view.sections` in order, each heading the section key with
  "N of M sent" (M = its `awardIds.length`) + progress bar, rows = its
  awards in config order with today's row states. Phone: the heading stays
  sticky ("Whole event" pins like a division).
- **Division tag on whole-event rows**: in the "Whole event" section, after
  each team name a small neutral tag (ES / MS), one line, truncating the
  name, never the number or tag; Judges' two teams each carry their own.
  This needs the snapshot to carry the team's division: add an optional
  `division?: string` to `ReleaseTeam`, written by the server when it builds
  a snapshot (the team's division at send time); old rows without it simply
  show no tag. Additive only; Marketing still sees no nominations. No tags
  in a Standard event or in division sections.
- Search: unchanged, results grouped by section.

## Tests (add; keep the rest green)

- `eventLogic`: tile list from config (4 tiles, award counts 22 / 13), the
  preview groups (blended: ES 2, MS 2, Whole event 9; standard: 11 each),
  checklist rows (awards decided → caution with x/y/s; teams/panels outside
  → their lists; all fine), Save enabled only when changed and all fine.
- Markup: not-set notice + no picked tile; saved tile has "Saved"; a 409 with
  `outside` shows the lists; rail has Event first in Setup; no setup → no
  event title in the top bar.
- Awards tab (blended): per-division block renders two halves with their own
  Send; whole-event block keyed "Whole event" (the PUT body carries it);
  Nominees from filters rows but not winners; meta "12 of 13"; Standard and
  no setup render exactly as before (existing runtime tests unchanged).
- Desk: `view.setup` → no tab bar, title "VEX IQ · Blended", sections in
  order with "1 of 2 sent" / "5 of 9 sent", whole-event row shows the team's
  tag, a row without `division` shows none; no `setup` → tabs as before.

## Not in this build

Clearing a setup back to "none" (the wipe does it), more than one event at a
time, any change to the referee setup, judges' nominating screens.
