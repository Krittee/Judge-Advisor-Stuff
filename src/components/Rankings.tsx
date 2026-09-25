"use client";

import { useMemo } from "react";
import { Banner } from "./ui";
import { BandChip, BandLegend } from "./BandChip";
import { CategoryChip } from "./CategoryChip";
import { FlagSummary } from "./Flags";
import { rubricsFor, totalFor } from "@/lib/rubrics";
import type { Rubric } from "@/lib/rubrics";
import type { AppState, FlagRow, ScoreRow, Team, TeamCategoryView } from "@/lib/types";

/**
 * Teams ranked by their combined rubric total.
 *
 * Judges see their own panel's teams; the Judge Advisor sees everyone.
 * That scoping is done by the endpoint, not here — this only draws what
 * it is given.
 */
export function Rankings({
  teams,
  categories,
  scores,
  rubricList,
  loaded = true,
  error = null,
  panelName,
  onOpenTeam,
  flags = [],
  flagKinds = [],
  onOpenFlags,
}: {
  teams: Team[];
  categories: TeamCategoryView[];
  /** From useScores. Fetched by the screen, not here: the judge console
   *  needs the same numbers on its queue cards, and asking twice for them
   *  would be two polls of one endpoint. */
  scores: ScoreRow[];
  rubricList: Rubric[];
  loaded?: boolean;
  error?: string | null;
  panelName?: Record<string, string>;
  onOpenTeam?: (team: Team) => void;
  /** Referee flags, so conduct sits beside the scores at deliberation. */
  flags?: FlagRow[];
  flagKinds?: AppState["flagKinds"];
  /** Given, the conduct cell opens that team's flags in full. */
  onOpenFlags?: (team: Team) => void;
}) {
  const fullMax = rubricList.reduce((sum, r) => sum + r.max, 0);

  const flagsByTeam = useMemo(() => {
    const m = new Map<string, FlagRow[]>();
    for (const f of flags) m.set(f.team_id, [...(m.get(f.team_id) ?? []), f]);
    return m;
  }, [flags]);

  const showConduct = flagKinds.length > 0;

  const rows = useMemo(() => {
    const byTeam = new Map<string, ScoreRow[]>();
    for (const s of scores) {
      byTeam.set(s.team_id, [...(byTeam.get(s.team_id) ?? []), s]);
    }

    return teams
      .map((team) => {
        const mine = byTeam.get(team.id) ?? [];
        // A category may put a rubric out of scope — an Ungraded notebook
        // is unmarked, not zero — so each team is totalled and banded
        // against the rubrics that actually apply to it.
        const applicable = rubricsFor(rubricList, team.category, categories);
        const { total, max, scored } = totalFor(mine, applicable);
        return { team, total, max, scored, perRubric: mine, applicable };
      })
      .sort(
        (a, b) =>
          // Unscored teams sit at the bottom rather than tying at zero.
          Number(b.scored) - Number(a.scored) ||
          /* Ranked on points, not on share of the denominator. A team with
             no notebook can reach 12 where a graded team can reach 76, so
             ranking by share would put a perfect interview and no notebook
             above a team strong on both — and the awards that this list
             feeds need a notebook. Their band still reads on their own
             denominator, so the colour says how they did on what was
             judged even though the position says how much they scored. */
          b.total - a.total ||
          a.team.number.localeCompare(b.team.number),
      );
  }, [teams, scores, rubricList, categories]);

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!loaded) return <p className="py-6 text-center text-sm text-ink-faint">Loading…</p>;

  const scoredCount = rows.filter((r) => r.scored).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-ink-subtle">
          {scoredCount} of {rows.length} teams scored · {fullMax} points available
        </span>
        <BandLegend />
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-inset ring-line">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="px-3 py-3 w-10">#</th>
              <th className="px-3 py-3">Team</th>
              <th className="px-3 py-3">Notebook</th>
              {panelName ? <th className="px-3 py-3">Panel</th> : null}
              {rubricList.map((r) => (
                <th key={r.id} className="px-3 py-3 text-right">
                  {r.name}
                </th>
              ))}
              <th className="px-3 py-3 text-right">Total</th>
              <th className="px-3 py-3">Band</th>
              {showConduct ? <th className="px-3 py-3">Conduct</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row, i) => (
              <tr
                key={row.team.id}
                onClick={() => onOpenTeam?.(row.team)}
                className={`${onOpenTeam ? "cursor-pointer" : ""} hover:bg-surface-2 ${
                  row.scored ? "" : "opacity-60"
                }`}
              >
                <td className="px-3 py-2.5 tabular-nums text-ink-faint">
                  {row.scored ? i + 1 : "—"}
                </td>
                <td className="px-3 py-2.5">
                  <span className="font-bold tabular-nums">{row.team.number}</span>{" "}
                  <span className="text-ink-subtle">{row.team.name}</span>
                </td>
                <td className="px-3 py-2.5">
                  <CategoryChip category={row.team.category} categories={categories} />
                </td>
                {panelName ? (
                  <td className="px-3 py-2.5 text-xs text-ink-faint">
                    {row.team.panel_id ? (panelName[row.team.panel_id] ?? "—") : "—"}
                  </td>
                ) : null}
                {rubricList.map((r) => {
                  const s = row.perRubric.find((x) => x.rubric_id === r.id);
                  const applies = row.applicable.some((x) => x.id === r.id);
                  if (!applies) {
                    return (
                      <td
                        key={r.id}
                        title={`Not counted — this team's notebook is ${
                          categories.find((c) => c.id === row.team.category)?.label ?? "excluded"
                        }`}
                        className="px-3 py-2.5 text-right text-xs text-ink-faint"
                      >
                        n/a
                      </td>
                    );
                  }
                  return (
                    <td key={r.id} className="px-3 py-2.5 text-right tabular-nums text-ink-subtle">
                      {s && Object.keys(s.values ?? {}).length ? `${s.total}/${r.max}` : "—"}
                    </td>
                  );
                })}
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {row.scored ? (
                    <>
                      <span className="text-lg font-bold">{row.total}</span>
                      {/* The denominator is not the same for every team, so
                          it is always shown rather than left to be assumed. */}
                      <span className="text-xs text-ink-faint">/{row.max}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <BandChip total={row.total} max={row.max} scored={row.scored} />
                </td>
                {showConduct ? (
                  <td className="px-3 py-2.5">
                    <ConductCell
                      flags={flagsByTeam.get(row.team.id) ?? []}
                      kinds={flagKinds}
                      onOpen={onOpenFlags ? () => onOpenFlags(row.team) : undefined}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!rows.length ? (
        <p className="py-8 text-center text-sm text-ink-faint">No teams to score yet.</p>
      ) : null}
    </div>
  );
}

/**
 * What the referees saw, next to what the judges scored.
 *
 * Deliberation is where these two finally have to be read together: a
 * team can score well and still have been a problem on the field, and
 * the awards ask about both. Counts rather than wording, because the
 * question here is "is there anything to look at" -- clicking opens what
 * was actually written.
 */
function ConductCell({
  flags,
  kinds,
  onOpen,
}: {
  flags: FlagRow[];
  kinds: AppState["flagKinds"];
  onOpen?: () => void;
}) {
  if (!flags.length) {
    return <span className="text-xs text-ink-faint">—</span>;
  }
  const summary = <FlagSummary flags={flags} kinds={kinds} size="xs" />;
  if (!onOpen) return summary;

  return (
    <button
      onClick={(e) => {
        // The row itself opens notes; this cell means something else.
        e.stopPropagation();
        onOpen();
      }}
      title={`See all ${flags.length} referee ${flags.length === 1 ? "flag" : "flags"}`}
      className="rounded-lg px-1 py-0.5 ring-1 ring-inset ring-transparent transition hover:ring-accent/60 focus-visible:ring-accent"
    >
      {summary}
    </button>
  );
}
