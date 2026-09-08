"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { call, useAppState } from "@/components/useAppState";
import { inputClass, TopBar } from "@/components/ui";
import { SignOutButton } from "@/components/judging";
import { RefereeNav } from "@/components/RefereeNav";
import { FlagSummary } from "@/components/Flags";
import { compareTeamNumbers } from "@/lib/teamNumber";
import type { Session } from "@/lib/auth";

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
    const m = new Map<string, typeof state.flags>();
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
    return <p className="p-10 text-center text-zinc-500">Loading…</p>;
  }

  return (
    <>
      <TopBar
        title="Referee"
        subtitle={session ? session.name : undefined}
        online={online}
        right={<SignOutButton to="/referee/login" />}
      />

      <main className="mx-auto max-w-lg space-y-4 px-5 py-6">
        <RefereeNav active="teams" />

        <div className="space-y-3 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/10">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">
              Search by number, name or pit
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="9882K, Nova, A1"
              autoComplete="off"
              className={inputClass}
            />
          </label>

          <div className="flex flex-wrap items-end gap-3">
            {state.divisions.length > 1 ? (
              <label className="min-w-[10rem] flex-1">
                <span className="mb-1 block text-xs text-zinc-400">Division</span>
                <select
                  value={division}
                  onChange={(e) => setDivision(e.target.value)}
                  className={`${inputClass} py-2`}
                >
                  <option value="" className="bg-zinc-900">
                    All divisions
                  </option>
                  {state.divisions.map((d) => (
                    <option key={d} value={d} className="bg-zinc-900">
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={flaggedOnly}
                onChange={(e) => setFlaggedOnly(e.target.checked)}
                className="h-4 w-4 accent-indigo-500"
              />
              Flagged only
            </label>
          </div>

          <p className="text-xs text-zinc-600">
            {shown.length} of {state.teams.length} teams
          </p>
        </div>

        {!state.teams.length ? (
          <p className="rounded-xl px-4 py-8 text-center text-sm text-zinc-600 ring-1 ring-inset ring-white/10">
            No teams have been imported yet.
          </p>
        ) : !shown.length ? (
          <p className="rounded-xl px-4 py-8 text-center text-sm text-zinc-600 ring-1 ring-inset ring-white/10">
            Nothing matches that.
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((t) => {
              const flags = flagsByTeam.get(t.id) ?? [];
              return (
                <li key={t.id}>
                  {/* The whole row is the target: on a phone, aiming at a
                      team number is not something to ask of anyone. */}
                  <button
                    onClick={() => router.push(`/referee?team=${encodeURIComponent(t.number)}`)}
                    className="group flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-white/[0.03] px-4 py-3 text-left ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.06] hover:ring-indigo-400/50 focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    <span className="text-lg font-bold tabular-nums">{t.number}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">
                      {t.name}
                    </span>
                    {flags.length ? (
                      <FlagSummary flags={flags} kinds={state.flagKinds} size="xs" />
                    ) : null}
                    {/* Says the row goes somewhere, before anyone has to
                        hover to find out. */}
                    <span
                      aria-hidden
                      className="text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-indigo-300"
                    >
                      ›
                    </span>
                    <span className="w-full text-xs text-zinc-600">
                      {t.division}
                      {t.pit ? ` · pit ${t.pit}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
