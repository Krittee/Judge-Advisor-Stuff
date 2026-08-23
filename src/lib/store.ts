import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { ActivityRow, Note, Panel, RequestRow, Team } from "./types";
import type { Status } from "./status";

/**
 * The whole data layer: everything lives in memory and is mirrored to one
 * JSON file on disk.
 *
 * Two consequences worth knowing before you deploy this:
 *
 *   1. It needs ONE long-running Node process. On a serverless host each
 *      request may land on a different machine with its own empty disk,
 *      so the board would disagree with itself. Run `npm start` on a
 *      laptop, or use a host with a persistent disk.
 *   2. Because Node runs one piece of JavaScript at a time and every
 *      check-then-write below is synchronous, the invariants really are
 *      atomic. No two teams can take the same slot even if they tap at
 *      the same millisecond.
 *
 * Every function here is the seam where a real database would slot in
 * later: same names, same arguments, same return shapes.
 */

type Data = {
  panels: Panel[];
  teams: Team[];
  requests: RequestRow[];
  notes: Note[];
  activity: ActivityRow[];
};

const FILE = resolve(process.env.DATA_FILE ?? ".data/state.json");
const LIVE: Status[] = ["requested", "acknowledged", "interviewing"];

/** Thrown for rule violations we want to show the user verbatim. */
export class StoreError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ *
 * Loading and saving
 * ------------------------------------------------------------------ */

let data: Data = load();
let pendingWrite: ReturnType<typeof setTimeout> | null = null;

function empty(): Data {
  return { panels: [], teams: [], requests: [], notes: [], activity: [] };
}

function load(): Data {
  if (!existsSync(FILE)) {
    const seeded = process.env.SEED_DEMO === "false" ? empty() : demoData();
    persist(seeded);
    return seeded;
  }
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as Partial<Data>;
    return { ...empty(), ...parsed };
  } catch {
    // A corrupt file should not stop the event. Keep the bad copy for
    // forensics and carry on with a clean slate.
    //
    // Recover to EMPTY, not to demo data: a real event must never find
    // itself with two dozen invented teams. Persisting immediately is
    // what makes that stick — otherwise the missing file would look like
    // a first run on the next restart and re-seed the demo roster.
    try {
      renameSync(FILE, `${FILE}.corrupt-${Date.now()}`);
    } catch {
      /* nothing more we can do */
    }
    const fresh = empty();
    try {
      persist(fresh);
    } catch {
      /* disk is unhappy; carry on in memory */
    }
    return fresh;
  }
}

/** Atomic: write a temp file, then rename over the real one. */
function persist(snapshot: Data = data): void {
  mkdirSync(dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2), "utf8");
  renameSync(tmp, FILE);
}

/**
 * Batch a burst of writes into one disk hit. A whole pit queueing up at
 * once should not mean fifty separate file writes.
 */
function save(): void {
  if (pendingWrite) return;
  pendingWrite = setTimeout(() => {
    pendingWrite = null;
    try {
      persist();
    } catch (e) {
      console.error("[store] could not write state file:", e);
    }
  }, 200);
  pendingWrite.unref?.();
}

/** Flush before the process dies so the last few seconds are not lost. */
for (const signal of ["exit", "SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    try {
      persist();
    } catch {
      /* shutting down anyway */
    }
    releaseLock();
    if (signal !== "exit") process.exit(0);
  });
}

export function storageLocation(): string {
  return FILE;
}

/* ------------------------------------------------------------------ *
 * Second-instance guard
 *
 * `next dev` does not fail when port 3000 is busy — it quietly starts on
 * 3001 instead. Two servers then share one data file, each with its own
 * copy in memory, and whichever saves last silently erases the other's
 * work. That is a horrible way to lose an event.
 *
 * The lock heartbeats every 5s and is treated as stale after 15s, so a
 * crashed process can never block the next start. It warns rather than
 * refuses: an inexperienced operator on event day is far better served
 * by an app that runs than by one that will not.
 * ------------------------------------------------------------------ */

const LOCK = `${FILE}.lock`;
const STALE_AFTER_MS = 15_000;

