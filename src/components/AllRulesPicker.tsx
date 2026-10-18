"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  commonFieldRules,
  DEFAULT_OPEN_RULE_CATEGORIES,
  getRuleset,
  groupRulesByCategory,
  isCategoryOpen,
  MAX_FLAG_RULES,
  searchRules,
  toggleRule,
} from "@/lib/rules";

const chip =
  "h-11 min-w-14 rounded-xl border-[1.5px] px-3 font-display text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Every rule in the event's ruleset, in a full-screen dialog: search, the
 * common rules first, then each category as a collapsible group. Controlled
 * (the caller owns the selected ids and hears every toggle at once); the
 * dialog's own state is only the search text and which groups are open, and it
 * starts clean each time it opens.
 *
 * A native <dialog> opened with showModal() supplies the focus trap, Escape,
 * and the inert page behind it, and gives focus back to whatever opened it when
 * it closes. All this adds is the backdrop click and keeping `open` in step.
 */
export function AllRulesPicker({
  open,
  rulesetId,
  value,
  onChange,
  onClose,
}: {
  open: boolean;
  rulesetId: string;
  /** The selected rule ids. */
  value: string[];
  /** Fires on every toggle. */
  onChange: (ids: string[]) => void;
  /** Back arrow, Done, Escape or the backdrop. */
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Escape closes the dialog by itself; tell the caller. A close the caller
      // asked for (open already false) is not news.
      onClose={() => {
        if (open) onClose();
      }}
      // A click whose target is the dialog itself landed on the backdrop.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none flex-col overflow-hidden bg-canvas p-0 text-ink backdrop:bg-black/60 open:flex sm:m-auto sm:h-[min(52rem,calc(100dvh_-_4rem))] sm:max-w-lg sm:rounded-2xl sm:border sm:border-line"
    >
      {open ? (
        <Body titleId={titleId} rulesetId={rulesetId} value={value} onChange={onChange} onClose={onClose} />
      ) : null}
    </dialog>
  );
}

function Body({
  titleId,
  rulesetId,
  value,
  onChange,
  onClose,
}: {
  titleId: string;
  rulesetId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const ruleset = getRuleset(rulesetId);
  const [query, setQuery] = useState("");
  const [openCategories, setOpenCategories] = useState(() => new Set(DEFAULT_OPEN_RULE_CATEGORIES));
  const searching = query.trim() !== "";
  const common = useMemo(() => commonFieldRules(ruleset.id), [ruleset.id]);
  const groups = useMemo(() => groupRulesByCategory(searchRules(query, ruleset.id)), [query, ruleset.id]);
  const atCap = value.length >= MAX_FLAG_RULES;
  const toggle = (id: string) => onChange(toggleRule(value, id));

  function toggleCategory(category: string) {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (!next.delete(category)) next.add(category);
      return next;
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line pr-2.5 pl-1">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-ink hover:bg-surface-2"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </button>
        <h2 id={titleId} className="min-w-0 flex-1 truncate font-display text-[18px] font-bold">
          {`Rules · ${ruleset.label}`}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="h-11 shrink-0 rounded-xl bg-accent px-4 font-display text-[15px] font-bold text-accent-ink hover:bg-accent-quiet"
        >
          {`Done (${value.length})`}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="sticky top-0 z-10 border-b border-line bg-canvas px-4 py-2">
          <label className="relative block">
            <span className="sr-only">Search rules</span>
            <svg
              className="pointer-events-none absolute top-3.5 left-3.5 text-ink-subtle"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4.5 4.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by number or words (e.g. SG6, holding)"
              autoComplete="off"
              className="h-12 w-full rounded-xl border-[1.5px] border-ink-faint bg-sunken pr-3 pl-10 text-base text-ink placeholder:text-sm placeholder:text-ink-subtle focus:border-accent"
            />
          </label>
        </div>

        {!searching && common.length ? (
          <section>
            <h3 className="flex min-h-12 items-center gap-2.5 border-b border-line bg-surface px-4 font-display text-[15px] font-semibold">
              Common
              <span className="rounded-full border border-line bg-sunken px-2.5 text-xs font-medium text-ink-subtle">
                {common.length}
              </span>
            </h3>
            <div role="group" aria-label="Common rules" className="flex flex-wrap gap-1.5 px-4 pt-2.5 pb-3">
              {common.map((r) => {
                const on = value.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggle(r.id)}
                    aria-pressed={on}
                    disabled={atCap && !on}
                    title={r.officialTitle}
                    className={`${chip} ${
                      on
                        ? "border-accent bg-accent text-accent-ink"
                        : "border-ink-faint bg-sunken text-ink hover:bg-surface-2"
                    }`}
                  >
                    {r.id}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {groups.length ? (
          groups.map(({ category, rules }) => {
            const expanded = isCategoryOpen(category, query, openCategories);
            const chosen = rules.filter((r) => value.includes(r.id)).length;
            const head = (
              <>
                <span className="min-w-0 flex-1">{category}</span>
                {chosen ? <span className="text-xs font-normal text-accent-quiet">{`${chosen} selected`}</span> : null}
                <span className="rounded-full border border-line bg-sunken px-2.5 text-xs font-medium text-ink-subtle">
                  {rules.length}
                </span>
              </>
            );
            const headClass =
              "flex min-h-12 w-full items-center gap-2.5 border-b border-line bg-surface px-4 text-left font-display text-[15px] font-semibold text-ink";
            return (
              <section key={category}>
                {/* A search opens every group, so there is nothing to toggle. */}
                {searching ? (
                  <div className={headClass}>{head}</div>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleCategory(category)}
                    aria-expanded={expanded}
                    className={`${headClass} hover:bg-surface-2`}
                  >
                    {head}
                    <svg
                      className={`shrink-0 text-ink-subtle ${expanded ? "rotate-180" : ""}`}
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                )}
                {expanded
                  ? rules.map((r) => {
                      const on = value.includes(r.id);
                      const locked = atCap && !on;
                      return (
                        <label
                          key={r.id}
                          className={`flex min-h-12 items-center gap-3 border-b border-line px-4 py-2 ${
                            locked ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                          } ${on ? "bg-accent/15" : locked ? "" : "hover:bg-surface-2"}`}
                        >
                          <span className="min-w-12 shrink-0 font-display text-[15px] font-semibold">{r.id}</span>
                          <span className="min-w-0 flex-1 break-words text-sm leading-snug">{r.officialTitle}</span>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={locked}
                            onChange={() => toggle(r.id)}
                            className="h-[26px] w-[26px] shrink-0 accent-[var(--accent)]"
                          />
                        </label>
                      );
                    })
                  : null}
              </section>
            );
          })
        ) : (
          <p className="px-4 py-6 text-sm text-ink-subtle">No rule matches that.</p>
        )}
      </div>

      <div className="shrink-0 space-y-1.5 border-t border-line bg-surface px-3 pt-2.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
        <p className="text-sm text-ink-subtle">
          <b className="font-display font-semibold text-ink">
            {`${value.length} ${value.length === 1 ? "rule" : "rules"} selected`}
          </b>
          {value.length ? ` · ${value.join(", ")}` : ""}
        </p>
        {atCap ? (
          <p className="text-sm text-caution-quiet">{`Most ${MAX_FLAG_RULES} rules on one report. Untick one to pick another.`}</p>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="h-[52px] w-full rounded-xl bg-accent font-display text-[17px] font-bold text-accent-ink hover:bg-accent-quiet"
        >
          Done
        </button>
      </div>
    </div>
  );
}
