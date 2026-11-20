import type { Program } from "@/lib/presets";
import { sentUnder } from "@/lib/releases";
import type { AwardReleaseRow, ReleasedAward, ReleasedSection, ReleasedView, ReleaseSnapshot, ReleaseTeam } from "@/lib/types";

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
  return { awardId: award.id, label: award.label, division: r.division, key, nowText: snapshotText(r, true), wasText: snapshotText(r.previous, false) };
}

/** One row per award in `awards` (config order), with what (if anything) was sent for it under `key`. */
function rowsFor(view: ReleasedView, awards: ReleasedAward[], key: string, isSeen: (key: string) => boolean): DeskRow[] {
  return awards.map((award) => {
    const release = view.releases.find((r) => r.award_id === award.id && r.division === key) ?? null;
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

/** Every config award, in config order, one row each, with what (if anything) was sent for it in `division`. */
export const deskRows = (view: ReleasedView, division: string, isSeen: (key: string) => boolean): DeskRow[] => rowsFor(view, view.awards, division, isSeen);

/** A saved setup's sections in the server's order, each with its awards in config order; none without a setup. */
export function sectionsOf(view: ReleasedView): { key: string; awards: ReleasedAward[] }[] {
  return (view.sections ?? []).map((s) => ({
    key: s.key,
    awards: view.awards.filter((a) => s.awardIds.includes(a.id)),
  }));
}

/** Like `deskRows`, but only the section's awards, read under the section's key. */
export function sectionRows(view: ReleasedView, section: ReleasedSection, isSeen: (key: string) => boolean): DeskRow[] {
  return rowsFor(view, view.awards.filter((a) => section.awardIds.includes(a.id)), section.key, isSeen);
}

/** "5 of 9 sent": sent rows under the section's key over the awards it holds. */
export const sectionCount = (view: ReleasedView, section: ReleasedSection): string => countText(sentUnder(view.releases, section.key, section.awardIds), section.awardIds.length);

/** The event title's muted line. Blended names the per-division awards (the first section's); Standard says every award. */
export function eventLine(view: ReleasedView): string {
  if (view.setup?.format !== "blended") return "Every award for each division";
  const labels = sectionsOf(view)[0]?.awards.map((a) => a.label) ?? [];
  return `${labels.join(" and ")} for each division · every other award for the whole event`;
}

/** The unseen changes across every division (or, with a setup, every section), in order. */
export function changesOf(view: ReleasedView, isSeen: (key: string) => boolean): Change[] {
  const rows = view.sections ? view.sections.flatMap((s) => sectionRows(view, s, isSeen)) : view.divisions.flatMap((d) => deskRows(view, d, isSeen));
  return rows.flatMap((r) => (r.change ? [r.change] : []));
}

/** The tabs to draw: the server's, or one "All" tab over every division (an older answer, or no programs configured). */
export function tabsOf(view: ReleasedView): Program[] {
  return view.programs?.length ? view.programs : [{ label: "All", divisions: view.divisions }];
}

/** A tab's lower-case slug: what `mk-tab` remembers, so a rename of the label's case or spacing does not lose it. */
export const tabKey = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The key of the tab to show: the saved one while it still exists, else the first. */
export function pickTab(tabs: Program[], saved: string | null): string {
  const keys = tabs.map((t) => tabKey(t.label));
  return saved && keys.includes(saved) ? saved : (keys[0] ?? "");
}

/** "7 of 22 sent": sent rows over awards × divisions; a division in two tabs counts in each. */
export function tabCount(view: ReleasedView, tab: Program): string {
  const ids = view.awards.map((a) => a.id);
  const n = tab.divisions.reduce((sum, d) => sum + sentUnder(view.releases, d, ids), 0);
  return countText(n, view.awards.length * tab.divisions.length);
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

/** Local "HH:MM" of an ISO time; blank for one that does not parse. */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* Seen and the remembered tab live only in this browser. Storage can throw (Safari private mode, blocked site data):
   then nothing is remembered, the Seen flag shows again after a reload and the first tab shows, which is the safe way to be wrong. */
export function storeGet(store: Pick<Storage, "getItem"> | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function storeSet(store: Pick<Storage, "setItem"> | null, key: string, val: string): void {
  try {
    store?.setItem(key, val);
  } catch {
    /* nothing to do: it is forgotten, and shows as new next load */
  }
}
