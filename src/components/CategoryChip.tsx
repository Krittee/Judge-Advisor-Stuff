"use client";

import type { AppState } from "@/lib/types";
import { tone, toneRail } from "@/lib/tone";

export type Category = AppState["categories"][number];

function categoryOf(id: string, categories: Category[]): Category | null {
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
        tone(found.color)
      }`}
    >
      {found.label}
    </span>
  );
}

/**
 * A dot, for the board, where a full chip would not fit and a bar down
 * the edge of the tile reads as decoration rather than as data.
 */
export function CategoryDot({
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
      aria-label={found.label}
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneRail(found.color)}`}
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
      className={`rounded-lg bg-surface px-2 py-1.5 text-xs ring-1 ring-inset ring-line ${className}`}
    >
      {categories.map((c) => (
        <option key={c.id} value={c.id} className="bg-surface">
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
