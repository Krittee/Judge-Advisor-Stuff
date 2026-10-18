"use client";

import { useState } from "react";
import type { AppState, FlagRow } from "@/lib/types";
import { tone, toneSolid } from "@/lib/tone";
import { fieldLabel, matchReference } from "@/lib/match";
import { findMatchType, getRuleset, parseRuleList, ruleDisplayLabel } from "@/lib/rules";
import {
  MATCH_AFFECTING_KINDS,
  MAX_FIELD_COUNT,
  type Alliance,
  type FlagReport,
} from "@/lib/flagValidation";
import { AllianceToggle, MatchFields, type MatchDraft } from "@/components/MatchFields";
import { AllRulesPicker } from "@/components/AllRulesPicker";

export type FlagKind = AppState["flagKinds"][number];

export function kindOf(id: string, kinds: FlagKind[]): FlagKind | null {
  return kinds.find((k) => k.id === id) ?? null;
}

/** The flags recorded on one calendar day, in the referee device's own
 *  timezone. The event has no date setting to read "today" from, so the
 *  device clock is the source: the referee is standing in the room the
 *  flags describe. Older flags stay on record; they just are not today's. */
export function flagsOnDay(flags: FlagRow[], day: Date): FlagRow[] {
  return flags.filter((f) => {
    const at = new Date(f.created_at);
    return (
      at.getFullYear() === day.getFullYear() &&
      at.getMonth() === day.getMonth() &&
      at.getDate() === day.getDate()
    );
  });
}

/** Only Minor and Major can be match affecting (the server stores false for
 *  anything else), but a severity button saves the report the moment it is
 *  tapped, so there is no chosen severity to key off. Callers show this once
 *  a rule is picked -- every kind that can use it requires one. */
export function MatchAffectingCheck({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-5 w-5 shrink-0 accent-[var(--accent)]"
      />
      <span>
        Match affecting <span className="text-ink-faint">(Minor / Major)</span>
      </span>
    </label>
  );
}

/** The worst thing said about a team, for a one-glance summary. */
export function worstFlag(flags: FlagRow[], kinds: FlagKind[]): FlagKind | null {
  let worst: FlagKind | null = null;
  for (const flag of flags) {
    const kind = kindOf(flag.kind, kinds);
    if (kind && (!worst || kind.severity > worst.severity)) worst = kind;
  }
  return worst;
}

const ALLIANCE_MARK = {
  red: { name: "Red", dot: "bg-[var(--alliance-red)]" },
  blue: { name: "Blue", dot: "bg-[var(--alliance-blue)]" },
} as const;

/** Which side of the field: a small coloured dot and its name. The name is
 *  always there, so colour never carries it alone. Nothing for a Skills run
 *  or a flag recorded before alliances existed. */
