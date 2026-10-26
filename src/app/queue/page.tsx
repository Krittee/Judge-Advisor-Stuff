"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { liveRequestFor } from "@/lib/data";
import { call, useAppState } from "@/components/useAppState";
import { formatClock } from "@/components/ui";
import { useConfirm } from "@/components/ConfirmDialog";
import { DeskView, type DeskMode } from "@/components/desk/DeskView";
import { cancelBookingAfterAsking } from "@/components/desk/deskLogic";
import { normalizeTeamNumber } from "@/lib/teamNumber";
import type { Session } from "@/lib/auth";
import type { RequestRow, Slot } from "@/lib/types";

/**
 * The queue desk. This role can put teams into the queue — either way
 * round: straight into the walk-up queue, or booked onto a specific slot.
 * It cannot advance an interview, and it never sees judging notes.
 *
 * What is drawn is in components/desk/DeskView.tsx (direction B, "Now / Book",
 * design/queue-redesign/). This page keeps the polling and every write.
 */
export default function QueuePage() {
  const router = useRouter();
  const { state, online, refresh } = useAppState(4000);
  const { ask, dialog } = useConfirm();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  const [mode, setMode] = useState<DeskMode>("now");
  const [number, setNumber] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bookLanguage, setBookLanguage] = useState("");
  /** The start of the slot picked in the grid. */
  const [picked, setPicked] = useState<string | null>(null);
  /** A booking being moved to a new time, not cancelled and rebooked from
   *  scratch -- set from either the "Booked later" list or the banner
   *  that appears when the entered team already holds a slot. */
  const [reschedule, setReschedule] = useState<RequestRow | null>(null);

  useEffect(() => {
    call<{ session: Session | null }>("/api/session", { method: "GET" })
      .then(({ session }) => {
        if (!session) {
          router.replace("/queue/login");
          return;
        }
        setSession(session);
      })
      .catch(() => router.replace("/queue/login"));
  }, [router]);

  // Default the booking language once the config has arrived.
  useEffect(() => {
    if (!bookLanguage && state.languages.length) setBookLanguage(state.languages[0].id);
  }, [bookLanguage, state.languages]);

  const teamByNumber = useMemo(
    () => new Map(state.teams.map((t) => [t.number, t])),
    [state.teams],
  );
  const panelById = useMemo(() => new Map(state.panels.map((p) => [p.id, p])), [state.panels]);

  const team = teamByNumber.get(normalizeTeamNumber(number)) ?? null;
  const panel = team?.panel_id ? (panelById.get(team.panel_id) ?? null) : null;

  // What this team already has, so the desk is not the last to know.
  // A live queue entry and a future booking are different problems: the
  // first is a duplicate, the second is a slot that would go to waste.
  const existing = team ? liveRequestFor(team.id, state.requests) : null;
  const booking = existing?.status === "scheduled" ? existing : null;

  // True only while the team number on screen is the one actually being
  // rescheduled -- entering a different number (or the booking finishing
  // or being cancelled elsewhere) drops back to a normal new booking.
  const isRescheduling = Boolean(reschedule && booking && reschedule.id === booking.id);
  useEffect(() => {
    if (reschedule && (!booking || booking.id !== reschedule.id)) setReschedule(null);
  }, [reschedule, booking]);

  function clear() {
    setNumber("");
    setMessage("");
    setPicked(null);
  }

  /** `bookingId`: turn that booking into the request in place, rather than creating a second one. */
  async function submit(body: Record<string, unknown>, done: string, bookingId?: string) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await (bookingId
        ? call(`/api/requests/${bookingId}`, { method: "PATCH", body: { action: "ready-now", ...body } })
        : call("/api/requests", { body }));
      setOk(done);
      clear();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Queue the team now.
   *
   * If they already hold a later slot, that booking becomes the queue
   * request in place — a team being seen now does not also need a booking
   * at 2pm, and leaving one behind makes the schedule lie about how full it
   * is. One call rather than cancel-then-create: if the second step failed,
   * the team was left with neither the slot nor a place in line.
   */
  function interviewNow(language: string) {
    return submit(
      { teamNumber: number, kind: "queue", language, message: message.trim() || undefined },
      booking
        ? `Team ${normalizeTeamNumber(number)} queued now; their ${formatClock(booking.slot_start)} slot is free again.`
        : `Team ${normalizeTeamNumber(number)} added to the queue.`,
      booking?.id,
    );
  }

  const bookSlot = (slot: Slot, language: string) =>
    submit(
      {
        teamNumber: number,
        kind: "slot",
        language,
        slotStart: slot.start,
        slotEnd: slot.end,
        message: message.trim() || undefined,
      },
      `Team ${normalizeTeamNumber(number)} booked for ${formatClock(slot.start)}.`,
    );

  /**
   * Move a team asking to reschedule straight to a new time, in one
   * request. What used to be here was cancel, then re-enter the team
   * number, then book again -- three chances to mistype or to leave the
   * team's old slot cancelled with nothing booked in its place.
   */
  function startReschedule(booked: RequestRow, teamNumber: string) {
    setMode("book");
    setNumber(teamNumber);
    setMessage("");
    setReschedule(booked);
    setPicked(null);
    setError(null);
    setOk(null);
    // Clicked from the "Booked later" list further down the page; the
    // bar and slot grid that actually do the rescheduling are up top.
    window.scrollTo({ top: 0 });
  }

  function cancelReschedule() {
    setReschedule(null);
    setPicked(null);
  }

  /** Cancel the booking being moved. It asks first: it is the one thing the desk cannot take back. */
  async function cancelBooking() {
    if (!reschedule) return;
    const teamNumber = normalizeTeamNumber(number);
    await cancelBookingAfterAsking(ask, teamNumber, reschedule, async () => {
      setBusy(true);
      setError(null);
      setOk(null);
      try {
        await call(`/api/requests/${reschedule.id}`, { method: "PATCH", body: { action: "cancel" } });
        setOk(`Team ${teamNumber}'s ${formatClock(reschedule.slot_start)} booking cancelled.`);
        setReschedule(null);
        clear();
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    });
  }

  async function doReschedule(slot: Slot) {
    if (!reschedule) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await call(`/api/requests/${reschedule.id}`, {
        method: "PATCH",
        body: { action: "reschedule", slotStart: slot.start, slotEnd: slot.end },
      });
      setOk(`Team ${normalizeTeamNumber(number)} moved to ${formatClock(slot.start)}.`);
      setReschedule(null);
      clear();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function undo(id: string) {
    setError(null);
    try {
      await call(`/api/requests/${id}`, { method: "PATCH", body: { action: "cancel" } });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (session === undefined) {
    return <p className="p-10 text-center text-ink-faint">Loading…</p>;
  }

  return (
    <>
      <DeskView
        name={session?.name}
        online={online}
        teams={state.teams}
        panels={state.panels}
        requests={state.requests}
        languages={state.languages}
        categories={state.categories}
        mode={mode}
        onMode={(id) => {
          setMode(id);
          setReschedule(null);
          setPicked(null);
          setError(null);
          setOk(null);
        }}
        number={number}
        onNumber={(n) => {
          setNumber(n);
          setPicked(null);
          setError(null);
          setOk(null);
        }}
        team={team}
        panel={panel}
        existing={existing}
        message={message}
        onMessage={setMessage}
        bookLanguage={bookLanguage}
        onBookLanguage={setBookLanguage}
        reschedule={isRescheduling ? reschedule : null}
        picked={picked}
        onPick={setPicked}
        busy={busy}
        error={error}
        ok={ok}
        onRequest={interviewNow}
        onUndo={undo}
        onBook={(slot) => bookSlot(slot, bookLanguage)}
        onMove={doReschedule}
        onStartReschedule={startReschedule}
        onStopReschedule={cancelReschedule}
        onCancelBooking={cancelBooking}
      />
      {dialog}
    </>
  );
}
