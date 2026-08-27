"use client";

import { useEffect, useMemo, useState } from "react";
import { call } from "./useAppState";
import { Banner } from "./ui";
import { BandChip, BandLegend } from "./BandChip";
import { CategoryChip } from "./CategoryChip";
import { rubricsFor, totalFor } from "@/lib/rubrics";
import type { Rubric } from "@/lib/rubrics";
import type { ScoreRow, Team, TeamCategoryView } from "@/lib/types";

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
  panelName,
  onOpenTeam,
}: {
  teams: Team[];
  categories: TeamCategoryView[];
  panelName?: Record<string, string>;
  onOpenTeam?: (team: Team) => void;
}) {
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [rubricList, setRubricList] = useState<Rubric[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = () =>
      call<{ scores: ScoreRow[]; rubrics: Rubric[] }>("/api/scores", { method: "GET" })
        .then((d) => {
          setScores(d.scores);
          setRubricList(d.rubrics);
        })
        .catch((e) => setError((e as Error).message))
        .finally(() => setLoaded(true));

    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const fullMax = rubricList.reduce((sum, r) => sum + r.max, 0);

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
  if (!loaded) return <p className="py-6 text-center text-sm text-zinc-500">Loading…</p>;

  const scoredCount = rows.filter((r) => r.scored).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-zinc-400">
          {scoredCount} of {rows.length} teams scored · {fullMax} points available
        </span>
        <BandLegend />
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-inset ring-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-zinc-500">
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
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((row, i) => (
              <tr
                key={row.team.id}
                onClick={() => onOpenTeam?.(row.team)}
                className={`${onOpenTeam ? "cursor-pointer" : ""} hover:bg-white/[0.03] ${
                  row.scored ? "" : "opacity-60"
                }`}
              >
                <td className="px-3 py-2.5 tabular-nums text-zinc-600">
                  {row.scored ? i + 1 : "—"}
                </td>
                <td className="px-3 py-2.5">
                  <span className="font-bold tabular-nums">{row.team.number}</span>{" "}
                  <span className="text-zinc-400">{row.team.name}</span>
                </td>
                <td className="px-3 py-2.5">
                  <CategoryChip category={row.team.category} categories={categories} />
                </td>
                {panelName ? (
                  <td className="px-3 py-2.5 text-xs text-zinc-500">
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
                        className="px-3 py-2.5 text-right text-xs text-zinc-600"
                      >
                        n/a
                      </td>
                    );
                  }
                  return (
                    <td key={r.id} className="px-3 py-2.5 text-right tabular-nums text-zinc-400">
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
                      <span className="text-xs text-zinc-500">/{row.max}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <BandChip total={row.total} max={row.max} scored={row.scored} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!rows.length ? (
        <p className="py-8 text-center text-sm text-zinc-600">No teams to score yet.</p>
      ) : null}
    </div>
  );
}
