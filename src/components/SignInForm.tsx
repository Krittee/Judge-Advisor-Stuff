"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/components/useAppState";
import { Banner, Button, Field, inputClass } from "@/components/ui";
import type { Session } from "@/lib/auth";

/** Where each role lands once its code is accepted. */
export function homeFor(role: Session["role"]): string {
  if (role === "admin") return "/admin";
  if (role === "judge") return "/judge";
  if (role === "referee") return "/referee";
  return "/queue";
}

/**
 * One code box, worn differently.
 *
 * The code decides the role, so this form is the same everywhere; what
 * changes is who the page says it is for. Referees get their own address
 * and their own words rather than having to work out whether "judge and
 * staff" was meant to include them.
 *
 * A code for another role still works here and still lands on that role's
 * own console — being on the wrong sign-in page is not worth an error.
 */
export function SignInForm({
  title,
  intro,
  placeholder = "ABC123",
}: {
  title: string;
  intro: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { session } = await call<{ session: Session }>("/api/session", {
        body: { code, name },
      });
      router.push(homeFor(session.role));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 py-12">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 mb-8 text-sm text-zinc-400">{intro}</p>

      <form onSubmit={submit} className="space-y-5">
        <Field label="Access code">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            placeholder={placeholder}
            className={`${inputClass} text-center text-2xl font-bold tracking-[0.3em]`}
          />
        </Field>

        <Field label="Your name" hint="Shown to the Judge Advisor on the activity log.">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Dana"
            autoComplete="name"
            className={inputClass}
          />
        </Field>

        {error ? <Banner kind="error">{error}</Banner> : null}

        <Button type="submit" size="lg" className="w-full" disabled={busy || !code.trim()}>
          {busy ? "Checking…" : "Sign in"}
        </Button>
      </form>

      <Link href="/" className="mt-10 text-center text-sm text-zinc-500 hover:text-zinc-300">
        ← Back to team view
      </Link>
    </main>
  );
}
