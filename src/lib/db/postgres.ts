import type { Pool, PoolClient } from "pg";
import type {
  ConflictRow,
  FlagRow,
  JudgeRow,
  Note,
  Panel,
  RefereeSetup,
  RequestRow,
  ScoreRow,
  Team,
} from "../types";
import { compareTeamNumbers, normalizeTeamNumber } from "../teamNumber";
import { randomPanelCode } from "../panelCode";
import { readActivity, type StoredActivity } from "../activity";
import { blendedDivisions, defaultCategory, divisionsCompatible, presetDivisions, presetPanels } from "../presets";
import { hasNearbyBooking } from "../data";
import { isPanelBlocked, judgeKey, panelBlocks } from "../roster";
import {
  StoreError,
  STALE_STATUS_MESSAGE,
  type ImportedTeam,
  type NewActivity,
  type NewNote,
  type JudgePatch,
  type NewConflict,
  type NewFlag,
  type NewJudge,
  type NewRefereeSetup,
  type NewRequest,
  type SaveScore,
  type Store,
} from "./types";

/**
 * Postgres-backed store, for deploying without a terminal.
 *
 * Works with any Postgres that gives you a connection string — Neon,
 * Supabase, Railway, your own box. The schema creates itself on first
 * use, so nobody ever has to open a SQL console.
 *
 * The two invariants are enforced by partial unique indexes rather than
 * by application code. That is stronger than the file store can manage:
 * here they hold even with many server instances running at once, which
 * is exactly the situation serverless hosting creates.
 */

/**
 * The pool and the migration, kept on `globalThis` rather than in this module:
 * `next dev` evaluates the server modules again each time it compiles a route
 * for the first time, and module-level state would open a new pool (and run
 * the migration again) on every one of those.
 */
const shared = ((globalThis as { __judgeQueuePostgres?: PostgresShared }).__judgeQueuePostgres ??= {
  pool: null,
  connecting: null,
  migration: null,
});

type PostgresShared = {
  pool: Pool | null;
  connecting: Promise<Pool> | null;
  migration: Promise<void> | null;
};

/**
 * Connect, loading the driver on demand.
 *
 * `pg` is imported here rather than at the top of the file so that it is
 * only ever required when DATABASE_URL is set. Anyone running on the
 * JSON file — which is the default, and the whole point of the
 * no-database setup — never needs the package installed at all.
 * next.config.ts keeps the bundler from trying to resolve it too.
 */
async function db(): Promise<Pool> {
  if (shared.pool) return shared.pool;
  shared.connecting ??= connect().catch((e) => {
    shared.connecting = null; // let the next request try again
    throw e;
  });
  return shared.connecting;
}

async function connect(): Promise<Pool> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  let Pool: typeof import("pg").Pool;
  try {
    ({ Pool } = await import("pg"));
  } catch {
    throw new Error(
      "DATABASE_URL is set, but the 'pg' database driver is not installed. " +
        "Run `npm install` to add it, or unset DATABASE_URL to use the local file instead.",
    );
  }

  const pool = (shared.pool = new Pool({
    connectionString,
    // Serverless spins up many short-lived instances; a big pool per
    // instance would exhaust the server's connection limit.
    max: Number(process.env.PGPOOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: sslFor(connectionString),
  }));

  pool.on("error", (e) => console.error("[postgres] idle client error:", e.message));
  return pool;
}

/**
 * Decide whether to negotiate TLS.
 *
 * Hosted Postgres is TLS-only and presents a chain Node ships no root
 * for, so verification is off — the connection is still encrypted. A
 * database on this machine has no TLS at all and must not be asked for
 * it. An explicit `sslmode=` in the URL or PGSSLMODE always wins.
 */
function sslFor(connectionString: string): { rejectUnauthorized: boolean } | undefined {
  const mode =
    /[?&]sslmode=([^&]+)/.exec(connectionString)?.[1] ?? process.env.PGSSLMODE ?? "";

  if (mode === "disable") return undefined;
  if (mode && mode !== "prefer") return { rejectUnauthorized: mode === "verify-full" };

  let host = "";
  try {
    host = new URL(connectionString).hostname;
  } catch {
    /* an unparseable URL is the caller's problem, not ours */
  }

  const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]", ""].includes(host);
  return isLocal ? undefined : { rejectUnauthorized: false };
}

/* ------------------------------------------------------------------ *
 * Schema, created on demand
 * ------------------------------------------------------------------ */

/** Runs once per server instance; concurrent callers share the promise. */
function ready(): Promise<void> {
  shared.migration ??= migrate().catch((e) => {
    shared.migration = null; // let the next request retry rather than wedging
    throw e;
  });
  return shared.migration;
}

