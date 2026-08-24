"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { call } from "./useAppState";
import { Banner, Button, formatClock, inputClass } from "./ui";
import { ScoreSheet } from "./ScoreSheet";
import { BandChip } from "./BandChip";
import type { Rubric } from "@/lib/rubrics";
import type { Note, ScoreRow, Team } from "@/lib/types";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await call("/api/session", { method: "DELETE" });
        router.replace("/login");
      }}
      className="text-sm text-zinc-400 hover:text-zinc-200"
    >
      Sign out
    </button>
  );
}

/**
 * Private judging notes for one team. The endpoint behind this refuses
 * anyone who is not a judge or the Judge Advisor, so a queue-desk session
 * cannot open it even by guessing the URL.
 */
/**
 * Everything a judge records about one team: private notes, and a tab
 * per rubric. Judges and the Judge Advisor only — the endpoints behind
 * every tab refuse anyone else, and refuse a judge looking at a team
 * outside their own panel.
 */
export function NotesDrawer({
  team,
  requestId,
  onClose,
}: {
  team: Team;
  requestId: string | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<string>("notes");
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);

  const loadNotes = useMemo(
    () => () =>
      call<{ notes: Note[] }>(`/api/notes?teamId=${team.id}`, { method: "GET" })
        .then(({ notes }) => setNotes(notes))
        .catch((e) => setError((e as Error).message)),
    [team.id],
  );

  useEffect(() => {
    loadNotes();
    call<{ scores: ScoreRow[]; rubrics: Rubric[] }>(`/api/scores?teamId=${team.id}`, {
      method: "GET",
    })
      .then((d) => {
        setRubrics(d.rubrics);
        setScores(d.scores);
      })
      .catch((e) => setError((e as Error).message));
  }, [loadNotes, team.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await call("/api/notes", { body: { teamId: team.id, requestId, body: draft } });
      setDraft("");
      await loadNotes();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Total across every rubric, which is what the colour band reads. */
  const grandTotal = scores.reduce((sum, s) => sum + s.total, 0);
  const grandMax = rubrics.reduce((sum, r) => sum + r.max, 0);
  const anyScored = scores.some((s) => Object.keys(s.values ?? {}).length);

  const tabs: [string, string][] = [
    ["notes", "Notes"],
    ...rubrics.map((r) => [r.id, r.name] as [string, string]),
  ];

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[#14141c] p-5 ring-1 ring-white/10 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">
              {team.number} · {team.name}
            </h2>
            <p className="text-xs text-zinc-500">Private to judges and the Judge Advisor.</p>
          </div>
          <div className="flex items-center gap-3">
            {grandMax > 0 ? (
              <div className="text-right">
                <div className="text-lg font-bold tabular-nums leading-none">
                  {grandTotal}
                  <span className="text-xs font-normal text-zinc-500"> / {grandMax}</span>
                </div>
                <BandChip total={grandTotal} max={grandMax} scored={anyScored} />
              </div>
            ) : null}
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
              ✕
            </button>
          </div>
        </div>

        <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-white/10">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition ${
                tab === id
                  ? "border-indigo-400 text-indigo-300"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {label}
              {id !== "notes"
                ? (() => {
                    const s = scores.find((x) => x.rubric_id === id);
                    const r = rubrics.find((x) => x.id === id);
                    return s && r ? (
                      <span className="ml-1.5 text-xs tabular-nums opacity-70">
                        {s.total}/{r.max}
                      </span>
                    ) : null;
                  })()
                : null}
            </button>
          ))}
        </nav>

        {error ? <Banner kind="error">{error}</Banner> : null}

        {tab === "notes" ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              placeholder="What stood out? Follow-ups? Award notes?"
              className={`${inputClass} resize-y`}
            />
            <Button className="mt-3 w-full" onClick={save} disabled={busy || !draft.trim()}>
              {busy ? "Saving…" : "Save note"}
            </Button>

            <ul className="mt-5 space-y-3">
              {notes.map((n) => (
                <li key={n.id} className="rounded-xl bg-white/[0.04] p-3 text-sm">
                  <div className="mb-1 flex justify-between text-xs text-zinc-500">
                    <span>{n.author}</span>
                    <span>{formatClock(n.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-zinc-200">{n.body}</p>
                </li>
              ))}
              {!notes.length ? <li className="text-sm text-zinc-600">No notes yet.</li> : null}
            </ul>
          </>
        ) : null}

        {rubrics.map((rubric) =>
          tab === rubric.id ? (
            <ScoreSheet
              key={rubric.id}
              rubric={rubric}
              teamId={team.id}
              score={scores.find((s) => s.rubric_id === rubric.id) ?? null}
              onSaved={(saved) =>
                setScores((prev) => [
                  ...prev.filter((s) => s.rubric_id !== saved.rubric_id),
                  saved,
                ])
              }
              onCleared={(rubricId) =>
                setScores((prev) => prev.filter((s) => s.rubric_id !== rubricId))
              }
            />
          ) : null,
        )}
      </div>
    </div>
  );
}
