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
import type {
  ActivityRow,
  ConflictRow,
  FlagRow,
  JudgeRow,
  NominationRow,
  Note,
  Panel,
  RefereeSetup,
  RequestRow,
  ScoreRow,
  Team,
  WinnerRow,
} from "../types";
import type { Status } from "../status";
import { readActivity, type StoredActivity } from "../activity";
import { compareTeamNumbers, normalizeTeamNumber } from "../teamNumber";
import { normalizePanelCode, randomPanelCode } from "../panelCode";
import { divisionsCompatible } from "../presets";
import { hasNearbyBooking } from "../data";
import { isPanelBlocked, judgeKey, panelBlocks } from "../roster";
import {
  bookingDefaults,
  DEFAULT_DIVISION,
  defaultCategory,
  defaultLanguage,
  presetDivisions,
  presetPanels,
} from "../presets";
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
  type NewNomination,
  type NewWinner,
  type NominationKey,
  type FlagEdit,
  type NewRefereeSetup,
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

/** A panel as kept on disk: its judges are the roster's, not a list of its own. */
type StoredPanel = Omit<Panel, "judges">;

type Data = {
  panels: StoredPanel[];
  teams: Team[];
  requests: RequestRow[];
  notes: Note[];
  scores: ScoreRow[];
  /** Judges' award nominations, oldest first. */
  nominations: NominationRow[];
  /** The Judge Advisor's pick per (award, division). */
  winners: WinnerRow[];
  conflicts: ConflictRow[];
  /** The judge roster, in the order judges were added. */
  judges: JudgeRow[];
  flags: FlagRow[];
  /** The event's program and field count; null until one is saved. */
  refereeSetup: RefereeSetup | null;
  activity: StoredActivity[];
};

const FILE = resolve(process.env.DATA_FILE ?? ".data/state.json");
/** A team may only hold one of these at a time -- see the two invariant
 *  checks below. 'scheduled' belongs here too: without it, a team could
 *  hold any number of future scheduled slots at once, since none of them
 *  ever counted as "already in the queue". Not the same list as
 *  status.ts's LIVE_STATUSES, which drives board urgency colouring and
 *  must not treat a calm future booking as something needing attention. */
const LIVE: Status[] = ["requested", "acknowledged", "interviewing", "scheduled"];

/* ------------------------------------------------------------------ *
 * Loading and saving
 * ------------------------------------------------------------------ */

/**
 * Everything one process knows about the data file: the in-memory copy, its
 * pending save, the lock's heartbeat, and whether the shutdown hooks are on.
 *
 * It lives on `globalThis`, not in this module, because `next dev` evaluates
 * the server modules again whenever it compiles a route for the first time.
 * Module-level state would then start a NEW copy that reloads the file while
 * the old copy's save timer is still pending: the new copy misses what the
 * old one had not written yet, and its next write erases it. Every evaluation
 * of this module shares the one entry for its file, so there is one copy, one
 * save timer, one heartbeat and one set of hooks. (A test that wants a cold
 * start drops `globalThis.__judgeQueueFileStore`.)
 */
type Shared = {
  loaded: Data | null;
  pendingWrite: ReturnType<typeof setTimeout> | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  hooksInstalled: boolean;
};

const globals = globalThis as { __judgeQueueFileStore?: Map<string, Shared> };
const registry = (globals.__judgeQueueFileStore ??= new Map<string, Shared>());
if (!registry.has(FILE)) {
  registry.set(FILE, { loaded: null, pendingWrite: null, heartbeat: null, hooksInstalled: false });
}
const shared = registry.get(FILE)!;

/**
 * The in-memory copy, loaded on first use rather than at import.
 *
 * That laziness matters on a serverless host: index.ts imports both
 * backends so it can pick one, and a read-only filesystem would make an
 * eager load throw on every cold start even when Postgres is the backend
 * actually in use.
 */
function state(): Data {
  if (!shared.loaded) {
    // Claim before reading. A second copy must be refused before it can
    // touch the file; if it is refused, `loaded` stays null, so the next
    // call asks again rather than quietly running without the lock.
    claimLock();
    shared.loaded = load();
    installShutdownFlush();
  }
  return shared.loaded;
}

