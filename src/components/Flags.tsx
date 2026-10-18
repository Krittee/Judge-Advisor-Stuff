"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AppState, FlagRow } from "@/lib/types";
import { tone, toneSolid } from "@/lib/tone";
import { fieldLabel, filterMatchNumberInput, matchReference } from "@/lib/match";
import {
  commonFieldRules,
  DEFAULT_OPEN_RULE_CATEGORIES,
  findMatchType,
  getRuleset,
  groupRulesByCategory,
  isBracketMatch,
  isCategoryOpen,
  manualLabel,
  MAX_FLAG_RULES,
  parseRuleList,
  RULESETS,
  ruleDisplayLabel,
  searchRules,
  toggleRule,
  type Rule,
} from "@/lib/rules";
import {
  FIELD_PREFIXES,
  isValidFieldPick,
  MATCH_AFFECTING_KINDS,
  MAX_FIELD_COUNT,
  type FlagReport,
} from "@/lib/flagValidation";
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
 *  ("ES" + "2" is "ES2"). Only the old raise form still uses it: a field is
 *  now just a number, and the server refuses a prefixed one on a new flag. */
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

/** The ruleset dropdown, with the manual edition under it. Shared by the
 *  raise form and the correction form. The caller owns the value and clears
 *  its chosen rules when it changes: a rule id means nothing outside the
 *  ruleset it was picked from. */
export function RulesetPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (rulesetId: string) => void;
  disabled?: boolean;
}) {
  const ruleset = getRuleset(value);
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-ink-subtle">Ruleset</span>
      <select
        value={ruleset.id}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`${inputClass} py-2`}
      >
        {RULESETS.map((r) => (
          <option key={r.id} value={r.id} className="bg-surface">
            {r.label}
          </option>
        ))}
      </select>
      {/* Only when the data records an edition: for IQ it would just repeat
          the dropdown. */}
      {ruleset.manualVersion ? (
        <span className="mt-1 block text-xs text-ink-faint">{manualLabel(ruleset)}</span>
      ) : null}
    </label>
  );
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

/** One tappable rule: the code, an em dash, the manual's own title. */
function RuleRow({
  rule,
  selected,
  locked,
  onToggle,
}: {
  rule: Rule;
  selected: boolean;
  /** At the cap: unselected rows cannot be added until one is removed. */
  locked: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(rule.id)}
      aria-pressed={selected}
      disabled={locked && !selected}
      className={`flex min-h-11 w-full items-start gap-3 px-4 py-2.5 text-left text-sm text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 ${
        selected ? "bg-accent/10" : ""
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${
          selected ? "border-accent bg-accent text-accent-ink" : "border-line-strong"
        }`}
      >
        {selected ? "✓" : ""}
      </span>
      <span className="min-w-0 break-words">
        <span className="font-semibold text-accent-quiet">{rule.displayId}</span> — {rule.officialTitle}
      </span>
    </button>
  );
}

/** The one searchable, multi-select rule picker for a ruleset, shared by the
 *  raise form and the correction form. Owns only its own open, search and
 *  section state: the chosen rules belong to the caller. Selected rules sit
 *  above as removable chips; Common Field Rules appear as a shortcut section
 *  while the search box is empty -- the same Rule objects as the grouped
 *  list, never a duplicate copy. Categories collapse (the three a referee
 *  uses most start open) but all open while a search is typed, so a hit is
 *  never hidden inside a closed section. */
export function RulePicker(props: {
  rulesetId: string;
  value: string[];
  onChange: (rules: string[]) => void;
  disabled?: boolean;
  /** Open on first paint instead of waiting for a tap. */
  startOpen?: boolean;
}) {
  // Keyed on the ruleset so switching it starts the picker clean -- no stale
  // search text or open sections from the other manual.
  return <RulePickerBody key={getRuleset(props.rulesetId).id} {...props} />;
}

