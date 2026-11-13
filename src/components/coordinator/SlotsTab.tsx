"use client";

import { Fragment } from "react";
import { canBook, NO_PANEL_LINE, SET_LANGUAGE_LINE, type SlotLine, type SlotsModel } from "./coordinatorLogic";
import type { CoordinatorViewProps } from "./CoordinatorView";
import { Info, Pill } from "./TeamsTab";
import { divisionTag } from "@/components/admin/floorLogic";
import { BreakIcon, Caution, Check } from "@/components/desk/DeskSlots";
import { slotTime } from "@/components/desk/deskLogic";
import { LanguageCover, LanguageTag, type Language } from "@/components/Language";
import { noSlotsLeftLine, TOO_CLOSE_TITLE, takenTitle } from "@/components/SlotPicker";
import { dayPrefix } from "@/components/ui";
import { bookingLanguage } from "@/lib/presets";
import type { Slot, Team } from "@/lib/types";

/**
 * One panel's day: a row per slot still to come. A taken slot reads who has
 * it and where they are, nothing more -- moving or cancelling is the queue
 * desk's. An open slot has a Book button, live only for the chosen team on
 * its own panel; pressing it picks the slot and the pinned bar books it.
 */
export function SlotsTab(p: CoordinatorViewProps & { model: SlotsModel; now: number }) {
  const { model } = p;
  const { panel, bar, chosen } = model;
  if (!panel) return <p className="dk-empty">No panels yet — the Judge Advisor sets them up.</p>;

  const teamById = new Map(p.teams.map((t) => [t.id, t]));

  const renderLine = (line: SlotLine) => {
    const { slot, kind } = line;
    const time = slotTime(slot.start);

    if (slot.takenBy) {
      return (
        <li key={slot.start} className="co-srow" title={takenTitle(slot.takenBy)}>
          <span className="co-st">{time}</span>
          <span className="co-sh">
            <b>{slot.takenBy.teamNumber}</b>
            <span>{teamById.get(slot.takenBy.teamId)?.name}</span>
          </span>
          <Pill request={{ status: slot.takenBy.status, slot_start: null }} />
        </li>
      );
    }

    const picked = chosen?.start === slot.start;
    const tooClose = kind === "too-close";
    return (
      <li key={slot.start} className="co-srow" data-picked={picked}>
        <span className="co-st">{time}</span>
        <span className="co-so" title={tooClose ? TOO_CLOSE_TITLE : undefined}>
          {tooClose ? "Too close" : "Open"}
        </span>
        <button
          type="button"
          className="co-bk"
          aria-pressed={picked}
          aria-label={tooClose ? `Book ${time}, too close to another booking` : `Book ${time}`}
          title={tooClose ? TOO_CLOSE_TITLE : undefined}
          disabled={p.busy || !canBook(bar, line)}
          onClick={() => p.onPick(picked ? null : slot.start)}
        >
          {picked ? (
            <>
              <Check />
              Picked
            </>
          ) : (
            "Book"
          )}
        </button>
      </li>
    );
  };

  return (
    <>
      <div className="co-pcs" role="group" aria-label="Panel">
        {p.panels.map((x) => (
          <button key={x.id} type="button" className="co-pc" aria-pressed={x.id === panel.id} onClick={() => p.onPanelPick(x.id)}>
            {x.name}
          </button>
        ))}
      </div>

      <section className="co-grp" aria-labelledby="co-g-h">
        <div className="co-gh">
          <h2 id="co-g-h">
            {panel.name} · {divisionTag(panel.division)}
          </h2>
          <span className="co-lts">
            {panel.languages.map((id) => (
              <LanguageTag key={id} language={id} languages={p.languages} />
            ))}
          </span>
          {model.lines.length ? (
            <span className="co-cnt">
              {model.open} of {model.lines.length} open
            </span>
          ) : null}
        </div>

        {!model.slots.length ? (
          <Caution>
            <strong>{panel.name} has no bookable times set up yet.</strong> Ask the Judge Advisor to add times (Panels → {panel.name} → Booking slots).
          </Caution>
        ) : model.open === 0 ? (
          <Caution>{noSlotsLeftLine(model.slots, p.now)}</Caution>
        ) : null}

        {model.lines.length ? (
          <ul className="co-sl" aria-label={`${panel.name} time slots, ${panel.slot_minutes} minutes each`}>
            {model.days.map((day) => (
              <Fragment key={day.day}>
                {model.showDayHeadings ? (
                  <li className="co-dh">
                    <b>{day.label}</b>
                    <span>{day.open} open</span>
                  </li>
                ) : null}
                {day.rows.map((row) => (
                  <Fragment key={row.hourStart}>
                    {row.cells.map(renderLine)}
                    {row.hourStart === day.breakAfterHour ? (
                      <li className="co-brk">
                        <BreakIcon />
                        <span>{day.breakLabel}</span>
                      </li>
                    ) : null}
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </ul>
        ) : null}

        <p className="co-ro">
          <Info />
          <span>Booked slots show here read-only. To change one, ask the queue desk.</span>
        </p>
      </section>
    </>
  );
}

/** Above the tab bar: who the booking is for, and the one button that makes it. */
export function BookingBar({
  model,
  languages,
  busy,
  onBook,
  now,
}: {
  model: SlotsModel;
  languages: Language[];
  busy: boolean;
  onBook: (team: Team, slot: Slot, language: string) => void;
  now: number;
}) {
  const { bar, chosen } = model;
  const ready = bar.kind === "ready";
  const language = bar.kind === "ready" ? bookingLanguage(undefined, bar.team, bar.panel) : "";
  const label = ready ? (chosen ? `Book ${dayPrefix(chosen.start, now)}${slotTime(chosen.start)}` : "Book · pick a time") : "Book";

  return (
    <div className="co-pinb" role="group" aria-label="Booking">
      <div className="co-pb-l">
        {bar.kind === "none" ? (
          <span>Choose a team on the Teams tab</span>
        ) : (
          <>
            <span>Booking for</span>
            <b>{bar.team.number}</b>
            {bar.kind === "ready" ? (
              <>
                <span className="co-lts">
                  <LanguageTag language={language} languages={languages} />
                </span>
                <span className="co-pb-s">
                  <LanguageCover panel={bar.panel} languages={languages} asking={language} />
                </span>
              </>
            ) : (
              <span className="co-pb-s">
                {bar.kind === "held" ? "Already booked — the queue desk can change it." : bar.kind === "no-language" ? SET_LANGUAGE_LINE : NO_PANEL_LINE}
              </span>
            )}
          </>
        )}
      </div>
      <button
        type="button"
        className="dk-prim dk-lg"
        disabled={busy || bar.kind !== "ready" || !chosen}
        onClick={() => bar.kind === "ready" && chosen && onBook(bar.team, chosen, language)}
      >
        {label}
      </button>
    </div>
  );
}
