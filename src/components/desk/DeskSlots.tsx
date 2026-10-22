"use client";

import { useId } from "react";
import { noSlotsLeftLine, TOO_CLOSE_TITLE, takenTitle } from "@/components/SlotPicker";
import { clockParts } from "@/components/team/teamLogic";
import type { PublicPanel, Slot } from "@/lib/types";
import { slotGrid, slotTime, type SlotKind } from "./deskLogic";

export function CautionIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5l9.5 16.5h-19L12 3.5zM12 10v4.5M12 17.2v.01" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** What each slot that cannot be booked says under its time, and to a screen reader. */
function offLine(slot: Slot, kind: SlotKind): { small: string; reading: string; title?: string } | null {
  switch (kind) {
    case "theirs":
      return { small: "theirs", reading: "their other booking" };
    case "current":
      return { small: "current", reading: "current booking" };
    case "taken":
      return {
        small: slot.takenBy!.teamNumber,
        reading: `taken by ${slot.takenBy!.teamNumber}`,
        title: takenTitle(slot.takenBy!),
      };
    case "too-close":
      return { small: "too close", reading: "too close to another booking", title: TOO_CLOSE_TITLE };
    default:
      return null;
  }
}

/**
 * The desk's slot grid: one row per hour, the hour on the left and the slots
 * in fixed columns, past slots left out. Only open slots can be pressed.
 * Taken, too close and theirs all look "off" and the small line under the
 * time tells them apart; there are no status colours on a slot.
 */
export function DeskSlots({
  panel,
  slots,
  teamId,
  currentStart = null,
  picked,
  disabled,
  onPick,
  now = Date.now(),
}: {
  panel: PublicPanel;
  /** buildSlots' answer for this panel (with excludeRequestId while rescheduling). */
  slots: Slot[];
  /** The team on screen, so a slot it holds reads as theirs. */
  teamId: string | null;
  /** While rescheduling: the start of the booking being moved. */
  currentStart?: string | null;
  /** The start of the slot chosen so far. */
  picked: string | null;
  disabled?: boolean;
  onPick: (slot: Slot) => void;
  now?: number;
}) {
  const labelId = useId();

  if (!slots.length) {
    return (
      <div className="dk-caution" role="note">
        <CautionIcon />
        <p>
          <strong>{panel.name} has no bookable times set up yet.</strong> Use Request now instead,
          or ask the Judge Advisor to add times (Panels → {panel.name} → Booking slots).
        </p>
      </div>
    );
  }

  const grid = slotGrid(slots, panel.slot_minutes, { teamId, currentStart, now });

  return (
    <div>
      <div className="dk-lab" id={labelId}>
        <span>
          {panel.name} · {panel.slot_minutes} min slots
        </span>
        <span className="dk-tag">
          {grid.open} of {grid.shown} open
        </span>
      </div>

      {grid.open === 0 ? (
        <div className="dk-caution" role="note">
          <CautionIcon />
          <p>{noSlotsLeftLine(slots, now)}</p>
        </div>
      ) : (
        <div className="dk-slots" role="group" aria-labelledby={labelId}>
          {grid.rows.map((row) => {
            const hour = clockParts(row.hourStart);
            return (
              <div
                key={row.hourStart}
                className="dk-hrow"
                style={{ gridTemplateColumns: `56px repeat(${grid.columns}, minmax(0, 1fr))` }}
              >
                <h3>
                  {hour.time}
                  {hour.period ? <small>{hour.period}</small> : null}
                </h3>
                {row.cells.map(({ slot, kind, column, row: line }) => {
                  const at = { gridColumn: column + 2, gridRow: line + 1 };
                  const time = slotTime(slot.start);
                  const off = offLine(slot, kind);
                  if (off) {
                    return (
                      <button
                        key={slot.start}
                        type="button"
                        className={`dk-slot dk-slot--${kind}`}
                        style={at}
                        disabled
                        aria-current={kind === "current" ? "true" : undefined}
                        aria-label={`${time}, ${off.reading}`}
                        title={off.title}
                      >
                        <b>{time}</b>
                        <small>{off.small}</small>
                      </button>
                    );
                  }
                  const selected = slot.start === picked;
                  return (
                    <button
                      key={slot.start}
                      type="button"
                      className="dk-slot"
                      style={at}
                      disabled={disabled}
                      aria-pressed={selected}
                      onClick={() => onPick(slot)}
                    >
                      <b>
                        {selected ? <Check /> : null}
                        {time}
                      </b>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
