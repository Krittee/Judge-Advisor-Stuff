"use client";

import { isValidFieldPick, type Alliance } from "@/lib/flagValidation";
import { filterMatchNumberInput, normalizeMatchNumber } from "@/lib/match";
import { matchTypes } from "@/lib/presets";
import { findMatchType, isBracketMatch, type MatchType } from "@/lib/rules";

/** The three things that name a match on the field. All strings, because they
 *  are what a referee is typing: validation happens when the flag is saved. */
export type MatchDraft = { matchType: string; matchNumber: string; field: string };

type Group = MatchType["group"];

const labelClass = "mb-1.5 block text-sm font-medium leading-snug text-ink";
const hintClass = "text-sm text-ink-subtle";
/* Controls are outlined in ink-faint rather than line: a hairline is too faint
   to find a button by (3:1 against its neighbour is the floor for a boundary). */
const outline = "border-[1.5px] border-ink-faint bg-sunken text-ink";
const chipOff = `${outline} hover:bg-surface-2`;
const chipOn = "border-[1.5px] border-accent bg-accent text-accent-ink";

/** A row of mutually exclusive buttons in one rounded track. */
function Segmented({
  options,
  value,
  onPick,
  ...aria
}: {
  options: { id: string; text: string; name?: string }[];
  value: string;
  onPick: (id: string) => void;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <div role="group" {...aria} className="flex gap-1 rounded-[14px] border-[1.5px] border-line bg-sunken p-1">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onPick(o.id)}
            aria-pressed={on}
            aria-label={o.name}
            className={`h-11 min-w-0 flex-1 rounded-[10px] px-1 font-display text-[15px] font-semibold ${
              on ? "bg-accent text-accent-ink" : "text-ink hover:bg-surface-2"
            }`}
          >
            {o.text}
          </button>
        );
      })}
    </div>
  );
}

/** − / number / + for a plain match or run number. */
function Stepper({
  id,
  label,
  value,
  onChange,
  matchType,
  rulesetId,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  matchType: string;
  rulesetId: string;
}) {
  const n = Number(value) || 0;
  // normalizeMatchNumber is what caps the length, so a +1 it would clip
  // (9999 -> 10000 -> 1000) is refused rather than wrapped round.
  const up = normalizeMatchNumber(String(n + 1), matchType, rulesetId);
  const step = `grid h-16 w-16 shrink-0 place-items-center rounded-[14px] ${chipOff} disabled:cursor-not-allowed disabled:opacity-40`;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange(String(n - 1))}
          disabled={n <= 1}
          aria-controls={id}
          aria-label={`Decrease ${label}`}
          className={step}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M5 12h14" />
          </svg>
        </button>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(filterMatchNumberInput(e.target.value, matchType, rulesetId))}
          inputMode="numeric"
          autoComplete="off"
          className={`h-16 min-w-0 flex-1 rounded-[14px] px-0 text-center font-display text-[40px] font-bold focus:border-accent ${outline}`}
        />
        <button
          type="button"
          onClick={() => onChange(up)}
          disabled={up !== String(n + 1)}
          aria-controls={id}
          aria-label={`Increase ${label}`}
          className={step}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M5 12h14M12 5v14" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/** A V5RC elimination number, "2-1": a bracket and a match in two boxes that
 *  compose one string. */
