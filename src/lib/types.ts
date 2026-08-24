import type { Status } from "./status";

export type Panel = {
  id: string;
  name: string;
  code: string;
  /** Divisions are a hard wall: a panel only ever judges its own. */
  division: string;
  judges: string[];
  sort_order: number;
  slot_start_at: string | null;
  slot_minutes: number;
  slot_count: number;
  created_at: string;
};

export type Team = {
  id: string;
  /** Text, not a number: identifiers like "9882K" are common. */
  number: string;
  name: string;
  panel_id: string | null;
  division: string;
  /** Which of the two kinds of team this is. See config/event.json. */
  category: string;
  pit: string | null;
  created_at: string;
};

export type RequestRow = {
  id: string;
  team_id: string;
  panel_id: string | null;
  status: Status;
  kind: "queue" | "slot";
  slot_start: string | null;
  slot_end: string | null;
  message: string | null;
  created_by: string | null;
  acknowledged_by: string | null;
  interviewer: string | null;
  outcome: string | null;
  requested_at: string;
  acknowledged_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
};

export type Note = {
  id: string;
  team_id: string;
  request_id: string | null;
  panel_id: string | null;
  author: string;
  body: string;
  created_at: string;
};

export type ScoreRow = {
  id: string;
  team_id: string;
  rubric_id: string;
  /** criterion id -> points awarded. Missing means not yet scored. */
  values: Record<string, number>;
  /** Denormalised so ranking never has to re-add every row. */
  total: number;
  scored_by: string;
  panel_id: string | null;
  updated_at: string;
};

export type ActivityRow = {
  id: string;
  request_id: string | null;
  team_id: string | null;
  actor: string;
  action: string;
  detail: string | null;
  created_at: string;
};

/** Panel with its judge code stripped — safe to send to any browser. */
export type PublicPanel = Omit<Panel, "code" | "created_at">;

/** The single payload every screen polls for. */
export type AppState = {
  panels: PublicPanel[];
  teams: Team[];
  requests: RequestRow[];
  /** Every division in play, so the UI can offer them without guessing. */
  divisions: string[];
  /** The two team kinds, with their colours, straight from config. */
  categories: { id: string; label: string; color: string }[];
  /** What this viewer is allowed to do, so the UI never offers more. */
  viewer: ViewerCapabilities;
  serverTime: string;
};

export type ViewerCapabilities = {
  role: "team" | "queuer" | "judge" | "admin";
  name: string | null;
  /** Set for a judge: the only panel they may act on. */
  panelId: string | null;
  panelName: string | null;
  /** Set for a judge: the only division they can see. */
  division: string | null;
  canAdvance: boolean;
  canReadNotes: boolean;
  canAdminister: boolean;
};

export type Slot = {
  panelId: string;
  start: string;
  end: string;
  takenBy: { teamId: string; teamNumber: string; status: Status } | null;
};
