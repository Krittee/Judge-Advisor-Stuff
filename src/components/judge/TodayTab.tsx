"use client";

import { Fragment } from "react";
import { formatClock } from "@/components/ui";
import type { AppState, PublicPanel, RequestRow, Slot, Team } from "@/lib/types";
import { Dot, StatusPill } from "./parts";
import { clockParts, completedBeforeSlots, dueText, nowIndex, slotsToday, teamMeta } from "./logic";

/**
 * The Today tab: the panel's booking grid for today as a timeline, with a
 * static rule at the current time. The rule is where `now` falls when the
 * page last drew; it does not move between polls and nothing animates.
 */
export function TodayTab({
  panel,
  slots: allSlots,
  teams,
  panelTeams,
  requests,
  categories,
  now,
  onOpen,
}: {
  panel: Pick<PublicPanel, "name" | "slot_minutes">;
  /** All the panel's slots; only today's are drawn. */
  slots: Slot[];
  /** Every team: a slot's holder can be looked up by id. */
  teams: Team[];
  /** This panel's teams, for the ones interviewed before the first slot. */
  panelTeams: Team[];
  requests: RequestRow[];
  categories: AppState["categories"];
  now: number;
  onOpen: (team: Team) => void;
}) {
  if (!allSlots.length) {
    return (
      <p className="jg-empty">
        This panel has no booking slots. The Judge Advisor sets them up from the admin console.
      </p>
    );
  }

  const { today: slots, otherDay } = slotsToday(allSlots, now);
  if (otherDay) {
    return <p className="jg-empty">{`No slots today. ${panel.name}'s slots are on ${otherDay}.`}</p>;
  }

  const booked = slots.filter((s) => s.takenBy).length;
  const early = completedBeforeSlots(slots, requests, panelTeams);
  const at = nowIndex(slots, now);
  const nowRule = (
    <div className="jg-now" role="separator" aria-label={`Now, ${formatClock(new Date(now).toISOString())}`}>
      <span>Now {formatClock(new Date(now).toISOString())}</span>
      <i aria-hidden="true" />
    </div>
  );

  return (
    <>
      <div className="jg-sh2 jg-sh2--tight">
        <div className="jg-s1">
          <h2>Today&apos;s slots</h2>
          <span>
            {booked} of {slots.length} booked
          </span>
        </div>
        <p className="jg-cap">
          {panel.name} · {panel.slot_minutes} min each
        </p>
      </div>

      {early ? (
        <p className="jg-early">
          <Dot status="completed" />
          Before {formatClock(early.before)} · {early.teams.map((t) => t.number).join(", ")} complete
        </p>
      ) : null}

      <div className="jg-tl">
        {slots.map((slot, i) => {
          const held = slot.takenBy;
          const team = held ? teams.find((t) => t.id === held.teamId) : undefined;
          const { time, period } = clockParts(slot.start);
          const due = held?.status === "scheduled" ? dueText(slot.start, now) : null;
          return (
            <Fragment key={slot.start}>
              {i === at ? nowRule : null}
              <div className={`jg-sl ${!held && Date.parse(slot.start) <= now ? "jg-past" : ""}`}>
                <span className="jg-tcol">
                  {time}
                  {period ? <small>{period}</small> : null}
                </span>
                {held ? (
                  <button
                    type="button"
                    className="jg-scard"
                    disabled={!team}
                    onClick={() => team && onOpen(team)}
                  >
                    <span className="jg-qt">
                      <span className="jg-q1">
                        <b>{held.teamNumber}</b>
                        <span>{team?.name}</span>
                      </span>
                      <span className="jg-q2">
                        {team ? teamMeta(team, categories) : null}
                        {due ? (
                          <>
                            {team ? " · " : null}
                            <b>{due}</b>
                          </>
                        ) : null}
                      </span>
                    </span>
                    <StatusPill status={held.status} short />
                  </button>
                ) : (
                  <div className="jg-scard jg-open">
                    <span>Open</span>
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}
        {at === slots.length ? nowRule : null}
      </div>
    </>
  );
}
