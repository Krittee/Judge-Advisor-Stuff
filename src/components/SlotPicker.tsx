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

/** How busy this panel is right now, in one line. */
export function PanelBusyLine({ load }: { load: PanelLoad }) {
  if (!load.waiting && !load.interviewing) {
    return <span className="text-emerald-400">Panel is free right now</span>;
  }

  const parts: string[] = [];
  if (load.interviewing) parts.push(`${load.interviewing} in interview`);
  if (load.waiting) {
    parts.push(
      `${load.waiting} already waiting${load.longestWait ? ` (longest ${load.longestWait} min)` : ""}`,
    );
  }
  return <span className="text-amber-400">{parts.join(" · ")}</span>;
}

export function SlotPicker({
  panel,
  requests,
  teams,
  teamId,
  disabled,
  onPick,
}: {
  panel: PublicPanel;
  requests: RequestRow[];
  teams: Team[];
  /** The team being booked, so their own slot reads as theirs. */
  teamId: string | null;
  disabled?: boolean;
  onPick: (slot: Slot) => void;
}) {
  const slots = useMemo(
    () => buildSlots(panel, requests, teams),
    [panel, requests, teams],
  );

  if (!slots.length) {
    return (
      <div className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200 ring-1 ring-inset ring-amber-500/30">
        <strong>{panel.name} has no bookable times set up yet.</strong>
        <p className="mt-1 text-amber-200/80">
          Use <strong>Interview now</strong> instead, or ask the Judge Advisor to add times:
          Admin → Panels → {panel.name} → Booking slots.
        </p>
      </div>
    );
  }

  const now = Date.now();
  const free = slots.filter((s) => !s.takenBy && new Date(s.end).getTime() > now).length;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="text-zinc-400">
          {free
            ? `${free} of ${slots.length} slots open`
            : `All ${slots.length} slots are taken — nothing left to book`}
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
      <div className="rounded-xl bg-emerald-500/20 px-2 py-2.5 text-center ring-1 ring-inset ring-emerald-400/50">
        <div className="text-sm font-semibold text-emerald-200">{time}</div>
        <div className="text-[11px] text-emerald-300/90">yours</div>
      </div>
    );
  }

  if (slot.takenBy) {
    const meta = STATUS_META[slot.takenBy.status];
    return (
      <div
        className="rounded-xl bg-white/[0.03] px-2 py-2.5 text-center ring-1 ring-inset ring-white/10"
        title={`Taken by team ${slot.takenBy.teamNumber} — ${meta.label}`}
      >
        <div className="text-sm font-medium text-zinc-500 line-through">{time}</div>
        <div className="flex items-center justify-center gap-1 text-[11px] text-zinc-400">
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {slot.takenBy.teamNumber}
        </div>
      </div>
    );
  }

  if (past) {
    return (
      <div className="rounded-xl bg-white/[0.02] px-2 py-2.5 text-center ring-1 ring-inset ring-white/[0.06]">
        <div className="text-sm text-zinc-600 line-through">{time}</div>
        <div className="text-[11px] text-zinc-700">gone</div>
      </div>
    );
  }

  return (
    <button
      disabled={disabled}
      onClick={() => onPick(slot)}
      className="rounded-xl bg-white/5 px-2 py-2.5 text-center ring-1 ring-inset ring-white/10 transition hover:bg-indigo-500 hover:text-white disabled:opacity-40"
    >
      <div className="text-sm font-semibold">{time}</div>
      <div className="text-[11px] opacity-70">free</div>
    </button>
  );
}

function Legend() {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-zinc-600">
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-sm bg-white/20" /> free
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-sm bg-zinc-600" /> taken
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-sm bg-emerald-500/60" /> yours
      </span>
    </span>
  );
}
