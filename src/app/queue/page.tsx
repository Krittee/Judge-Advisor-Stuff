"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { liveRequestFor } from "@/lib/data";
import { STATUS_META } from "@/lib/status";
import { call, useAppState } from "@/components/useAppState";
import { Banner, Button, Elapsed, formatClock, inputClass, StatusChip, TopBar } from "@/components/ui";
import { SignOutButton } from "@/components/judging";
import { PanelBusyLine, panelLoad, SlotPicker } from "@/components/SlotPicker";
import { filterTeamNumberInput, normalizeTeamNumber } from "@/lib/teamNumber";
import type { Session } from "@/lib/auth";
import type { Slot } from "@/lib/types";

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
  async function interviewNow() {
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
      { teamNumber: number, kind: "queue", message: message.trim() || undefined },
      booking
        ? `Team ${normalizeTeamNumber(number)} queued now; their ${formatClock(booking.slot_start)} slot is free again.`
        : `Team ${normalizeTeamNumber(number)} added to the queue.`,
    );
  }

  const bookSlot = (slot: Slot) =>
    submit(
      {
        teamNumber: number,
        kind: "slot",
        slotStart: slot.start,
        slotEnd: slot.end,
        message: message.trim() || undefined,
      },
      `Team ${normalizeTeamNumber(number)} booked for ${formatClock(slot.start)}.`,
    );

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
    return <p className="p-10 text-center text-zinc-500">Loading…</p>;
  }

  return (
    <>
      <TopBar title="Judge Queue" subtitle="Queue desk" online={online} right={<SignOutButton />} />

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        {/* ---- which kind of request ---------------------------------- */}
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-white/5 p-1">
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
                setError(null);
                setOk(null);
              }}
              className={`rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                mode === id ? "bg-indigo-500 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ---- team number ------------------------------------------- */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-zinc-300">Team number</label>
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
                <div className="text-zinc-300">
                  {team.name}
                  <span className="text-zinc-500">
                    {panel ? ` → ${panel.name} · ${team.division}` : ""}
                  </span>
                </div>
                {!panel ? (
                  <div className="text-amber-400">No judge panel assigned yet</div>
                ) : load ? (
                  <div className="text-xs">
                    <PanelBusyLine load={load} />
                  </div>
                ) : null}
              </>
            ) : number ? (
              <span className="text-zinc-600">not found</span>
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

        {booking ? (
          <Banner kind="info">
            <strong>
              Team {team?.number} is already booked for {formatClock(booking.slot_start)}.
            </strong>{" "}
            {mode === "now"
              ? "Queueing them now will release that slot for someone else."
              : "Cancel that booking below before booking them a different time."}
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
            <Button
              variant="warn"
              size="lg"
              className="w-full"
              disabled={busy || !team || !panel || Boolean(alreadyQueued)}
              onClick={interviewNow}
            >
              {booking
                ? `Interview now instead (frees ${formatClock(booking.slot_start)})`
                : "Add to queue now"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {!team ? (
              <p className="rounded-xl bg-white/[0.03] px-4 py-3 text-sm text-zinc-500">
                Enter a team number to see their panel&apos;s times.
              </p>
            ) : !panel ? (
              <p className="rounded-xl bg-white/[0.03] px-4 py-3 text-sm text-amber-400">
                This team has no judge panel yet, so there is nothing to book.
              </p>
            ) : (
              <>
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Optional note for the judges"
                  maxLength={280}
                  className={inputClass}
                />
                <SlotPicker
                  panel={panel}
                  requests={state.requests}
                  teams={state.teams}
                  teamId={team.id}
                  disabled={busy || Boolean(existing)}
                  onPick={bookSlot}
                />
              </>
            )}
          </div>
        )}

        {/* ---- what is already happening ------------------------------ */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-zinc-400">Waiting now ({live.length})</h2>
          <ul className="space-y-2">
            {live.map((r) => {
              const t = state.teams.find((x) => x.id === r.team_id);
              if (!t) return null;
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-inset ring-white/10"
                >
                  <span className="text-xl font-bold tabular-nums">{t.number}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">
                    {t.name} · {panelById.get(r.panel_id ?? "")?.name ?? "—"}
                  </span>
                  <StatusChip status={r.status} size="sm" />
                  <span className="text-xs text-zinc-500">
                    <Elapsed since={r.requested_at} />
                  </span>
                  {r.status === "requested" ? (
                    <button
                      onClick={() => undo(r.id)}
                      className="text-xs text-zinc-500 hover:text-rose-400"
                      title="Undo a mis-entry. Only works before judges acknowledge it."
                    >
                      undo
                    </button>
                  ) : null}
                </li>
              );
            })}
            {!live.length ? (
              <li className="rounded-xl bg-white/[0.02] px-4 py-6 text-center text-sm text-zinc-600">
                Nobody waiting.
              </li>
            ) : null}
          </ul>
        </section>

        {booked.length ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-zinc-400">
              Booked later ({booked.length})
            </h2>
            <ul className="space-y-2">
              {booked.map((r) => {
                const t = state.teams.find((x) => x.id === r.team_id);
                if (!t) return null;
                return (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl bg-white/[0.03] px-4 py-3 text-sm ring-1 ring-inset ring-white/10"
                  >
                    <span className="w-16 font-bold tabular-nums">{formatClock(r.slot_start)}</span>
                    <span className="text-lg font-bold tabular-nums">{t.number}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-400">
                      {t.name} · {panelById.get(r.panel_id ?? "")?.name ?? "—"}
                    </span>
                    <button
                      onClick={() => undo(r.id)}
                      className="text-xs text-zinc-500 hover:text-rose-400"
                    >
                      cancel
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <p className="text-center text-xs text-zinc-600">
          Signed in as {session?.name}. This desk can queue teams and book them a time, and undo an
          entry before judges pick it up.
        </p>
      </main>
    </>
  );
}
