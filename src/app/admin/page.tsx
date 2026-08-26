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
import { Rankings } from "@/components/Rankings";
import { ConflictDialog } from "@/components/ConflictDialog";
import { CategoryChip, CategorySelect } from "@/components/CategoryChip";
import { LanguageCover, LanguageTag } from "@/components/Language";
import { readSpreadsheet } from "@/lib/spreadsheet";
import type { Session } from "@/lib/auth";
import type { ActivityRow, Panel, RequestRow, Team } from "@/lib/types";

type Tab = "floor" | "scores" | "teams" | "panels" | "conflicts" | "import" | "log";

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
    ["scores", "Scores"],
    ["teams", "Teams"],
    ["panels", "Panels"],
    ["conflicts", "Conflicts"],
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
        {tab === "scores" ? (
          <Rankings
            teams={state.teams}
            categories={state.categories}
            panelName={Object.fromEntries(state.panels.map((p) => [p.id, p.name]))}
            onOpenTeam={setNotesFor}
          />
        ) : null}
        {tab === "teams" ? <TeamsTab state={state} refresh={refresh} onError={setError} /> : null}
        {tab === "panels" ? (
          <PanelsTab
            refresh={refresh}
            onError={setError}
            divisions={state.divisions}
            languages={state.languages}
          />
        ) : null}
        {tab === "conflicts" ? (
          <ConflictsTab state={state} refresh={refresh} onError={setError} />
        ) : null}
        {tab === "import" ? (
          <ImportTab
            refresh={refresh}
            onError={setError}
            divisions={state.divisions}
            categories={state.categories}
          />
        ) : null}
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

              <LanguageTag
                language={request!.language}
                languages={state.languages}
                size="md"
              />
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
              {/* A request in a language its panel has not said it covers
                  is worth surfacing here, where it can be reassigned. */}
              {panel ? (
                <LanguageCover
                  panel={panel}
                  languages={state.languages}
                  asking={request!.language}
                />
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
  const [division, setDivision] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return state.teams.filter((t) => {
      if (division && t.division !== division) return false;
      if (category && t.category !== category) return false;
      if (!q) return true;
      return t.number.toLowerCase().includes(q) || t.name.toLowerCase().includes(q);
    });
  }, [state.teams, filter, division, category]);

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
      // Rethrow so an inline cell puts the old value back rather than
      // showing a change the server refused.
      throw e;
    }
  }

  async function autoAssign() {
    setBusy(true);
    onError(null);
    try {
      const res = await call<{ assigned: number }>("/api/admin/teams", {
        method: "PATCH",
        body: { action: "autoAssign", perPanel, division: division || undefined },
      });
      await refresh();
      if (!res.assigned) onError("Nothing to assign — every team already has a panel.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const unassigned = shown.filter((t) => !t.panel_id).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by number or name"
          className={`${inputClass} max-w-xs`}
        />
        <select
          value={division}
          onChange={(e) => setDivision(e.target.value)}
          className={`${inputClass} max-w-[12rem]`}
          aria-label="Division"
        >
          <option value="" className="bg-zinc-900">
            All divisions
          </option>
          {state.divisions.map((d) => (
            <option key={d} value={d} className="bg-zinc-900">
              {d}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={`${inputClass} max-w-[13rem]`}
          aria-label="Notebook type"
        >
          <option value="" className="bg-zinc-900">
            All notebooks
          </option>
          {state.categories.map((c) => (
            <option key={c.id} value={c.id} className="bg-zinc-900">
              {c.label}
            </option>
          ))}
        </select>
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
        <p className="w-full text-xs text-zinc-600">
          Team number, name and pit are editable — click one and type. Pits read as a letter and a
          number (<code className="text-zinc-500">A1</code>), which is what places a team on the
          board&apos;s floor plan.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {state.categories.map((c) => (
          <span key={c.id} className="flex items-center gap-1.5">
            <CategoryChip category={c.id} categories={state.categories} />
            <span className="text-zinc-300">
              {shown.filter((t) => t.category === c.id).length}
            </span>
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {state.panels
          .filter((p) => !division || p.division === division)
          .map((p) => (
            <span key={p.id} className="rounded-lg bg-white/5 px-3 py-1.5 text-zinc-400">
              {p.name}: <span className="text-zinc-200">{perPanelCount.get(p.id) ?? 0}</span>
              <span className="ml-2 text-zinc-600">{p.division}</span>
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
              <th className="px-4 py-3">Notebook</th>
              <th className="px-4 py-3">Division</th>
              <th className="px-4 py-3">Judge panel</th>
              <th className="px-4 py-3">Interview</th>
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
                  <td className="px-2 py-1.5">
                    <EditableCell
                      value={team.number}
                      className="font-bold tabular-nums"
                      onSave={(number) => update(team.id, { number })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <EditableCell
                      value={team.name}
                      className="text-zinc-300"
                      onSave={(name) => update(team.id, { name })}
                    />
                  </td>
                  <td className="px-2 py-1.5 w-24">
                    <EditableCell
                      value={team.pit ?? ""}
                      placeholder="—"
                      align="center"
                      className="tabular-nums text-zinc-400"
                      onSave={(pit) => update(team.id, { pit: pit || null })}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <CategorySelect
                      value={team.category}
                      categories={state.categories}
                      onChange={(id) => update(team.id, { category: id })}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={team.division}
                      onChange={(e) => update(team.id, { division: e.target.value })}
                      className="rounded-lg bg-white/5 px-2 py-1.5 text-xs ring-1 ring-inset ring-white/10"
                      title="Changing division unassigns the team from its panel"
                    >
                      {state.divisions.map((d) => (
                        <option key={d} value={d} className="bg-zinc-900">
                          {d}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={team.panel_id ?? ""}
                      onChange={(e) => update(team.id, { panelId: e.target.value || null })}
                      className="rounded-lg bg-white/5 px-2 py-1.5 text-xs ring-1 ring-inset ring-white/10"
                    >
                      <option value="" className="bg-zinc-900">
                        — unassigned —
                      </option>
                      {/* Only panels on this team's side of the wall. */}
                      {state.panels
                        .filter((p) => p.division === team.division)
                        .map((p) => (
                          <option key={p.id} value={p.id} className="bg-zinc-900">
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    {req ? (
                      <StatusChip status={req.status} size="sm" short />
                    ) : done ? (
                      <StatusChip status="completed" size="sm" short />
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
 * Declared conflicts of interest.
 *
 * The Judge Advisor is the only one who can withdraw one, so this is the
 * only place a conflict can be lifted. A team named here has been taken
 * off that panel and needs assigning to another.
 */
function ConflictsTab({ state, refresh, onError }: TabProps) {
  const [adding, setAdding] = useState<Team | null>(null);
  const [pick, setPick] = useState("");
  const [panelId, setPanelId] = useState("");
  const [busy, setBusy] = useState(false);

  const teamById = useMemo(() => new Map(state.teams.map((t) => [t.id, t])), [state.teams]);
  const panelById = useMemo(() => new Map(state.panels.map((p) => [p.id, p])), [state.panels]);

  async function withdraw(id: string) {
    if (!confirm("Withdraw this conflict? The panel will be able to judge the team again.")) {
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await call(`/api/conflicts?id=${id}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const chosen = state.teams.find((t) => t.number === pick.trim().toUpperCase());

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white/[0.03] p-4 ring-1 ring-inset ring-white/10">
        <label className="min-w-[9rem] flex-1">
          <span className="mb-1 block text-xs text-zinc-400">Team number</span>
          <input
            value={pick}
            onChange={(e) => setPick(e.target.value.toUpperCase())}
            placeholder="1234"
            className={`${inputClass} py-2`}
          />
        </label>
        <label className="min-w-[10rem] flex-1">
          <span className="mb-1 block text-xs text-zinc-400">Judge panel</span>
          <select
            value={panelId}
            onChange={(e) => setPanelId(e.target.value)}
            className={`${inputClass} py-2`}
          >
            <option value="" className="bg-zinc-900">
              — pick a panel —
            </option>
            {state.panels.map((p) => (
              <option key={p.id} value={p.id} className="bg-zinc-900">
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={!chosen || !panelId}
          onClick={() => chosen && setAdding(chosen)}
        >
          Declare conflict
        </Button>
        <p className="w-full text-xs text-zinc-600">
          {pick && !chosen ? (
            <span className="text-amber-400">No team with that number.</span>
          ) : (
            "A conflict takes the team off that panel and keeps it off — no interview, no notebook, no notes."
          )}
        </p>
      </div>

      <ul className="divide-y divide-white/5 rounded-xl ring-1 ring-inset ring-white/10">
        {state.conflicts.map((c) => {
          const team = teamById.get(c.team_id);
          const panel = panelById.get(c.panel_id);
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <span className="font-bold tabular-nums">{team?.number ?? "—"}</span>
              <span className="min-w-[8rem] flex-1 truncate text-zinc-400">
                {team?.name ?? "team removed"}
              </span>
              <span className="text-zinc-300">{panel?.name ?? "panel removed"}</span>
              {c.judge_name ? <span className="text-zinc-500">{c.judge_name}</span> : null}
              {c.note ? <span className="text-zinc-600">{c.note}</span> : null}
              {team && !team.panel_id ? (
                <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">
                  needs a panel
                </span>
              ) : null}
              <button
                onClick={() => withdraw(c.id)}
                disabled={busy}
                className="ml-auto text-xs text-zinc-500 hover:text-rose-400"
              >
                withdraw
              </button>
            </li>
          );
        })}
        {!state.conflicts.length ? (
          <li className="px-4 py-8 text-center text-sm text-zinc-600">
            No conflicts declared. Judges can declare their own from their console.
          </li>
        ) : null}
      </ul>

      {adding ? (
        <ConflictDialog
          team={adding}
          panelId={panelId}
          onClose={() => setAdding(null)}
          onDone={async () => {
            setAdding(null);
            setPick("");
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A table cell you can type into.
 *
 * Saves on blur or Enter, reverts on Escape, and puts the old value back
 * if the server refuses — a rejected edit that stayed on screen would
 * look saved when it is not.
 */
function EditableCell({
  value,
  onSave,
  placeholder,
  className = "",
  align = "left",
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
  placeholder?: string;
  className?: string;
  align?: "left" | "center";
}) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  // Follow the row when it changes underneath us (a poll, another editor).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  async function commit() {
    const next = draft.trim();
    if (next === value) return;
    if (!next && placeholder !== "—") {
      setDraft(value);
      return;
    }

    setBusy(true);
    try {
      await onSave(next);
    } catch {
      setDraft(value); // the caller surfaces the message
    } finally {
      setBusy(false);
    }
  }

  return (
    <input
      value={draft}
      disabled={busy}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`w-full rounded-lg bg-transparent px-2 py-1.5 text-sm ring-1 ring-inset ring-transparent transition hover:bg-white/5 hover:ring-white/10 focus:bg-white/5 focus:ring-indigo-400 focus:outline-none disabled:opacity-50 ${
        align === "center" ? "text-center" : ""
      } ${className}`}
    />
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
  divisions,
  languages,
}: {
  refresh: () => Promise<void>;
  onError: (m: string | null) => void;
  divisions: string[];
  languages: { id: string; label: string; short: string }[];
}) {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: "", division: "", judges: "" });

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
        body: {
          ...draft,
          division: draft.division || divisions[0],
          sortOrder: panels.length + 1,
        },
      });
      setDraft({ name: "", division: "", judges: "" });
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
        <label className="min-w-[9rem] flex-1">
          <span className="mb-1 block text-xs text-zinc-400">Division</span>
          <select
            value={draft.division || divisions[0] || ""}
            onChange={(e) => setDraft({ ...draft, division: e.target.value })}
            className={`${inputClass} py-2`}
          >
            {divisions.map((d) => (
              <option key={d} value={d} className="bg-zinc-900">
                {d}
              </option>
            ))}
          </select>
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
          <PanelCard
            key={p.id}
            panel={p}
            divisions={divisions}
            languages={languages}
            onPatch={patch}
            onError={onError}
            onReload={load}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            onError(null);
            try {
              const res = await call<{ created: number }>("/api/admin/panels", { method: "PUT" });
              await load();
              await refresh();
              if (!res.created) onError("Every preset panel already exists.");
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Add preset panels
        </Button>
        <span className="text-xs text-zinc-600">
          Creates anything in <code>config/event.json</code> that is missing. Never overwrites a
          panel you already have.
        </span>
      </div>

      {panels.length ? (
        <DeleteAllPanels
          panels={panels}
          busy={busy}
          setBusy={setBusy}
          onError={onError}
          onDone={async () => {
            await load();
            await refresh();
          }}
        />
      ) : null}

      {!panels.length ? (
        <p className="py-8 text-center text-sm text-zinc-600">
          No judge panels yet. Add one above, or load your presets — judges sign in with a panel&apos;s
          code.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Delete every panel at once.
 *
 * Two clicks, not one: this invalidates every judge's sign-in code in a
 * single action, and it sits right next to the button people press while
 * setting up. The second click states exactly what survives — the roster
 * is expensive to rebuild and is never what this is meant to take.
 */
function DeleteAllPanels({
  panels,
  busy,
  setBusy,
  onError,
  onDone,
}: {
  panels: Panel[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  onError: (m: string | null) => void;
  onDone: () => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);

  // Never leave a live "confirm" button sitting around after a glance.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 8000);
    return () => clearTimeout(t);
  }, [armed]);

  const assigned = panels.length;

  async function run() {
    setBusy(true);
    onError(null);
    try {
      const res = await call<{ deleted: number }>("/api/admin/panels?all=true", {
        method: "DELETE",
      });
      await onDone();
      setArmed(false);
      onError(
        `Deleted ${res.deleted} panel${res.deleted === 1 ? "" : "s"}. ` +
          "Teams are still here, now unassigned.",
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-rose-500/[0.06] p-4 ring-1 ring-inset ring-rose-500/20">
      {armed ? (
        <>
          <Button variant="danger" size="sm" disabled={busy} onClick={run}>
            {busy ? "Deleting…" : `Yes, delete all ${assigned}`}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setArmed(false)}>
            Cancel
          </Button>
          <span className="text-xs text-rose-200">
            Every judge code stops working immediately. Your teams stay, unassigned.
          </span>
        </>
      ) : (
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setArmed(true)}>
            Delete all panels
          </Button>
          <span className="text-xs text-zinc-600">
            Clears all {assigned} panels so you can start over. Teams are kept.
          </span>
        </>
      )}
    </div>
  );
}

function PanelCard({
  panel,
  divisions,
  languages,
  onPatch,
  onError,
  onReload,
}: {
  panel: Panel;
  divisions: string[];
  languages: { id: string; label: string; short: string }[];
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
          <p className="text-xs text-zinc-500">{panel.division}</p>
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

      <div className="text-xs text-zinc-400">
        <span className="mb-1 block">Interviews in</span>
        <div className="flex flex-wrap gap-2">
          {languages.map((l) => {
            const on = panel.languages.includes(l.id);
            return (
              <button
                key={l.id}
                onClick={() =>
                  onPatch(panel.id, {
                    languages: on
                      ? panel.languages.filter((x) => x !== l.id)
                      : [...panel.languages, l.id],
                  })
                }
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  on
                    ? "bg-indigo-500 text-white"
                    : "bg-white/5 text-zinc-500 ring-1 ring-inset ring-white/10"
                }`}
              >
                {l.label}
              </button>
            );
          })}
        </div>
        {!panel.languages.length ? (
          <p className="mt-1 text-zinc-600">Not stated — no request will be flagged.</p>
        ) : null}
      </div>

      <label className="block text-xs text-zinc-400">
        Division
        <select
          value={panel.division}
          onChange={(e) => {
            if (
              !confirm(
                `Move ${panel.name} to ${e.target.value}?\n\n` +
                  "Its current teams stay in their own division and become " +
                  "unassigned, so you will need to give them to another panel.",
              )
            ) {
              return;
            }
            onPatch(panel.id, { division: e.target.value });
          }}
          className={`${inputClass} mt-1 py-2 text-sm`}
        >
          {divisions.map((d) => (
            <option key={d} value={d} className="bg-zinc-900">
              {d}
            </option>
          ))}
        </select>
      </label>

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
  divisions,
  categories,
}: {
  refresh: () => Promise<void>;
  onError: (m: string | null) => void;
  divisions: string[];
  categories: { id: string; label: string; color: string }[];
}) {
  const [text, setText] = useState("");
  const [autoAssign, setAutoAssign] = useState(true);
  const [perPanel, setPerPanel] = useState(10);
  const [division, setDivision] = useState(divisions[0] ?? "");
  const [category, setCategory] = useState(categories[0]?.id ?? "");
  const [loaded, setLoaded] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  /** Read a dropped or chosen file straight into the box. */
  async function takeFile(file: File | undefined | null) {
    if (!file) return;
    onError(null);
    setResult(null);
    setLoaded(null);
    try {
      const sheet = await readSpreadsheet(file);
      setText(sheet.text);
      setLoaded(
        `Loaded ${sheet.rows} row${sheet.rows === 1 ? "" : "s"} from ${file.name}.` +
          (sheet.warning ? ` ${sheet.warning}` : "") +
          " Check it below, then Import.",
      );
    } catch (e) {
      onError((e as Error).message);
    }
  }
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    onError(null);
    setResult(null);
    try {
      const res = await call<{ imported: number; skipped: number; assigned: number }>(
        "/api/admin/teams",
        { body: { text, autoAssign, perPanel, division, category } },
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
          optional, and reads best as a letter and a number like <code className="text-zinc-300">A1</code>, which is what puts
          the team on the board&apos;s pit floor plan. Team numbers may include letters —{" "}
          <code className="text-zinc-300">9882K</code>{" "}
          works as well as <code className="text-zinc-300">1234</code>. Everything you load goes
          into the division and notebook type chosen below, unless a row names them in a fourth
          and fifth column. Paste straight
          from a spreadsheet — tabs work too, and a header row is skipped automatically.
          Re-importing updates existing teams instead of duplicating them.
        </p>
      </div>

      {/* Drop a spreadsheet, or paste — both end up in the same box. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          takeFile(e.dataTransfer.files?.[0]);
        }}
        className={`rounded-xl border-2 border-dashed p-4 transition ${
          dragging ? "border-indigo-400 bg-indigo-500/10" : "border-white/10"
        }`}
      >
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <label className="cursor-pointer rounded-lg bg-white/5 px-3 py-2 text-zinc-200 ring-1 ring-inset ring-white/10 hover:bg-white/10">
            Choose a file
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xlsx"
              className="hidden"
              onChange={(e) => {
                takeFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <span className="text-zinc-500">
            or drag one here — <code className="text-zinc-400">.xlsx</code>,{" "}
            <code className="text-zinc-400">.csv</code>,{" "}
            <code className="text-zinc-400">.tsv</code>. Or just paste below.
          </span>
        </div>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setLoaded(null);
          }}
          rows={12}
          spellCheck={false}
          placeholder={"1234, Iron Hawks, A1\n9882K, Kilo Kestrels, A2\n9882A, Alpha Antelopes, B1"}
          className={`${inputClass} font-mono text-sm`}
        />
      </div>

      {loaded ? <Banner kind="info">{loaded}</Banner> : null}

      <div className="flex flex-wrap items-center gap-4">
        <label className="text-sm text-zinc-300">
          <span className="mb-1 block text-xs text-zinc-400">Import into</span>
          <select
            value={division}
            onChange={(e) => setDivision(e.target.value)}
            className={`${inputClass} py-2`}
          >
            {divisions.map((d) => (
              <option key={d} value={d} className="bg-zinc-900">
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-zinc-300">
          <span className="mb-1 block text-xs text-zinc-400">Notebook type</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={`${inputClass} py-2`}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id} className="bg-zinc-900">
                {c.label}
              </option>
            ))}
          </select>
        </label>
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
