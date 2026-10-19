import { rubricsFor, totalFor } from "./rubrics";
import type { Rubric } from "./rubrics";
import type { ScoreRow, Team, TeamCategoryView } from "./types";

/** A team with its totals and the rubrics that counted toward them. */
export type RankedTeam = {
  team: Team;
  total: number;
  max: number;
  scored: boolean;
  /** This team's score rows, one per rubric it has marks on. */
  perRubric: ScoreRow[];
  /** The rubrics this team is judged on (an Ungraded notebook drops one). */
  applicable: Rubric[];
};

/** Teams in ranking order: scored first, most points first. */
export function rankTeams(
  teams: Team[],
  scores: ScoreRow[],
  rubricList: Rubric[],
  categories: TeamCategoryView[],
): RankedTeam[] {
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
}
