"use client";

import { useState } from "react";
import type { AppState, FlagRow } from "@/lib/types";
import type { FlagEdit } from "@/lib/db/types";
import { filterMatchNumberInput, matchReference } from "@/lib/match";
import { ruleDisplayLabel } from "@/lib/rules";

export type FlagKind = AppState["flagKinds"][number];
export type MatchType = AppState["matchTypes"][number];

/**
 * Referee flags, shown wherever a judge looks at a team.
 *
 * Colour carries the severity, but never alone: someone who cannot tell
 * amber from orange still reads "Minor violation", and a referee's flag
 * is not the place to make anyone guess.
 */
const TONES: Record<string, string> = {
  emerald: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40",
  amber: "bg-amber-500/20 text-amber-300 ring-amber-500/40",
  orange: "bg-orange-500/20 text-orange-300 ring-orange-500/40",
  rose: "bg-rose-500/20 text-rose-300 ring-rose-500/40",
  sky: "bg-sky-500/20 text-sky-300 ring-sky-500/40",
  zinc: "bg-zinc-500/20 text-zinc-400 ring-zinc-500/40",
};

/** Solid, for the button a referee taps. */
const SOLID: Record<string, string> = {
  emerald: "bg-emerald-500 text-emerald-950 hover:bg-emerald-400",
  amber: "bg-amber-500 text-amber-950 hover:bg-amber-400",
  orange: "bg-orange-500 text-orange-950 hover:bg-orange-400",
  rose: "bg-rose-600 text-white hover:bg-rose-500",
  sky: "bg-sky-500 text-sky-950 hover:bg-sky-400",
  zinc: "bg-zinc-500 text-zinc-950 hover:bg-zinc-400",
};

export function kindOf(id: string, kinds: FlagKind[]): FlagKind | null {
  return kinds.find((k) => k.id === id) ?? null;
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

export function FlagChip({
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
        TONES[found.color] ?? TONES.zinc
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
    return <p className="text-sm text-zinc-600">Nothing flagged by a referee.</p>;
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
  const [draftField, setDraftField] = useState(f.field ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setDraftBody(f.body);
    setDraftMatchType(f.match_type ?? "");
    setDraftMatchNumber(f.match_number ?? "");
    setDraftField(f.field ?? "");
    setError(null);
    setEditing(true);
  }

  // Tapping a severity button submits the whole correction, the same way
  // it does when a flag is first raised — a referee re-selecting "Minor"
  // instead of "Major" is doing exactly the gesture they did the first
  // time, not filling in a separate form.
  //
  // This correction form has no rule picker of its own -- rule is set
  // once, when the flag is first raised. f.rule is passed through
  // unchanged here so a correction (fixing a typo, a match number) can
  // never silently wipe the rule already on record.
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
        field: draftField,
        rule: f.rule,
      });
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-inset ring-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <FlagChip kind={f.kind} kinds={kinds} />
        <span className="text-xs text-zinc-500">
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
            className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-zinc-400"
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
            className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-indigo-300"
          >
            {ruleDisplayLabel(f.rule)}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-3">
          {onEdit ? (
            <button
              onClick={() => (editing ? setEditing(false) : startEditing())}
              className="text-xs text-zinc-500 hover:text-indigo-300"
            >
              {editing ? "cancel" : "edit"}
            </button>
          ) : null}
          {onRemove ? (
            <button
              onClick={() => onRemove(f.id)}
              className="text-xs text-zinc-600 hover:text-rose-400"
            >
              remove
            </button>
          ) : null}
        </span>
      </div>

      {editing ? (
        <div className="mt-2 space-y-2 rounded-lg bg-black/20 p-2.5 ring-1 ring-inset ring-white/10">
          {error ? <p className="text-xs text-rose-400">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <select
              value={draftMatchType}
              onChange={(e) => setDraftMatchType(e.target.value)}
              disabled={busy}
              className="min-w-[9rem] flex-[2] rounded-lg bg-white/5 px-2 py-1.5 text-xs ring-1 ring-inset ring-white/10 disabled:opacity-50"
            >
              <option value="" className="bg-zinc-900">
                — match —
              </option>
              {matchTypes.map((t) => (
                <option key={t.id} value={t.id} className="bg-zinc-900">
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
              className="min-w-[3.5rem] flex-1 rounded-lg bg-white/5 px-2 py-1.5 text-center text-xs ring-1 ring-inset ring-white/10 disabled:opacity-50"
            />
          </div>
          <input
            value={draftField}
            onChange={(e) => setDraftField(e.target.value)}
            placeholder="Field"
            maxLength={40}
            disabled={busy}
            className="w-full rounded-lg bg-white/5 px-2 py-1.5 text-xs ring-1 ring-inset ring-white/10 disabled:opacity-50"
          />
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={2}
            maxLength={500}
            disabled={busy}
            className="w-full rounded-lg bg-white/5 px-2 py-1.5 text-xs ring-1 ring-inset ring-white/10 disabled:opacity-50"
          />
          <div className="flex flex-wrap gap-1.5">
            {kinds.map((k) => (
              <button
                key={k.id}
                disabled={busy}
                onClick={() => save(k.id)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  k.id === f.kind ? "ring-2 ring-white/60" : ""
                } ${SOLID[k.color] ?? SOLID.zinc}`}
                title={k.id === f.kind ? "Currently set to this" : undefined}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-1.5 text-sm text-zinc-200">{f.body}</p>
      )}
    </li>
  );
}

export { SOLID as FLAG_SOLID, TONES as FLAG_TONES };
