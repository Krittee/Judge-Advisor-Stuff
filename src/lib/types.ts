import type { Status } from "./status";
import type { MatchType } from "./rules";

export type Panel = {
  id: string;
  name: string;
  code: string;
  /** Divisions are a hard wall: a panel only ever judges its own. */
  division: string;
  judges: string[];
  /** Languages this panel can interview in. Empty means unstated. */
  languages: string[];
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
  /** The language the team asked to be interviewed in. */
  language: string;
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

/**
 * A judge is affiliated with a team and must stay away from it.
 *
 * Held against the panel rather than the person: judges sign in with a
 * panel code, so the panel is the unit anything can actually be enforced
 * against. The affiliated judge's name is recorded alongside.
 */
/** A team category as the browser receives it. */
export type TeamCategoryView = {
  id: string;
  label: string;
  color: string;
  /** Rubric ids that do not count toward this category's total or band. */
  excludesRubrics: string[];
};

/**
 * A person on the Judge Advisor's roster. A judge sits on at most one
 * panel; the panel's `judges` list is derived from this, never stored on
 * the panel. Conflicts point at a judge's id, not at a typed name.
 */
export type JudgeRow = {
  id: string;
  name: string;
  note: string | null;
  panel_id: string | null;
  created_at: string;
};

/**
 * Exactly one of `judge_id` and `panel_id` is set: a judge's conflict (the
 * panel they are on is blocked from the team), or a whole-panel conflict
 * from before there was a roster. `judge_name` is only ever read on the latter.
 */
export type ConflictRow = {
  id: string;
  panel_id: string | null;
  judge_id: string | null;
  team_id: string;
  judge_name: string | null;
  note: string | null;
  declared_by: string;
  created_at: string;
};

/**
 * Something a referee saw on the field.
 *
 * Kept apart from judging notes on purpose: a note is a judge's own
 * record of an interview, while a flag is an official observation the
 * judges read but do not write. Whose it is, is part of what it means.
 */
export type FlagRow = {
  id: string;
  team_id: string;
  /** One of config/event.json's refereeFlags ids. */
  kind: string;
  body: string;
  author: string;
  /** One of the flag's ruleset's matchTypes ids (config/rules/*.json: Q, QF,
   *  SKD...), or the legacy "SK". Null on a flag recorded before this was
   *  required. */
  match_type: string | null;
  /** "23", or "2-1" (bracket and match) for a V5RC elimination. */
  match_number: string | null;
  /** The field number as a string ("2"); a flag recorded before fields were
   *  just a number may hold a prefixed one ("HS2"). */
  field: string | null;
  /** Rule ids from src/lib/rules.ts, comma-joined ("GG17,SG9"; one rule is
   *  just "SG6"). Null for Good Conduct, an optional-rule Warning, or a flag
   *  recorded before this existed. Read it with parseRuleList. */
  rule: string | null;
  /** Which ruleset `rule` belongs to ("viqrc", "v5rc"). Null on a flag
   *  recorded before rulesets existed -- those ARE VEX IQ. */
  ruleset: string | null;
  /** The manual edition the ruleset was at when this was recorded (set by
   *  the server from the ruleset, never by the client). Null for IQ. */
  manual_version: string | null;
  /** The referee marked this Minor/Major as having affected the match. */
  match_affecting: boolean;
  created_at: string;
};

/**
 * The program and number of fields every referee works from at this event.
 * One record per event: saved by any referee or the Judge Advisor, and read
 * by anyone (nothing in it is secret).
 */
export type RefereeSetup = {
  /** A ruleset id ("viqrc", "v5rc"). */
  ruleset: string;
  /** 1 to 20. */
  field_count: number;
  /** The name of whoever saved it. */
  set_by: string;
  /** YYYY-MM-DD on the saver's own device clock -- see parseRefereeSetup. */
  set_on: string;
  updated_at: string;
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

/** One of config/event.json's awards, as the browser receives it (judges and the Judge Advisor only). */
export type AwardView = {
  id: string;
  label: string;
  short: string;
  blurb: string;
};

/**
 * One judge's nomination of one team for one award. The key is
 * (award_id, team_id, panel_id, judge): two judges on a panel nominating the
 * same team are two rows, which is what "2 judges" counts.
 */
export type NominationRow = {
  id: string;
  /** One of config/event.json's awards ids. */
  award_id: string;
  team_id: string;
  /** The nominating judge's panel; null once that panel has been deleted. */
  panel_id: string | null;
  /** The judge's session name, like a note's author. */
  judge: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
};

/** The Judge Advisor's pick for one award in one division. Secret until the ceremony. */
export type WinnerRow = {
  award_id: string;
  division: string;
  team_id: string;
  decided_by: string;
  decided_at: string;
};

/**
 * GET /api/awards for the Judge Advisor: every nomination and every winner.
 * A judge's reply is `AwardsJudgeView` and has no `winners` key at all, so
 * `"winners" in reply` tells the two apart.
 */
export type AwardsAdminView = { awards: AwardView[]; nominations: NominationRow[]; winners: WinnerRow[] };
/** GET /api/awards for a judge: their own panel's nominations only, and never a winner. */
export type AwardsJudgeView = { awards: AwardView[]; nominations: NominationRow[] };

/** POST /api/awards (nominate, or change the reason). */
export type NominateReply = { nomination: NominationRow };
/** DELETE /api/awards (withdraw your own) and DELETE /api/awards/winners (clear). `removed` is false when there was nothing to remove. */
export type RemoveReply = { ok: true; removed: boolean };
/** PUT /api/awards/winners. */
export type WinnerReply = { winner: WinnerRow };

export type ActivityKind = "request" | "referee" | "conflict" | "setup" | "award";

export type ActivityRow = {
  id: string;
  request_id: string | null;
  team_id: string | null;
  kind: ActivityKind;
  /** The plain name; `actor_role` is what they were acting as ("Judge Advisor", "Panel 2", "Referee", "Head referee", "Front desk", "Team"). */
  actor: string;
  actor_role: string | null;
  action: string;
  detail: string | null;
  created_at: string;
  /** `teams.number` of `team_id`; null when the entry names no team. */
  team_number: string | null;
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
  categories: TeamCategoryView[];
  /** The languages interviews run in. */
  languages: { id: string; label: string; short: string }[];
  /** Panel/team pairs that must stay apart. */
  conflicts: ConflictRow[];
  /** The judge roster. Admin only: judges and the desk are sent none. */
  judges: JudgeRow[];
  /** Which way round the pit floor is drawn, so the plan matches the room. */
  pitFloor: { columns: "left-to-right" | "right-to-left"; rows: "top-to-bottom" | "bottom-to-top" };
  /** The match types a new flag can be pinned to under the event's program
   *  (VEX IQ's when no setup is saved yet), so it can be traced back. */
  matchTypes: MatchType[];
  /** Null until a referee or the Judge Advisor sets the event up. */
  refereeSetup: RefereeSetup | null;
  /** The kinds of flag a referee can record, with their colours. */
  flagKinds: {
    id: string;
    label: string;
    short: string;
    color: string;
    severity: number;
    requiresRule: boolean;
  }[];
  /** What referees have flagged. Judges read these; only referees write them. */
  flags: FlagRow[];
  /** What this viewer is allowed to do, so the UI never offers more. */
  viewer: ViewerCapabilities;
  serverTime: string;
};

export type ViewerCapabilities = {
  role: "team" | "queuer" | "judge" | "referee" | "admin";
  name: string | null;
  /** Set for a judge: the only panel they may act on. */
  panelId: string | null;
  panelName: string | null;
  /** Set for a judge: the only division they can see. */
  division: string | null;
  canAdvance: boolean;
  canReadNotes: boolean;
  canAdminister: boolean;
  /** May record a referee flag against a team. */
  canFlag: boolean;
  /** May read what referees have flagged. */
  canReadFlags: boolean;
};

export type Slot = {
  panelId: string;
  start: string;
  end: string;
  takenBy: { teamId: string; teamNumber: string; status: Status } | null;
  /** Free, but too close to another booking for a judge to walk it in time. */
  blocked: boolean;
};
