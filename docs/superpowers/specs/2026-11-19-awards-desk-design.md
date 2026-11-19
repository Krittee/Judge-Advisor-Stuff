# Awards Desk (Version 2.2.0) — design

Date: 2026-11-19. Status: draft for the user's approval.

## Why
At the last event the marketing team waited for the Judge Advisor (JA) to
deliberate every award and send the list in one batch. It came late, and
marketing still had to build the award list and the screen backdrop after
that, which delayed the whole ceremony. The app cannot make the backdrop, but
it can let marketing see each award **as soon as the JA confirms it**, so they
work in parallel with deliberation.

## Goals
- A new **Marketing** role (`marketing`) with its own sign-in code and a page,
  the **Awards Desk** (`/marketing`).
- The JA **sends** each award (per division) to the desk when it is final.
  Marketing sees only sent awards: award, division, team number, team name.
- Marketing can **view and search** (team number, team name, award). Nothing else.
- Clean and clear: one line per award, divisions in config order, no clutter.
- A sent award that later changes is **flagged** so marketing cannot miss it.

## Non-goals
- No backdrop, slides, print or export (add only if marketing asks).
- No scores, nominations, reasons, notes, judges or blurbs on the desk.
- No marketing writes of any kind.

## Anti-goals (a failure even if it "works")
- Marketing ever sees a pick the JA has not sent.
- Any winner reaching `/api/state` or any public page.
- A sent award changing silently.
- The JA accidentally changing a sent award.

## Approaches considered
- **A · Sends table (chosen by the user).** One row per (award, division)
  holding a snapshot of what was sent, plus what was sent before. Change flag
  and recall fall out of it; winner logic untouched.
- B · A "sent" flag on winner rows. Less storage, but "No winner" lives in
  another table, the Judges Award has two rows, and "was 1234A" needs the old
  team, which is gone once replaced. Rejected: special cases everywhere.
- C · Show winners live as the JA picks. Rejected by the user: marketing could
  build a backdrop for a team the JA then swaps.

## Decided
**Data — new table `award_releases`**, key `(award_id, division)`:
- `teams` — jsonb list of `{ number, name }` snapshot at send time, `[]` means
  "No winner".
- `no_winner` boolean.
- `previous` — jsonb snapshot of the decision this one replaced, or null.
- `status` — `sent` | `recalled`.
- `sent_at`, `sent_by`, `changed_at`.

Send rules (checked on the server at send time, `409` if not ready):
- First send: `previous` null, `changed_at` null.
- Re-send after Recall, **same** teams/No winner as the current snapshot: status
  back to `sent`, `previous` and `changed_at` untouched (no new flag).
- Re-send after Recall, **different** from the current snapshot: `previous` =
  the current snapshot, `teams` = the new one, `changed_at` = now. A third
  change does the same again (previous is always the one just replaced).
- Comparison is by team ids in a set (Judges Award order doesn't matter) plus
  `no_winner`; the snapshot also stores each team id.
Both stores (`file.ts`, `postgres.ts`) and the mock driver; RLS on like the
other award tables.

**JA (Awards tab):**
- **Send to Marketing** per award per division, enabled only when the award has
  all its winners (Judges Award: 2) or is marked No winner. *(My call: a Judges
  Award with one of two picked can't be sent; the JA marks it complete first.)*
- A **Sent** mark on sent rows; **Recall** (via `useConfirm()`) on sent rows.
- **Lock:** while an award is `sent`, the winners and no-winner routes refuse to
  change it (`409`, "Recall it from Marketing first."). After Recall it is
  editable; sending again records the change.
- *(My call)* The lock also covers the team: deleting a team, or changing its
  division, while it is in a `sent` snapshot is refused (`409`, "Recall <award>
  from Marketing first."). Wiping all event data is deliberate and clears
  `award_releases` with everything else.
- Every send and recall goes to the Activity log (`kind: "award"`).
- **Send all ready** (user, 2026-11-19): one button sends every award that is
  ready and not already `sent`. A `useConfirm()` dialog lists what will go
  (award, division, team). One server call; each award is checked as a single
  send would be, and the reply says which were sent and which were skipped.

**Marketing (Awards Desk):**
- Signs in at `/marketing/login` with `MARKETING_CODE` (Vercel Production and
  Preview, like `COORDINATOR_CODE`; dev default in the project defaults;
  `scripts/doctor.mjs` and `.env.example` list it). A door on "/".
- Reads `GET /api/awards/released` (marketing + admin only, `no-store`), which
  returns the award list (id, label, order), divisions, and release rows.
  Nothing from nominations or `award_winners` directly.
- Per division: "N of M sent", then every award in config order:
  - sent → team number + name (two for the Judges Award), or "No winner";
  - recalled → "Being updated", no team shown *(my call: never show a decision
    the JA has taken back)*;
  - never sent → greyed "Not sent yet".
- **Changed:** a re-sent award whose snapshot differs shows "Changed — was
  1234A" until marketing taps "Seen". The Seen state is stored on that device
  only (`localStorage`, try/catch, keyed by award + division + `changed_at`),
  so the role stays read-only on the server. Each marketing device clears its
  own flags *(my call)*.
- Role: `marketing` joins `ROLES`/`Session` as `{ role: "marketing"; name }`,
  name optional like the Coordinator. Every existing route already refuses
  unknown roles; the builder checks each `can*` helper denies it.
- Every award applies to every division (config has no per-division list).
- Search filters rows by team number, team name or award label.
- Polls every ~15 s (small payload; mind Supabase egress).
- Designed at 1280 and 375. Avatar: placeholder until the user draws one.

## Constraints
- Follow `.claude/DESIGN-HANDOFF.md` "Look": colour is signal; accent blue for
  interactive chrome only; no playful motion; touch targets ≥44 px phone.
- Team snapshot is taken at send time *(my call: what marketing has is what was
  sent; a later team rename does not change a sent card)*.
- Wiping event data (Danger zone) also clears `award_releases`.
- Real Postgres check on Neon before release (hotspot).

## Left to the builder
- Exact component split, polling hook reuse, test files.
- Migration wording (create-if-not-exists, like the other tables).
- Copy for errors, following the existing route style.
