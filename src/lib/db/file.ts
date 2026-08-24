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
import type { ActivityRow, Note, Panel, RequestRow, ScoreRow, Team } from "../types";
import type { Status } from "../status";
import { compareTeamNumbers, normalizeTeamNumber } from "../teamNumber";
import { normalizePanelCode, randomPanelCode } from "../panelCode";
import { DEFAULT_DIVISION, defaultCategory, presetPanels } from "../presets";
import {
  StoreError,
  type ImportedTeam,
  type NewActivity,
  type NewNote,
  type NewRequest,
  type SaveScore,
  type Store,
} from "./types";

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
  scores: ScoreRow[];
  activity: ActivityRow[];
};

const FILE = resolve(process.env.DATA_FILE ?? ".data/state.json");
const LIVE: Status[] = ["requested", "acknowledged", "interviewing"];

/* ------------------------------------------------------------------ *
 * Loading and saving
 * ------------------------------------------------------------------ */

let loaded: Data | null = null;
let pendingWrite: ReturnType<typeof setTimeout> | null = null;

/**
 * The in-memory copy, loaded on first use rather than at import.
 *
 * That laziness matters on a serverless host: index.ts imports both
 * backends so it can pick one, and a read-only filesystem would make an
 * eager load throw on every cold start even when Postgres is the backend
 * actually in use.
 */
function state(): Data {
  if (!loaded) {
    loaded = load();
    claimLock();
    installShutdownFlush();
  }
  return loaded;
}

function empty(): Data {
  return { panels: [], teams: [], requests: [], notes: [], scores: [], activity: [] };
}

