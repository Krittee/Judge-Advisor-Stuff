"use client";

import { useState } from "react";
import { call } from "./useAppState";
import { Banner, Button, inputClass } from "./ui";
import type { Team } from "@/lib/types";

/**
 * Declare a conflict of interest with a team.
 *
 * Deliberately one-way from here: a judge can put a conflict up, but only
 * the Judge Advisor can take one down. Letting a judge withdraw their own
 * would make the declaration worth nothing.
 */
export function ConflictDialog({
  team,
  panelId,
  onClose,
  onDone,
}: {
  team: Team;
  /** Only the Judge Advisor passes this; a judge's own panel is implied. */
  panelId?: string;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [judgeName, setJudgeName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function declare() {
    setBusy(true);
    setError(null);
    try {
      await call("/api/conflicts", {
        body: { teamId: team.id, panelId, judgeName, note },
      });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-[#14141c] p-5 ring-1 ring-white/10 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">
          Conflict of interest — {team.number} {team.name}
        </h2>
        <p className="mt-1 mb-4 text-sm text-zinc-400">
          Declaring this puts the team out of reach for your whole panel: no interview, no
          notebook, no notes. Only the Judge Advisor can undo it.
        </p>

        {error ? <Banner kind="error">{error}</Banner> : null}

        <label className="mt-3 block">
          <span className="mb-1 block text-xs text-zinc-400">Which judge is affiliated?</span>
          <input
            value={judgeName}
            onChange={(e) => setJudgeName(e.target.value)}
            placeholder="Judge name"
            autoFocus
            className={`${inputClass} py-2`}
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs text-zinc-400">How are they connected?</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. coaches this team, parent of a member"
            maxLength={280}
            className={`${inputClass} py-2`}
          />
        </label>

        <div className="mt-5 flex gap-2">
          <Button variant="danger" className="flex-1" disabled={busy} onClick={declare}>
            {busy ? "Declaring…" : "Declare conflict"}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