function claimLock(): void {
  try {
    if (existsSync(LOCK)) {
      const held = JSON.parse(readFileSync(LOCK, "utf8")) as { pid: number; heartbeat: number };
      const age = Date.now() - held.heartbeat;
      if (held.pid !== process.pid && age < STALE_AFTER_MS) {
        console.warn(
          `\n${"!".repeat(72)}\n` +
            `[store] ANOTHER COPY OF THIS APP IS ALREADY RUNNING (process ${held.pid}).\n\n` +
            `        Both are using ${FILE}\n` +
            `        and they WILL overwrite each other's data.\n\n` +
            `        Stop this one with Ctrl+C and use the copy that is already\n` +
            `        running. If you meant to restart, stop the other one first.\n` +
            `${"!".repeat(72)}\n`,
        );
      }
    }
  } catch {
    // An unreadable lock is not worth failing over.
  }

  const beat = () => {
    try {
      mkdirSync(dirname(LOCK), { recursive: true });
      writeFileSync(LOCK, JSON.stringify({ pid: process.pid, heartbeat: Date.now() }), "utf8");
    } catch {
      /* read-only disk: carry on without a lock */
    }
  };

  beat();
  setInterval(beat, 5_000).unref?.();
}

function releaseLock(): void {
  try {
    const held = JSON.parse(readFileSync(LOCK, "utf8")) as { pid: number };
    if (held.pid === process.pid) rmSync(LOCK, { force: true });
  } catch {
    /* someone else owns it, or it is already gone */
  }
}

claimLock();

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export function listPanels(): Panel[] {
  return [...data.panels].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );
}

export function listTeams(): Team[] {
  return [...data.teams].sort((a, b) => a.number - b.number);
}

export function listRequests(): RequestRow[] {
  return [...data.requests].sort((a, b) => b.requested_at.localeCompare(a.requested_at));
}

export function listNotes(teamId?: string): Note[] {
  return data.notes
    .filter((n) => !teamId || n.team_id === teamId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 400);
}

