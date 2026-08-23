import { Pool } from "pg";
import type { ActivityRow, Note, Panel, RequestRow, Team } from "../types";
import { compareTeamNumbers, normalizeTeamNumber } from "../teamNumber";
import { normalizePanelCode, randomPanelCode } from "../panelCode";
import { DEFAULT_DIVISION, presetPanels } from "../presets";
import {
  StoreError,
  type ImportedTeam,
  type NewActivity,
  type NewNote,
  type NewRequest,
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

const LIVE = ["requested", "acknowledged", "interviewing"] as const;

let pool: Pool | null = null;

function db(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  pool = new Pool({
    connectionString,
    // Serverless spins up many short-lived instances; a big pool per
    // instance would exhaust the server's connection limit.
    max: Number(process.env.PGPOOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: sslFor(connectionString),
  });

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

let migration: Promise<void> | null = null;

/** Runs once per server instance; concurrent callers share the promise. */
function ready(): Promise<void> {
  migration ??= migrate().catch((e) => {
    migration = null; // let the next request retry rather than wedging
    throw e;
  });
  return migration;
}

async function migrate(): Promise<void> {
  await db().query(`
    create table if not exists panels (
      id            uuid primary key default gen_random_uuid(),
      name          text not null,
      code          text not null unique,
      division      text not null default 'Division 1',
      judges        text[] not null default '{}',
      sort_order    int not null default 0,
      slot_start_at timestamptz,
      slot_minutes  int not null default 12,
      slot_count    int not null default 0,
      created_at    timestamptz not null default now()
    );

    create table if not exists teams (
      id         uuid primary key default gen_random_uuid(),
      number     text not null unique,
      name       text not null,
      panel_id   uuid references panels(id) on delete set null,
      division   text not null default 'Division 1',
      pit        text,
      created_at timestamptz not null default now()
    );

    create table if not exists requests (
      id              uuid primary key default gen_random_uuid(),
      team_id         uuid not null references teams(id) on delete cascade,
      panel_id        uuid references panels(id) on delete set null,
      status          text not null default 'requested',
      kind            text not null default 'queue',
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
    create index if not exists activity_created_idx on activity (created_at desc);

    -- The two rules that keep the board honest. Enforced here so they
    -- hold no matter how many server instances are running.
    create unique index if not exists requests_one_live_per_team
      on requests (team_id)
      where status in ('requested', 'acknowledged', 'interviewing');

    create unique index if not exists requests_unique_slot
      on requests (panel_id, slot_start)
      where kind = 'slot' and status <> 'cancelled';
  `);

  // Schema changes that an already-deployed event may not have yet.
  // Each is guarded so re-running is free and no roster is ever lost.
  await db().query(`
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

      -- Panels used to carry a room, which turned out not to be wanted.
      alter table panels drop column if exists room;
    end $$;
  `);
}

/** Turn a unique-violation into the message the user should read. */
function translate(e: unknown, context: "queue" | "slot" | "panel"): never {
  const err = e as { code?: string; constraint?: string; message?: string };
  if (err?.code === "23505") {
    if (err.constraint === "requests_one_live_per_team" || context === "queue") {
      throw new StoreError("That team is already in the queue.", 409);
    }
    if (err.constraint === "requests_unique_slot" || context === "slot") {
      throw new StoreError("Someone just took that slot. Pick another one.", 409);
    }
    if (context === "panel") {
      throw new StoreError("That panel code is already in use.", 409);
    }
  }
  throw e;
}

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  const { rows } = await db().query(sql, params);
  return rows as T[];
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
    return rows(
      await query<Panel>("select * from panels order by sort_order, name"),
    );
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
      await query<ActivityRow>(
        "select * from activity order by created_at desc limit $1",
        [limit],
      ),
    );
  },

  async findPanelByCode(code) {
    return one(
      await query<Panel>("select * from panels where upper(code) = upper($1)", [code.trim()]),
    );
  },

  async seedPresetPanels() {
    const existing = new Set((await this.listPanels()).map((p) => p.code.toUpperCase()));
    let created = 0;
    for (const preset of presetPanels()) {
      if (existing.has(preset.code)) continue;
      await query(
        `insert into panels (name, code, division, judges, sort_order)
         values ($1, $2, $3, $4, $5)
         on conflict (code) do nothing`,
        [preset.name, preset.code, preset.division, preset.judges, ++created],
      );
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
    try {
      return one(
        await query<RequestRow>(
          `insert into requests
             (team_id, panel_id, status, kind, slot_start, slot_end, message, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
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
          ],
        ),
      )!;
    } catch (e) {
      translate(e, input.kind === "slot" ? "slot" : "queue");
    }
  },

  async updateRequest(id, patch) {
    const columns = Object.keys(patch);
    if (!columns.length) {
      const current = await this.findRequest(id);
      if (!current) throw new StoreError("That request no longer exists.", 404);
      return current;
    }

    const assignments = columns.map((c, i) => `${c} = $${i + 2}`).join(", ");
    try {
      const updated = one(
        await query<RequestRow>(
          `update requests set ${assignments}, updated_at = now() where id = $1 returning *`,
          [id, ...columns.map((c) => (patch as Record<string, unknown>)[c])],
        ),
      );
      if (!updated) throw new StoreError("That request no longer exists.", 404);
      return updated;
    } catch (e) {
      if (e instanceof StoreError) throw e;
      translate(e, "queue");
    }
  },

  async upsertTeams(list: ImportedTeam[]) {
    if (!list.length) return 0;
    await query(
      `insert into teams (number, name, pit, division)
       select * from unnest($1::text[], $2::text[], $3::text[], $4::text[])
       on conflict (number) do update set
         name = excluded.name,
         pit = excluded.pit,
         division = excluded.division,
         -- A team that changes division loses its panel: the old one is
         -- on the far side of the wall.
         panel_id = case
           when teams.division is distinct from excluded.division then null
           else teams.panel_id
         end`,
      [
        list.map((t) => t.number),
        list.map((t) => t.name),
        list.map((t) => t.pit),
        list.map((t) => t.division),
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
    const updated = one(
      await query<Team>(`update teams set ${assignments} where id = $1 returning *`, [
        id,
        ...columns.map((c) => (patch as Record<string, unknown>)[c]),
      ]),
    );
    if (!updated) throw new StoreError("That team no longer exists.", 404);
    return updated;
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
    const panels = (await this.listPanels()).filter((p) => !division || p.division === division);
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
      (t) => (includeAssigned || !t.panel_id) && (!division || t.division === division),
    );
    if (!pending.length) return 0;

    const load = new Map<string, number>(panels.map((p) => [p.id, 0]));
    if (!includeAssigned) {
      for (const t of teams) {
        if (t.panel_id && load.has(t.panel_id)) load.set(t.panel_id, load.get(t.panel_id)! + 1);
      }
    }

    const assignments: { teamId: string; panelId: string }[] = [];
    for (const team of pending) {
      // The hard wall: only panels in this team's own division are eligible.
      const eligible = panels.filter((p) => p.division === team.division);
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
      return one(
        await query<Panel>(
          `insert into panels
             (name, code, division, judges, sort_order, slot_start_at, slot_minutes, slot_count)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning *`,
          [
            input.name,
            input.code,
            input.division,
            input.judges,
            input.sort_order,
            input.slot_start_at,
            input.slot_minutes,
            input.slot_count,
          ],
        ),
      )!;
    } catch (e) {
      translate(e, "panel");
    }
  },

  async updatePanel(id, patch) {
    // Moving a panel across the wall cannot drag its teams with it — those
    // teams belong to the division they compete in, so they are released
    // for another panel in that division to pick up.
    if (patch.division) {
      await query(
        "update teams set panel_id = null where panel_id = $1 and $2 <> (select division from panels where id = $1)",
        [id, patch.division],
      );
    }

    const columns = Object.keys(patch);
    if (!columns.length) {
      const current = one(await query<Panel>("select * from panels where id = $1", [id]));
      if (!current) throw new StoreError("That panel no longer exists.", 404);
      return current;
    }

    const assignments = columns.map((c, i) => `${c} = $${i + 2}`).join(", ");
    try {
      const updated = one(
        await query<Panel>(`update panels set ${assignments} where id = $1 returning *`, [
          id,
          ...columns.map((c) => (patch as Record<string, unknown>)[c]),
        ]),
      );
      if (!updated) throw new StoreError("That panel no longer exists.", 404);
      return updated;
    } catch (e) {
      if (e instanceof StoreError) throw e;
      translate(e, "panel");
    }
  },

  /** Teams and requests fall back to no panel rather than vanishing. */
  async deletePanel(id) {
    await query("delete from panels where id = $1", [id]);
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

  async logActivity(entry: NewActivity) {
    // The log is a convenience, not a record of account. Never let a
    // failed audit write break the thing the user actually asked for.
    try {
      await query(
        `insert into activity (request_id, team_id, actor, action, detail)
         values ($1, $2, $3, $4, $5)`,
        [
          entry.requestId ?? null,
          entry.teamId ?? null,
          entry.actor,
          entry.action,
          entry.detail ?? null,
        ],
      );
    } catch (e) {
      console.error("[postgres] activity log write failed:", (e as Error).message);
    }
  },

  async resetDay() {
    await query("truncate activity, notes, requests");
  },

  async resetAll() {
    await query("truncate activity, notes, requests, teams, panels cascade");
  },
};
