# Full Application Bug Audit

## 1. Executive Summary

Overall: **FAIL**

The application builds and its 256 automated tests pass, but it is not ready for operational use. The audit found confirmed authorization, security, workflow, and data-integrity defects. No source files, database structures, commits, deployments, or live database records were changed during the audit.

Number of findings:

- Critical: 3
- High: 11
- Medium: 15
- Low: 3
- Total: 32

Top risks:

1. The live Supabase Data API anonymously exposes every audited table, including panel login codes.
2. The installed Next.js version has two published unauthenticated remote-code-execution advisories.
3. Core workflows can lose, split, misroute, or improperly modify competition data—including panel reassignment, scheduling, scoring, flags, and team assignment.

Current local event state also has zero panels, so judging/request workflows are currently unusable despite the diagnostic script reporting “All good.”

---

## 2. Application Architecture Map

- Framework: Next.js 15 App Router, React 19, TypeScript, Tailwind CSS 4.
- Public/team routes: `/`, `/team/[number]`, `/board`.
- Staff routes: `/login`, `/judge`, `/queue`, `/admin`, `/referee/login`, `/referee`, `/referee/teams`.
- APIs: session, aggregated state, health, requests, notes, scores, flags, conflicts, admin teams, panels, and activity.
- Authentication: signed JWT stored in an HTTP-only cookie. Roles are admin, judge, queuer, and referee. Team access is anonymous.
- Client state: React component state with polling. Main state polls every 4–6 seconds; rankings and activity have additional polling loops.
- Storage:
  - JSON file store when `DATABASE_URL` is absent.
  - PostgreSQL store when `DATABASE_URL` is present.
  - Supabase SQL schema and seed files exist, but the runtime does not use the Supabase JavaScript client.
- Event configuration: JSON files define divisions, rubrics, rules, pit layout, and event behavior.
- Realtime: no WebSocket, Supabase Realtime, React Query, SWR, or global client-state framework.
- Current effective configuration selects the JSON backend because the final `DATABASE_URL` value is blank.

---

## 3. Areas Audited

- Landing page and team-number routing.
- Team request creation, booking, cancellation, and ready-now flow.
- Judge login, team visibility, notes, scoring, conflicts, and completion.
- Queue request acknowledgement, interview progression, cancellation, and reopening.
- Admin dashboard, panels, teams, imports, assignments, time slots, activity, reset operations, and pit map.
- Public board, rankings, request/status display, and data redaction.
- Referee login, flag creation, rule selection/search, history, severity handling, flag correction, and team lookup.
- Session-cookie creation, role authorization, panel scoping, stale sessions, and role-code configuration.
- File and PostgreSQL storage implementations.
- Supabase schema, seed, RLS configuration, and anonymous Data API access.
- Rule dataset, official titles, IDs, categories, ordering, search terms, TS1–TS3, validation, history, and legacy compatibility.
- Polling, error recovery, race conditions, duplicate submissions, and concurrent updates.
- Pit placement, map orientation, filtering, and duplicate positions.
- Responsive CSS, reduced-motion behavior, touch-target rules, modal/dropdown structure, and accessibility markup through static review.
- Environment loading, doctor script, package scripts, dependencies, lockfile, build configuration, git diff, and current data.
- All existing automated test files and all production application source files.

---

## 4. Findings

### CRITICAL

### BUG-001 — Live Supabase tables and panel login codes are anonymously readable

