"use client";

import type { AppState } from "@/lib/types";

/**
 * How a team's notebook is classified.
 *
 * The whole point is telling them apart at a glance, so the colour does
 * the work and the label backs it up — colour alone would leave anyone
 * who cannot separate amber from violet with nothing to read.
 */
const TONES: Record<string, string> = {
  amber: "bg-amber-500/20 text-amber-300 ring-amber-500/40",
  violet: "bg-violet-500/20 text-violet-300 ring-violet-500/40",
  emerald: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40",
  sky: "bg-sky-500/20 text-sky-300 ring-sky-500/40",
  rose: "bg-rose-500/20 text-rose-300 ring-rose-500/40",
  zinc: "bg-zinc-500/20 text-zinc-400 ring-zinc-500/40",
};

/** Solid colour, for the rail down the side of a board tile. */
const RAILS: Record<string, string> = {
  amber: "bg-amber-400",
  violet: "bg-violet-400",
  emerald: "bg-emerald-400",
  sky: "bg-sky-400",
  rose: "bg-rose-400",
  zinc: "bg-zinc-400",
};

export type Category = AppState["categories"][number];

export function categoryOf(id: string, categories: Category[]): Category | null {
  return categories.find((c) => c.id === id) ?? null;
}

export function CategoryChip({
  category,
  categories,
  size = "sm",
}: {
  category: string;
  categories: Category[];
  size?: "xs" | "sm";
}) {
  const found = categoryOf(category, categories);
  if (!found) return null;

  const pad = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full ring-1 ring-inset ${pad} ${
        TONES[found.color] ?? TONES.zinc
      }`}
    >
      {found.label}
    </span>
  );
}

/** A thin colour bar, for places too tight for a full chip. */
export function CategoryRail({
  category,
  categories,
}: {
  category: string;
  categories: Category[];
}) {
  const found = categoryOf(category, categories);
  if (!found) return null;
  return (
    <span
      title={found.label}
      className={`absolute inset-y-0 left-0 w-1 rounded-l-xl ${RAILS[found.color] ?? RAILS.zinc}`}
    />
  );
}

/** Pick one of the two. */
export function CategorySelect({
  value,
  categories,
  onChange,
  className = "",
}: {
  value: string;
  categories: Category[];
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg bg-white/5 px-2 py-1.5 text-xs ring-1 ring-inset ring-white/10 ${className}`}
    >
      {categories.map((c) => (
        <option key={c.id} value={c.id} className="bg-zinc-900">
          {c.label}
        </option>
      ))}
    </select>
  );
}

export function CategoryLegend({ categories }: { categories: Category[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {categories.map((c) => (
        <CategoryChip key={c.id} category={c.id} categories={categories} />
      ))}
    </span>
  );
}
