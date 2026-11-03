"use client";

import { canBook, CHOOSE_TEAM_LINE, type SlotsModel } from "./coordinatorLogic";
import type { CoordinatorViewProps } from "./CoordinatorView";
import { Info, Pill } from "./TeamsTab";
import { divisionTag } from "@/components/admin/floorLogic";
import { CautionIcon } from "@/components/desk/DeskSlots";
import { slotTime } from "@/components/desk/deskLogic";
import { LanguageCover, LanguageTag, type Language } from "@/components/Language";
import { noSlotsLeftLine, TOO_CLOSE_TITLE, takenTitle } from "@/components/SlotPicker";
import type { Slot, Team } from "@/lib/types";

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function Caution({ children }: { children: React.ReactNode }) {
  return (
    <div className="dk-caution" role="note">
      <CautionIcon />
      <p>{children}</p>
    </div>
  );
}

/**
 * One panel's day: a row per slot still to come. A taken slot reads who has
 * it and where they are, nothing more -- moving or cancelling is the queue
 * desk's. An open slot has a Book button, live only for the chosen team on
 * its own panel; pressing it picks the slot and the pinned bar books it.
 */
export function SlotsTab(p: CoordinatorViewProps & { model: SlotsModel; now: number }) {
  const { model } = p;
  const { panel, bar, chosen } = model;
  if (!panel) return <p className="co-empty">No panels yet — the Judge Advisor sets them up.</p>;

  const teamById = new Map(p.teams.map((t) => [t.id, t]));

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
            {model.lines.map((line) => {
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
            })}
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
}: {
  model: SlotsModel;
  languages: Language[];
  busy: boolean;
  onBook: (team: Team, slot: Slot, language: string) => void;
}) {
  const { bar, chosen } = model;
  const ready = bar.kind === "ready";
  const label = ready ? (chosen ? `Book ${slotTime(chosen.start)}` : "Book · pick a time") : "Book";

  return (
    <div className="co-pinb" role="group" aria-label="Booking">
      <div className="co-pb-l">
        {bar.kind === "none" ? (
          <span>{CHOOSE_TEAM_LINE}</span>
        ) : (
          <>
            <span>Booking for</span>
            <b>{bar.team.number}</b>
            {bar.kind === "ready" ? (
              <>
                <span className="co-lts">
                  <LanguageTag language={bar.language} languages={languages} />
                </span>
                <span className="co-pb-s">
                  <LanguageCover panel={bar.panel} languages={languages} asking={bar.language} />
                </span>
              </>
            ) : (
              <span className="co-pb-s">{bar.line}</span>
            )}
          </>
        )}
      </div>
      <button
        type="button"
        className="co-prim"
        disabled={busy || bar.kind !== "ready" || !chosen}
        onClick={() => bar.kind === "ready" && chosen && onBook(bar.team, chosen, bar.language)}
      >
        {label}
      </button>
    </div>
  );
}
