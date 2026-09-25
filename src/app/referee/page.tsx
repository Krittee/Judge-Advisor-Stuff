"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { call, useAppState } from "@/components/useAppState";
import { Banner, inputClass, TopBar } from "@/components/ui";
import { TabBar } from "@/components/nav";
import { SignOutButton } from "@/components/judging";
import { FlagList, FlagSummary, kindOf } from "@/components/Flags";
import { toneSolid } from "@/lib/tone";
import { filterTeamNumberInput, normalizeTeamNumber } from "@/lib/teamNumber";
import {
  filterMatchNumberInput,
  isValidField,
  isValidMatchNumber,
  matchReference,
  normalizeField,
} from "@/lib/match";
import { refereeHistory } from "@/lib/refereeHistory";
import { RULE_CATEGORIES, commonFieldRules, ruleDisplayLabel, searchRules, type Rule } from "@/lib/rules";
import type { Session } from "@/lib/auth";
import type { FlagEdit } from "@/lib/db/types";
import type { FlagRow, Team } from "@/lib/types";

/** Division shorthand for the field name, so a referee picks it instead
 *  of typing it out — "ES2" rather than "Elementary School Field 2".
 *  "SK" is the Skills field(s), which run alongside the other matches
 *  rather than belonging to any one division. */
