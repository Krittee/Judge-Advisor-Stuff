"use client";

import Link from "next/link";
import type { Role } from "@/lib/auth";

/**
 * Getting around.
 *
 * A Judge Advisor who wanted the board used to type the URL, because each
 * console only navigated within its own page. These links move between
 * the consoles a signed-in person is allowed to open.
 */

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
