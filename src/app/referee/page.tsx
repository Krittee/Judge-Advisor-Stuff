"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { call, useAppState } from "@/components/useAppState";
import { Banner, Button, inputClass, TopBar } from "@/components/ui";
import { SignOutButton } from "@/components/judging";
import { RefereeNav } from "@/components/RefereeNav";
import { FlagList, FlagSummary, FLAG_SOLID, kindOf } from "@/components/Flags";
import { filterTeamNumberInput, normalizeTeamNumber } from "@/lib/teamNumber";
import { filterMatchNumberInput, isValidField, isValidMatchNumber, matchReference } from "@/lib/match";
import { RULE_CATEGORIES, commonFieldRules, ruleDisplayLabel, searchRules, type Rule } from "@/lib/rules";
import type { Session } from "@/lib/auth";
import type { FlagEdit } from "@/lib/db/types";

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
  /* Which match and field this happened at. Deliberately NOT reset after a
     flag is recorded, the way body is — a referee works one match at a
     time and flags several teams against it, so re-typing "Q23, Field 2"
     for every one of them would be the opposite of easy to track back. */
  const [matchType, setMatchType] = useState("");
  const [matchNumber, setMatchNumber] = useState("");
  const [field, setField] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Which rule this was against. Cleared on a successful submit (see
  // record() below) so it can never accidentally carry over to the next
  // report the way match/field deliberately do.
  const [rule, setRule] = useState<string | null>(null);
  const [ruleQuery, setRuleQuery] = useState("");
  const [ruleOpen, setRuleOpen] = useState(false);
  const ruleBoxRef = useRef<HTMLDivElement>(null);

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

  // Close the rule dropdown on an outside click — mousedown, not click, so
  // it fires before a click on an option inside it would otherwise be
  // lost to the close.
  useEffect(() => {
    if (!ruleOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (ruleBoxRef.current && !ruleBoxRef.current.contains(e.target as Node)) {
        setRuleOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [ruleOpen]);

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

  // The rule list, filtered by what's typed and grouped by category in
  // the Quick Reference's own order. Common Field Rules only appear as a
  // shortcut section while the search box is empty — they're the same
  // Rule objects as below, never a duplicate copy.
  const ruleMatches = useMemo(() => searchRules(ruleQuery), [ruleQuery]);
  const ruleGroups = useMemo(() => {
    const byCategory = new Map<string, Rule[]>();
    for (const r of ruleMatches) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
    return RULE_CATEGORIES.map((category) => ({ category, rules: byCategory.get(category) ?? [] })).filter(
      (g) => g.rules.length > 0,
    );
  }, [ruleMatches]);

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

  // What a head referee needs to trace this back to a moment. Required
  // the same way "what did you see" is — a flag with no match reference
  // is exactly the kind of thing that cannot be tracked back later.
  const matchReady = Boolean(matchType) && isValidMatchNumber(matchNumber) && isValidField(field);

  // Highest-severity kind gets the escalation highlight — derived from
  // severity rather than a hardcoded "major" id, the same way the button
  // order above is.
  const maxSeverity = kinds.length ? Math.max(...kinds.map((k) => k.severity)) : 0;

  /* Repeated-violation detection, computed from the reports already on
     record rather than a separate counter — the same set of flags the
     "Flagged today" list below already renders from. Referees see every
     flag in the store (see server-state.ts), so this is complete without
     a dedicated query. Never sets a kind or pre-selects a button: this
     is display only. */
  const sameRuleHistory = useMemo(
    () => (team && rule ? state.flags.filter((f) => f.team_id === team.id && f.rule === rule) : []),
    [state.flags, team, rule],
  );
  const sameMatchSameRule = useMemo(
    () => sameRuleHistory.filter((f) => f.match_type === matchType && f.match_number === matchNumber),
    [sameRuleHistory, matchType, matchNumber],
  );
  const eventTotalsForTeam = useMemo(() => {
    const counts = new Map<string, number>();
    if (!team) return counts;
    for (const f of state.flags) {
      if (f.team_id === team.id) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
    }
    return counts;
  }, [state.flags, team]);
  // "if previousMinorViolationsExist: escalationReviewRequired = true" —
  // never turns into an automatic Major, only a warning the Head Referee
  // reads before deciding.
  const escalationReviewRequired = sameRuleHistory.some((f) => f.kind === "minor");

  async function correctFlag(id: string, edit: FlagEdit) {
    await call(`/api/flags`, { method: "PATCH", body: { id, ...edit } });
    await refresh();
  }

  async function record(kind: string) {
    if (!team || !matchReady) return;
    // Defence in depth: the button is already disabled for this case, but
    // the request must never depend on the UI alone to enforce it.
    if (kindOf(kind, state.flagKinds)?.requiresRule && !rule) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await call("/api/flags", {
        body: { teamId: team.id, kind, body, matchType, matchNumber, field, rule },
      });
      const label = state.flagKinds.find((k) => k.id === kind)?.label ?? kind;
      setSaved(
        `${label} recorded against ${team.number} for ${matchType}${matchNumber} · Field ${field}. ` +
          `The judges will see it.`,
      );
      setBody("");
      // Rule is cleared on success so it never silently carries over to
      // the next report — unlike match/matchNumber/field, which stay.
      setRule(null);
      setRuleQuery("");
      setRuleOpen(false);
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

              {/* Which match this happened at. Required, same standing as
                  "what did you see" — a flag nobody can trace back to a
                  match is not much use to a head referee days later.
                  Match and Match # share a row (2:1 — "Qualification" needs
                  the room, a 4-digit number never does); Field gets its own
                  full-width row so a longer name is not squeezed to a
                  sliver, the way it briefly was in testing. */}
              <div className="flex flex-wrap gap-2">
                <label className="min-w-[10rem] flex-[2]">
                  <span className="mb-1 block text-xs text-zinc-400">Match</span>
                  <select
                    value={matchType}
                    onChange={(e) => setMatchType(e.target.value)}
                    className={`${inputClass} py-2`}
                  >
                    <option value="" className="bg-zinc-900">
                      — select —
                    </option>
                    {state.matchTypes.map((t) => (
                      <option key={t.id} value={t.id} className="bg-zinc-900">
                        {t.id} — {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-[4.5rem] flex-1">
                  <span className="mb-1 block text-xs text-zinc-400">Match #</span>
                  <input
                    value={matchNumber}
                    onChange={(e) => setMatchNumber(filterMatchNumberInput(e.target.value))}
                    placeholder="23"
                    inputMode="numeric"
                    autoComplete="off"
                    className={`${inputClass} py-2 text-center`}
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs text-zinc-400">Field</span>
                <input
                  value={field}
                  onChange={(e) => setField(e.target.value)}
                  placeholder="Field 2"
                  maxLength={40}
                  autoComplete="off"
                  className={`${inputClass} py-2`}
                />
              </label>

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

              {/* Required for Minor/Major, optional for Warning, not shown
                  as required for Good conduct — enforced by the button
                  disabling below and, server-side, by the API. One
                  searchable selector, not a category-then-rule pair: a
                  referee searches "plow" or "SG6" or "6" and gets there in
                  one tap. */}
              <div ref={ruleBoxRef} className="relative block">
                <span className="mb-1 block text-xs text-zinc-400">Rule violated</span>
                <button
                  type="button"
                  onClick={() => setRuleOpen((o) => !o)}
                  className={`${inputClass} flex items-center justify-between py-2 text-left`}
                >
                  <span className={rule ? "" : "text-zinc-600"}>
                    {rule ? ruleDisplayLabel(rule) : "— select/search rule —"}
                  </span>
                  <span aria-hidden className="text-zinc-500">
                    ▾
                  </span>
                </button>

                {ruleOpen ? (
                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl bg-zinc-900 shadow-xl ring-1 ring-inset ring-white/10">
                    <input
                      autoFocus
                      value={ruleQuery}
                      onChange={(e) => setRuleQuery(e.target.value)}
                      placeholder="Search: SG6, 6, possession, plow…"
                      autoComplete="off"
                      className="w-full border-b border-white/10 bg-transparent px-4 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
                    />
                    <div className="max-h-72 overflow-y-auto py-1">
                      {rule ? (
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setRule(null);
                            setRuleOpen(false);
                          }}
                          className="block w-full px-4 py-2 text-left text-sm text-rose-300 hover:bg-white/5"
                        >
                          Clear rule
                        </button>
                      ) : null}

                      {!ruleQuery.trim() && commonFieldRules().length ? (
                        <div>
                          <p className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-zinc-500">
                            COMMON FIELD RULES
                          </p>
                          {commonFieldRules().map((r) => (
                            <button
                              key={`common-${r.id}`}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setRule(r.id);
                                setRuleOpen(false);
                                setRuleQuery("");
                              }}
                              className="block w-full px-4 py-2 text-left text-sm text-zinc-200 hover:bg-white/5"
                            >
                              <span className="font-semibold text-indigo-300">{r.displayId}</span>{" "}
                              {r.shortLabel}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {ruleGroups.length ? (
                        ruleGroups.map((group) => (
                          <div key={group.category}>
                            <p className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-zinc-500">
                              {group.category.toUpperCase()}
                            </p>
                            {group.rules.map((r) => (
                              <button
                                key={r.id}
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setRule(r.id);
                                  setRuleOpen(false);
                                  setRuleQuery("");
                                }}
                                className="block w-full px-4 py-2 text-left text-sm text-zinc-200 hover:bg-white/5"
                              >
                                <span className="font-semibold text-indigo-300">{r.displayId}</span>{" "}
                                {r.shortLabel}
                              </button>
                            ))}
                          </div>
                        ))
                      ) : (
                        <p className="px-4 py-3 text-sm text-zinc-600">No rule matches that.</p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Repeated-violation warning. Display only — never selects
                  or creates anything. The Head Referee reads this and
                  still chooses Minor or Major themselves. */}
              {team && rule && sameRuleHistory.length ? (
                <div className="space-y-1.5 rounded-xl bg-amber-500/10 p-3 ring-1 ring-inset ring-amber-500/30">
                  <p className="text-sm font-semibold text-amber-300">⚠ Repeated violation</p>
                  <p className="text-sm text-zinc-200">{ruleDisplayLabel(rule)}</p>
                  <p className="text-xs text-zinc-400">
                    {sameRuleHistory.length} previous{" "}
                    {sameRuleHistory.length === 1 ? "report" : "reports"} for this rule.
                  </p>
                  <ul className="space-y-0.5 text-xs text-zinc-500">
                    {sameRuleHistory.map((f) => (
                      <li key={f.id}>
                        {matchReference(f.match_type, f.match_number) ?? "—"} —{" "}
                        {kindOf(f.kind, state.flagKinds)?.short ?? f.kind}
                      </li>
                    ))}
                  </ul>

                  {sameMatchSameRule.length && matchReference(matchType, matchNumber) ? (
                    <p className="text-xs font-medium text-orange-300">
                      ⚠ {ruleDisplayLabel(rule)} already recorded {sameMatchSameRule.length}{" "}
                      {sameMatchSameRule.length === 1 ? "time" : "times"} in this Match (
                      {matchReference(matchType, matchNumber)}).
                    </p>
                  ) : null}

                  {escalationReviewRequired ? (
                    <p className="text-xs font-medium text-amber-300">
                      Repeated Minor Violations may require escalation review by the Head
                      Referee.
                    </p>
                  ) : null}

                  {eventTotalsForTeam.size ? (
                    <p className="text-xs text-zinc-500">
                      Event total for {team.number}:{" "}
                      {[...eventTotalsForTeam.entries()]
                        .map(([id, count]) => `${kindOf(id, state.flagKinds)?.short ?? id} ×${count}`)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* One button per kind. The colour is the severity, and the
                  label says it too, so nobody taps "Major" meaning "Good". */}
              <div className="grid gap-2">
                {kinds.map((k) => {
                  const missingRule = k.requiresRule && !rule;
                  // Highlight only the highest-severity kind, and only as
                  // a visual nudge — this never selects or submits it.
                  const highlight = escalationReviewRequired && k.severity === maxSeverity;
                  return (
                    <button
                      key={k.id}
                      disabled={busy || !body.trim() || !matchReady || missingRule}
                      onClick={() => record(k.id)}
                      className={`rounded-xl px-4 py-3 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        FLAG_SOLID[k.color] ?? FLAG_SOLID.zinc
                      } ${highlight ? "ring-2 ring-offset-2 ring-offset-zinc-950 ring-amber-300" : ""}`}
                    >
                      {k.label}
                    </button>
                  );
                })}
              </div>
              {!matchReady ? (
                <p className="text-center text-xs text-zinc-600">
                  Pick the match, the match number and the field first — that is what lets this
                  be traced back later.
                </p>
              ) : !body.trim() ? (
                <p className="text-center text-xs text-zinc-600">
                  Write what happened first — a judge reads this without you there.
                </p>
              ) : !rule && kinds.some((k) => k.requiresRule) ? (
                <p className="text-center text-xs text-zinc-600">
                  Minor and Major violations need a rule picked first.
                </p>
              ) : null}

              {flagsFor(team.id).length ? (
                <div className="pt-1">
                  <h2 className="mb-2 text-xs font-semibold text-zinc-400">
                    Already on {team.number}
                  </h2>
                  <FlagList
                    flags={flagsFor(team.id)}
                    kinds={state.flagKinds}
                    matchTypes={state.matchTypes}
                    onEdit={correctFlag}
                  />
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