function empty(): Data {
  return {
    panels: [],
    teams: [],
    requests: [],
    notes: [],
    scores: [],
    nominations: [],
    winners: [],
    conflicts: [],
    judges: [],
    flags: [],
    refereeSetup: null,
    activity: [],
  };
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
    const merged = { ...empty(), ...parsed };
    const before = JSON.stringify(merged);
    const data = migrate(merged);

    // A migration that moved something -- the roster's ids are minted here --
    // is saved now. Left in memory it would be redone with new ids by every
    // fresh copy of this module (each Next route compiles its own) or restart
    // before the first write, and an id the browser got from one copy would
    // be unknown to the next. Best-effort, and caught HERE: the catch below
    // reads any throw as a corrupt file and sets it aside.
    if (JSON.stringify(data) !== before) {
      try {
        persist(data);
      } catch (e) {
        console.error(
          `[store] cannot save the migrated ${FILE}: ${(e as Error).message}\n` +
            "        Carrying on in memory; the roster's ids will change on restart.",
        );
      }
    }
    return data;
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
  data.nominations ??= [];
  data.winners ??= [];
  data.conflicts ??= [];
  data.judges ??= [];
  data.flags ??= [];
  data.refereeSetup ??= null;
  // Activity entries gained a kind and the actor's role; an older one has
  // neither and is read as what it implies (see readActivity).
  for (const a of data.activity) {
    a.kind ??= null;
    a.actor_role ??= null;
  }
  // Match and field arrived after the first flags did; rule after that,
  // then the ruleset it belongs to. A flag with no ruleset is a VEX IQ one.
  for (const f of data.flags) {
    f.match_type ??= null;
    f.match_number ??= null;
    f.field ??= null;
    f.rule ??= null;
    f.ruleset ??= null;
    f.manual_version ??= null;
    f.match_affecting ??= false;
    // A dev data file from the build that briefly recorded an alliance.
    delete (f as { alliance?: unknown }).alliance;
  }

  // A conflict used to belong to a panel only; a judge's conflict has no panel.
  for (const c of data.conflicts) {
    c.panel_id ??= null;
    c.judge_id ??= null;
  }

  // Panels used to carry their judges as a list of names. The roster owns
  // them now: move each name over once (case-insensitively deduped, in the
  // panels' own order, as the Postgres migration does) and drop the list, so
  // nothing can read it afterwards and a judge removed later stays removed.
  const known = new Set(data.judges.map((j) => judgeKey(j.name)));
  const ordered = [...data.panels].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );
  for (const panel of ordered as (StoredPanel & { judges?: unknown })[]) {
    for (const raw of Array.isArray(panel.judges) ? panel.judges : []) {
      const name = String(raw).trim();
      if (!name || known.has(judgeKey(name))) continue;
      known.add(judgeKey(name));
      data.judges.push({
        id: randomUUID(),
        name,
        note: null,
        panel_id: panel.id,
        created_at: panel.created_at ?? new Date().toISOString(),
      });
    }
    delete panel.judges;
  }

  // Languages and panel language cover arrived after the first rosters.
  for (const r of data.requests) r.language ??= defaultLanguage();
  for (const p of data.panels) p.languages ??= [];
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
  if (shared.pendingWrite) return;
  shared.pendingWrite = setTimeout(() => {
    shared.pendingWrite = null;
    try {
      persist();
    } catch (e) {
      console.error("[store] could not write state file:", e);
    }
  }, 200);
  shared.pendingWrite.unref?.();
}

/** Flush before the process dies so the last few seconds are not lost. */
function installShutdownFlush(): void {
  if (shared.hooksInstalled) return;
  shared.hooksInstalled = true;
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
 * The lock heartbeats every 5s and is treated as stale after 15s, or at
 * once if its pid is no longer running, so a crashed process can never
 * block the next start. A live copy is REFUSED, not warned about: two
 * copies writing one snapshot silently erase each other's work (BUG-028),
 * and a clear error on startup is far better than that on event day.
 *
 * The lock is created with "wx" (exclusive), so two copies starting in the
 * same instant cannot both win. The same pid always gets through, which is
 * what a `next dev` hot reload looks like from here.
 * ------------------------------------------------------------------ */

const LOCK = `${FILE}.lock`;
const STALE_AFTER_MS = 15_000;

/** Write our pid and a fresh heartbeat. "wx" fails if the lock already exists. */
function writeLock(exclusive: boolean): void {
  mkdirSync(dirname(LOCK), { recursive: true });
  writeFileSync(LOCK, JSON.stringify({ pid: process.pid, heartbeat: Date.now() }), {
    encoding: "utf8",
    flag: exclusive ? "wx" : "w",
  });
}

function readLock(): { pid: number; heartbeat: number } | null {
  try {
    return JSON.parse(readFileSync(LOCK, "utf8")) as { pid: number; heartbeat: number };
  } catch {
    return null; // missing or unreadable: nothing to defer to
  }
}

/** Does this pid belong to a running process? Signal 0 sends nothing; EPERM means it exists under another user. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function claimLock(): void {
  for (;;) {
    try {
      writeLock(true);
      break;
    } catch (e) {
      // Anything but "already exists" is a read-only disk: carry on without a lock.
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return;
    }

    const held = readLock();
    if (
      held &&
      held.pid !== process.pid &&
      isRunning(held.pid) &&
      Date.now() - held.heartbeat < STALE_AFTER_MS
    ) {
      throw new Error(
        `Another copy of the app is already using ${FILE} (pid ${held.pid}). ` +
          "Stop it first, or point DATA_FILE somewhere else.",
      );
    }

    // Our own leftover (a hot reload in this process), or a crashed copy's.
    try {
      rmSync(LOCK, { force: true });
    } catch {
      return; // cannot remove it: carry on without a lock
    }
  }

  if (shared.heartbeat) return;
  shared.heartbeat = setInterval(() => {
    try {
      writeLock(false);
    } catch {
      /* read-only disk: carry on without a heartbeat */
    }
  }, 5_000);
  shared.heartbeat.unref?.();
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

