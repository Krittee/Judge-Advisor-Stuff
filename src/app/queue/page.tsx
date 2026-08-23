"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { liveRequestFor } from "@/lib/data";
import { call, useAppState } from "@/components/useAppState";
import {
  Banner,
  Button,
  Elapsed,
  inputClass,
  StatusChip,
  TopBar,
} from "@/components/ui";
import { SignOutButton } from "@/components/judging";
import { filterTeamNumberInput, normalizeTeamNumber } from "@/lib/teamNumber";
import type { Session } from "@/lib/auth";

/**
 * The queue desk. This role can put teams into the queue and undo a
 * mis-entry — nothing else. There is deliberately no button here that
 * advances an interview, and notes are never fetched.
 */
export default function QueuePage() {
  const router = useRouter();
  const { state, online, refresh } = useAppState(4000);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
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

  const preview = teamByNumber.get(normalizeTeamNumber(number));

  const live = useMemo(
    () =>
      state.requests
        .filter((r) => r.status === "requested" || r.status === "acknowledged")
        .sort((a, b) => a.requested_at.localeCompare(b.requested_at)),
    [state.requests],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await call("/api/requests", {
        body: { teamNumber: number, kind: "queue", message: message.trim() || undefined },
      });
      setOk(`Team ${number} added to the queue.`);
      setNumber("");
      setMessage("");
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
    return <p className="p-10 text-center text-zinc-500">Loading…</p>;
  }

  return (
    <>
      <TopBar
        title="Judge Queue"
        subtitle="Queue desk"
        online={online}
        right={<SignOutButton />}
      />

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm font-medium text-zinc-300">
            Team number requesting a judge
          </label>
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

          <div className="min-h-[1.5rem] text-center text-sm">
            {preview ? (
              <span className="text-zinc-300">
                {preview.name}
                {preview.panel_id ? (
                  <span className="text-zinc-500">
                    {" "}
                    → {panelById.get(preview.panel_id)?.name ?? "?"}
                  </span>
                ) : (
                  <span className="text-amber-400"> · no panel assigned</span>
                )}
              </span>
            ) : number ? (
              <span className="text-zinc-600">not found</span>
            ) : null}
          </div>

          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Optional note for the judges"
            maxLength={280}
            className={inputClass}
          />

          {error ? <Banner kind="error">{error}</Banner> : null}
          {ok ? <Banner kind="success">{ok}</Banner> : null}

          <Button type="submit" variant="warn" size="lg" className="w-full" disabled={busy || !preview}>
            Add to queue
          </Button>
        </form>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-zinc-400">
            Waiting now ({live.length})
          </h2>
          <ul className="space-y-2">
            {live.map((r) => {
              const team = state.teams.find((t) => t.id === r.team_id);
              if (!team) return null;
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-inset ring-white/10"
                >
                  <span className="text-xl font-bold tabular-nums">{team.number}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">
                    {team.name} · {panelById.get(r.panel_id ?? "")?.name ?? "—"}
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

        <p className="text-center text-xs text-zinc-600">
          Signed in as {session?.name}. This desk can add teams to the queue and undo an entry
          before judges pick it up.
        </p>
      </main>
    </>
  );
}
