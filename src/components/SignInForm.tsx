"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/components/useAppState";
import type { Session } from "@/lib/auth";

type Role = Session["role"];

/** Where each role lands once its code is accepted. */
function homeFor(role: Role): string {
  if (role === "admin") return "/admin";
  if (role === "judge") return "/judge";
  if (role === "referee") return "/referee";
  return "/queue";
}

/** How each role is named and pictured on the pass. Styles live under `.signin` in globals.css. */
const ROLES: Record<Role, { label: string; avatar: string; tone: string }> = {
  judge: { label: "Judge", avatar: "/avatars/judge.jpg", tone: "r-judge" },
  queuer: { label: "Queue desk", avatar: "/avatars/queue-desk.jpg", tone: "r-desk" },
  admin: { label: "Judge Advisor", avatar: "/avatars/judge-advisor.jpg", tone: "r-ja" },
  referee: { label: "Referee", avatar: "/avatars/referee.jpg", tone: "r-ref" },
};
const CREW: Role[] = ["judge", "queuer", "admin"];

/** What the pass calls someone: the head referee is a referee with a flag, and the same avatar. */
function labelFor(s: Session): string {
  return s.role === "referee" && s.head ? "Head referee" : ROLES[s.role].label;
}

/** How long the welcome panel shows before the console opens. */
const WELCOME_MS = 900;

/**
 * One code box, worn differently.
 *
 * The code decides the role, so this form is the same everywhere; what
 * changes is who the page says it is for. Referees get their own address,
 * their own words and their own pass rather than having to work out
 * whether "judge and staff" was meant to include them.
 *
 * A code for another role still works here and still lands on that role's
 * own console — being on the wrong sign-in page is not worth an error.
 */
export function SignInForm({
  title,
  intro,
  door,
  placeholder = "ABC123",
}: {
  title: string;
  intro: string;
  /** A one-role door shows that role alone on the pass; without it, the whole staff crew. */
  door?: Role;
  placeholder?: string;
}) {
  const router = useRouter();
  /* A referee's name is what each flag they file is recorded under, and
     the only thing that stops them correcting a colleague's, so the server
     refuses a referee without one. This form cannot know the role before
     the code is checked, so it goes by which door they came through: a
     referee who types their code at /login instead still gets the server's
     message in the banner. */
  const nameRequired = usePathname()?.startsWith("/referee") ?? false;
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState<Session | null>(null);

  // ponytail: matched on the server's wording; give the 429 its own code if that text changes.
  const rateLimited = error?.startsWith("Too many") ?? false;
  const codeInvalid = error !== null && !rateLimited;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { session } = await call<{ session: Session }>("/api/session", {
        body: { code, name },
      });
      const home = homeFor(session.role);
      router.prefetch(home);
      setSignedIn(session);
      setTimeout(() => {
        router.push(home);
        router.refresh();
      }, WELCOME_MS);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <header className="si-top">
        <Link href="/" className="si-back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
          Back to team view
        </Link>
        {/* The app's theme toggle docks into this row via CSS. */}
      </header>

      <main className="si-stage">
        <div className="si-pwrap">
          <section className="si-pass" aria-labelledby="si-title">
            <Band door={door} checking={busy && !signedIn} />

            <div className="si-body">
              {signedIn ? (
                <Welcome session={signedIn} />
              ) : (
                <>
                  <h1 className="si-title" id="si-title">{title}</h1>
                  <p className="si-intro">{intro}</p>

                  <form onSubmit={submit} className="si-form">
                    <div className="si-field">
                      <label className="si-label" htmlFor="si-code">Access code</label>
                      <input
                        id="si-code"
                        className="si-code"
                        value={code}
                        onChange={(e) => {
                          setCode(e.target.value.toUpperCase());
                          if (error) setError(null);
                        }}
                        autoFocus
                        autoCapitalize="characters"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        enterKeyHint="next"
                        placeholder={placeholder}
                        readOnly={busy}
                        aria-invalid={codeInvalid}
                        aria-describedby={error ? "si-error" : undefined}
                      />
                      {error ? (
                        <div className="si-alert" role="alert" id="si-error">
                          {rateLimited ? <ClockIcon /> : <AlertIcon />}
                          <span>{error}</span>
                        </div>
                      ) : null}
                    </div>

                    <div className="si-field">
                      <label className="si-label" htmlFor="si-name">
                        <span>Your name</span>
                        <span className="si-tag">{nameRequired ? "Required" : "Optional"}</span>
                      </label>
                      <input
                        id="si-name"
                        className="si-input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                        autoCapitalize="words"
                        enterKeyHint="go"
                        required={nameRequired}
                        readOnly={busy}
                        aria-describedby="si-name-help"
                      />
                      <p className="si-help" id="si-name-help">
                        {nameRequired
                          ? "Every flag you file is recorded under this name. Use your full name."
                          : door === "admin"
                            ? "Shown on the activity log."
                            : "Shown to the Judge Advisor on the activity log."}
                      </p>
                    </div>

                    <div className="si-actions">
                      <button
                        type="submit"
                        className="si-btn"
                        aria-busy={busy}
                        disabled={busy || !code.trim() || (nameRequired && !name.trim())}
                      >
                        {busy ? "Checking…" : "Sign in"}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Present from the start so screen readers announce the change. */}
      <p className="sr-only" role="status">
        {signedIn ? `Signed in as ${labelFor(signedIn)}. Opening the queue.` : ""}
      </p>
    </div>
  );
}

