"use client";

import { bandFor, bands } from "@/lib/rubrics";
import { tone } from "@/lib/tone";

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
      <span className="text-[11px] text-ink-faint">{scored ? "—" : "not scored"}</span>
    );
  }

  const pad = size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]";
  return (
    <span
      className={`inline-block rounded-full ring-1 ring-inset ${pad} ${
        tone(band.color)
      }`}
    >
      {band.label}
    </span>
  );
}

/** All the bands, so the table header explains its own colours. */
export function BandLegend() {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
      {bands().map((band) => (
        <span key={band.id} className="flex items-center gap-1.5">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-inset ${
              tone(band.color)
            }`}
          />
          {band.label} {band.minPercent > 0 ? `${band.minPercent}%+` : ""}
        </span>
      ))}
    </span>
  );
}
