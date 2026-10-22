"use client";

import { useMemo } from "react";
import { buildSlots } from "@/lib/data";
import { STATUS_META } from "@/lib/status";
import { formatClock } from "./ui";
import type { PublicPanel, RequestRow, Slot, Team } from "@/lib/types";

/**
 * The team page's slot tiles, with conflicts shown rather than hidden.
 *
 * An earlier version listed only the free slots, which meant a full
 * schedule looked identical to a panel that runs no slots at all. Showing
 * the taken ones — and who holds them — is the difference between "no
 * times available" and "here is who you are clashing with". The queue desk
 * draws its own grid (components/desk/DeskSlots.tsx) from the same slots.
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

export function SlotPicker({
  panel,
  requests,
  teams,
  teamId,
  disabled,
  onPick,
  excludeRequestId,
}: {
  panel: PublicPanel;
  requests: RequestRow[];
  teams: Team[];
  /** The team being booked, so their own slot reads as theirs. */
  teamId: string | null;
  disabled?: boolean;
  onPick: (slot: Slot) => void;
  /** Set while rescheduling a booking, so its own current time does not
   *  block the slots around it (see buildSlots). */
  excludeRequestId?: string;
}) {
  const slots = useMemo(
    () => buildSlots(panel, requests, teams, excludeRequestId),
    [panel, requests, teams, excludeRequestId],
  );

  // Teams get a plain sentence; the Admin path is for staff.
  if (!slots.length) {
    return <p className="tp-slots-none">{`No times to book with ${panel.name}. Ask for a judge now instead.`}</p>;
  }

  const now = Date.now();
  const free = slots.filter(
    (s) => !s.takenBy && !s.blocked && new Date(s.end).getTime() > now,
  ).length;

  // Nothing says "open" about a tile that reads Open, so the count line is
  // only for when nothing is left -- the reason is the part worth saying.
  return (
    <div>
      {free ? null : <p className="tp-slots-note">{noSlotsLeftLine(slots, now)}</p>}
      <div
        className="tp-slots"
        role="group"
        aria-label={`Times with ${panel.name}, ${panel.slot_minutes} minutes each`}
      >
        {slots.map((slot) => (
          <TeamSlot
            key={slot.start}
            slot={slot}
            isMine={Boolean(teamId && slot.takenBy?.teamId === teamId)}
            past={new Date(slot.end).getTime() <= now}
            disabled={disabled}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The team page's tile: five cases, in this order, drawn as buttons
 * (disabled when they can't be booked) styled under .teampage.
 */
function TeamSlot({
  slot,
  isMine,
  past,
  disabled,
  onPick,
}: {
  slot: Slot;
  isMine: boolean;
  past: boolean;
  disabled?: boolean;
  onPick: (slot: Slot) => void;
}) {
  const time = formatClock(slot.start);
  const off = isMine
    ? { label: "Yours", cls: " tp-slot--mine", title: undefined }
    : slot.takenBy
      ? { label: "Taken", cls: "", title: takenTitle(slot.takenBy) }
      : past
        ? { label: "Gone", cls: "", title: undefined }
        : slot.blocked
          ? { label: "Too close", cls: "", title: TOO_CLOSE_TITLE }
          : null;

  if (off) {
    return (
      <button type="button" className={`tp-slot tp-slot--off${off.cls}`} disabled title={off.title}>
        <b>{time}</b>
        <small>{off.label}</small>
      </button>
    );
  }

  return (
    <button type="button" className="tp-slot" disabled={disabled} onClick={() => onPick(slot)}>
      <b>{time}</b>
      <small>Open</small>
    </button>
  );
}
