import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

import type { Session } from "../src/lib/auth";
import type { Panel } from "../src/lib/types";

/* The Judge Advisor correcting and deleting judges' notes, through the REAL
   route handler against the file store. Same hand-built request scope as
   judgeRoutes.runtime.test.ts. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-notes-fix-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "notes-fix-test-secret-0123456789";
delete process.env.DATABASE_URL;
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

const ADMIN: Session = { role: "admin", name: "Judge Advisor" };
const judgeOf = (panel: Panel): Session => ({ role: "judge", name: "Amy", panelId: panel.id, panelName: panel.name });

async function inRequestScope<T>(session: Session | null, fn: () => Promise<T>): Promise<T> {
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
type Reply = { status: number; body: any };

async function notes(method: "GET" | "PATCH" | "DELETE", session: Session | null, path: string, body?: unknown): Promise<Reply> {
  const handlers = (await import("../src/app/api/notes/route")) as unknown as Record<string, (r: Request) => Promise<Response>>;
  const request = new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await inRequestScope(session, () => handlers[method](request));
  return { status: res.status, body: await res.json() };
}

async function world() {
  const db = (await import("../src/lib/db/file")).fileStore;
  await db.resetAll();
  const panel = await db.createPanel({
    name: "Panel 1", code: "NF1001", division: "Elementary School", judges: [], languages: [],
    sort_order: 1, slot_start_at: null, slot_minutes: 20, slot_count: 0,
  });
  await db.upsertTeams([{ number: "9882K", name: "Hawks", pit: null, division: "Elementary School", category: "developing" }]);
  const team = (await db.listTeams())[0];
  await db.updateTeam(team.id, { panel_id: panel.id });
  const note = await db.createNote({ teamId: team.id, requestId: null, panelId: panel.id, author: "Pim", body: "Great pitch" });
  return { db, panel, team, note, url: `/api/notes?teamId=${team.id}` };
}

test("a judge, or nobody signed in, cannot edit, delete or restore a note", async () => {
  const w = await world();
  for (const session of [judgeOf(w.panel), null]) {
    const edit = await notes("PATCH", session, "/api/notes", { id: w.note.id, body: "Rewritten" });
    assert.equal(edit.status, 403);
    assert.match(edit.body.error, /Only the Judge Advisor/);
    assert.equal((await notes("PATCH", session, "/api/notes", { id: w.note.id, restore: true })).status, 403);
    assert.equal((await notes("DELETE", session, `/api/notes?id=${w.note.id}`)).status, 403);
  }
  assert.equal((await w.db.getNote(w.note.id))?.body, "Great pitch");
  assert.equal((await w.db.getNote(w.note.id))?.deleted_at ?? null, null);
});

test("the Judge Advisor edits a note, and Activity keeps the old text", async () => {
  const w = await world();
  const res = await notes("PATCH", ADMIN, "/api/notes", { id: w.note.id, body: "  Great pitch, weak build  " });
  assert.equal(res.status, 200);
  assert.equal(res.body.note.body, "Great pitch, weak build");
  assert.equal(res.body.note.edited_by, "Judge Advisor");
  assert.ok(res.body.note.edited_at);

  const seen = await notes("GET", judgeOf(w.panel), w.url);
  assert.equal(seen.body.notes[0].body, "Great pitch, weak build", "judges read the correction");
  assert.equal(seen.body.notes[0].edited_by, "Judge Advisor", "and can see it was edited");

  const entry = (await w.db.listActivity()).find((a) => a.action === "edited a note by Pim");
  assert.equal(entry?.detail, "Was: Great pitch");
  assert.equal(entry?.team_number, "9882K");
});

test("an empty edit is refused, an unknown note is 404", async () => {
  const w = await world();
  assert.equal((await notes("PATCH", ADMIN, "/api/notes", { id: w.note.id, body: "   " })).status, 400);
  assert.equal((await w.db.getNote(w.note.id))?.body, "Great pitch");
  const ghost = "00000000-0000-4000-8000-000000000000";
  assert.equal((await notes("PATCH", ADMIN, "/api/notes", { id: ghost, body: "x" })).status, 404);
  assert.equal((await notes("PATCH", ADMIN, "/api/notes", { id: ghost, restore: true })).status, 404);
  assert.equal((await notes("DELETE", ADMIN, `/api/notes?id=${ghost}`)).status, 404);
  assert.equal((await notes("DELETE", ADMIN, "/api/notes?id=nonsense")).status, 404);
});

test("deleting hides the note from everyone, restoring brings it back, and both are logged", async () => {
  const w = await world();
  assert.equal((await notes("DELETE", ADMIN, `/api/notes?id=${w.note.id}`)).status, 200);
  assert.deepEqual((await notes("GET", ADMIN, w.url)).body.notes, []);
  assert.deepEqual((await notes("GET", judgeOf(w.panel), w.url)).body.notes, []);
  assert.equal((await notes("DELETE", ADMIN, `/api/notes?id=${w.note.id}`)).status, 404, "already deleted");
  assert.equal((await notes("PATCH", ADMIN, "/api/notes", { id: w.note.id, body: "x" })).status, 404, "a deleted note cannot be edited");

  assert.equal((await notes("PATCH", ADMIN, "/api/notes", { id: w.note.id, restore: true })).status, 200);
  assert.equal((await notes("GET", judgeOf(w.panel), w.url)).body.notes[0].body, "Great pitch");

  const log = await w.db.listActivity();
  assert.equal(log.find((a) => a.action === "deleted a note by Pim")?.detail, "Great pitch");
  assert.equal(log.find((a) => a.action === "restored a note by Pim")?.detail, "Great pitch");
});
