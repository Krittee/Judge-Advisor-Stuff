# Awards Desk (2.2.0) — backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only `marketing` role, an `award_releases` table, and the JA routes to send / recall / send-all-ready awards, with sent awards locked — server and data only.

**Architecture:** One new record kind `AwardReleaseRow` (file store + Postgres table `award_releases`, snapshot in jsonb). The send rules are pure functions in a new `src/lib/releases.ts`; one route file `src/app/api/awards/released/route.ts` reads (GET) and writes (PUT send, POST send-all, DELETE recall). Locks are one shared helper called from the winners, no-winner and teams routes.

**Tech Stack:** Next.js 15 route handlers, TypeScript, node:test via `npm test` (tsx), file store + `pg`.

**Spec:** `docs/superpowers/specs/2026-11-19-awards-desk-design.md` (commit `25b35a3`)

## Global Constraints

- No pages, components or CSS. A later UI session builds `/marketing` from this API.
- DB change additive only: `create table if not exists award_releases`, `alter table award_releases enable row level security;`. No change to `award_winners` / `award_no_winner`.
- Marketing gets **nothing** from `/api/state` the public (no session) does not get, and nothing from `/api/awards` (GET stays judge/admin only).
- `GET /api/awards/released` replies with `Cache-Control: no-store`, and for marketing a `recalled` row carries no teams and no `previous`.
- Lock copy: winners / no-winner → `"Recall it from Marketing first."` (409). Team delete / division change → `"Recall <Award label> from Marketing first."` (409).
- Every send and recall writes one activity row, `kind: "award"`.
- `MARKETING_CODE`, dev default `MKTG01` (added to `PUBLISHED_CODES` in **both** `src/lib/auth.ts` and `scripts/doctor.mjs`); production refuses defaults like every other code.
- Test on a copy of data only (`DATA_FILE` in the scratchpad or `tmpdir()`), never `.data/`. No `npm run build`. ESLint with `--ignore-pattern '.claude/**'`. Commit locally only; never push.

## Decisions this plan makes (spec left open or silent)

1. **Route shape:** one path, `/api/awards/released` — `GET` read, `PUT {awardId, division}` send one, `POST {}` send all ready, `DELETE {awardId, division}` recall. Mirrors `no-winner` (PUT set / DELETE clear).
2. **Marketing name is optional** (default `"Marketing"`). The spec says "like the Coordinator", but the Coordinator's name is required at sign-in because it attributes bookings; marketing writes nothing, so nothing needs a name.
3. **"Reset the day" also clears `award_releases`.** It is in the Danger zone and already clears `award_winners` / `award_no_winner`; keeping releases would leave marketing showing winners that no longer exist.
4. **The team lock also covers the paste import** (`POST /api/admin/teams`): a pasted line that moves an existing team in a sent snapshot to another division is refused (409, whole paste, before any write), same as PATCH.
5. **Sending an award already `sent`** is a 200 that writes and logs nothing (the lock means it cannot differ). **Recalling one already `recalled`** is the same. Recalling one never sent is 404.
6. `sent_at` is set to now on every send that writes (first send, and re-send after recall). `previous` / `changed_at` follow the spec's Send rules exactly.
7. `/api/state` fix: `includeStaffFields` becomes false for marketing (today it is `session !== null`, which would hand marketing the staff names the public never sees).

## Review Focus

- **A sent award changed through a side door:** the JA clears a winner, marks No winner over holders, gives a Judges Award a second team, deletes a team or moves its division (PATCH and paste) while sent → every one 409, nothing written. Tests in Tasks 4.
- **Recalled decision leaking to marketing:** a marketing GET after recall shows the row as `recalled` with `teams: []`, `previous: null`, `no_winner: false`. Test in Task 3.
- **Old data files without `awardReleases`** must load (`data.awardReleases ??= []`). Test in Task 2.
- **Judges Award with one of two places** is not ready: send → 409, send-all → skipped `"not ready"`. Test in Task 3.
- **Wipe:** reset day and wipe everything both clear releases in both stores (Postgres names `award_releases` in both truncates: no team FK to cascade from). Tests in Task 2.

---

### Task 1: The `marketing` role

**Files:**
- Modify: `src/lib/auth.ts` (`ROLES`, `Session`, `getSession`, `PUBLISHED_CODES`, `resolveCode`, `actorLabel`, permission table comment), `src/app/api/session/route.ts` (no change needed if name stays optional — confirm only), `src/lib/activity.ts` (`ROLE_NAMES`, `splitActor` regex), `src/lib/types.ts` (`ViewerCapabilities.role`), `src/lib/server-state.ts` (`includeStaffFields`, header comment), `scripts/doctor.mjs` (published list, warn list, published-check list), `.env.example`
- Test: `tests/marketing.runtime.test.ts` (new, harness copied from `tests/awardsRoute.runtime.test.ts`), `tests/authHardening.test.ts` (existing list-sync test covers doctor)

