"use client";

import { use, useEffect, useState } from "react";
import { liveRequestFor } from "@/lib/data";
import { call, useAppState } from "@/components/useAppState";
import { normalizeTeamNumber } from "@/lib/teamNumber";
import { useConfirm } from "@/components/ConfirmDialog";
import { CenteredNote, TeamNotFound, TeamView } from "@/components/team/TeamView";
import { cancelAfterAsking, earlierToday } from "@/components/team/teamLogic";

/**
 * A team's own page: where it stands, and what it can ask for.
 *
 * What is drawn is in components/team/TeamView.tsx ("Status board",
 * design/team-redesign/). This page keeps the polling and every write.
 */
export default function TeamPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = use(params);
  // The URL may carry any casing; the roster stores one canonical form.
  const teamNumber = normalizeTeamNumber(decodeURIComponent(number));
  const { state, loaded, online, refresh } = useAppState(4000);
  const { ask, dialog } = useConfirm();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  // "4 min ago" moves without any new state arriving, so it has its own tick.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const team = state.teams.find((t) => t.number === teamNumber);
  const panel = state.panels.find((p) => p.id === team?.panel_id);
  const current = team ? liveRequestFor(team.id, state.requests) : null;
  // A booking is not the same as being in the queue: a team holding a
  // later slot can still say they are ready now.
  const booking = current?.status === "scheduled" ? current : null;

  /** `bookingId`: turn that held booking into the request in place, rather than creating a second one. */
  async function act(body: Record<string, unknown>, bookingId?: string) {
    setBusy(true);
    setError(null);
    try {
      await (bookingId
        ? call(`/api/requests/${bookingId}`, { method: "PATCH", body: { action: "ready-now", ...body } })
        : call("/api/requests", { body }));
      setMessage("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Ready early: a held slot becomes the queue request, so it does not sit
   * there unused. One call, not cancel-then-create -- if that second step
   * failed the team was left with neither the slot nor a place in line.
   */
  function readyNow(language: string) {
    return act({ teamNumber: team!.number, kind: "queue", language, message }, booking?.id);
  }

  /** Cancel asks first: it is the one thing here a team cannot take back. */
  async function cancel() {
    if (!current) return;
    await cancelAfterAsking(ask, current, async () => {
      setBusy(true);
      setError(null);
      try {
        await call(`/api/requests/${current.id}`, { method: "PATCH", body: { action: "cancel" } });
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    });
  }

  if (!loaded) {
    // Nothing has come back yet, so there is no roster to look the team up
    // in. If the first fetch failed, say so: "not on the list" would send a
    // team off to hunt for a Judge Advisor over a bad wifi signal. The poll
    // keeps going, so this clears by itself once the server answers.
    return (
      <CenteredNote>
        {online ? "Loading…" : "Can't reach the server — retrying…"}
      </CenteredNote>
    );
  }

  if (!team) return <TeamNotFound number={teamNumber} />;

  return (
    <>
      <TeamView
        team={team}
        panel={panel}
        current={current}
        history={earlierToday(state.requests, team.id, current?.id)}
        languages={state.languages}
        requests={state.requests}
        teams={state.teams}
        online={online}
        now={now}
        busy={busy}
        error={error}
        onDismissError={() => setError(null)}
        message={message}
        onMessage={setMessage}
        onReady={readyNow}
        onBook={(slot, language) =>
          act({
            teamNumber: team.number,
            kind: "slot",
            language,
            slotStart: slot.start,
            slotEnd: slot.end,
          })
        }
        onCancel={cancel}
      />
      {dialog}
    </>
  );
}
