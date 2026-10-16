import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { store } from "./db";

export const ROLES = ["admin", "judge", "queuer", "referee"] as const;
export type Role = (typeof ROLES)[number];

/** No cookie at all — a team on the public pages. */
export type Session =
  | { role: "admin"; name: string }
  | { role: "judge"; name: string; panelId: string; panelName: string }
  | { role: "queuer"; name: string }
  | { role: "referee"; name: string };

const COOKIE = "jq_session";
const MAX_AGE = 60 * 60 * 16; // one long event day

/**
 * Whether this looks like a real deployment rather than a laptop running
 * `next dev` with nothing configured.
 *
 * `NODE_ENV === "production"` alone is not a safe signal: `next start`
 * sets it, but plenty of real hosts and self-managed setups run without
 * it ever being set explicitly, and that gap is exactly where a
 * published default code (see PUBLISHED_CODES below) would otherwise
 * sit active with nothing but a server console.warn nobody is watching.
 * DATABASE_URL is a second, independent signal that is much harder to
 * set by accident: choosing Postgres over the local JSON file is a
 * deliberate step toward a deployment meant to be reachable by more than
 * the one laptop it started on.
 */
function isProductionLike(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.DATABASE_URL);
}

/** Warn once per process rather than on every single request. */
let warnedAboutSecret = false;

/**
 * `.env.example` ships `change-me-to-something-random-and-long` as the
 * SESSION_SECRET. At 40 characters it sails past the length check below,
 * so copying the file and forgetting to edit that line would deploy a
 * signing key that is printed in the repo. This matches that exact
 * placeholder and anything else shaped like one ("changeme", "Change-Me…").
 *
 * Mirrored in scripts/doctor.mjs, which cannot import TypeScript -- keep
 * the two in step.
 */
