import type { ActivityRow, Note, Panel, RequestRow, ScoreRow, Team } from "../types";

/** Thrown for rule violations we want to show the user verbatim. */
export class StoreError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type NewRequest = {
  teamId: string;
  panelId: string;
  kind: "queue" | "slot";
  message?: string | null;
  createdBy: string;
  slotStart?: string | null;
  slotEnd?: string | null;
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

export type NewActivity = {
  requestId?: string | null;
  teamId?: string | null;
  actor: string;
  action: string;
  detail?: string | null;
};

export type ImportedTeam = {
  number: string;
  name: string;
  pit: string | null;
  division: string;
  category: string;
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
  findTeamByNumber(number: string): Promise<Team | null>;
  findRequest(id: string): Promise<RequestRow | null>;

  createRequest(input: NewRequest): Promise<RequestRow>;
  updateRequest(id: string, patch: Partial<RequestRow>): Promise<RequestRow>;

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

  listScores(teamId?: string): Promise<ScoreRow[]>;
  /** Set one criterion. Creates the row on first score. */
  saveScore(input: SaveScore): Promise<ScoreRow>;
  logActivity(entry: NewActivity): Promise<void>;

  resetDay(): Promise<void>;
  resetAll(): Promise<void>;
};

