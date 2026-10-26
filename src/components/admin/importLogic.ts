import type { Call } from "./teamsLogic";

/* The Judge Advisor Import tab's decisions, kept out of the markup so they run
   as plain functions in tests/adminImport.logic.test.mjs. What is a team and
   what is a skipped line is the server's call (POST /api/admin/teams); this
   file only words the answer. */

/** A line the server could not read: 1-based, as the box numbers it. */
export type SkippedLine = { line: number; text: string; reason: string };

/** What POST /api/admin/teams answers. `created + updated === imported`; `skipped` counts a header row too, `skippedLines` does not. */
export type ImportReply = {
  imported: number;
  created: number;
  updated: number;
  assigned: number;
  skipped: number;
  skippedLines: SkippedLine[];
};

export type ImportDraft = { text: string; autoAssign: boolean; perPanel: number };

/**
 * The reply and whether spreading was on when Import was pressed. The result
 * box says "assigned N to panels" only then, and flipping the checkbox
 * afterwards must not change what it says about what was done.
 */
export type ImportOutcome = { reply: ImportReply; autoAssign: boolean };

/** Import is off while the box is empty and while a request is out. */
export const importDisabled = (text: string, busy: boolean): boolean => busy || !text.trim();

/** Send the box. The server's refusal is thrown, its message as-is. */
export async function runImport(call: Call, draft: ImportDraft): Promise<ImportOutcome> {
  const reply = (await call("/api/admin/teams", { body: draft })) as ImportReply;
  return { reply, autoAssign: draft.autoAssign };
}

/** The info line after a file loads: "Loaded teams.xlsx · 48 rows". */
export const loadedLine = (fileName: string, rows: number): string => `Loaded ${fileName} · ${rows} ${rows === 1 ? "row" : "rows"}`;

/** "Imported <46 teams>, 12 new · 34 updated · assigned 9 to panels." as the bold part and the rest. */
export function importSummary({ reply, autoAssign }: ImportOutcome): { head: string; rest: string } {
  const parts = [`${reply.created} new`, `${reply.updated} updated`];
  if (autoAssign) parts.push(`assigned ${reply.assigned} to panels`);
  return { head: `${reply.imported} ${reply.imported === 1 ? "team" : "teams"}`, rest: `, ${parts.join(" · ")}.` };
}

/** The caution box's heading: "2 lines skipped". */
export const skippedHeading = (lines: SkippedLine[]): string => `${lines.length} ${lines.length === 1 ? "line" : "lines"} skipped`;

/** One entry in it: "Line 17" and "no team number", joined as it reads. */
export const skippedEntry = (l: SkippedLine): string => `Line ${l.line} · ${l.reason}`;
