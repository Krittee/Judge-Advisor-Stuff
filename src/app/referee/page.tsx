"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { call, useAppState } from "@/components/useAppState";
import { Banner, Button, inputClass, TopBar } from "@/components/ui";
import { SignOutButton } from "@/components/judging";
import { RefereeNav } from "@/components/RefereeNav";
import { FlagList, FlagSummary, FLAG_SOLID } from "@/components/Flags";
import { filterTeamNumberInput, normalizeTeamNumber } from "@/lib/teamNumber";
import type { Session } from "@/lib/auth";

/**
 * The referee's page.
 *
 * A referee works the field, not the judging room: they look up a team by
 * number, say what they saw, and pick how serious it was. What they write
 * reaches the judges who will interview that team.
 *
 * They see every team in every division, because a referee on the field
 * is not inside anybody's division wall.
 */
export default function RefereePage() {
  return (
    <Suspense fallback={<p className="p-10 text-center text-zinc-500">Loading…</p>}>
      <Referee />
    </Suspense>
  );
}

function Referee() {
  const router = useRouter();
  const params = useSearchParams();
  const { state, online, refresh } = useAppState(5000);
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  const [number, setNumber] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* Arriving from the all-teams list, which passes the team it picked.
     Only seeds the box: typing over it afterwards is the point of the
     page, so this does not fight what the referee does next. */
  const picked = params.get("team");
  useEffect(() => {
    if (picked) setNumber(normalizeTeamNumber(picked));
  }, [picked]);

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

  const teamByNumber = useMemo(
    () => new Map(state.teams.map((t) => [t.number, t])),
    [state.teams],
  );
  const team = teamByNumber.get(normalizeTeamNumber(number)) ?? null;

  // Worst first, so the sharpest button is not the one under your thumb.
  const kinds = useMemo(
    () => [...state.flagKinds].sort((a, b) => a.severity - b.severity),
    [state.flagKinds],
  );

  const flagsFor = (teamId: string) => state.flags.filter((f) => f.team_id === teamId);

  /** Teams flagged today, worst first, so a referee can see the pattern. */
  const flagged = useMemo(() => {
    const byTeam = new Map<string, typeof state.flags>();
    for (const f of state.flags) {
      byTeam.set(f.team_id, [...(byTeam.get(f.team_id) ?? []), f]);
    }
    return [...byTeam.entries()]
      .map(([teamId, flags]) => ({ team: state.teams.find((t) => t.id === teamId), flags }))
      .filter((row): row is { team: NonNullable<typeof row.team>; flags: typeof state.flags } =>
        Boolean(row.team),
      )
      .sort((a, b) => b.flags[0].created_at.localeCompare(a.flags[0].created_at));
  }, [state.flags, state.teams]);

  async function record(kind: string) {
    if (!team) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await call("/api/flags", { body: { teamId: team.id, kind, body } });
      const label = state.flagKinds.find((k) => k.id === kind)?.label ?? kind;
      setSaved(`${label} recorded against ${team.number}. The judges will see it.`);
      setBody("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

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

      <main className="mx-auto max-w-lg space-y-5 px-5 py-6">
        <RefereeNav active="lookup" />

        {error ? <Banner kind="error">{error}</Banner> : null}
        {saved ? <Banner kind="success">{saved}</Banner> : null}

        <div className="space-y-3 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/10">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Team number</span>
            <input
              value={number}
              onChange={(e) => setNumber(filterTeamNumberInput(e.target.value))}
              placeholder="9882K"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              className={`${inputClass} text-2xl font-bold tracking-wide`}
            />
          </label>

          {number && !team ? (
            <p className="text-sm text-amber-400">No team with that number.</p>
          ) : null}

          {team ? (
            <>
              <div className="rounded-xl bg-black/30 px-3 py-2">
                <p className="text-lg font-semibold">{team.name}</p>
                <p className="text-xs text-zinc-500">
                  {team.division}
                  {team.pit ? ` · pit ${team.pit}` : ""}
                </p>
                {flagsFor(team.id).length ? (
                  <div className="mt-2">
                    <FlagSummary flags={flagsFor(team.id)} kinds={state.flagKinds} />
                  </div>
                ) : null}
              </div>

              <label className="block">
                <span className="mb-1 block text-xs text-zinc-400">What did you see?</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Helped another team reset their field. / Touched the robot during the match."
                  className={inputClass}
                />
              </label>

              {/* One button per kind. The colour is the severity, and the
                  label says it too, so nobody taps "Major" meaning "Good". */}
              <div className="grid gap-2">
                {kinds.map((k) => (
                  <button
                    key={k.id}
                    disabled={busy || !body.trim()}
                    onClick={() => record(k.id)}
                    className={`rounded-xl px-4 py-3 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      FLAG_SOLID[k.color] ?? FLAG_SOLID.zinc
                    }`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              {!body.trim() ? (
                <p className="text-center text-xs text-zinc-600">
                  Write what happened first — a judge reads this without you there.
                </p>
              ) : null}

              {flagsFor(team.id).length ? (
                <div className="pt-1">
                  <h2 className="mb-2 text-xs font-semibold text-zinc-400">
                    Already on {team.number}
                  </h2>
                  <FlagList flags={flagsFor(team.id)} kinds={state.flagKinds} />
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-300">Flagged today</h2>
          {!flagged.length ? (
            <p className="rounded-xl px-4 py-6 text-center text-sm text-zinc-600 ring-1 ring-inset ring-white/10">
              Nothing flagged yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {flagged.map(({ team: t, flags }) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-inset ring-white/10"
                >
                  <button
                    onClick={() => setNumber(t.number)}
                    className="text-lg font-bold tabular-nums hover:text-indigo-300"
                  >
                    {t.number}
                  </button>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">{t.name}</span>
                  <FlagSummary flags={flags} kinds={state.flagKinds} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
