"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { liveRequestFor } from "@/lib/data";
import { STATUS_META } from "@/lib/status";
import { call, useAppState } from "@/components/useAppState";
import { normalizeTeamNumber } from "@/lib/teamNumber";
import { PanelBusyLine, panelLoad, SlotPicker } from "@/components/SlotPicker";
import { LanguageTag } from "@/components/Language";
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

export default function TeamPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = use(params);
  // The URL may carry any casing; the roster stores one canonical form.
  const teamNumber = normalizeTeamNumber(decodeURIComponent(number));
  const { state, loaded, online, refresh } = useAppState(4000);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [slotLanguage, setSlotLanguage] = useState("");

  useEffect(() => {
    if (!slotLanguage && state.languages.length) setSlotLanguage(state.languages[0].id);
  }, [slotLanguage, state.languages]);

  const team = state.teams.find((t) => t.number === teamNumber);
  const panel = state.panels.find((p) => p.id === team?.panel_id);
  const current = team ? liveRequestFor(team.id, state.requests) : null;
  // A booking is not the same as being in the queue: a team holding a
  // later slot can still say they are ready now.
  const booking = current?.status === "scheduled" ? current : null;

  const history = useMemo(
    () =>
      team
        ? state.requests.filter((r) => r.team_id === team.id && r.id !== current?.id).slice(0, 5)
        : [],
    [state.requests, team, current],
  );

  const load = useMemo(
    () => (panel ? panelLoad(panel.id, state.requests) : null),
    [panel, state.requests],
  );

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

  /** Ready early: give up any held slot so it does not sit there unused. */
  async function readyNow(language: string) {
    if (booking) {
      setBusy(true);
      setError(null);
      try {
        await call(`/api/requests/${booking.id}`, { method: "PATCH", body: { action: "cancel" } });
        await refresh();
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    await act({ teamNumber: team!.number, kind: "queue", language, message });
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
        <p className="text-ink-subtle">Check the number, or ask the Judge Advisor to add you.</p>
        <Link href="/" className="mt-6 inline-block text-accent-quiet hover:text-accent">
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
          <p className="text-sm text-ink-faint">Team {team.number}</p>
          <h1 className="text-3xl font-bold tracking-tight">{team.name}</h1>
          {panel ? (
            <p className="mt-2 text-sm text-ink-subtle">
              Judged by <span className="text-ink">{panel.name}</span>
              {` · ${panel.division}`}
              {panel.judges.length ? (
                <span className="block text-ink-faint">{panel.judges.join(", ")}</span>
              ) : null}
            </p>
          ) : (
            <p className="mt-2 text-sm text-caution-quiet">
              No judge panel assigned yet — check with the Judge Advisor.
            </p>
          )}
        </div>

        {error ? (
          <Banner kind="error" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        ) : null}

        {current && !booking ? (
          <section className="space-y-4 rounded-2xl bg-surface p-5 ring-1 ring-inset ring-line">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={current.status} size="lg" />
              <LanguageTag language={current.language} languages={state.languages} size="md" />
            </div>
            <p className="text-lg">{STATUS_META[current.status].teamLabel}</p>

            <dl className="space-y-1 text-sm text-ink-subtle">
              {current.kind === "slot" && current.slot_start ? (
                <div className="flex items-center gap-1.5">
                  Slot at <BookingTime slotStart={current.slot_start} status={current.status} />
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
            {booking ? (
              <div className="space-y-3 rounded-2xl bg-surface p-5 ring-1 ring-inset ring-line">
                <StatusChip status="scheduled" size="lg" />
                <p className="flex flex-wrap items-center gap-2 text-lg">
                  Booked for <BookingTime slotStart={booking.slot_start} size="lg" />
                </p>
                <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
                  Cancel this booking
                </Button>
              </div>
            ) : null}

            {/* One action, offered in each language the event runs, rather
                than one button per language each repeating the whole
                sentence. Two identical orange bars reading "Request a
                judge — <language>" looked like the same button twice; the
                thing that differs between them is the only thing that
                needs to be on them. */}
            <div className="space-y-2.5">
              <h2 className="font-display text-lg font-semibold">
                {booking ? "Ready before your slot?" : "Ask for a judge"}
              </h2>
              {state.languages.length > 1 ? (
                <p className="text-sm text-ink-subtle">
                  Which language would you like to be interviewed in?
                </p>
              ) : null}
              <div className="grid gap-2">
                {state.languages.map((lang) => (
                  <Button
                    key={lang.id}
                    variant="warn"
                    size="lg"
                    className="w-full"
                    disabled={busy || !team.panel_id}
                    onClick={() => readyNow(lang.id)}
                  >
                    {busy
                      ? "Sending…"
                      : state.languages.length > 1
                        ? lang.label
                        : booking
                          ? "We're ready now"
                          : "Request a judge"}
                  </Button>
                ))}
              </div>
            </div>
            {booking ? (
              <p className="text-center text-xs text-ink-faint">
                Either gives up your {formatClock(booking.slot_start)} slot.
              </p>
            ) : null}
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Optional note for the judges"
              className={inputClass}
              maxLength={280}
            />
            {load ? (
              <p className="text-center text-xs">
                <PanelBusyLine load={load} />
              </p>
            ) : null}
          </section>
        )}

        {!current && panel ? (
          <section className="rounded-2xl bg-surface p-5 ring-1 ring-inset ring-line">
            <h2 className="mb-3 text-sm font-semibold text-ink-muted">
              Or book a time with {panel.name}
            </h2>
            <div className="mb-3 flex flex-wrap gap-2">
              {state.languages.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setSlotLanguage(l.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    slotLanguage === l.id
                      ? "bg-accent text-white"
                      : "bg-surface text-ink-subtle ring-1 ring-inset ring-line"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <SlotPicker
              panel={panel}
              requests={state.requests}
              teams={state.teams}
              teamId={team.id}
              disabled={busy}
              onPick={(slot) =>
                act({
                  teamNumber: team.number,
                  kind: "slot",
                  language: slotLanguage,
                  slotStart: slot.start,
                  slotEnd: slot.end,
                })
              }
            />
          </section>
        ) : null}

        {history.length ? (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink-subtle">Earlier today</h2>
            <ul className="space-y-2">
              {history.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-xl bg-surface px-4 py-3 text-sm ring-1 ring-inset ring-line"
                >
                  <StatusChip status={r.status} size="sm" />
                  <span className="text-ink-faint">
                    {formatClock(r.finished_at ?? r.cancelled_at ?? r.requested_at)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <Link
          href="/board"
          className="block pt-2 text-center text-sm text-ink-faint hover:text-ink-muted"
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
