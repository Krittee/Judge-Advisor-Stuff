import assert from "node:assert/strict";
import test from "node:test";

/* These mirror the implementations in src/lib and src/app/api. They are the
   bits with real edge cases — time maths, pasted spreadsheet junk, and
   picking which of a team's several requests the board should show. */

// ---- buildSlots (src/lib/data.ts) ----------------------------------
function buildSlots(panel, requests, teams) {
  if (!panel.slot_start_at || panel.slot_count <= 0) return [];
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const held = new Map();
  for (const r of requests) {
    if (r.kind !== "slot" || r.panel_id !== panel.id || !r.slot_start) continue;
    if (r.status === "cancelled") continue;
    held.set(new Date(r.slot_start).getTime(), r);
  }
  const startMs = new Date(panel.slot_start_at).getTime();
  const lengthMs = panel.slot_minutes * 60_000;
  return Array.from({ length: panel.slot_count }, (_, i) => {
    const start = new Date(startMs + i * lengthMs);
    const end = new Date(startMs + (i + 1) * lengthMs);
    const taken = held.get(start.getTime());
    const team = taken ? teamById.get(taken.team_id) : undefined;
    return {
      panelId: panel.id,
      start: start.toISOString(),
      end: end.toISOString(),
      takenBy: taken && team ? { teamId: team.id, teamNumber: team.number, status: taken.status } : null,
    };
  });
}

// ---- parseTeams (src/app/api/admin/teams/route.ts) ------------------
function clean(value) {
  return value.trim().replace(/^"(.*)"$/s, "$1").trim();
}

function splitRow(line) {
  if (line.includes("\t")) return line.split("\t").map(clean);
  const cells = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      cells.push(clean(field));
      field = "";
    } else {
      field += ch;
    }
  }
  cells.push(clean(field));
  return cells;
}

const VALID_NUMBER = /^[A-Z0-9][A-Z0-9-]*$/;
const normalize = (v) => String(v ?? "").replace(/\s+/g, "").toUpperCase().slice(0, 12);

function parseTeams(text) {
  const seen = new Map();
  let skipped = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cells = splitRow(line);
    const number = normalize(cells[0]);
    // A header row cannot be caught by failing to parse as a number any
    // more, so it is caught by requiring at least one digit.
    if (!number || !VALID_NUMBER.test(number) || !/\d/.test(number)) {
      skipped++;
      continue;
    }
    seen.set(number, { number, name: cells[1] || `Team ${number}`, pit: cells[2] || null });
  }
  return { teams: [...seen.values()], skipped };
}

// ---- rank (src/app/board/page.tsx) ----------------------------------
const rank = (s) =>
  ({ requested: 0, acknowledged: 1, interviewing: 2, scheduled: 3, completed: 4, cancelled: 5 })[s];

const PANEL = {
  id: "p1",
  slot_start_at: "2026-09-01T14:00:00.000Z",
  slot_minutes: 12,
  slot_count: 4,
};

test("slot grid is contiguous and correctly spaced", () => {
  const slots = buildSlots(PANEL, [], []);
  assert.equal(slots.length, 4);
  assert.equal(slots[0].start, "2026-09-01T14:00:00.000Z");
  assert.equal(slots[1].start, "2026-09-01T14:12:00.000Z");
  assert.equal(slots[3].end, "2026-09-01T14:48:00.000Z");
  for (let i = 1; i < slots.length; i++) {
    assert.equal(slots[i].start, slots[i - 1].end, "no gaps between slots");
  }
});

test("slots are off when count is zero or no start time is set", () => {
  assert.deepEqual(buildSlots({ ...PANEL, slot_count: 0 }, [], []), []);
  assert.deepEqual(buildSlots({ ...PANEL, slot_start_at: null }, [], []), []);
});

