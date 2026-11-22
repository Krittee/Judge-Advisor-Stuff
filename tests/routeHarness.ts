import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import { SignJWT } from "jose";

import type { Session } from "../src/lib/auth";
import type { Panel, Team } from "../src/lib/types";

/* The hand-built request scope + route driver shared by the route runtime tests. The test file
   sets DATA_FILE / SESSION_SECRET / SEED_DEMO itself (before the store is first imported). */
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

export const ES = "Elementary School";
export const MS = "IQ Middle School";

export const ADMIN: Session = { role: "admin", name: "Alex" };
export const MARKETING: Session = { role: "marketing", name: "Pim" };
export const QUEUER: Session = { role: "queuer", name: "Desk" };
export const REFEREE: Session = { role: "referee", name: "Ref" };
export const COORDINATOR: Session = { role: "coordinator", name: "Coco" };
export const judgeOf = (panel: Panel, name = "Amy"): Session => ({
  role: "judge",
  name,
  panelId: panel.id,
  panelName: panel.name,
});

export async function inRequestScope<T>(session: Session | null, fn: () => Promise<T>): Promise<T> {
  const [{ workAsyncStorage }, { workUnitAsyncStorage }, { RequestCookies }, { RequestCookiesAdapter }] =
    await Promise.all([
      import("next/dist/server/app-render/work-async-storage.external"),
      import("next/dist/server/app-render/work-unit-async-storage.external"),
      import("next/dist/server/web/spec-extension/cookies"),
      import("next/dist/server/web/spec-extension/adapters/request-cookies"),
    ]);

  const headers = new Headers();
  if (session) {
    const panel = session.role === "judge"
      ? await (await import("../src/lib/db/file")).fileStore.findPanelById(session.panelId)
      : null;
    if (session.role === "judge") assert.ok(panel);
    const judgeClaims = panel ? {
        panelAuth: createHmac("sha256", process.env.SESSION_SECRET!)
          .update(panel.id).update("\0").update(panel.code.toUpperCase()).digest("hex"),
        judgeDay: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
      } : {};
    const token = await new SignJWT({ ...session, ...judgeClaims })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET));
    headers.set("cookie", `jq_session=${token}`);
  }
  const cookies = RequestCookiesAdapter.seal(new RequestCookies(headers));
  return workAsyncStorage.run({ route: "/api/test" } as never, () =>
    workUnitAsyncStorage.run({ type: "request", phase: "render", cookies } as never, fn),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Reply = { status: number; body: any; headers: Headers };
type Handlers = Record<string, (request: Request) => Promise<Response>>;

export async function hit(
  load: () => Promise<unknown>,
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  session: Session | null,
  path: string,
  body?: unknown,
): Promise<Reply> {
  const handlers = (await load()) as Handlers;
  const request = new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await inRequestScope(session, () => handlers[method](request));
  return { status: res.status, body: await res.json(), headers: res.headers };
}

/* Reset the store and seed teams [number, name, division]; `team(n)` finds one by number. */
export async function world(teams: [string, string, string][] = [["9882K", "Hawks", ES], ["2088C", "Storm", MS]]) {
  const db = (await import("../src/lib/db/file")).fileStore;
  await db.resetAll();
  await db.upsertTeams(teams.map(([number, name, division]) => ({ number, name, pit: null, division, category: "developing" })));
  const all = await db.listTeams();
  const team = (n: string) => all.find((t) => t.number === n) as Team;
  return { db, team };
}
