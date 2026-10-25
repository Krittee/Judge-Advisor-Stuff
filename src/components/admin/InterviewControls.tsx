"use client";

import { useId, useMemo, useState } from "react";
import { DeskSlots } from "@/components/desk/DeskSlots";
import { slotKind } from "@/components/desk/deskLogic";
import { LanguageCover, type Language } from "@/components/Language";
import { ChevronDown } from "@/components/judge/parts";
import { formatClock } from "@/components/ui";
import { buildSlots } from "@/lib/data";
import { STATUS_META } from "@/lib/status";
import { formTimes, readTimes, reachedSteps, startTimes, TIME_STEPS, type TimeField } from "@/lib/stepTimes";
import type { PublicPanel, RequestRow, Slot, Team } from "@/lib/types";
import type { InterviewActions } from "./teamsLogic";

/* What the Edit team drawer adds to the Interview row: asking for an interview
   or booking one, moving a booking, and correcting a request's step times. The
   slot grid is the queue desk's (DeskSlots); every write goes out through
   `InterviewActions` and applies at once, not with Save changes. */

/** The desk's slot grid for one team's panel, with a confirm button under it. `move` is the booking being moved; without it a new one is made. */
export function SlotChooser({
  team,
  panel,
  requests,
  teams,
  languages,
  move,
  busy,
  onConfirm,
  onClose,
}: {
  team: Team;
  panel: PublicPanel;
  requests: RequestRow[];
  teams: Team[];
  languages: Language[];
  move: RequestRow | null;
  busy: boolean;
  /** Resolves true when it went through. */
  onConfirm: (slot: Slot, language: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const uid = useId();
  const [language, setLanguage] = useState(languages[0]?.id ?? "");
  const [picked, setPicked] = useState<string | null>(null);
  const now = Date.now();
  const slots = useMemo(() => buildSlots(panel, requests, teams, move?.id), [panel, requests, teams, move]);
  // Only a slot that is still open counts as chosen: someone else may have taken it since.
  const chosen = slots.find((s) => s.start === picked && slotKind(s, { teamId: team.id, currentStart: move?.slot_start ?? null, now }) === "open") ?? null;
  const verb = move ? "Move to" : "Book";

  return (
    <div className="ja-tm-slots">
      {!move ? (
        <div className="ja-fl">
          <label className="ja-lab" htmlFor={`${uid}-bl`}>
            Language
          </label>
          <div className="ja-selw">
            <select id={`${uid}-bl`} className="ja-in ja-sel" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {languages.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <ChevronDown />
          </div>
          <LanguageCover panel={panel} languages={languages} asking={language} />
        </div>
      ) : null}
      <DeskSlots panel={panel} slots={slots} teamId={team.id} currentStart={move?.slot_start ?? null} picked={picked} disabled={busy} onPick={(s) => setPicked(s.start)} now={now} />
      {move ? <p className="ja-hint">Language and note stay as booked.</p> : null}
      <button
        type="button"
        className="ja-prim"
        disabled={busy || !chosen}
        onClick={async () => {
          if (chosen && (await onConfirm(chosen, language))) onClose();
        }}
      >
        {chosen ? `${verb} ${formatClock(chosen.start)}` : `${move ? "Move" : "Book"} · pick a time`}
      </button>
      <button type="button" className="ja-tm-od ja-tm-ts" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

/**
 * A team with no live request: one Request button per language, and Book a time
 * (the panel's free slots). Both go to the team's saved panel, so with none (or
 * an unsaved change of it) they are off and `blocker` says why.
 */
export function RequestControls({
  team,
  panel,
  blocker,
  requests,
  teams,
  languages,
  busy,
  interview,
}: {
  team: Team;
  panel: PublicPanel | null;
  blocker: string | null;
  requests: RequestRow[];
  teams: Team[];
  languages: Language[];
  busy: boolean;
  interview: InterviewActions;
}) {
  const [booking, setBooking] = useState(false);
  const off = busy || Boolean(blocker);

  return (
    <>
      {blocker ? <p className="ja-hint">{blocker}</p> : null}
      <div className="ja-tm-rq" role="group" aria-label="Request an interview now, by language">
        {languages.map((l) => (
          <button key={l.id} type="button" className="ja-tm-ghost" disabled={off} onClick={() => interview.request(team, l.id)}>
            {`Request · ${l.label}`}
          </button>
        ))}
      </div>
      <button type="button" className="ja-tm-ghost ja-tm-bt" aria-expanded={booking} disabled={off} onClick={() => setBooking(!booking)}>
        Book a time
      </button>
      {booking && panel && !blocker ? (
        <SlotChooser
          team={team}
          panel={panel}
          requests={requests}
          teams={teams}
          languages={languages}
          move={null}
          busy={busy}
          onConfirm={(slot, language) => interview.book(team, slot, language)}
          onClose={() => setBooking(false)}
        />
      ) : null}
    </>
  );
}

/**
 * The step times of a request, one time box per step it has reached. Save times
 * is off until a box is changed to something `readTimes` (the server's rule) accepts.
 * Mounted with a key that changes when the request does, so a save starts it fresh.
 */
export function TimesBlock({
  uid,
  request,
  busy,
  onSave,
}: {
  uid: string;
  request: RequestRow;
  busy: boolean;
  onSave: (request: RequestRow, times: ReturnType<typeof formTimes>) => Promise<boolean>;
}) {
  const [form, setForm] = useState<Partial<Record<TimeField, string>>>(() => startTimes(request));
  const changes = formTimes(request, form);
  const edited = Object.keys(changes).length > 0;
  const read = edited ? readTimes(request, changes) : null;
  const problem = read && "error" in read ? read.error : null;
  const steps = TIME_STEPS.filter((s) => reachedSteps(request).includes(s.field));

  return (
    <div className="ja-fl">
      <h3 className="ja-lab">Times</h3>
      <div className="ja-tm-tt">
        {steps.map(({ field, label }) => (
          <div key={field} className="ja-tm-tr">
            <label className="ja-lab" htmlFor={`${uid}-t-${field}`}>
              {label}
            </label>
            <input
              id={`${uid}-t-${field}`}
              className="ja-in"
              type="time"
              value={form[field] ?? ""}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
            />
          </div>
        ))}
      </div>
      {problem ? (
        <p className="ja-err" role="status">
          {problem}
        </p>
      ) : null}
      <button type="button" className="ja-tm-ghost" disabled={busy || !edited || Boolean(problem)} onClick={() => onSave(request, changes)}>
        Save times
      </button>
      <p className="ja-hint">{STATUS_META[request.status].label} · Bangkok time, on the request&apos;s own day. Saved at once; the status stays.</p>
    </div>
  );
}
