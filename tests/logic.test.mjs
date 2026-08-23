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

function parseTeams(text) {
  const seen = new Map();
  let skipped = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cells = splitRow(line);
    const number = Number(cells[0]);
    if (!Number.isInteger(number) || number <= 0) {
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
  const teams = [{ id: "t1", number: 1234 }];
  const booked = buildSlots(
    PANEL,
    [{ kind: "slot", panel_id: "p1", slot_start: "2026-09-01T14:12:00.000Z", status: "scheduled", team_id: "t1" }],
    teams,
  );
  assert.equal(booked[1].takenBy.teamNumber, 1234);
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
    [{ id: "t1", number: 9 }],
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
  assert.equal(byNumber[1234].name, "Iron Hawks Renamed", "last duplicate wins");
  assert.equal(byNumber[1234].pit, "Pit 99");
  assert.equal(byNumber[1235].name, "Circuit, Breakers", "a quoted comma stays inside the name");
  assert.equal(byNumber[1236].name, "Gear Grinders", "tab separated works");
  assert.equal(byNumber[1236].pit, "Pit 3");
  assert.equal(byNumber[1237].name, "Team 1237", "missing name gets a fallback");
  assert.equal(byNumber[1237].pit, null);
});

test("import rejects negative and non-integer team numbers", () => {
  const { teams, skipped } = parseTeams("-5, Bad\n1.5, Also bad\n0, Zero\n42, Fine");
  assert.equal(teams.length, 1);
  assert.equal(teams[0].number, 42);
  assert.equal(skipped, 3);
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
  assert.equal(byNumber[10].name, "Robotics, Inc.");
  assert.equal(byNumber[10].pit, "Pit 1");
  assert.equal(byNumber[11].name, 'The "Bots"');
  assert.equal(byNumber[12].name, "Heavy, Metal", "tabs split first, so commas are safe");
});
