import type {
  ActivityKind,
  ActivityRow,
  ConflictRow,
  FlagRow,
  JudgeRow,
  Note,
  NominationRow,
  Panel,
  RefereeSetup,
  RequestRow,
  ScoreRow,
  Team,
  WinnerRow,
} from "../types";

/** Thrown for rule violations we want to show the user verbatim. */
export class StoreError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** What a caller reads when a status-guarded write (`ifStatus`) lost the race. */
export const STALE_STATUS_MESSAGE =
  "This request changed on another screen — refresh and try again.";

export type NewRequest = {
  teamId: string;
  panelId: string;
  kind: "queue" | "slot";
  message?: string | null;
  createdBy: string;
  slotStart?: string | null;
  slotEnd?: string | null;
  language: string;
};

export type NewNote = {
  teamId: string;
  requestId: string | null;
  panelId: string | null;
  author: string;
  body: string;
};

export type SaveScore = {
  teamId: string;
  rubricId: string;
  criterionId: string;
  /** null clears the criterion back to unscored. */
  value: number | null;
  scoredBy: string;
  panelId: string | null;
  /** Recomputes the stored total from the merged values. */
  totalOf: (values: Record<string, number>) => number;
};

export type NewConflict = {
  /** Exactly one of panelId (a whole-panel, legacy conflict) and judgeId. */
  panelId?: string | null;
  judgeId?: string | null;
  teamId: string;
  /** Only read on a whole-panel conflict; a judge's conflict names the judge by id. */
  judgeName?: string | null;
  note: string | null;
  declaredBy: string;
};

export type NewJudge = { name: string; note?: string | null };

/** What may change on a roster judge. `panel_id: null` takes them off their panel. */
export type JudgePatch = Partial<Pick<JudgeRow, "name" | "note" | "panel_id">>;

export type NewFlag = {
  teamId: string;
  kind: string;
  body: string;
  author: string;
  /** Which match and field this happened at, so it can be traced back. */
  matchType: string;
  matchNumber: string;
  field: string;
  /** Rule ids from src/lib/rules.ts, comma-joined, or null when none was picked. */
  rule: string | null;
  /** Which ruleset those ids belong to. */
  ruleset: string | null;
  /** Taken from the ruleset by the server, never from the request. */
  manualVersion: string | null;
  matchAffecting: boolean;
};

/**
 * A correction to a flag already on record.
 *
 * Everything a referee can get wrong in a hurry -- the wrong severity
 * tapped, a mis-typed match number -- except which team and who wrote it.
 * Reassigning a flag to a different team, or to a different author, is a
 * bigger mistake than this is meant to fix; that goes through the Judge
 * Advisor deleting and refiling it instead.
 */
export type FlagEdit = {
  kind: string;
  body: string;
  matchType: string;
  matchNumber: string;
  field: string;
  /** Rule ids from src/lib/rules.ts, comma-joined, or null. */
  rule: string | null;
  ruleset: string | null;
  manualVersion: string | null;
  matchAffecting: boolean;
};

/** What a referee or the Judge Advisor saves; the store adds `updated_at`. */
export type NewRefereeSetup = {
  ruleset: string;
  fieldCount: number;
  setBy: string;
  /** YYYY-MM-DD, already validated. */
  setOn: string;
};

/**
 * A nomination always names the panel it is made from: the key is
 * (awardId, teamId, panelId, judge), and a panel's later deletion is what
 * leaves a stored row with none.
 */
export type NominationKey = {
  awardId: string;
  teamId: string;
  panelId: string;
  /** The judge's session name, like a note's author. */
  judge: string;
};

export type NewNomination = NominationKey & {
  /** Left out, an existing nomination keeps its reason; null clears it. A new one starts with none. */
  reason?: string | null;
};

/**
 * The Judge Advisor's nomination has no panel: the key is (awardId, teamId,
 * judge), where `judge` is the Judge Advisor's session name.
 */
export type AdminNominationKey = Omit<NominationKey, "panelId">;

export type NewAdminNomination = AdminNominationKey & { reason?: string | null };

export type NewWinner = {
  awardId: string;
  division: string;
  teamId: string;
  decidedBy: string;
};

export type NewActivity = {
  requestId?: string | null;
  teamId?: string | null;
  kind: ActivityKind;
  /** The plain name; see `actorParts`. */
  actor: string;
  actorRole: string | null;
  action: string;
  detail?: string | null;
};

/**
 * One line of an import. A blank cell is "not said", not "clear it": null (or left out) for `name`,
 * `pit`, `division` or `category` means a team already stored keeps its own, and a new team gets
 * "Team <number>", no pit, the first division and the default notebook type. A value is written either way.
 */
export type ImportedTeam = {
  number: string;
  name?: string | null;
  pit: string | null;
  division?: string | null;
  category?: string | null;
};

/**
 * Everything the app can do to its data.
 *
 * Two implementations satisfy this: a JSON file for running locally with
 * no setup, and Postgres for a browser-only deploy where there is no
 * disk to keep a file on. Nothing outside src/lib/db knows which is in
 * use.
 */