async function migrate(): Promise<void> {
  await (await db()).query(`
    create table if not exists panels (
      id            uuid primary key default gen_random_uuid(),
      name          text not null,
      code          text not null unique,
      division      text not null default 'Division 1',
      -- Legacy: a panel's judges are the roster's (the judges table) now.
      -- Kept so an older build sharing this database still runs; nothing
      -- here reads or writes it.
      judges        text[] not null default '{}',
      languages     text[] not null default '{}',
      sort_order    int not null default 0,
      slot_start_at timestamptz,
      slot_minutes  int not null default 12,
      slot_count    int not null default 0,
      created_at    timestamptz not null default now()
    );

    -- The judge roster. A panel's judges are the roster judges sitting on it
    -- (a judge sits on at most one panel). The names in panels.judges move
    -- over exactly once, when this table is first created: deduped by name
    -- ignoring case, in the panels' own order, each onto the first panel
    -- that listed them. Re-running finds the table and touches nothing, so
    -- a judge removed later is never brought back from the legacy column.
    -- seq is only there to keep roster order: now() is the same for every
    -- row of one statement.
    do $$
    begin
      if to_regclass('public.judges') is null then
        create table judges (
          id         uuid primary key default gen_random_uuid(),
          seq        bigint generated always as identity,
          name       text not null,
          note       text,
          panel_id   uuid references panels(id) on delete set null,
          created_at timestamptz not null default now()
        );

        insert into judges (name, panel_id)
        select d.name, d.panel_id
          from (
            select distinct on (lower(l.name)) l.name, l.panel_id, l.sort_order, l.panel_name, l.ord
              from (
                select trim(n.name) as name, p.id as panel_id, p.sort_order,
                       p.name as panel_name, n.ord
                  from panels p, unnest(p.judges) with ordinality as n(name, ord)
              ) l
             where l.name <> ''
             order by lower(l.name), l.sort_order, l.panel_name, l.ord
          ) d
         order by d.sort_order, d.panel_name, d.ord;
      end if;
    end $$;

    create unique index if not exists judges_name_unique on judges (lower(name));
    create index if not exists judges_panel_idx on judges (panel_id);

    create table if not exists teams (
      id         uuid primary key default gen_random_uuid(),
      number     text not null unique,
      name       text not null,
      panel_id   uuid references panels(id) on delete set null,
      division   text not null default 'Division 1',
      category   text not null default 'developing',
      pit        text,
      created_at timestamptz not null default now()
    );

    create table if not exists requests (
      id              uuid primary key default gen_random_uuid(),
      team_id         uuid not null references teams(id) on delete cascade,
      panel_id        uuid references panels(id) on delete set null,
      status          text not null default 'requested',
      kind            text not null default 'queue',
      language        text not null default 'en',
      slot_start      timestamptz,
      slot_end        timestamptz,
      message         text,
      created_by      text,
      acknowledged_by text,
      interviewer     text,
      outcome         text,
      requested_at    timestamptz not null default now(),
      acknowledged_at timestamptz,
      started_at      timestamptz,
      finished_at     timestamptz,
      cancelled_at    timestamptz,
      updated_at      timestamptz not null default now()
    );

    create table if not exists notes (
      id         uuid primary key default gen_random_uuid(),
      team_id    uuid not null references teams(id) on delete cascade,
      request_id uuid references requests(id) on delete set null,
      panel_id   uuid references panels(id) on delete set null,
      author     text not null,
      body       text not null,
      created_at timestamptz not null default now()
    );

    -- Exactly one of judge_id (a judge's conflict: the panel they are on is
    -- blocked from the team) and panel_id (a whole-panel conflict, from
    -- before there was a roster). Removing a panel removes its whole-panel
    -- conflicts, never a judge's. (judge_id, team_id) is unique too: see
    -- conflicts_judge_team_unique below.
    create table if not exists conflicts (
      id          uuid primary key default gen_random_uuid(),
      panel_id    uuid references panels(id) on delete cascade,
      judge_id    uuid references judges(id) on delete cascade,
      team_id     uuid not null references teams(id) on delete cascade,
      judge_name  text,
      note        text,
      declared_by text not null,
      created_at  timestamptz not null default now(),
      unique (panel_id, team_id),
      constraint conflicts_one_owner check ((panel_id is null) <> (judge_id is null))
    );

    create table if not exists flags (
      id           uuid primary key default gen_random_uuid(),
      team_id      uuid not null references teams(id) on delete cascade,
      kind         text not null,
      body         text not null,
      author       text not null,
      match_type   text,
      match_number text,
      field        text,
      created_at   timestamptz not null default now()
    );

    -- The program and number of fields for this event. One row, ever: the
    -- check on id is what stops a second one. set_on is text on purpose: it
    -- is a calendar date from the referee device, and a date column would
    -- come back through the driver as a Date and shift with the server
    -- timezone.
    create table if not exists referee_setup (
      id          int primary key default 1 check (id = 1),
      ruleset     text not null,
      field_count int not null check (field_count between 1 and 20),
      set_by      text not null,
      set_on      text not null,
      updated_at  timestamptz not null default now()
    );

    create table if not exists scores (
      id         uuid primary key default gen_random_uuid(),
      team_id    uuid not null references teams(id) on delete cascade,
      rubric_id  text not null,
      values     jsonb not null default '{}'::jsonb,
      total      int not null default 0,
      scored_by  text not null,
      panel_id   uuid references panels(id) on delete set null,
      updated_at timestamptz not null default now(),
      unique (team_id, rubric_id)
    );

    create table if not exists activity (
      id         uuid primary key default gen_random_uuid(),
      request_id uuid references requests(id) on delete cascade,
      team_id    uuid references teams(id) on delete set null,
      actor      text not null,
      action     text not null,
      detail     text,
      created_at timestamptz not null default now()
    );

    create index if not exists teams_panel_idx    on teams (panel_id);
    create index if not exists requests_team_idx  on requests (team_id);
    create index if not exists requests_panel_idx on requests (panel_id);
    create index if not exists notes_team_idx     on notes (team_id);
    create index if not exists scores_team_idx    on scores (team_id);
    create index if not exists conflicts_panel_idx on conflicts (panel_id);
    create index if not exists conflicts_team_idx  on conflicts (team_id);
    create index if not exists activity_created_idx on activity (created_at desc);

    -- The two rules that keep the board honest. Enforced here so they
    -- hold no matter how many server instances are running.
    --
    -- 'scheduled' belongs in this set too: without it, only the
    -- requested/acknowledged/interviewing statuses ever collided, so a
    -- team could hold any number of future scheduled slots at once, all
    -- accepted, since none of them ever counted as "already in the
    -- queue". A dropped index cannot be redefined with "if not exists"
    -- alone -- its where clause is part of its identity -- so an
    -- already-deployed database's narrower index is dropped first.
    drop index if exists requests_one_live_per_team;

    -- The index cannot be created while a team holds two live rows, which an
    -- older database can (the index used to leave 'scheduled' out). Left as
    -- is, the create fails and every request after it fails too. So first
    -- cancel every live row beyond the one that counts: the most advanced
    -- status, then the earliest request. With no duplicates this touches
    -- nothing.
    update requests set status = 'cancelled', cancelled_at = now(), updated_at = now()
     where id in (
       select id from (
         select id, row_number() over (
           partition by team_id
           order by case status
                      when 'interviewing' then 1
                      when 'acknowledged' then 2
                      when 'requested'    then 3
                      else 4
                    end,
                    requested_at, id
         ) as rn
         from requests
         where status in ('requested', 'acknowledged', 'interviewing', 'scheduled')
       ) ranked
       where ranked.rn > 1
     );

    create unique index if not exists requests_one_live_per_team
      on requests (team_id)
      where status in ('requested', 'acknowledged', 'interviewing', 'scheduled');

    create unique index if not exists requests_unique_slot
      on requests (panel_id, slot_start)
      where kind = 'slot' and status <> 'cancelled';

    -- Lock every table down. The app talks to Postgres only from the
    -- server, over the connection string, which bypasses RLS -- so
    -- enabling it with zero policies costs the app nothing while it
    -- stops the anon/publishable key (e.g. Supabase's Data API) from
    -- reading or writing anything, even panel login codes, even if that
    -- key leaks. supabase/schema.sql already does this for a manual
    -- setup; a deployment that never opens that file in the SQL editor
    -- must not be left unprotected just because it relied on this
    -- runtime migration instead.
    alter table panels    enable row level security;
    alter table teams     enable row level security;
    alter table requests  enable row level security;
    alter table notes     enable row level security;
    alter table conflicts enable row level security;
    alter table judges    enable row level security;
    alter table flags     enable row level security;
    alter table scores    enable row level security;
    alter table activity  enable row level security;
    alter table referee_setup enable row level security;
  `);

  // Schema changes that an already-deployed event may not have yet.
  // Each is guarded so re-running is free and no roster is ever lost.
  await (await db()).query(`
    do $$
    begin
      -- Team numbers were an int before identifiers like "9882K" had to work.
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'teams'
          and column_name = 'number' and data_type <> 'text'
      ) then
        alter table teams alter column number type text using number::text;
      end if;

      -- Divisions arrived after the first rosters did.
      alter table panels add column if not exists division text not null default 'Division 1';
      alter table teams  add column if not exists division text not null default 'Division 1';
      alter table teams  add column if not exists category text not null default 'developing';

      -- Interview language, and which languages a panel covers.
      alter table requests add column if not exists language text not null default 'en';
      alter table panels   add column if not exists languages text[] not null default '{}';

      -- Panels used to carry a room, which turned out not to be wanted.
      alter table panels drop column if exists room;

      -- Which match and field a referee's flag happened at.
      alter table flags add column if not exists match_type text;
      alter table flags add column if not exists match_number text;
      alter table flags add column if not exists field text;

      -- Which Quick Reference rule(s) a violation flag was against (comma-joined).
      alter table flags add column if not exists rule text;

      -- Which ruleset those rules belong to and its manual edition (null
      -- ruleset = recorded before rulesets existed = VEX IQ), and whether
      -- the referee marked the violation as match-affecting.
      alter table flags add column if not exists ruleset text;
      alter table flags add column if not exists manual_version text;
      alter table flags add column if not exists match_affecting boolean not null default false;

      -- Activity entries gained a kind and the actor's role. An older row has
      -- neither (null) and is read as what its action and actor imply.
      alter table activity add column if not exists kind text;
      alter table activity add column if not exists actor_role text;

      -- Conflicts used to belong to a panel alone. Now a judge's (judge_id)
      -- or a whole panel's (panel_id), one of the two; every existing row
      -- keeps its panel and so keeps its meaning.
      alter table conflicts add column if not exists judge_id uuid references judges(id) on delete cascade;
      alter table conflicts alter column panel_id drop not null;
      create unique index if not exists conflicts_judge_team_unique on conflicts (judge_id, team_id);
      if not exists (select 1 from pg_constraint where conname = 'conflicts_one_owner') then
        alter table conflicts add constraint conflicts_one_owner
          check ((panel_id is null) <> (judge_id is null));
      end if;
    end $$;
  `);
}

