"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { buildSlots, liveRequestFor } from "@/lib/data";
import { STATUS_META } from "@/lib/status";
import { call, useAppState } from "@/components/useAppState";
import { normalizeTeamNumber } from "@/lib/teamNumber";
import {
  Banner,
  Button,
  Elapsed,
  formatClock,
  inputClass,
  StatusChip,
  TopBar,
} from "@/components/ui";

export default function TeamPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = use(params);
  // The URL may carry any casing; the roster stores one canonical form.
  const teamNumber = normalizeTeamNumber(decodeURIComponent(number));
  const { state, loaded, online, refresh } = useAppState(4000);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const team = state.teams.find((t) => t.number === teamNumber);
  const panel = state.panels.find((p) => p.id === team?.panel_id);
  const current = team ? liveRequestFor(team.id, state.requests) : null;

  const history = useMemo(
    () =>
      team
        ? state.requests.filter((r) => r.team_id === team.id && r.id !== current?.id).slice(0, 5)
        : [],
    [state.requests, team, current],
  );

  const slots = useMemo(
    () => (panel ? buildSlots(panel, state.requests, state.teams) : []),
    [panel, state.requests, state.teams],
  );

  const openSlots = slots.filter((s) => !s.takenBy && new Date(s.end).getTime() > Date.now());

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await call("/api/requests", { body });
      setMessage("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await call(`/api/requests/${current.id}`, { method: "PATCH", body: { action: "cancel" } });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return <CenteredNote>Loading…</CenteredNote>;
  }

  if (!team) {
    return (
      <CenteredNote>
        <p className="mb-2 text-lg font-semibold">Team {teamNumber} is not on the list.</p>
        <p className="text-zinc-400">Check the number, or ask the Judge Advisor to add you.</p>
        <Link href="/" className="mt-6 inline-block text-indigo-400 hover:text-indigo-300">
          ← Try another number
        </Link>
      </CenteredNote>
    );
  }

  return (
    <>
      <TopBar title="Judge Queue" online={online} />

      <main className="mx-auto max-w-lg space-y-5 px-5 py-6">
        <div>
          <div className="text-sm text-zinc-500">Team {team.number}</div>
          <h1 className="text-3xl font-bold tracking-tight">{team.name}</h1>
          {panel ? (
            <p className="mt-2 text-sm text-zinc-400">
              Judged by <span className="text-zinc-200">{panel.name}</span>
              {` · ${panel.division}`}
              {panel.judges.length ? (
                <span className="block text-zinc-500">{panel.judges.join(", ")}</span>
              ) : null}
            </p>
          ) : (
            <p className="mt-2 text-sm text-amber-400">
              No judge panel assigned yet — check with the Judge Advisor.
            </p>
          )}
        </div>

        {error ? (
          <Banner kind="error" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        ) : null}

        {current ? (
          <section className="space-y-4 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-inset ring-white/10">
            <StatusChip status={current.status} size="lg" />
            <p className="text-lg">{STATUS_META[current.status].teamLabel}</p>

            <dl className="space-y-1 text-sm text-zinc-400">
              {current.kind === "slot" && current.slot_start ? (
                <div>
                  Slot at <span className="text-zinc-200">{formatClock(current.slot_start)}</span>
                </div>
              ) : (
                <div>
                  Requested <Elapsed since={current.requested_at} /> ago
                </div>
              )}
              {current.status === "interviewing" && current.started_at ? (
                <div>
                  Started <Elapsed since={current.started_at} /> ago
                </div>
              ) : null}
            </dl>

            {current.status === "requested" || current.status === "scheduled" ? (
              <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
                Cancel this request
              </Button>
            ) : null}
          </section>
        ) : (
          <section className="space-y-4">
            <Button
              variant="warn"
              size="lg"
              className="w-full"
              disabled={busy || !team.panel_id}
              onClick={() => act({ teamNumber: team.number, kind: "queue", message })}
            >
              We&apos;re ready — request a judge now
            </Button>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Optional note for the judges"
              className={inputClass}
              maxLength={280}
            />
          </section>
        )}

        {!current && openSlots.length ? (
          <section className="rounded-2xl bg-white/[0.03] p-5 ring-1 ring-inset ring-white/10">
            <h2 className="mb-1 text-sm font-semibold text-zinc-300">
              Or book a time with {panel?.name}
            </h2>
            <p className="mb-4 text-xs text-zinc-500">
              {openSlots.length} slot{openSlots.length === 1 ? "" : "s"} still open.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {openSlots.map((slot) => (
                <button
                  key={slot.start}
                  disabled={busy}
                  onClick={() =>
                    act({
                      teamNumber: team.number,
                      kind: "slot",
                      slotStart: slot.start,
                      slotEnd: slot.end,
                    })
                  }
                  className="rounded-xl bg-white/5 px-2 py-3 text-sm font-medium ring-1 ring-inset ring-white/10 transition hover:bg-indigo-500 hover:text-white disabled:opacity-40"
                >
                  {formatClock(slot.start)}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {history.length ? (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-400">Earlier today</h2>
            <ul className="space-y-2">
              {history.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3 text-sm ring-1 ring-inset ring-white/[0.07]"
                >
                  <StatusChip status={r.status} size="sm" />
                  <span className="text-zinc-500">
                    {formatClock(r.finished_at ?? r.cancelled_at ?? r.requested_at)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <Link
          href="/board"
          className="block pt-2 text-center text-sm text-zinc-500 hover:text-zinc-300"
        >
          See the full board →
        </Link>
      </main>
    </>
  );
}

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
      {children}
    </main>
  );
}
