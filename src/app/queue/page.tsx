"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { liveRequestFor } from "@/lib/data";
import { STATUS_META } from "@/lib/status";
import { call, useAppState } from "@/components/useAppState";
import {
  Banner,
  BookingTime,
  Button,
  Elapsed,
  formatClock,
  inputClass,
  StatusChip,
  TopBar,
} from "@/components/ui";
import { SignOutButton } from "@/components/judging";
import { PanelBusyLine, panelLoad, SlotPicker } from "@/components/SlotPicker";
import { CategoryChip } from "@/components/CategoryChip";
import { LanguageCover, LanguageTag } from "@/components/Language";
import { filterTeamNumberInput, normalizeTeamNumber } from "@/lib/teamNumber";
import type { Session } from "@/lib/auth";
import type { RequestRow, Slot } from "@/lib/types";

type Mode = "now" | "book";

/**
 * The queue desk. This role can put teams into the queue — either way
 * round: straight into the walk-up queue, or booked onto a specific slot.
 * It cannot advance an interview, and it never sees judging notes.
 */
export default function QueuePage() {
  const router = useRouter();
  const { state, online, refresh } = useAppState(4000);
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  const [mode, setMode] = useState<Mode>("now");
  const [number, setNumber] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bookLanguage, setBookLanguage] = useState("");
  /** A booking being moved to a new time, not cancelled and rebooked from
   *  scratch -- set from either the "Booked later" list or the banner
   *  that appears when the entered team already holds a slot. */
  const [reschedule, setReschedule] = useState<RequestRow | null>(null);

  useEffect(() => {
    call<{ session: Session | null }>("/api/session", { method: "GET" })
      .then(({ session }) => {
        if (!session) {
          router.replace("/login");
          return;
        }
        setSession(session);
      })
      .catch(() => router.replace("/login"));
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
  const alreadyQueued = existing && existing.status !== "scheduled" ? existing : null;
  const load = panel ? panelLoad(panel.id, state.requests) : null;

  // True only while the team number on screen is the one actually being
  // rescheduled -- entering a different number (or the booking finishing
  // or being cancelled elsewhere) drops back to a normal new booking.
  const isRescheduling = Boolean(reschedule && booking && reschedule.id === booking.id);
  useEffect(() => {
    if (reschedule && (!booking || booking.id !== reschedule.id)) setReschedule(null);
  }, [reschedule, booking]);

  const live = useMemo(
    () =>
      state.requests
        .filter((r) => r.status === "requested" || r.status === "acknowledged")
        .sort((a, b) => a.requested_at.localeCompare(b.requested_at)),
    [state.requests],
  );

  const booked = useMemo(
    () =>
      state.requests
        .filter((r) => r.status === "scheduled")
        .sort((a, b) => (a.slot_start ?? "").localeCompare(b.slot_start ?? "")),
    [state.requests],
  );

  function clear() {
    setNumber("");
    setMessage("");
  }

  async function submit(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await call("/api/requests", { body });
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
   * If they already hold a later slot, release it first — a team being
   * seen now does not also need a booking at 2pm, and leaving one behind
   * makes the schedule lie about how full it is.
   */
  async function interviewNow(language: string) {
    if (booking) {
      setBusy(true);
      setError(null);
      try {
        await call(`/api/requests/${booking.id}`, {
          method: "PATCH",
          body: { action: "cancel" },
        });
        await refresh();
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
        return;
      }
      setBusy(false);
    }

    await submit(
      { teamNumber: number, kind: "queue", language, message: message.trim() || undefined },
      booking
        ? `Team ${normalizeTeamNumber(number)} queued now; their ${formatClock(booking.slot_start)} slot is free again.`
        : `Team ${normalizeTeamNumber(number)} added to the queue.`,
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
    setError(null);
    setOk(null);
    // Clicked from the "Booked later" list further down the page; the
    // banner and slot picker that actually do the rescheduling are up top.
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelReschedule() {
    setReschedule(null);
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
      <TopBar
        title="Judge Queue"
        subtitle="Queue desk"
        online={online}
        role={state.viewer.role}
        current="/queue"
        right={<SignOutButton />}
      />

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        {/* ---- which kind of request ---------------------------------- */}
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface p-1">
          {(
            [
              ["now", "Interview now"],
              ["book", "Book a time"],
            ] as [Mode, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => {
                setMode(id);
                setReschedule(null);
                setError(null);
                setOk(null);
              }}
              className={`rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                mode === id ? "bg-accent text-white" : "text-ink-subtle hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ---- team number ------------------------------------------- */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-ink-muted">Team number</label>
          <input
            value={number}
            onChange={(e) => {
              setNumber(filterTeamNumberInput(e.target.value));
              setError(null);
              setOk(null);
            }}
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            autoFocus
            placeholder="0000"
            className={`${inputClass} py-5 text-center text-4xl font-bold tracking-widest`}
          />

          <div className="min-h-[2.5rem] text-center text-sm">
            {team ? (
              <>
                <div className="flex items-center justify-center gap-2 text-ink-muted">
                  <CategoryChip category={team.category} categories={state.categories} />
                  {team.name}
                  <span className="text-ink-faint">
                    {panel ? ` → ${panel.name} · ${team.division}` : ""}
                  </span>
                </div>
                {!panel ? (
                  <div className="text-caution-quiet">No judge panel assigned yet</div>
                ) : load ? (
                  <div className="text-xs">
                    <PanelBusyLine load={load} />
                  </div>
                ) : null}
              </>
            ) : number ? (
              <span className="text-ink-faint">not found</span>
            ) : null}
          </div>
        </div>

        {/* ---- conflicts this team already has ------------------------ */}
        {alreadyQueued ? (
          <Banner kind="error">
            <strong>Team {team?.number} is already in the queue.</strong>{" "}
            {STATUS_META[alreadyQueued.status].label}. They cannot be added twice — use the list
            below to find them.
          </Banner>
        ) : null}

        {booking && !isRescheduling ? (
          <Banner kind="info">
            <strong>
              Team {team?.number} is already booked for {formatClock(booking.slot_start)}.
            </strong>{" "}
            {mode === "now" ? (
              "Queueing them now will release that slot for someone else."
            ) : (
              <>
                Asking to move it?{" "}
                <button
                  onClick={() => startReschedule(booking, team!.number)}
                  className="font-medium underline underline-offset-2"
                >
                  Reschedule
                </button>{" "}
                instead of cancelling and booking again.
              </>
            )}
          </Banner>
        ) : null}

        {isRescheduling && booking ? (
          <Banner kind="info">
            <strong>
              Rescheduling team {team?.number}&apos;s {formatClock(booking.slot_start)} slot.
            </strong>{" "}
            Pick a new time below —{" "}
            <button onClick={cancelReschedule} className="font-medium underline underline-offset-2">
              never mind
            </button>
            .
          </Banner>
        ) : null}

        {error ? <Banner kind="error">{error}</Banner> : null}
        {ok ? <Banner kind="success">{ok}</Banner> : null}

        {/* ---- the action -------------------------------------------- */}
        {mode === "now" ? (
          <div className="space-y-3">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Optional note for the judges"
              maxLength={280}
              className={inputClass}
            />
            {/* One button per language: the desk is told which the team
                wants, so asking is one tap rather than a tap and a menu. */}
            <div className="grid gap-2 sm:grid-cols-2">
              {state.languages.map((lang) => (
                <Button
                  key={lang.id}
                  variant="warn"
                  size="lg"
                  className="w-full"
                  disabled={busy || !team || !panel || Boolean(alreadyQueued)}
                  onClick={() => interviewNow(lang.id)}
                >
                  {booking ? `Now — ${lang.label}` : `Request — ${lang.label}`}
                </Button>
              ))}
            </div>
            {booking ? (
              <p className="text-center text-xs text-ink-faint">
                Either button frees their {formatClock(booking.slot_start)} slot.
              </p>
            ) : null}
            {team && panel ? (
              <LanguageCover panel={panel} languages={state.languages} />
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            {!team ? (
              <p className="rounded-xl bg-surface px-4 py-3 text-sm text-ink-faint">
                Enter a team number to see their panel&apos;s times.
              </p>
            ) : !panel ? (
              <p className="rounded-xl bg-surface px-4 py-3 text-sm text-caution-quiet">
                This team has no judge panel yet, so there is nothing to book.
              </p>
            ) : isRescheduling ? (
              // Only the time changes here -- language and any note stay
              // exactly as they were on the original booking.
              <SlotPicker
                panel={panel}
                requests={state.requests}
                teams={state.teams}
                teamId={team.id}
                excludeRequestId={reschedule!.id}
                disabled={busy}
                onPick={doReschedule}
              />
            ) : (
              <>
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Optional note for the judges"
                  maxLength={280}
                  className={inputClass}
                />
                <label className="block text-sm">
                  <span className="mb-1 block text-xs text-ink-subtle">Interview language</span>
                  <select
                    value={bookLanguage}
                    onChange={(e) => setBookLanguage(e.target.value)}
                    className={`${inputClass} py-2`}
                  >
                    {state.languages.map((l) => (
                      <option key={l.id} value={l.id} className="bg-surface">
                        {l.label}
                      </option>
                    ))}
                  </select>
                </label>
                <LanguageCover panel={panel} languages={state.languages} />
                <SlotPicker
                  panel={panel}
                  requests={state.requests}
                  teams={state.teams}
                  teamId={team.id}
                  disabled={busy || Boolean(existing)}
                  onPick={(slot) => bookSlot(slot, bookLanguage)}
                />
              </>
            )}
          </div>
        )}

        {/* ---- what is already happening ------------------------------ */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-subtle">Waiting now ({live.length})</h2>
          <ul className="space-y-2">
            {live.map((r) => {
              const t = state.teams.find((x) => x.id === r.team_id);
              if (!t) return null;
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl bg-surface px-4 py-3 ring-1 ring-inset ring-line"
                >
                  <span className="text-xl font-bold tabular-nums">{t.number}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-subtle">
                    {t.name} · {panelById.get(r.panel_id ?? "")?.name ?? "—"}
                  </span>
                  <LanguageTag language={r.language} languages={state.languages} />
                  <StatusChip status={r.status} size="sm" />
                  <span className="text-xs text-ink-faint">
                    <Elapsed since={r.requested_at} />
                  </span>
                  {r.status === "requested" ? (
                    <button
                      onClick={() => undo(r.id)}
                      className="text-xs text-ink-faint hover:text-danger-quiet"
                      title="Undo a mis-entry. Only works before judges acknowledge it."
                    >
                      undo
                    </button>
                  ) : null}
                </li>
              );
            })}
            {!live.length ? (
              <li className="rounded-xl bg-surface px-4 py-6 text-center text-sm text-ink-faint">
                Nobody waiting.
              </li>
            ) : null}
          </ul>
        </section>

        {booked.length ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink-subtle">
              Booked later ({booked.length})
            </h2>
            <ul className="space-y-2">
              {booked.map((r) => {
                const t = state.teams.find((x) => x.id === r.team_id);
                if (!t) return null;
                return (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl bg-surface px-4 py-3 text-sm ring-1 ring-inset ring-line"
                  >
                    <span className="w-28 shrink-0">
                      <BookingTime slotStart={r.slot_start} status={r.status} size="sm" />
                    </span>
                    <span className="text-lg font-bold tabular-nums">{t.number}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-subtle">
                      {t.name} · {panelById.get(r.panel_id ?? "")?.name ?? "—"}
                    </span>
                    <button
                      onClick={() => startReschedule(r, t.number)}
                      className="text-xs text-ink-subtle hover:text-ink"
                      title="Move this team to a different time instead of cancelling and booking again"
                    >
                      reschedule
                    </button>
                    <button
                      onClick={() => undo(r.id)}
                      className="text-xs text-ink-faint hover:text-danger-quiet"
                    >
                      cancel
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <p className="text-center text-xs text-ink-faint">
          Signed in as {session?.name}. This desk can queue teams and book them a time, and undo an
          entry before judges pick it up.
        </p>
      </main>
    </>
  );
}