/** Turn a unique-violation into the message the user should read. */
function translate(e: unknown, context: "queue" | "slot" | "panel"): never {
  const err = e as { code?: string; constraint?: string; message?: string };
  if (err?.code === "23505") {
    if (err.constraint === "requests_one_live_per_team" || context === "queue") {
      throw new StoreError("That team already has a live request or a scheduled booking.", 409);
    }
    if (err.constraint === "requests_unique_slot" || context === "slot") {
      throw new StoreError("Someone just took that slot. Pick another one.", 409);
    }
    if (context === "panel") {
      // Saving a panel's judges can also trip the roster's unique name.
      if (err.constraint === "judges_name_unique") {
        throw new StoreError("A judge with that name was just added. Try again.", 409);
      }
      throw new StoreError("That panel code is already in use.", 409);
    }
  }
  throw e;
}

/** The roster's two refusals, in words: a taken name (409) and a panel that is gone (404). */
function translateJudge(e: unknown, name?: string): never {
  const err = e as { code?: string; constraint?: string };
  if (err?.code === "23505" && err.constraint === "judges_name_unique") {
    throw new StoreError(`${name ?? "That name"} is already on the roster.`, 409);
  }
  if (err?.code === "23503" && err.constraint === "judges_panel_id_fkey") {
    throw new StoreError("That panel no longer exists.", 404);
  }
  throw e;
}

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  const { rows } = await (await db()).query(sql, params);
  return rows as T[];
}

/**
 * Run several statements on one dedicated connection, inside one
 * transaction. Unlike `query()`, which borrows a different connection
 * from the pool on every call, a row lock taken by one statement here is
 * held across every later statement in the same callback — and released
 * only on commit or rollback. That is what lets a merge-then-recompute
 * sequence (see saveScore) stay correct under concurrent writers: a
 * second transaction touching the same row blocks until this one
 * commits, then reads what this one actually wrote, rather than racing
 * it and possibly overwriting a fresher value with a stale one.
 */
