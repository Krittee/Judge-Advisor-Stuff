"use client";

import { useEffect, useId, useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import { ChevronDown, ChevronRight, WarnIcon } from "@/components/judge/parts";
import { call } from "@/components/useAppState";
import { resetAfterAsking, STORAGE_DOWN, type Health, type ResetAction } from "./teamsLogic";

/**
 * "Event data · Storage and resets", the foot of the Teams tab: where the data
 * is going, and the two resets. Closed until opened -- but if storage cannot
 * be reached the closed row turns danger-coloured and says so, because the
 * failure must never be hidden behind a click.
 *
 * Someone who deployed from a browser has no server log to read, so this is
 * how they confirm their database is connected, and a loud warning if it is
 * not: a serverless host with no database silently forgets everything between
 * requests.
 */
export function EventDataPanel({
  health,
  open,
  busy = false,
  error = null,
  onToggle,
  onReset,
}: {
  /** Null until /api/health has answered. */
  health: Health | null;
  open: boolean;
  busy?: boolean;
  error?: string | null;
  onToggle: () => void;
  onReset: (action: ResetAction) => void;
}) {
  const id = useId();
  const down = health !== null && !health.ok;

  return (
    <section className="ja-ev" data-down={down ? "true" : undefined} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>
        <button type="button" className="ja-ev-b" aria-expanded={open} aria-controls={`${id}-b`} onClick={onToggle}>
          {open ? <ChevronDown /> : <ChevronRight />}
          <span className="ja-ev-t">Event data</span>
          <span className="ja-ev-s">{down ? STORAGE_DOWN : "Storage and resets"}</span>
        </button>
      </h2>

      {open ? (
        <div className="ja-ev-x" id={`${id}-b`}>
          {health === null ? (
            <p className="ja-ev-st">Checking storage…</p>
          ) : !health.ok ? (
            <p className="ja-err" role="alert">
              <b>{STORAGE_DOWN}.</b> {health.error ?? "The app cannot reach its database."}
            </p>
          ) : (
            <>
              <p className="ja-ev-st">
                <i className={`jg-dot ${health.persistent === false ? "ja-ev-warn" : "jg-s-completed"}`} aria-hidden="true" />
                {health.persistent === false ? "Saved to a local file" : "Saved to the database"}
              </p>
              <p className="ja-hint">
                Storing into <b>{health.location}</b>
              </p>
              {health.persistent === false ? (
                <div className="jg-caution" role="note">
                  <WarnIcon />
                  <p>
                    This is running on a local file. That is fine on your own computer, but if you deployed this to a hosting
                    service, add a database and set <code>DATABASE_URL</code> — otherwise your data can vanish between requests.
                  </p>
                </div>
              ) : null}
            </>
          )}

          <div className="ja-dz">
            <h3>Danger zone</h3>
            <div className="ja-dzr">
              <div>
                <p className="ja-dzn">Reset the day</p>
                <p className="ja-dzd">
                  Clears today&apos;s requests, notes, scores and activity. Teams, panels and referee history are kept.
                </p>
              </div>
              <button type="button" className="ja-dbtn" disabled={busy} onClick={() => onReset("resetDay")}>
                Reset the day
              </button>
            </div>
            <div className="ja-dzr">
              <div>
                <p className="ja-dzn">Wipe everything</p>
                <p className="ja-dzd">
                  Deletes the whole event: teams, panels, requests, notes, scores and referee history. Use it before importing a
                  new event.
                </p>
              </div>
              <button type="button" className="ja-dbtn" disabled={busy} onClick={() => onReset("resetAll")}>
                Wipe everything
              </button>
            </div>
          </div>
          <p className="ja-hint">Both ask you to confirm first.</p>
          {error ? (
            <p className="ja-err" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Asks /api/health once, and keeps the resets behind a question. */
export function EventData({ refresh }: { refresh: () => Promise<void> }) {
  const { ask, dialog } = useConfirm();
  const [health, setHealth] = useState<Health | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Health>("/api/health", { method: "GET" })
      .then(setHealth)
      .catch((e) => setHealth({ ok: false, error: (e as Error).message }));
  }, []);

  async function reset(action: ResetAction) {
    setBusy(true);
    setError(null);
    try {
      if (await resetAfterAsking(ask, call, action)) await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {dialog}
      <EventDataPanel health={health} open={open} busy={busy} error={error} onToggle={() => setOpen((o) => !o)} onReset={reset} />
    </>
  );
}
