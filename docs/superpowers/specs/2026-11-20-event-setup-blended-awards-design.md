# Event setup and blended awards — design

Date: 2026-11-20. Status: draft for the user's approval. Builds on 2.2.0
(Awards Desk, `docs/superpowers/specs/2026-11-19-awards-desk-design.md`).

## Why
VEX IQ and V5RC events give every award once per division. A **blended**
event (e.g. IQ Blended: Elementary and Middle School teams together) is
different: **Excellence and Design are given once per division** (so two
Excellence, two Design) and **every other award once for the whole event**,
regardless of a team's division. Interviews and judging still treat each
team by its real division.

Today "Blended" is just another division name, and every award decision is
keyed by (award, division), so a blended event can only ever have one
Excellence. The user's idea: **set the event up first** (program, format),
with the divisions inside it. That also makes Marketing's Awards Desk show
the awards the way they will be presented.

## Goals
- A JA-only **Event setup**: program (VEX IQ | V5RC) and format
  (Standard | Blended). The divisions follow from the program.
- In a blended event: Excellence and Design per division; every other award
  once for the whole event.
- Teams always keep their real division (ES / MS / HS).
- The JA Awards tab and the Awards Desk show each award where it is given:
  per division, or "Whole event".
- Send / Recall / Changed / lock / Send all ready keep working unchanged.

## Non-goals
- More than one competition at a time in one deployment (the user: "one at
  a time"; data is reset between events).
- Changing the referee setup: the referee program and field count stay a
  separate setting (the user's choice).
- Changing the Sportsmanship good-conduct rule or how judges nominate.

## Anti-goals
- A whole-event award that can be given twice (once per division).
- Live events breaking: an event with no setup saved must behave exactly as
  today.
- A second, hidden "division" on teams.

## Approaches considered
- **A · Event-wide key (chosen by the user).** Award decisions stay keyed by
  (award, division); a whole-event award in a blended event uses one fixed
  key, `WHOLE_EVENT = "Whole event"`, in place of a division name. Existing
  tables (`award_winners`, `award_no_winner`, `award_releases`) and the send
  rules are untouched.
- B · Events as records owning teams, panels and awards. Rejected: a big data
  rebuild for multi-event flexibility the user doesn't need.
- C · Keep "Blended" as a division plus a second hidden division per team.
  Rejected: every screen would need to know the special case.

## Decided
**Event setup (new):**
- Stored like `referee_setup`: one row `event_setup` (`program` label,
  `format` "standard" | "blended", `set_by`, `updated_at`), both stores, RLS
  on, cleared by the wipe. JA only (`canAdminister`) via a new route; read
  through `/api/state` for every signed-in staff role.
- `program` is one of the labels in `config/event.json` `programs` (today
  VEX IQ = Elementary + Middle School, V5RC = Middle + High School). The
  event's divisions = that program's divisions.
- **No setup saved = today's behaviour, unchanged** (config `divisions`,
  the name-based Blended division, per-division awards, the desk's program
  tabs). *(My call: keeps live data and existing tests safe.)*
- *(My call)* The setup can be saved or changed only while no award is
  decided: no winners, no "No winner", no release in status `sent`; otherwise
  `409` "Clear the awards first." Saving deletes leftover `recalled` release
  rows (their keys may no longer exist). This is deliberate: a live event
  already deciding awards with no setup keeps today's behaviour; switching
  means clearing its awards. It shows in the JA console's Setup group.
- *(My call)* Once saved, the setup's divisions are the event's divisions
  everywhere: `eventDivisions()`, panel creation, CSV import
  (`resolveDivision`) and the desk accept only the program's divisions
  ("Blended" stops being offered). Saving is refused, with the list, while
  any team or panel has a division outside the program (e.g. an Elementary
  team when choosing V5RC); the JA fixes or removes those first.

**Award scope:**
- `config/event.json` awards gain `"blendedScope": "division"` on Excellence
  and Design; every other award is whole-event in a blended event. *(My call:
  the list lives in config, so changing it needs no code.)*
- One helper decides an award's scope keys: Standard (or no setup) → the
  event's divisions; Blended → its divisions for `blendedScope: "division"`
  awards, else `[WHOLE_EVENT]`. Every place that loops award × division
  (Awards tab, `decidedCount`, winners/no-winner routes, `decisionFor`, Send
  all ready, the desk) uses it.
- Winners PUT with `division = WHOLE_EVENT`: any team in the event may win
  (the "team is in division X" check applies only to real divisions). Places
  as configured (Judges Award: 2 for the whole event).
- *(My call)* Anything that today derives the award key from `team.division`
  (Awards tab actions, `noWinner`, "holds in its division") uses the scope
  helper instead. A team may hold a per-division award and a whole-event
  award; the existing "already has another award" caution looks across every
  key. The team lock stays as built (a team in a `sent` snapshot), but a
  division change only matters for division-scoped sends, so a team holding
  only whole-event sent awards may still change division.
- *(My call)* The "Whole event" board shows nominations and Sportsmanship
  conduct across every division; rail and chip counts ("3/11") count only
  the awards in that scope.

**Referee setup:** stays separate; its program may disagree with the event
setup's (the user's choice); nothing checks them against each other.

**Judging in a blended event (user, 2026-11-20: "any team"):** any panel may
interview any team in the event, whatever its division. `divisionsCompatible`
treats every pair as compatible when the format is Blended; callers pass the
format in (load `event_setup` once per request; no module cache). *(My call)*
A panel in a blended event takes the division "Whole event" by default (the
JA may still label it with a real division; it changes nothing). Teams' own
divisions still show everywhere.

**JA Awards tab:** in a blended event the division picker gains a
"Whole event" entry (or section) holding the whole-event awards; each real
division shows only Excellence and Design. Standard is as today.

**Awards Desk:** when a setup is saved, the program tabs are replaced by the
event title (e.g. "VEX IQ · Blended") and sections: each division (its
per-division awards), then "Whole event". Standard: one section per
division. No setup: exactly as today (tabs, name-based Blended tab;
`blendedScope` is ignored).

## Constraints
- 2.2.0 behaviour and tests for sends, Changed, lock and Send all ready must
  keep passing unchanged.
- Real Postgres check on Neon before release (new table; hotspot).
- Follow `.claude/DESIGN-HANDOFF.md` "Look". The Setup screen and the
  changed Awards tab / desk need canvas mocks first (user picks).

## Left to the builder
- Component split, test files, migration wording, error copy in the
  existing route style.