function AllianceMark({ alliance }: { alliance: FlagRow["alliance"] }) {
  if (!alliance) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${ALLIANCE_MARK[alliance].dot}`} />
      {ALLIANCE_MARK[alliance].name}
    </span>
  );
}

function FlagChip({
  kind,
  kinds,
  size = "sm",
  count,
}: {
  kind: string;
  kinds: FlagKind[];
  size?: "xs" | "sm";
  /** Shown as "Major x2" when a team has several of one kind. */
  count?: number;
}) {
  const found = kindOf(kind, kinds);
  if (!found) return null;
  const pad = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]";
  return (
    <span
      title={found.label}
      className={`inline-block whitespace-nowrap rounded-full font-medium ring-1 ring-inset ${pad} ${
        tone(found.color)
      }`}
    >
      {found.short}
      {count && count > 1 ? ` ×${count}` : ""}
    </span>
  );
}

/** One line per kind a team has been flagged with, worst first. */
export function FlagSummary({
  flags,
  kinds,
  size = "sm",
}: {
  flags: FlagRow[];
  kinds: FlagKind[];
  size?: "xs" | "sm";
}) {
  if (!flags.length) return null;

  const counts = new Map<string, number>();
  for (const f of flags) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);

  const ordered = [...counts.entries()]
    .map(([id, count]) => ({ kind: kindOf(id, kinds), count }))
    .filter((x): x is { kind: FlagKind; count: number } => x.kind !== null)
    .sort((a, b) => b.kind.severity - a.kind.severity);

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {ordered.map(({ kind, count }) => (
        <FlagChip key={kind.id} kind={kind.id} kinds={kinds} size={size} count={count} />
      ))}
    </span>
  );
}

/** The full record, in the referee's own words. */
export function FlagList({
  flags,
  kinds,
  fieldCount = MAX_FIELD_COUNT,
  onRemove,
  onEdit,
}: {
  flags: FlagRow[];
  kinds: FlagKind[];
  /** How many fields the event has, for the correction form's field choices. */
  fieldCount?: number;
  /** Only the Judge Advisor passes this. */
  onRemove?: (id: string) => void;
  /**
   * A referee re-selecting the wrong severity, or fixing a mis-typed
   * match number, is not the same act as making the flag disappear — so
   * this is offered wherever raising a flag is, not only where removing
   * one is.
   */
  onEdit?: (id: string, edit: FlagReport) => Promise<void>;
}) {
  if (!flags.length) {
    return <p className="text-sm text-ink-faint">Nothing flagged by a referee.</p>;
  }
  return (
    <ul className="space-y-2">
      {flags.map((f) => (
        <FlagListItem
          key={f.id}
          flag={f}
          kinds={kinds}
          fieldCount={fieldCount}
          onRemove={onRemove}
          onEdit={onEdit}
        />
      ))}
    </ul>
  );
}

/** What a correction starts from: the match the flag was recorded against. */
function matchOf(f: FlagRow): MatchDraft {
  return { matchType: f.match_type ?? "", matchNumber: f.match_number ?? "", field: f.field ?? "" };
}

/**
 * Whether a correction still has to pick an alliance. Every Teamwork match
 * needs one, except that a flag recorded before alliances existed has none to
 * give back, and the server accepts leaving it so while the match type stays.
 * A Skills run has no alliance at all.
 */
export function correctionNeedsAlliance(
  flag: Pick<FlagRow, "match_type" | "alliance" | "ruleset">,
  matchType: string,
  alliance: Alliance | null,
): boolean {
  if (findMatchType(matchType, flag.ruleset)?.group === "skills" || alliance) return false;
  return !(flag.alliance === null && flag.match_type === matchType);
}

function FlagListItem({
  flag: f,
  kinds,
  fieldCount,
  onRemove,
  onEdit,
}: {
  flag: FlagRow;
  kinds: FlagKind[];
  fieldCount: number;
  onRemove?: (id: string) => void;
  onEdit?: (id: string, edit: FlagReport) => Promise<void>;
}) {
  const ruleIds = parseRuleList(f.rule);
  // A flag keeps the ruleset it was recorded under: a correction cannot move it.
  const ruleset = getRuleset(f.ruleset);
  const field = fieldLabel(f.field);
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState(f.body);
  const [draftMatch, setDraftMatch] = useState(matchOf(f));
  const [draftAlliance, setDraftAlliance] = useState<Alliance | null>(f.alliance);
  const [draftRules, setDraftRules] = useState<string[]>(parseRuleList(f.rule));
  const [draftMatchAffecting, setDraftMatchAffecting] = useState(f.match_affecting);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Skills runs have no alliance: the toggle is for every other match.
  const skills = findMatchType(draftMatch.matchType, ruleset.id)?.group === "skills";
  const needsAlliance = correctionNeedsAlliance(f, draftMatch.matchType, draftAlliance);

  function startEditing() {
    setDraftBody(f.body);
    setDraftMatch(matchOf(f));
    setDraftAlliance(f.alliance);
    setDraftRules(parseRuleList(f.rule));
    setDraftMatchAffecting(f.match_affecting);
    setError(null);
    setEditing(true);
  }

  // Tapping a severity button submits the whole correction, the same way
  // it does when a flag is first raised — a referee re-selecting "Minor"
  // instead of "Major" is doing exactly the gesture they did the first
  // time, not filling in a separate form. The match, field and rules are
  // picked the same way too, so a correction can only produce a value the
  // raise form could have produced. What the flag already holds (an "HS2"
  // field, a missing alliance) is sent back as it is.
  async function save(kind: string) {
    if (!onEdit) return;
    setBusy(true);
    setError(null);
    try {
      await onEdit(f.id, {
        kind,
        body: draftBody,
        matchType: draftMatch.matchType,
        matchNumber: draftMatch.matchNumber,
        field: draftMatch.field,
        alliance: skills ? "" : (draftAlliance ?? ""),
        ruleset: ruleset.id,
        rules: draftRules,
        matchAffecting: draftMatchAffecting,
      });
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl bg-surface p-3 ring-1 ring-inset ring-line">
      <div className="flex flex-wrap items-center gap-2">
        <FlagChip kind={f.kind} kinds={kinds} />
        <span className="text-xs text-ink-faint">
          {f.author} · {new Date(f.created_at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        {/* The match reference: what makes this traceable back to a
            moment on the field, not just a comment. */}
        {matchReference(f.match_type, f.match_number) ? (
          <span
            title="Match · Alliance · Field"
            className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-ink-subtle"
          >
            {matchReference(f.match_type, f.match_number)}
            {f.alliance ? (
              <>
                {" · "}
                <AllianceMark alliance={f.alliance} />
              </>
            ) : null}
            {field ? ` · ${field}` : ""}
          </span>
        ) : null}
        {f.match_affecting ? (
          <span
            title="Marked as affecting the match"
            className="rounded-md bg-caution/18 px-1.5 py-0.5 text-[11px] font-medium text-caution-quiet ring-1 ring-inset ring-caution/40"
          >
            Match affecting
          </span>
        ) : null}
        <span className="ml-auto flex items-center">
          {onEdit ? (
            <button
              type="button"
              onClick={() => (editing ? setEditing(false) : startEditing())}
              className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-xs text-ink-faint hover:text-accent"
            >
              {editing ? "cancel" : "edit"}
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(f.id)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-xs text-ink-faint hover:text-danger-quiet"
            >
              remove
            </button>
          ) : null}
        </span>
      </div>

      {/* Which rules this was against, when there are any -- never shown for
          Good Conduct, an optional-rule Warning, or a flag recorded before
          this existed (f.rule is null in each, so nothing renders). Under
          the header row rather than in it: V5RC titles are whole sentences. */}
      {ruleIds.length ? (
        <div title="Rules violated" className="mt-1.5 space-y-1">
          <p className="text-[11px] text-ink-faint">
            {ruleset.label}
            {f.manual_version ? ` · v${f.manual_version}` : ""}
          </p>
          <ul className="space-y-1">
            {ruleIds.map((id) => (
              <li key={id} className="break-words text-xs font-medium text-accent-quiet">
                {ruleDisplayLabel(id, f.ruleset) ?? id}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {editing ? (
        <div className="mt-2 space-y-3 rounded-lg bg-sunken/60 p-3 ring-1 ring-inset ring-line">
          {error ? <p className="text-xs text-danger-quiet">{error}</p> : null}
          {/* One native switch for the whole group while a save is in flight. */}
          <fieldset disabled={busy} className="min-w-0 space-y-3">
            <MatchFields
              rulesetId={ruleset.id}
              fieldCount={fieldCount}
              value={draftMatch}
              onChange={setDraftMatch}
              idPrefix={`edit-${f.id}`}
              legacy={{ matchType: f.match_type, field: f.field }}
            />
            {skills ? null : (
              <AllianceToggle value={draftAlliance} onChange={setDraftAlliance} idPrefix={`edit-${f.id}-alliance`} />
            )}
          </fieldset>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Note</span>
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={2}
              maxLength={500}
              disabled={busy}
              className="w-full rounded-lg bg-surface px-3 py-2 text-sm ring-1 ring-inset ring-line disabled:opacity-50"
            />
          </label>
          <div>
            <span className="mb-1.5 block text-sm font-medium text-ink">Rules violated</span>
            {draftRules.length ? (
              <ul className="mb-2 flex flex-wrap gap-1.5">
                {draftRules.map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => setDraftRules(draftRules.filter((r) => r !== id))}
                      disabled={busy}
                      aria-label={`Remove ${id}`}
                      title={ruleDisplayLabel(id, ruleset.id) ?? id}
                      className="inline-flex min-h-11 items-center rounded-full bg-accent/12 px-4 text-sm font-semibold text-accent-quiet ring-1 ring-inset ring-accent/40 hover:bg-accent/20 disabled:opacity-50"
                    >
                      {`${id} ×`}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              onClick={() => setRulesOpen(true)}
              disabled={busy}
              aria-haspopup="dialog"
              className="flex h-12 w-full items-center gap-2 rounded-xl border-[1.5px] border-ink-faint bg-sunken px-3.5 text-left text-[15px] font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
            >
              <span className="min-w-0 flex-1 truncate">
                All rules <span className="text-sm font-normal text-ink-subtle">{`· ${ruleset.rules.length} in ${ruleset.label}`}</span>
              </span>
              {draftRules.length ? (
                <span className="shrink-0 rounded-full bg-accent/25 px-2.5 py-0.5 text-xs">{`${draftRules.length} selected`}</span>
              ) : null}
            </button>
            <AllRulesPicker
              open={rulesOpen}
              rulesetId={ruleset.id}
              value={draftRules}
              onChange={setDraftRules}
              onClose={() => setRulesOpen(false)}
            />
          </div>
          {draftRules.length || MATCH_AFFECTING_KINDS.includes(f.kind) ? (
            <MatchAffectingCheck
              checked={draftMatchAffecting}
              onChange={setDraftMatchAffecting}
              disabled={busy}
            />
          ) : null}
          {needsAlliance ? <p className="text-sm text-ink-subtle">Pick the alliance to save.</p> : null}
          <div className="flex flex-wrap gap-2">
            {kinds.map((k) => {
              // Minor and Major need a rule, except a legacy flag that has
              // none may be corrected in its own kind -- the same allowance
              // the server makes.
              const legacyKeep = k.id === f.kind && !ruleIds.length;
              return (
                <button
                  key={k.id}
                  type="button"
                  disabled={busy || needsAlliance || (k.requiresRule && !draftRules.length && !legacyKeep)}
                  onClick={() => save(k.id)}
                  className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    k.id === f.kind ? "ring-2 ring-ink/60" : ""
                  } ${toneSolid(k.color)}`}
                  title={k.id === f.kind ? "Currently set to this" : undefined}
                >
                  {k.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : f.body ? (
        <p className="mt-1.5 text-sm text-ink">{f.body}</p>
      ) : null}
    </li>
  );
}