async function withClient<T>(
  fn: (run: <R>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>,
): Promise<T> {
  await ready();
  const client: PoolClient = await (await db()).connect();
  try {
    await client.query("begin");
    const run = async <R>(sql: string, params: unknown[] = []): Promise<R[]> => {
      const { rows } = await client.query(sql, params);
      return rows as R[];
    };
    const result = await fn(run);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

type Run = <R>(sql: string, params?: unknown[]) => Promise<R[]>;

/**
 * A panel as the app sees it: its judges are the roster judges sitting on
 * it, in roster order. Every panel read goes through this, so the legacy
 * panels.judges column can never be mistaken for the source of truth.
 */
const PANEL_SELECT = `select p.id, p.name, p.code, p.division, p.languages, p.sort_order,
  p.slot_start_at, p.slot_minutes, p.slot_count, p.created_at,
  array(select j.name from judges j where j.panel_id = p.id order by j.seq) as judges
  from panels p`;

async function panelById(id: string): Promise<Panel | null> {
  return one(await query<Panel>(`${PANEL_SELECT} where p.id = $1`, [id]));
}

/**
 * Make the roster say that exactly these names sit on this panel: each is
 * found (ignoring case) or added, and put on the panel -- off whichever
 * panel it was on -- and any other judge on the panel is taken off. Nobody
 * leaves the roster; their conflicts stay with them. Run it inside the
 * caller's transaction.
 */
async function rotatePanelCode(run: Run, panelId: string): Promise<void> {
  const panel = one(await run<{ code: string }>("select code from panels where id = $1 for update", [panelId]));
  if (!panel) return; // a deleted panel already invalidates its sessions
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = randomPanelCode(8);
    if (code.toUpperCase() === panel.code.toUpperCase()) continue;
    await run("update panels set code = $2 where id = $1", [panelId, code]);
    return;
  }
  throw new Error("Could not generate a new panel code.");
}

async function syncPanelJudges(run: Run, panelId: string, names: string[], keepCodeFor?: string): Promise<void> {
  const seen = new Set<string>();
  const wanted: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(judgeKey(name))) continue;
    seen.add(judgeKey(name));
    wanted.push(name);
  }

  const before = await run<{ name: string; panel_id: string | null }>(
    `select name, panel_id from judges
      where panel_id = $1::uuid
         or lower(name) in (select lower(n) from unnest($2::text[]) as t(n))
      for update`,
    [panelId, wanted],
  );
  const wantedKeys = new Set(wanted.map(judgeKey));
  const left = new Set(
    before
      .filter((j) => j.panel_id && (j.panel_id === panelId ? !wantedKeys.has(judgeKey(j.name)) : wantedKeys.has(judgeKey(j.name))))
      .map((j) => j.panel_id!),
  );

  await run(
    `update judges set panel_id = $1::uuid
      where lower(name) in (select lower(n) from unnest($2::text[]) as t(n))`,
    [panelId, wanted],
  );
  await run(
    `insert into judges (name, panel_id)
     select t.n, $1::uuid from unnest($2::text[]) with ordinality as t(n, ord)
      where not exists (select 1 from judges j where lower(j.name) = lower(t.n))
      order by t.ord`,
    [panelId, wanted],
  );
  await run(
    `update judges set panel_id = null
      where panel_id = $1::uuid
        and lower(name) not in (select lower(n) from unnest($2::text[]) as t(n))`,
    [panelId, wanted],
  );
  for (const id of left) if (id !== keepCodeFor) await rotatePanelCode(run, id);
}

/** Postgres hands back Date objects; the app speaks ISO strings. */
function isoise<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(out)) {
    if (v instanceof Date) out[k] = v.toISOString();
  }
  return out as T;
}

const rows = <T extends Record<string, unknown>>(list: T[]): T[] => list.map(isoise);
const one = <T extends Record<string, unknown>>(list: T[]): T | null =>
  list.length ? isoise(list[0]) : null;

/* ------------------------------------------------------------------ *
 * The Store implementation
 * ------------------------------------------------------------------ */

