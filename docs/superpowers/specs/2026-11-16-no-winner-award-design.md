# "No winner" for an award — design (2026-11-16)

## Why
Sometimes an award goes to no team. Today the JA's Awards board can't tell
"not decided yet" from "deliberately not given", so the decided count never
reaches 11 of 11.

## Decided with the user
- The JA can mark **any** award "No winner" in a division, even one with nominees.
- Wording: status chip **"No winner"**, button **"Mark no winner"**, undo **"Clear"**.
- Stored in its **own new table**, `award_no_winner`. The winners table is left alone.

## Calls made here (yours to veto)
- "No winner" counts as decided in "N of 11 decided" and in the side-menu "3/11".
- Undo: Clear removes the mark (asked first, like clearing a winner).
- Marking "No winner" on an award a team holds asks first, then takes the award off that team.
  Giving a team an award marked "No winner" asks first ("…instead of No winner?"), then removes the mark.
- Judges never see it, like winners (only the JA's GET /api/awards returns it).
- Every mark and clear is logged in Activity, like winners.
- There's no awards export or print today, so the board is the only place it shows.

## Approaches
1. **Own table** (picked): `award_no_winner(award_id, division, decided_by, decided_at, PK(award_id, division))`.
   Purely additive (`create table if not exists`), so live Supabase data is untouched. Keeps away from the
   winners table, which the parallel "two Judges Award winners" change is reworking.
2. Nullable `award_winners.team_id`: fewer files, but alters the table the other session is changing.
3. A fake "no team" team: shows up in team lists and the FK. Rejected.

## Shape
- Types: `NoWinnerRow { award_id, division, decided_by, decided_at }`. `AwardsAdminView` gains `noWinners`.
- Store (file + Postgres): `listNoWinners()`, `setNoWinner({awardId, division, decidedBy})`,
  `clearNoWinner(awardId, division)`. File store keeps `noWinners: []` (defaults to `[]` on old state files).
- API: new `src/app/api/awards/no-winner/route.ts` (JA only). PUT marks it (clearing any team winner);
  DELETE clears it. The existing winners PUT also clears the mark when a team is given the award.
- Board: By award shows the "No winner" chip (decided style) and a "Mark no winner" / "Clear" button per award.
  The Matrix header marks such an award with a "no winner" sign instead of the decided tick.
  `decidedCount` / `decidedText` take the marks too, so the header and rail count them.
- Tests: both stores (conformance), the new route, the winners-PUT interaction, the board logic and rendering.
