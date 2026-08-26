"use client";

import type { PublicPanel } from "@/lib/types";

export type Language = { id: string; label: string; short: string };

/** The language an interview will run in, as a small tag. */
export function LanguageTag({
  language,
  languages,
  size = "sm",
}: {
  language: string;
  languages: Language[];
  size?: "sm" | "md";
}) {
  const found = languages.find((l) => l.id === language);
  if (!found) return null;

  const pad = size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]";
  return (
    <span
      title={found.label}
      className={`inline-block whitespace-nowrap rounded-md bg-white/10 font-semibold tracking-wide text-zinc-300 ${pad}`}
    >
      {found.short}
    </span>
  );
}

/**
 * What this panel can interview in.
 *
 * Says nothing when a panel has not stated its languages — an unstated
 * cover is not the same as no cover, and warning about it would train
 * everyone to ignore the warning.
 */
export function LanguageCover({
  panel,
  languages,
  asking,
}: {
  panel: PublicPanel;
  languages: Language[];
  /** When set, flags a request this panel cannot cover. */
  asking?: string;
}) {
  if (!panel.languages.length) return null;

  const covered = panel.languages
    .map((id) => languages.find((l) => l.id === id)?.label ?? id)
    .join(", ");

  const gap = asking && !panel.languages.includes(asking);
  const wanted = languages.find((l) => l.id === asking)?.label ?? asking;

  return (
    <p className={`text-xs ${gap ? "text-amber-400" : "text-zinc-500"}`}>
      {gap ? (
        <>
          {panel.name} interviews in {covered} — this team asked for {wanted}. The Judge Advisor
          can move them.
        </>
      ) : (
        <>
          {panel.name} interviews in {covered}
        </>
      )}
    </p>
  );
}
