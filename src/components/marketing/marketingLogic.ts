import type { AwardReleaseRow, ReleasedView, ReleaseSnapshot, ReleaseTeam } from "@/lib/types";

/**
 * The Awards Desk's decisions, as plain functions: what each award row says,
 * the "N of M sent" count, the changes Marketing has not acknowledged, the
 * search, and the key Seen is kept under. AwardsDesk.tsx only draws them.
 *
 * Marketing sees what the Judge Advisor has sent, nothing more. A recalled
 * row's teams are never shown (the server already blanks them for Marketing;
 * `deskRows` drops them again so the page cannot leak a stale snapshot), and a
 * search never looks at the team an award used to have.
 */

export type Change = {
  awardId: string;
  label: string;
  division: string;
  /** The Seen key: this exact change, so a later one flags again. */
  key: string;
  /** What Marketing has now: "7700B Polar Bots", "1234A, 60601D" or "No winner". */
  nowText: string;
  /** What it was, numbers only: "1234A", "1234A, 5150X" or "No winner". */
  wasText: string;
  /** The same, for the row's "Changed — was …" tag. */
  wasNumbers: string;
};

export type DeskRow = {
  award: ReleasedView["awards"][number];
  release: AwardReleaseRow | null;
  state: "sent" | "no-winner" | "recalled" | "not-sent";
  /** Empty unless a winner is on show: a recalled or no-winner row has none. */
  teams: ReleaseTeam[];
  change: Change | null;
};

export function rowState(release: AwardReleaseRow | null): DeskRow["state"] {
  if (!release) return "not-sent";
  if (release.status === "recalled") return "recalled";
  return release.no_winner ? "no-winner" : "sent";
}

/** `mk-seen:<award>:<division>:<changed_at>`: a newer change is a new key, so it flags again. */
export function seenKey(r: Pick<AwardReleaseRow, "award_id" | "division" | "changed_at">): string {
  return `mk-seen:${r.award_id}:${r.division}:${r.changed_at}`;
}

/** "No winner", "7700B Polar Bots" (one team, with its name), or the numbers alone ("1234A, 60601D"). */
export function snapshotText(s: ReleaseSnapshot, withName: boolean): string {
  if (s.no_winner || s.teams.length === 0) return "No winner";
  if (s.teams.length === 1 && withName) return `${s.teams[0].number} ${s.teams[0].name}`;
  return s.teams.map((t) => t.number).join(", ");
}

/** A change is a sent row that replaced an earlier decision. */
function changeOf(award: DeskRow["award"], r: AwardReleaseRow, isSeen: (key: string) => boolean): Change | null {
  if (r.status !== "sent" || !r.previous || !r.changed_at) return null;
  const key = seenKey(r);
  if (isSeen(key)) return null;
  const was = snapshotText(r.previous, false);
  return { awardId: award.id, label: award.label, division: r.division, key, nowText: snapshotText(r, true), wasText: was, wasNumbers: was };
}

/** Every config award in `order`, one row each, with what (if anything) was sent for it in `division`. */
export function deskRows(view: ReleasedView, division: string, isSeen: (key: string) => boolean): DeskRow[] {
  return [...view.awards]
    .sort((a, b) => a.order - b.order)
    .map((award) => {
      const release = view.releases.find((r) => r.award_id === award.id && r.division === division) ?? null;
      const state = rowState(release);
      return {
        award,
        release,
        state,
        teams: state === "sent" && release ? release.teams : [],
        change: release ? changeOf(award, release, isSeen) : null,
      };
    });
}

/** The unseen changes across every division, division order then award order. */
export function changesOf(view: ReleasedView, isSeen: (key: string) => boolean): Change[] {
  return view.divisions.flatMap((d) => deskRows(view, d, isSeen).flatMap((r) => (r.change ? [r.change] : [])));
}

/** Sent rows in a division for awards still in the config; a recalled row is not sent. */
export function sentCount(view: ReleasedView, division: string): number {
  const ids = new Set(view.awards.map((a) => a.id));
  return view.releases.filter((r) => r.division === division && r.status === "sent" && ids.has(r.award_id)).length;
}

export const countText = (n: number, m: number) => `${n} of ${m} sent`;

/** Trimmed, case-insensitive: the award's label or a team Marketing has now. `previous` is never searched. */
export function matchRow(row: DeskRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return row.award.label.toLowerCase().includes(q) || row.teams.some((t) => t.number.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));
}

/** `text` cut at the first match of `query`, for a neutral highlight. */
export function highlight(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim().toLowerCase();
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return [{ text, hit: false }];
  const end = at + q.length;
  return [
    { text: text.slice(0, at), hit: false },
    { text: text.slice(at, end), hit: true },
    { text: text.slice(end), hit: false },
  ].filter((p) => p.text);
}

export const resultsText = (n: number) => `${n} ${n === 1 ? "result" : "results"}`;

/** Local "HH:MM" of an ISO time. */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* Seen lives only in this browser. Storage can throw (Safari private mode, blocked site data):
   then nothing is remembered and the flag shows again after a reload, which is the safe way to be wrong. */
export function readSeen(store: Pick<Storage, "getItem"> | null, key: string): boolean {
  try {
    return store?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeSeen(store: Pick<Storage, "setItem"> | null, key: string): void {
  try {
    store?.setItem(key, "1");
  } catch {
    /* nothing to do: the flag will show again next load */
  }
}
