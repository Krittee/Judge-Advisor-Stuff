"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { liveRequestFor } from "@/lib/data";
import { divisionsCompatible } from "@/lib/presets";
import { panelBlocks } from "@/lib/roster";
import { AdminFrame, railCounts, type AdminTab as Tab } from "@/components/admin/AdminFrame";
import { ConflictsTab } from "@/components/admin/ConflictsTab";
import { saveJudgesAfterAsking } from "@/components/admin/conflictsLogic";
import { FloorTab } from "@/components/admin/FloorTab";
import { RefereeTab } from "@/components/admin/RefereeTab";
import { canTransition, STATUS_META, type Status } from "@/lib/status";
import { call, useAppState, useScores } from "@/components/useAppState";
import {
  Banner,
  BookingTime,
  Button,
  formatClock,
  inputClass,
  StatusChip,
} from "@/components/ui";
import { NotesDrawer } from "@/components/judging";
import { Rankings } from "@/components/Rankings";
import { useConfirm } from "@/components/ConfirmDialog";
import { CategoryChip, CategorySelect } from "@/components/CategoryChip";
import { readSpreadsheet } from "@/lib/spreadsheet";
import type { Session } from "@/lib/auth";
import type { ActivityRow, Panel, RequestRow, Team } from "@/lib/types";

/** The Judge Advisor's console: every panel at once, and the tools to unstick it. */
export default function AdminPage() {
  const router = useRouter();
  const { state, online, refresh } = useAppState(4000);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("floor");
  const [error, setError] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<Team | null>(null);
  /* Set when the Conduct column on Scores sends you to a team's flags, so
     the Referee tab knows which one to scroll to and mark. */
  const [focusFlagTeam, setFocusFlagTeam] = useState<string | null>(null);
  /* Only while the Scores tab is open: nothing else on this console reads
     rubric totals, so polling for them behind the other five tabs would
     be a request every 15 seconds that nothing renders. */
  const scoreData = useScores({ enabled: tab === "scores" });

  useEffect(() => {
    call<{ session: Session | null }>("/api/session", { method: "GET" })
      .then(({ session }) => {
        if (session?.role !== "admin") {
          router.replace("/admin/login");
          return;
        }
        setSession(session);
      })
      .catch(() => router.replace("/admin/login"));
  }, [router]);

  if (session === undefined) {
    return <p className="p-10 text-center text-ink-faint">Loading…</p>;
  }

  /* The shell orders the sections by the Judge Advisor's day rather than
     alphabetically, and groups them: what is happening now, then the roster
     behind it, then the record of both. The counts are what turn eight
     words into something you can triage -- "Conflicts" says nothing,
     "Conflicts 2" sends you there. Floor's is only the teams actually
     waiting, Conflicts' only the judges' (older whole-panel entries are not
     counted); a total that is merely large is not a reason to look. */
  const counts = railCounts(state);

  return (
    <>
      <AdminFrame
        name={session?.name}
        online={online}
        tab={tab}
        counts={counts}
        onTab={(id) => {
          // A marked team belongs to the trip you took to see it.
          if (id !== tab) setFocusFlagTeam(null);
          setTab(id);
        }}
      >
        {/* The redesigned tabs fill the width the rail leaves; the older ones keep the width and padding they had. */}
        <div className={tab === "floor" || tab === "conflicts" || tab === "flags" ? "ja-pad" : "mx-auto max-w-7xl px-4 py-5"}>
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
              scores={scoreData.scores}
              rubricList={scoreData.rubrics}
              loaded={scoreData.loaded}
              error={scoreData.error}
              panelName={Object.fromEntries(state.panels.map((p) => [p.id, p.name]))}
              onOpenTeam={setNotesFor}
              flags={state.flags}
              flagKinds={state.flagKinds}
              onOpenFlags={(team) => {
                setFocusFlagTeam(team.id);
                setTab("flags");
              }}
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
          {tab === "flags" ? (
            <RefereeTab
              state={state}
              refresh={refresh}
              onError={setError}
              focusTeamId={focusFlagTeam}
              adminName={session?.name}
            />
          ) : null}
          {tab === "import" ? (
            <ImportTab refresh={refresh} onError={setError} divisions={state.divisions} />
          ) : null}
          {tab === "log" ? <ActivityTab /> : null}
        </div>
      </AdminFrame>

      {notesFor ? (
        <NotesDrawer
          team={notesFor}
          requestId={liveRequestFor(notesFor.id, state.requests)?.id ?? null}
          categories={state.categories}
          onClose={() => setNotesFor(null)}
        />
      ) : null}
    </>
  );
}

