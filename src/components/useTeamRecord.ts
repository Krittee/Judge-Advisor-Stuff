"use client";

import { useEffect, useMemo, useState } from "react";
import { call } from "./useAppState";
import { rubricsFor, totalFor } from "@/lib/rubrics";
import type { Rubric } from "@/lib/rubrics";
import type { Note, ScoreRow, Team } from "@/lib/types";

/**
 * Everything a judge records about one team, with no markup of its own:
 * the private notes, the team's score rows, the draft of the next note and
 * the total those scores add up to. Shared by the Judge Advisor's NotesDrawer
 * and the judge console's team sheet.
 *
 * The endpoints behind it refuse anyone who is not a judge or the Judge
 * Advisor, and refuse a judge looking at a team outside their own panel.
 */
export function useTeamRecord(
  team: Team,
  /** The team's live request: a new note is filed against it. */
  requestId: string | null,
  /** Needed to know which rubrics this team's category is judged on. */
  categories: { id: string; label: string; excludesRubrics?: string[] }[],
) {
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

  /** Save the draft as a note. True once it is saved, false if there was nothing to save or it failed. */
  async function saveNote(): Promise<boolean> {
    if (!draft.trim()) return false;
    setBusy(true);
    setError(null);
    try {
      await call("/api/notes", { body: { teamId: team.id, requestId, body: draft } });
      setDraft("");
      await loadNotes();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /* Total across the rubrics this team is judged on, which is what the
     colour band reads. A category can put one out of scope: an Ungraded
     notebook is unmarked, not zero, so it counts in neither the total nor
     the denominator. */
  const applicable = rubricsFor(rubrics, team.category, categories);
  const { total, max, scored } = totalFor(scores, applicable);

  return {
    notes,
    draft,
    setDraft,
    /** A note is being saved. */
    busy,
    error,
    rubrics,
    scores,
    /** For ScoreSheet / RubricSegment: `onSaved` and `onCleared` update these. */
    setScores,
    saveNote,
    /** The rubrics that count for this team. */
    applicable,
    total,
    max,
    scored,
    /** The rubric its category leaves out, if any: say why the denominator is smaller. */
    excludedLabel: rubrics.find((r) => !applicable.some((a) => a.id === r.id))?.name,
    /** The team's category, as the person reads it. */
    categoryLabel: categories.find((c) => c.id === team.category)?.label,
  };
}