**Interfaces — Produces:**
- `Session` gains `{ role: "marketing"; name: string }`; `ROLES` gains `"marketing"`.
- `resolveCode(code, name)` → `{ role: "marketing", name: cleanName || "Marketing" }` for `MARKETING_CODE` (dev default `"MKTG01"`), checked after the coordinator code.

- [ ] **Step 1: Write failing tests** in `tests/marketing.runtime.test.ts`:
  - `marketing signs in with MKTG01 in development, with or without a name` — `POST /api/session {code:"mktg01"}` → 200, `session` deep-equals `{role:"marketing", name:"Marketing"}`; with `name:"Pim"` → name `"Pim"`.
  - `production refuses the published marketing code` — with `NODE_ENV=production` (restore after) and `MARKETING_CODE=MKTG01`, `resolveCode("MKTG01","")` → `null`.
  - `marketing is refused by every write and every private read` — as marketing: `GET /api/awards` 403, `POST /api/awards` 403, `PUT`/`DELETE /api/awards/winners` 403, `PUT`/`DELETE /api/awards/no-winner` 403, `POST /api/requests` 403, `GET /api/notes`, `GET /api/scores`, `GET /api/flags`, `GET /api/conflicts`, `GET /api/admin/activity`, `PATCH /api/admin/teams`, `PUT /api/team-language`, `PUT /api/referee-setup` → each 403 (use whichever method each route exports; assert `status === 403`).
  - `marketing gets exactly what the public gets from /api/state` — seed a request with `created_by`; `loadState(marketing)` minus `viewer` deep-equals `loadState(null)` minus `viewer`; `viewer.role === "marketing"`, every `can*` false.
  - `every can* helper denies marketing` — `canAdvance, canReadNotes, canAdminister, canSetUpRefereeing, canRemoveFlag, canSetTeamLanguage, canFlag, canReadFlags, mayActOnPanel(m, "x"), canCancel(m, "requested")` all `false`.
- [ ] **Step 2:** `npm test -- tests/marketing.runtime.test.ts` (or the tsx line from `package.json`) → FAIL.
- [ ] **Step 3: Implement.** `getSession` accepts `"marketing"` in the admin/queuer/coordinator branch. `actorLabel` returns `marketing:${name}`; `ROLE_NAMES.marketing = "Marketing"`; `splitActor` regex adds `marketing`. `includeStaffFields = session !== null && session.role !== "marketing"` (refereeSetup `set_by` follows it). Doctor: add `"MKTG01"` to its `PUBLISHED_CODES`, `"MARKETING_CODE"` to both key lists. `.env.example`, after `COORDINATOR_CODE`:
  ```
  # Marketing's code: reads the Awards Desk (awards the Judge Advisor has sent), nothing else.
  MARKETING_CODE=MKTG01
  ```