/** The top of the pass: who it is for, and the crew it covers. */
function Band({ door, checking }: { door?: Role; checking: boolean }) {
  const look = !door ? "" : door === "referee" ? " si-band--ref" : ` si-band--solo ${ROLES[door].tone}`;
  return (
    <div className={`si-band${look}${checking ? " is-checking" : ""}`}>
      <span className="si-slot" aria-hidden="true" />
      {[1, 2, 3, 4, 5, 6, 7].map((n) => (
        <span key={n} className={`si-bx si-b${n}`} aria-hidden="true" />
      ))}
      <div className="si-band-top">
        <div className="si-brand">
          <span className="si-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <path d="M5 7h14M5 12h10M5 17h6" />
            </svg>
          </span>
          <span>Judge Queue</span>
        </div>
        <div className="si-role">{door ? ROLES[door].label : "Staff"}</div>
      </div>

      {door ? (
        <>
          <div className="si-solo">
            <span className={`si-tile si-tile--solo ${ROLES[door].tone}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 20 KB static JPEGs; next/image buys nothing here. */}
              <img className="si-av" src={ROLES[door].avatar} alt="" width={60} height={60} />
            </span>
            <span className="si-solo-l">{ROLES[door].label}</span>
          </div>
          {door === "referee" ? <span className="si-stripes" aria-hidden="true" /> : null}
        </>
      ) : (
        <div className="si-crew">
          {CREW.map((role) => (
            <div key={role} className="si-mate">
              <span className={`si-tile ${ROLES[role].tone}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="si-av" src={ROLES[role].avatar} alt="" width={44} height={44} />
              </span>
              <span className="si-mate-l">{ROLES[role].label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Shown in place of the form for a moment once the code is accepted. */
export function Welcome({ session }: { session: Session }) {
  const { avatar, tone } = ROLES[session.role];
  const label = labelFor(session);
  return (
    <div className={`si-welcome ${tone}`}>
      <div className="si-hero">
        <span className="si-w-tile">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="si-av" src={avatar} alt="" width={128} height={128} />
        </span>
        <span className="si-stamp" aria-hidden="true">VERIFIED</span>
      </div>
      <h1 className="si-w-title" id="si-title">Signed in as {label}</h1>
      <p className="si-w-sub">Opening the queue…</p>
    </div>
  );
}

function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
