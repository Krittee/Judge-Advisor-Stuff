"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AppState, FlagRow } from "@/lib/types";
import { tone, toneSolid } from "@/lib/tone";
import type { FlagEdit } from "@/lib/db/types";
import { filterMatchNumberInput, matchReference, normalizeField } from "@/lib/match";
import { commonFieldRules, RULE_CATEGORIES, ruleDisplayLabel, searchRules, type Rule } from "@/lib/rules";
import { FIELD_PREFIXES, splitField } from "@/lib/flagValidation";
import { inputClass } from "@/components/ui";

export type FlagKind = AppState["flagKinds"][number];
export type MatchType = AppState["matchTypes"][number];

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

/** Division prefix and field number, as two boxes that make one field
 *  ("ES" + "2" is "ES2"). Used by the raise form and the correction form,
 *  so both offer the same choices. */
export function FieldPicker({
  prefix,
  number,
  onPrefix,
  onNumber,
  disabled,
}: {
  prefix: string;
  number: string;
  onPrefix: (prefix: string) => void;
  onNumber: (number: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <label className="min-w-[7rem] flex-1">
        <span className="mb-1 block text-xs text-ink-subtle">Field</span>
        <select
          value={prefix}
          onChange={(e) => onPrefix(e.target.value)}
          disabled={disabled}
          className={`${inputClass} py-2`}
        >
          <option value="" className="bg-surface">
            — division —
          </option>
          {FIELD_PREFIXES.map((p) => (
            <option key={p} value={p} className="bg-surface">
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-[4.5rem] flex-1">
        <span className="mb-1 block text-xs text-ink-subtle">Field #</span>
        <input
          value={number}
          onChange={(e) => onNumber(filterMatchNumberInput(e.target.value))}
          placeholder="1"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          className={`${inputClass} py-2 text-center`}
        />
      </label>
    </div>
  );
}

/** The one searchable rule selector, shared by the raise form and the
 *  correction form. Owns only its own open and search state: the chosen
 *  rule belongs to the caller. Common Field Rules appear as a shortcut
 *  section while the search box is empty -- the same Rule objects as the
 *  grouped list, never a duplicate copy. */
export function RulePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (rule: string | null) => void;
}) {
  const [ruleQuery, setRuleQuery] = useState("");
  const [ruleOpen, setRuleOpen] = useState(false);
  const ruleBoxRef = useRef<HTMLDivElement>(null);

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

  // The rule list, filtered by what's typed and grouped by category in
  // the Quick Reference's own order.
  const commonRules = useMemo(() => commonFieldRules(), []);
  const ruleMatches = useMemo(() => searchRules(ruleQuery), [ruleQuery]);
  const ruleGroups = useMemo(() => {
    const byCategory = new Map<string, Rule[]>();
    for (const r of ruleMatches) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
    return RULE_CATEGORIES.map((category) => ({ category, rules: byCategory.get(category) ?? [] })).filter(
      (g) => g.rules.length > 0,
    );
  }, [ruleMatches]);

  function choose(rule: string | null) {
    onChange(rule);
    setRuleOpen(false);
    setRuleQuery("");
  }

  return (
    <div ref={ruleBoxRef} className="relative block">
      <button
        type="button"
        onClick={() => setRuleOpen((o) => !o)}
        className={`${inputClass} flex items-center justify-between py-2 text-left`}
      >
        <span className={`min-w-0 break-words ${value ? "" : "text-ink-faint"}`}>
          {value ? ruleDisplayLabel(value) : "— select/search rule —"}
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
            {value ? (
              <button
                type="button"
                onClick={() => choose(null)}
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
                    onClick={() => choose(r.id)}
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
                      onClick={() => choose(r.id)}
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
  matchTypes = [],
  onRemove,
  onEdit,
}: {
  flags: FlagRow[];
  kinds: FlagKind[];
  /** Needed only if onEdit is passed — the picker's options. */
  matchTypes?: MatchType[];
  /** Only the Judge Advisor passes this. */
  onRemove?: (id: string) => void;
  /**
   * A referee re-selecting the wrong severity, or fixing a mis-typed
   * match number, is not the same act as making the flag disappear — so
   * this is offered wherever raising a flag is, not only where removing
   * one is.
   */
  onEdit?: (id: string, edit: FlagEdit) => Promise<void>;
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
          matchTypes={matchTypes}
          onRemove={onRemove}
          onEdit={onEdit}
        />
      ))}
    </ul>
  );
}

function FlagListItem({
  flag: f,
  kinds,
  matchTypes,
  onRemove,
  onEdit,
}: {
  flag: FlagRow;
  kinds: FlagKind[];
  matchTypes: MatchType[];
  onRemove?: (id: string) => void;
  onEdit?: (id: string, edit: FlagEdit) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState(f.body);
  const [draftMatchType, setDraftMatchType] = useState(f.match_type ?? "");
  const [draftMatchNumber, setDraftMatchNumber] = useState(f.match_number ?? "");
  const [draftFieldPrefix, setDraftFieldPrefix] = useState(splitField(f.field).prefix);
  const [draftFieldNumber, setDraftFieldNumber] = useState(splitField(f.field).number);
  const [draftRule, setDraftRule] = useState<string | null>(f.rule ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setDraftBody(f.body);
    setDraftMatchType(f.match_type ?? "");
    setDraftMatchNumber(f.match_number ?? "");
    const parts = splitField(f.field);
    setDraftFieldPrefix(parts.prefix);
    setDraftFieldNumber(parts.number);
    setDraftRule(f.rule ?? null);
    setError(null);
    setEditing(true);
  }

  // Tapping a severity button submits the whole correction, the same way
  // it does when a flag is first raised — a referee re-selecting "Minor"
  // instead of "Major" is doing exactly the gesture they did the first
  // time, not filling in a separate form. The field and rule are picked
  // the same way too, so a correction can only produce a value the raise
  // form could have produced.
  async function save(kind: string) {
    if (!onEdit) return;
    setBusy(true);
    setError(null);
    try {
      await onEdit(f.id, {
        kind,
        body: draftBody,
        matchType: draftMatchType,
        matchNumber: draftMatchNumber,
        field: normalizeField(`${draftFieldPrefix}${draftFieldNumber}`),
        rule: draftRule,
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
            title="Match · Field"
            className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-ink-subtle"
          >
            {matchReference(f.match_type, f.match_number)}
            {f.field ? ` · ${f.field}` : ""}
          </span>
        ) : null}
        {/* Which rule this was against, when there is one -- never shown
            for Good Conduct, an optional-rule Warning, or a flag recorded
            before this existed (f.rule is null either way, so there is
            nothing to tell apart here and nothing renders). */}
        {ruleDisplayLabel(f.rule) ? (
          <span
            title="Rule violated"
            className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-accent-quiet"
          >
            {ruleDisplayLabel(f.rule)}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-3">
          {onEdit ? (
            <button
              onClick={() => (editing ? setEditing(false) : startEditing())}
              className="text-xs text-ink-faint hover:text-accent"
            >
              {editing ? "cancel" : "edit"}
            </button>
          ) : null}
          {onRemove ? (
            <button
              onClick={() => onRemove(f.id)}
              className="text-xs text-ink-faint hover:text-danger-quiet"
            >
              remove
            </button>
          ) : null}
        </span>
      </div>

      {editing ? (
        <div className="mt-2 space-y-2 rounded-lg bg-sunken/60 p-2.5 ring-1 ring-inset ring-line">
          {error ? <p className="text-xs text-danger-quiet">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <select
              value={draftMatchType}
              onChange={(e) => setDraftMatchType(e.target.value)}
              disabled={busy}
              className="min-w-[9rem] flex-[2] rounded-lg bg-surface px-2 py-1.5 text-xs ring-1 ring-inset ring-line disabled:opacity-50"
            >
              <option value="" className="bg-surface">
                — match —
              </option>
              {matchTypes.map((t) => (
                <option key={t.id} value={t.id} className="bg-surface">
                  {t.id} — {t.label}
                </option>
              ))}
            </select>
            <input
              value={draftMatchNumber}
              onChange={(e) => setDraftMatchNumber(filterMatchNumberInput(e.target.value))}
              placeholder="#"
              inputMode="numeric"
              disabled={busy}
              className="min-w-[3.5rem] flex-1 rounded-lg bg-surface px-2 py-1.5 text-center text-xs ring-1 ring-inset ring-line disabled:opacity-50"
            />
          </div>
          <FieldPicker
            prefix={draftFieldPrefix}
            number={draftFieldNumber}
            onPrefix={setDraftFieldPrefix}
            onNumber={setDraftFieldNumber}
            disabled={busy}
          />
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={2}
            maxLength={500}
            disabled={busy}
            className="w-full rounded-lg bg-surface px-2 py-1.5 text-xs ring-1 ring-inset ring-line disabled:opacity-50"
          />
          <div>
            <span className="mb-1 block text-xs text-ink-subtle">Rule violated</span>
            <RulePicker value={draftRule} onChange={setDraftRule} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {kinds.map((k) => {
              // Minor and Major need a rule, except a legacy flag that has
              // none may be corrected in its own kind -- the same allowance
              // the server makes.
              const legacyKeep = k.id === f.kind && !f.rule;
              return (
                <button
                  key={k.id}
                  disabled={busy || (k.requiresRule && !draftRule && !legacyKeep)}
                  onClick={() => save(k.id)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
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