export type Store = {
  readonly kind: "file" | "postgres";
  describe(): string;

  listPanels(): Promise<Panel[]>;
  listTeams(): Promise<Team[]>;
  listRequests(): Promise<RequestRow[]>;
  listNotes(teamId?: string): Promise<Note[]>;
  listActivity(limit?: number): Promise<ActivityRow[]>;

  findPanelByCode(code: string): Promise<Panel | null>;
  findPanelById(id: string): Promise<Panel | null>;
  findTeamByNumber(number: string): Promise<Team | null>;
  findRequest(id: string): Promise<RequestRow | null>;

  createRequest(input: NewRequest): Promise<RequestRow>;
  /**
   * `ifStatus` makes the write a compare-and-set: it applies only if the
   * request is still in that status, else throws StoreError(409) and writes
   * nothing (404 if the request is gone altogether). The route passes the
   * status it just read, so two screens acting on the same row cannot both win.
   */
  updateRequest(
    id: string,
    patch: Partial<RequestRow>,
    ifStatus?: RequestRow["status"],
  ): Promise<RequestRow>;
  /** Move a request and its team together, only from the panel and status the caller read. */
  reassignRequest(
    id: string,
    fromPanelId: string | null,
    toPanelId: string,
    ifStatus: RequestRow["status"],
  ): Promise<RequestRow>;

  upsertTeams(rows: ImportedTeam[]): Promise<number>;
  updateTeam(id: string, patch: Partial<Team>): Promise<Team>;
  deleteTeam(id: string): Promise<void>;
  /** Only ever assigns a team to a panel in the same division. */
  autoAssignTeams(perPanel: number, includeAssigned?: boolean, division?: string): Promise<number>;

  createPanel(input: Omit<Panel, "id" | "created_at">): Promise<Panel>;
  /** Create any preset panels that do not exist yet. Returns how many. */
  seedPresetPanels(): Promise<number>;
  updatePanel(id: string, patch: Partial<Panel>): Promise<Panel>;
  deletePanel(id: string): Promise<void>;
  /** Remove every panel at once. Teams survive, unassigned. Returns how many. */
  deleteAllPanels(): Promise<number>;
  generatePanelCode(): Promise<string>;

  createNote(input: NewNote): Promise<Note>;

  /** Referee observations. Optionally narrowed to one team. */
  listFlags(teamId?: string): Promise<FlagRow[]>;
  createFlag(input: NewFlag): Promise<FlagRow>;
  /** Throws StoreError(404) if the flag no longer exists. */
  updateFlag(id: string, edit: FlagEdit): Promise<FlagRow>;
  /** Only the Judge Advisor removes one. Returns whether it existed. */
  removeFlag(id: string): Promise<boolean>;

  /** The event's program and field count; null until one is saved. */
  getRefereeSetup(): Promise<RefereeSetup | null>;
  /** Replaces the one record. resetDay keeps it, resetAll clears it. */
  saveRefereeSetup(input: NewRefereeSetup): Promise<RefereeSetup>;

  /**
   * The judge roster, in the order judges were added. A panel's `judges`
   * list is derived from this; createPanel / updatePanel / seedPresetPanels
   * find-or-create each name in `judges` and set the roster's panel_id to match.
   */
  listJudges(): Promise<JudgeRow[]>;
  /** Names are trimmed and unique case-insensitively: a duplicate is a 409. */
  addJudge(input: NewJudge): Promise<JudgeRow>;
  /** 404 if the judge is gone, 409 for a name already on the roster. */
  updateJudge(id: string, patch: JudgePatch): Promise<JudgeRow>;
  /** Also removes that judge's conflicts. Returns whether they existed. */
  removeJudge(id: string): Promise<boolean>;

  listConflicts(): Promise<ConflictRow[]>;
  /** Idempotent: declaring the same pair twice returns the existing one. */
  addConflict(input: NewConflict): Promise<ConflictRow>;
  removeConflict(id: string): Promise<boolean>;

  listScores(teamId?: string): Promise<ScoreRow[]>;
  /** Set one criterion. Creates the row on first score. */
  saveScore(input: SaveScore): Promise<ScoreRow>;
  /** Wipe one rubric's scores for one team. Returns whether there were any. */
  clearScore(teamId: string, rubricId: string): Promise<boolean>;
  logActivity(entry: NewActivity): Promise<void>;

  /** Every nomination, oldest first. Who may see which is the route's call. */
  listNominations(): Promise<NominationRow[]>;
  /**
   * Idempotent on (awardId, teamId, panelId, judge): asking again returns the
   * same row, and only a changed `reason` writes. 404 if the team or panel is gone.
   */
  nominate(input: NewNomination): Promise<NominationRow>;
  /** Returns whether it existed. A judge's own; never touches the Judge Advisor's. */
  withdrawNomination(key: NominationKey): Promise<boolean>;
  /**
   * The Judge Advisor's nomination (role "admin", no panel): idempotent on
   * (awardId, teamId, judge) among the Judge Advisor's own rows, so it sits
   * beside a judge's nomination of the same team. 404 if the team is gone.
   */
  nominateAsAdmin(input: NewAdminNomination): Promise<NominationRow>;
  /** Remove any nomination by id, whoever made it. Returns whether it existed. */
  removeNomination(id: string): Promise<boolean>;
  /** Who won what, per division. Secret until the ceremony: never part of the shared state. */
  listWinners(): Promise<WinnerRow[]>;
  /** One winner per (awardId, division): setting another replaces it. 404 if the team is gone. */
  setWinner(input: NewWinner): Promise<WinnerRow>;
  /** Returns whether there was one. */
  clearWinner(awardId: string, division: string): Promise<boolean>;

  resetDay(): Promise<void>;
  resetAll(): Promise<void>;
};