test("a booked slot shows its team; a cancelled booking frees the slot", () => {
  const teams = [{ id: "t1", number: "1234" }];
  const booked = buildSlots(
    PANEL,
    [{ kind: "slot", panel_id: "p1", slot_start: "2026-09-01T14:12:00.000Z", status: "scheduled", team_id: "t1" }],
    teams,
  );
  assert.equal(booked[1].takenBy.teamNumber, "1234");
  assert.equal(booked[0].takenBy, null);

  const cancelled = buildSlots(
    PANEL,
    [{ kind: "slot", panel_id: "p1", slot_start: "2026-09-01T14:12:00.000Z", status: "cancelled", team_id: "t1" }],
    teams,
  );
  assert.equal(cancelled[1].takenBy, null, "cancelling releases the slot");
});

test("another panel's bookings never appear on this panel's grid", () => {
  const slots = buildSlots(
    PANEL,
    [{ kind: "slot", panel_id: "OTHER", slot_start: "2026-09-01T14:00:00.000Z", status: "scheduled", team_id: "t1" }],
    [{ id: "t1", number: "9" }],
  );
  assert.equal(slots[0].takenBy, null);
});

test("roster import handles headers, tabs, quotes, blanks and duplicates", () => {
  const { teams, skipped } = parseTeams(
    [
      "Team Number, Team Name, Pit",
      "1234, Iron Hawks, Pit 12",
      "",
      '1235,"Circuit, Breakers"',
      "1236\tGear Grinders\tPit 3",
      "1237",
      "1234, Iron Hawks Renamed, Pit 99",
      "not a team",
    ].join("\n"),
  );

  assert.equal(skipped, 2, "header row and junk row are skipped");
  assert.equal(teams.length, 4, "1234 appears once");

  const byNumber = Object.fromEntries(teams.map((t) => [t.number, t]));
  assert.equal(byNumber["1234"].name, "Iron Hawks Renamed", "last duplicate wins");
  assert.equal(byNumber["1234"].pit, "Pit 99");
  assert.equal(byNumber["1235"].name, "Circuit, Breakers", "a quoted comma stays inside the name");
  assert.equal(byNumber["1236"].name, "Gear Grinders", "tab separated works");
  assert.equal(byNumber["1236"].pit, "Pit 3");
  assert.equal(byNumber["1237"].name, "Team 1237", "missing name gets a fallback");
  assert.equal(byNumber["1237"].pit, null);
});

test("import rejects malformed team numbers but keeps letter suffixes", () => {
  const { teams, skipped } = parseTeams(
    "-5, Bad\n1.5, Also bad\nTEAM, No digits\n42, Fine\n9882K, Also fine",
  );
  assert.deepEqual(
    teams.map((t) => t.number),
    ["42", "9882K"],
  );
  assert.equal(skipped, 3);
});

test("a lowercase letter suffix imports as the same team as uppercase", () => {
  const { teams } = parseTeams("9882k, Iron Hawks\n9882K, Iron Hawks Renamed");
  assert.equal(teams.length, 1, "9882k and 9882K are one team, not two");
  assert.equal(teams[0].number, "9882K");
  assert.equal(teams[0].name, "Iron Hawks Renamed");
});

test("board shows the most urgent request when a team has several", () => {
  const statuses = ["completed", "requested", "cancelled"];
  const winner = statuses.reduce((a, b) => (rank(b) < rank(a) ? b : a));
  assert.equal(winner, "requested", "orange outranks a finished earlier interview");

  assert.ok(rank("requested") < rank("acknowledged"));
  assert.ok(rank("acknowledged") < rank("interviewing"));
  assert.ok(rank("interviewing") < rank("scheduled"));
  assert.ok(rank("completed") < rank("cancelled"));
});

test("quoted fields survive commas, doubled quotes and tab rows", () => {
  const { teams } = parseTeams(
    [
      '10,"Robotics, Inc.",Pit 1',
      '11,"The ""Bots""",Pit 2',
      "12\tHeavy, Metal\tPit 3",
    ].join("\n"),
  );
  const byNumber = Object.fromEntries(teams.map((t) => [t.number, t]));
  assert.equal(byNumber["10"].name, "Robotics, Inc.");
  assert.equal(byNumber["10"].pit, "Pit 1");
  assert.equal(byNumber["11"].name, 'The "Bots"');
  assert.equal(byNumber["12"].name, "Heavy, Metal", "tabs split first, so commas are safe");
});

