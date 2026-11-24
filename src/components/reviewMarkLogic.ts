import { judgeKey } from "@/lib/roster";
import type { ReviewMark, Team } from "@/lib/types";
import type { Ask } from "./judge/logic";

/* The review mark's decisions, kept out of the markup so they run as plain
   functions in tests/reviewMarks.runtime.test.tsx. The API enforces the same
   rules (src/app/api/review-marks/route.ts): this only decides what to offer. */

type Call = (url: string, options: { method?: string; body?: unknown }) => Promise<unknown>;

/** Who is looking: a judge by name, or the Judge Advisor. */
export type MarkViewer = { name: string; role: "judge" | "admin" };

export const REASON_MAX = 140;

/** The Judge Advisor changes any mark; a judge only one they set, matched by name as nominations are. Anyone else reads it. */
export const mayChangeMark = (mark: ReviewMark, viewer: MarkViewer): boolean =>
  viewer.role === "admin" || (mark.set_by_role === "judge" && judgeKey(mark.set_by) === judgeKey(viewer.name));

export const markOf = (marks: readonly ReviewMark[], teamId: string): ReviewMark | undefined => marks.find((m) => m.team_id === teamId);

/** Newest first: the strip names whoever last wrote the reason, so the latest edit leads. */
export const newestMarksFirst = (marks: readonly ReviewMark[]): ReviewMark[] => [...marks].sort((a, b) => b.set_at.localeCompare(a.set_at));

/** Set or edit the mark; a blank reason is none. */
export const saveMark = (call: Call, teamId: string, reason: string) =>
  call("/api/review-marks", { method: "PUT", body: { teamId, reason: reason.trim() } });

export const clearQuestion = (team: Pick<Team, "number">) => `Clear the review mark on ${team.number}?`;

/** Ask first, then clear. False when the answer was no. */
export async function clearMarkAfterAsking(ask: Ask, call: Call, team: Pick<Team, "id" | "number">): Promise<boolean> {
  if (!(await ask(clearQuestion(team), { confirmLabel: "Clear mark" }))) return false;
  await call("/api/review-marks", { method: "DELETE", body: { teamId: team.id } });
  return true;
}