const FIELD_PREFIXES = ["ES", "MS", "HS", "BL", "SK"] as const;

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
    <Suspense fallback={<p className="p-10 text-center text-ink-faint">Loading…</p>}>
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
  /* Field is built from a division prefix and a number. Both parts remain
     selected after a successful report, just like match type and number. */
  const [fieldPrefix, setFieldPrefix] = useState("");
  const [fieldNumber, setFieldNumber] = useState("");
  const field = normalizeField(`${fieldPrefix}${fieldNumber}`);
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

  // Close the rule dropdown on an outside pointer press. Option buttons use
  // ordinary click events so touch, mouse and keyboard activation all work.
  useEffect(() => {
    if (!ruleOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (ruleBoxRef.current && !ruleBoxRef.current.contains(e.target as Node)) {
        setRuleOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
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
  const commonRules = useMemo(() => commonFieldRules(), []);
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
    const byTeam = new Map<string, FlagRow[]>();
    for (const f of state.flags) {
      byTeam.set(f.team_id, [...(byTeam.get(f.team_id) ?? []), f]);
    }
    return [...byTeam.entries()]
      .map(([teamId, flags]) => ({ team: state.teams.find((t) => t.id === teamId), flags }))
      .filter((row): row is { team: Team; flags: FlagRow[] } =>
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

  /* Repeated-violation detection is a pure calculation over the current
     event store. It excludes Good Conduct and never selects or changes a
     severity; the Head Referee still makes that decision. */
  const history = useMemo(
    () => refereeHistory(state.flags, team?.id, rule, matchType, matchNumber),
    [state.flags, team?.id, rule, matchType, matchNumber],
  );
  const sameRuleHistory = history.sameRule;
  const sameMatchSameRule = history.sameMatchSameRule;
  const eventTotalsForTeam = history.eventTotals;
  const escalationReviewRequired = history.escalationReviewRequired;

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
        `${label} recorded against ${team.number} for ${matchType}${matchNumber} · ${field}. ` +
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
    return <p className="p-10 text-center text-ink-faint">Loading…</p>;
  }

  return (
    <>
      <TopBar
        title="Referee"
        subtitle={session ? session.name : undefined}
        online={online}
        role={state.viewer.role}
        current="/referee"
        right={<SignOutButton to="/referee/login" />}
      />

      <main className="mx-auto max-w-lg space-y-5 px-5 py-6">
        {/* The head referee's main move is "show me all the teams", so the
            way there is the first thing on the page rather than a link in
            the bar. */}
        <TabBar
          label="Referee views"
          variant="segmented"
          active={"lookup"}
          items={[
            { id: "lookup", label: "Type a number", href: "/referee" },
            { id: "teams", label: "All teams", href: "/referee/teams" },
          ]}
        />

        {error ? <Banner kind="error">{error}</Banner> : null}
        {saved ? <Banner kind="success">{saved}</Banner> : null}

        <div className="space-y-3 rounded-2xl bg-surface p-4 ring-1 ring-inset ring-line">
          <label className="block">
            <span className="mb-1 block text-xs text-ink-subtle">Team number</span>
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
            <p className="text-sm text-caution-quiet">No team with that number.</p>
          ) : null}

          {team ? (
            <>
              <div className="rounded-xl bg-sunken px-3 py-2">
                <p className="text-lg font-semibold">{team.name}</p>
                <p className="text-xs text-ink-faint">
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
                  <span className="mb-1 block text-xs text-ink-subtle">Match</span>
                  <select
                    value={matchType}
                    onChange={(e) => setMatchType(e.target.value)}
                    className={`${inputClass} py-2`}
                  >
                    <option value="" className="bg-surface">
                      — select —
                    </option>
                    {state.matchTypes.map((t) => (
                      <option key={t.id} value={t.id} className="bg-surface">
                        {t.id} — {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-[4.5rem] flex-1">
                  <span className="mb-1 block text-xs text-ink-subtle">Match #</span>
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

              <div className="flex flex-wrap gap-2">
                <label className="min-w-[7rem] flex-1">
                  <span className="mb-1 block text-xs text-ink-subtle">Field</span>
                  <select
                    value={fieldPrefix}
                    onChange={(e) => setFieldPrefix(e.target.value)}
                    className={`${inputClass} py-2`}
                  >
                    <option value="" className="bg-surface">
                      — division —
                    </option>
                    {FIELD_PREFIXES.map((prefix) => (
                      <option key={prefix} value={prefix} className="bg-surface">
                        {prefix}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-[4.5rem] flex-1">
                  <span className="mb-1 block text-xs text-ink-subtle">Field #</span>
                  <input
                    value={fieldNumber}
                    onChange={(e) => setFieldNumber(filterMatchNumberInput(e.target.value))}
                    placeholder="1"
                    inputMode="numeric"
                    autoComplete="off"
                    className={`${inputClass} py-2 text-center`}
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs text-ink-subtle">
                  What did you see? <span className="text-ink-faint">(optional)</span>
                </span>
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
                <span className="mb-1 block text-xs text-ink-subtle">Rule violated</span>
                <button
                  type="button"
                  onClick={() => setRuleOpen((o) => !o)}
                  className={`${inputClass} flex items-center justify-between py-2 text-left`}
                >
                  <span className={`min-w-0 break-words ${rule ? "" : "text-ink-faint"}`}>
                    {rule ? ruleDisplayLabel(rule) : "— select/search rule —"}
                  </span>
                  <span aria-hidden className="shrink-0 text-ink-faint">
                    ▾
                  </span>
                </button>

                {ruleOpen ? (
                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl bg-surface shadow-xl ring-1 ring-inset ring-line">
                    <input
                      autoFocus
                      value={ruleQuery}
                      onChange={(e) => setRuleQuery(e.target.value)}
                      placeholder="Search: SG6, 6, possession, plow…"
                      autoComplete="off"
                      className="w-full border-b border-line bg-transparent px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint"
                    />
                    <div className="max-h-[min(18rem,50vh)] overflow-y-auto py-1">
                      {rule ? (
                        <button
                          type="button"
                          onClick={() => {
                            setRule(null);
                            setRuleOpen(false);
                          }}
                          className="block min-h-11 w-full px-4 py-2.5 text-left text-sm text-danger-quiet hover:bg-surface-2"
                        >
                          Clear rule
                        </button>
                      ) : null}

                      {!ruleQuery.trim() && commonRules.length ? (
                        <div>
                          <p className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-ink-faint">
                            COMMON FIELD RULES
                          </p>
                          {commonRules.map((r) => (
                            <button
                              key={`common-${r.id}`}
                              type="button"
                              onClick={() => {
                                setRule(r.id);
                                setRuleOpen(false);
                                setRuleQuery("");
                              }}
                              className="block min-h-11 w-full break-words px-4 py-2.5 text-left text-sm text-ink hover:bg-surface-2"
                            >
                              <span className="font-semibold text-accent-quiet">{r.displayId}</span>{" "}
                              {r.shortLabel}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {ruleGroups.length ? (
                        ruleGroups.map((group) => (
                          <div key={group.category}>
                            <p className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-ink-faint">
                              {group.category.toUpperCase()}
                            </p>
                            {group.rules.map((r) => (
                              <button
                                key={r.id}
                                type="button"
                                onClick={() => {
                                  setRule(r.id);
                                  setRuleOpen(false);
                                  setRuleQuery("");
                                }}
                                className="block min-h-11 w-full break-words px-4 py-2.5 text-left text-sm text-ink hover:bg-surface-2"
                              >
                                <span className="font-semibold text-accent-quiet">{r.displayId}</span>{" "}
                                {r.shortLabel}
                              </button>
                            ))}
                          </div>
                        ))
                      ) : (
                        <p className="px-4 py-3 text-sm text-ink-faint">No rule matches that.</p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Repeated-violation warning. Display only — never selects
                  or creates anything. The Head Referee reads this and
                  still chooses Minor or Major themselves. */}
              {team && rule && sameRuleHistory.length ? (
                <div className="space-y-1.5 rounded-xl bg-caution/12 p-3 ring-1 ring-inset ring-caution/35">
                  <p className="text-sm font-semibold text-caution-quiet">⚠ Repeated violation</p>
                  <p className="text-sm text-ink">{ruleDisplayLabel(rule)}</p>
                  <p className="text-xs text-ink-subtle">
                    {sameRuleHistory.length} previous{" "}
                    {sameRuleHistory.length === 1 ? "report" : "reports"} for this rule.
                  </p>
                  <ul className="space-y-0.5 text-xs text-ink-faint">
                    {sameRuleHistory.map((f) => (
                      <li key={f.id}>
                        {matchReference(f.match_type, f.match_number) ?? "—"} —{" "}
                        {kindOf(f.kind, state.flagKinds)?.short ?? f.kind}
                      </li>
                    ))}
                  </ul>

                  {sameMatchSameRule.length && matchReference(matchType, matchNumber) ? (
                    <p className="text-xs font-medium text-waiting-quiet">
                      ⚠ {ruleDisplayLabel(rule)} already recorded {sameMatchSameRule.length}{" "}
                      {sameMatchSameRule.length === 1 ? "time" : "times"} in this Match (
                      {matchReference(matchType, matchNumber)}).
                    </p>
                  ) : null}

                  {escalationReviewRequired ? (
                    <p className="text-xs font-medium text-caution-quiet">
                      Repeated Minor Violations may require escalation review by the Head
                      Referee.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {eventTotalsForTeam.size ? (
                <div className="rounded-xl bg-surface p-3 ring-1 ring-inset ring-line">
                  <p className="text-xs text-ink-subtle">
                    Event violation history for {team.number}:{" "}
                    {[...eventTotalsForTeam.entries()]
                      .map(([id, count]) => `${kindOf(id, state.flagKinds)?.short ?? id} ×${count}`)
                      .join(", ")}
                  </p>
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
                      disabled={busy || !matchReady || missingRule}
                      onClick={() => record(k.id)}
                      className={`rounded-xl px-4 py-3 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        toneSolid(k.color)
                      } ${highlight ? "ring-2 ring-offset-2 ring-offset-canvas ring-caution" : ""}`}
                    >
                      {k.label}
                    </button>
                  );
                })}
              </div>
              {!matchReady ? (
                <p className="text-center text-xs text-ink-faint">
                  Pick the match, the match number and the field first — that is what lets this
                  be traced back later.
                </p>
              ) : !rule && kinds.some((k) => k.requiresRule) ? (
                <p className="text-center text-xs text-ink-faint">
                  Minor and Major violations need a rule picked first.
                </p>
              ) : null}

              {flagsFor(team.id).length ? (
                <div className="pt-1">
                  <h2 className="mb-2 text-xs font-semibold text-ink-subtle">
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
          <h2 className="mb-2 text-sm font-semibold text-ink-muted">Flagged today</h2>
          {!flagged.length ? (
            <p className="rounded-xl px-4 py-6 text-center text-sm text-ink-faint ring-1 ring-inset ring-line">
              Nothing flagged yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {flagged.map(({ team: t, flags }) => (
                <li key={t.id} className="rounded-xl bg-surface px-4 py-3 ring-1 ring-inset ring-line">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <button
                      onClick={() => setNumber(t.number)}
                      className="text-lg font-bold tabular-nums hover:text-accent"
                    >
                      {t.number}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-subtle">{t.name}</span>
                    <FlagSummary flags={flags} kinds={state.flagKinds} />
                  </div>
                  <div className="mt-3">
                    <FlagList flags={flags} kinds={state.flagKinds} matchTypes={state.matchTypes} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
