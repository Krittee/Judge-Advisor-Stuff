"use client";

import { Banner } from "@/components/ui";
import { FlagSummary } from "@/components/Flags";
import type { RankedTeam } from "@/lib/ranking";
import { bands, type Rubric } from "@/lib/rubrics";
import { tone } from "@/lib/tone";
import type { AppState, FlagRow, Team } from "@/lib/types";
import { BandPill, ChevronRight } from "./parts";
import { rubricShort } from "./logic";

/**
 * The Scores tab: the panel ranked on points, in the order rankTeams gives
 * (src/lib/ranking.ts), the same one the Judge Advisor's Scores tab uses.
 * Tapping a row opens the team sheet.
 */
export function ScoresTab({
  panelName,
  rows,
  categories,
  rubricList,
  loaded,
  error,
  flags,
  flagKinds,
  onOpen,
}: {
  panelName: string;
  /** rankTeams, best first, unscored teams last. */
  rows: RankedTeam[];
  categories: AppState["categories"];
  rubricList: Rubric[];
  loaded: boolean;
  error: string | null;
  flags: FlagRow[];
  flagKinds: AppState["flagKinds"];
  onOpen: (team: Team) => void;
}) {
  if (error) return <Banner kind="error">{error}</Banner>;
  if (!loaded) return <p className="jg-empty">Loading…</p>;

  const scoredCount = rows.filter((r) => r.scored).length;

  return (
    <>
      <div className="jg-sh2">
        <div className="jg-s1">
          <h2>{panelName} ranking</h2>
          <span>
            {scoredCount} of {rows.length} scored
          </span>
        </div>
        <div className="jg-leg" aria-label="Score bands">
          {bands().map((b) => (
            <span key={b.id} className={`jg-band ring-1 ring-inset ${tone(b.color)}`}>
              {b.label}
              {b.minPercent > 0 ? ` ≥${b.minPercent}%` : ""}
            </span>
          ))}
        </div>
      </div>

      <ul className="jg-rks">
        {rows.map((row, i) => {
          const mine = flags.filter((f) => f.team_id === row.team.id);
          const category = categories.find((c) => c.id === row.team.category)?.label;
          const counted = row.perRubric.filter(
            (s) => row.applicable.some((r) => r.id === s.rubric_id) && Object.keys(s.values ?? {}).length > 0,
          );
          // One rubric marked and another still open: say which, so a total
          // out of 76 is not read as a full score.
          const only =
            row.scored && counted.length === 1 && row.applicable.length > 1
              ? row.applicable.find((r) => r.id === counted[0].rubric_id)
              : undefined;
          // A category that drops a rubric is why the denominator is smaller.
          const dropped = row.applicable.length < rubricList.length;
          const sub = [row.team.name + (only ? ` · ${rubricShort(only).toLowerCase()} only` : ""), !row.scored && dropped ? category : null]
            .filter(Boolean)
            .join(" · ");

          return (
            <li key={row.team.id}>
              <button type="button" className="jg-rk" onClick={() => onOpen(row.team)}>
                <span className="jg-rn">{row.scored ? i + 1 : "—"}</span>
                <span className="jg-rt">
                  <span className="jg-r1">
                    <b>{row.team.number}</b>
                    <FlagSummary flags={mine} kinds={flagKinds} />
                  </span>
                  <span className="jg-r2">{sub}</span>
                </span>
                <span className="jg-rs">
                  {row.scored ? (
                    <>
                      <b>
                        {row.total}
                        <small>/{row.max}</small>
                      </b>
                      <BandPill total={row.total} max={row.max} scored />
                    </>
                  ) : (
                    <>
                      <span className="jg-ns">not scored</span>
                      <small className="jg-of">
                        {dropped ? `${row.applicable.map((r) => rubricShort(r).toLowerCase()).join(" + ")} ` : ""}/{row.max}
                      </small>
                    </>
                  )}
                </span>
                <ChevronRight />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
