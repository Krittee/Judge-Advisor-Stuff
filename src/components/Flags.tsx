"use client";

import type { AppState, FlagRow } from "@/lib/types";
import { tone } from "@/lib/tone";
import { fieldLabel, matchReference } from "@/lib/match";
import { getRuleset, parseRuleList, ruleDisplayLabel } from "@/lib/rules";

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

/** How many flags of each kind a set of flags holds, worst first. A kind the
 *  flags do not use is left out, and so is a kind the config no longer has. */
export function kindCounts(flags: FlagRow[], kinds: FlagKind[]): { kind: FlagKind; count: number }[] {
  const counts = new Map<string, number>();
  for (const f of flags) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);

  return [...counts.entries()]
    .map(([id, count]) => ({ kind: kindOf(id, kinds), count }))
    .filter((x): x is { kind: FlagKind; count: number } => x.kind !== null)
    .sort((a, b) => b.kind.severity - a.kind.severity);
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

  const ordered = kindCounts(flags, kinds);

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {ordered.map(({ kind, count }) => (
        <FlagChip key={kind.id} kind={kind.id} kinds={kinds} size={size} count={count} />
      ))}
    </span>
  );
}

/** The full record, in the referee's own words. */
export function FlagList({ flags, kinds, onEdit }: { flags: FlagRow[]; kinds: FlagKind[]; onEdit?: (flag: FlagRow) => void }) {
  if (!flags.length) {
    return <p className="text-sm text-ink-faint">Nothing flagged by a referee.</p>;
  }
  return (
    <ul className="space-y-2">
      {flags.map((flag) => <FlagListItem key={flag.id} flag={flag} kinds={kinds} onEdit={onEdit} />)}
    </ul>
  );
}

function FlagListItem({ flag: f, kinds, onEdit }: { flag: FlagRow; kinds: FlagKind[]; onEdit?: (flag: FlagRow) => void }) {
  const ruleIds = parseRuleList(f.rule);
  const ruleset = getRuleset(f.ruleset);
  const field = fieldLabel(f.field);

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
        {matchReference(f.match_type, f.match_number) ? (
          <span
            title="Match · Field"
            className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-ink-subtle"
          >
            {matchReference(f.match_type, f.match_number)}
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
        {onEdit ? (
          <button
            type="button"
            className="ml-auto min-h-11 px-2 text-xs text-accent-quiet"
            aria-label={`Edit ${matchReference(f.match_type, f.match_number) ?? "flag"} by ${f.author}`}
            onClick={() => onEdit(f)}
          >
            Edit
          </button>
        ) : null}
      </div>

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

      {f.body ? <p className="mt-1.5 text-sm text-ink">{f.body}</p> : null}
    </li>
  );
}
