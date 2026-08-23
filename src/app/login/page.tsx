"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/components/useAppState";
import { Banner, Button, Field, inputClass } from "@/components/ui";
import type { Session } from "@/lib/auth";

/**
 * One code box for all three staff roles. The code itself decides whether
 * you land on the judge console, the queue console or the JA console —
 * nobody has to remember which URL they were told to use.
 */
export default function LoginPage() {
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
      router.push(
        session.role === "admin" ? "/admin" : session.role === "judge" ? "/judge" : "/queue",
      );
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Staff sign in</h1>
      <p className="mt-2 mb-8 text-sm text-zinc-400">
        For judges, queue staff and the Judge Advisor. Teams do not need to sign in.
      </p>

      <form onSubmit={submit} className="space-y-5">
        <Field label="Access code">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="ABC123"
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