- **Severity:** CRITICAL
- **Feature/page:** Supabase Data API and authentication
- **File:** `src/lib/db/postgres.ts`, `supabase/schema.sql`
- **Function/component:** `migrate`; RLS declarations
- **Approximate line:** 132–290; 217–224
- **Problem:** A read-only live probe using the public Supabase key received HTTP 200 from all eight tables: `panels`, `teams`, `requests`, `notes`, `conflicts`, `flags`, `scores`, and `activity`. `panels.code` was directly readable. The runtime migration creates tables without enabling RLS; only the optional standalone schema enables it.
- **How to reproduce:** Send an anonymous Supabase REST request with the published project key, such as selecting `code` from `panels`.
- **Expected behavior:** Anonymous clients cannot read operational tables or staff login codes.
- **Actual behavior:** Anonymous requests return table data, including the private panel-code field.
- **Why it matters:** Exposed codes permit unauthorized judge access, while other tables expose operational and potentially sensitive event data. Supabase explicitly recommends RLS or other Data API access controls for exposed schemas. See [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api) and [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
- **Recommended fix:** Immediately enable and verify RLS or revoke anonymous grants/disable Data API exposure. Rotate every panel code after closing the exposure. Add deployment tests proving anonymous read and write denial.
- **Confidence:** High

### BUG-002 — Installed Next.js version has unauthenticated RCE advisories

- **Severity:** CRITICAL
- **Feature/page:** Production server dependency
- **File:** `package.json`
- **Function/component:** Next.js dependency
- **Approximate line:** 18
- **Problem:** The repository installs Next.js 15.5.23. `npm audit` reports two critical advisories fixed in 15.5.24: a Windows-host RCE and an AVIF image-processing RCE. Transitive `postcss` and `sharp` issues are also reported as high severity.
- **How to reproduce:** Run `npm audit --omit=dev`.
- **Expected behavior:** The production framework version has no known critical remotely exploitable vulnerabilities.
- **Actual behavior:** Audit reports three vulnerable production packages and two critical Next.js RCE advisories.
- **Why it matters:** Applicable deployments could permit unauthenticated server-side code execution. See the [Windows-host advisory](https://github.com/advisories/GHSA-p293-qw3h-jr36) and [AVIF advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4).
- **Recommended fix:** Upgrade to at least Next.js 15.5.24, refresh compatible transitive dependencies, rebuild, and rerun the complete audit and test suite.
- **Confidence:** High

### BUG-003 — Schema advertised as safe to rerun destroys all application data

- **Severity:** CRITICAL
- **Feature/page:** Database provisioning
- **File:** `supabase/schema.sql`
- **Function/component:** Schema initialization script
- **Approximate line:** 4–20
- **Problem:** The script says it is safe to rerun, then executes `DROP TABLE ... CASCADE` for every application table.
- **How to reproduce:** Static inspection is conclusive; executing the script against populated storage would be destructive and was intentionally not attempted.
- **Expected behavior:** A rerunnable migration preserves existing event data.
- **Actual behavior:** Rerunning removes requests, scores, notes, flags, teams, panels, conflicts, and activity.
- **Why it matters:** Following the script’s documented instruction can cause complete, irreversible event-data loss.
- **Recommended fix:** Separate destructive development reset SQL from additive production migrations and remove the “safe to re-run” claim.
- **Confidence:** High

### HIGH

### BUG-004 — Current role-code configuration is publicly guessable and unthrottled

- **Severity:** HIGH
- **Feature/page:** Staff login
- **File:** `src/lib/auth.ts`, `src/app/api/session/route.ts`
- **Function/component:** `secret`, role-code authentication, `POST /api/session`
- **Approximate line:** 21–45; 10–25
- **Problem:** The active admin and queuer codes match values published in repository documentation, the missing referee code falls back to a published development value, and login attempts have no rate limiting. The session secret check only requires 16 characters, so the documented placeholder is not technically rejected.
- **How to reproduce:** Run in development or on an event LAN with the current environment and submit documented codes repeatedly.
- **Expected behavior:** Staff credentials are private, strong, deployment-specific, and resistant to brute-force attempts.
- **Actual behavior:** Multiple privileged roles use discoverable codes with unlimited login attempts.
- **Why it matters:** Anyone with repository or documentation access may obtain staff or administrative privileges in common development/LAN deployments.
- **Recommended fix:** Require non-default secrets in all nonlocal deployments, reject known placeholders, remove fallback role codes, and rate-limit authentication attempts.
- **Confidence:** High

### BUG-005 — Teams cannot cancel their own live requests

- **Severity:** HIGH
- **Feature/page:** `/team/[number]`
- **File:** `src/app/api/requests/[id]/route.ts`, `src/lib/auth.ts`
- **Function/component:** Request delete handler; `canCancel`
- **Approximate line:** 25–31; 282–290
- **Problem:** The team UI presents cancellation controls, but `canCancel` always returns false for an unauthenticated team.
- **How to reproduce:** Create a request from a team page and press Cancel. Isolated runtime result: HTTP 403.
- **Expected behavior:** A team can cancel its own pending request.
- **Actual behavior:** Every team-originated cancellation is rejected.
- **Why it matters:** Teams cannot correct mistakes or release capacity without staff intervention.
- **Recommended fix:** Introduce a narrowly scoped team cancellation capability tied to the team/request, then test ownership and status boundaries.
- **Confidence:** High

### BUG-006 — Reassigning a request creates conflicting team and request panel ownership

- **Severity:** HIGH
- **Feature/page:** Admin request reassignment and judge queues
- **File:** `src/app/api/requests/[id]/route.ts`, `src/app/judge/page.tsx`
- **Function/component:** Request panel reassignment; judge team filtering
- **Approximate line:** 68–104; 53–70
- **Problem:** Reassignment changes `request.panel_id` without updating `team.panel_id`. Other views and authorization derive panel ownership from the team.
- **How to reproduce:** Reassign an A-panel request to B. Runtime verification left the team assigned to A and the request assigned to B.
- **Expected behavior:** Reassignment produces one consistent owner and a usable destination workflow.
- **Actual behavior:** Source and destination views disagree; the request can be invisible or unauthorized to the intended judge.
- **Why it matters:** Live interviews can disappear or be handled by the wrong panel.
- **Recommended fix:** Define one canonical assignment model and update/revalidate all related entities atomically.
- **Confidence:** High

### BUG-007 — One team can reserve multiple scheduled interview slots

- **Severity:** HIGH
- **Feature/page:** Team scheduling
- **File:** `src/app/api/requests/route.ts`, `supabase/schema.sql`
- **Function/component:** Scheduled-request creation; uniqueness indexes
- **Approximate line:** 46–75; 99–108
- **Problem:** “Live request” checks exclude scheduled requests. The database prevents two teams using the same panel/time, but does not prevent one team booking multiple times.
- **How to reproduce:** Submit two different scheduled slots for the same team. Both returned HTTP 200 in isolated runtime testing.
- **Expected behavior:** A team has at most one active scheduled booking.
- **Actual behavior:** Multiple simultaneous bookings are accepted.
- **Why it matters:** A team can consume multiple interview slots and distort scheduling.
- **Recommended fix:** Treat scheduled requests as live for team uniqueness and enforce the rule with a storage constraint or transaction.
- **Confidence:** High

### BUG-008 — A deleted panel leaves judge sessions with global state visibility

- **Severity:** HIGH
- **Feature/page:** Judge authorization and `/api/state`
- **File:** `src/lib/auth.ts`, `src/lib/server-state.ts`
- **Function/component:** Session verification; panel-scoped state builder
- **Approximate line:** 68–88; 42–74
- **Problem:** JWT sessions are not revalidated against current panel records. When the panel disappears, its division cannot be resolved and filtering falls back to unscoped data.
- **How to reproduce:** Sign in as a panel judge, delete that panel, then call `/api/state` with the existing cookie. Runtime verification returned all teams, panels, requests, and divisions.
- **Expected behavior:** The session is rejected or returns no panel-scoped data.
- **Actual behavior:** The stale judge session expands to global visibility for up to the 16-hour token lifetime.
- **Why it matters:** Removing or rotating a panel does not revoke existing access and can broaden it.
- **Recommended fix:** Revalidate panel identity/code state on privileged requests and fail closed when panel scope cannot be resolved.
- **Confidence:** High

### BUG-009 — Failed panel edits can silently unassign teams

- **Severity:** HIGH
- **Feature/page:** Admin panel editing
- **File:** `src/lib/db/file.ts`, `src/lib/db/postgres.ts`
- **Function/component:** Panel update
- **Approximate line:** 544–560; 627–658
- **Problem:** Division-change side effects unassign teams before validating/updating the panel code.
- **How to reproduce:** Submit a panel division change together with a duplicate panel code. Runtime result: HTTP 409, panel unchanged, but all eight teams previously assigned to it became unassigned.
- **Expected behavior:** A rejected panel update leaves all data unchanged.
- **Actual behavior:** Side effects commit before the validation failure.
- **Why it matters:** A simple admin correction can silently destroy judge assignments.
- **Recommended fix:** Validate first and perform panel/team updates in one transaction or atomic store operation.
- **Confidence:** High

### BUG-010 — Admin assignment bypasses the division hard wall

- **Severity:** HIGH
- **Feature/page:** Admin team management
- **File:** `src/app/api/admin/teams/route.ts`, `src/lib/db/file.ts`
- **Function/component:** Team PATCH; `updateTeam`
- **Approximate line:** 93–107; 450–464
- **Problem:** Manual assignment does not verify that a panel exists or belongs to the team’s division.
- **How to reproduce:** Assign an Elementary team to a Division 1 panel. The isolated runtime accepted the update.
- **Expected behavior:** Cross-division or nonexistent panel assignment is rejected.
- **Actual behavior:** The API accepts the invalid association; the file backend also accepts arbitrary nonexistent panel IDs.
- **Why it matters:** This violates a documented event integrity boundary and misroutes teams.
- **Recommended fix:** Resolve and validate the destination panel server-side before committing.
- **Confidence:** High

### BUG-011 — Request status changes lack a state machine and atomic authorization

- **Severity:** HIGH
- **Feature/page:** Queue/judge request lifecycle
- **File:** `src/app/api/requests/[id]/route.ts`, `src/lib/db/postgres.ts`
- **Function/component:** `set-status`, `reopen`, request update
- **Approximate line:** 118–150; 453–474
- **Problem:** Any enumerated status can be set directly without validating the legal transition from the current status. Authorization reads and updates are separate, unconditional operations.
- **How to reproduce:** Call the authenticated endpoint with a valid but out-of-order status, or issue simultaneous actions from two sessions.
- **Expected behavior:** Only legal transitions succeed, with current state and ownership checked atomically.
- **Actual behavior:** Stale or direct requests can skip workflow stages or overwrite another operator’s action.
- **Why it matters:** Queue state and interview ownership can become incorrect under normal multi-device use.
- **Recommended fix:** Centralize an explicit transition graph and use conditional/transactional updates.
- **Confidence:** High

### BUG-012 — Concurrent PostgreSQL score saves can produce the wrong total

- **Severity:** HIGH
- **Feature/page:** Judge scoring and rankings
- **File:** `src/lib/db/postgres.ts`
- **Function/component:** Score upsert
- **Approximate line:** 790–814
- **Problem:** Criterion JSON is merged in the database, but the total is calculated from a client-side snapshot and written separately. Concurrent criterion changes can preserve both values yet leave the last stale total.
- **How to reproduce:** Submit different criteria concurrently from two clients for the same team/rubric.
- **Expected behavior:** Stored total always equals the committed criteria.
- **Actual behavior:** Last-writer ordering can overwrite the total with a value that omitted the other concurrent change.
- **Why it matters:** Rankings may be objectively wrong even though individual criterion values look correct.
- **Recommended fix:** Calculate the total from the locked/merged database value within one transaction or derive it during reads.
- **Confidence:** High

### BUG-013 — Any referee can rewrite another referee’s report

- **Severity:** HIGH
- **Feature/page:** Referee flag history
- **File:** `src/app/api/flags/route.ts`
- **Function/component:** `PATCH /api/flags`
- **Approximate line:** 102–156
- **Problem:** The endpoint verifies only the referee role, not report authorship or head-referee authority.
- **How to reproduce:** Referee A creates an SG6 Minor; Referee B patches the same record to Good Conduct. Runtime result: HTTP 200 while the displayed author remained A.
- **Expected behavior:** Corrections follow an explicit ownership or elevated-review policy.
- **Actual behavior:** Every referee can materially change every flag.
- **Why it matters:** Competition rulings can be altered without attributable authorship.
- **Recommended fix:** Enforce an explicit correction authority model and record editor identity plus before/after values.
- **Confidence:** High

### BUG-014 — Queuers can cancel team-created requests they do not own

- **Severity:** HIGH
- **Feature/page:** Queue authorization
- **File:** `src/lib/auth.ts`, `src/app/api/requests/[id]/route.ts`
- **Function/component:** `canCancel`; DELETE handler
- **Approximate line:** 282–290; 56
- **Problem:** Comments describe queuer cancellation as correcting the queuer’s own mis-entry, but neither creator ownership nor panel scope is checked.
- **How to reproduce:** Create a request anonymously from a team page, then delete it using a queuer session. Runtime result: HTTP 200.
- **Expected behavior:** Queuers cancel only explicitly authorized requests.
- **Actual behavior:** A queuer can cancel any request in an allowed status.
- **Why it matters:** Queue staff can unintentionally remove valid team or judge work outside their ownership.
- **Recommended fix:** Enforce creator/scope rules or clearly define and audit an intentional global-cancellation privilege.
- **Confidence:** High

### MEDIUM

### BUG-015 — Failed team import leaves partially committed records

- **Severity:** MEDIUM
- **Feature/page:** Admin import
- **File:** `src/app/api/admin/teams/route.ts`
- **Function/component:** Team import and auto-assignment
- **Approximate line:** 48–57
- **Problem:** Teams are upserted before auto-assignment is attempted, without a transaction or rollback.
- **How to reproduce:** Import with auto-assignment enabled while no panels exist. Runtime response was HTTP 400 “Add a panel first,” but the imported team remained.
- **Expected behavior:** A failed import is atomic or clearly reports partial success.
- **Actual behavior:** The API reports failure after changing data.
- **Why it matters:** Retrying can create confusion and leave an unexpected partial roster.
- **Recommended fix:** Validate prerequisites first or make import and assignment transactional.
- **Confidence:** High

### BUG-016 — “Ready now” can destroy a valid scheduled booking

- **Severity:** MEDIUM
- **Feature/page:** Team ready-now workflow
- **File:** `src/app/team/[number]/page.tsx`
- **Function/component:** Ready-now action
- **Approximate line:** 70–85
- **Problem:** The client cancels the scheduled booking and then independently creates a live request.
- **How to reproduce:** Trigger ready-now while the second request fails because of a network, validation, or concurrency error.
- **Expected behavior:** Either both operations succeed or the original booking remains.
- **Actual behavior:** The scheduled booking can be deleted with no replacement request.
- **Why it matters:** A team loses its reserved interview slot because of a transient failure.
- **Recommended fix:** Provide one atomic server-side conversion operation.
- **Confidence:** High

### BUG-017 — Rapid score taps can leave the UI or saved total stale

- **Severity:** MEDIUM
- **Feature/page:** Judge score sheet
- **File:** `src/components/ScoreSheet.tsx`
- **Function/component:** Criterion save handler
- **Approximate line:** 52–71
- **Problem:** The component tracks only one saving criterion while other criteria remain interactive. Responses and error rollbacks can arrive out of order against stale props.
- **How to reproduce:** Rapidly change multiple criteria under latency or make the first request fail after the second succeeds.
- **Expected behavior:** Confirmed server state wins and failures affect only the failed change.
- **Actual behavior:** Older responses or rollbacks can overwrite newer local state.
- **Why it matters:** Judges may see scores that differ from storage.
- **Recommended fix:** Serialize saves per team/rubric or use versioned optimistic updates with authoritative reconciliation.
- **Confidence:** Medium

### BUG-018 — Scheduled requests can target expired or obsolete slots

- **Severity:** MEDIUM
- **Feature/page:** Scheduling and panel configuration
- **File:** `src/app/api/requests/route.ts`, `src/app/admin/page.tsx`
- **Function/component:** Schedule validation; panel-grid editing
- **Approximate line:** 46–75; 1673–1678
- **Problem:** The server validates that a slot matches the configured grid but not that it is in the future. Changing a panel’s grid does not reconcile existing scheduled bookings.
- **How to reproduce:** Submit a formerly valid/past grid timestamp directly, or retime a panel after bookings exist.
- **Expected behavior:** Expired slots are rejected and existing bookings are migrated, cancelled, or surfaced.
- **Actual behavior:** Past bookings can be created, while off-grid bookings disappear from the generated picker.
- **Why it matters:** Teams may hold unusable or invisible appointments.
- **Recommended fix:** Validate future time server-side and require explicit reconciliation when changing a populated schedule.
- **Confidence:** High

### BUG-019 — Judges can read the complete administrative activity log

- **Severity:** MEDIUM
- **Feature/page:** `/api/admin/activity`
- **File:** `src/app/api/admin/activity/route.ts`
- **Function/component:** Activity GET authorization
- **Approximate line:** 7–13
- **Problem:** Access uses the broad `canReadNotes` permission and applies no panel scope.
- **How to reproduce:** Request the endpoint with a panel-judge cookie. Runtime result was HTTP 200 with global activity.
- **Expected behavior:** Administrative audit history is restricted to admins or deliberately scoped.
- **Actual behavior:** Ordinary judges receive the full activity log.
- **Why it matters:** Operational history and staff actions are exposed beyond least privilege.
- **Recommended fix:** Use an explicit activity-log permission and apply appropriate event/panel filtering.
- **Confidence:** High

### BUG-020 — Referee and public state responses expose more metadata than required

- **Severity:** MEDIUM
- **Feature/page:** Aggregated state API
- **File:** `src/lib/server-state.ts`
- **Function/component:** State response projection
- **Approximate line:** 76–93
- **Problem:** Any authenticated role receives all team request messages, including referees. Public rows omit messages but retain staff identity fields such as creator, acknowledger, and interviewer.
- **How to reproduce:** Compare anonymous and referee `/api/state` responses.
- **Expected behavior:** Each role receives only fields needed for its workflow.
- **Actual behavior:** Data projection is based mainly on “authenticated versus anonymous,” not role purpose.
- **Why it matters:** It unnecessarily expands exposure of team communications and staff metadata.
- **Recommended fix:** Introduce explicit per-role response projections.
- **Confidence:** High

### BUG-021 — “Flagged Today” is not filtered to today or a durable event boundary

- **Severity:** MEDIUM
- **Feature/page:** Referee dashboard
- **File:** `src/app/referee/page.tsx`
- **Function/component:** Flag history and reset behavior
- **Approximate line:** 138–150; 543
- **Problem:** The section renders all flags in active state. Day reset preserves flags, and records have no durable event identifier.
- **How to reproduce:** Retain a flag from the previous local day and open “Flagged Today.” Current state contains records from September 8 and 9, and both are included.
- **Expected behavior:** “Today” reflects the configured local day, and repeated-rule history cannot cross events.
- **Actual behavior:** All retained flag history is shown/countable until an operator manually wipes it.
- **Why it matters:** Referees can act on misleading repeat counts or old-event reports.
- **Recommended fix:** Store event identity and define a timezone-aware “today” filter independently from data retention.
- **Confidence:** High

### BUG-022 — Tournament Special rules are displayed last instead of first

- **Severity:** MEDIUM
- **Feature/page:** Referee rule selector
- **File:** `src/lib/rules.ts`
- **Function/component:** `RULE_CATEGORIES`
- **Approximate line:** 30–46
- **Problem:** The required ordering puts Tournament Special first, but the source and tests place it last.
- **How to reproduce:** Open the rule selector or inspect `RULE_CATEGORIES`.
- **Expected behavior:** Tournament Special, Scoring, Specific Game, Safety, General, General Game, Robot Skills, Robot, Tournament.
- **Actual behavior:** Tournament Special is the final group.
- **Why it matters:** It violates the requested high-priority field workflow, and current tests lock in the wrong behavior.
- **Recommended fix:** Correct the category sequence and update tests to assert the specified order.
- **Confidence:** High

### BUG-023 — File-backend team deletion leaves orphan flags and activity

- **Severity:** MEDIUM
- **Feature/page:** Admin team deletion
- **File:** `src/lib/db/file.ts`
- **Function/component:** `deleteTeam`
- **Approximate line:** 467–473
- **Problem:** The file store removes requests, notes, scores, and conflicts but not flags or activity records. PostgreSQL uses cascading foreign keys, creating backend divergence.
- **How to reproduce:** Delete a team with existing flags while using the JSON backend.
- **Expected behavior:** Related data follows one documented retention policy on both backends.
- **Actual behavior:** Orphan records survive only on the file backend.
- **Why it matters:** Deleted teams can remain visible in referee history and produce inconsistent deployments.
- **Recommended fix:** Apply the same explicit cascade or retention behavior to both stores.
- **Confidence:** High

### BUG-024 — Pit-map collisions can hide teams and filtering does not match its label

- **Severity:** MEDIUM
- **Feature/page:** Admin pit map
- **File:** `src/lib/pit.ts`, `src/components/PitMap.tsx`
- **Function/component:** Pit placement map; `hideDone`
- **Approximate line:** 62–91; 195–198
- **Problem:** Duplicate pit coordinates silently overwrite in a `Map`; both teams can still be counted as placed. Range boundaries are calculated but not enforced by rendering. “Hide done” removes completion styling rather than the completed tile.
- **How to reproduce:** Give two teams the same pit position or enable Hide done with a completed team.
- **Expected behavior:** Duplicate/out-of-range positions are surfaced and completed teams are hidden.
- **Actual behavior:** One team can vanish, phantom cells can appear, and completed teams remain.
- **Why it matters:** Field staff can receive an inaccurate floor map.
- **Recommended fix:** Validate unique in-range positions and make filter behavior match its label.
- **Confidence:** High

### BUG-025 — Polling errors can leave permanent or misleading UI states

- **Severity:** MEDIUM
- **Feature/page:** Rankings, activity, and team page
- **File:** `src/components/Rankings.tsx`, `src/components/useAppState.ts`
- **Function/component:** Polling loaders
- **Approximate line:** 44–57; 60–74
- **Problem:** Successful ranking/activity reloads do not consistently clear prior errors. Initial state-fetch failure marks the empty fallback as loaded.
- **How to reproduce:** Cause one poll to fail and allow later polls to recover; or fail the first team-page load.
- **Expected behavior:** Recovery clears the error, while initial failure remains distinguishable from valid empty data.
- **Actual behavior:** Error banners can remain permanently, and a network failure can display “team not on list.”
- **Why it matters:** Operators may act on false absence or believe recovered data is still offline.
- **Recommended fix:** Model loading/error/data states separately and clear stale errors after confirmed success.
- **Confidence:** High

### BUG-026 — The doctor script reports healthy configuration when core workflows cannot run

- **Severity:** MEDIUM
- **Feature/page:** Deployment diagnostics
- **File:** `scripts/doctor.mjs`
- **Function/component:** Environment and configuration checks
- **Approximate line:** 145–179
- **Problem:** The script checks that `.env.local` exists but does not resolve effective Next.js environment values or application state.
- **How to reproduce:** Run `npm run check` with the current files. It says “All good” even though the effective database URL is blank, the referee production code is absent, published role codes are active, and state has zero panels.
- **Expected behavior:** Diagnostics identify effective misconfiguration that blocks or weakens the application.
- **Actual behavior:** A passing result gives false deployment confidence.
- **Why it matters:** Operators may begin an event with unusable or insecure configuration.
- **Recommended fix:** Load environment values using Next-compatible precedence and validate effective role codes, storage selection, and minimum operational state.
- **Confidence:** High

### BUG-027 — Remote PostgreSQL TLS does not verify server identity by default

- **Severity:** MEDIUM
- **Feature/page:** PostgreSQL connection security
- **File:** `src/lib/db/postgres.ts`
- **Function/component:** `sslFor`
- **Approximate line:** 91–115
- **Problem:** Remote TLS defaults to `rejectUnauthorized: false` unless verify-full is explicitly selected.
- **How to reproduce:** Configure a remote database URL without the special verification option and inspect the generated connection settings.
- **Expected behavior:** Production database certificates and hostnames are verified.
- **Actual behavior:** Traffic is encrypted but unauthenticated against a trusted server identity.
- **Why it matters:** A network attacker could impersonate the database endpoint.
- **Recommended fix:** Default remote production connections to certificate verification and document supported CA configuration.
- **Confidence:** High

### BUG-028 — A second file-store process warns but continues writing

- **Severity:** MEDIUM
- **Feature/page:** JSON storage
- **File:** `src/lib/db/file.ts`
- **Function/component:** File lock/startup handling
- **Approximate line:** 254–289
- **Problem:** Detecting an existing live store process emits a warning but does not prevent a second independent in-memory writer.
- **How to reproduce:** Start two application processes against the same state file and save from each.
- **Expected behavior:** Exclusive ownership is enforced, or writes coordinate through reliable locking.
- **Actual behavior:** Both instances can overwrite the complete JSON snapshot from stale memory.
- **Why it matters:** Multi-process deployment or accidental duplicate starts can lose recent event data.
- **Recommended fix:** Fail startup on a valid lock or use storage with transactional concurrency.
- **Confidence:** High

### BUG-029 — Flag correction accepts malformed fields but cannot correct the rule

- **Severity:** MEDIUM
- **Feature/page:** Referee flag editing
- **File:** `src/components/Flags.tsx`, `src/lib/match.ts`
- **Function/component:** Flag edit form; match-field validation
- **Approximate line:** 185–200, 291–298; 32–40
- **Problem:** The edit form permits arbitrary nonempty field text, while creation uses normalized field choices. It resubmits the existing rule and offers no way to correct a wrongly selected rule.
- **How to reproduce:** Edit a flag’s field to arbitrary text, or try to change an incorrect SG6 report to SG7.
- **Expected behavior:** Corrections use the same valid field/rule constraints as creation.
- **Actual behavior:** Invalid field labels are accepted and the rule cannot be corrected.
- **Why it matters:** Historical reports can become malformed or remain attributed to the wrong rule.
- **Recommended fix:** Reuse normalized field selection and validated rule selection in the correction workflow.
- **Confidence:** High

### LOW

### BUG-030 — Demo and seed divisions do not match current event configuration

- **Severity:** LOW
- **Feature/page:** Demo/seed setup
- **File:** `supabase/seed.sql`, `src/lib/db/file.ts`
- **Function/component:** Seed data and demo initialization
- **Approximate line:** 8–10; 826–830
- **Problem:** Seeds use Division 1/Division 2 while current event configuration uses Elementary/Middle/High/Blended.
- **How to reproduce:** Initialize demo or Supabase seed data under the current configuration.
- **Expected behavior:** Example data exercises valid configured divisions.
- **Actual behavior:** Legacy divisions enter state and can mask assignment errors.
- **Why it matters:** Fresh installations do not accurately represent the configured event.
- **Recommended fix:** Generate demo divisions from event configuration or keep versioned event-specific seeds.
- **Confidence:** High

### BUG-031 — Slot picker reports “all taken” when remaining slots are merely in the past

- **Severity:** LOW
- **Feature/page:** Team scheduling
- **File:** `src/components/SlotPicker.tsx`
- **Function/component:** Empty-state message
- **Approximate line:** 88–99
- **Problem:** The same empty message is used when slots are occupied and when they are filtered out for being past.
- **How to reproduce:** Open scheduling after all configured times have elapsed.
- **Expected behavior:** Explain that no future slots remain.
- **Actual behavior:** The UI says all slots are taken.
- **Why it matters:** Staff may investigate nonexistent booking conflicts.
- **Recommended fix:** Distinguish unavailable, occupied, and elapsed slot states.
- **Confidence:** High

### BUG-032 — Lint debt and unused dependencies obscure maintenance signals

- **Severity:** LOW
- **Feature/page:** Repository maintenance
- **File:** `package.json`
- **Function/component:** Lint configuration and dependencies
- **Approximate line:** 15–16
- **Problem:** Lint completes with 11 warnings, including missing hook dependencies and unused code. Supabase client packages are installed but unused by runtime source.
- **How to reproduce:** Run `npm run lint` and search source imports for the Supabase packages.
- **Expected behavior:** Important warnings are actionable and dependencies reflect runtime use.
- **Actual behavior:** Known warnings and dead dependencies add noise and attack/update surface.
- **Why it matters:** Real regressions are easier to overlook as warning debt grows.
- **Recommended fix:** Resolve hook warnings, remove dead symbols, and remove unused dependencies after confirming deployment needs.
- **Confidence:** High

---

## 5. Possible Bugs Requiring Manual Verification

- Anonymous Supabase `INSERT`, `UPDATE`, and `DELETE` access may also be available. It was deliberately not tested against the live database. This should be treated as urgent because all table reads are already confirmed exposed.
- Verify whether the deployed environment uses the same Supabase project, role codes, and effective blank `DATABASE_URL` as the local environment.
- Real PostgreSQL concurrency tests are needed for score totals, request transitions, slot booking, and panel changes.
- Browser-based mobile, iPad, desktop, keyboard, focus-trap, long-title, and horizontal-overflow testing was unavailable because no browser surface was available.
- Verify the Major button’s visual repeat-history emphasis with referees; code does not automatically select Major, but the ring could be misinterpreted as a required escalation.
- Verify expired-cookie, browser back/forward, multiple-tab, and offline recovery behavior end to end.
- Confirm whether global referee visibility and cross-referee flag correction are intended policy rather than accidental authorization.
- Load-test the polling architecture with the expected number of concurrent team tablets and public boards.

---

## 6. Areas Checked With No Issue Found

- No automatic Minor-to-Major escalation exists.
- No automatic disqualification exists.
- Repeat history informs the referee but does not change the submitted severity.
- Major remains a deliberate referee action.
- Minor and Major submissions require a valid rule server-side.
- Good Conduct permits no rule; Warning permits an optional rule.
- Malformed and unknown rule IDs are rejected.
- Severity and report-type values are constrained.
- Same-team, same-match, same-rule submissions remain separate records rather than being overwritten.
- Same-rule history is scoped by exact normalized team and rule within the currently loaded event state.
- Warnings and Major reports are not counted as prior Minor violations.
- TS1, TS2, and TS3 do not collide with official IDs and use the same history logic.
- Legacy flags with missing rule, match type, match number, or field render safely.
- Rule selection does not clear team, match, field, or description state.
- Successful flag submission resets the selected rule; failed validation preserves form state.
- No automatic async history request exists, so the specified stale SG6→SG7 lookup race is not present.
- Panel codes are removed from the normal `/api/state` response.
- Cookies are HTTP-only, SameSite protected, and Secure in production.
- Notes, scores, and conflict mutations have normal panel/role checks.
- Public conflict data is redacted.
- Same-slot collisions are blocked in both stores.
- Auto-assignment checks capacity, division, and known conflicts.
- Score criteria and rubric values are server-validated.
- Common Field Rules reuse canonical rule objects and do not create runtime duplicates.
- Pit orientation tests confirm right-to-left and bottom-up behavior.
- React escaping is used; no user-controlled unsafe HTML rendering was found.
- Reduced-motion styles, minimum touch sizing, and responsive breakpoints exist.
- There are no middleware, Server Actions, realtime subscriptions, or websocket cleanup paths to audit.

---

## 7. Rule Data Audit

- Official rule count expected: **78**
- Official rule count actual: **78**
- Custom Tournament Special rule count expected: **3**
- Custom Tournament Special rule count actual: **3**
- Total canonical rules: **81**
- Missing official IDs: **None**
- Missing custom IDs: **None**
- Duplicate IDs: **None**
- Incorrect category assignments: **None**
- Incorrect official titles: **None**
- Accidental title replacement by short labels: **None**
- Rule data duplicated across runtime source files: **NO**
- Category ordering: **Incorrect — Tournament Special is last instead of first**

Category counts:

- Scoring: 5
- Specific Game: 7
- Safety: 3
- General: 5
- General Game: 14
- Robot Skills: 8
- Robot: 17
- Tournament: 19
- Tournament Special: 3

TS short labels are exact and ordered TS1, TS2, TS3:

- TS1 — Sportsmanlike Conduct
- TS2 — Unsportsmanlike Conduct
- TS3 — Helping Reset the Field

Search verification passed for the requested SG6, SG7, GG4, GG10, GG12, TS1, TS2, and TS3 terms, including angle-bracket IDs, numeric/partial input, synonyms, and case-insensitive matching.

---

## 8. Automated Test Results

- Tests: **PASS**
  - Command: `npm test`
  - Result: 256 passed, 0 failed.
  - The first sandboxed run was blocked by an OS-level `tsx` pipe permission; the approved unrestricted rerun passed.

- Typecheck: **PASS**
  - Command: `npm run typecheck`

- Lint: **PASS WITH WARNINGS**
  - Command: `npm run lint`
  - Result: 0 errors, 11 warnings.

- Production build: **PASS WITH WARNINGS**
  - Command: `npm run build`
  - Result: successful production build; same 11 lint warnings.

- Configuration check: **PASS, but incomplete**
  - Command: `npm run check`
  - Result: “All good”; see BUG-026.

- Dependency audit: **FAIL**
  - Commands: `npm audit --omit=dev --json`, `npm audit --json`
  - Result: three vulnerable production packages: Next.js critical, PostCSS high, Sharp high.

- Git diff validation: **PASS**
  - `git diff --check` found no whitespace errors.

The pre-existing worktree remained unchanged during the audit: 12 modified files, 163 insertions and 59 deletions. This report file was added afterward at the user's request.

---

## 9. Missing Test Coverage

High-value missing coverage includes:

- Live Supabase tests proving anonymous read/write denial for every table and sensitive column.
- Endpoint-level permission matrices instead of locally reimplementing permission functions in tests.
- Team cancellation and queuer ownership rules.
- Stale judge sessions after panel deletion or code rotation.
- Request reassignment across panels.
- One-live-scheduled-request-per-team enforcement.
- Legal request state transitions and simultaneous updates.
- Atomic panel edits and failed-import rollback.
- Manual team assignment to nonexistent or cross-division panels.
- Real PostgreSQL integration and concurrency tests, especially score totals.
- Cross-referee flag correction authority and audit attribution.
- Explicit event-boundary and timezone tests for flag history.
- “Flagged Today” date filtering.
- Required Tournament Special category ordering.
- Rapid multi-criterion score saves and stale error responses.
- Ready-now conversion failure.
- Panel schedule edits with existing bookings and past-slot API submissions.
- File-store team deletion cascades.
- Duplicate and out-of-range pit placements.
- Effective `.env.local` precedence and doctor-script failure cases.
- Browser E2E tests for routes, redirects, mobile/tablet overflow, keyboard navigation, focus handling, and long rule titles.

---

## 10. Performance Findings

- Every `/api/state` poll performs five full store/table reads before evaluating the ETag. The ETag saves response bytes, not database work.
- Main state polls every 4–6 seconds, scores every 15 seconds, and activity every 10 seconds per connected client.
- Flags and file-backend requests are unbounded. PostgreSQL requests are silently capped at 1,500, which creates a different long-event failure mode.
- Several views repeatedly filter full team/flag arrays during render, producing avoidable team-by-flag work.
- PostgreSQL lacks targeted indexes for common flag team/time history lookups, and runtime-created indexes do not fully match `schema.sql`.
- The JSON backend rewrites a complete snapshot after mutations and does not safely scale to multiple processes.
- Unused Supabase packages increase install, maintenance, and advisory surface.

These are unlikely to be severe with a small event, but polling multiplication can become material with many team tablets, judge devices, and public boards.

---

## 11. Security / Authorization Findings

Confirmed security findings:

- Anonymous live Supabase access exposes operational tables and panel login codes: BUG-001.
- Critical vulnerable Next.js runtime: BUG-002.
- Public/default role-code risk and unlimited login attempts: BUG-004.
- Stale deleted-panel sessions gain global visibility: BUG-008.
- Referees can alter reports authored by other referees: BUG-013.
- Queuers can cancel requests outside documented ownership: BUG-014.
- Judges can read global administrative activity: BUG-019.
- State responses expose excess messages and staff metadata: BUG-020.
- Remote PostgreSQL certificate verification is disabled by default: BUG-027.

No user-controlled raw HTML injection, leaked server-only environment variable in client source, or SQL string concatenation vulnerability was found. However, the authorization and live database exposure findings are sufficient to fail the security review.

---

## 12. Regression Risks

- The working tree already contains uncommitted edits in rules, referee UI, flag validation, pit map behavior, documentation, and related tests.
- Several tests assert source strings or duplicate production logic rather than exercising real endpoints. One test effectively reproduces the broken cancellation permission and therefore passes with the bug.
- Tests currently codify Tournament Special as the last category.
- PostgreSQL tests inspect source but do not run against a real concurrent database.
- The runtime migration and standalone Supabase schema have already drifted on RLS and indexes.
- Current state contains legacy flag records missing newer match/rule fields.
- Rule selector, optional Good/Warning rule behavior, corrections, repeat history, and pit-floor rendering are the areas most exposed to recent-change regression.
- There is no full browser E2E suite and no dependency-security gate.
- File and PostgreSQL backends have behavior differences around deletion, constraints, concurrency, and migration.

---

## 13. Final Recommendation

**NOT READY**

The immediate release blockers are:

1. Close anonymous Supabase access and rotate all exposed panel codes.
2. Upgrade the critically vulnerable Next.js dependency.
3. Replace or clearly isolate the destructive schema reset.
4. Correct the confirmed authorization and core workflow integrity failures.
5. Add endpoint and PostgreSQL integration tests for the high-risk paths before field use.

The clean build and passing unit suite are encouraging, and the rule dataset itself is accurate. They do not offset the confirmed live data exposure, RCE advisories, broken cancellation/reassignment behavior, and non-atomic data mutations.