function RulePickerBody({
  rulesetId,
  value,
  onChange,
  disabled,
  startOpen = false,
}: {
  rulesetId: string;
  value: string[];
  onChange: (rules: string[]) => void;
  disabled?: boolean;
  startOpen?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(startOpen);
  const [openCategories, setOpenCategories] = useState(() => new Set(DEFAULT_OPEN_RULE_CATEGORIES));
  const boxRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    setQuery("");
  }

  // Close on an outside pointer press. Option buttons use ordinary click
  // events so touch, mouse and keyboard activation all work.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const searching = query.trim() !== "";
  const commonRules = useMemo(() => commonFieldRules(rulesetId), [rulesetId]);
  const groups = useMemo(
    () => groupRulesByCategory(searchRules(query, rulesetId)),
    [query, rulesetId],
  );

  const atCap = value.length >= MAX_FLAG_RULES;

  function toggle(id: string) {
    onChange(toggleRule(value, id));
  }

  function toggleCategory(category: string) {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (!next.delete(category)) next.add(category);
      return next;
    });
  }

  return (
    <div ref={boxRef} className="relative block">
      {value.length ? (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => toggle(id)}
                disabled={disabled}
                aria-label={`Remove ${id}`}
                title={ruleDisplayLabel(id, rulesetId) ?? id}
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
        onClick={() => (open ? close() : setOpen(true))}
        disabled={disabled}
        aria-expanded={open}
        className={`${inputClass} flex min-h-11 items-center justify-between py-2 text-left`}
      >
        <span className={`min-w-0 break-words ${value.length ? "" : "text-ink-faint"}`}>
          {value.length ? "Add or change rules" : "— select/search rules —"}
        </span>
        <span aria-hidden className="shrink-0 text-ink-faint">
          ▾
        </span>
      </button>

      {open ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl bg-surface shadow-xl ring-1 ring-inset ring-line">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search: SG6, holding, autonomous…"
            autoComplete="off"
            className="w-full border-b border-line bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <div className="max-h-[min(20rem,50vh)] overflow-y-auto py-1">
            {!searching && commonRules.length ? (
              <div>
                <p className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-ink-faint">
                  COMMON FIELD RULES
                </p>
                {commonRules.map((r) => (
                  <RuleRow
                    key={`common-${r.id}`}
                    rule={r}
                    selected={value.includes(r.id)}
                    locked={atCap}
                    onToggle={toggle}
                  />
                ))}
              </div>
            ) : null}

            {groups.length ? (
              groups.map(({ category, rules }) => {
                const expanded = isCategoryOpen(category, query, openCategories);
                const chosen = rules.filter((r) => value.includes(r.id)).length;
                return (
                  <section key={category}>
                    {searching ? (
                      <p className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-ink-faint">
                        {category.toUpperCase()}
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleCategory(category)}
                        aria-expanded={expanded}
                        className="flex min-h-11 w-full items-center justify-between gap-2 px-4 text-left text-[11px] font-semibold tracking-wide text-ink-subtle hover:bg-surface-2"
                      >
                        <span className="min-w-0 break-words">
                          {category.toUpperCase()}{" "}
                          <span className="font-normal text-ink-faint">
                            ({rules.length}
                            {chosen ? ` · ${chosen} selected` : ""})
                          </span>
                        </span>
                        <span aria-hidden className="shrink-0 text-ink-faint">
                          {expanded ? "▾" : "▸"}
                        </span>
                      </button>
                    )}
                    {expanded
                      ? rules.map((r) => (
                          <RuleRow
                            key={r.id}
                            rule={r}
                            selected={value.includes(r.id)}
                            locked={atCap}
                            onToggle={toggle}
                          />
                        ))
                      : null}
                  </section>
                );
              })
            ) : (
              <p className="px-4 py-3 text-sm text-ink-faint">No rule matches that.</p>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-1">
            <span className="text-xs text-ink-faint">
              {value.length} of {MAX_FLAG_RULES} selected
            </span>
            <button
              type="button"
              onClick={close}
              className="min-h-11 px-3 text-sm font-semibold text-accent hover:text-accent-quiet"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const editSelect =
  "rounded-lg bg-surface px-2 py-1.5 text-xs ring-1 ring-inset ring-line disabled:opacity-50";

/** The worst thing said about a team, for a one-glance summary. */
export function worstFlag(flags: FlagRow[], kinds: FlagKind[]): FlagKind | null {
  let worst: FlagKind | null = null;
  for (const flag of flags) {
    const kind = kindOf(flag.kind, kinds);
    if (kind && (!worst || kind.severity > worst.severity)) worst = kind;
  }
  return worst;
}

/* Placeholders until the referee page defines the alliance colours. */
const ALLIANCE_DOT = { red: "oklch(0.620 0.190 25)", blue: "oklch(0.620 0.150 255)" } as const;
const ALLIANCE_NAME = { red: "Red", blue: "Blue" } as const;

/** Which side of the field: a small coloured dot and its name. The name is
 *  always there, so colour never carries it alone. Nothing for a Skills run
 *  or a flag recorded before alliances existed. */
function AllianceMark({ alliance }: { alliance: FlagRow["alliance"] }) {
  if (!alliance) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: ALLIANCE_DOT[alliance] }}
      />
      {ALLIANCE_NAME[alliance]}
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
  /** @deprecated Not read any more: a correction offers the match types of
   *  the flag's own ruleset. Kept so the callers compile until the referee
   *  page is rebuilt. */
  matchTypes?: MatchType[];
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
  const ruleset = getRuleset(f.ruleset);
  const field = fieldLabel(f.field);
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState(f.body);
  const [draftMatchType, setDraftMatchType] = useState(f.match_type ?? "");
  const [draftMatchNumber, setDraftMatchNumber] = useState(f.match_number ?? "");
  const [draftAlliance, setDraftAlliance] = useState<FlagReport["alliance"]>(f.alliance ?? "");
  const [draftField, setDraftField] = useState(f.field ?? "");
  const [draftRuleset, setDraftRuleset] = useState(getRuleset(f.ruleset).id);
  const [draftRules, setDraftRules] = useState<string[]>(parseRuleList(f.rule));
  const [draftMatchAffecting, setDraftMatchAffecting] = useState(f.match_affecting);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftBracket = isBracketMatch(draftMatchType, draftRuleset);
  // Held by this flag but no longer offered by its program: the legacy "SK".
  const legacyType =
    f.match_type && !getRuleset(draftRuleset).matchTypes.some((t) => t.id === f.match_type)
      ? findMatchType(f.match_type, draftRuleset)
      : null;

  function startEditing() {
    setDraftBody(f.body);
    setDraftMatchType(f.match_type ?? "");
    setDraftMatchNumber(f.match_number ?? "");
    setDraftAlliance(f.alliance ?? "");
    setDraftField(f.field ?? "");
    setDraftRuleset(getRuleset(f.ruleset).id);
    setDraftRules(parseRuleList(f.rule));
    setDraftMatchAffecting(f.match_affecting);
    setError(null);
    setEditing(true);
  }

  // A match type, and the shape of its number, belong to a program: Q23 is
  // not a bracket and QF 2-1 is not a plain number. Changing the type (or the
  // ruleset under it) therefore drops a number that no longer fits, and a type
  // the ruleset does not know.
  function chooseMatch(type: string, rulesetId: string) {
    const known = findMatchType(type, rulesetId) ? type : "";
    if (!known || isBracketMatch(known, rulesetId) !== isBracketMatch(draftMatchType, draftRuleset)) {
      setDraftMatchNumber("");
    }
    setDraftMatchType(known);
  }

  // Tapping a severity button submits the whole correction, the same way
  // it does when a flag is first raised — a referee re-selecting "Minor"
  // instead of "Major" is doing exactly the gesture they did the first
  // time, not filling in a separate form. The field, ruleset and rules are
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
        matchType: draftMatchType,
        matchNumber: draftMatchNumber,
        alliance: draftAlliance,
        field: draftField,
        ruleset: draftRuleset,
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
        <div className="mt-2 space-y-2 rounded-lg bg-sunken/60 p-2.5 ring-1 ring-inset ring-line">
          {error ? <p className="text-xs text-danger-quiet">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <select
              value={draftMatchType}
              onChange={(e) => chooseMatch(e.target.value, draftRuleset)}
              disabled={busy}
              aria-label="Match type"
              className={`min-w-[9rem] flex-[2] ${editSelect}`}
            >
              <option value="" className="bg-surface">
                — match —
              </option>
              {(["teamwork", "skills"] as const).map((group) => (
                <optgroup key={group} label={group === "teamwork" ? "Teamwork" : "Skills"}>
                  {getRuleset(draftRuleset)
                    .matchTypes.filter((t) => t.group === group)
                    .map((t) => (
                      <option key={t.id} value={t.id} className="bg-surface">
                        {t.id} — {t.label}
                      </option>
                    ))}
                </optgroup>
              ))}
              {/* A type the program no longer offers (the old "SK") stays
                  selectable on the flag that holds it. */}
              {legacyType ? (
                <option value={legacyType.id} className="bg-surface">
                  {legacyType.id} — {legacyType.label} (old)
                </option>
              ) : null}
            </select>
            <input
              value={draftMatchNumber}
              onChange={(e) =>
                setDraftMatchNumber(filterMatchNumberInput(e.target.value, draftMatchType, draftRuleset))
              }
              placeholder={draftBracket ? "2-1" : "#"}
              inputMode={draftBracket ? "text" : "numeric"}
              aria-label={draftBracket ? "Bracket and match" : "Match number"}
              disabled={busy}
              className="min-w-[3.5rem] flex-1 rounded-lg bg-surface px-2 py-1.5 text-center text-xs ring-1 ring-inset ring-line disabled:opacity-50"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Skills runs have no alliance. */}
            {findMatchType(draftMatchType, draftRuleset)?.group === "teamwork" ? (
              <select
                value={draftAlliance}
                onChange={(e) => setDraftAlliance(e.target.value as FlagReport["alliance"])}
                disabled={busy}
                aria-label="Alliance"
                className={`min-w-[7rem] flex-1 ${editSelect}`}
              >
                <option value="" className="bg-surface">
                  — alliance —
                </option>
                <option value="red" className="bg-surface">
                  Red
                </option>
                <option value="blue" className="bg-surface">
                  Blue
                </option>
              </select>
            ) : null}
            <select
              value={draftField}
              onChange={(e) => setDraftField(e.target.value)}
              disabled={busy}
              aria-label="Field"
              className={`min-w-[7rem] flex-1 ${editSelect}`}
            >
              <option value="" className="bg-surface">
                — field —
              </option>
              {Array.from({ length: fieldCount }, (_, i) => String(i + 1)).map((n) => (
                <option key={n} value={n} className="bg-surface">
                  Field {n}
                </option>
              ))}
              {/* An old prefixed field ("HS2") stays selectable on the flag that holds it. */}
              {f.field && !isValidFieldPick(f.field, fieldCount) ? (
                <option value={f.field} className="bg-surface">
                  {f.field} (old)
                </option>
              ) : null}
            </select>
          </div>
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={2}
            maxLength={500}
            disabled={busy}
            className="w-full rounded-lg bg-surface px-2 py-1.5 text-xs ring-1 ring-inset ring-line disabled:opacity-50"
          />
          <RulesetPicker
            value={draftRuleset}
            onChange={(id) => {
              setDraftRuleset(id);
              setDraftRules([]);
              chooseMatch(draftMatchType, id);
            }}
            disabled={busy}
          />
          <div>
            <span className="mb-1 block text-xs text-ink-subtle">Rules violated</span>
            <RulePicker rulesetId={draftRuleset} value={draftRules} onChange={setDraftRules} disabled={busy} />
          </div>
          {draftRules.length || MATCH_AFFECTING_KINDS.includes(f.kind) ? (
            <MatchAffectingCheck
              checked={draftMatchAffecting}
              onChange={setDraftMatchAffecting}
              disabled={busy}
            />
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {kinds.map((k) => {
              // Minor and Major need a rule, except a legacy flag that has
              // none may be corrected in its own kind -- the same allowance
              // the server makes.
              const legacyKeep = k.id === f.kind && !ruleIds.length;
              return (
                <button
                  key={k.id}
                  disabled={busy || (k.requiresRule && !draftRules.length && !legacyKeep)}
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