export function listActivity(limit = 150): ActivityRow[] {
  return [...data.activity]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

export function findPanelByCode(code: string): Panel | null {
  const wanted = code.trim().toUpperCase();
  return data.panels.find((p) => p.code.toUpperCase() === wanted) ?? null;
}

export function findTeamByNumber(number: number): Team | null {
  return data.teams.find((t) => t.number === number) ?? null;
}

export function findRequest(id: string): RequestRow | null {
  return data.requests.find((r) => r.id === id) ?? null;
}

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

export function createRequest(input: {
  teamId: string;
  panelId: string;
  kind: "queue" | "slot";
  message?: string | null;
  createdBy: string;
  slotStart?: string | null;
  slotEnd?: string | null;
}): RequestRow {
  const now = new Date().toISOString();

  // Invariant 1: a team can only be live in the queue once.
  if (data.requests.some((r) => r.team_id === input.teamId && LIVE.includes(r.status))) {
    const team = data.teams.find((t) => t.id === input.teamId);
    throw new StoreError(`Team ${team?.number ?? ""} is already in the queue.`.trim(), 409);
  }

  // Invariant 2: one team per panel slot.
  if (input.kind === "slot") {
    const clash = data.requests.some(
      (r) =>
        r.kind === "slot" &&
        r.panel_id === input.panelId &&
        r.slot_start === input.slotStart &&
        r.status !== "cancelled",
    );
    if (clash) throw new StoreError("Someone just took that slot. Pick another one.", 409);
  }

  const row: RequestRow = {
    id: randomUUID(),
    team_id: input.teamId,
    panel_id: input.panelId,
    status: input.kind === "slot" ? "scheduled" : "requested",
    kind: input.kind,
    slot_start: input.slotStart ?? null,
    slot_end: input.slotEnd ?? null,
    message: input.message ?? null,
    created_by: input.createdBy,
    acknowledged_by: null,
    interviewer: null,
    outcome: null,
    requested_at: now,
    acknowledged_at: null,
    started_at: null,
    finished_at: null,
    cancelled_at: null,
    updated_at: now,
  };

  data.requests.push(row);
  save();
  return row;
}

export function updateRequest(id: string, patch: Partial<RequestRow>): RequestRow {
  const row = data.requests.find((r) => r.id === id);
  if (!row) throw new StoreError("That request no longer exists.", 404);

  // Re-opening must not create a second live request for the same team.
  if (patch.status && LIVE.includes(patch.status) && !LIVE.includes(row.status)) {
    const other = data.requests.some(
      (r) => r.id !== id && r.team_id === row.team_id && LIVE.includes(r.status),
    );
    if (other) throw new StoreError("That team already has a live request.", 409);
  }

  Object.assign(row, patch, { updated_at: new Date().toISOString() });
  save();
  return row;
}

/* ------------------------------------------------------------------ *
 * Teams
 * ------------------------------------------------------------------ */

export function upsertTeams(rows: { number: number; name: string; pit: string | null }[]): number {
  const now = new Date().toISOString();
  for (const row of rows) {
    const existing = data.teams.find((t) => t.number === row.number);
    if (existing) {
      existing.name = row.name;
      existing.pit = row.pit;
    } else {
      data.teams.push({
        id: randomUUID(),
        number: row.number,
        name: row.name,
        panel_id: null,
        pit: row.pit,
        created_at: now,
      });
    }
  }
  save();
  return rows.length;
}

export function updateTeam(id: string, patch: Partial<Team>): Team {
  const team = data.teams.find((t) => t.id === id);
  if (!team) throw new StoreError("That team no longer exists.", 404);
  Object.assign(team, patch);
  save();
  return team;
}

export function deleteTeam(id: string): void {
  data.teams = data.teams.filter((t) => t.id !== id);
  data.requests = data.requests.filter((r) => r.team_id !== id);
  data.notes = data.notes.filter((n) => n.team_id !== id);
  save();
}

/**
 * Deal teams round-robin into panels, filling the emptiest panel first
 * and never exceeding perPanel. Existing assignments are counted so a
 * mid-event top-up stays balanced.
 */
export function autoAssignTeams(perPanel: number, includeAssigned = false): number {
  const panels = listPanels();
  if (!panels.length) throw new StoreError("Add at least one judge panel first.", 400);

  const pending = listTeams().filter((t) => includeAssigned || !t.panel_id);
  if (!pending.length) return 0;

  const load = new Map<string, number>(panels.map((p) => [p.id, 0]));
  if (!includeAssigned) {
    for (const t of data.teams) {
      if (t.panel_id && load.has(t.panel_id)) load.set(t.panel_id, load.get(t.panel_id)! + 1);
    }
  }

  let assigned = 0;
  for (const team of pending) {
    const target = panels
      .map((p) => ({ id: p.id, count: load.get(p.id) ?? 0 }))
      .filter((p) => p.count < perPanel)
      .sort((a, b) => a.count - b.count)[0];
    if (!target) break; // every panel is full

    load.set(target.id, target.count + 1);
    const row = data.teams.find((t) => t.id === team.id)!;
    row.panel_id = target.id;
    assigned++;
  }

  save();
  return assigned;
}

/* ------------------------------------------------------------------ *
 * Panels
 * ------------------------------------------------------------------ */

export function createPanel(input: Omit<Panel, "id" | "created_at">): Panel {
  if (data.panels.some((p) => p.code.toUpperCase() === input.code.toUpperCase())) {
    throw new StoreError("That panel code is already in use.", 409);
  }
  const panel: Panel = { ...input, id: randomUUID(), created_at: new Date().toISOString() };
  data.panels.push(panel);
  save();
  return panel;
}

export function updatePanel(id: string, patch: Partial<Panel>): Panel {
  const panel = data.panels.find((p) => p.id === id);
  if (!panel) throw new StoreError("That panel no longer exists.", 404);

  if (patch.code && data.panels.some((p) => p.id !== id && p.code.toUpperCase() === patch.code!.toUpperCase())) {
    throw new StoreError("That panel code is already in use.", 409);
  }

  Object.assign(panel, patch);
  save();
  return panel;
}

/** Deleting a panel orphans its teams and requests rather than losing them. */
export function deletePanel(id: string): void {
  data.panels = data.panels.filter((p) => p.id !== id);
  for (const t of data.teams) if (t.panel_id === id) t.panel_id = null;
  for (const r of data.requests) if (r.panel_id === id) r.panel_id = null;
  save();
}

export function generatePanelCode(): string {
  // No 0/O/1/I — these get read aloud across a noisy room.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = Array.from(
      { length: 6 },
      () => alphabet[Math.floor(Math.random() * alphabet.length)],
    ).join("");
    if (!data.panels.some((p) => p.code === code)) return code;
  }
  return `P${Date.now().toString(36).toUpperCase()}`;
}

/* ------------------------------------------------------------------ *
 * Notes and activity
 * ------------------------------------------------------------------ */

export function createNote(input: {
  teamId: string;
  requestId: string | null;
  panelId: string | null;
  author: string;
  body: string;
}): Note {
  const note: Note = {
    id: randomUUID(),
    team_id: input.teamId,
    request_id: input.requestId,
    panel_id: input.panelId,
    author: input.author,
    body: input.body,
    created_at: new Date().toISOString(),
  };
  data.notes.push(note);
  save();
  return note;
}

