"use client";

import type { ComponentProps } from "react";
import { EventSetup } from "./EventSetup";

/**
 * The two places the console treats the head referee (and the Judge Advisor)
 * differently from every other referee, both about the event's setup: who gets
 * the form, and who can open it again.
 */

/**
 * The setup screen for whoever may set it up. Everyone else gets a wait screen
 * in its place: the console polls, so it opens by itself once the setup is
 * saved, and until then there is nothing for them to flag against.
 */
export function SetupGate({ canSetUp, ...setup }: { canSetUp: boolean } & ComponentProps<typeof EventSetup>) {
  if (canSetUp) return <EventSetup {...setup} />;
  return (
    <div className="rf-setup">
      <main className="rf-body">
        <div role="status">
          <p className="rf-eyebrow">Today&apos;s event</p>
          <h1 className="rf-h1">Waiting for the head referee</h1>
          <p className="rf-intro">
            The head referee sets the program and fields for today. This page updates on its own once it&apos;s done.
          </p>
        </div>
      </main>
    </div>
  );
}

/**
 * The event's program and field count on the current-match bar. With `onEdit`
 * it is the button that opens the setup; without, it is the same pill as plain
 * text, so a referee who cannot change it has nothing to tap.
 */
export function ProgramTag({
  program,
  fieldCount,
  onEdit,
}: {
  program: string;
  fieldCount: number;
  onEdit?: () => void;
}) {
  const fields = `${fieldCount} ${fieldCount === 1 ? "field" : "fields"}`;
  const text = `${program} · ${fields}`;
  if (!onEdit) return <span className="rf-ptag rf-ptag--ro">{text}</span>;
  return (
    <button type="button" className="rf-ptag" aria-label={`Event setup: ${program}, ${fields}`} title="Event setup" onClick={onEdit}>
      {text}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}