type TabProps = {
  state: ReturnType<typeof useAppState>["state"];
  refresh: () => Promise<void>;
  onError: (m: string | null) => void;
};

/* ==================================================================== */
/* Teams — the roster and who judges whom                                */
/* ==================================================================== */

/** What the Judge Advisor's status override can move a request to.
 *  "scheduled" is left out -- getting back there needs a slot_start too,
 *  which this override was never meant to reconstruct. */
const RESETTABLE_STATUSES: Status[] = [
  "requested",
  "acknowledged",
  "interviewing",
  "completed",
  "cancelled",
];

function TeamsTab({ state, refresh, onError }: TabProps) {
  const [filter, setFilter] = useState("");
  const [perPanel, setPerPanel] = useState(10);
  const [division, setDivision] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const { ask, dialog } = useConfirm();

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

  /* Panel/team pairs that must never be put together. The API refuses them
     anyway, but an option you cannot choose does not belong in the list. */
  const conflicted = useMemo(
    () =>
      new Set(
        panelBlocks(state.conflicts, state.judges).map((b) => `${b.panel_id}:${b.team_id}`),
      ),
    [state.conflicts, state.judges],
  );

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

  /**
   * Judge Advisor override for a mis-clicked interview status.
   *
   * Routed through whichever existing action actually gets a status
   * right, rather than always calling set-status directly: "reopen"
   * clears the stale acknowledged/started/finished timestamps a
   * completed or cancelled request is still carrying (set-status alone
   * does not), and "cancel" is what actually stamps cancelled_at.
   * Those two are held to the transition table (status.ts): reopen only
   * a finished request, cancel only an open one. Where the table would
   * refuse -- stepping a live request back to "requested", or cancelling
   * one that already completed -- set-status covers it, and is
   * unrestricted for an admin session — this whole page is admin-only
   * already (see the redirect on load), so nothing further needs to gate
   * this by role.
   */
  async function resetRequestStatus(request: RequestRow, status: Status) {
    onError(null);
    try {
      const action =
        status === "requested" && canTransition("reopen", request.status)
          ? "reopen"
          : status === "cancelled" && canTransition("cancel", request.status)
            ? "cancel"
            : "set-status";
      await call(`/api/requests/${request.id}`, {
        method: "PATCH",
        // `from`: the status the row is showing, so a stale screen is refused.
        body: { action, from: request.status, ...(action === "set-status" ? { status } : {}) },
      });
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
      {dialog}
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
          <option value="" className="bg-surface">
            All divisions
          </option>
          {state.divisions.map((d) => (
            <option key={d} value={d} className="bg-surface">
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
          <option value="" className="bg-surface">
            All notebooks
          </option>
          {state.categories.map((c) => (
            <option key={c.id} value={c.id} className="bg-surface">
              {c.label}
            </option>
          ))}
        </select>
        <div className="flex items-end gap-2">
          <label className="text-sm text-ink-subtle">
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
        <span className="ml-auto text-sm text-ink-faint">
          {state.teams.length} teams · {state.panels.length} panels
        </span>
        <p className="w-full text-xs text-ink-faint">
          Team number, name and pit are editable — click one and type. Pits read as a letter and a
          number (<code className="text-ink-faint">A1</code>), which is what places a team on the
          board&apos;s floor plan.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {state.categories.map((c) => (
          <span key={c.id} className="flex items-center gap-1.5">
            <CategoryChip category={c.id} categories={state.categories} />
            <span className="text-ink-muted">
              {shown.filter((t) => t.category === c.id).length}
            </span>
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {state.panels
          .filter((p) => !division || p.division === division)
          .map((p) => (
            <span key={p.id} className="rounded-lg bg-surface px-3 py-1.5 text-ink-subtle">
              {p.name}: <span className="text-ink">{perPanelCount.get(p.id) ?? 0}</span>
              <span className="ml-2 text-ink-faint">{p.division}</span>
            </span>
          ))}
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-inset ring-line">
        {/* min-w-max so the table overflows its scroller instead of
            squeezing every column to fit -- squeezed columns truncate the
            team number, which is the one thing on this row you navigate
            by. Overflowing is what makes the pinned first column mean
            anything. */}
        <table className="w-full min-w-max text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-ink-faint">
            {/* Nine columns do not fit a phone and never will. Rather than
                keep a second card rendering of every editable cell in
                step with this one, the number column pins so you keep
                your place while scrolling sideways, and the two fields
                nobody edits under time pressure drop off the narrow
                layout. Everything stays reachable on a wider screen. */}
            <tr>
              <th className="sticky left-0 z-10 bg-surface-2 px-4 py-3 shadow-[1px_0_0_var(--line)]">Team</th>
              <th className="px-4 py-3">Name</th>
              <th className="hidden px-4 py-3 sm:table-cell">Pit</th>
              <th className="hidden px-4 py-3 sm:table-cell">Notebook</th>
              <th className="px-4 py-3">Division</th>
              <th className="px-4 py-3">Judge panel</th>
              <th className="px-4 py-3">Booked</th>
              <th className="px-4 py-3">Interview</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((team) => {
              const req = liveRequestFor(team.id, state.requests);
              const done = state.requests.find(
                (r) => r.team_id === team.id && r.status === "completed",
              );
              // Any slot this team holds or held today. BookingTime counts
              // down only while it is still "scheduled"; afterwards it just
              // reads the time, which is what the desk asks about later. A
              // cancelled slot is not a time anyone should turn up for, and
              // liveRequestFor already leaves those out.
              const booking = (req ?? done)?.kind === "slot" ? (req ?? done) : null;
              return (
                <tr key={team.id} className="hover:bg-surface-2">
                  <td className="sticky left-0 z-10 bg-canvas px-2 py-1.5 shadow-[1px_0_0_var(--line)]">
                    {/* Fixed at a team number's actual width -- left to the
                        browser's default input size, this alone ate almost
                        half a phone screen regardless of the 4-6 characters
                        actually in it. */}
                    <EditableCell
                      value={team.number}
                      className="font-bold tabular-nums"
                      style={{ width: "4.5rem" }}
                      onSave={(number) => update(team.id, { number })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    {/* Same fix, plus truncation -- a long team name still
                        fits in the space the columns after it need to be
                        visible on a phone without scrolling. Tapping it to
                        edit still shows the full value. */}
                    <EditableCell
                      value={team.name}
                      className="text-ink-muted truncate"
                      style={{ width: "9rem" }}
                      onSave={(name) => update(team.id, { name })}
                    />
                  </td>
                  <td className="hidden w-24 px-2 py-1.5 sm:table-cell">
                    <EditableCell
                      value={team.pit ?? ""}
                      placeholder="—"
                      align="center"
                      className="tabular-nums text-ink-subtle"
                      onSave={(pit) => update(team.id, { pit: pit || null })}
                    />
                  </td>
                  <td className="hidden px-4 py-2.5 sm:table-cell">
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
                      className="rounded-lg bg-surface px-2 py-1.5 text-xs ring-1 ring-inset ring-line"
                      title="Changing division unassigns the team from its panel"
                    >
                      {state.divisions.map((d) => (
                        <option key={d} value={d} className="bg-surface">
                          {d}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={team.panel_id ?? ""}
                      onChange={(e) => update(team.id, { panelId: e.target.value || null })}
                      className="rounded-lg bg-surface px-2 py-1.5 text-xs ring-1 ring-inset ring-line"
                    >
                      <option value="" className="bg-surface">
                        — unassigned —
                      </option>
                      {/* Only panels on this team's side of the wall, and
                          never one declared conflicted with this team. */}
                      {state.panels
                        .filter(
                          (p) =>
                            divisionsCompatible(team.division, p.division) &&
                            (!conflicted.has(`${p.id}:${team.id}`) ||
                              // A conflicted panel is dropped from the list,
                              // but never the one currently selected: a select
                              // whose value is missing from its own options
                              // renders as something else and quietly
                              // misreports who holds the team.
                              p.id === team.panel_id),
                        )
                        .map((p) => (
                          <option key={p.id} value={p.id} className="bg-surface">
                            {p.name}
                            {conflicted.has(`${p.id}:${team.id}`) ? " — conflicted" : ""}
                          </option>
                        ))}
                    </select>
                  </td>
                  {/* The booked time, on the overview rather than one page
                      per team: the coordinator's question is "who is up
                      next", which used to mean opening all 120 of them. */}
                  <td className="px-4 py-2.5">
                    <BookingTime
                      slotStart={booking?.slot_start ?? null}
                      status={booking?.status}
                      size="sm"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    {req || done ? (
                      <div className="flex items-center gap-1.5">
                        <StatusChip status={(req ?? done)!.status} size="sm" short />
                        <select
                          value=""
                          onChange={(e) => {
                            const status = e.target.value as Status;
                            if (!status) return;
                            resetRequestStatus((req ?? done)!, status);
                            e.target.value = "";
                          }}
                          title="Judge Advisor override — corrects a mistake, not the normal flow"
                          aria-label={`Reset ${team.number}'s interview status`}
                          className="rounded-md bg-surface px-1 py-1 text-[11px] text-ink-faint ring-1 ring-inset ring-line hover:text-ink-muted"
                        >
                          <option value="" className="bg-surface">
                            reset…
                          </option>
                          {RESETTABLE_STATUSES.map((s) => (
                            <option key={s} value={s} className="bg-surface">
                              {STATUS_META[s].label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <span className="text-xs text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={async () => {
                        if (
                          !(await ask(`Remove team ${team.number} and all its requests?`, {
                            confirmLabel: "Remove team",
                            danger: true,
                          }))
                        ) {
                          return;
                        }
                        try {
                          await call(`/api/admin/teams?teamId=${team.id}`, { method: "DELETE" });
                          await refresh();
                        } catch (e) {
                          onError((e as Error).message);
                        }
                      }}
                      className="text-xs text-ink-faint hover:text-danger-quiet"
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
        <p className="py-8 text-center text-sm text-ink-faint">
          No teams match. Use the Import tab to add your roster.
        </p>
      ) : null}

      <StorageHealth />

      <DangerZone refresh={refresh} onError={onError} />
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
  style,
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
  placeholder?: string;
  className?: string;
  align?: "left" | "center";
  /**
   * Overrides the input's width. A plain width utility in `className`
   * cannot be trusted to beat the `w-full` baked in below -- Tailwind
   * orders same-specificity utilities by its own internal scale, not by
   * where they appear in the class list -- so a real column width goes
   * through inline style, which always wins.
   */
  style?: React.CSSProperties;
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
      style={style}
      className={`w-full rounded-lg bg-transparent px-2 py-1.5 text-sm ring-1 ring-inset ring-transparent transition hover:bg-surface-2 hover:ring-line-strong focus:bg-surface-2 focus:ring-accent focus:outline-none disabled:opacity-50 ${
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
      <p className="text-xs text-ink-faint">
        Storing into <span className="text-ink-muted">{health.location}</span>
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
  const { ask, dialog } = useConfirm();

  async function reset(action: "resetDay" | "resetAll", confirmText: string) {
    const confirmLabel = action === "resetAll" ? "Wipe everything" : "Clear today";
    if (!(await ask(confirmText, { confirmLabel, danger: true }))) return;
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
    <details className="mt-8 rounded-xl bg-surface p-4 ring-1 ring-inset ring-line">
      <summary className="cursor-pointer text-sm text-ink-faint hover:text-ink-muted">
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
              "Clear today's requests, notes, scores and activity?\n\nTeams, panels and event-wide referee history are kept.",
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
              "Delete the ENTIRE EVENT — teams, panels, requests, notes, scores and referee history?\n\nUse this before importing a new event. This cannot be undone.",
            )
          }
        >
          Wipe everything
        </Button>
        <span className="text-xs text-ink-faint">
          Use &ldquo;wipe everything&rdquo; before every new event (and once to clear the demo teams).
        </span>
      </div>
      {dialog}
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
        className="flex flex-wrap items-end gap-3 rounded-xl bg-surface p-4 ring-1 ring-inset ring-line"
      >
        <label className="min-w-[10rem] flex-1">
          <span className="mb-1 block text-xs text-ink-subtle">Panel name</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Panel D"
            className={`${inputClass} py-2`}
          />
        </label>
        <label className="min-w-[9rem] flex-1">
          <span className="mb-1 block text-xs text-ink-subtle">Division</span>
          <select
            value={draft.division || divisions[0] || ""}
            onChange={(e) => setDraft({ ...draft, division: e.target.value })}
            className={`${inputClass} py-2`}
          >
            {divisions.map((d) => (
              <option key={d} value={d} className="bg-surface">
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[14rem] flex-[2]">
          <span className="mb-1 block text-xs text-ink-subtle">Judges (comma separated)</span>
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

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
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
        <span className="text-xs text-ink-faint">
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
        <p className="py-8 text-center text-sm text-ink-faint">
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
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-danger/8 p-4 ring-1 ring-inset ring-danger/25">
      {armed ? (
        <>
          <Button variant="danger" size="sm" disabled={busy} onClick={run}>
            {busy ? "Deleting…" : `Yes, delete all ${assigned}`}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setArmed(false)}>
            Cancel
          </Button>
          <span className="text-xs text-danger-quiet">
            Every judge code stops working immediately. Your teams stay, unassigned.
          </span>
        </>
      ) : (
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setArmed(true)}>
            Delete all panels
          </Button>
          <span className="text-xs text-ink-faint">
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
  const { ask, dialog } = useConfirm();

  return (
    <div className="space-y-3 rounded-xl bg-surface p-4 ring-1 ring-inset ring-line">
      {dialog}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{panel.name}</h3>
          <p className="text-xs text-ink-faint">{panel.division}</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-ink-faint">Judge code</div>
          <code className="text-lg font-bold tracking-widest text-accent-quiet">{panel.code}</code>
        </div>
      </div>

      <input
        defaultValue={panel.judges.join(", ")}
        onBlur={async (e) => {
          const field = e.currentTarget;
          const judges = field.value;
          if (judges.trim() === panel.judges.join(", ")) return;
          /* A judge with conflicts joining a panel that holds the team takes
             it off the panel, so look first (`dryRun`), ask, then save. */
          try {
            const saved = await saveJudgesAfterAsking(
              ask,
              panel.name,
              async () =>
                (
                  await call<{ takenOff: string[] }>("/api/admin/panels", {
                    method: "PATCH",
                    body: { id: panel.id, judges, dryRun: true },
                  })
                ).takenOff,
              () => onPatch(panel.id, { judges }),
            );
            if (!saved) field.value = panel.judges.join(", ");
          } catch (err) {
            onError((err as Error).message);
          }
        }}
        placeholder="Judge names, comma separated"
        className={`${inputClass} py-2 text-sm`}
      />

      <div className="text-xs text-ink-subtle">
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
                    ? "bg-accent text-white"
                    : "bg-surface text-ink-faint ring-1 ring-inset ring-line"
                }`}
              >
                {l.label}
              </button>
            );
          })}
        </div>
        {!panel.languages.length ? (
          <p className="mt-1 text-ink-faint">Not stated — no request will be flagged.</p>
        ) : null}
      </div>

      <label className="block text-xs text-ink-subtle">
        Division
        <select
          value={panel.division}
          onChange={async (e) => {
            // Read it now: the select snaps back to the panel's division while
            // the question is open, so e.target.value is stale by the answer.
            const division = e.target.value;
            if (
              !(await ask(
                `Move ${panel.name} to ${division}?\n\n` +
                  "Its current teams stay in their own division and become " +
                  "unassigned, so you will need to give them to another panel.",
                { confirmLabel: "Move division", danger: true },
              ))
            ) {
              return;
            }
            onPatch(panel.id, { division });
          }}
          className={`${inputClass} mt-1 py-2 text-sm`}
        >
          {divisions.map((d) => (
            <option key={d} value={d} className="bg-surface">
              {d}
            </option>
          ))}
        </select>
      </label>

      <details className="text-sm">
        <summary className="cursor-pointer text-ink-subtle hover:text-ink">
          Booking slots {panel.slot_count ? `(${panel.slot_count})` : "(off)"}
        </summary>
        <div className="mt-3 space-y-2">
          <label className="block text-xs text-ink-subtle">
            First slot starts
            <input
              type="datetime-local"
              value={slotStart}
              onChange={(e) => setSlotStart(e.target.value)}
              className={`${inputClass} mt-1 py-2 text-sm`}
            />
          </label>
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-ink-subtle">
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
            <label className="flex-1 text-xs text-ink-subtle">
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
          <p className="text-xs text-ink-faint">Set &ldquo;how many&rdquo; to 0 for walk-up queue only.</p>
        </div>
      </details>

      <button
        onClick={async () => {
          if (
            !(await ask(`Delete ${panel.name}? Its teams become unassigned.`, {
              confirmLabel: "Delete panel",
              danger: true,
            }))
          ) {
            return;
          }
          try {
            await call(`/api/admin/panels?id=${panel.id}`, { method: "DELETE" });
            await onReload();
          } catch (e) {
            onError((e as Error).message);
          }
        }}
        className="text-xs text-ink-faint hover:text-danger-quiet"
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
}: {
  refresh: () => Promise<void>;
  onError: (m: string | null) => void;
  divisions: string[];
}) {
  const [text, setText] = useState("");
  const [autoAssign, setAutoAssign] = useState(true);
  const [perPanel, setPerPanel] = useState(10);
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
        <p className="mt-1 text-sm text-ink-subtle">
          One team per line: <code className="text-ink-muted">number, name, pit, division</code>.
          Division is each team&apos;s own — <code className="text-ink-muted">Elementary School</code>,{" "}
          <code className="text-ink-muted">Middle School</code>, and so on — so one paste can bring
          in every division at once; a row with nothing in that column falls back to{" "}
          {divisions[0] ? <code className="text-ink-muted">{divisions[0]}</code> : "the first configured division"}.
          Pit is optional, and reads best as a letter and a number like{" "}
          <code className="text-ink-muted">A1</code>, which is what puts the team on the
          board&apos;s pit floor plan. Team numbers may include letters —{" "}
          <code className="text-ink-muted">9882K</code>{" "}
          works as well as <code className="text-ink-muted">1234</code>. Notebook type isn&apos;t
          set here — every imported team starts as the event&apos;s default classification, and
          the Judge Advisor sorts Developing from Fully Developed during review. Paste straight
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
          dragging ? "border-accent bg-accent/10" : "border-line"
        }`}
      >
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <label className="cursor-pointer rounded-lg bg-surface px-3 py-2 text-ink ring-1 ring-inset ring-line hover:bg-surface-2">
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
          <span className="text-ink-faint">
            or drag one here — <code className="text-ink-subtle">.xlsx</code>,{" "}
            <code className="text-ink-subtle">.csv</code>,{" "}
            <code className="text-ink-subtle">.tsv</code>. Or just paste below.
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
          placeholder={
            "1234, Iron Hawks, A1, Elementary School\n" +
            "9882K, Kilo Kestrels, A2, Middle School\n" +
            "9882A, Alpha Antelopes, B1, Elementary School"
          }
          className={`${inputClass} font-mono text-sm`}
        />
      </div>

      {loaded ? <Banner kind="info">{loaded}</Banner> : null}

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={autoAssign}
            onChange={(e) => setAutoAssign(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Spread across panels evenly
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-subtle">
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
        .then(({ activity }) => {
          setRows(activity);
          // A later success is the recovery; without this the banner from
          // one dropped poll stayed up, hiding the log, for good.
          setError(null);
        })
        .catch((e) => setError((e as Error).message));
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  if (error) return <Banner kind="error">{error}</Banner>;

  return (
    <ul className="divide-y divide-line rounded-xl ring-1 ring-inset ring-line">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
          <span className="w-20 shrink-0 text-ink-faint">{formatClock(r.created_at)}</span>
          <span className="w-48 shrink-0 truncate text-ink-subtle">{r.actor}</span>
          <span className="text-ink">{r.action}</span>
          {r.detail ? <span className="text-ink-faint">{r.detail}</span> : null}
        </li>
      ))}
      {!rows.length ? (
        <li className="px-4 py-8 text-center text-sm text-ink-faint">Nothing logged yet.</li>
      ) : null}
    </ul>
  );
}
