import type { Status } from "./status";

export type Panel = {
  id: string;
  name: string;
  code: string;
  room: string | null;
  judges: string[];
  sort_order: number;
  slot_start_at: string | null;
  slot_minutes: number;
  slot_count: number;
  created_at: string;
};

export type Team = {
  id: string;
  number: number;
  name: string;
  panel_id: string | null;
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
  serverTime: string;
};

export type Slot = {
  panelId: string;
  start: string;
  end: string;
  takenBy: { teamId: string; teamNumber: number; status: Status } | null;
};