- [ ] **Step 4:** full `npm test` → PASS (incl. `authHardening` list-sync); `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `Awards Desk: marketing role (read-only, MARKETING_CODE)`.

### Task 2: `award_releases` in both stores, and the send rules

**Files:**
- Create: `src/lib/releases.ts` (pure, no store import)
- Modify: `src/lib/types.ts` (next to `NoWinnerRow`), `src/lib/db/types.ts` (next to `setNoWinner`), `src/lib/db/file.ts` (`Data`, `empty`, `migrate`, `demoData`, `resetDay`, new functions, store object), `src/lib/db/postgres.ts` (table in migration, RLS line, three methods, both truncates)
- Test: `tests/releases.test.ts` (new, pure), `tests/storeConformance.runtime.ts`, `tests/postgres-sql.test.mjs`, `tests/storeFile.runtime.test.ts` (old-file load)

**Interfaces — Produces (src/lib/types.ts):**
```ts
export type ReleaseTeam = { id: string; number: string; name: string };
export type ReleaseSnapshot = { teams: ReleaseTeam[]; no_winner: boolean };
export type ReleaseStatus = "sent" | "recalled";
export type AwardReleaseRow = ReleaseSnapshot & {
  award_id: string; division: string;
  previous: ReleaseSnapshot | null;
  status: ReleaseStatus;
  sent_at: string; sent_by: string; changed_at: string | null;
};
```
**Store (src/lib/db/types.ts):**
- `type SendRelease = { awardId: string; division: string; snapshot: ReleaseSnapshot; previous: ReleaseSnapshot | null; changedAt: string | null; sentBy: string }`
- `listReleases(): Promise<AwardReleaseRow[]>` — ordered `sent_at, award_id, division`.
- `sendRelease(input: SendRelease): Promise<AwardReleaseRow>` — upsert on `(award_id, division)`: status `sent`, `sent_at` now, every other field from input.
- `recallRelease(awardId: string, division: string): Promise<AwardReleaseRow | null>` — sets status `recalled`; `null` if no row.
- `resetDay` and `resetAll` clear releases.

**Pure logic (src/lib/releases.ts):**
- `decisionFor(award: AwardView, division: string, winners: WinnerRow[], noWinners: NoWinnerRow[], teams: Team[]): ReleaseSnapshot | null` — `{teams:[], no_winner:true}` if marked; the holders' `{id, number, name}` (sorted by number) if `holders.length === award.places`; else `null`.
- `sameDecision(a: ReleaseSnapshot, b: ReleaseSnapshot): boolean` — equal `no_winner` and equal **set** of team ids.
- `nextSend(current: AwardReleaseRow | undefined, snapshot: ReleaseSnapshot, now: string): { previous: ReleaseSnapshot | null; changedAt: string | null } | "unchanged"` — `"unchanged"` when `current?.status === "sent"`; first send `{null, null}`; recalled + same → current's `previous`/`changed_at`; recalled + different → `{previous: {teams: current.teams, no_winner: current.no_winner}, changedAt: now}`.
- `sentRelease(releases, awardId, division): AwardReleaseRow | undefined` (status `sent` only).
- `sentHolding(releases, teamId): AwardReleaseRow | undefined` — first `sent` row whose `teams` has that id.

- [ ] **Step 1: Failing tests.**
  - `tests/releases.test.ts`: `decisionFor` → null for 0 winners, null for Judges Award (places 2) with 1, snapshot of 2 with 2, `{[],true}` when marked; `sameDecision` true for `[A,B]` vs `[B,A]`, false for `[A]` vs `[C]`, false for `{[],true}` vs `{[A],false}`; `nextSend` covers first / sent→"unchanged" / recalled+same keeps `previous` and `changed_at` from current / recalled+different sets previous = current snapshot and changedAt = now / a third change makes previous the one just replaced.
  - `storeConformance.runtime.ts`: `sendRelease` then `listReleases` round-trips teams (with ids), `no_winner`, `previous`, `changed_at`, status `sent`; second `sendRelease` on same key is one row; `recallRelease` → status `recalled`, teams kept; unknown key → `null`; `resetDay()` empties releases; `resetAll()` empties releases.
  - `postgres-sql.test.mjs`: migrate body matches `create table if not exists award_releases ( award_id text not null, division text not null, teams jsonb not null default '[]'::jsonb, no_winner boolean not null default false, previous jsonb, status text not null check (status in ('sent', 'recalled')), sent_at timestamptz not null default now(), sent_by text not null, changed_at timestamptz, primary key (award_id, division) );` and includes `alter table award_releases enable row level security;`; `sendRelease` is one `insert … on conflict (award_id, division) do update …` with teams/previous passed as JSON text cast `::jsonb`; `recallRelease` is `update award_releases set status = 'recalled' where award_id = $1 and division = $2 returning *`; both truncates match `/\baward_releases\b/`.
  - `storeFile.runtime.test.ts`: a data file written without `awardReleases` loads and `listReleases()` → `[]`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** per the interfaces. Postgres: `previous` stays `null` (not JSON `"null"`) when input is null.
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `Awards Desk: award_releases in both stores, send rules`.

### Task 3: `/api/awards/released` — read, send, send all, recall

**Files:**
- Create: `src/app/api/awards/released/route.ts`
- Modify: `src/lib/types.ts` (reply types), `src/lib/server-state.ts` (export the divisions list it already builds as `eventDivisions(panels, teams): string[]`, used by both)
- Test: `tests/awardsReleased.runtime.test.ts` (new; harness from `awardsRoute.runtime.test.ts`)

**Interfaces — Consumes:** Task 2 store methods and `releases.ts`. **Produces (src/lib/types.ts):**
```ts
export type ReleasedAward = { id: string; label: string; order: number; places: number };
export type ReleasedView = { awards: ReleasedAward[]; divisions: string[]; releases: AwardReleaseRow[] };
export type ReleaseReply = { release: AwardReleaseRow };
export type SendAllReply = {
  sent: AwardReleaseRow[];
  skipped: { awardId: string; division: string; reason: "not ready" | "already sent" }[];
};
```
Routes (all writes `canAdminister` only → else 403 `"Only the Judge Advisor can send awards to Marketing."`):
- `GET` — admin or marketing, else 403. `awards` from `awards()` with `order` = config index; `divisions` = `eventDivisions`; `releases` = all rows, but for marketing a `recalled` row has `teams: []`, `no_winner: false`, `previous: null`. `no-store`.
- `PUT {awardId, division}` — 400 missing field / unknown award. `decisionFor` null → 409 `"<Label> in <division> is not decided yet. Pick its winner (or both for the Judges Award) or mark it No winner first."` `nextSend` `"unchanged"` → 200 `{release: current}`, no log. Else `sendRelease`, log `action: "sent <Label> to Marketing"`, `detail: "<division> · <numbers joined ' and ' | 'No winner'>"` plus `" · was <old numbers | No winner>"` when `changedAt` was just set; `teamId` first team or null. Reply `ReleaseReply`.
- `DELETE {awardId, division}` — 400 missing; no row → 404 `"<Label> has not been sent to Marketing."`; already recalled → 200, no log; else `recallRelease`, log `"recalled <Label> from Marketing"`, detail division. Reply `ReleaseReply`.
- `POST` — for every division × award in config order: not ready → skipped `"not ready"`; `sent` → skipped `"already sent"`; else send exactly as PUT (same log line each). Reply `SendAllReply`.

- [ ] **Step 1: Failing tests** (`tests/awardsReleased.runtime.test.ts`; each test resets the store):
  - `only the Judge Advisor sends, recalls or sends all; marketing and admin read; everyone else is 403` (judge, queuer, referee, coordinator, marketing, null).
  - `an award without its winners is 409; a single winner or No winner sends; the reply and the log say so`.
  - `the Judges Award needs both places: one is 409, two sends both teams`.
  - `sending a sent award again changes nothing and logs nothing`.
  - `recall then re-send the same teams: status sent, previous and changed_at untouched` (in either order of the two Judges Award teams).
  - `recall then send a different team: previous is the old snapshot, changed_at set; a third change makes previous the one just replaced` (log detail ends `· was <old number>`).
  - `No winner to a team after recall counts as a change` (previous `{teams:[], no_winner:true}`).
  - `marketing never sees a recalled decision` (teams `[]`, previous null); admin still does.
  - `send all ready sends every ready, unsent award and lists the rest as skipped with a reason`.
  - `the released read carries award list, divisions and rows only` — reply keys exactly `awards, divisions, releases`; no nominations/winners keys; `cache-control` header `no-store` (extend `hit` to return headers or check in the test).
  - `/api/state carries no releases, whoever asks` (admin, marketing, null: no key containing `release`).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test`, tsc → clean.
