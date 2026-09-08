-- =====================================================================
-- Judge Queue — database schema
-- Paste this whole file into: Supabase Dashboard > SQL Editor > New query
-- Safe to re-run: it drops and recreates everything.
--
-- You do not strictly need to run this. When the app starts with
-- DATABASE_URL set it creates every table below on its own (see
-- src/lib/db/postgres.ts). This file is here for when you would rather
-- set the database up once in the SQL editor and see it laid out.
-- Keep it in step with that migrate() function if you change one.
-- =====================================================================

drop table if exists activity  cascade;
drop table if exists scores    cascade;
drop table if exists conflicts cascade;
drop table if exists notes     cascade;
drop table if exists requests  cascade;
drop table if exists teams     cascade;
drop table if exists panels    cascade;

-- ---------------------------------------------------------------------
-- Judge panels (a group of 2-3 judges that interviews 8-10 teams)
-- ---------------------------------------------------------------------
create table panels (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  code          text not null unique,          -- login code the judges type
  division      text not null default 'Division 1',
  judges        text[] not null default '{}',  -- judge names, for display
  languages     text[] not null default '{}',  -- language ids this panel covers
  sort_order    int not null default 0,

  -- Optional booking grid. Leave slot_count = 0 to run walk-up queue only.
  slot_start_at timestamptz,                   -- first slot's start time
  slot_minutes  int not null default 12,
  slot_count    int not null default 0,

  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Teams. number is text so identifiers like "9882K" work.
-- ---------------------------------------------------------------------
create table teams (
  id         uuid primary key default gen_random_uuid(),
  number     text not null unique,
  name       text not null,
  panel_id   uuid references panels(id) on delete set null,
  division   text not null default 'Division 1',
  category   text not null default 'developing',
  pit        text,                             -- pit / table location
  created_at timestamptz not null default now()
);

create index teams_panel_idx on teams (panel_id);

-- ---------------------------------------------------------------------
-- Requests — one row per interview, from booking through completion.
--   scheduled     slate   booked a future slot, not started
--   requested     ORANGE  team is asking for a judge now
--   acknowledged  BLUE    judges have seen it, heading over
--   interviewing  PURPLE  interview in progress
--   completed     GREEN   finished
--   cancelled     GREY    withdrawn / no-show
--
-- Stored as plain text, not an enum: the app owns the set of values and
-- a new status must never need a migration on event morning.
-- ---------------------------------------------------------------------
create table requests (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references teams(id) on delete cascade,
  panel_id        uuid references panels(id) on delete set null,
  status          text not null default 'requested',
  kind            text not null default 'queue',   -- 'queue' or 'slot'
  language        text not null default 'en',

  slot_start      timestamptz,                     -- set when kind = 'slot'
  slot_end        timestamptz,

  message         text,                            -- optional note from the team
  created_by      text,                            -- 'team', 'queuer:Name', 'admin'
  acknowledged_by text,
  interviewer     text,
  outcome         text,                            -- free text set on completion

  requested_at    timestamptz not null default now(),
  acknowledged_at timestamptz,
  started_at      timestamptz,
  finished_at     timestamptz,
  cancelled_at    timestamptz,
  updated_at      timestamptz not null default now()
);

create index requests_status_idx on requests (status);
create index requests_panel_idx  on requests (panel_id);
create index requests_team_idx   on requests (team_id);

-- A team can only be live in the queue once at a time. This is what stops
-- double-tapping "request a judge" from filling the board with duplicates.
create unique index requests_one_live_per_team
  on requests (team_id)
  where status in ('requested', 'acknowledged', 'interviewing');

-- Two teams can never hold the same slot on the same panel.
create unique index requests_unique_slot
  on requests (panel_id, slot_start)
  where kind = 'slot' and status <> 'cancelled';

-- ---------------------------------------------------------------------
-- Judge notes — private. Never returned to team or queuer endpoints.
-- ---------------------------------------------------------------------
create table notes (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references teams(id) on delete cascade,
  request_id uuid references requests(id) on delete set null,
  panel_id   uuid references panels(id) on delete set null,
  author     text not null,
  body       text not null,
  created_at timestamptz not null default now()
);

create index notes_team_idx on notes (team_id);

-- ---------------------------------------------------------------------
-- Conflicts of interest — a panel that must stay away from a team.
-- ---------------------------------------------------------------------
create table conflicts (
  id          uuid primary key default gen_random_uuid(),
  panel_id    uuid not null references panels(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  judge_name  text,
  note        text,
  declared_by text not null,
  created_at  timestamptz not null default now(),
  unique (panel_id, team_id)
);

create index conflicts_panel_idx on conflicts (panel_id);
create index conflicts_team_idx  on conflicts (team_id);

-- ---------------------------------------------------------------------
-- Scores — one row per (team, rubric). values holds each criterion.
-- ---------------------------------------------------------------------
create table scores (
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

create index scores_team_idx on scores (team_id);

-- ---------------------------------------------------------------------
-- Activity log — who changed what, for untangling event-day confusion
-- ---------------------------------------------------------------------
create table activity (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid references requests(id) on delete cascade,
  team_id    uuid references teams(id) on delete set null,
  actor      text not null,
  action     text not null,
  detail     text,
  created_at timestamptz not null default now()
);

create index activity_created_idx on activity (created_at desc);

-- ---------------------------------------------------------------------
-- Keep requests.updated_at honest even for hand-edits in the SQL editor.
-- The app also sets it explicitly; this is the backstop.
-- ---------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists requests_touch on requests;
create trigger requests_touch
  before update on requests
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- Lock the tables down.
--
-- The app talks to Postgres only from the server, over the connection
-- string, which bypasses RLS. Enabling RLS with zero policies means the
-- public anon / publishable key can read and write nothing — even if it
-- leaks.
-- ---------------------------------------------------------------------
alter table panels    enable row level security;
alter table teams     enable row level security;
alter table requests  enable row level security;
alter table notes     enable row level security;
alter table conflicts enable row level security;
alter table scores    enable row level security;
alter table activity  enable row level security;