/** The panel as the app sees it: its judges are the roster judges sitting on it. */
function withJudges(panel: StoredPanel): Panel {
  return {
    ...panel,
    judges: state().judges.filter((j) => j.panel_id === panel.id).map((j) => j.name),
  };
}

function listPanels(): Panel[] {
  return [...state().panels]
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map(withJudges);
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
  const numbers = new Map(state().teams.map((t) => [t.id, t.number]));
  return [...state().activity]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
    .map((a) => readActivity(a, (a.team_id && numbers.get(a.team_id)) || null));
}

function findPanelByCode(code: string): Panel | null {
  const wanted = code.trim().toUpperCase();
  const panel = state().panels.find((p) => p.code.toUpperCase() === wanted);
  return panel ? withJudges(panel) : null;
}

function findPanelById(id: string): Panel | null {
  const panel = state().panels.find((p) => p.id === id);
  return panel ? withJudges(panel) : null;
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

  // Invariant 1: a team can only hold one live request or scheduled
  // booking at a time.
  if (state().requests.some((r) => r.team_id === input.teamId && LIVE.includes(r.status))) {
    const team = state().teams.find((t) => t.id === input.teamId);
    throw new StoreError(
      `Team ${team?.number ?? ""} already has a live request or a scheduled booking.`.replace(
        "  ",
        " ",
      ),
      409,
    );
  }

  // Invariant 2: no two teams on the same panel within a judge's
  // walk-and-interview window of each other (see hasNearbyBooking).
  if (input.kind === "slot") {
    const clash = hasNearbyBooking(
      state().requests,
      input.panelId,
      new Date(input.slotStart!).getTime(),
    );
    if (clash) {
      throw new StoreError(
        "Someone already has a booking within 20 minutes of that time on this panel. Pick another one.",
        409,
      );
    }
  }

  const row: RequestRow = {
    id: randomUUID(),
    team_id: input.teamId,
    panel_id: input.panelId,
    status: input.kind === "slot" ? "scheduled" : "requested",
    kind: input.kind,
    language: input.language,
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

function updateRequest(
  id: string,
  patch: Partial<RequestRow>,
  ifStatus?: RequestRow["status"],
): RequestRow {
  const row = state().requests.find((r) => r.id === id);
  if (!row) throw new StoreError("That request no longer exists.", 404);

  // Compare-and-set. The caller read this row's status a moment ago and
  // decided what to do from it; if another screen has moved it since, the
  // decision is stale and must not be written over their change. Checked
  // here, in the same synchronous block as the write below, so nothing can
  // slip in between -- and before anything is touched, so a refusal leaves
  // the row exactly as it was.
  if (ifStatus && row.status !== ifStatus) throw new StoreError(STALE_STATUS_MESSAGE, 409);

  // Re-opening must not create a second live request for the same team.
  if (patch.status && LIVE.includes(patch.status) && !LIVE.includes(row.status)) {
    const other = state().requests.some(
      (r) => r.id !== id && r.team_id === row.team_id && LIVE.includes(r.status),
    );
    if (other) throw new StoreError("That team already has a live request.", 409);
  }

  // Reassigning a booked slot to another panel (or another time) is
  // still a booking — it must not land within another team's walking
  // window on the panel it moves to.
  // (Judged by the kind the row ends up as: "ready now" turns a booking
  // into a walk-up request, which holds no slot to check.)
  if (
    (patch.kind ?? row.kind) === "slot" &&
    row.status !== "cancelled" &&
    (patch.panel_id !== undefined || patch.slot_start !== undefined)
  ) {
    const panelId = patch.panel_id ?? row.panel_id;
    const slotStart = patch.slot_start ?? row.slot_start;
    if (
      panelId &&
      slotStart &&
      hasNearbyBooking(state().requests, panelId, new Date(slotStart).getTime(), id)
    ) {
      throw new StoreError(
        "Someone already has a booking within 20 minutes of that time on this panel.",
        409,
      );
    }
  }

  Object.assign(row, patch, { updated_at: new Date().toISOString() });
  save();
  return row;
}

function reassignRequest(
  id: string,
  fromPanelId: string | null,
  toPanelId: string,
  ifStatus: RequestRow["status"],
): RequestRow {
  const row = state().requests.find((r) => r.id === id);
  if (!row) throw new StoreError("That request no longer exists.", 404);
  if (row.status !== ifStatus || row.panel_id !== fromPanelId) {
    throw new StoreError(STALE_STATUS_MESSAGE, 409);
  }
  const team = state().teams.find((t) => t.id === row.team_id);
  if (!team) throw new StoreError("That team no longer exists.", 404);
  const updated = updateRequest(id, { panel_id: toPanelId }, ifStatus);
  team.panel_id = toPanelId;
  save();
  return updated;
}

/* ------------------------------------------------------------------ *
 * Teams
 * ------------------------------------------------------------------ */

function upsertTeams(rows: ImportedTeam[]): number {
  const now = new Date().toISOString();
  for (const row of rows) {
    const existing = state().teams.find((t) => t.number === row.number);
    if (existing) {
      // A blank cell leaves what is stored (see ImportedTeam).
      if (row.name) existing.name = row.name;
      if (row.pit) existing.pit = row.pit;
      if (row.category) existing.category = row.category;
      // A team that changes division loses its panel only when that panel
      // can't judge the new one (as PATCH /api/admin/teams does).
      if (row.division && row.division !== existing.division) {
        existing.division = row.division;
        const held = state().panels.find((p) => p.id === existing.panel_id);
        if (!held || !divisionsCompatible(row.division, held.division)) existing.panel_id = null;
      }
    } else {
      state().teams.push({
        id: randomUUID(),
        number: row.number,
        name: row.name || `Team ${row.number}`,
        panel_id: null,
        division: row.division || presetDivisions()[0],
        category: row.category || defaultCategory(),
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

  // Team numbers identify a team to everyone in the building, so two
  // teams cannot share one. Postgres has a unique index for this; the
  // file store has to check.
  if (patch.number && patch.number !== team.number) {
    const clash = state().teams.some((t) => t.id !== id && t.number === patch.number);
    if (clash) throw new StoreError(`Team ${patch.number} already exists.`, 409);
  }

  Object.assign(team, patch);
  save();
  return team;
}

function deleteTeam(id: string): void {
  // Postgres cascades activity rows whose request_id is one of the requests
  // about to go (activity.request_id is on delete cascade). Match that here,
  // or the log keeps rows pointing at requests that no longer exist (BUG-023).
  const goneRequests = new Set(state().requests.filter((r) => r.team_id === id).map((r) => r.id));
  state().activity = state().activity.filter((a) => !a.request_id || !goneRequests.has(a.request_id));
  state().teams = state().teams.filter((t) => t.id !== id);
  state().requests = state().requests.filter((r) => r.team_id !== id);
  state().notes = state().notes.filter((n) => n.team_id !== id);
  state().scores = state().scores.filter((s) => s.team_id !== id);
  // Nominations and winners cascade with the team in Postgres (on delete cascade).
  state().nominations = state().nominations.filter((n) => n.team_id !== id);
  state().winners = state().winners.filter((w) => w.team_id !== id);
  state().conflicts = state().conflicts.filter((c) => c.team_id !== id);
  // Postgres cascades flags on team delete and nulls activity.team_id
  // (on delete set null) rather than dropping the row. Match both here so
  // a deleted team never leaves an orphan flag behind on the file store.
  state().flags = state().flags.filter((f) => f.team_id !== id);
  for (const a of state().activity) {
    if (a.team_id === id) a.team_id = null;
  }
  save();
}

/**
 * Deal teams round-robin into panels, filling the emptiest panel first
 * and never exceeding perPanel. Existing assignments are counted so a
 * mid-event top-up stays balanced.
 */
function autoAssignTeams(perPanel: number, includeAssigned = false, division?: string): number {
  const panels = listPanels().filter(
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

  const pending = listTeams().filter(
    (t) =>
      (includeAssigned || !t.panel_id) &&
      (!division || divisionsCompatible(t.division, division)),
  );
  if (!pending.length) return 0;

  const load = new Map<string, number>(panels.map((p) => [p.id, 0]));
  if (!includeAssigned) {
    for (const t of state().teams) {
      if (t.panel_id && load.has(t.panel_id)) load.set(t.panel_id, load.get(t.panel_id)! + 1);
    }
  }

  // A panel that must stay away from a team is not a candidate for it.
  const blocks = panelBlocks(state().conflicts, state().judges);

  let assigned = 0;
  for (const team of pending) {
    // The hard wall: only panels this team's division may be judged by,
    // and never one with a declared conflict. A blended team clears the
    // wall against every panel (see divisionsCompatible) -- without that
    // it matches only a panel created in the blended division, and if the
    // event never made one it is skipped here and silently goes unjudged.
    const eligible = panels.filter(
      (p) => divisionsCompatible(team.division, p.division) && !isPanelBlocked(blocks, p.id, team.id),
    );
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
  const { judges, ...rest } = input;
  const panel: StoredPanel = { ...rest, id: randomUUID(), created_at: new Date().toISOString() };
  state().panels.push(panel);
  syncPanelJudges(panel.id, judges);
  save();
  return withJudges(panel);
}

/**
 * Make the roster say that exactly these names sit on this panel: each is
 * found (case-insensitively) or added, and put on the panel -- taking them
 * off whichever panel they were on -- and any other judge on it is taken
 * off. Nobody leaves the roster; their conflicts stay with them.
 */
function syncPanelJudges(panelId: string, names: string[], keepCodeFor?: string): void {
  const wanted = new Set<string>();
  const left = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name || wanted.has(judgeKey(name))) continue;
    wanted.add(judgeKey(name));
    const found = state().judges.find((j) => judgeKey(j.name) === judgeKey(name));
    if (found) {
      if (found.panel_id && found.panel_id !== panelId) left.add(found.panel_id);
      found.panel_id = panelId;
    }
    else {
      state().judges.push({
        id: randomUUID(),
        name,
        note: null,
        panel_id: panelId,
        created_at: new Date().toISOString(),
      });
    }
  }
  for (const j of state().judges) {
    if (j.panel_id === panelId && !wanted.has(judgeKey(j.name))) {
      left.add(panelId);
      j.panel_id = null;
    }
  }
  for (const id of left) if (id !== keepCodeFor) rotatePanelCode(id);
}

function rotatePanelCode(id: string): void {
  const panel = state().panels.find((p) => p.id === id);
  if (panel) panel.code = generatePanelCode();
}

function updatePanel(id: string, patch: Partial<Panel>): Panel {
  const panel = state().panels.find((p) => p.id === id);
  if (!panel) throw new StoreError("That panel no longer exists.", 404);

  if (patch.code && state().panels.some((p) => p.id !== id && p.code.toUpperCase() === patch.code!.toUpperCase())) {
    throw new StoreError("That panel code is already in use.", 409);
  }

  // Moving a panel across the wall cannot drag its teams with it — those
  // teams belong to the division they compete in. They are released so
  // another panel in that division can pick them up. Done only now, after
  // every validation above has passed: a rejected update — a duplicate
  // code, say — must never unassign a single team on its way to being
  // refused.
  if (patch.division && patch.division !== panel.division) {
    const moved = patch.division;
    const release = state().teams.filter((t) => t.panel_id === id && !divisionsCompatible(t.division, moved));
    const ids = new Set(release.map((t) => t.id));
    if (state().requests.some((r) => ids.has(r.team_id) && LIVE.includes(r.status))) {
      throw new StoreError("Reassign or cancel this panel's active requests before changing its division.", 409);
    }
    for (const team of release) team.panel_id = null;
  }

  const { judges, ...rest } = patch;
  const changingCode = Boolean(patch.code && patch.code.toUpperCase() !== panel.code.toUpperCase());
  Object.assign(panel, rest);
  if (judges) syncPanelJudges(id, judges, changingCode ? id : undefined);
  save();
  return withJudges(panel);
}

/** Deleting a panel orphans its teams and requests rather than losing them. */
function deletePanel(id: string): void {
  state().panels = state().panels.filter((p) => p.id !== id);
  for (const t of state().teams) if (t.panel_id === id) t.panel_id = null;
  for (const r of state().requests) if (r.panel_id === id) r.panel_id = null;
  // A nomination outlives its panel, as a score does (on delete set null).
  for (const n of state().nominations) if (n.panel_id === id) n.panel_id = null;
  // A whole-panel conflict names a panel that no longer exists; it protects
  // nobody. A judge's conflict stays: the judge just has no panel for now.
  state().conflicts = state().conflicts.filter((c) => c.panel_id !== id);
  for (const j of state().judges) if (j.panel_id === id) j.panel_id = null;
  save();
}

/** Create any preset panel whose code is not already taken. */
function seedPresetPanels(): number {
  let created = 0;
  for (const preset of presetPanels()) {
    if (state().panels.some((p) => p.code.toUpperCase() === preset.code)) continue;
    const id = randomUUID();
    state().panels.push({
      id,
      name: preset.name,
      code: preset.code,
      division: preset.division,
      languages: [],
      sort_order: state().panels.length + 1,
      slot_start_at: preset.slotStartAt,
      slot_minutes: preset.slotMinutes,
      slot_count: preset.slotCount,
      created_at: new Date().toISOString(),
    });
    syncPanelJudges(id, preset.judges);
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
  // Whole-panel conflicts went with their panels; judges' conflicts stay.
  state().conflicts = state().conflicts.filter((c) => c.panel_id === null);
  for (const j of state().judges) j.panel_id = null;
  for (const t of state().teams) t.panel_id = null;
  for (const r of state().requests) r.panel_id = null;
  for (const n of state().nominations) n.panel_id = null;
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

function listConflicts(): ConflictRow[] {
  return [...state().conflicts];
}

function addConflict(input: NewConflict): ConflictRow {
  const panelId = input.panelId || null;
  const judgeId = input.judgeId || null;
  if (!panelId === !judgeId) {
    throw new StoreError("A conflict belongs to a judge or to a panel, not both.", 400);
  }
  if (judgeId && !state().judges.some((j) => j.id === judgeId)) {
    throw new StoreError("That judge is no longer on the roster.", 404);
  }

  const existing = state().conflicts.find(
    (c) =>
      c.team_id === input.teamId &&
      (judgeId ? c.judge_id === judgeId : c.panel_id === panelId),
  );
  if (existing) return existing;

  const row: ConflictRow = {
    id: randomUUID(),
    panel_id: panelId,
    judge_id: judgeId,
    team_id: input.teamId,
    // A judge's conflict names the judge by id; the typed label is legacy only.
    judge_name: judgeId ? null : (input.judgeName ?? null),
    note: input.note,
    declared_by: input.declaredBy,
    created_at: new Date().toISOString(),
  };
  state().conflicts.push(row);
  save();
  return row;
}

function listJudges(): JudgeRow[] {
  return state().judges.map((j) => ({ ...j }));
}

/** Trimmed, non-empty, and not already on the roster under another spelling of the case. */
function cleanJudgeName(name: string, exceptId?: string): string {
  const clean = name.trim();
  if (!clean) throw new StoreError("A judge needs a name.", 400);
  if (state().judges.some((j) => j.id !== exceptId && judgeKey(j.name) === judgeKey(clean))) {
    throw new StoreError(`${clean} is already on the roster.`, 409);
  }
  return clean;
}

function addJudge(input: NewJudge): JudgeRow {
  const row: JudgeRow = {
    id: randomUUID(),
    name: cleanJudgeName(input.name),
    note: input.note ?? null,
    panel_id: null,
    created_at: new Date().toISOString(),
  };
  state().judges.push(row);
  save();
  return { ...row };
}

function updateJudge(id: string, patch: JudgePatch): JudgeRow {
  const judge = state().judges.find((j) => j.id === id);
  if (!judge) throw new StoreError("That judge is no longer on the roster.", 404);

  // Validate everything before touching the row, so a refusal changes nothing.
  const name = patch.name === undefined ? judge.name : cleanJudgeName(patch.name, id);
  if (patch.panel_id && !state().panels.some((p) => p.id === patch.panel_id)) {
    throw new StoreError("That panel no longer exists.", 404);
  }

  const oldPanelId = judge.panel_id;
  judge.name = name;
  if (patch.note !== undefined) judge.note = patch.note;
  if (patch.panel_id !== undefined) judge.panel_id = patch.panel_id;
  if (oldPanelId && judge.panel_id !== oldPanelId) rotatePanelCode(oldPanelId);
  save();
  return { ...judge };
}

/** A judge's conflicts leave with them: they would point at nobody. */
function removeJudge(id: string): boolean {
  const oldPanelId = state().judges.find((j) => j.id === id)?.panel_id;
  const before = state().judges.length;
  state().judges = state().judges.filter((j) => j.id !== id);
  const removed = state().judges.length < before;
  if (removed) {
    state().conflicts = state().conflicts.filter((c) => c.judge_id !== id);
    if (oldPanelId) rotatePanelCode(oldPanelId);
    save();
  }
  return removed;
}

function listFlags(teamId?: string): FlagRow[] {
  const rows = teamId ? state().flags.filter((f) => f.team_id === teamId) : state().flags;
  // Newest first: on a busy field the last thing seen matters most.
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function createFlag(input: NewFlag): FlagRow {
  const row: FlagRow = {
    id: randomUUID(),
    team_id: input.teamId,
    kind: input.kind,
    body: input.body,
    author: input.author,
    match_type: input.matchType,
    match_number: input.matchNumber,
    field: input.field,
    rule: input.rule,
    ruleset: input.ruleset,
    manual_version: input.manualVersion,
    match_affecting: input.matchAffecting,
    created_at: new Date().toISOString(),
  };
  state().flags.push(row);
  save();
  return row;
}

function updateFlag(id: string, edit: FlagEdit): FlagRow {
  const row = state().flags.find((f) => f.id === id);
  if (!row) throw new StoreError("That flag no longer exists.", 404);

  row.kind = edit.kind;
  row.body = edit.body;
  row.match_type = edit.matchType;
  row.match_number = edit.matchNumber;
  row.field = edit.field;
  row.rule = edit.rule;
  row.ruleset = edit.ruleset;
  row.manual_version = edit.manualVersion;
  row.match_affecting = edit.matchAffecting;
  save();
  return row;
}

function removeFlag(id: string): boolean {
  const before = state().flags.length;
  state().flags = state().flags.filter((f) => f.id !== id);
  save();
  return state().flags.length < before;
}

function getRefereeSetup(): RefereeSetup | null {
  return state().refereeSetup;
}

/** Replaces the record rather than editing it, so a caller holding the old
 *  one (to log what it was) still reads the old values afterwards. */
function saveRefereeSetup(input: NewRefereeSetup): RefereeSetup {
  const setup: RefereeSetup = {
    ruleset: input.ruleset,
    field_count: input.fieldCount,
    set_by: input.setBy,
    set_on: input.setOn,
    updated_at: new Date().toISOString(),
  };
  state().refereeSetup = setup;
  save();
  return setup;
}

function removeConflict(id: string): boolean {
  const before = state().conflicts.length;
  state().conflicts = state().conflicts.filter((c) => c.id !== id);
  const removed = state().conflicts.length < before;
  if (removed) save();
  return removed;
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

/**
 * Start this rubric over.
 *
 * The row is removed rather than zeroed: a team with no scores and a team
 * scored zero everywhere have to stay distinguishable, or the ranking
 * board would show a cleared team as genuinely bottom-placed.
 */
function clearScore(teamId: string, rubricId: string): boolean {
  const before = state().scores.length;
  state().scores = state().scores.filter(
    (s) => !(s.team_id === teamId && s.rubric_id === rubricId),
  );
  const removed = state().scores.length < before;
  if (removed) save();
  return removed;
}

/* ------------------------------------------------------------------ *
 * Awards: nominations and winners
 * ------------------------------------------------------------------ */

// Copies, not the stored rows: a caller holding one across a later write
// (the route comparing a reason before and after) must not see it change.
function listNominations(): NominationRow[] {
  return state().nominations.map((n) => ({ ...n }));
}

// The judge is compared as the roster compares a name, so "Dana" and " dana " are one judge.
const sameNomination = (n: NominationRow, k: NominationKey) =>
  n.award_id === k.awardId &&
  n.team_id === k.teamId &&
  n.panel_id === k.panelId &&
  judgeKey(n.judge) === judgeKey(k.judge);

/**
 * One row per judge per award per team, so asking twice is asking once. The
 * row keeps the spelling of the judge's name it was first made with.
 * Only a changed reason writes: a repeat tap must not look like an edit.
 */
function nominate(input: NewNomination): NominationRow {
  // Postgres refuses these through the foreign keys; so does this.
  if (!state().teams.some((t) => t.id === input.teamId)) throw new StoreError("That team no longer exists.", 404);
  if (!state().panels.some((p) => p.id === input.panelId)) throw new StoreError("That panel no longer exists.", 404);

  const now = new Date().toISOString();
  let row = state().nominations.find((n) => sameNomination(n, input));
  if (!row) {
    row = {
      id: randomUUID(),
      award_id: input.awardId,
      team_id: input.teamId,
      panel_id: input.panelId,
      judge: input.judge,
      reason: input.reason ?? null,
      created_at: now,
      updated_at: now,
    };
    state().nominations.push(row);
  } else if (input.reason !== undefined && input.reason !== row.reason) {
    row.reason = input.reason;
    row.updated_at = now;
  }

  save();
  return { ...row };
}

function withdrawNomination(key: NominationKey): boolean {
  const before = state().nominations.length;
  state().nominations = state().nominations.filter((n) => !sameNomination(n, key));
  const removed = state().nominations.length < before;
  if (removed) save();
  return removed;
}

function listWinners(): WinnerRow[] {
  return state().winners.map((w) => ({ ...w }));
}

/** Awards are decided per division, so (award, division) holds one team and a second replaces it. */
function setWinner(input: NewWinner): WinnerRow {
  if (!state().teams.some((t) => t.id === input.teamId)) throw new StoreError("That team no longer exists.", 404);

  const row: WinnerRow = {
    award_id: input.awardId,
    division: input.division,
    team_id: input.teamId,
    decided_by: input.decidedBy,
    decided_at: new Date().toISOString(),
  };
  const at = state().winners.findIndex((w) => w.award_id === row.award_id && w.division === row.division);
  if (at >= 0) state().winners[at] = row;
  else state().winners.push(row);

  save();
  return { ...row };
}

function clearWinner(awardId: string, division: string): boolean {
  const before = state().winners.length;
  state().winners = state().winners.filter((w) => !(w.award_id === awardId && w.division === division));
  const removed = state().winners.length < before;
  if (removed) save();
  return removed;
}

function logActivity(entry: NewActivity): void {
  state().activity.push({
    id: randomUUID(),
    request_id: entry.requestId ?? null,
    team_id: entry.teamId ?? null,
    kind: entry.kind,
    actor: entry.actor,
    actor_role: entry.actorRole,
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

/** Clears day-of workflow data. Teams, panels, event-wide referee flags and the referee setup survive. */
function resetDay(): void {
  state().requests = [];
  state().notes = [];
  state().scores = [];
  state().nominations = [];
  state().winners = [];
  state().activity = [];
  save();
}

/** Wipes the active event, including its roster, panels, referee flags and referee setup. */
function resetAll(): void {
  // Going through state() first claims the file, so a second copy cannot wipe it.
  state();
  shared.loaded = empty();
  save();
}



/* ------------------------------------------------------------------ *
 * Demo data, so a fresh checkout is clickable straight away
 * ------------------------------------------------------------------ */

function demoData(): Data {
  const now = Date.now();
  const iso = (offsetMinutes: number) => new Date(now + offsetMinutes * 60_000).toISOString();

  // Two divisions, so the demo exercises the wall rather than hiding it. They
  // are the first two the event config lists, so the demo runs on divisions the
  // event really has (BUG-030): a made-up name would sit in state beside them
  // and could hide an assignment error.
  const [first, second = first] = presetDivisions();
  const panelNames: [string, string, string, string[]][] = [
    ["Panel A", "ALPHA1", first, ["Dana Ruiz", "Sam Okafor", "Priya Nair"]],
    ["Panel B", "BRAVO2", first, ["Chris Lin", "Morgan Bell"]],
    ["Panel C", "CHARLIE3", second, ["Alex Tran", "Jamie Fox", "Rae Mensah"]],
  ];

  const panels: StoredPanel[] = panelNames.map(([name, code, division], i) => ({
    id: randomUUID(),
    name,
    code,
    division,
    // Demo: the third panel covers Thai as well, so a mismatch is visible.
    languages: i === 2 ? ["en", "th"] : ["en"],
    sort_order: i + 1,
    // Every demo panel runs slots, so "Book a time" has something to show
    // straight away. Panel C keeps a shorter grid to look less uniform.
    slot_start_at: iso(20),
    slot_minutes: bookingDefaults().slotMinutes,
    slot_count: i === 2 ? 5 : 8,
    created_at: iso(0),
  }));

  const judges: JudgeRow[] = panelNames.flatMap(([, , , names], i) =>
    names.map((name) => ({
      id: randomUUID(),
      name,
      note: null,
      panel_id: panels[i].id,
      created_at: iso(0),
    })),
  );

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

  // Deal teams to panels in blocks rather than round-robin, so each
  // division ends up on contiguous pit rows the way a real floor is laid
  // out — otherwise the plan on the board interleaves the two divisions
  // and tells you nothing about where anyone is standing.
  const perPanel = Math.ceil(names.length / panels.length);

  const teams: Team[] = names.map((name, i) => {
    const panel = panels[Math.min(panels.length - 1, Math.floor(i / perPanel))];
    // Pit codes are a letter and a number: the letter is the row, which
    // is what lets the board draw a floor plan nobody laid out by hand.
    const row = String.fromCharCode(65 + Math.floor(i / 6));

    return {
      id: randomUUID(),
      number: `${1101 + i * 7}${suffixes[i % suffixes.length]}`,
      name,
      panel_id: panel.id,
      division: panel.division,
      // Alternate the two kinds so the colour split shows on first run.
      category: i % 3 === 0 ? "fully-developed" : "developing",
      pit: `${row}${(i % 6) + 1}`,
      created_at: iso(0),
    };
  });

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
    language: "en",
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

  return {
    panels,
    teams,
    requests,
    notes: [],
    scores: [],
    nominations: [],
    winners: [],
    conflicts: [],
    judges,
    flags: [],
    refereeSetup: null,
    activity: [],
  };
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
  findPanelById: async (id) => findPanelById(id),
  findTeamByNumber: async (number) => findTeamByNumber(number),
  findRequest: async (id) => findRequest(id),

  createRequest: async (input) => createRequest(input),
  updateRequest: async (id, patch, ifStatus) => updateRequest(id, patch, ifStatus),
  reassignRequest: async (id, fromPanelId, toPanelId, ifStatus) =>
    reassignRequest(id, fromPanelId, toPanelId, ifStatus),

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

  listFlags: async (teamId) => listFlags(teamId),
  createFlag: async (input) => createFlag(input),
  updateFlag: async (id, edit) => updateFlag(id, edit),
  removeFlag: async (id) => removeFlag(id),

  getRefereeSetup: async () => getRefereeSetup(),
  saveRefereeSetup: async (input) => saveRefereeSetup(input),

  listJudges: async () => listJudges(),
  addJudge: async (input) => addJudge(input),
  updateJudge: async (id, patch) => updateJudge(id, patch),
  removeJudge: async (id) => removeJudge(id),

  listConflicts: async () => listConflicts(),
  addConflict: async (input) => addConflict(input),
  removeConflict: async (id) => removeConflict(id),

  listScores: async (teamId) => listScores(teamId),
  saveScore: async (input) => saveScore(input),
  clearScore: async (teamId, rubricId) => clearScore(teamId, rubricId),
  logActivity: async (entry) => logActivity(entry),

  listNominations: async () => listNominations(),
  nominate: async (input) => nominate(input),
  withdrawNomination: async (key) => withdrawNomination(key),
  listWinners: async () => listWinners(),
  setWinner: async (input) => setWinner(input),
  clearWinner: async (awardId, division) => clearWinner(awardId, division),

  resetDay: async () => resetDay(),
  resetAll: async () => resetAll(),
};
