"use client";

import Link from "next/link";

/**
 * The two ways a referee reaches a team: type the number they can see on
 * the robot, or find it in the list when they cannot.
 */
export function RefereeNav({ active }: { active: "lookup" | "teams" }) {
  const base =
    "flex-1 rounded-xl px-4 py-2.5 text-center text-sm font-medium transition";
  const on = "bg-indigo-500 text-white";
  const off = "bg-white/5 text-zinc-400 ring-1 ring-inset ring-white/10 hover:text-zinc-200";
  return (
    <nav className="flex gap-2">
      <Link href="/referee" className={`${base} ${active === "lookup" ? on : off}`}>
        Type a number
      </Link>
      <Link href="/referee/teams" className={`${base} ${active === "teams" ? on : off}`}>
        All teams
      </Link>
    </nav>
  );
}
