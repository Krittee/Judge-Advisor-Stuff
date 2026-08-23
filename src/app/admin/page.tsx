"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { liveRequestFor } from "@/lib/data";
import { NEXT_STATUS, STATUS_META, type Status } from "@/lib/status";
import { call, useAppState } from "@/components/useAppState";
import {
  Banner,
  Button,
  Elapsed,
  formatClock,
  inputClass,
  StatusChip,
  StatusLegend,
  TopBar,
} from "@/components/ui";
import { NotesDrawer, SignOutButton } from "@/components/judging";
import type { Session } from "@/lib/auth";
import type { ActivityRow, Panel, RequestRow, Team } from "@/lib/types";

type Tab = "floor" | "teams" | "panels" | "import" | "log";

/** The Judge Advisor's console: every panel at once, and the tools to unstick it. */
export default function AdminPage() {
  const router = useRouter();
  const { state, online, refresh } = useAppState(4000);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("floor");
  const [error, setError] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<Team | null>(null);

  useEffect(() => {
    call<{ session: Session | null }>("/api/session", { method: "GET" })
      .then(({ session }) => {
        if (session?.role !== "admin") {
          router.replace("/login");
          return;
        }
        setSession(session);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  if (session === undefined) {
    return <p className="p-10 text-center text-zinc-500">Loading…</p>;
  }

  const tabs: [Tab, string][] = [
    ["floor", "Floor"],
    ["teams", "Teams"],
    ["panels", "Panels"],
    ["import", "Import"],
    ["log", "Activity"],
  ];

  return (
    <>
      <TopBar
        title="Judge Queue"
        subtitle="Judge Advisor"
        online={online}
        right={<SignOutButton />}
      />

      <nav className="sticky top-[57px] z-10 border-b border-white/10 bg-[#0a0a0f]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition ${
                tab === id
                  ? "border-indigo-400 text-indigo-300"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-5">
        {error ? (
          <div className="mb-4">
            <Banner kind="error" onDismiss={() => setError(null)}>
              {error}
            </Banner>
          </div>
        ) : null}

        {tab === "floor" ? (
          <FloorTab state={state} refresh={refresh} onError={setError} onNotes={setNotesFor} />
        ) : null}
        {tab === "teams" ? <TeamsTab state={state} refresh={refresh} onError={setError} /> : null}
        {tab === "panels" ? <PanelsTab refresh={refresh} onError={setError} /> : null}
        {tab === "import" ? <ImportTab refresh={refresh} onError={setError} /> : null}
        {tab === "log" ? <ActivityTab /> : null}
      </main>

      {notesFor ? (
        <NotesDrawer
          team={notesFor}
          requestId={liveRequestFor(notesFor.id, state.requests)?.id ?? null}
          onClose={() => setNotesFor(null)}
        />
      ) : null}
    </>
  );
}

/* ==================================================================== */
/* Floor — live view of every panel, with the controls to unjam it       */
/* ==================================================================== */

type TabProps = {
  state: ReturnType<typeof useAppState>["state"];
  refresh: () => Promise<void>;
  onError: (m: string | null) => void;
};

function FloorTab({
  state,
  refresh,
  onError,
  onNotes,
}: TabProps & { onNotes: (t: Team) => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(() => {
    return state.teams
      .map((team) => ({ team, request: liveRequestFor(team.id, state.requests) }))
      .filter((r) => r.request)
      .sort((a, b) => {
        const ra = STATUS_META[a.request!.status].order;
        const rb = STATUS_META[b.request!.status].order;
        return ra - rb || a.request!.requested_at.localeCompare(b.request!.requested_at);
      });
  }, [state.teams, state.requests]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of state.requests) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [state.requests]);

  async function act(request: RequestRow, action: string, extra: Record<string, unknown> = {}) {
    setBusy(request.id);
    onError(null);
    try {
      await call(`/api/requests/${request.id}`, { method: "PATCH", body: { action, ...extra } });
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="flex gap-6">
          {(["requested", "acknowledged", "interviewing", "completed"] as Status[]).map((s) => (
            <div key={s}>
              <div className="text-2xl font-bold tabular-nums">{counts[s] ?? 0}</div>
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <span className={`h-2 w-2 rounded-full ${STATUS_META[s].dot}`} />
                {STATUS_META[s].short}
              </div>
            </div>
          ))}
        </div>
        <a
          href="/board"
          target="_blank"
          className="ml-auto rounded-lg bg-white/5 px-3 py-2 text-sm ring-1 ring-inset ring-white/10 hover:bg-white/10"
        >
          Open big-screen board ↗
        </a>
      </div>

      <StatusLegend />

      {!rows.length ? (
        <Banner kind="info">Nothing in flight. Teams will appear here as they request judges.</Banner>
      ) : null}

      <ul className="space-y-2">
        {rows.map(({ team, request }) => {
          const panel = state.panels.find((p) => p.id === request!.panel_id);
          return (
            <li
              key={request!.id}
              className={`flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-inset ${
                request!.status === "requested"
                  ? "bg-orange-500/10 ring-orange-500/40"
                  : "bg-white/[0.03] ring-white/10"
              }`}
            >
              <span className="w-16 text-xl font-bold tabular-nums">{team.number}</span>
              <span className="min-w-[8rem] flex-1 truncate text-sm text-zinc-300">
                {team.name}
              </span>

              <select
                value={request!.panel_id ?? ""}
                onChange={(e) => act(request!, "reassign", { panelId: e.target.value })}
                className="rounded-lg bg-white/5 px-2 py-1.5 text-xs ring-1 ring-inset ring-white/10"
                title="Move this interview to another panel"
              >
                {state.panels.map((p) => (
                  <option key={p.id} value={p.id} className="bg-zinc-900">
                    {p.name}
                  </option>
                ))}
              </select>

              <StatusChip status={request!.status} size="sm" />
              <span className="w-16 text-xs text-zinc-500">
                <Elapsed since={request!.requested_at} />
              </span>

              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => onNotes(team)}>
                  Notes
                </Button>
                {NEXT_STATUS[request!.status] ? (
                  <Button
                    size="sm"
                    variant={NEXT_STATUS[request!.status] === "completed" ? "success" : "primary"}
                    disabled={busy === request!.id}
                    onClick={() => act(request!, "advance")}
                  >
                    {STATUS_META[NEXT_STATUS[request!.status]!].short}
                  </Button>
                ) : null}
                <button
                  onClick={() => act(request!, "cancel")}
                  disabled={busy === request!.id}
                  className="text-xs text-zinc-500 hover:text-rose-400"
                >
                  cancel
                </button>
              </div>

              {panel ? (
                <span className="w-full text-xs text-zinc-600">
                  {panel.judges.join(", ") || "no judges listed"}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ==================================================================== */
/* Teams — the roster and who judges whom                                */
/* ==================================================================== */

function TeamsTab({ state, refresh, onError }: TabProps) {
  const [filter, setFilter] = useState("");
  const [perPanel, setPerPanel] = useState(10);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return state.teams;
    return state.teams.filter(
      (t) => String(t.number).includes(q) || t.name.toLowerCase().includes(q),
    );
  }, [state.teams, filter]);

  const perPanelCount = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of state.teams) {
      if (t.panel_id) c.set(t.panel_id, (c.get(t.panel_id) ?? 0) + 1);
    }
    return c;
  }, [state.teams]);

  async function update(teamId: string, patch: Record<string, unknown>) {
    onError(null);
    try {
      await call("/api/admin/teams", { method: "PATCH", body: { teamId, ...patch } });
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  async function autoAssign() {
    setBusy(true);
    onError(null);
    try {
      const res = await call<{ assigned: number }>("/api/admin/teams", {
        method: "PATCH",
        body: { action: "autoAssign", perPanel },
      });
      await refresh();
      if (!res.assigned) onError("Nothing to assign — every team already has a panel.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const unassigned = state.teams.filter((t) => !t.panel_id).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by number or name"
          className={`${inputClass} max-w-xs`}
        />
        <div className="flex items-end gap-2">
          <label className="text-sm text-zinc-400">
            <span className="mb-1 block text-xs">Max per panel</span>
            <input
              type="number"
              min={1}
              max={40}
              value={perPanel}
              onChange={(e) => setPerPanel(Number(e.target.value))}
              className={`${inputClass} w-24 py-2`}
            />
          </label>
          <Button variant="ghost" onClick={autoAssign} disabled={busy || !unassigned}>
            Auto-assign {unassigned} unassigned
          </Button>
        </div>
        <span className="ml-auto text-sm text-zinc-500">
          {state.teams.length} teams · {state.panels.length} panels
        </span>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {state.panels.map((p) => (
          <span key={p.id} className="rounded-lg bg-white/5 px-3 py-1.5 text-zinc-400">
            {p.name}: <span className="text-zinc-200">{perPanelCount.get(p.id) ?? 0}</span>
          </span>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-inset ring-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Pit</th>
              <th className="px-4 py-3">Judge panel</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {shown.map((team) => {
              const req = liveRequestFor(team.id, state.requests);
              const done = state.requests.find(
                (r) => r.team_id === team.id && r.status === "completed",
              );
              return (
                <tr key={team.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5 font-bold tabular-nums">{team.number}</td>
                  <td className="px-4 py-2.5 text-zinc-300">{team.name}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{team.pit ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={team.panel_id ?? ""}
                      onChange={(e) => update(team.id, { panelId: e.target.value || null })}
                      className="rounded-lg bg-white/5 px-2 py-1.5 text-xs ring-1 ring-inset ring-white/10"
                    >
                      <option value="" className="bg-zinc-900">
                        — unassigned —
                      </option>
                      {state.panels.map((p) => (
                        <option key={p.id} value={p.id} className="bg-zinc-900">
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    {req ? (
                      <StatusChip status={req.status} size="sm" />
                    ) : done ? (
                      <StatusChip status="completed" size="sm" />
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={async () => {
                        if (!confirm(`Remove team ${team.number} and all its requests?`)) return;
                        try {
                          await call(`/api/admin/teams?teamId=${team.id}`, { method: "DELETE" });
                          await refresh();
                        } catch (e) {
                          onError((e as Error).message);
                        }
                      }}
                      className="text-xs text-zinc-600 hover:text-rose-400"
                    >
                      remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!shown.length ? (
        <p className="py-8 text-center text-sm text-zinc-600">
          No teams match. Use the Import tab to add your roster.
        </p>
      ) : null}

      <StorageHealth />

      <DangerZone refresh={refresh} onError={onError} />
    </div>
  );
}

/**
 * Where the data is actually going.
 *
 * Someone who deployed from a browser has no server log to read, so this
 * is how they confirm their database is connected — and a loud warning
 * if it is not, because a serverless host with no database silently
 * forgets everything between requests.
 */
function StorageHealth() {
  const [health, setHealth] = useState<{
    ok: boolean;
    storage?: string;
    location?: string;
    persistent?: boolean;
    error?: string;
  } | null>(null);

  useEffect(() => {
    call<typeof health>("/api/health", { method: "GET" })
      .then(setHealth)
      .catch((e) => setHealth({ ok: false, error: (e as Error).message }));
  }, []);

  if (!health) return null;

  if (!health.ok) {
    return (
      <div className="mt-8">
        <Banner kind="error">
          <strong>Storage is not reachable.</strong>{" "}
          {health.error ?? "The app cannot reach its database."}
        </Banner>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-3">
      <p className="text-xs text-zinc-500">
        Storing into <span className="text-zinc-300">{health.location}</span>
      </p>
      {health.persistent === false ? (
        <Banner kind="info">
          This is running on a local file. That is fine on your own computer, but if you deployed
          this to a hosting service, add a database and set <code>DATABASE_URL</code> — otherwise
          your data can vanish between requests.
        </Banner>
      ) : null}
    </div>
  );
}

/**
 * Two resets, because they answer different questions. "Clear today"
 * is what you want between practice and the real thing; "wipe
 * everything" is what you want once, to get rid of the demo teams.
 */
function DangerZone({
  refresh,
  onError,
}: {
  refresh: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function reset(action: "resetDay" | "resetAll", confirmText: string) {
    if (!confirm(confirmText)) return;
    setBusy(true);
    onError(null);
    try {
      await call("/api/admin/teams", { method: "PATCH", body: { action } });
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-8 rounded-xl bg-white/[0.02] p-4 ring-1 ring-inset ring-white/[0.07]">
      <summary className="cursor-pointer text-sm text-zinc-500 hover:text-zinc-300">
        Reset
      </summary>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() =>
            reset(
              "resetDay",
              "Clear all requests, notes and activity?\n\nTeams and panels are kept.",
            )
          }
        >
          Clear today&apos;s requests
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={busy}
          onClick={() =>
            reset(
              "resetAll",
              "Delete EVERYTHING — teams, panels, requests and notes?\n\nThis cannot be undone.",
            )
          }
        >
          Wipe everything
        </Button>
        <span className="text-xs text-zinc-600">
          Use &ldquo;wipe everything&rdquo; once to clear the demo teams.
        </span>
      </div>
    </details>
  );
}

/* ==================================================================== */
/* Panels — judge groups, their codes and their slot grids               */
/* ==================================================================== */

function PanelsTab({
  refresh,
  onError,
}: {
  refresh: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: "", room: "", judges: "" });

  const load = useMemo(
    () => () =>
      call<{ panels: Panel[] }>("/api/admin/panels", { method: "GET" })
        .then(({ panels }) => setPanels(panels))
        .catch((e) => onError((e as Error).message)),
    [onError],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      await call("/api/admin/panels", {
        body: { ...draft, sortOrder: panels.length + 1 },
      });
      setDraft({ name: "", room: "", judges: "" });
      await load();
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    onError(null);
    try {
      await call("/api/admin/panels", { method: "PATCH", body: { id, ...body } });
      await load();
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={create}
        className="flex flex-wrap items-end gap-3 rounded-xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/10"
      >
        <label className="min-w-[10rem] flex-1">
          <span className="mb-1 block text-xs text-zinc-400">Panel name</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Panel D"
            className={`${inputClass} py-2`}
          />
        </label>
        <label className="min-w-[8rem] flex-1">
          <span className="mb-1 block text-xs text-zinc-400">Room</span>
          <input
            value={draft.room}
            onChange={(e) => setDraft({ ...draft, room: e.target.value })}
            placeholder="Room 104"
            className={`${inputClass} py-2`}
          />
        </label>
        <label className="min-w-[14rem] flex-[2]">
          <span className="mb-1 block text-xs text-zinc-400">Judges (comma separated)</span>
          <input
            value={draft.judges}
            onChange={(e) => setDraft({ ...draft, judges: e.target.value })}
            placeholder="Dana Ruiz, Sam Okafor"
            className={`${inputClass} py-2`}
          />
        </label>
        <Button type="submit" disabled={busy || !draft.name.trim()}>
          Add panel
        </Button>
      </form>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
        {panels.map((p) => (
          <PanelCard key={p.id} panel={p} onPatch={patch} onError={onError} onReload={load} />
        ))}
      </div>

      {!panels.length ? (
        <p className="py-8 text-center text-sm text-zinc-600">
          No judge panels yet. Add one above — judges sign in with its code.
        </p>
      ) : null}
    </div>
  );
}

function PanelCard({
  panel,
  onPatch,
  onError,
  onReload,
}: {
  panel: Panel;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
  onError: (m: string | null) => void;
  onReload: () => Promise<void> | void;
}) {
  const [slotCount, setSlotCount] = useState(panel.slot_count);
  const [slotMinutes, setSlotMinutes] = useState(panel.slot_minutes);
  const [slotStart, setSlotStart] = useState(toLocalInput(panel.slot_start_at));

  return (
    <div className="space-y-3 rounded-xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{panel.name}</h3>
          <p className="text-xs text-zinc-500">{panel.room || "no room set"}</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-zinc-500">Judge code</div>
          <code className="text-lg font-bold tracking-widest text-indigo-300">{panel.code}</code>
        </div>
      </div>

      <input
        defaultValue={panel.judges.join(", ")}
        onBlur={(e) => onPatch(panel.id, { judges: e.target.value })}
        placeholder="Judge names, comma separated"
        className={`${inputClass} py-2 text-sm`}
      />

      <details className="text-sm">
        <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">
          Booking slots {panel.slot_count ? `(${panel.slot_count})` : "(off)"}
        </summary>
        <div className="mt-3 space-y-2">
          <label className="block text-xs text-zinc-400">
            First slot starts
            <input
              type="datetime-local"
              value={slotStart}
              onChange={(e) => setSlotStart(e.target.value)}
              className={`${inputClass} mt-1 py-2 text-sm`}
            />
          </label>
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-zinc-400">
              Minutes each
              <input
                type="number"
                min={3}
                max={120}
                value={slotMinutes}
                onChange={(e) => setSlotMinutes(Number(e.target.value))}
                className={`${inputClass} mt-1 py-2 text-sm`}
              />
            </label>
            <label className="flex-1 text-xs text-zinc-400">
              How many
              <input
                type="number"
                min={0}
                max={60}
                value={slotCount}
                onChange={(e) => setSlotCount(Number(e.target.value))}
                className={`${inputClass} mt-1 py-2 text-sm`}
              />
            </label>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onPatch(panel.id, {
                slotCount,
                slotMinutes,
                slotStartAt: slotStart ? new Date(slotStart).toISOString() : null,
              })
            }
          >
            Save slot grid
          </Button>
          <p className="text-xs text-zinc-600">Set &ldquo;how many&rdquo; to 0 for walk-up queue only.</p>
        </div>
      </details>

      <button
        onClick={async () => {
          if (!confirm(`Delete ${panel.name}? Its teams become unassigned.`)) return;
          try {
            await call(`/api/admin/panels?id=${panel.id}`, { method: "DELETE" });
            await onReload();
          } catch (e) {
            onError((e as Error).message);
          }
        }}
        className="text-xs text-zinc-600 hover:text-rose-400"
      >
        delete panel
      </button>
    </div>
  );
}

/** datetime-local wants local wall time, not an ISO string with a Z. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ==================================================================== */
/* Import — paste the roster                                             */
/* ==================================================================== */

function ImportTab({
  refresh,
  onError,
}: {
  refresh: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [text, setText] = useState("");
  const [autoAssign, setAutoAssign] = useState(true);
  const [perPanel, setPerPanel] = useState(10);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    onError(null);
    setResult(null);
    try {
      const res = await call<{ imported: number; skipped: number; assigned: number }>(
        "/api/admin/teams",
        { body: { text, autoAssign, perPanel } },
      );
      setResult(
        `Imported ${res.imported} team${res.imported === 1 ? "" : "s"}` +
          (res.assigned ? `, assigned ${res.assigned} to panels` : "") +
          (res.skipped ? `. Skipped ${res.skipped} unreadable line(s).` : "."),
      );
      setText("");
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Import your team list</h2>
        <p className="mt-1 text-sm text-zinc-400">
          One team per line: <code className="text-zinc-300">number, name, pit</code>. Pit is
          optional. Team numbers may include letters — <code className="text-zinc-300">9882K</code>{" "}
          works as well as <code className="text-zinc-300">1234</code>. Paste straight from a
          spreadsheet — tabs work too, and a header row is skipped automatically. Re-importing
          updates existing teams instead of duplicating them.
        </p>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        spellCheck={false}
        placeholder={"1234, Iron Hawks, Pit 12\n9882K, Kilo Kestrels, Pit 13\n9882A, Alpha Antelopes"}
        className={`${inputClass} font-mono text-sm`}
      />

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={autoAssign}
            onChange={(e) => setAutoAssign(e.target.checked)}
            className="h-4 w-4 accent-indigo-500"
          />
          Spread across panels evenly
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          max
          <input
            type="number"
            min={1}
            max={40}
            value={perPanel}
            onChange={(e) => setPerPanel(Number(e.target.value))}
            disabled={!autoAssign}
            className={`${inputClass} w-20 py-2 disabled:opacity-40`}
          />
          per panel
        </label>
        <Button onClick={submit} disabled={busy || !text.trim()}>
          {busy ? "Importing…" : "Import"}
        </Button>
      </div>

      {result ? <Banner kind="success">{result}</Banner> : null}
    </div>
  );
}

/* ==================================================================== */
/* Activity — who did what, for when the floor gets confusing            */
/* ==================================================================== */

function ActivityTab() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      call<{ activity: ActivityRow[] }>("/api/admin/activity", { method: "GET" })
        .then(({ activity }) => setRows(activity))
        .catch((e) => setError((e as Error).message));
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  if (error) return <Banner kind="error">{error}</Banner>;

  return (
    <ul className="divide-y divide-white/5 rounded-xl ring-1 ring-inset ring-white/10">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
          <span className="w-20 shrink-0 text-zinc-600">{formatClock(r.created_at)}</span>
          <span className="w-48 shrink-0 truncate text-zinc-400">{r.actor}</span>
          <span className="text-zinc-200">{r.action}</span>
          {r.detail ? <span className="text-zinc-500">{r.detail}</span> : null}
        </li>
      ))}
      {!rows.length ? (
        <li className="px-4 py-8 text-center text-sm text-zinc-600">Nothing logged yet.</li>
      ) : null}
    </ul>
  );
}