- [ ] **Step 5: Commit** `Awards Desk: send, recall and send-all routes for the Judge Advisor; released read for Marketing`.

### Task 4: The lock

**Files:**
- Modify: `src/app/api/awards/shared.ts`, `src/app/api/awards/winners/route.ts` (PUT, DELETE), `src/app/api/awards/no-winner/route.ts` (PUT, DELETE), `src/app/api/admin/teams/route.ts` (DELETE, PATCH division, POST import)
- Test: `tests/awardsReleased.runtime.test.ts` (same file as Task 3)

**Interfaces — Produces (shared.ts):**
- `refuseIfSent(awardId: string, division: string): Promise<NextResponse | null>` — 409 `{error: "Recall it from Marketing first."}` when `sentRelease(...)`, else null. Called right after each route's 400 checks, before any read-then-write.
- `teamLockMessage(teamId: string): Promise<string | null>` — `"Recall <Label> from Marketing first."` via `sentHolding`, else null. Teams route: DELETE checks it before `deleteTeam`; PATCH checks it only when `"division" in body` and the resolved division differs from the team's; POST import checks each parsed line whose number matches an existing team with a different division, before `upsertTeams`.

- [ ] **Step 1: Failing tests:**
  - `while sent, winners PUT/DELETE and no-winner PUT/DELETE are 409 "Recall it from Marketing first." and nothing changes` — check `listWinners`/`listNoWinners` unchanged; another division of the same award is not locked.
  - `after recall the award is editable again`.
  - `a team in a sent snapshot cannot be deleted or moved to another division (PATCH or paste); a rename or pit change still works; after recall it can be deleted` — 409 message `"Recall Design from Marketing first."`.
  - `reset the day and wipe everything clear releases` — via `PATCH /api/admin/teams {action:"resetDay"}` and `{action:"resetAll"}`, then `listReleases()` → `[]`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test`, tsc, `npx eslint . --ignore-pattern '.claude/**'` → clean.
- [ ] **Step 5: Commit** `Awards Desk: a sent award is locked until recalled`.

### Task 5: Record and hand-over

- [ ] Add a `FIXES.md` row + section "Awards Desk backend (2.2.0)" (status `Built on claude/awards-desk-backend-921f59, UI pending`). No version bump (the UI session ships 2.2.0).
- [ ] Final run on a scratch copy: `DATA_FILE=<scratchpad>/state.json npm test`, tsc, eslint. Optional: Neon conformance (`TEST_DATABASE_URL` from `.env.test.local`, hotspot) — report if not run.
- [ ] Write API shapes to the shared notes folder for the UI session. Commit `Awards Desk backend: fix record`.
