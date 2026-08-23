import type { ActivityRow, Note, Panel, RequestRow, Team } from "../types";

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

export type NewActivity = {
  requestId?: string | null;
  teamId?: string | null;
  actor: string;
  action: string;
  detail?: string | null;
};

export type ImportedTeam = { number: number; name: string; pit: string | null };

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
  findTeamByNumber(number: number): Promise<Team | null>;
  findRequest(id: string): Promise<RequestRow | null>;

  createRequest(input: NewRequest): Promise<RequestRow>;
  updateRequest(id: string, patch: Partial<RequestRow>): Promise<RequestRow>;

  upsertTeams(rows: ImportedTeam[]): Promise<number>;
  updateTeam(id: string, patch: Partial<Team>): Promise<Team>;
  deleteTeam(id: string): Promise<void>;
  autoAssignTeams(perPanel: number, includeAssigned?: boolean): Promise<number>;

  createPanel(input: Omit<Panel, "id" | "created_at">): Promise<Panel>;
  updatePanel(id: string, patch: Partial<Panel>): Promise<Panel>;
  deletePanel(id: string): Promise<void>;
  generatePanelCode(): Promise<string>;

  createNote(input: NewNote): Promise<Note>;
  logActivity(entry: NewActivity): Promise<void>;

  resetDay(): Promise<void>;
  resetAll(): Promise<void>;
};

/** No 0/O/1/I — these get read aloud across a noisy room. */
export function randomPanelCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 6 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
}
