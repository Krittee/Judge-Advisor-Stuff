"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { call } from "./useAppState";
import { Banner, Button, formatClock, inputClass } from "./ui";
import type { Note, Team } from "@/lib/types";

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
export function NotesDrawer({
  team,
  requestId,
  onClose,
}: {
  team: Team;
  requestId: string | null;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useMemo(
    () => () =>
      call<{ notes: Note[] }>(`/api/notes?teamId=${team.id}`, { method: "GET" })
        .then(({ notes }) => setNotes(notes))
        .catch((e) => setError((e as Error).message)),
    [team.id],
  );

  useEffect(() => {
    load();
  }, [load]);

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
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[#14141c] p-5 ring-1 ring-white/10 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold">
              {team.number} · {team.name}
            </h2>
            <p className="text-xs text-zinc-500">Private to judges and the Judge Advisor.</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            ✕
          </button>
        </div>

        {error ? <Banner kind="error">{error}</Banner> : null}

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          placeholder="What stood out? Follow-ups? Award notes?"
          className={`${inputClass} mt-3 resize-y`}
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
      </div>
    </div>
  );
}
