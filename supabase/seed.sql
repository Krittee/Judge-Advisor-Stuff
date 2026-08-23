-- =====================================================================
-- Demo data — 3 judge panels, 24 teams, a few requests mid-flight.
-- Run this AFTER schema.sql to click around before your real data lands.
-- Delete everything later with:  truncate panels, teams cascade;
-- =====================================================================

insert into panels (name, code, room, judges, sort_order, slot_minutes, slot_count, slot_start_at) values
  ('Panel A', 'ALPHA1',  'Room 101', '{"Dana Ruiz","Sam Okafor","Priya Nair"}', 1, 12, 8, now() + interval '30 minutes'),
  ('Panel B', 'BRAVO2',  'Room 102', '{"Chris Lin","Morgan Bell"}',            2, 12, 8, now() + interval '30 minutes'),
  ('Panel C', 'CHARLIE3','Room 103', '{"Alex Tran","Jamie Fox","Rae Mensah"}', 3, 12, 0, null);

insert into teams (number, name, panel_id, pit)
select
  n,
  (array['Iron Hawks','Circuit Breakers','Gear Grinders','Quantum Quokkas','Bolt Runners','Neon Newtons',
         'Torque Titans','Silver Sprockets','Delta Drivers','Pixel Pioneers','Vector Vipers','Cosmic Cogs',
         'Redline Robotics','Apex Anchors','Lunar Lynx','Fusion Foxes','Byte Brigade','Copper Comets',
         'Hydra Hackers','Nova Nomads','Orbit Otters','Prism Panthers','Rogue Ravens','Solar Storks'])[
    ((n - 1101) / 7) + 1
  ],
  (select id from panels where sort_order = (((n - 1101) / 7) % 3) + 1),
  'Pit ' || (((n - 1101) / 7) + 1)
from generate_series(1101, 1262, 7) as n;

-- One team in each colour so you can see the board light up.
insert into requests (team_id, panel_id, status, kind, created_by, requested_at)
select id, panel_id, 'requested', 'queue', 'team', now() - interval '4 minutes'
from teams where number = 1101;

insert into requests (team_id, panel_id, status, kind, created_by, acknowledged_by, requested_at, acknowledged_at)
select id, panel_id, 'acknowledged', 'queue', 'team', 'Dana Ruiz', now() - interval '9 minutes', now() - interval '2 minutes'
from teams where number = 1129;

insert into requests (team_id, panel_id, status, kind, created_by, interviewer, requested_at, acknowledged_at, started_at)
select id, panel_id, 'interviewing', 'queue', 'queuer:Front Desk', 'Chris Lin', now() - interval '18 minutes', now() - interval '12 minutes', now() - interval '6 minutes'
from teams where number = 1108;

insert into requests (team_id, panel_id, status, kind, created_by, interviewer, requested_at, acknowledged_at, started_at, finished_at)
select id, panel_id, 'completed', 'queue', 'team', 'Alex Tran', now() - interval '50 minutes', now() - interval '45 minutes', now() - interval '40 minutes', now() - interval '28 minutes'
from teams where number = 1115;
