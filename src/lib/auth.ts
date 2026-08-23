import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { db, isConfigured } from "./supabase";

export const ROLES = ["admin", "judge", "queuer"] as const;
export type Role = (typeof ROLES)[number];

/** No cookie at all — a team on the public pages. */
export type Session =
  | { role: "admin"; name: string }
  | { role: "judge"; name: string; panelId: string; panelName: string }
  | { role: "queuer"; name: string };

const COOKIE = "jq_session";
const MAX_AGE = 60 * 60 * 16; // one long event day

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error("SESSION_SECRET must be set to a random string of 16+ characters.");
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

/**
 * Turn a typed-in code into a session.
 *
 * Admin and queuer codes come from env vars. Judge codes live on the
 * panels table so you can add a panel on event day without redeploying.
 */
export async function resolveCode(rawCode: string, name: string): Promise<Session | null> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return null;

  const adminCode = (process.env.ADMIN_CODE ?? "").trim().toUpperCase();
  const queuerCode = (process.env.QUEUER_CODE ?? "").trim().toUpperCase();
  const cleanName = name.trim().slice(0, 60);

  if (adminCode && sameCode(code, adminCode)) {
    return { role: "admin", name: cleanName || "Judge Advisor" };
  }
  if (queuerCode && sameCode(code, queuerCode)) {
    return { role: "queuer", name: cleanName || "Queue" };
  }

  // Judge codes live in the database. If it is unreachable we still want a
  // clean "not recognised" rather than a 500 with a stack trace in it.
  if (!isConfigured()) return null;

  try {
    const { data } = await db()
      .from("panels")
      .select("id, name, code")
      .ilike("code", code)
      .maybeSingle();

    if (data && sameCode(String(data.code).toUpperCase(), code)) {
      return {
        role: "judge",
        name: cleanName || "Judge",
        panelId: data.id,
        panelName: data.name,
      };
    }
  } catch {
    return null;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Permissions. One table, so there is no arguing about who can do what.
 *
 *                     create   advance   cancel        notes   admin
 *   team (no login)     yes       no      own request    no      no
 *   queuer              yes       no      un-seen only   no      no
 *   judge               yes      yes      yes            yes     no
 *   admin               yes      yes      yes            yes     yes
 * ------------------------------------------------------------------ */

export function canAdvance(s: Session | null): boolean {
  return s?.role === "admin" || s?.role === "judge";
}

export function canReadNotes(s: Session | null): boolean {
  return s?.role === "admin" || s?.role === "judge";
}

export function canAdminister(s: Session | null): boolean {
  return s?.role === "admin";
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
