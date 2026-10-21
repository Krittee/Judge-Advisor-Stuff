import type { Session } from "./auth";
import type { ActivityKind, ActivityRow } from "./types";

/**
 * What the stores hold for an Activity entry. A row written before entries
 * had a kind has none (`kind` null) and keeps its actor in the old
 * "role:Name" / "Name (Panel N)" form; `readActivity` reads it either way.
 */
export type StoredActivity = Omit<ActivityRow, "kind" | "actor_role" | "team_number"> & {
  kind: ActivityKind | null;
  actor_role: string | null;
};

/** How the old "role:Name" labels name the role on screen. */
const ROLE_NAMES = { admin: "Judge Advisor", queuer: "Front desk", referee: "Referee" } as const;

/** Who is acting, as a new entry stores it: the plain name and the role they acted in. */
export function actorParts(s: Session | null): { actor: string; actorRole: string } {
  if (!s) return { actor: "team", actorRole: "Team" };
  if (s.role === "judge") return { actor: s.name, actorRole: s.panelName };
  if (s.role === "referee" && s.head) return { actor: s.name, actorRole: "Head referee" };
  return { actor: s.name, actorRole: ROLE_NAMES[s.role] };
}

/** An old actor label ("admin:Alex", "Priya (Panel 2)", "team") as a name and a role. */
export function splitActor(label: string): { actor: string; role: string | null } {
  if (label === "team") return { actor: label, role: "Team" };
  const prefixed = /^(admin|queuer|referee):(.*)$/s.exec(label);
  if (prefixed) return { actor: prefixed[2], role: ROLE_NAMES[prefixed[1] as keyof typeof ROLE_NAMES] };
  const onPanel = /^(.*) \(([^()]+)\)$/s.exec(label);
  return onPanel ? { actor: onPanel[1], role: onPanel[2] } : { actor: label, role: null };
}

/** The kind an old entry implies from what it says. */
export function deriveKind(row: { request_id: string | null; action: string }): ActivityKind {
  if (row.request_id) return "request";
  if (/^(flagged|corrected a flag)/i.test(row.action)) return "referee";
  if (/conflict/i.test(row.action)) return "conflict";
  return "setup";
}

/**
 * A stored entry as the API sends it, with the number of the team it names.
 * Both stores read through this, so an old entry is the same in either.
 */
export function readActivity(row: StoredActivity, teamNumber: string | null): ActivityRow {
  if (row.kind) return { ...row, kind: row.kind, team_number: teamNumber };
  const who = splitActor(row.actor);
  return { ...row, kind: deriveKind(row), actor: who.actor, actor_role: who.role, team_number: teamNumber };
}
