"use client";

import { bandFor, bands } from "@/lib/rubrics";

/**
 * The colour a total falls into.
 *
 * An unscored team gets no colour at all: not-yet-judged is not the same
 * as scoring badly, and painting it as the lowest band would misread the
 * board at a glance.
 */
const TONES: Record<string, string> = {
  emerald: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40",
  sky: "bg-sky-500/20 text-sky-300 ring-sky-500/40",
  amber: "bg-amber-500/20 text-amber-300 ring-amber-500/40",
  violet: "bg-violet-500/20 text-violet-300 ring-violet-500/40",
  rose: "bg-rose-500/20 text-rose-300 ring-rose-500/40",
  zinc: "bg-zinc-500/20 text-zinc-400 ring-zinc-500/40",
};

export function BandChip({
  total,
  max,
  scored,
  size = "sm",
}: {
  total: number;
  max: number;
  scored: boolean;
  size?: "sm" | "md";
}) {
  const band = bandFor(total, max, scored);

  if (!band) {
    return (
      <span className="text-[11px] text-zinc-600">{scored ? "—" : "not scored"}</span>
    );
  }

  const pad = size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]";
  return (
    <span
      className={`inline-block rounded-full ring-1 ring-inset ${pad} ${
        TONES[band.color] ?? TONES.zinc
      }`}
    >
      {band.label}
    </span>
  );
}

/** All the bands, so the table header explains its own colours. */
export function BandLegend() {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
      {bands().map((band) => (
        <span key={band.id} className="flex items-center gap-1.5">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-inset ${
              TONES[band.color] ?? TONES.zinc
            }`}
          />
          {band.label} {band.minPercent > 0 ? `${band.minPercent}%+` : ""}
        </span>
      ))}
    </span>
  );
}
