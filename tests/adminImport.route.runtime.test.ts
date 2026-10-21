import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

import type { Session } from "../src/lib/auth";

/* POST /api/admin/teams, the Import tab's endpoint, driven through the REAL
   route handler against the real file store -- the same harness as
   judgeRoutes.runtime.test.ts (see requestWorkflow.runtime.test.ts for why
   the request scope is built by hand). `parseTeams` is private to the route
   file (a Next route may not export it), so what it reports is read from
   `skippedLines` in the reply. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-import-route-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "import-route-test-secret-0123456789";
delete process.env.DATABASE_URL;
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

const ES = "Elementary School";
const ADMIN: Session = { role: "admin", name: "Judge Advisor" };
const QUEUER: Session = { role: "queuer", name: "Desk" };

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
    const token = await new SignJWT({ ...session })
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

async function importTeams(session: Session | null, body: unknown): Promise<Reply> {
  const { POST } = await import("../src/app/api/admin/teams/route");
  const request = new Request("http://localhost/api/admin/teams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await inRequestScope(session, () => POST(request));
  return { status: res.status, body: await res.json() };
}

const store = async () => (await import("../src/lib/db/file")).fileStore;

/** An empty event, optionally with team numbers already on the roster. */
async function world(stored: string[] = []) {
  const db = await store();
  await db.resetAll();
  if (stored.length) {
    await db.upsertTeams(stored.map((number) => ({ number, name: `Old ${number}`, pit: null, division: ES, category: "developing" })));
  }
  return db;
}

const NO_NUMBER = "no team number";
const NO_DIGIT = "no digit in the team number";
const BAD_CHARS = "team number has characters other than A–Z, 0–9 and -";

/* ===== skippedLines ===================================================== */

test("each reason is reported with its 1-based line number, and a header row is not", async () => {
  await world();
  const text = [
    "Team Number, Team Name, Pit", //  1  header: skipped without a word
    "1234, Iron Hawks, A1", //          2
    ", Nameless, A2", //                3  no team number
    "TEAM, No digits", //               4  no digit
    "12.5, Bad characters", //          5  characters other than A-Z, 0-9, -
    "", //                              6  blank lines count in the numbering and are not reported
    "9882K, Kilo Kestrels, B1", //      7
    "-5, Leading dash", //              8  has a digit, but a dash cannot lead
  ].join("\n");

  const { status, body } = await importTeams(ADMIN, { text });
  assert.equal(status, 200);
  assert.deepEqual(body.skippedLines, [
    { line: 3, text: ", Nameless, A2", reason: NO_NUMBER },
    { line: 4, text: "TEAM, No digits", reason: NO_DIGIT },
    { line: 5, text: "12.5, Bad characters", reason: BAD_CHARS },
    { line: 8, text: "-5, Leading dash", reason: BAD_CHARS },
  ]);
  assert.equal(body.imported, 2);
  assert.equal(body.skipped, 5, "`skipped` still counts the header too, as it always did");
});

test("a header-only skip is silent: skippedLines is empty, even after blank lines and with punctuation in the header", async () => {
  await world();
  for (const header of ["Team Number, Team Name", "\n\nTeam #, Name, Pit", "#\tName"]) {
    const { status, body } = await importTeams(ADMIN, { text: `${header}\n1234, Iron Hawks` });
    assert.equal(status, 200);
    assert.deepEqual(body.skippedLines, [], `${JSON.stringify(header)} is a header`);
    assert.equal(body.imported, 1);
  }
});

test("a line with no digit is reported anywhere but the first line", async () => {
  await world();
  const { body } = await importTeams(ADMIN, { text: "1234, Iron Hawks\nTeam Number, Team Name\n\nnot a team" });
  assert.deepEqual(
    body.skippedLines.map((l: { line: number; reason: string }) => [l.line, l.reason]),
    [
      [2, NO_DIGIT],
      [4, NO_DIGIT],
    ],
    "the second line is not a header, whatever it says",
  );
});

test("a first line skipped for any other reason is reported, not taken for a header", async () => {
  await world();
  const blankCell = await importTeams(ADMIN, { text: ", Nameless\n1234, Iron Hawks" });
  assert.deepEqual(blankCell.body.skippedLines, [{ line: 1, text: ", Nameless", reason: NO_NUMBER }]);

  const dotted = await importTeams(ADMIN, { text: "1.5, Dotted\n1234, Iron Hawks" });
  assert.deepEqual(dotted.body.skippedLines, [{ line: 1, text: "1.5, Dotted", reason: BAD_CHARS }]);
});

