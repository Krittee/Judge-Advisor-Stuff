"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { call, useAppState } from "@/components/useAppState";
import { Banner } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmDialog";
import { FlagList, FlagSummary, flagsOnDay, kindOf } from "@/components/Flags";
import { AllRulesPicker } from "@/components/AllRulesPicker";
import { ProgramTag, SetupGate } from "@/components/referee/HeadReferee";
import { MatchSheet } from "@/components/referee/MatchSheet";
import { RefereeFrame } from "@/components/referee/RefereeFrame";
import { SeverityButtons } from "@/components/referee/SeverityButtons";
import {
  canSetUp,
  localDate,
  matchIsSet,
  needsEventSetup,
  recordBlocker,
  recordLabel,
  recordPayload,
  setupChangeQuestion,
  setupRequest,
  type CurrentMatch,
} from "@/components/referee/logic";
import { toneSolid } from "@/lib/tone";
import { filterTeamNumberInput, normalizeTeamNumber } from "@/lib/teamNumber";
import { fieldLabel, matchReference } from "@/lib/match";
import { DISQUALIFIED_KIND, MAX_FIELD_COUNT, type FlagReport } from "@/lib/flagValidation";
import { refereeHistory } from "@/lib/refereeHistory";
import {
  commonFieldRules,
  DEFAULT_RULESET_ID,
  getRuleset,
  MAX_FLAG_RULES,
  ruleDisplayLabel,
  toggleRule,
} from "@/lib/rules";
import type { Session } from "@/lib/auth";
import type { FlagRow, Team } from "@/lib/types";

