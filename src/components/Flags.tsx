"use client";

import type { AppState, FlagRow } from "@/lib/types";

export type FlagKind = AppState["flagKinds"][number];

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
  onRemove,
}: {
  flags: FlagRow[];
  kinds: FlagKind[];
  /** Only the Judge Advisor passes this. */
  onRemove?: (id: string) => void;
}) {
  if (!flags.length) {
    return <p className="text-sm text-zinc-600">Nothing flagged by a referee.</p>;
  }
  return (
    <ul className="space-y-2">
      {flags.map((f) => (
        <li
          key={f.id}
          className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-inset ring-white/10"
        >
          <div className="flex flex-wrap items-center gap-2">
            <FlagChip kind={f.kind} kinds={kinds} />
            <span className="text-xs text-zinc-500">
              {f.author} · {new Date(f.created_at).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            {onRemove ? (
              <button
                onClick={() => onRemove(f.id)}
                className="ml-auto text-xs text-zinc-600 hover:text-rose-400"
              >
                remove
              </button>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm text-zinc-200">{f.body}</p>
        </li>
      ))}
    </ul>
  );
}

export { SOLID as FLAG_SOLID, TONES as FLAG_TONES };