export function logActivity(entry: {
  requestId?: string | null;
  teamId?: string | null;
  actor: string;
  action: string;
  detail?: string | null;
}): void {
  data.activity.push({
    id: randomUUID(),
    request_id: entry.requestId ?? null,
    team_id: entry.teamId ?? null,
    actor: entry.actor,
    action: entry.action,
    detail: entry.detail ?? null,
    created_at: new Date().toISOString(),
  });

  // The log is a convenience, not a record of account. Cap it so a long
  // event cannot grow the state file without bound.
  if (data.activity.length > 2000) data.activity = data.activity.slice(-1500);
  save();
}

/* ------------------------------------------------------------------ *
 * Whole-store operations
 * ------------------------------------------------------------------ */

/** Clears requests, notes and the log. Teams and panels survive. */
export function resetDay(): void {
  data.requests = [];
  data.notes = [];
  data.activity = [];
  save();
}

/** Wipes everything, including the roster and panels. */
export function resetAll(): void {
  data = empty();
  save();
}

export function exportAll(): Data {
  return structuredClone(data);
}

export function stats() {
  return {
    panels: data.panels.length,
    teams: data.teams.length,
    requests: data.requests.length,
    notes: data.notes.length,
    file: FILE,
  };
}

/* ------------------------------------------------------------------ *
 * Demo data, so a fresh checkout is clickable straight away
 * ------------------------------------------------------------------ */

function demoData(): Data {
  const now = Date.now();
  const iso = (offsetMinutes: number) => new Date(now + offsetMinutes * 60_000).toISOString();

  const panelNames: [string, string, string, string[]][] = [
    ["Panel A", "ALPHA1", "Room 101", ["Dana Ruiz", "Sam Okafor", "Priya Nair"]],
    ["Panel B", "BRAVO2", "Room 102", ["Chris Lin", "Morgan Bell"]],
    ["Panel C", "CHARLIE3", "Room 103", ["Alex Tran", "Jamie Fox", "Rae Mensah"]],
  ];

  const panels: Panel[] = panelNames.map(([name, code, room, judges], i) => ({
    id: randomUUID(),
    name,
    code,
    room,
    judges,
    sort_order: i + 1,
    slot_start_at: i < 2 ? iso(30) : null,
    slot_minutes: 12,
    slot_count: i < 2 ? 8 : 0,
    created_at: iso(0),
  }));

  const names = [
    "Iron Hawks", "Circuit Breakers", "Gear Grinders", "Quantum Quokkas",
    "Bolt Runners", "Neon Newtons", "Torque Titans", "Silver Sprockets",
    "Delta Drivers", "Pixel Pioneers", "Vector Vipers", "Cosmic Cogs",
    "Redline Robotics", "Apex Anchors", "Lunar Lynx", "Fusion Foxes",
    "Byte Brigade", "Copper Comets", "Hydra Hackers", "Nova Nomads",
    "Orbit Otters", "Prism Panthers", "Rogue Ravens", "Solar Storks",
  ];

  const teams: Team[] = names.map((name, i) => ({
    id: randomUUID(),
    number: 1101 + i * 7,
    name,
    panel_id: panels[i % panels.length].id,
    pit: `Pit ${i + 1}`,
    created_at: iso(0),
  }));

  const request = (
    team: Team,
    status: Status,
    times: Partial<Pick<RequestRow, "requested_at" | "acknowledged_at" | "started_at" | "finished_at">>,
    extra: Partial<RequestRow> = {},
  ): RequestRow => ({
    id: randomUUID(),
    team_id: team.id,
    panel_id: team.panel_id,
    status,
    kind: "queue",
    slot_start: null,
    slot_end: null,
    message: null,
    created_by: "team",
    acknowledged_by: null,
    interviewer: null,
    outcome: null,
    requested_at: iso(-5),
    acknowledged_at: null,
    started_at: null,
    finished_at: null,
    cancelled_at: null,
    updated_at: iso(0),
    ...times,
    ...extra,
  });

  // One team in each colour, so the board is worth looking at on first run.
  const requests: RequestRow[] = [
    request(teams[0], "requested", { requested_at: iso(-4) }),
    request(
      teams[4],
      "acknowledged",
      { requested_at: iso(-9), acknowledged_at: iso(-2) },
      { acknowledged_by: "Dana Ruiz" },
    ),
    request(
      teams[1],
      "interviewing",
      { requested_at: iso(-18), acknowledged_at: iso(-12), started_at: iso(-6) },
      { interviewer: "Chris Lin", created_by: "queuer:Front Desk" },
    ),
    request(
      teams[2],
      "completed",
      {
        requested_at: iso(-50),
        acknowledged_at: iso(-45),
        started_at: iso(-40),
        finished_at: iso(-28),
      },
      { interviewer: "Alex Tran" },
    ),
  ];

  return { panels, teams, requests, notes: [], activity: [] };
}
