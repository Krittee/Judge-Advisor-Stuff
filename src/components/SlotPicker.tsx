import { STATUS_META } from "@/lib/status";
import type { RequestRow, Slot } from "@/lib/types";

/**
 * What the team page and the queue desk share about a panel's day: how busy
 * it is, and the words for a slot that cannot be booked. The desk draws its
 * own grid (components/desk/DeskSlots.tsx) from these.
 */

export type PanelLoad = {
  waiting: number;
  interviewing: number;
  /** Minutes the longest-waiting team has been in the queue. */
  longestWait: number;
};

export function panelLoad(panelId: string, requests: RequestRow[]): PanelLoad {
  const live = requests.filter((r) => r.panel_id === panelId);
  const waiting = live.filter((r) => r.status === "requested");
  const oldest = waiting
    .map((r) => Date.now() - new Date(r.requested_at).getTime())
    .sort((a, b) => b - a)[0];

  return {
    waiting: waiting.length,
    interviewing: live.filter((r) => r.status === "interviewing").length,
    longestWait: oldest ? Math.round(oldest / 60000) : 0,
  };
}

/**
 * The line shown when no slot is open. A slot that has already ended is not
 * "taken", so say which it is: staff who read "all taken" go looking for a
 * booking clash that does not exist (BUG-031).
 */
export function noSlotsLeftLine(slots: Slot[], now: number): string {
  const ended = (s: Slot) => new Date(s.end).getTime() <= now;
  const passed = slots.filter((s) => ended(s) && !s.takenBy).length;
  if (passed === slots.length) return "No slots left today — the rest have already passed";
  if (passed === 0) return `All ${slots.length} slots are taken — nothing left to book`;
  return `No slots left — ${slots.length - passed} taken, ${passed} already passed`;
}

/** How busy this panel is right now, in one line. Plain text: the team page shows it on a status panel. */
export function PanelBusyLine({ load }: { load: PanelLoad }) {
  if (!load.waiting && !load.interviewing) return <span>Panel is free right now</span>;

  const parts: string[] = [];
  if (load.interviewing) parts.push(`${load.interviewing} in interview`);
  if (load.waiting) {
    parts.push(
      `${load.waiting} already waiting${load.longestWait ? ` (longest ${load.longestWait} min)` : ""}`,
    );
  }
  return <span>{parts.join(" · ")}</span>;
}

export const TOO_CLOSE_TITLE =
  "Too close to another team's booking on this panel — judges need 20 minutes to walk between interviews";

export const takenTitle = (taken: NonNullable<Slot["takenBy"]>) =>
  `Taken by team ${taken.teamNumber} — ${STATUS_META[taken.status].label}`;
