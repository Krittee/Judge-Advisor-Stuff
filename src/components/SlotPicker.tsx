"use client";

import { useMemo } from "react";
import { buildSlots } from "@/lib/data";
import { STATUS_META } from "@/lib/status";
import { formatClock } from "./ui";
import type { PublicPanel, RequestRow, Slot, Team } from "@/lib/types";

/**
 * Pick a booking slot, with conflicts shown rather than hidden.
 *
 * An earlier version listed only the free slots, which meant a full
 * schedule looked identical to a panel that runs no slots at all. Showing
 * the taken ones — and who holds them — is the difference between "no
 * times available" and "here is who you are clashing with".
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

/**
 * How busy this panel is right now, in one line.
 *
 * `plain` leaves the colour to the surrounding text: the team page shows it
 * on a status panel, where green and orange would read as statuses.
 */
export function PanelBusyLine({ load, plain = false }: { load: PanelLoad; plain?: boolean }) {
  if (!load.waiting && !load.interviewing) {
    return <span className={plain ? undefined : "text-done-quiet"}>Panel is free right now</span>;
  }

  const parts: string[] = [];
  if (load.interviewing) parts.push(`${load.interviewing} in interview`);
  if (load.waiting) {
    parts.push(
      `${load.waiting} already waiting${load.longestWait ? ` (longest ${load.longestWait} min)` : ""}`,
    );
  }
  return <span className={plain ? undefined : "text-caution-quiet"}>{parts.join(" · ")}</span>;
}

const TOO_CLOSE_TITLE =
  "Too close to another team's booking on this panel — judges need 20 minutes to walk between interviews";

const takenTitle = (taken: NonNullable<Slot["takenBy"]>) =>
  `Taken by team ${taken.teamNumber} — ${STATUS_META[taken.status].label}`;

export function SlotPicker({
  panel,
  requests,
  teams,
  teamId,
  disabled,
  onPick,
  excludeRequestId,
  variant,
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
  /** "team" draws the team page's tiles (styled under .teampage). Left out, the
   *  picker is the one the queue desk has always had. */
  variant?: "team";
}) {
  const slots = useMemo(
    () => buildSlots(panel, requests, teams, excludeRequestId),
    [panel, requests, teams, excludeRequestId],
  );

  if (!slots.length) {
    // Teams get a plain sentence; the Admin path is for staff.
    if (variant === "team") {
      return <p className="tp-slots-none">{`No times to book with ${panel.name}. Ask for a judge now instead.`}</p>;
    }
    return (
      <div className="rounded-xl bg-caution/12 px-4 py-3 text-sm text-caution-quiet ring-1 ring-inset ring-caution/35">
        <strong>{panel.name} has no bookable times set up yet.</strong>
        <p className="mt-1 text-caution-quiet/80">
          Use <strong>Interview now</strong> instead, or ask the Judge Advisor to add times:
          Admin → Panels → {panel.name} → Booking slots.
        </p>
      </div>
    );
  }

  const now = Date.now();
  const free = slots.filter(
    (s) => !s.takenBy && !s.blocked && new Date(s.end).getTime() > now,
  ).length;

  if (variant === "team") {
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

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="text-ink-subtle">
          {free
            ? `${free} of ${slots.length} slots open`
            : noSlotsLeftLine(slots, now)}
        </span>
        <Legend />
      </div>

      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(104px,1fr))]">
        {slots.map((slot) => (
          <SlotButton
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

function SlotButton({
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

  if (isMine) {
    return (
      <div className="rounded-xl bg-done/20 px-2 py-2.5 text-center ring-1 ring-inset ring-done/50">
        <div className="text-sm font-semibold text-done-quiet">{time}</div>
        <div className="text-[11px] text-done-quiet">yours</div>
      </div>
    );
  }

  if (slot.takenBy) {
    const meta = STATUS_META[slot.takenBy.status];
    return (
      <div
        className="rounded-xl bg-surface px-2 py-2.5 text-center ring-1 ring-inset ring-line"
        title={takenTitle(slot.takenBy)}
      >
        <div className="text-sm font-medium text-ink-faint line-through">{time}</div>
        <div className="flex items-center justify-center gap-1 text-[11px] text-ink-subtle">
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {slot.takenBy.teamNumber}
        </div>
      </div>
    );
  }

  if (past) {
    return (
      <div className="rounded-xl bg-surface px-2 py-2.5 text-center ring-1 ring-inset ring-line">
        <div className="text-sm text-ink-faint line-through">{time}</div>
        <div className="text-[11px] text-ink-faint">gone</div>
      </div>
    );
  }

  if (slot.blocked) {
    return (
      <div
        className="rounded-xl bg-surface px-2 py-2.5 text-center ring-1 ring-inset ring-line"
        title={TOO_CLOSE_TITLE}
      >
        <div className="text-sm text-ink-faint line-through">{time}</div>
        <div className="text-[11px] text-ink-faint">too close</div>
      </div>
    );
  }

  return (
    <button
      disabled={disabled}
      onClick={() => onPick(slot)}
      className="rounded-xl bg-surface px-2 py-2.5 text-center ring-1 ring-inset ring-line transition hover:bg-accent hover:text-white disabled:opacity-40"
    >
      <div className="text-sm font-semibold">{time}</div>
      <div className="text-[11px] opacity-70">free</div>
    </button>
  );
}

/**
 * The team page's tile: the same five cases as SlotButton, in the same order,
 * drawn as buttons (disabled when they can't be booked) styled under .teampage.
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

function Legend() {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-faint">
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-sm bg-surface-2" /> free
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-sm bg-line-strong" /> taken
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-sm bg-done/60" /> yours
      </span>
    </span>
  );
}