/* ---- booking conflicts -------------------------------------------
   The queue desk offers "interview now" and "book a time" side by side,
   so it has to be clear when one clashes with the other, or with a slot
   another team already holds. */

const LIVE_STATUSES = ["requested", "acknowledged", "interviewing"];

/** What the desk shows about a team before it lets you add them. */
function conflictFor(teamId, requests) {
  const live = requests.find((r) => r.team_id === teamId && LIVE_STATUSES.includes(r.status));
  if (live) return { kind: "already-queued", request: live };

  const booked = requests.find((r) => r.team_id === teamId && r.status === "scheduled");
  if (booked) return { kind: "already-booked", request: booked };

  return null;
}

test("a team already in the queue cannot be added again", () => {
  const requests = [{ team_id: "t1", status: "requested", kind: "queue" }];
  assert.equal(conflictFor("t1", requests).kind, "already-queued");
  assert.equal(conflictFor("t2", requests), null, "a different team is unaffected");
});

test("a booked team is flagged, but not as a duplicate", () => {
  const requests = [
    { team_id: "t1", status: "scheduled", kind: "slot", slot_start: "2026-09-01T14:00:00.000Z" },
  ];
  const conflict = conflictFor("t1", requests);
  assert.equal(conflict.kind, "already-booked", "a booking is a slot to release, not a duplicate");
  assert.equal(conflict.request.slot_start, "2026-09-01T14:00:00.000Z");
});

test("being in the queue outranks holding a later booking", () => {
  const requests = [
    { team_id: "t1", status: "scheduled", kind: "slot", slot_start: "2026-09-01T14:00:00.000Z" },
    { team_id: "t1", status: "interviewing", kind: "queue" },
  ];
  assert.equal(
    conflictFor("t1", requests).kind,
    "already-queued",
    "an interview happening now is the more urgent fact",
  );
});

test("releasing a booking frees the slot for another team", () => {
  const PANEL = { id: "p1", slot_start_at: "2026-09-01T14:00:00.000Z", slot_minutes: 12, slot_count: 3 };
  const teams = [
    { id: "t1", number: "1234" },
    { id: "t2", number: "5678" },
  ];
  const booking = {
    kind: "slot",
    panel_id: "p1",
    slot_start: "2026-09-01T14:00:00.000Z",
    status: "scheduled",
    team_id: "t1",
  };

  let slots = buildSlots(PANEL, [booking], teams);
  assert.equal(slots[0].takenBy.teamNumber, "1234", "shown as taken, not hidden");

  // The team turns up early: the booking is cancelled, then they queue.
  booking.status = "cancelled";
  slots = buildSlots(PANEL, [booking], teams);
  assert.equal(slots[0].takenBy, null, "the slot goes back into circulation");
});

test("a full schedule is distinguishable from a panel that runs no slots", () => {
  const PANEL = { id: "p1", slot_start_at: "2026-09-01T14:00:00.000Z", slot_minutes: 12, slot_count: 2 };
  const teams = [
    { id: "t1", number: "1" },
    { id: "t2", number: "2" },
  ];
  const full = buildSlots(
    PANEL,
    [
      { kind: "slot", panel_id: "p1", slot_start: "2026-09-01T14:00:00.000Z", status: "scheduled", team_id: "t1" },
      { kind: "slot", panel_id: "p1", slot_start: "2026-09-01T14:12:00.000Z", status: "scheduled", team_id: "t2" },
    ],
    teams,
  );

  assert.equal(full.length, 2, "a full panel still lists its slots");
  assert.ok(full.every((s) => s.takenBy), "every one shows who holds it");

  const noSlots = buildSlots({ ...PANEL, slot_count: 0 }, [], teams);
  assert.equal(noSlots.length, 0, "whereas a walk-up-only panel has none at all");
});
