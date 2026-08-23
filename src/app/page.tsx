"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Banner, Button, inputClass, StatusLegend } from "@/components/ui";

/**
 * The front door. A team member with a phone, standing in a loud pit,
 * should be able to get from here to "we asked for a judge" in two taps.
 */
export default function Home() {
  const router = useRouter();
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | null>(null);

  function go(e: React.FormEvent) {
    e.preventDefault();
    const n = number.trim();
    if (!/^\d+$/.test(n)) {
      setError("Enter your team number, digits only.");
      return;
    }
    router.push(`/team/${n}`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-12">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Judge Queue</h1>
        <p className="mt-3 text-zinc-400">
          Enter your team number to book a judging slot or call for a judge now.
        </p>
      </div>

      <form onSubmit={go} className="space-y-4">
        <input
          value={number}
          onChange={(e) => {
            setNumber(e.target.value.replace(/\D/g, ""));
            setError(null);
          }}
          inputMode="numeric"
          pattern="[0-9]*"
          autoFocus
          placeholder="Team number"
          aria-label="Team number"
          className={`${inputClass} py-5 text-center text-3xl font-bold tracking-widest`}
        />

        {error ? <Banner kind="error">{error}</Banner> : null}

        <Button type="submit" size="lg" className="w-full" disabled={!number}>
          Continue
        </Button>
      </form>

      <div className="mt-12 rounded-2xl bg-white/[0.03] p-5 ring-1 ring-inset ring-white/10">
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">What the colours mean</h2>
        <StatusLegend />
      </div>

      <nav className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-zinc-500">
        <Link href="/board" className="hover:text-zinc-300">
          Live board
        </Link>
        <Link href="/login" className="hover:text-zinc-300">
          Judge / staff sign in
        </Link>
      </nav>
    </main>
  );
}