const PLACEHOLDER_SECRET = /change-?me/i;

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;

  // The length floor is deliberately still 16, not higher: a secret of
  // 16-31 characters that is already deployed must keep working, because
  // refusing it would take a live event down at startup. `npm run check`
  // warns below 32 instead.
  if (!value || value.length < 16 || (isProductionLike() && PLACEHOLDER_SECRET.test(value))) {
    // Zero-setup has to mean zero setup, so development gets a working
    // fallback. A real deployment does not: a known signing key would let
    // anyone mint themselves a Judge Advisor cookie.
    if (isProductionLike()) {
      throw new Error(
        "SESSION_SECRET must be set to a random string of 16+ characters before deploying, " +
          "and it cannot be the placeholder from .env.example. " +
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
    if (role === "admin" || role === "queuer" || role === "referee") {
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
const PUBLISHED_CODES = new Set(["JA2026", "DESK01", "REF001", "ALPHA1", "BRAVO2", "CHARLIE3"]);

/** Read and validate a code that may be left unset. */
function configuredRoleCode(envVar: string): string {
  const configured = (process.env[envVar] ?? "").trim().toUpperCase();

  if (configured && isProductionLike() && PUBLISHED_CODES.has(configured)) {
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

  return "";
}

function roleCode(envVar: string, devDefault: string): string {
  const configured = configuredRoleCode(envVar);
  if (configured) return configured;

  if (isProductionLike()) {
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
 * Up to four people can have their own Judge Advisor code.
 *
 * ADMIN_CODE remains the required primary account for compatibility with
 * existing deployments. The other three slots are optional and deliberately
 * explicit: accepting an arbitrary list would make the four-person limit easy
 * to bypass accidentally in deployment settings.
 */
function adminCodeSlots(): { code: string; defaultName: string }[] {
  return [
    { code: roleCode("ADMIN_CODE", "JA2026"), defaultName: "Judge Advisor" },
    { code: configuredRoleCode("ADMIN_CODE_2"), defaultName: "Judge Advisor 2" },
    { code: configuredRoleCode("ADMIN_CODE_3"), defaultName: "Judge Advisor 3" },
    { code: configuredRoleCode("ADMIN_CODE_4"), defaultName: "Judge Advisor 4" },
  ].filter((slot) => Boolean(slot.code));
}

/**
 * Turn a typed-in code into a session.
 *
 * Admin and queuer codes come from env vars. Up to four separate admin
 * codes are accepted. Judge codes live on the
 * panels table so you can add a panel on event day without redeploying.
 */
export async function resolveCode(rawCode: string, name: string): Promise<Session | null> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return null;

  const adminSlot = adminCodeSlots().find((slot) => sameCode(code, slot.code));
  const queuerCode = roleCode("QUEUER_CODE", "DESK01");
  const refereeCode = roleCode("REFEREE_CODE", "REF001");
  const cleanName = name.trim().slice(0, 60);

  if (adminSlot) {
    return { role: "admin", name: cleanName || adminSlot.defaultName };
  }
  if (queuerCode && sameCode(code, queuerCode)) {
    return { role: "queuer", name: cleanName || "Queue" };
  }
  if (refereeCode && sameCode(code, refereeCode)) {
    return { role: "referee", name: cleanName || "Referee" };
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
 * Login rate limiting.
 *
 * Codes are short and meant to be read aloud, so nothing about them
 * resists a determined guesser on its own — the thing that has to do
 * that job is throttling repeated attempts. In-memory, keyed by caller,
 * so it does not survive a restart and does not share state across
 * serverless instances: an honest limit for this app's shape, not one
 * pretended away. It still fully protects the single long-running
 * process the file-store deployment is built around, and narrows the
 * window on every other one.
 *
 * "Keyed by caller" is only as honest as the thing identifying the
 * caller. X-Forwarded-For is a header the CLIENT writes unless a proxy we
 * control overwrites it, so trusting it unconditionally let an attacker
 * mint a fresh bucket per guess just by changing the header. See
 * clientKeyFor: with no trusted proxy there is exactly one bucket.
 * ------------------------------------------------------------------ */

type LoginAttempts = { count: number; windowStart: number; lockedUntil: number };

const LOGIN_WINDOW_MS = 60_000;

/** Per-address limits, used only when a trusted proxy tells us who is calling. */
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 5 * 60_000;

/**
 * The one bucket everybody shares when there is no trusted proxy (a LAN
 * event, a bare `next start`). Every staff member on the venue wifi lands
 * in it, so a few honest mistypes must not lock the whole team out: it
 * tolerates 20 failures a minute and only locks for two. That is still a
 * hard ceiling on guessing -- about 20 tries per 3 minutes, for the
 * whole network -- against codes an attacker has to hit exactly.
 */
const SHARED_KEY = "shared";
const SHARED_MAX_ATTEMPTS = 20;
const SHARED_LOCKOUT_MS = 2 * 60_000;

/** The map never holds more than this many callers, however they arrive. */
const LOGIN_MAP_PRUNE_AT = 5_000;

const loginAttempts = new Map<string, LoginAttempts>();

function pruneLoginAttempts(now: number): void {
  if (loginAttempts.size < LOGIN_MAP_PRUNE_AT) return;
  for (const [key, entry] of loginAttempts) {
    if (entry.lockedUntil < now && now - entry.windowStart > LOGIN_WINDOW_MS) {
      loginAttempts.delete(key);
    }
  }
  // Expiry alone cannot bound this: entries that are all still inside
  // their window never expire, so a flood of distinct keys would grow the
  // map regardless. Make room by dropping the oldest -- a Map iterates in
  // insertion order -- so memory is capped even if the keys are fake.
  for (const key of loginAttempts.keys()) {
    if (loginAttempts.size < LOGIN_MAP_PRUNE_AT) break;
    loginAttempts.delete(key);
  }
}

/** Call before attempting a login. Does not count as an attempt itself. */
export function loginRateLimited(key: string): { limited: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (entry && entry.lockedUntil > now) {
    return { limited: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  return { limited: false };
}

/** Call after a failed login. Locks the key out once it crosses the limit. */
export function recordLoginFailure(key: string): void {
  const now = Date.now();
  pruneLoginAttempts(now);

  const entry = loginAttempts.get(key);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, windowStart: now, lockedUntil: 0 });
    return;
  }

  const shared = key === SHARED_KEY;
  entry.count += 1;
  if (entry.count >= (shared ? SHARED_MAX_ATTEMPTS : LOGIN_MAX_ATTEMPTS)) {
    entry.lockedUntil = now + (shared ? SHARED_LOCKOUT_MS : LOGIN_LOCKOUT_MS);
  }
}

/** Call after a successful login so a real staff member is never penalised
 *  for mistyped attempts that came before the one that worked. */
export function recordLoginSuccess(key: string): void {
  loginAttempts.delete(key);
}

/**
 * Whether a proxy we control is in front of this app and writes the
 * client-address headers itself.
 *
 * Vercel sets VERCEL and overwrites x-forwarded-for / x-real-ip on every
 * request, so the header is the real caller. Anywhere else the app has no
 * way to know -- set TRUST_PROXY=1 only if your own reverse proxy
 * overwrites or appends to x-forwarded-for; with no proxy, or one that
 * passes the client's header through untouched, setting it hands the
 * attacker back the bypass.
 */
function behindTrustedProxy(): boolean {
  return Boolean(process.env.VERCEL) || process.env.TRUST_PROXY === "1";
}

/** Caller identity for rate limiting: the proxy-reported address when a
 *  trusted proxy is in front, otherwise one shared bucket (a LAN event
 *  running the file store, its primary deployment shape). */
export function clientKeyFor(request: Request): string {
  if (!behindTrustedProxy()) return SHARED_KEY;

  // The LAST x-forwarded-for entry, not the first: a proxy that appends
  // puts the address it saw at the end, while everything before it is
  // whatever the client chose to claim. On Vercel there is only one.
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
  const address = forwarded || request.headers.get("x-real-ip")?.trim();
  // Prefixed so a header can never spell the shared bucket's key and so
  // borrow its more forgiving limits.
  return address ? `ip:${address.slice(0, 64)}` : SHARED_KEY;
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
 * Referee flags: written by referees, read by the people who judge.
 *
 * Writing is the referee's alone — the Judge Advisor can remove a flag
 * but does not raise one, because a flag is a record of what an official
 * saw, and it would stop meaning that if anyone could add to it.
 */
export function canFlag(s: Session | null): boolean {
  return s?.role === "referee";
}

/**
 * Reading is wider: judges need to know what was flagged against the
 * teams they are about to judge, and referees need to see the history
 * they are adding to. Teams and the queue desk get none of it.
 */
export function canReadFlags(s: Session | null): boolean {
  return s?.role === "admin" || s?.role === "judge" || s?.role === "referee";
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
 * request is still untouched, and only an entry the desk itself made —
 * `createdBy` reads "queuer:Name" for those (see actorLabel below).
 * Once judges have acknowledged it, it is out of their hands. Drop the
 * "queuer" branch to make the role create-only.
 *
 * A team with no session at all is a separate case, not a queuer acting
 * without a login: creating a request needs no login (see POST
 * /api/requests), so cancelling the one they just created — the "Cancel
 * this request" / "Cancel this booking" button on their own team page —
 * cannot need one either, or that button is dead on arrival for every
 * team, every time. A team's own request is always createdBy "team", so
 * this branch never has to consult it.
 */
export function canCancel(s: Session | null, status: string, createdBy: string | null): boolean {
  if (s?.role === "admin" || s?.role === "judge") return true;
  const early = status === "requested" || status === "scheduled";
  if (!s) return early;
  if (s.role === "queuer") return early && createdBy?.startsWith("queuer:") === true;
  return false;
}


export function actorLabel(s: Session | null): string {
  if (!s) return "team";
  if (s.role === "judge") return `${s.name} (${s.panelName})`;
  if (s.role === "queuer") return `queuer:${s.name}`;
  if (s.role === "referee") return `referee:${s.name}`;
  return `admin:${s.name}`;
}

/**
 * Whether two sign-in names are the same person for the purpose of owning
 * a report.
 *
 * A referee's name is typed by hand on a phone, so "dana", "Dana " and
 * "DANA" are one person -- comparing exactly would lock a referee out of
 * their own flag over a capital letter. This is a stopgap, not identity:
 * two referees who type the same name are still the same author until
 * referees get individual codes.
 */
export function sameAuthor(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
