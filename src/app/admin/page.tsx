"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { liveRequestFor } from "@/lib/data";
import { AdminFrame, railCounts, type AdminTab as Tab } from "@/components/admin/AdminFrame";
import { ConflictsTab } from "@/components/admin/ConflictsTab";
import { FloorTab } from "@/components/admin/FloorTab";
import { PanelsTab } from "@/components/admin/PanelsTab";
import { RefereeTab } from "@/components/admin/RefereeTab";
import { TeamsTab } from "@/components/admin/TeamsTab";
import { call, useAppState, useScores } from "@/components/useAppState";
import { Banner, Button, formatClock, inputClass } from "@/components/ui";
import { NotesDrawer } from "@/components/judging";
import { Rankings } from "@/components/Rankings";
import { readSpreadsheet } from "@/lib/spreadsheet";
import type { Session } from "@/lib/auth";
import type { ActivityRow, Team } from "@/lib/types";

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
  /* Likewise the "N conflicts" pill on a judge's row in Panels: the Conflicts
     tab opens with that judge selected. */
  const [focusJudge, setFocusJudge] = useState<string | null>(null);
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
          // A marked judge or team belongs to the trip you took to see it.
          if (id !== tab) setFocusJudge(null);
          if (id !== tab) setFocusFlagTeam(null);
          setTab(id);
        }}
      >
        {/* The redesigned tabs fill the width the rail leaves; the older ones keep the width and padding they had. */}
        <div className={tab === "floor" || tab === "conflicts" || tab === "panels" || tab === "flags" || tab === "teams" ? "ja-pad" : "mx-auto max-w-7xl px-4 py-5"}>
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
              state={state}
              refresh={refresh}
              onError={setError}
              onOpenConflicts={(judgeId) => {
                setFocusJudge(judgeId);
                setTab("conflicts");
              }}
            />
          ) : null}
          {tab === "conflicts" ? (
            <ConflictsTab state={state} refresh={refresh} onError={setError} focusJudgeId={focusJudge} />
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