test("Windows line endings and tab rows number and read the same", async () => {
  await world();
  const { body } = await importTeams(ADMIN, { text: "Team\tName\r\n1234\tIron Hawks\r\nTEAM\tx\r\n5678\tBolts" });
  assert.deepEqual(body.skippedLines, [{ line: 3, text: "TEAM\tx", reason: NO_DIGIT }]);
  assert.equal(body.imported, 2);
});

/* ===== created / updated ================================================ */

test("a team number already stored counts as updated, a new one as created", async () => {
  await world(["1234"]);
  const { status, body } = await importTeams(ADMIN, { text: "1234, Iron Hawks, A1\n5678, Bolts, A2\n9999, Gears, A3" });
  assert.equal(status, 200);
  assert.equal(body.imported, 3);
  assert.equal(body.created, 2);
  assert.equal(body.updated, 1);
  assert.equal(body.skipped, 0);
  assert.deepEqual(body.skippedLines, []);
});

test("re-importing the same list counts every team as updated, and 9882k finds the stored 9882K", async () => {
  await world();
  const text = "1234, Iron Hawks\n9882K, Kilo Kestrels";
  const first = await importTeams(ADMIN, { text });
  assert.deepEqual([first.body.created, first.body.updated], [2, 0]);

  const again = await importTeams(ADMIN, { text: text.replace("9882K", "9882k") });
  assert.deepEqual([again.body.imported, again.body.created, again.body.updated], [2, 0, 2]);
  assert.equal((await (await store()).listTeams()).length, 2, "nothing was duplicated");
});

test("a number pasted twice is one team: the later row wins, and created + updated adds up to imported", async () => {
  const db = await world(["1234"]);
  const { body } = await importTeams(ADMIN, {
    text: "1234, First\n5678, Bolts\n1234, Second\n5678, Bolts Again\n5678, Bolts Third",
  });
  assert.equal(body.imported, 2, "two distinct numbers");
  assert.equal(body.updated, 1, "1234 was stored before this paste");
  assert.equal(body.created, 1, "5678 is created once however often it is repeated");
  assert.equal(body.created + body.updated, body.imported);
  assert.deepEqual(body.skippedLines, [], "a repeat is not a skipped line");

  const names = Object.fromEntries((await db.listTeams()).map((t) => [t.number, t.name]));
  assert.equal(names["1234"], "Second");
  assert.equal(names["5678"], "Bolts Third");
});

/* ===== what stays ======================================================= */

test("auto-assign still spreads the teams and the reply still carries imported, skipped and assigned", async () => {
  const db = await world();
  await db.createPanel({
    name: "Panel 1", code: "IMP001", division: ES, judges: [], languages: [], sort_order: 1,
    slot_start_at: null, slot_minutes: 20, slot_count: 0,
  });
  const on = await importTeams(ADMIN, { text: "1001\n1002\n1003", autoAssign: true, perPanel: 10, division: ES });
  assert.equal(on.status, 200);
  assert.equal(on.body.assigned, 3);
  assert.equal(on.body.imported, 3);
  assert.equal(on.body.skipped, 0);

  const off = await importTeams(ADMIN, { text: "2001\n2002", autoAssign: false });
  assert.equal(off.body.assigned, 0);
});

test("no panels with auto-assign is still refused before anything is written, and nothing readable is still a 400", async () => {
  const db = await world();
  const refused = await importTeams(ADMIN, { text: "1234, Iron Hawks", autoAssign: true });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /Add at least one judge panel first/);
  assert.equal((await db.listTeams()).length, 0);

  const empty = await importTeams(ADMIN, { text: "Team Number, Name\nnot a team" });
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /No team rows found/);
});

test("only the Judge Advisor can import", async () => {
  const db = await world();
  assert.equal((await importTeams(QUEUER, { text: "1234, Iron Hawks" })).status, 403);
  assert.equal((await importTeams(null, { text: "1234, Iron Hawks" })).status, 403);
  assert.equal((await db.listTeams()).length, 0);
});
