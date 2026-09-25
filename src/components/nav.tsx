"use client";

import Link from "next/link";
import type { Role } from "@/lib/auth";

/**
 * Getting around.
 *
 * There used to be three navigations: underlined tabs in the admin
 * console, filled pills on the judge screen, and a third set of links the
 * referee console drew itself. Same job, three answers, and none of them
 * went anywhere except within its own page -- a Judge Advisor who wanted
 * the board typed the URL.
 *
 * One tab pattern and one set of console links, used everywhere.
 */

export type TabItem<T extends string> = {
  id: T;
  label: string;
  /** Shown as a badge. Omit or pass 0 for none. */
  count?: number;
  /** Draw the badge as something needing attention rather than a total. */
  urgent?: boolean;
  /** Start a new group in the row. Purely visual; nothing is hidden. */
  startsGroup?: boolean;
  /**
   * Set when the tab is its own page rather than a view of this one.
   *
   * The referee console is two routes, not two pieces of state, so its
   * switch has to be real links -- middle-click, long-press, "open in new
   * tab" and the browser's own back button all stop working if a route
   * change is disguised as a button.
   */
  href?: string;
};

/**
 * One row of tabs.
 *
 * Counts are the point of this rather than a decoration: with eight of
 * them the Judge Advisor's question is "which of these needs me", and a
 * flat row of eight words cannot answer it. A badge that only appears
 * when there is something to see answers it without a click.
 *
 * Groups are separators, not folders. A console used under time pressure
 * should never make someone open something to find out whether it was
 * the right thing to open.
 */
export function TabBar<T extends string>({
  items,
  active,
  onSelect,
  label,
  variant = "tabs",
}: {
  items: TabItem<T>[];
  active: T;
  /** Not needed when every item carries an href. */
  onSelect?: (id: T) => void;
  label: string;
  /**
   * "tabs" is the understated row a console with six or eight sections
   * wants -- it must not shout over the content it switches.
   *
   * "segmented" is for a two-way switch that is the first thing someone
   * looks for. A head referee opening this console is usually going
   * straight to the team list, and a quiet tab in a top bar made them
   * hunt for it; at two items there is no row to shout over.
   */
  variant?: "tabs" | "segmented";
}) {
  if (variant === "segmented") {
    return (
      <nav aria-label={label} className="flex gap-2">
        {items.map((item) => {
          const on = active === item.id;
          const className = `flex-1 rounded-xl px-4 py-2.5 text-center text-sm font-medium transition ${
            on
              ? "bg-accent text-accent-ink"
              : "bg-surface text-ink-subtle ring-1 ring-inset ring-line hover:text-ink"
          }`;
          return item.href ? (
            <Link
              key={item.id}
              href={item.href}
              aria-current={on ? "page" : undefined}
              className={className}
            >
              {item.label}
            </Link>
          ) : (
            <button
              key={item.id}
              aria-pressed={on}
              onClick={() => onSelect?.(item.id)}
              className={className}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label={label} className="no-scrollbar -mx-1 overflow-x-auto">
      <div role="tablist" aria-label={label} className="flex min-w-max items-stretch gap-0.5 px-1">
        {items.map((item) => (
          <div key={item.id} className="flex items-stretch">
            {item.startsGroup ? (
              <span aria-hidden className="mx-2 my-2.5 w-px shrink-0 bg-line" />
            ) : null}
            <button
              role="tab"
              aria-selected={active === item.id}
              onClick={() => onSelect?.(item.id)}
              className={`relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active === item.id
                  ? "bg-surface-2 text-ink"
                  : "text-ink-subtle hover:bg-surface hover:text-ink"
              }`}
            >
              {item.label}
              {item.count ? <Badge count={item.count} urgent={item.urgent} /> : null}
              {/* The active marker is a rule under the tab rather than a
                  filled pill, so the tab row never competes with the
                  status colours inside the panel it controls. */}
              {active === item.id ? (
                <span
                  aria-hidden
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent"
                />
              ) : null}
            </button>
          </div>
        ))}
      </div>
    </nav>
  );
}

function Badge({ count, urgent }: { count: number; urgent?: boolean }) {
  return (
    <span
      className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-2xs font-semibold ${
        urgent ? "bg-waiting text-waiting-ink" : "bg-surface-2 text-ink-subtle ring-1 ring-inset ring-line"
      }`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Moving between consoles
 * ------------------------------------------------------------------ */

type ConsoleLink = { href: string; label: string };

/**
 * Where this person is allowed to go, given the code they signed in with.
 *
 * The board is on every list because it is the one screen everybody
 * refers to and nobody could reach without typing the address. The rest
 * follow the same permission table the API enforces -- this only decides
 * what to offer, never what is allowed.
 */
function linksFor(role: Role | "team"): ConsoleLink[] {
  const board = { href: "/board", label: "Board" };
  switch (role) {
    case "admin":
      return [{ href: "/admin", label: "Console" }, { href: "/queue", label: "Desk" }, board];
    case "judge":
      return [{ href: "/judge", label: "My panel" }, board];
    case "queuer":
      return [{ href: "/queue", label: "Desk" }, board];
    case "referee":
      /* Nothing. The two referee screens switch between themselves in the
         page, where the head referee actually looks for them, and the
         board is the whole floor's status at once -- not something anyone
         with a clipboard needs mid-match. */
      return [];
    default:
      return [board];
  }
}

export function ConsoleLinks({
  role,
  current,
}: {
  role: Role | "team";
  /** The path that should read as "you are here". */
  current: string;
}) {
  const links = linksFor(role);
  if (links.length < 2) return null;

  return (
    <nav aria-label="Switch view" className="flex items-center gap-0.5">
      {links.map((link) => {
        const here = link.href === current;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={here ? "page" : undefined}
            className={`rounded-lg px-2.5 py-1.5 text-sm transition ${
              here
                ? "bg-surface-2 font-medium text-ink"
                : "text-ink-subtle hover:bg-surface hover:text-ink"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