function BracketInputs({
  idPrefix,
  value,
  onChange,
  matchType,
  rulesetId,
}: {
  idPrefix: string;
  value: string;
  onChange: (next: string) => void;
  matchType: string;
  rulesetId: string;
}) {
  const [bracket = "", match = ""] = value.split("-");
  // Each box holds digits only; normalizeMatchNumber does the trimming.
  const part = (raw: string) => normalizeMatchNumber(raw, matchType, rulesetId).split("-")[0];
  const compose = (b: string, m: string) => (m ? `${b}-${m}` : b);
  const box = `h-14 w-full min-w-0 rounded-xl px-0 text-center font-display text-[28px] font-bold focus:border-accent ${outline}`;
  return (
    <div className="flex gap-2.5">
      <div className="min-w-0 flex-1">
        <label htmlFor={`${idPrefix}-bracket`} className={labelClass}>
          Bracket
        </label>
        <input
          id={`${idPrefix}-bracket`}
          value={bracket}
          onChange={(e) => onChange(compose(part(e.target.value), match))}
          inputMode="numeric"
          autoComplete="off"
          className={box}
        />
      </div>
      <div className="min-w-0 flex-1">
        <label htmlFor={`${idPrefix}-match`} className={labelClass}>
          Match
        </label>
        <input
          id={`${idPrefix}-match`}
          value={match}
          onChange={(e) => onChange(compose(bracket, part(e.target.value)))}
          inputMode="numeric"
          autoComplete="off"
          className={box}
        />
      </div>
    </div>
  );
}

/**
 * Which match this was and on which field: Teamwork or Skills, the type, its
 * number, and the field. Controlled (the caller owns the draft) so the same
 * control serves the "Set the match" sheet and a correction.
 */
export function MatchFields({
  rulesetId,
  fieldCount,
  value,
  onChange,
  idPrefix,
  legacy,
}: {
  /** The event's program (or, in a correction, the flag's own ruleset). */
  rulesetId: string;
  /** How many fields the event has: 1 to 20, from the event setup. */
  fieldCount: number;
  value: MatchDraft;
  onChange: (next: MatchDraft) => void;
  /** Unique per instance, for the label and input ids. */
  idPrefix: string;
  /** A correction may hold a value the program no longer offers (the old "SK",
   *  an "HS2" field, a field above fieldCount). It stays selectable, marked
   *  "(old)", so the flag can be corrected without losing it. */
  legacy?: { matchType?: string | null; field?: string | null };
}) {
  const offered = matchTypes(rulesetId);
  const held = legacy?.matchType ? findMatchType(legacy.matchType, rulesetId) : null;
  const oldType = held && !offered.some((t) => t.id === held.id) ? held : null;
  const typesOf = (g: Group) => [...offered, ...(oldType ? [oldType] : [])].filter((t) => t.group === g);
  const textOf = (t: MatchType) => (t.id === oldType?.id ? `${t.label} (old)` : t.label);

  const current = findMatchType(value.matchType, rulesetId);
  const group: Group = current?.group ?? "teamwork";
  const bracket = isBracketMatch(value.matchType, rulesetId);
  const set = (patch: Partial<MatchDraft>) => onChange({ ...value, ...patch });

  // A number belongs to the group it was typed for, so switching clears it.
  function pickGroup(next: Group) {
    const first = typesOf(next)[0];
    if (current?.group === next || !first) return;
    set({ matchType: first.id, matchNumber: "" });
  }

  // Q23 is a number and QF 2-1 is a bracket: a number whose shape no longer
  // fits the new type goes, one that still fits stays.
  function pickType(id: string) {
    if (id === value.matchType) return;
    const fits = isBracketMatch(id, rulesetId) === bracket;
    set({ matchType: id, matchNumber: fits ? value.matchNumber : "" });
  }

  const oldField = legacy?.field && !isValidFieldPick(legacy.field, fieldCount) ? legacy.field : null;
  const fields = Array.from({ length: fieldCount }, (_, i) => String(i + 1));
  const fieldClass = (on: boolean) => `h-12 rounded-xl font-display text-[17px] font-semibold ${on ? chipOn : chipOff}`;

  return (
    <div className="space-y-3">
      <Segmented
        aria-label="Match group"
        value={group}
        onPick={(id) => pickGroup(id as Group)}
        options={[
          { id: "teamwork", text: "Teamwork" },
          { id: "skills", text: "Skills" },
        ]}
      />

      {group === "teamwork" ? (
        <>
          <div>
            <div id={`${idPrefix}-type-l`} className={labelClass}>
              Match type
            </div>
            <Segmented
              aria-labelledby={`${idPrefix}-type-l`}
              value={value.matchType}
              onPick={pickType}
              options={typesOf("teamwork").map((t) => ({
                id: t.id,
                text: t.id === oldType?.id ? `${t.id} (old)` : t.id,
                name: `${t.label} (${t.id})`,
              }))}
            />
          </div>
          {bracket ? (
            <BracketInputs
              idPrefix={idPrefix}
              value={value.matchNumber}
              onChange={(matchNumber) => set({ matchNumber })}
              matchType={value.matchType}
              rulesetId={rulesetId}
            />
          ) : (
            <Stepper
              id={`${idPrefix}-number`}
              label="Match number"
              value={value.matchNumber}
              onChange={(matchNumber) => set({ matchNumber })}
              matchType={value.matchType}
              rulesetId={rulesetId}
            />
          )}
        </>
      ) : (
        <>
          <div>
            <div id={`${idPrefix}-run-l`} className={labelClass}>
              Skills run
            </div>
            <Segmented
              aria-labelledby={`${idPrefix}-run-l`}
              value={value.matchType}
              onPick={pickType}
              options={typesOf("skills").map((t) => ({ id: t.id, text: textOf(t) }))}
            />
          </div>
          <Stepper
            id={`${idPrefix}-number`}
            label="Run #"
            value={value.matchNumber}
            onChange={(matchNumber) => set({ matchNumber })}
            matchType={value.matchType}
            rulesetId={rulesetId}
          />
          <p className={`${hintClass} text-center`}>Skills runs have no alliance.</p>
        </>
      )}

      <div role="group" aria-labelledby={`${idPrefix}-field-l`}>
        <div id={`${idPrefix}-field-l`} className={labelClass}>
          Field
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {fields.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => set({ field: n })}
              aria-pressed={value.field === n}
              className={`w-12 ${fieldClass(value.field === n)}`}
            >
              {n}
            </button>
          ))}
          {/* A field the event does not offer (an old "HS2", or one above the
              count) stays selectable on the flag that holds it. */}
          {oldField ? (
            <button
              type="button"
              onClick={() => set({ field: oldField })}
              aria-pressed={value.field === oldField}
              className={`min-w-12 px-3 ${fieldClass(value.field === oldField)}`}
            >
              {`${oldField} (old)`}
            </button>
          ) : null}
          <p className={`${hintClass} basis-full`}>
            {`${fieldCount} ${fieldCount === 1 ? "field" : "fields"} · set in event setup`}
          </p>
        </div>
      </div>
    </div>
  );
}

