import { divisionChoices, scopeKeys, awardsUnder, setupDivisions } from "@/lib/eventSetup";
import { presetDivisions, type Program } from "@/lib/presets";
import type { AwardsAdminView, AwardView, EventFormat, EventSetup, PublicPanel, ReleasedView, Team } from "@/lib/types";
import { divisionTag } from "./floorLogic";

/**
 * The Event page's pure pieces: the four tiles, the preview, and the "Before
 * you can save" checklist. The server (PUT /api/event-setup) is the rule; the
 * checklist is the same test run early, so the Judge Advisor sees why before
 * tapping Save.
 */

type Pick2 = Pick<EventSetup, "program" | "format">;
type Scoped = Pick<AwardView, "label" | "blendedScope">;

export type Tile = { program: string; format: EventFormat; title: string; divisions: string[]; awardCount: number; line: string };

/** programs x [standard, blended], config order. */
export function tiles(programs: Program[], awards: Scoped[]): Tile[] {
  const dLabels = awards.filter((a) => a.blendedScope === "division").map((a) => a.label);
  const w = awards.length - dLabels.length;
  return programs.flatMap((p) => {
    const n = p.divisions.length;
    const base = { program: p.label, divisions: p.divisions };
    return [
      { ...base, format: "standard" as const, title: `${p.label} · Standard`, awardCount: awards.length * n, line: `${awards.length * n} awards · every award per division` },
      {
        ...base,
        format: "blended" as const,
        title: `${p.label} · Blended`,
        awardCount: dLabels.length * n + w,
        line: `${dLabels.length * n + w} awards · ${dLabels.join(" and ")} per division, ${w} for the whole event`,
      },
    ];
  });
}

/** One group per key the awards are decided under, with the labels in it ("Judges (2)" when more than one place). */
export function previewGroups(divisions: string[], format: EventFormat, awards: Pick<AwardView, "label" | "places" | "blendedScope">[]): { key: string; labels: string[] }[] {
  return scopeKeys(divisions, format).map((key) => ({
    key,
    labels: awardsUnder(awards, key, format).map((a) => (a.places > 1 ? `${a.label} (${a.places})` : a.label)),
  }));
}

export type Row = { id: "awards" | "teams" | "panels"; ok: boolean | null; text: string; items?: { id: string; main: string; sub?: string; tag?: string }[] };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const FINE = "all in the program's divisions";

function teamsRow(outside: { id: string; number: string; name: string; division: string }[], program: string): Row {
  if (!outside.length) return { id: "teams", ok: true, text: FINE };
  const divs = [...new Set(outside.map((t) => t.division))].join(", ");
  return {
    id: "teams",
    ok: false,
    text: `${outside.length} ${plural(outside.length, "team is", "teams are")} in ${divs}, which ${program} doesn't have`,
    items: outside.map((t) => ({ id: t.id, main: t.number, sub: t.name, tag: divisionTag(t.division) })),
  };
}

function panelsRow(outside: { id: string; name: string; division: string }[]): Row {
  if (!outside.length) return { id: "panels", ok: true, text: FINE };
  return { id: "panels", ok: false, text: outside.map((p) => `${p.name} · ${p.division}`).join(", ") };
}

const same = (a: Pick2 | null | undefined, b: Pick2 | null | undefined) => Boolean(a && b && a.program === b.program && a.format === b.format);

/**
 * The three rows, in order. Awards are counted under the saved setup (that is
 * the key they were decided under), else today's divisions; picking the saved
 * setup again changes nothing, so its Awards row is green.
 */
export function checklist(
  next: Pick2,
  ctx: { awards: AwardsAdminView | null; released: ReleasedView | null; saved?: Pick2 | null; divisions?: string[]; teams: Team[]; panels: PublicPanel[] },
): Row[] {
  const { awards, released } = ctx;
  // The tab passes the saved setup (null when none), so a failed /released read cannot hide it; callers that leave it out get the release view's.
  const saved = ctx.saved === undefined ? released?.setup : ctx.saved;
  const sentCount = released?.releases.filter((r) => r.status === "sent").length ?? 0;
  let row: Row;
  if (!awards) row = { id: "awards", ok: null, text: "checking…" };
  else {
    const busy = awards.winners.length > 0 || awards.noWinners.length > 0 || sentCount > 0;
    // y is the current event's total: the saved setup's keys, else every award in each of today's divisions (the picked tile's keys only if the caller gave none).
    const savedDivs = saved ? setupDivisions(saved) : null;
    const under = (b: Pick2, divs: string[]) => scopeKeys(divs, b.format).reduce((n, k) => n + awardsUnder(awards.awards, k, b.format).length, 0);
    const total =
      saved && savedDivs ? under(saved, savedDivs) : ctx.divisions ? awards.awards.length * ctx.divisions.length : under(next, setupDivisions(next) ?? presetDivisions());
    // Every decision actually on file, whatever key it sits under: one outside the picked program still blocks, and is counted.
    const done = new Set([...awards.winners, ...awards.noWinners].map((d) => `${d.award_id}|${d.division}`)).size;
    const counts = `${done} of ${total} decided, ${sentCount} sent to Marketing.`;
    row = same(next, saved)
      ? { id: "awards", ok: true, text: busy ? counts : "none decided" }
      : busy
        ? { id: "awards", ok: false, text: `Clear the awards first. ${counts}` }
        : { id: "awards", ok: true, text: "none decided" };
  }
  // The saved setup picked again changes nothing, so every row is fine whatever the data says.
  if (same(next, saved)) return [row, teamsRow([], next.program), panelsRow([])];
  const divisions = divisionChoices(next, false).options;
  const panelOptions = divisionChoices(next, true).options;
  return [
    row,
    teamsRow(ctx.teams.filter((t) => !divisions.includes(t.division)), next.program),
    panelsRow(ctx.panels.filter((p) => !panelOptions.includes(p.division))),
  ];
}

/** The Teams and Panels rows rebuilt from a 409's `outside` list, names from the teams list by id. */
export function outsideRows(
  outside: { teams: { id: string; number: string; division: string }[]; panels: { id: string; name: string; division: string }[] },
  teams: Pick<Team, "id" | "name">[],
  program = "the program",
): Row[] {
  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? "";
  return [teamsRow(outside.teams.map((t) => ({ ...t, name: name(t.id) })), program), panelsRow(outside.panels)];
}

/** Save is allowed once something is picked, it differs from the saved setup, and every row is fine. */
export function canSave(picked: Pick2 | null, saved: Pick2 | null | undefined, rows: Row[]): boolean {
  return Boolean(picked) && !same(picked, saved) && rows.every((r) => r.ok === true);
}
