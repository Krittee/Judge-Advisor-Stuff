"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { call, useAppState } from "@/components/useAppState";
import { RefereeFrame } from "@/components/referee/RefereeFrame";
import { FlagSummary } from "@/components/Flags";
import { compareTeamNumbers } from "@/lib/teamNumber";
import type { Session } from "@/lib/auth";
import type { FlagRow } from "@/lib/types";

/**
 * Every team, to scroll and pick from.
 *
 * The other page is faster when you can read the number off the robot.
 * This one is for when you cannot: you know roughly who it was, or you
 * are working from a name, or the number has a letter you are unsure of.
 * Picking a team hands it to the flagging page rather than repeating the
 * form here, so there is still only one place a flag is written.
 */
export default function RefereeTeamsPage() {
  const router = useRouter();
  const { state, online } = useAppState(6000);
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  const [query, setQuery] = useState("");
  const [division, setDivision] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  useEffect(() => {
    call<{ session: Session | null }>("/api/session", { method: "GET" })
      .then(({ session }) => {
        if (!session) {
          router.replace("/referee/login");
          return;
        }
        setSession(session);
      })
      .catch(() => router.replace("/referee/login"));
  }, [router]);

  const flagsByTeam = useMemo(() => {
    const m = new Map<string, FlagRow[]>();
    for (const f of state.flags) m.set(f.team_id, [...(m.get(f.team_id) ?? []), f]);
    return m;
  }, [state.flags]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.teams
      .filter((t) => {
        if (division && t.division !== division) return false;
        if (flaggedOnly && !flagsByTeam.has(t.id)) return false;
        if (!q) return true;
        // Number, name or pit, so "9882", "nova" and "a1" all find a team.
        return (
          t.number.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          (t.pit ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => compareTeamNumbers(a.number, b.number));
  }, [state.teams, query, division, flaggedOnly, flagsByTeam]);

  if (session === undefined) {
    return <p className="p-10 text-center text-ink-faint">Loading…</p>;
  }

  return (
    <RefereeFrame name={session?.name} online={online} role={state.viewer.role} current="/referee/teams">
      <main className="rf-body rf-body--list">
        <div className="rf-find">
          <label className="rf-lab" htmlFor="rf-find">
            <span>Search number, name or pit</span>
          </label>
          <div className="rf-sf">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              id="rf-find"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="9882K, Nova, A1"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="rf-input"
            />
          </div>

          <div className="rf-filt">
            {state.divisions.length > 1 ? (
              <span className="rf-dsel">
                <select value={division} onChange={(e) => setDivision(e.target.value)} aria-label="Division">
                  <option value="" className="bg-surface">
                    All divisions
                  </option>
                  {state.divisions.map((d) => (
                    <option key={d} value={d} className="bg-surface">
                      {d}
                    </option>
                  ))}
                </select>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            ) : null}
            <button type="button" className="rf-fchip" aria-pressed={flaggedOnly} onClick={() => setFlaggedOnly(!flaggedOnly)}>
              Flagged only
            </button>
            <span className="rf-count" aria-live="polite">
              {shown.length} of {state.teams.length} teams
            </span>
          </div>
        </div>

        <p className="rf-tcap">Tap a team to flag it on Report.</p>

        {!state.teams.length ? (
          <p className="rf-empty">No teams have been imported yet.</p>
        ) : !shown.length ? (
          <p className="rf-empty">Nothing matches that.</p>
        ) : (
          <ul className="rf-tlist">
            {shown.map((t) => {
              const flags = flagsByTeam.get(t.id) ?? [];
              return (
                <li key={t.id}>
                  {/* The whole row is the target: on a phone, aiming at a
                      team number is not something to ask of anyone. */}
                  <button
                    type="button"
                    className="rf-trow"
                    onClick={() => router.push(`/referee?team=${encodeURIComponent(t.number)}`)}
                  >
                    <span className="rf-tn">
                      <span className="rf-t1">
                        <b>{t.number}</b>
                        <span>{t.name}</span>
                      </span>
                      <span className="rf-t2">
                        {t.division}
                        {t.pit ? ` · Pit ${t.pit}` : ""}
                      </span>
                    </span>
                    {flags.length ? (
                      <span className="rf-fl">
                        <FlagSummary flags={flags} kinds={state.flagKinds} />
                      </span>
                    ) : null}
                    {/* Says the row goes somewhere, before anyone has to
                        hover to find out. */}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </RefereeFrame>
  );
}
