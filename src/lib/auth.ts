import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { store } from "./db";

export const ROLES = ["admin", "judge", "queuer"] as const;
export type Role = (typeof ROLES)[number];

/** No cookie at all — a team on the public pages. */
export type Session =
  | { role: "admin"; name: string }
  | { role: "judge"; name: string; panelId: string; panelName: string }
  | { role: "queuer"; name: string };

const COOKIE = "jq_session";
const MAX_AGE = 60 * 60 * 16; // one long event day

/** Warn once per process rather than on every single request. */
let warnedAboutSecret = false;

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;

  if (!value || value.length < 16) {
    // Zero-setup has to mean zero setup, so development gets a working
    // fallback. Production does not: a known signing key would let anyone
    // mint themselves a Judge Advisor cookie.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SESSION_SECRET must be set to a random string of 16+ characters before deploying. " +
          "Generate one with: openssl rand -base64 32",
      );
    }
    if (!warnedAboutSecret) {
      warnedAboutSecret = true;
      console.warn(
        "\n[auth] SESSION_SECRET is not set — using an insecure development key.\n" +
          "       Set one in .env.local before anyone else can reach this app:\n" +
          "       SESSION_SECRET=$(openssl rand -base64 32)\n",
      );
    }
    return new TextEncoder().encode("judge-queue-insecure-development-key");
  }

  return new TextEncoder().encode(value);
}

export async function createSession(session: Session): Promise<void> {
  const token = await new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const role = payload.role;
    if (role === "admin" || role === "queuer") {
      return { role, name: String(payload.name ?? role) };
    }
    if (role === "judge" && typeof payload.panelId === "string") {
      return {
        role: "judge",
        name: String(payload.name ?? "Judge"),
        panelId: payload.panelId,
        panelName: String(payload.panelName ?? "Panel"),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Timing-safe-ish compare. Codes are short and low-value, but free is free. */
function sameCode(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const warnedAboutCode = new Set<string>();

/**
 * Read a staff access code.
 *
 * Development falls back to a published default so a fresh clone is
 * usable immediately. Production refuses to: a code anyone can read in
 * the README is not an access code, and silently accepting it would hand
 * out Judge Advisor rights to the whole internet.
 */
/**
 * Codes printed in this repo's own documentation. Anyone can read them,
 * so in production they are not access codes at all — setting one
 * explicitly is refused just as firmly as leaving it unset.
 */
const PUBLISHED_CODES = new Set(["JA2026", "DESK01", "ALPHA1", "BRAVO2", "CHARLIE3"]);

function roleCode(envVar: string, devDefault: string): string {
  const configured = (process.env[envVar] ?? "").trim().toUpperCase();

  if (configured && process.env.NODE_ENV === "production" && PUBLISHED_CODES.has(configured)) {
    if (!warnedAboutCode.has(envVar)) {
      warnedAboutCode.add(envVar);
      console.error(
        `[auth] ${envVar} is set to "${configured}", which is published in this project's\n` +
          `       documentation and therefore public. Choose a different code and redeploy.`,
      );
    }
    return "";
  }

  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    if (!warnedAboutCode.has(envVar)) {
      warnedAboutCode.add(envVar);
      console.error(
        `[auth] ${envVar} is not set. That role cannot sign in until you set it.`,
      );
    }
    return "";
  }

  if (!warnedAboutCode.has(envVar)) {
    warnedAboutCode.add(envVar);
    console.warn(`[auth] ${envVar} is not set — using the development default "${devDefault}".`);
  }
  return devDefault.toUpperCase();
}

/**
 * Turn a typed-in code into a session.
 *
 * Admin and queuer codes come from env vars. Judge codes live on the
 * panels table so you can add a panel on event day without redeploying.
 */
export async function resolveCode(rawCode: string, name: string): Promise<Session | null> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return null;

  const adminCode = roleCode("ADMIN_CODE", "JA2026");
  const queuerCode = roleCode("QUEUER_CODE", "DESK01");
  const cleanName = name.trim().slice(0, 60);

  if (adminCode && sameCode(code, adminCode)) {
    return { role: "admin", name: cleanName || "Judge Advisor" };
  }
  if (queuerCode && sameCode(code, queuerCode)) {
    return { role: "queuer", name: cleanName || "Queue" };
  }

  // Judge codes live in the store, so a panel can be added mid-event
  // without touching environment variables or restarting anything.
  const panel = await store().findPanelByCode(code);
  if (panel && sameCode(panel.code.toUpperCase(), code)) {
    return {
      role: "judge",
      name: cleanName || "Judge",
      panelId: panel.id,
      panelName: panel.name,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Permissions.
 *
 * One table, so there is no arguing about who can do what. Everything
 * here is enforced in the API routes — the UI hides what a role cannot
 * do, but hiding is not the control.
 *
 *                    create   advance     cancel        notes       admin
 *   team (no login)   own       no       own request     no          no
 *   queuer            any       no       un-seen only    no          no
 *   judge             own      own panel own panel      own panel    no
 *   admin             any       any       any            any         yes
 *
 * "own panel" is the load-bearing part: a judge may only advance, cancel,
 * read or write against teams assigned to the panel whose code they
 * typed. Divisions sit above that — a panel only ever holds teams from
 * its own division.
 * ------------------------------------------------------------------ */

/** May move an interview along at all. Scope is checked separately. */
export function canAdvance(s: Session | null): boolean {
  return s?.role === "admin" || s?.role === "judge";
}

/** May see judging notes at all. Scope is checked separately. */
export function canReadNotes(s: Session | null): boolean {
  return s?.role === "admin" || s?.role === "judge";
}

export function canAdminister(s: Session | null): boolean {
  return s?.role === "admin";
}

/**
 * The one scope check the whole judge separation rests on.
 *
 * A judge may only touch a team assigned to their own panel. The Judge
 * Advisor is unrestricted. Anyone else has no business here at all.
 *
 * `panelId` is the panel the team or request currently belongs to; null
 * means unassigned, which only the Judge Advisor may act on.
 */
export function mayActOnPanel(s: Session | null, panelId: string | null): boolean {
  if (s?.role === "admin") return true;
  if (s?.role === "judge") return panelId !== null && panelId === s.panelId;
  return false;
}

/**
 * The queuer is allowed to undo their own mis-entry, but only while the
 * request is still untouched. Once judges have acknowledged it, it is out
 * of their hands. Drop the "queuer" branch to make the role create-only.
 */
export function canCancel(s: Session | null, status: string): boolean {
  if (s?.role === "admin" || s?.role === "judge") return true;
  if (s?.role === "queuer") return status === "requested" || status === "scheduled";
  return false;
}


export function actorLabel(s: Session | null): string {
  if (!s) return "team";
  if (s.role === "judge") return `${s.name} (${s.panelName})`;
  if (s.role === "queuer") return `queuer:${s.name}`;
  return `admin:${s.name}`;
}
