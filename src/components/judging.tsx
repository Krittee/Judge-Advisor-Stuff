"use client";

import { useRouter } from "next/navigation";
import { call } from "./useAppState";

/**
 * @param to where signing out lands. Defaults to the staff sign-in; the
 *        referee console passes its own, so someone who came in through
 *        the referee door is not sent back through a different one.
 */
export function SignOutButton({ to = "/login" }: { to?: string } = {}) {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await call("/api/session", { method: "DELETE" });
        router.replace(to);
      }}
      className="text-sm text-ink-subtle hover:text-ink"
    >
      Sign out
    </button>
  );
}
