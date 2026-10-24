# Audit status and change log

Updated: 2026-10-22

This file tracks the **findings addressed so far from the recent ponytail audit**, the agreed workflow, and what changed. Other findings have not been re-audited here.

## Agreed workflow

| Role | Read team status | Create a request or booking | Change an early booking | Move interview status |
|---|---|---|---|---|
| Public visitor or team | Yes | No | No | No |
| Queue Desk | Yes | Yes, for any team | Cancel, reschedule, or mark ready now | No |
| Judge | Own panel | No | No | Requesting → On the way → Interviewing → Finished |
| Judge Advisor | Yes | Yes, for any team | Yes | Yes, including corrections and reopening |

Teams ask the Queue Desk in person. The desk or Judge Advisor enters the request or booking. The public team page displays the result; it does not submit changes. A future booking remains **Scheduled/Booked** until it is moved into the active request flow.

## Findings addressed

| Recent audit finding | Audit recommendation | Change made | Status |
|---|---|---|---|
| Must fix 1: public visitors could create or alter another team's request or booking | Enforce the agreed role permissions at the API and remove public write controls | `POST /api/requests` now requires Queue Desk or Judge Advisor. Anonymous visitors and judges cannot create requests. `cancel`, `reschedule`, and `ready-now` require Queue Desk or Judge Advisor; judges can only move interview status. The public team page is read-only, and judge booking controls were removed. | Fixed in the working tree |
| Must fix 2: an anonymous update could return private request fields | Close the anonymous mutation path and verify no private record is returned | Anonymous `PATCH /api/requests/[id]` now returns `403` for booking changes with no `request` object. A route test checks that the response does not contain `created_by`. | Fixed in the working tree |
| Must fix 3: a referee with the shared code could sign in under another author's name and edit that report | Give correction authority to the separate Head Referee role and Judge Advisor | `PATCH /api/flags` now requires the Head Referee or Judge Advisor. Ordinary referees see flags without edit controls, while the Head Referee uses the existing correction sheet. A route test checks that a same-name ordinary referee is denied and the flag stays unchanged. | Unauthorized ordinary-referee edits closed; typed author names remain unverified |
| Finding 6: reassignment could leave a request and its team on different panels | Move both records together and reject a second move based on stale panel data | Reassignment now uses one store operation. Postgres locks the request and updates both rows in one transaction, rolling back if either write fails. The file store makes both changes in one synchronous operation. Both check the panel and status originally read. | Fixed in the working tree; live Supabase integration still untested |
| Finding 7: a panel division edit could save while its team cleanup failed | Save the panel and incompatible-team release together; protect live requests | Postgres now locks the panel and saves its fields, team releases, and any roster update in one transaction. The file store keeps its synchronous update. Both stores refuse a division change that would release a team with an active request or booking; completed interviews do not block it. | Fixed in the working tree; live Supabase integration still untested |
| Finding 9: changing a panel code did not end existing judge sessions | Bind judge sessions to the current shared code, rotate that code when a judge leaves, and end sessions between event days | Judge cookies now require the panel's current code and the current Bangkok calendar day. Changing a code ends all sessions on that panel. Removing or moving a judge rotates the old panel's code in the same store operation, ending everyone's sessions there; the admin screen refreshes and shows the new code. | Fixed in the working tree; live Supabase integration still untested |
| Finding 11: rapid successful score taps could leave the open sheet with an incomplete total | Read back the stored score after overlapping saves finish | The scoring hook now detects overlapping saves and reloads the combined score after the last response, even when every save succeeded. Single taps still use their save response. | Fixed in the working tree |

The Judge Advisor alone can reopen a completed or cancelled request. This closes a status path that let judges return an interview to **Requesting** outside the agreed progression.

Earlier suggestions to allow team self-cancellation or restrict the Queue Desk to requests it created are superseded by the workflow above. Teams have read-only access; the Queue Desk is authorized to correct any early request regardless of who originally entered it. The public `/api/state` projection already clears request messages and staff fields for anonymous readers; the second recent finding concerned the separate mutation response.

## Verification

- Added route tests for anonymous and judge denial, Queue Desk and Judge Advisor creation, unchanged bookings after denied updates, and Judge Advisor-only reopening.
- Updated permission, activity, team-page, and judge-page checks for the new workflow.
- Added a real flags-route test denying same-name ordinary referee corrections while allowing Head Referee and Judge Advisor corrections. The ordinary referee flag list is read-only; the Head Referee uses the Judge Advisor's existing correction sheet.
- Added reassignment tests for stale panel moves, Postgres rollback when the team write fails, and rejection of a nearby booking on the destination panel. Existing booking-conflict and successful-move tests still cover the file store route.
- Added panel-division tests for active request and booking refusal, completed-interview allowance, and Postgres rollback if the team release fails.
- Added judge-session tests for code changes, roster removal, and the next-day boundary; added store and Postgres transaction checks for automatic code rotation.
- Added a scoring test for two successful, overlapping saves whose responses arrive out of order. It failed before the scoring change and passes afterward.
- At this verification, the full test suite passed: 1,362 passed and 1 optional Postgres conformance test skipped. TypeScript, lint, and the whitespace check passed. This follow-up did not edit `src/components/SlotPicker.tsx`, `src/components/team/TeamView.tsx`, `src/components/desk/`, or the avatar assets.

## Still open for discussion

- The public `/api/state` endpoint intentionally supports the public board and still includes public team and panel information alongside statuses. If “status only” means those extra public fields must also be removed, the public board and team lookup need a separate read-payload decision.
- The read-only team page no longer renders the in-progress `TeamView` component. Reconcile that UI work after the other task finishes; do not merge its old request buttons back into the public page.
- Referee author names are still typed at sign-in and can be impersonated on a new report by anyone holding the shared code. Individual referee credentials and stable author IDs are required if verified attribution becomes necessary.
- Finding 8, Supabase TLS certificate verification, is deferred at the user's request. No Supabase connection settings changed here.
- Finding 10, line breaks inside imported team names, is left open at the user's request.
- A shared panel code still grants access to anyone who learns the new code. Removing one judge rotates it for the whole panel; individual credentials would be needed to keep everyone else's sessions uninterrupted.
- Other findings from the recent audit are outside this change. Their present status needs a fresh check before labeling them fixed or open.