function load(): Data {
  if (!existsSync(FILE)) {
    // Demo teams are a convenience for a fresh checkout, never something
    // a real deployment should invent for itself. Production starts empty
    // unless you deliberately ask for the demo roster.
    const wantsDemo =
      process.env.SEED_DEMO === "true" ||
      (process.env.SEED_DEMO !== "false" && process.env.NODE_ENV !== "production");
    const seeded = wantsDemo ? demoData() : empty();
    try {
      persist(seeded);
    } catch (e) {
      console.error(
        `[store] cannot write ${FILE}: ${(e as Error).message}\n` +
          "        Data will be kept in memory only and lost on restart.",
      );
    }
    return seeded;
  }
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as Partial<Data>;
    return migrate({ ...empty(), ...parsed });
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

/**
 * Bring an older state file up to date.
 *
 * Team numbers used to be stored as JSON numbers, before identifiers
 * like "9882K" needed to work. Reading one of those files must not lose
 * the roster, so coerce on the way in.
 */
function migrate(data: Data): Data {
  data.scores ??= [];
  const fallback = data.panels[0]?.division ?? DEFAULT_DIVISION;

  for (const team of data.teams) {
    if (typeof team.number !== "string") team.number = normalizeTeamNumber(team.number);
    // Divisions, then categories, arrived after the first rosters did.
    if (!team.division) team.division = fallback;
    if (!team.category) team.category = defaultCategory();
  }
  for (const panel of data.panels) {
    if (!panel.division) panel.division = fallback;
  }
  return data;
}

/** Atomic: write a temp file, then rename over the real one. */
function persist(snapshot: Data = state()): void {
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
function installShutdownFlush(): void {
  // SIGHUP is what closing a terminal window sends, and SIGBREAK is its
  // Windows equivalent. Without them, shutting down by closing the window
  // rather than pressing Ctrl+C would skip the flush below and leave the
  // lock file behind.
  for (const signal of ["exit", "SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
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
            `        and they WILL overwrite each other's state().\n\n` +
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


/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

function listPanels(): Panel[] {
  return [...state().panels].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );
}

function listTeams(): Team[] {
  return [...state().teams].sort((a, b) => compareTeamNumbers(a.number, b.number));
}

function listRequests(): RequestRow[] {
  return [...state().requests].sort((a, b) => b.requested_at.localeCompare(a.requested_at));
}

function listNotes(teamId?: string): Note[] {
  return state().notes
    .filter((n) => !teamId || n.team_id === teamId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 400);
}

function listActivity(limit = 150): ActivityRow[] {
  return [...state().activity]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

function findPanelByCode(code: string): Panel | null {
  const wanted = code.trim().toUpperCase();
  return state().panels.find((p) => p.code.toUpperCase() === wanted) ?? null;
}

function findTeamByNumber(number: string): Team | null {
  const wanted = normalizeTeamNumber(number);
  return state().teams.find((t) => t.number === wanted) ?? null;
}

function findRequest(id: string): RequestRow | null {
  return state().requests.find((r) => r.id === id) ?? null;
}

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

function createRequest(input: NewRequest): RequestRow {
  const now = new Date().toISOString();

  // Invariant 1: a team can only be live in the queue once.
  if (state().requests.some((r) => r.team_id === input.teamId && LIVE.includes(r.status))) {
    const team = state().teams.find((t) => t.id === input.teamId);
    throw new StoreError(`Team ${team?.number ?? ""} is already in the queue.`.trim(), 409);
  }

  // Invariant 2: one team per panel slot.
  if (input.kind === "slot") {
    const clash = state().requests.some(
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

  state().requests.push(row);
  save();
  return row;
}

function updateRequest(id: string, patch: Partial<RequestRow>): RequestRow {
  const row = state().requests.find((r) => r.id === id);
  if (!row) throw new StoreError("That request no longer exists.", 404);

  // Re-opening must not create a second live request for the same team.
  if (patch.status && LIVE.includes(patch.status) && !LIVE.includes(row.status)) {
    const other = state().requests.some(
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

function upsertTeams(rows: ImportedTeam[]): number {
  const now = new Date().toISOString();
  for (const row of rows) {
    const existing = state().teams.find((t) => t.number === row.number);
    if (existing) {
      existing.name = row.name;
      existing.pit = row.pit;
      if (row.category) existing.category = row.category;
      // A team that changes division loses its panel: the old one is on
      // the far side of the wall.
      if (row.division && row.division !== existing.division) {
        existing.division = row.division;
        existing.panel_id = null;
      }
    } else {
      state().teams.push({
        id: randomUUID(),
        number: row.number,
        name: row.name,
        panel_id: null,
        division: row.division,
        category: row.category,
        pit: row.pit,
        created_at: now,
      });
    }
  }
  save();
  return rows.length;
}

function updateTeam(id: string, patch: Partial<Team>): Team {
  const team = state().teams.find((t) => t.id === id);
  if (!team) throw new StoreError("That team no longer exists.", 404);
  Object.assign(team, patch);
  save();
  return team;
}

function deleteTeam(id: string): void {
  state().teams = state().teams.filter((t) => t.id !== id);
  state().requests = state().requests.filter((r) => r.team_id !== id);
  state().notes = state().notes.filter((n) => n.team_id !== id);
  state().scores = state().scores.filter((s) => s.team_id !== id);
  save();
}

/**
 * Deal teams round-robin into panels, filling the emptiest panel first
 * and never exceeding perPanel. Existing assignments are counted so a
 * mid-event top-up stays balanced.
 */
function autoAssignTeams(perPanel: number, includeAssigned = false, division?: string): number {
  const panels = listPanels().filter((p) => !division || p.division === division);
  if (!panels.length) {
    throw new StoreError(
      division
        ? `No judge panels in ${division} yet. Add one first.`
        : "Add at least one judge panel first.",
      400,
    );
  }

  const pending = listTeams().filter(
    (t) => (includeAssigned || !t.panel_id) && (!division || t.division === division),
  );
  if (!pending.length) return 0;

  const load = new Map<string, number>(panels.map((p) => [p.id, 0]));
  if (!includeAssigned) {
    for (const t of state().teams) {
      if (t.panel_id && load.has(t.panel_id)) load.set(t.panel_id, load.get(t.panel_id)! + 1);
    }
  }

  let assigned = 0;
  for (const team of pending) {
    // The hard wall: only panels in this team's own division are eligible.
    const eligible = panels.filter((p) => p.division === team.division);
    const target = eligible
      .map((p) => ({ id: p.id, count: load.get(p.id) ?? 0 }))
      .filter((p) => p.count < perPanel)
      .sort((a, b) => a.count - b.count)[0];
    if (!target) continue; // no room left in this team's division

    load.set(target.id, target.count + 1);
    const row = state().teams.find((t) => t.id === team.id)!;
    row.panel_id = target.id;
    assigned++;
  }

  save();
  return assigned;
}

/* ------------------------------------------------------------------ *
 * Panels
 * ------------------------------------------------------------------ */

function createPanel(input: Omit<Panel, "id" | "created_at">): Panel {
  if (state().panels.some((p) => p.code.toUpperCase() === normalizePanelCode(input.code))) {
    throw new StoreError("That panel code is already in use.", 409);
  }
  const panel: Panel = { ...input, id: randomUUID(), created_at: new Date().toISOString() };
  state().panels.push(panel);
  save();
  return panel;
}

function updatePanel(id: string, patch: Partial<Panel>): Panel {
  const panel = state().panels.find((p) => p.id === id);
  if (!panel) throw new StoreError("That panel no longer exists.", 404);

  // Moving a panel across the wall cannot drag its teams with it — those
  // teams belong to the division they compete in. They are released so
  // another panel in that division can pick them up.
  if (patch.division && patch.division !== panel.division) {
    for (const t of state().teams) if (t.panel_id === id) t.panel_id = null;
  }

  if (patch.code && state().panels.some((p) => p.id !== id && p.code.toUpperCase() === patch.code!.toUpperCase())) {
    throw new StoreError("That panel code is already in use.", 409);
  }

  Object.assign(panel, patch);
  save();
  return panel;
}

/** Deleting a panel orphans its teams and requests rather than losing them. */
function deletePanel(id: string): void {
  state().panels = state().panels.filter((p) => p.id !== id);
  for (const t of state().teams) if (t.panel_id === id) t.panel_id = null;
  for (const r of state().requests) if (r.panel_id === id) r.panel_id = null;
  save();
}

/** Create any preset panel whose code is not already taken. */
function seedPresetPanels(): number {
  let created = 0;
  for (const preset of presetPanels()) {
    if (state().panels.some((p) => p.code.toUpperCase() === preset.code)) continue;
    state().panels.push({
      id: randomUUID(),
      name: preset.name,
      code: preset.code,
      division: preset.division,
      judges: preset.judges,
      sort_order: state().panels.length + 1,
      slot_start_at: preset.slotStartAt,
      slot_minutes: preset.slotMinutes,
      slot_count: preset.slotCount,
      created_at: new Date().toISOString(),
    });
    created++;
  }
  if (created) save();
  return created;
}

/**
 * Clear the whole panel list.
 *
 * Teams and requests keep existing and fall back to no panel, exactly as
 * deleting one panel does — the roster is expensive to rebuild and is
 * never what someone means by "delete all panels".
 */
function deleteAllPanels(): number {
  const removed = state().panels.length;
  if (!removed) return 0;

  state().panels = [];
  for (const t of state().teams) t.panel_id = null;
  for (const r of state().requests) r.panel_id = null;
  save();
  return removed;
}

function generatePanelCode(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = randomPanelCode();
    if (!state().panels.some((p) => p.code === code)) return code;
  }
  return `P${Date.now().toString(36).toUpperCase()}`;
}

/* ------------------------------------------------------------------ *
 * Notes and activity
 * ------------------------------------------------------------------ */

function createNote(input: NewNote): Note {
  const note: Note = {
    id: randomUUID(),
    team_id: input.teamId,
    request_id: input.requestId,
    panel_id: input.panelId,
    author: input.author,
    body: input.body,
    created_at: new Date().toISOString(),
  };
  state().notes.push(note);
  save();
  return note;
}

function listScores(teamId?: string): ScoreRow[] {
  return state().scores.filter((s) => !teamId || s.team_id === teamId);
}

/**
 * Record one criterion.
 *
 * Scores accumulate criterion by criterion as the judges work down the
 * sheet, so this merges rather than replaces — two judges filling in
 * different rows of the same rubric must not overwrite each other.
 */
function saveScore(input: SaveScore): ScoreRow {
  let row = state().scores.find(
    (s) => s.team_id === input.teamId && s.rubric_id === input.rubricId,
  );

  if (!row) {
    row = {
      id: randomUUID(),
      team_id: input.teamId,
      rubric_id: input.rubricId,
      values: {},
      total: 0,
      scored_by: input.scoredBy,
      panel_id: input.panelId,
      updated_at: new Date().toISOString(),
    };
    state().scores.push(row);
  }

  if (input.value === null) delete row.values[input.criterionId];
  else row.values[input.criterionId] = input.value;

  row.total = input.totalOf(row.values);
  row.scored_by = input.scoredBy;
  row.panel_id = input.panelId ?? row.panel_id;
  row.updated_at = new Date().toISOString();

  save();
  return row;
}

function logActivity(entry: NewActivity): void {
  state().activity.push({
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
  if (state().activity.length > 2000) state().activity = state().activity.slice(-1500);
  save();
}

/* ------------------------------------------------------------------ *
 * Whole-store operations
 * ------------------------------------------------------------------ */

/** Clears requests, notes and the log. Teams and panels survive. */
function resetDay(): void {
  state().requests = [];
  state().notes = [];
  state().scores = [];
  state().activity = [];
  save();
}

/** Wipes everything, including the roster and panels. */
function resetAll(): void {
  loaded = empty();
  save();
}



/* ------------------------------------------------------------------ *
 * Demo data, so a fresh checkout is clickable straight away
 * ------------------------------------------------------------------ */

function demoData(): Data {
  const now = Date.now();
  const iso = (offsetMinutes: number) => new Date(now + offsetMinutes * 60_000).toISOString();

  // Two divisions, so the demo exercises the wall rather than hiding it.
  const panelNames: [string, string, string, string[]][] = [
    ["Panel A", "ALPHA1", "Division 1", ["Dana Ruiz", "Sam Okafor", "Priya Nair"]],
    ["Panel B", "BRAVO2", "Division 1", ["Chris Lin", "Morgan Bell"]],
    ["Panel C", "CHARLIE3", "Division 2", ["Alex Tran", "Jamie Fox", "Rae Mensah"]],
  ];

  const panels: Panel[] = panelNames.map(([name, code, division, judges], i) => ({
    id: randomUUID(),
    name,
    code,
    division,
    judges,
    sort_order: i + 1,
    // Every demo panel runs slots, so "Book a time" has something to show
    // straight away. Panel C keeps a shorter grid to look less uniform.
    slot_start_at: iso(20),
    slot_minutes: 12,
    slot_count: i === 2 ? 5 : 8,
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

  // A couple of letter-suffixed numbers, so the demo exercises the case
  // that pure-numeric rosters would quietly hide.
  const suffixes = ["", "", "", "A", "", "", "B", "", "", "K"];

  const teams: Team[] = names.map((name, i) => ({
    id: randomUUID(),
    number: `${1101 + i * 7}${suffixes[i % suffixes.length]}`,
    name,
    panel_id: panels[i % panels.length].id,
    division: panels[i % panels.length].division,
    // Alternate the two kinds so the colour split is visible on first run.
    category: i % 3 === 0 ? "fully-developed" : "developing",
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

  return { panels, teams, requests, notes: [], scores: [], activity: [] };
}

/* ------------------------------------------------------------------ *
 * The Store facade
 *
 * The functions above are synchronous, which is what makes the two
 * invariants genuinely atomic here — Node runs one piece of JavaScript
 * at a time, so no await can interleave between a check and its write.
 * They are wrapped as async only to match the shared Store interface.
 * ------------------------------------------------------------------ */

export const fileStore: Store = {
  kind: "file",
  describe: () => `JSON file at ${FILE}`,

  listPanels: async () => listPanels(),
  listTeams: async () => listTeams(),
  listRequests: async () => listRequests(),
  listNotes: async (teamId) => listNotes(teamId),
  listActivity: async (limit) => listActivity(limit),

  findPanelByCode: async (code) => findPanelByCode(code),
  findTeamByNumber: async (number) => findTeamByNumber(number),
  findRequest: async (id) => findRequest(id),

  createRequest: async (input) => createRequest(input),
  updateRequest: async (id, patch) => updateRequest(id, patch),

  upsertTeams: async (rows) => upsertTeams(rows),
  updateTeam: async (id, patch) => updateTeam(id, patch),
  deleteTeam: async (id) => deleteTeam(id),
  autoAssignTeams: async (perPanel, includeAssigned, division) =>
    autoAssignTeams(perPanel, includeAssigned, division),

  createPanel: async (input) => createPanel(input),
  seedPresetPanels: async () => seedPresetPanels(),
  updatePanel: async (id, patch) => updatePanel(id, patch),
  deletePanel: async (id) => deletePanel(id),
  deleteAllPanels: async () => deleteAllPanels(),
  generatePanelCode: async () => generatePanelCode(),

  createNote: async (input) => createNote(input),

  listScores: async (teamId) => listScores(teamId),
  saveScore: async (input) => saveScore(input),
  logActivity: async (entry) => logActivity(entry),

  resetDay: async () => resetDay(),
  resetAll: async () => resetAll(),
};
