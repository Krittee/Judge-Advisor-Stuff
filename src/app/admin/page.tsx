"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { liveRequestFor } from "@/lib/data";
import { AdminFrame, railCounts, type AdminTab as Tab } from "@/components/admin/AdminFrame";
import { ConflictsTab } from "@/components/admin/ConflictsTab";
import { saveJudgesAfterAsking } from "@/components/admin/conflictsLogic";
import { FloorTab } from "@/components/admin/FloorTab";
import { RefereeTab } from "@/components/admin/RefereeTab";
import { TeamsTab } from "@/components/admin/TeamsTab";
import { call, useAppState, useScores } from "@/components/useAppState";
import { Banner, Button, formatClock, inputClass } from "@/components/ui";
import { NotesDrawer } from "@/components/judging";
import { Rankings } from "@/components/Rankings";
import { useConfirm } from "@/components/ConfirmDialog";
import { readSpreadsheet } from "@/lib/spreadsheet";
import type { Session } from "@/lib/auth";
import type { ActivityRow, Panel, Team } from "@/lib/types";

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
        <div className={tab === "floor" || tab === "conflicts" || tab === "flags" || tab === "teams" ? "ja-pad" : "mx-auto max-w-7xl px-4 py-5"}>
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
          {tab === "teams" ? (
            <TeamsTab
              state={state}
              refresh={refresh}
              onError={setError}
              onOpenFlags={(teamId) => {
                setFocusFlagTeam(teamId);
                setTab("flags");
              }}
            />
          ) : null}
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
