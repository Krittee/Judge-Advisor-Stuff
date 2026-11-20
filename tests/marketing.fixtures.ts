import type { AwardReleaseRow, ReleaseTeam } from "../src/lib/types";

/* The Awards Desk fixtures shared by marketingLogic.test.ts and marketingPage.runtime.test.tsx. */

export const MS = "Middle School";
export const T = (number: string, name: string): ReleaseTeam => ({ id: `t-${number}`, number, name });
export const LABELS = ["Excellence", "Design", "Innovate", "Think", "Amaze", "Build", "Create", "Judges", "Inspire", "Sportsmanship", "Energy"];
export const awards = LABELS.map((label, i) => ({ id: label.toLowerCase(), label, order: i + 1, places: label === "Judges" ? 2 : 1 }));
export const release = (award_id: string, over: Partial<AwardReleaseRow> = {}): AwardReleaseRow => ({
  award_id, division: MS, teams: [T("2381C", "Byte Size")], no_winner: false, previous: null, status: "sent",
  sent_at: "2026-11-19T03:31:00.000Z", sent_by: "Pat", changed_at: null, ...over,
});
export const CHANGED_AT = "2026-11-19T03:58:00.000Z";