/**
 * The referee's page.
 *
 * A referee works the field, not the judging room: they set the match once,
 * look a team up by number, say what they saw, pick how serious it was and
 * record it. What they write reaches the judges who will interview that team.
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
  const { state, loaded, online, refresh } = useAppState(5000);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const bodyRef = useRef<HTMLElement>(null);

  const [number, setNumber] = useState("");
  const [body, setBody] = useState("");
  /* Which match and field this happened at. Deliberately NOT reset after a
     flag is recorded, the way body is -- a referee works one match at a
     time and flags several teams against it, so re-typing "Q23, Field 2"
     for every one of them would be the opposite of easy to track back. */
  const [match, setMatch] = useState<CurrentMatch>({ matchType: "", matchNumber: "", field: "" });
  const { matchType, matchNumber, field } = match;
  // Which severity is selected. Tapping a button only selects it; the Record
  // button saves.
  const [kindId, setKindId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Which rules this was against, from the event's program. Cleared on a
  // successful submit (see record() below) so they can never accidentally
  // carry over to the next report the way match/field deliberately do.
  const [rules, setRules] = useState<string[]>([]);
  const [matchAffecting, setMatchAffecting] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [editingSetup, setEditingSetup] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();

  // The program and field count are the event's, not this device's: one setup
  // that every referee works from. Before there is one (which the gate below
  // never lets the form see) a flag falls back to VEX IQ and any field.
  const setup = state.refereeSetup;
  const rulesetId = setup?.ruleset ?? DEFAULT_RULESET_ID;
  const ruleset = getRuleset(rulesetId);
  const fieldCount = setup?.field_count ?? MAX_FIELD_COUNT;
  const today = localDate();
  const settingUp = loaded && (editingSetup || needsEventSetup(setup, today));
  // Only the head referee (or the Judge Advisor) sets it up; the rest wait for
  // it and see it read-only.
  const mayEditSetup = canSetUp(session);

  /* Arriving from the all-teams list, which passes the team it picked.
     Only seeds the box: typing over it afterwards is the point of the
     page, so this does not fight what the referee does next. */
  const pickedTeam = params.get("team");
  useEffect(() => {
    if (pickedTeam) setNumber(normalizeTeamNumber(pickedTeam));
  }, [pickedTeam]);

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

  // "Today" in the tab bar is a link to #today. Coming from another page the
  // section does not exist until the page has loaded, so go there once it does.
  useEffect(() => {
    if (session && loaded && window.location.hash === "#today") {
      document.getElementById("today")?.scrollIntoView();
    }
  }, [session, loaded]);

  const teamByNumber = useMemo(
    () => new Map(state.teams.map((t) => [t.number, t])),
    [state.teams],
  );
  const team = teamByNumber.get(normalizeTeamNumber(number)) ?? null;

  // Least serious first, the order the buttons are laid out in.
  const kinds = useMemo(
    () => [...state.flagKinds].sort((a, b) => a.severity - b.severity),
    [state.flagKinds],
  );
  const kind = kinds.find((k) => k.id === kindId) ?? null;

  const flagsFor = (teamId: string) => state.flags.filter((f) => f.team_id === teamId);

  /** Today's reports only; older ones stay on each team's record. The event has
   *  no date setting to read "today" from, so the device clock is the source. */
  const todayFlags = useMemo(() => flagsOnDay(state.flags, new Date()), [state.flags]);

  /** Teams flagged today, newest first, so a referee can see the pattern. */
  const flagged = useMemo(() => {
    const byTeam = new Map<string, FlagRow[]>();
    for (const f of todayFlags) {
      byTeam.set(f.team_id, [...(byTeam.get(f.team_id) ?? []), f]);
    }
    return [...byTeam.entries()]
      .map(([teamId, flags]) => ({ team: state.teams.find((t) => t.id === teamId), flags }))
      .filter((row): row is { team: Team; flags: FlagRow[] } =>
        Boolean(row.team),
      )
      .sort((a, b) => b.flags[0].created_at.localeCompare(a.flags[0].created_at));
  }, [todayFlags, state.teams]);

  // The most serious kind short of Disqualified gets the escalation
  // highlight -- derived from severity rather than a hardcoded "major" id,
  // the same way the button order above is. Disqualified is left out on
  // purpose: a repeated Minor may prompt a review, but nothing on this page
  // ever steers a referee toward a DQ.
  const maxSeverity = Math.max(0, ...kinds.filter((k) => k.id !== DISQUALIFIED_KIND).map((k) => k.severity));

  /* Repeated-violation detection is a pure calculation over the current
     event store. It excludes Good Conduct and never selects or changes a
     severity; the Head Referee still makes that decision. */
  const history = useMemo(
    () => refereeHistory(state.flags, team?.id, rules, matchType, matchNumber, rulesetId),
    [state.flags, team?.id, rules, matchType, matchNumber, rulesetId],
  );
  // Only the cited rules the team already has a record for.
  const repeatedRules = history.byRule.filter((h) => h.sameRule.length > 0);
  const eventTotalsForTeam = history.eventTotals;
  const escalationReviewRequired = history.escalationReviewRequired;
  const escalateId = escalationReviewRequired ? kinds.find((k) => k.severity === maxSeverity)?.id : null;

  // The common rules are the shortcuts; anything else picked from All rules is
  // listed after them so what is selected can always be seen and undone.
  const commonIds = commonFieldRules(rulesetId).map((r) => r.id);
  const chipIds = [...commonIds, ...rules.filter((id) => !commonIds.includes(id))];
  const atRuleCap = rules.length >= MAX_FLAG_RULES;

  const blocker = recordBlocker({
    match,
    rulesetId,
    fieldCount,
    hasTeam: Boolean(team),
    kind,
    rules,
  });

  async function correctFlag(id: string, edit: FlagReport) {
    await call(`/api/flags`, { method: "PATCH", body: { id, ...edit } });
    await refresh();
  }

  async function record() {
    // Defence in depth: the button is already disabled for this case, but
    // the request must never depend on the UI alone to enforce it.
    if (!team || !kind || blocker) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await call("/api/flags", {
        body: recordPayload({ teamId: team.id, kind: kind.id, body, match, rulesetId, rules, matchAffecting }),
      });
      setSaved(
        `${kind.label} recorded against ${team.number} for ${matchReference(matchType, matchNumber)} · ${fieldLabel(field)}. ` +
          `The judges will see it.`,
      );
      setBody("");
      // Rules are cleared on success so they never silently carry over to
      // the next report -- unlike the team, match and field, which stay.
      setRules([]);
      setMatchAffecting(false);
      setKindId(null);
      // Record is pinned, so the referee is usually at the foot of the form:
      // take them back to the banner and the team box.
      bodyRef.current?.scrollTo({ top: 0 });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveSetup(nextRuleset: string, count: number) {
    const question = setupChangeQuestion(setup, { ruleset: nextRuleset, fieldCount: count }, today);
    if (question && !(await ask(question, { confirmLabel: "Change for everyone" }))) return;
    setSetupBusy(true);
    setSetupError(null);
    try {
      await call("/api/referee-setup", { method: "PUT", body: setupRequest(nextRuleset, count, today) });
      // A rule id means nothing outside the program it was picked from.
      if (nextRuleset !== rulesetId) setRules([]);
      // A poll already in flight when the PUT landed may predate it, and
      // refresh() hands that one back; the second call starts a fresh one.
      await refresh();
      await refresh();
      setEditingSetup(false);
    } catch (e) {
      setSetupError((e as Error).message);
    } finally {
      setSetupBusy(false);
    }
  }

  if (session === undefined) {
    return <p className="p-10 text-center text-ink-faint">Loading…</p>;
  }

  const frame = { name: session?.name, online, role: state.viewer.role, current: "/referee" } as const;

  if (!loaded) {
    return (
      <RefereeFrame {...frame}>
        <main className="rf-body">
          <p className="rf-empty">Loading…</p>
        </main>
      </RefereeFrame>
    );
  }

  if (settingUp) {
    return (
      <RefereeFrame {...frame} tabs={false}>
        <SetupGate
          canSetUp={mayEditSetup}
          setup={setup}
          name={session?.name ?? ""}
          busy={setupBusy}
          error={setupError}
          onSave={saveSetup}
          onCancel={needsEventSetup(setup, today) ? undefined : () => setEditingSetup(false)}
        />
        {dialog}
      </RefereeFrame>
    );
  }

  return (
    <RefereeFrame {...frame}>
      {/* The match every flag is pinned to, kept in view while the form scrolls. */}
      <section className="rf-mbar" aria-label="Current match">
        <div className="rf-mm">
          <span>Current match</span>
          <b>{matchReference(matchType, matchNumber) ?? "Not set"}</b>
        </div>
        {fieldLabel(field) ? <span className="rf-mchip">{fieldLabel(field)}</span> : null}
        <ProgramTag
          program={ruleset.program}
          fieldCount={fieldCount}
          onEdit={mayEditSetup ? () => setEditingSetup(true) : undefined}
        />
        <button type="button" className="rf-chg" onClick={() => setSheetOpen(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
          </svg>
          {matchIsSet(match, rulesetId, fieldCount) ? "Change" : "Set match"}
        </button>
      </section>

      <main className="rf-body" ref={bodyRef}>
        {saved ? <Banner kind="success">{saved}</Banner> : null}

        <section>
          <label className="rf-lab" htmlFor="rf-team">
            <span>Team to flag</span>
          </label>
          <input
            id="rf-team"
            value={number}
            onChange={(e) => setNumber(filterTeamNumberInput(e.target.value))}
            placeholder="9882K"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="rf-input rf-big"
          />

          {number && !team ? <p className="rf-miss">No team with that number.</p> : null}

          {team ? (
            <div className="rf-tline">
              <span>{[team.name, team.division, team.pit ? `Pit ${team.pit}` : null].filter(Boolean).join(" · ")}</span>
              {flagsFor(team.id).length ? (
                <span className="rf-tflags">
                  <FlagSummary flags={flagsFor(team.id)} kinds={state.flagKinds} />
                </span>
              ) : null}
            </div>
          ) : null}
        </section>

        <section>
          <div className="rf-lab" id="rf-rules-l">
            <span>What happened</span>
            <span className="rf-tag">{atRuleCap ? `Limit of ${MAX_FLAG_RULES} reached` : "Rules broken"}</span>
          </div>
          <div className="rf-chips" role="group" aria-labelledby="rf-rules-l">
            {chipIds.map((id) => (
              <button
                key={id}
                type="button"
                className="rf-chip"
                aria-pressed={rules.includes(id)}
                disabled={atRuleCap && !rules.includes(id)}
                title={ruleDisplayLabel(id, rulesetId) ?? id}
                onClick={() => setRules(toggleRule(rules, id))}
              >
                {id}
              </button>
            ))}
          </div>
          <button type="button" className="rf-dd" aria-haspopup="dialog" onClick={() => setRulesOpen(true)}>
            <span className="rf-dl">
              All rules <em>· {ruleset.rules.length} in {ruleset.label}</em>
            </span>
            {rules.length ? <span className="rf-cnt">{rules.length} selected</span> : null}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </section>

        <details className="rf-note">
          <summary>
            <span>Add a note</span>
            <span className="rf-tag">Optional</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </summary>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={500}
            aria-label="What did you see?"
            placeholder="Helped another team reset their field. / Touched the robot during the match."
            className="rf-input rf-text"
          />
        </details>

        {/* Counts only for Minor and Major (the server stores false for
            anything else). Shown once a rule is picked because every kind that
            can use it requires one. */}
        {rules.length ? (
          <label className="rf-row">
            <span>
              Match affecting<small>Minor and Major only</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="rf-sw"
              checked={matchAffecting}
              onChange={(e) => setMatchAffecting(e.target.checked)}
            />
          </label>
        ) : null}

        {/* Repeated-violation warning. Display only -- never selects
            or creates anything. The Head Referee reads this and
            still chooses Minor or Major themselves. One line per
            cited rule that this team already has a record for, in
            this ruleset. */}
        {team && repeatedRules.length ? (
          <div className="rf-caution" role="note">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3.5l9.5 16.5h-19L12 3.5zM12 10v4.5M12 17.2v.01" />
            </svg>
            <div>
              {repeatedRules.map(({ rule, sameRule, sameMatchSameRule }) => (
                <p key={rule}>
                  <b>Repeated.</b> {team.number} had {rule} in{" "}
                  {sameRule
                    .map(
                      (f) =>
                        `${matchReference(f.match_type, f.match_number) ?? "—"} (${kindOf(f.kind, state.flagKinds)?.short ?? f.kind})`,
                    )
                    .join(", ")}
                  .
                  {sameMatchSameRule.length && matchReference(matchType, matchNumber) ? (
                    <>
                      {" "}
                      <b>
                        {rule} already recorded {sameMatchSameRule.length}{" "}
                        {sameMatchSameRule.length === 1 ? "time" : "times"} in this match (
                        {matchReference(matchType, matchNumber)}).
                      </b>
                    </>
                  ) : null}
                </p>
              ))}
              {escalationReviewRequired ? (
                <p>Repeated Minor Violations may require escalation review by the Head Referee.</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {team && eventTotalsForTeam.size ? (
          <p className="rf-hist">
            Event violation history for {team.number}:{" "}
            {[...eventTotalsForTeam.entries()]
              .map(([id, count]) => `${kindOf(id, state.flagKinds)?.short ?? id} ×${count}`)
              .join(", ")}
          </p>
        ) : null}

        {/* One button per kind, picked here and recorded by the bar below. */}
        <SeverityButtons kinds={kinds} value={kindId} onChange={setKindId} escalateId={escalateId} />

        {team && flagsFor(team.id).length ? (
          <section>
            <h2 className="rf-h2">Already on {team.number}</h2>
            <FlagList
              flags={flagsFor(team.id)}
              kinds={state.flagKinds}
              fieldCount={fieldCount}
              onEdit={correctFlag}
            />
          </section>
        ) : null}

        <section id="today">
          <h2 className="rf-h2">Flagged today</h2>
          {!flagged.length ? (
            <p className="rf-empty">Nothing flagged yet.</p>
          ) : (
            <ul className="space-y-2">
              {flagged.map(({ team: t, flags }) => (
                <li key={t.id} className="rounded-xl bg-surface px-4 py-3 ring-1 ring-inset ring-line">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <button
                      onClick={() => {
                        setNumber(t.number);
                        bodyRef.current?.scrollTo({ top: 0 });
                      }}
                      className="text-lg font-bold tabular-nums hover:text-accent"
                    >
                      {t.number}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-subtle">{t.name}</span>
                    <FlagSummary flags={flags} kinds={state.flagKinds} />
                  </div>
                  <div className="mt-3">
                    <FlagList flags={flags} kinds={state.flagKinds} fieldCount={fieldCount} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {/* Pinned above the tabs: the one button that saves, and one line saying
          what it is waiting for. */}
      <div className="rf-abar">
        {error ? (
          <p className="rf-need rf-need--error" role="alert">
            {error}
          </p>
        ) : blocker ? (
          <p className="rf-need" id="rf-need" role="status">
            {blocker}
          </p>
        ) : null}
        <button
          type="button"
          className={`rf-prim ${kind ? toneSolid(kind.color) : "rf-prim--idle"}`}
          disabled={busy || Boolean(blocker)}
          aria-describedby={blocker ? "rf-need" : undefined}
          onClick={record}
        >
          {busy ? "Recording…" : recordLabel(kind, team)}
        </button>
      </div>

      <MatchSheet
        open={sheetOpen}
        rulesetId={rulesetId}
        fieldCount={fieldCount}
        value={match}
        onUse={(next) => {
          setMatch(next);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
      />
      <AllRulesPicker
        open={rulesOpen}
        rulesetId={rulesetId}
        value={rules}
        onChange={setRules}
        onClose={() => setRulesOpen(false)}
      />
      {dialog}
    </RefereeFrame>
  );
}