export const postgresStore: Store = {
  kind: "postgres",
  describe: () => {
    const url = process.env.DATABASE_URL ?? "";
    // Never let credentials reach a log line.
    const host = url.match(/@([^/:?]+)/)?.[1] ?? "unknown host";
    return `Postgres at ${host}`;
  },

  async listPanels() {
    return rows(await query<Panel>(`${PANEL_SELECT} order by p.sort_order, p.name`));
  },

  async listTeams() {
    // Sorted here, not in SQL: Postgres would order text lexicographically
    // and put "100" before "20".
    return rows(await query<Team>("select * from teams")).sort((a, b) =>
      compareTeamNumbers(a.number, b.number),
    );
  },

  async listRequests() {
    return rows(
      await query<RequestRow>(
        "select * from requests order by requested_at desc limit 1500",
      ),
    );
  },

  async listNotes(teamId) {
    return rows(
      teamId
        ? await query<Note>(
            "select * from notes where team_id = $1 order by created_at desc limit 400",
            [teamId],
          )
        : await query<Note>("select * from notes order by created_at desc limit 400"),
    );
  },

  async listActivity(limit = 150) {
    return rows(
      await query<StoredActivity & { team_number: string | null }>(
        `select a.*, t.number as team_number from activity a
         left join teams t on t.id = a.team_id
         order by a.created_at desc limit $1`,
        [limit],
      ),
    ).map((a) => readActivity(a, a.team_number));
  },

  async findPanelByCode(code) {
    return one(
      await query<Panel>(`${PANEL_SELECT} where upper(p.code) = upper($1)`, [code.trim()]),
    );
  },

  async findPanelById(id) {
    return panelById(id);
  },

  async seedPresetPanels() {
    const existing = new Set((await this.listPanels()).map((p) => p.code.toUpperCase()));
    let created = 0;
    for (const preset of presetPanels()) {
      if (existing.has(preset.code)) continue;
      const made = await query<{ id: string }>(
        `insert into panels
           (name, code, division, sort_order, slot_start_at, slot_minutes, slot_count, languages)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (code) do nothing
         returning id`,
        [
          preset.name,
          preset.code,
          preset.division,
          ++created,
          preset.slotStartAt,
          preset.slotMinutes,
          preset.slotCount,
          [],
        ],
      );
      if (made[0]) await withClient((run) => syncPanelJudges(run, made[0].id, preset.judges));
    }
    return created;
  },

  async findTeamByNumber(number) {
    return one(
      await query<Team>("select * from teams where number = $1", [normalizeTeamNumber(number)]),
    );
  },

  async findRequest(id) {
    return one(await query<RequestRow>("select * from requests where id = $1", [id]));
  },

  async createRequest(input: NewRequest) {
    if (input.kind === "slot" && input.slotStart) {
      // ponytail: check-then-insert race on the *gap* rule (the exact-time
      // case still has the DB unique index as a backstop). Two bookings on
      // the very same panel within the same instant is rare enough at
      // event scale; add an advisory lock around this if it ever bites.
      const nearby = await query<RequestRow>(
        `select * from requests where panel_id = $1 and kind = 'slot' and status <> 'cancelled'`,
        [input.panelId],
      );
      if (hasNearbyBooking(nearby, input.panelId, new Date(input.slotStart).getTime())) {
        throw new StoreError(
          "Someone already has a booking within 20 minutes of that time on this panel. Pick another one.",
          409,
        );
      }
    }
    try {
      return one(
        await query<RequestRow>(
          `insert into requests
             (team_id, panel_id, status, kind, slot_start, slot_end, message, created_by, language)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           returning *`,
          [
            input.teamId,
            input.panelId,
            input.kind === "slot" ? "scheduled" : "requested",
            input.kind,
            input.slotStart ?? null,
            input.slotEnd ?? null,
            input.message ?? null,
            input.createdBy,
            input.language,
          ],
        ),
      )!;
    } catch (e) {
      translate(e, input.kind === "slot" ? "slot" : "queue");
    }
  },

  async updateRequest(id, patch, ifStatus) {
    const columns = Object.keys(patch);
    if (!columns.length) {
      const current = await this.findRequest(id);
      if (!current) throw new StoreError("That request no longer exists.", 404);
      if (ifStatus && current.status !== ifStatus) throw new StoreError(STALE_STATUS_MESSAGE, 409);
      return current;
    }

    // Reassigning a booked slot to another panel (or another time) is
    // still a booking — check it the same way createRequest does.
    if (patch.panel_id !== undefined || patch.slot_start !== undefined) {
      const current = await this.findRequest(id);
      if (!current) throw new StoreError("That request no longer exists.", 404);
      const panelId = patch.panel_id ?? current.panel_id;
      const slotStart = patch.slot_start ?? current.slot_start;
      // Judged by the kind the row ends up as: "ready now" turns a booking
      // into a walk-up request, which holds no slot to check.
      if (
        (patch.kind ?? current.kind) === "slot" &&
        current.status !== "cancelled" &&
        panelId &&
        slotStart
      ) {
        const nearby = await query<RequestRow>(
          `select * from requests where panel_id = $1 and kind = 'slot' and status <> 'cancelled' and id <> $2`,
          [panelId, id],
        );
        if (hasNearbyBooking(nearby, panelId, new Date(slotStart).getTime())) {
          throw new StoreError(
            "Someone already has a booking within 20 minutes of that time on this panel.",
            409,
          );
        }
      }
    }

    const assignments = columns.map((c, i) => `${c} = $${i + 2}`).join(", ");
    const values = [id, ...columns.map((c) => (patch as Record<string, unknown>)[c])];
    // Compare-and-set: the status the caller read is part of the WHERE, so
    // the database applies the change only if the row is still in it. That
    // is one atomic statement -- unlike a read followed by a write, nothing
    // another screen does can land between the two.
    const guard = ifStatus ? ` and status = $${values.push(ifStatus)}` : "";
    try {
      const updated = one(
        await query<RequestRow>(
          `update requests set ${assignments}, updated_at = now() where id = $1${guard} returning *`,
          values,
        ),
      );
      if (!updated) {
        // No row matched: either it is gone, or it is no longer in the
        // status the caller expected. Only a second look can tell which.
        if (ifStatus && (await this.findRequest(id))) {
          throw new StoreError(STALE_STATUS_MESSAGE, 409);
        }
        throw new StoreError("That request no longer exists.", 404);
      }
      return updated;
    } catch (e) {
      if (e instanceof StoreError) throw e;
      translate(e, "queue");
    }
  },

  async reassignRequest(id, fromPanelId, toPanelId, ifStatus) {
    try {
      return await withClient(async (run) => {
        const current = one(await run<RequestRow>("select * from requests where id = $1 for update", [id]));
        if (!current) throw new StoreError("That request no longer exists.", 404);
        if (current.status !== ifStatus || current.panel_id !== fromPanelId) {
          throw new StoreError(STALE_STATUS_MESSAGE, 409);
        }

        if (current.kind === "slot" && current.status !== "cancelled" && current.slot_start) {
          const nearby = await run<RequestRow>(
            `select * from requests where panel_id = $1 and kind = 'slot' and status <> 'cancelled' and id <> $2`,
            [toPanelId, id],
          );
          if (hasNearbyBooking(nearby, toPanelId, new Date(current.slot_start).getTime())) {
            throw new StoreError("Someone already has a booking within 20 minutes of that time on this panel.", 409);
          }
        }

        const updated = one(await run<RequestRow>(
          "update requests set panel_id = $2, updated_at = now() where id = $1 returning *",
          [id, toPanelId],
        ));
        if (!updated) throw new StoreError("That request no longer exists.", 404);
        const team = one(await run<Team>(
          "update teams set panel_id = $2 where id = $1 returning *",
          [current.team_id, toPanelId],
        ));
        if (!team) throw new StoreError("That team no longer exists.", 404);
        return updated;
      });
    } catch (e) {
      if ((e as { constraint?: string }).constraint === "requests_unique_slot") {
        throw new StoreError("Someone just took that slot. Pick another one.", 409);
      }
      throw e;
    }
  },

  async upsertTeams(list: ImportedTeam[]) {
    if (!list.length) return 0;
    // A blank cell leaves what is stored (see ImportedTeam), so nulls come in as nulls. The proposed row is
    // checked against not null before the conflict is looked at, so it has to carry a name, division and type:
    // the stored one for a team that exists, else the default. Pit has no default and coalesces on update.
    await query(
      `insert into teams (number, name, pit, division, category)
       select t.number,
              coalesce(t.name, (select k.name from teams k where k.number = t.number), 'Team ' || t.number),
              t.pit,
              coalesce(t.division, (select k.division from teams k where k.number = t.number), $6::text),
              coalesce(t.category, (select k.category from teams k where k.number = t.number), $7::text)
       from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[]) as t(number, name, pit, division, category)
       on conflict (number) do update set
         name = excluded.name,
         pit = coalesce(excluded.pit, teams.pit),
         division = excluded.division,
         category = excluded.category,
         -- A team that changes division loses its panel only when that
         -- panel can't judge the new one: divisionsCompatible, with $8 the
         -- blended divisions.
         panel_id = case
           when teams.division is not distinct from excluded.division then teams.panel_id
           when exists (
             select 1 from panels p
             where p.id = teams.panel_id
               and (p.division = excluded.division
                    or excluded.division = any($8::text[])
                    or p.division = any($8::text[]))
           ) then teams.panel_id
           else null
         end`,
      [
        list.map((t) => t.number),
        list.map((t) => t.name ?? null),
        list.map((t) => t.pit),
        list.map((t) => t.division ?? null),
        list.map((t) => t.category ?? null),
        presetDivisions()[0],
        defaultCategory(),
        blendedDivisions(),
      ],
    );
    return list.length;
  },

  async updateTeam(id, patch) {
    const columns = Object.keys(patch);
    if (!columns.length) {
      const current = one(await query<Team>("select * from teams where id = $1", [id]));
      if (!current) throw new StoreError("That team no longer exists.", 404);
      return current;
    }

    const assignments = columns.map((c, i) => `${c} = $${i + 2}`).join(", ");
    try {
      const updated = one(
        await query<Team>(`update teams set ${assignments} where id = $1 returning *`, [
          id,
          ...columns.map((c) => (patch as Record<string, unknown>)[c]),
        ]),
      );
      if (!updated) throw new StoreError("That team no longer exists.", 404);
      return updated;
    } catch (e) {
      if (e instanceof StoreError) throw e;
      // The unique index on teams.number: someone renamed a team onto
      // another team's number.
      if ((e as { code?: string }).code === "23505") {
        throw new StoreError(`Team ${patch.number ?? ""} already exists.`.replace("  ", " "), 409);
      }
      throw e;
    }
  },

  async deleteTeam(id) {
    await query("delete from teams where id = $1", [id]);
  },

  /**
   * Deal teams round-robin into panels, filling the emptiest first and
   * never exceeding perPanel. Existing assignments are counted so a
   * mid-event top-up stays balanced.
   */
  async autoAssignTeams(perPanel, includeAssigned = false, division?: string) {
    const panels = (await this.listPanels()).filter(
      (p) => !division || divisionsCompatible(p.division, division),
    );
    if (!panels.length) {
      throw new StoreError(
        division
          ? `No judge panels in ${division} yet. Add one first.`
          : "Add at least one judge panel first.",
        400,
      );
    }

    const teams = await this.listTeams();
    const pending = teams.filter(
      (t) =>
        (includeAssigned || !t.panel_id) &&
        (!division || divisionsCompatible(t.division, division)),
    );
    if (!pending.length) return 0;

    const load = new Map<string, number>(panels.map((p) => [p.id, 0]));
    if (!includeAssigned) {
      for (const t of teams) {
        if (t.panel_id && load.has(t.panel_id)) load.set(t.panel_id, load.get(t.panel_id)! + 1);
      }
    }

    // A panel that must stay away from a team is not a candidate for it.
    const blocks = panelBlocks(await this.listConflicts(), await this.listJudges());

    const assignments: { teamId: string; panelId: string }[] = [];
    for (const team of pending) {
      // The hard wall: only panels this team's division may be judged by,
      // and a blended team clears it against every panel (see
      // divisionsCompatible) rather than needing a panel created in the
      // blended division before it can be judged at all.
      // and never one with a declared conflict.
      const eligible = panels.filter(
        (p) => divisionsCompatible(team.division, p.division) && !isPanelBlocked(blocks, p.id, team.id),
      );
      const target = eligible
        .map((p) => ({ id: p.id, count: load.get(p.id) ?? 0 }))
        .filter((p) => p.count < perPanel)
        .sort((a, b) => a.count - b.count)[0];
      if (!target) continue; // no room left in this team's division

      load.set(target.id, target.count + 1);
      assignments.push({ teamId: team.id, panelId: target.id });
    }

    if (assignments.length) {
      await query(
        `update teams set panel_id = data.panel_id::uuid
         from unnest($1::uuid[], $2::uuid[]) as data(team_id, panel_id)
         where teams.id = data.team_id::uuid`,
        [assignments.map((a) => a.teamId), assignments.map((a) => a.panelId)],
      );
    }
    return assignments.length;
  },


  async createPanel(input) {
    try {
      const id = await withClient(async (run) => {
        const [made] = await run<{ id: string }>(
          `insert into panels
             (name, code, division, sort_order, slot_start_at, slot_minutes, slot_count, languages)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning id`,
          [
            input.name,
            input.code,
            input.division,
            input.sort_order,
            input.slot_start_at,
            input.slot_minutes,
            input.slot_count,
            input.languages,
          ],
        );
        await syncPanelJudges(run, made.id, input.judges);
        return made.id;
      });
      return (await panelById(id))!;
    } catch (e) {
      translate(e, "panel");
    }
  },

  async updatePanel(id, patch) {
    // The judges are the roster's; they are synced below, not a column.
    const { judges, ...fields } = patch;
    const columns = Object.keys(fields);
    if (!columns.length) {
      const current = await panelById(id);
      if (!current) throw new StoreError("That panel no longer exists.", 404);
      if (!judges) return current;
      await withClient((run) => syncPanelJudges(run, id, judges));
      return (await panelById(id))!;
    }

    const assignments = columns.map((c, i) => `${c} = $${i + 2}`).join(", ");
    try {
      await withClient(async (run) => {
        const before = one(await run<{ division: string; code: string }>(
          "select division, code from panels where id = $1 for update", [id],
        ));
        if (!before) throw new StoreError("That panel no longer exists.", 404);

        let release: string[] = [];
        if (patch.division && patch.division !== before.division) {
          const moved = patch.division;
          const held = await run<{ id: string; division: string }>(
            "select id, division from teams where panel_id = $1 for update", [id],
          );
          release = held.filter((t) => !divisionsCompatible(t.division, moved)).map((t) => t.id);
          if (release.length && (await run(
            `select 1 from requests where team_id = any($1::uuid[])
             and status in ('requested', 'acknowledged', 'interviewing', 'scheduled') limit 1`,
            [release],
          )).length) {
            throw new StoreError("Reassign or cancel this panel's active requests before changing its division.", 409);
          }
        }

        const updated = one(await run<{ id: string }>(
          `update panels set ${assignments} where id = $1 returning id`,
          [id, ...columns.map((c) => (fields as Record<string, unknown>)[c])],
        ));
        if (!updated) throw new StoreError("That panel no longer exists.", 404);
        if (release.length) await run("update teams set panel_id = null where id = any($1::uuid[])", [release]);
        if (judges) await syncPanelJudges(run, id, judges,
          patch.code && patch.code.toUpperCase() !== before.code?.toUpperCase() ? id : undefined);
      });
    } catch (e) {
      if (e instanceof StoreError) throw e;
      translate(e, "panel");
    }
    return (await panelById(id))!;
  },

  /** Teams and requests fall back to no panel rather than vanishing. */
  async deletePanel(id) {
    await query("delete from panels where id = $1", [id]);
  },

  /**
   * Clear the whole panel list. The foreign keys are ON DELETE SET NULL,
   * so teams and requests survive with no panel — the roster is expensive
   * to rebuild and is never what "delete all panels" is meant to take.
   */
  async deleteAllPanels() {
    const rows = await query<{ id: string }>("delete from panels returning id");
    return rows.length;
  },

  async generatePanelCode() {
    const taken = new Set((await this.listPanels()).map((p) => p.code));
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = randomPanelCode();
      if (!taken.has(code)) return code;
    }
    return `P${Date.now().toString(36).toUpperCase()}`;
  },

  async createNote(input: NewNote) {
    return one(
      await query<Note>(
        `insert into notes (team_id, request_id, panel_id, author, body)
         values ($1, $2, $3, $4, $5) returning *`,
        [input.teamId, input.requestId, input.panelId, input.author, input.body],
      ),
    )!;
  },

  async listConflicts() {
    return rows(await query<ConflictRow>("select * from conflicts"));
  },

  async listJudges() {
    return rows(
      await query<JudgeRow>("select id, name, note, panel_id, created_at from judges order by seq"),
    );
  },

  async addJudge(input: NewJudge) {
    const name = input.name.trim();
    if (!name) throw new StoreError("A judge needs a name.", 400);
    try {
      return one(
        await query<JudgeRow>(
          "insert into judges (name, note) values ($1, $2) returning id, name, note, panel_id, created_at",
          [name, input.note ?? null],
        ),
      )!;
    } catch (e) {
      translateJudge(e, name);
    }
  },

  async updateJudge(id: string, patch: JudgePatch) {
    const sets: string[] = [];
    const values: unknown[] = [id];
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    let name: string | undefined;
    if (patch.name !== undefined) {
      name = patch.name.trim();
      if (!name) throw new StoreError("A judge needs a name.", 400);
      set("name", name);
    }
    if (patch.note !== undefined) set("note", patch.note);
    if (patch.panel_id !== undefined) set("panel_id", patch.panel_id);

    const sql = sets.length
      ? `update judges set ${sets.join(", ")} where id = $1 returning id, name, note, panel_id, created_at`
      : "select id, name, note, panel_id, created_at from judges where id = $1";
    try {
      const save = async (run: Run) => {
        const before = patch.panel_id === undefined ? null : one(await run<{ panel_id: string | null }>(
          "select panel_id from judges where id = $1 for update", [id],
        ));
        const updated = one(await run<JudgeRow>(sql, values));
        if (before?.panel_id && updated && updated.panel_id !== before.panel_id) {
          await rotatePanelCode(run, before.panel_id);
        }
        return updated;
      };
      const updated = patch.panel_id === undefined
        ? await save(query)
        : await withClient(save);
      if (!updated) throw new StoreError("That judge is no longer on the roster.", 404);
      return updated;
    } catch (e) {
      if (e instanceof StoreError) throw e;
      translateJudge(e, name);
    }
  },

  /** The judge's conflicts go with them (on delete cascade). */
  async removeJudge(id) {
    return withClient(async (run) => {
      const gone = one(await run<{ id: string; panel_id: string | null }>(
        "delete from judges where id = $1 returning id, panel_id", [id],
      ));
      if (gone?.panel_id) await rotatePanelCode(run, gone.panel_id);
      return Boolean(gone);
    });
  },

  /** Declaring the same pair twice returns the one already recorded. */
  async listFlags(teamId?: string) {
    // Newest first: on a busy field the last thing seen matters most.
    return teamId
      ? await query<FlagRow>(
          "select * from flags where team_id = $1 order by created_at desc",
          [teamId],
        )
      : await query<FlagRow>("select * from flags order by created_at desc");
  },

  async createFlag(input: NewFlag) {
    return one(
      await query<FlagRow>(
        `insert into flags (team_id, kind, body, author, match_type, match_number, field, rule,
                            ruleset, manual_version, match_affecting)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         returning *`,
        [
          input.teamId,
          input.kind,
          input.body,
          input.author,
          input.matchType,
          input.matchNumber,
          input.field,
          input.rule,
          input.ruleset,
          input.manualVersion,
          input.matchAffecting,
        ],
      ),
    )!;
  },

  async updateFlag(id, edit) {
    const updated = one(
      await query<FlagRow>(
        `update flags set kind = $2, body = $3, match_type = $4, match_number = $5, field = $6, rule = $7,
                          ruleset = $8, manual_version = $9, match_affecting = $10
         where id = $1
         returning *`,
        [
          id,
          edit.kind,
          edit.body,
          edit.matchType,
          edit.matchNumber,
          edit.field,
          edit.rule,
          edit.ruleset,
          edit.manualVersion,
          edit.matchAffecting,
        ],
      ),
    );
    if (!updated) throw new StoreError("That flag no longer exists.", 404);
    return updated;
  },

  async removeFlag(id) {
    const gone = await query<{ id: string }>("delete from flags where id = $1 returning id", [id]);
    return gone.length > 0;
  },

  async getRefereeSetup() {
    // Named columns, not *: the row's id is an implementation detail.
    return one(
      await query<RefereeSetup>(
        "select ruleset, field_count, set_by, set_on, updated_at from referee_setup",
      ),
    );
  },

  async saveRefereeSetup(input: NewRefereeSetup) {
    return one(
      await query<RefereeSetup>(
        `insert into referee_setup (id, ruleset, field_count, set_by, set_on)
         values (1, $1, $2, $3, $4)
         on conflict (id) do update set
           ruleset = excluded.ruleset,
           field_count = excluded.field_count,
           set_by = excluded.set_by,
           set_on = excluded.set_on,
           updated_at = now()
         returning ruleset, field_count, set_by, set_on, updated_at`,
        [input.ruleset, input.fieldCount, input.setBy, input.setOn],
      ),
    )!;
  },

  async addConflict(input: NewConflict) {
    const panelId = input.panelId || null;
    const judgeId = input.judgeId || null;
    if (!panelId === !judgeId) {
      throw new StoreError("A conflict belongs to a judge or to a panel, not both.", 400);
    }

    // A judge's conflict names the judge by id and writes no label. Asking
    // twice returns the first row untouched, as the file store does.
    try {
      return one(
        judgeId
          ? await query<ConflictRow>(
              `insert into conflicts (judge_id, team_id, note, declared_by)
               values ($1, $2, $3, $4)
               on conflict (judge_id, team_id) do update set note = conflicts.note
               returning *`,
              [judgeId, input.teamId, input.note, input.declaredBy],
            )
          : await query<ConflictRow>(
              `insert into conflicts (panel_id, team_id, judge_name, note, declared_by)
               values ($1, $2, $3, $4, $5)
               on conflict (panel_id, team_id) do update set
                 judge_name = coalesce(excluded.judge_name, conflicts.judge_name),
                 note = coalesce(excluded.note, conflicts.note)
               returning *`,
              [panelId, input.teamId, input.judgeName ?? null, input.note, input.declaredBy],
            ),
      )!;
    } catch (e) {
      if ((e as { constraint?: string })?.constraint === "conflicts_judge_id_fkey") {
        throw new StoreError("That judge is no longer on the roster.", 404);
      }
      throw e;
    }
  },

  async removeConflict(id) {
    const gone = await query<{ id: string }>(
      "delete from conflicts where id = $1 returning id",
      [id],
    );
    return gone.length > 0;
  },

  async listScores(teamId) {
    return rows(
      teamId
        ? await query<ScoreRow>("select * from scores where team_id = $1", [teamId])
        : await query<ScoreRow>("select * from scores"),
    );
  },

  /**
   * Record one criterion.
   *
   * Merging happens inside the statement — scores accumulate row by row
   * as judges work down the sheet, and two judges filling in different
   * criteria of the same rubric must not overwrite each other. That part
   * alone is race-free. The total is not: it depends on the rubric's
   * scale, which SQL has no view of, so it has to be computed in JS from
   * the merged values and written back in a second statement — and
   * without both statements sharing one transaction and one row lock,
   * two concurrent saves on the same team/rubric can each read a values
   * snapshot that does not yet include the other's criterion, then write
   * their total in whichever order the network happens to deliver,
   * silently overwriting a fresher total with a stale one. withClient
   * holds the row lock from the merge across the total write, so a
   * second save on this row blocks until this one has fully committed.
   */
  async saveScore(input: SaveScore) {
    const patch =
      input.value === null ? null : JSON.stringify({ [input.criterionId]: input.value });

    return withClient(async (run) => {
      const merged = one(
        await run<ScoreRow>(
          `insert into scores (team_id, rubric_id, values, total, scored_by, panel_id)
           values ($1, $2, coalesce($3::jsonb, '{}'::jsonb), 0, $4, $5)
           on conflict (team_id, rubric_id) do update set
             values = case
               when $3::jsonb is null then scores.values - $6::text
               else scores.values || $3::jsonb
             end,
             scored_by = excluded.scored_by,
             panel_id = coalesce(excluded.panel_id, scores.panel_id),
             updated_at = now()
           returning *`,
          [input.teamId, input.rubricId, patch, input.scoredBy, input.panelId, input.criterionId],
        ),
      )!;

      const total = input.totalOf(merged.values ?? {});
      return one(
        await run<ScoreRow>("update scores set total = $2 where id = $1 returning *", [
          merged.id,
          total,
        ]),
      )!;
    });
  },

  /**
   * Start this rubric over.
   *
   * Deleted rather than zeroed: a team with no scores and a team scored
   * zero everywhere have to stay distinguishable, or the ranking board
   * would show a cleared team as genuinely bottom-placed.
   */
  async clearScore(teamId, rubricId) {
    const gone = await query<{ id: string }>(
      "delete from scores where team_id = $1 and rubric_id = $2 returning id",
      [teamId, rubricId],
    );
    return gone.length > 0;
  },

  async logActivity(entry: NewActivity) {
    // The log is a convenience, not a record of account. Never let a
    // failed audit write break the thing the user actually asked for.
    try {
      await query(
        `insert into activity (request_id, team_id, kind, actor, actor_role, action, detail)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          entry.requestId ?? null,
          entry.teamId ?? null,
          entry.kind,
          entry.actor,
          entry.actorRole,
          entry.action,
          entry.detail ?? null,
        ],
      );
    } catch (e) {
      console.error("[postgres] activity log write failed:", (e as Error).message);
    }
  },

  async resetDay() {
    // Referee flags intentionally survive a day reset: repeat history is
    // event-wide, including at multi-day events. So does the referee setup.
    await query("truncate activity, notes, scores, requests");
  },

  async resetAll() {
    // Teams cascade to referee flags. This is the application's event
    // boundary and must be used before importing the next event's roster.
    // The referee setup is the event's too, so it goes with them.
    await query(
      "truncate activity, notes, scores, conflicts, requests, teams, panels, judges, referee_setup cascade",
    );
  },
};
