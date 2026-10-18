"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "./ui";

export type ConfirmOptions = {
  /** The confirming button's words. "Confirm" when left out. */
  confirmLabel?: string;
  /** Styles the confirming button as the destructive act it is. */
  danger?: boolean;
};

export type Pending = ConfirmOptions & { question: string };

/**
 * The question/answer half, kept apart from React so it can be run as it is.
 *
 * `ask` shows the question and resolves when `settle` answers it. Asking again
 * while one is open dismisses the first as "no" rather than leaving its caller
 * waiting for ever.
 */
export function createConfirmer(show: (pending: Pending | null) => void) {
  let answer: ((ok: boolean) => void) | null = null;
  return {
    ask(question: string, options: ConfirmOptions = {}): Promise<boolean> {
      return new Promise((resolve) => {
        answer?.(false);
        answer = resolve;
        show({ question, ...options });
      });
    },
    settle(ok: boolean) {
      answer?.(ok);
      answer = null;
      show(null);
    },
  };
}

/**
 * An in-page replacement for `window.confirm()`.
 *
 * Some embedded browsers and phone in-app webviews answer `confirm()` with
 * "no" at once and show nothing, so every action behind it silently does
 * nothing. This asks inside the page instead:
 *
 *   const { ask, dialog } = useConfirm();
 *   if (!(await ask("Remove it?", { confirmLabel: "Remove", danger: true }))) return;
 *   ...
 *   return <>{...}{dialog}</>;   // render `dialog` once in the component
 */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);
  const { ask, settle } = useMemo(() => createConfirmer(setPending), []);
  return { ask, dialog: <ConfirmDialog pending={pending} onSettle={settle} /> };
}

/**
 * A native <dialog> opened with showModal(), as the match sheet is: the focus
 * trap, Escape, `aria-modal` semantics and the inert page behind it come with
 * it. Escape, the backdrop and Cancel all answer "no"; only the confirming
 * button answers "yes".
 */
export function ConfirmDialog({
  pending,
  onSettle,
}: {
  pending: Pending | null;
  onSettle: (ok: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (pending && !dialog.open) dialog.showModal();
    else if (!pending && dialog.open) dialog.close();
  }, [pending]);

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby={titleId}
      className="m-auto w-[calc(100%_-_2rem)] max-w-sm rounded-2xl bg-surface p-0 text-ink ring-1 ring-line backdrop:bg-black/60"
      // Escape closes the dialog by itself; that is a "no". A close we asked
      // for (nothing pending any more) is not news.
      onClose={() => {
        if (pending) onSettle(false);
      }}
      // A click whose target is the dialog itself landed on the backdrop.
      onClick={(e) => {
        if (e.target === e.currentTarget) onSettle(false);
      }}
    >
      {pending ? (
        <div className="p-5">
          <p id={titleId} className="whitespace-pre-line text-base text-ink">
            {pending.question}
          </p>
          <div className="mt-5 flex gap-3">
            {/* Cancel comes first so showModal() puts focus on it: the safe answer. */}
            <Button variant="ghost" className="min-h-11 flex-1" onClick={() => onSettle(false)}>
              Cancel
            </Button>
            <Button
              variant={pending.danger ? "danger" : "primary"}
              className="min-h-11 flex-1"
              onClick={() => onSettle(true)}
            >
              {pending.confirmLabel ?? "Confirm"}
            </Button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