const ALLIANCE = {
  red: {
    name: "Red",
    dot: "bg-[var(--alliance-red)]",
    on: "border-[color:var(--alliance-red)] bg-[color-mix(in_oklab,var(--alliance-red)_24%,transparent)]",
  },
  blue: {
    name: "Blue",
    dot: "bg-[var(--alliance-blue)]",
    on: "border-[color:var(--alliance-blue)] bg-[color-mix(in_oklab,var(--alliance-blue)_24%,transparent)]",
  },
} as const;

/**
 * Red or Blue, required. The selected side gets a tint and a border in its
 * colour and the text stays ink: the colour is only the marker, so it is never
 * a filled button (a filled red would be read as a Major violation).
 */
export function AllianceToggle({
  value,
  onChange,
  idPrefix,
  disabled,
}: {
  value: Alliance | null;
  onChange: (next: Alliance) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className={labelClass}>
        Alliance <span className="ml-1 font-normal text-ink-subtle">Required</span>
      </legend>
      <div className="flex gap-2">
        {(["red", "blue"] as const).map((a) => {
          const on = value === a;
          return (
            <button
              key={a}
              id={`${idPrefix}-${a}`}
              type="button"
              onClick={() => onChange(a)}
              aria-pressed={on}
              disabled={disabled}
              className={`flex h-[46px] flex-1 items-center justify-center gap-2 rounded-xl border-2 font-display text-base font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50 ${
                on ? ALLIANCE[a].on : "border-line bg-surface hover:bg-surface-2"
              }`}
            >
              <span aria-hidden className={`h-4 w-4 shrink-0 rounded-full ${ALLIANCE[a].dot}`} />
              {ALLIANCE[a].name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
