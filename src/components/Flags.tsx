"use client";

import { useState } from "react";
import type { AppState, FlagRow } from "@/lib/types";
import { tone, toneSolid } from "@/lib/tone";
import type { FlagEdit } from "@/lib/db/types";
import { filterMatchNumberInput, matchReference } from "@/lib/match";
import { ruleDisplayLabel } from "@/lib/rules";

export type FlagKind = AppState["flagKinds"][number];
export type MatchType = AppState["matchTypes"][number];

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
          <input
            value={draftField}
            onChange={(e) => setDraftField(e.target.value)}
            placeholder="Field"
            maxLength={40}
            disabled={busy}
            className="w-full rounded-lg bg-surface px-2 py-1.5 text-xs ring-1 ring-inset ring-line disabled:opacity-50"
          />
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={2}
            maxLength={500}
            disabled={busy}
            className="w-full rounded-lg bg-surface px-2 py-1.5 text-xs ring-1 ring-inset ring-line disabled:opacity-50"
          />
          <div className="flex flex-wrap gap-1.5">
            {kinds.map((k) => (
              <button
                key={k.id}
                disabled={
                  busy || (k.requiresRule && !f.rule && k.id !== f.kind)
                }
                onClick={() => save(k.id)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  k.id === f.kind ? "ring-2 ring-ink/60" : ""
                } ${toneSolid(k.color)}`}
                title={k.id === f.kind ? "Currently set to this" : undefined}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      ) : f.body ? (
        <p className="mt-1.5 text-sm text-ink">{f.body}</p>
      ) : null}
    </li>
  );
}
