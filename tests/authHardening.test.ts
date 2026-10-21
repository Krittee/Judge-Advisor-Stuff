import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Session } from "../src/lib/auth";

/* Phase 2 security fixes (BUG-004, 013, 020, 026): the session secret
   placeholder, the login throttle, referee report ownership, what the
   state payload tells whom, and the doctor script.

   Where a function can be imported it is -- these call the real code, not
   a copy of it. The route files that need a live Next.js request scope
   (anything that calls cookies()) are checked against their source
   instead, like the other route tests in this folder.

   The data file is named before anything imports the store, because
   file.ts resolves DATA_FILE once at load. Node's test runner gives each
   test file its own process, so that is ours alone. */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-hardening-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";

const root = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), "utf8");

const importAuth = () => import("../src/lib/auth");

/** Run `fn` with these env vars set (undefined deletes), then put them back. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T> | T) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const apply = (v: Record<string, string | undefined>) => {
    for (const [k, value] of Object.entries(v)) {
      if (value === undefined) delete process.env[k];
      else process.env[k] = value;
    }
  };
  apply(vars);
  try {
    return await fn();
  } finally {
    apply(saved);
  }
}

/** No proxy of any kind: a laptop or a LAN box running `next start`. */
const NO_PROXY = { VERCEL: undefined, TRUST_PROXY: undefined };

const requestFrom = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/session", { method: "POST", headers });

const ADMIN_SESSION: Session = { role: "admin", name: "Judge Advisor" };

/* ---- 1. the placeholder SESSION_SECRET --------------------------------- */

/* secret() is private. createSession signs the token with it BEFORE it
   touches cookies(), so in production-like mode a refused secret rejects
   with the SESSION_SECRET message, while an accepted one gets as far as
   cookies() and fails there instead (we are outside a request scope). */

async function sessionSecretOutcome(secret: string | undefined, env: Record<string, string | undefined>) {
  const { createSession } = await importAuth();
  return withEnv({ SESSION_SECRET: secret, ...env }, async () => {
    try {
      await createSession(ADMIN_SESSION);
      return { refused: false };
    } catch (e) {
      return { refused: /SESSION_SECRET/.test((e as Error).message) };
    }
  });
}

const PRODUCTION = { NODE_ENV: "production", DATABASE_URL: undefined };

test("production refuses the exact placeholder from .env.example", async () => {
  const placeholder = /^SESSION_SECRET=(.+)$/m.exec(read(".env.example"))![1];
  assert.ok(placeholder.length >= 16, "the placeholder has to be long enough to pass the length check");
  assert.equal((await sessionSecretOutcome(placeholder, PRODUCTION)).refused, true);
});

test("production refuses anything shaped like a placeholder, in any case", async () => {
  for (const secret of ["changeme-changeme-changeme", "Change-Me-To-A-Real-Secret-1234", "xxxxxxxxCHANGEMExxxxxxxx"]) {
    assert.equal((await sessionSecretOutcome(secret, PRODUCTION)).refused, true, secret);
  }
});

test("a database URL alone makes the placeholder unacceptable too", async () => {
  const out = await sessionSecretOutcome("change-me-to-something-random-and-long", {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://u:p@example.invalid/db",
  });
  assert.equal(out.refused, true);
});

test("the 16-character floor did not move: a 16-31 character secret keeps working", async () => {
  assert.equal((await sessionSecretOutcome("k3j4h5g6f7d8s9a0", PRODUCTION)).refused, false, "16 chars");
  assert.equal((await sessionSecretOutcome("k3j4h5g6f7d8s9a0q1w2e3r4t5y6u7i", PRODUCTION)).refused, false, "31 chars");
  assert.equal((await sessionSecretOutcome("k3j4h5g6f7d8s9a", PRODUCTION)).refused, true, "15 chars");
  assert.equal((await sessionSecretOutcome(undefined, PRODUCTION)).refused, true, "unset");
});

test("development still accepts the placeholder, so copying .env.example just works", async () => {
  const out = await sessionSecretOutcome("change-me-to-something-random-and-long", {
    NODE_ENV: "development",
    DATABASE_URL: undefined,
  });
  assert.equal(out.refused, false);
});

/* ---- 2. the login throttle --------------------------------------------- */

test("with no trusted proxy, X-Forwarded-For is ignored: one shared bucket", async () => {
  const { clientKeyFor } = await importAuth();
  await withEnv(NO_PROXY, () => {
    const keys = new Set([
      clientKeyFor(requestFrom()),
      clientKeyFor(requestFrom({ "x-forwarded-for": "1.1.1.1" })),
      clientKeyFor(requestFrom({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" })),
      clientKeyFor(requestFrom({ "x-real-ip": "4.4.4.4" })),
    ]);
    assert.equal(keys.size, 1, "a client-supplied header chose its own bucket");
  });
});

test("TRUST_PROXY is only honoured as exactly 1", async () => {
  const { clientKeyFor } = await importAuth();
  const a = requestFrom({ "x-forwarded-for": "1.1.1.1" });
  const b = requestFrom({ "x-forwarded-for": "2.2.2.2" });
  await withEnv({ ...NO_PROXY, TRUST_PROXY: "true" }, () => assert.equal(clientKeyFor(a), clientKeyFor(b)));
  await withEnv({ ...NO_PROXY, TRUST_PROXY: "0" }, () => assert.equal(clientKeyFor(a), clientKeyFor(b)));
  await withEnv({ ...NO_PROXY, TRUST_PROXY: "1" }, () => assert.notEqual(clientKeyFor(a), clientKeyFor(b)));
});

for (const proxy of [{ VERCEL: "1", TRUST_PROXY: undefined }, { VERCEL: undefined, TRUST_PROXY: "1" }]) {
  test(`behind a trusted proxy (${proxy.VERCEL ? "VERCEL" : "TRUST_PROXY=1"}) the forwarded address picks the bucket`, async () => {
    const { clientKeyFor } = await importAuth();
    await withEnv(proxy, () => {
      const shared = clientKeyFor(requestFrom());
      const one = clientKeyFor(requestFrom({ "x-forwarded-for": "1.1.1.1" }));
      const two = clientKeyFor(requestFrom({ "x-forwarded-for": "2.2.2.2" }));
      assert.notEqual(one, two);
      assert.equal(one, clientKeyFor(requestFrom({ "x-forwarded-for": "1.1.1.1" })));
      assert.notEqual(one, shared);

      // The address a proxy appended is the last; the first is the client's claim.
      assert.equal(
        clientKeyFor(requestFrom({ "x-forwarded-for": "9.9.9.9, 1.1.1.1" })),
        clientKeyFor(requestFrom({ "x-forwarded-for": "8.8.8.8, 1.1.1.1" })),
        "a spoofed leading entry changed the bucket",
      );

      assert.equal(clientKeyFor(requestFrom({ "x-real-ip": "1.1.1.1" })), one, "x-real-ip is the fallback");
      assert.equal(clientKeyFor(requestFrom()), shared, "no header at all falls back to the shared bucket");

      // A header cannot borrow the shared bucket's forgiving limits by naming it.
      assert.notEqual(clientKeyFor(requestFrom({ "x-forwarded-for": shared })), shared);
    });
  });
}

test("the shared bucket tolerates honest typos but still locks, briefly", async () => {
  const { clientKeyFor, loginRateLimited, recordLoginFailure, recordLoginSuccess } = await importAuth();
  const key = await withEnv(NO_PROXY, () => clientKeyFor(requestFrom()));
  recordLoginSuccess(key);

  for (let i = 0; i < 19; i++) recordLoginFailure(key);
  assert.equal(loginRateLimited(key).limited, false, "19 mistypes across the whole venue locked everyone out");

  recordLoginFailure(key);
  const locked = loginRateLimited(key);
  assert.equal(locked.limited, true, "20 failures did not lock the shared bucket");
  assert.ok(locked.retryAfterSeconds! <= 120, "the shared lock should be two minutes, not five");
  recordLoginSuccess(key);
});

test("a per-address bucket is strict: 5 failures, then a five-minute lock", async () => {
  const { loginRateLimited, recordLoginFailure, recordLoginSuccess } = await importAuth();
  const key = "ip:203.0.113.7";
  recordLoginSuccess(key);

  for (let i = 0; i < 4; i++) recordLoginFailure(key);
  assert.equal(loginRateLimited(key).limited, false);
  recordLoginFailure(key);
  const locked = loginRateLimited(key);
  assert.equal(locked.limited, true);
  assert.ok(locked.retryAfterSeconds! > 120, "a per-address lock should outlast the shared one");
  assert.ok(locked.retryAfterSeconds! <= 300);
  recordLoginSuccess(key);
});

test("the attempts map is bounded: the oldest callers are dropped, not the newest", async () => {
  const { loginRateLimited, recordLoginFailure, recordLoginSuccess } = await importAuth();
  const oldest = "ip:flood-oldest";
  const newest = "ip:flood-newest";
  recordLoginSuccess(oldest);
  recordLoginSuccess(newest);

  // Lock one caller, then bury it under far more distinct callers than the cap.
  // None of them is old enough to expire, so only a size cap can make room.
  for (let i = 0; i < 5; i++) recordLoginFailure(oldest);
  assert.equal(loginRateLimited(oldest).limited, true);

  for (let i = 0; i < 6_000; i++) recordLoginFailure(`ip:flood-${i}`);

  for (let i = 0; i < 5; i++) recordLoginFailure(newest);
  assert.equal(loginRateLimited(newest).limited, true, "the most recent caller must still be tracked");
  assert.equal(
    loginRateLimited(oldest).limited,
    false,
    "the map kept every caller it was ever shown -- it grows without bound",
  );
});

test("end to end: rotating X-Forwarded-For does not dodge the limit on POST /api/session", async () => {
  const { clientKeyFor, recordLoginSuccess } = await importAuth();
  const { POST } = await import("../src/app/api/session/route");

  await withEnv(
    { ...NO_PROXY, NODE_ENV: "development", DATABASE_URL: undefined, ADMIN_CODE: "TESTADMIN", QUEUER_CODE: "TESTQ", REFEREE_CODE: "TESTREF" },
    async () => {
      recordLoginSuccess(clientKeyFor(requestFrom()));
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 24; i++) {
          const res = await POST(
            new Request("http://localhost/api/session", {
              method: "POST",
              headers: { "content-type": "application/json", "x-forwarded-for": `10.0.${i}.${i + 1}` },
              body: JSON.stringify({ code: "ZZZZZZ", name: "" }),
            }),
          );
          statuses.push(res.status);
        }
        assert.ok(statuses.slice(0, 20).every((s) => s === 401), `expected 20 plain failures first: ${statuses}`);
        assert.ok(statuses.slice(20).every((s) => s === 429), `a fresh header got a fresh bucket: ${statuses}`);
      } finally {
        // Leave the shared bucket empty for the sign-in tests below.
        recordLoginSuccess(clientKeyFor(requestFrom()));
      }
    },
  );
});

/* ---- 3. referee report ownership (BUG-013) ------------------------------ */

const SIGN_IN_ENV = {
  ...NO_PROXY,
  NODE_ENV: "development",
  DATABASE_URL: undefined,
  ADMIN_CODE: "TESTADMIN",
  QUEUER_CODE: "TESTQ",
  REFEREE_CODE: "TESTREF",
};

const signIn = async (body: Record<string, unknown>) => {
  const { POST } = await import("../src/app/api/session/route");
  return POST(
    new Request("http://localhost/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
};

test("a referee cannot sign in without a name -- the server says so with a 400", async () => {
  await withEnv(SIGN_IN_ENV, async () => {
    for (const name of [undefined, "", "   ", "\t\n"]) {
      const res = await signIn({ code: "TESTREF", name });
      assert.equal(res.status, 400, `name ${JSON.stringify(name)}`);
      const { error } = (await res.json()) as { error: string };
      assert.match(error, /name/i, "the message has to say what is missing");
      assert.equal(res.headers.get("set-cookie"), null, "no session may be issued");
    }
  });
});

test("a named referee gets past the name check; other roles never needed one", async () => {
  await withEnv(SIGN_IN_ENV, async () => {
    // Past the gate the route calls createSession, which needs a real Next
    // request scope for cookies() and so throws here. That throw IS the
    // proof: a 400 would have come back as a response instead.
    const named = await signIn({ code: "TESTREF", name: "Dana" }).then(
      (r) => r.status,
      () => "reached createSession",
    );
    assert.equal(named, "reached createSession");

    for (const code of ["TESTQ", "TESTADMIN"]) {
      const res = await signIn({ code, name: "" }).then((r) => r.status, () => "reached createSession");
      assert.equal(res, "reached createSession", `${code} wrongly demanded a name`);
    }
  });
});

test("report authors compare case-insensitively and trimmed", async () => {
  const { sameAuthor } = await importAuth();
  assert.equal(sameAuthor("Dana", "Dana"), true);
  assert.equal(sameAuthor("Dana", "dana"), true);
  assert.equal(sameAuthor("  DANA ", "dana"), true);
  assert.equal(sameAuthor("Dana", "Dane"), false);
  assert.equal(sameAuthor("Dana", "Dana Smith"), false);
  assert.equal(sameAuthor("Dana", ""), false);
});

test("PATCH /api/flags checks authorship with sameAuthor, not an exact string compare", () => {
  const src = read("src/app/api/flags/route.ts");
  const patch = src.slice(src.indexOf("export async function PATCH"), src.indexOf("export async function DELETE"));
  assert.match(patch, /!canAdminister\(session\)\s*&&\s*!sameAuthor\(existing\.author,\s*session!\.name\)/);
  assert.ok(!/existing\.author\s*!==/.test(patch), "the exact-match author compare is back");
});

test("a flag edit logs before -> after for every field it changed", () => {
  const src = read("src/app/api/flags/route.ts");
  const patch = src.slice(src.indexOf("export async function PATCH"), src.indexOf("export async function DELETE"));

  // The file store hands back the very object it stores, so these must be
  // read before updateFlag mutates it or "before" silently equals "after".
  const snapshot = patch.search(/const before\s*=\s*\{/);
  const update = patch.indexOf("store().updateFlag(");
  assert.ok(snapshot !== -1 && update !== -1 && snapshot < update, "the before snapshot must precede updateFlag");

  const beforeBlock = patch.slice(snapshot, patch.indexOf("};", snapshot));
  const afterBlock = patch.slice(patch.search(/const after\s*=\s*\{/), patch.indexOf("};", patch.search(/const after\s*=\s*\{/)));
  for (const field of ["kind", "match", "field", "body", "rules", "ruleset", '"match affecting"']) {
    assert.ok(beforeBlock.includes(field), `before is missing ${field}`);
    assert.ok(afterBlock.includes(field), `after is missing ${field}`);
  }

  assert.match(patch, /\$\{show\(before\[k\]\)\} → \$\{show\(after\[k\]\)\}/, "the detail no longer shows before → after");
  const log = patch.slice(patch.indexOf("logActivity"));
  assert.match(log, /detail:[\s\S]*changes/, "the logged detail no longer carries the per-field changes");
});

test("the signed-in form asks a referee for their name, and nobody else", () => {
  const src = read("src/components/SignInForm.tsx");
  assert.match(src, /usePathname\(\)\?\.startsWith\("\/referee"\)/);
  assert.match(src, /required=\{nameRequired\}/);
  assert.match(src, /nameRequired && !name\.trim\(\)/, "the button should wait for the name");
});

/* ---- 4. what the state payload tells whom (BUG-020) --------------------- */

test("loadState sends messages only to those who run interviews, and staff names only to staff", async () => {
  const { fileStore } = await import("../src/lib/db/file");
  const { loadState } = await import("../src/lib/server-state");
  await fileStore.resetAll();

  const panel = await fileStore.createPanel({
    name: "Panel A",
    code: "HARD01",
    division: "Elementary School",
    judges: ["Ms Rivera"],
    languages: [],
    sort_order: 1,
    slot_start_at: null,
    slot_minutes: 20,
    slot_count: 0,
  });
  await fileStore.upsertTeams([
    { number: "1001", name: "Team 1001", pit: null, division: "Elementary School", category: "developing" },
  ]);
  const team = (await fileStore.listTeams())[0];
  await fileStore.updateTeam(team.id, { panel_id: panel.id });
  const request = await fileStore.createRequest({
    teamId: team.id,
    panelId: panel.id,
    kind: "queue",
    message: "our robot is in the pit, please come to us",
    createdBy: "queuer:Dana",
    language: "en",
  });
  await fileStore.updateRequest(request.id, {
    acknowledged_by: "Judge Amy",
    interviewer: "Judge Amy",
    outcome: "went well",
  });

  const judge: Session = { role: "judge", name: "Amy", panelId: panel.id, panelName: panel.name };
  const queuer: Session = { role: "queuer", name: "Dana" };
  const referee: Session = { role: "referee", name: "Ref One" };
  const viewers: [string, Session | null][] = [
    ["admin", ADMIN_SESSION],
    ["judge", judge],
    ["queuer", queuer],
    ["referee", referee],
    ["anonymous", null],
  ];
  const seen = Object.fromEntries(
    await Promise.all(viewers.map(async ([name, s]) => [name, (await loadState(s)).requests[0]] as const)),
  );

  for (const who of ["admin", "judge", "queuer"]) {
    assert.equal(seen[who].message, "our robot is in the pit, please come to us", `${who} must read the team's note`);
  }
  for (const who of ["referee", "anonymous"]) {
    assert.equal(seen[who].message, null, `${who} must not read the team's note`);
  }

  // Staff metadata: kept for any signed-in role, nulled for the public.
  for (const who of ["admin", "judge", "queuer", "referee"]) {
    assert.equal(seen[who].created_by, "queuer:Dana", who);
    assert.equal(seen[who].acknowledged_by, "Judge Amy", who);
    assert.equal(seen[who].interviewer, "Judge Amy", who);
    assert.equal(seen[who].outcome, "went well", who);
  }
  const anon = seen.anonymous;
  assert.equal(anon.created_by, null);
  assert.equal(anon.acknowledged_by, null);
  assert.equal(anon.interviewer, null);
  assert.equal(anon.outcome, null);

  // What the board and team pages DO draw must survive the stripping.
  assert.equal(anon.id, request.id);
  assert.equal(anon.team_id, team.id);
  assert.equal(anon.panel_id, panel.id);
  assert.equal(anon.status, request.status);
  assert.equal(anon.requested_at, request.requested_at);

  // Panel judge names are rendered on /board and /team/[number], which are
  // anonymous pages, so they are deliberately still in the public payload.
  assert.deepEqual((await loadState(null)).panels[0].judges, ["Ms Rivera"]);

  await fileStore.resetAll();
});

test("no page reads the staff fields loadState nulls for the public", () => {
  // If one starts to, the board or a team page would silently go blank.
  const pages = ["src/app/board/page.tsx", "src/app/team/[number]/page.tsx", "src/app/page.tsx"];
  for (const page of pages) {
    assert.ok(!/\b(created_by|acknowledged_by|interviewer|outcome)\b/.test(read(page)), `${page} reads a nulled field`);
  }
});

test("GET /api/admin/activity is the Judge Advisor's alone", () => {
  const src = read("src/app/api/admin/activity/route.ts");
  assert.match(src, /if \(!canAdminister\(session\)\)/);
  assert.ok(!/canReadNotes|canAdvance|canReadFlags|canFlag/.test(src), "activity opened to a wider role");
  assert.match(src, /status:\s*403/);
});

/* ---- 5. the doctor script (BUG-026) -------------------------------------- */

const publishedCodes = (src: string) =>
  [...(/PUBLISHED_CODES\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(src)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();

test("the doctor's published-code list is the one auth.ts refuses", () => {
  const theirs = publishedCodes(read("scripts/doctor.mjs"));
  const ours = publishedCodes(read("src/lib/auth.ts"));
  assert.ok(ours.length >= 6, "could not read PUBLISHED_CODES out of auth.ts");
  assert.deepEqual(theirs, ours, "scripts/doctor.mjs and src/lib/auth.ts disagree about which codes are published");
  assert.ok(ours.includes("HREF01"), "the head referee's dev default is printed in .env.example, so it is published");
  assert.ok(read("src/lib/auth.ts").includes("/change-?me/i") && read("scripts/doctor.mjs").includes("/change-?me/i"));
});

/** Run the real doctor in a scratch project folder that has only a .env.local. */
function runDoctor(envFile: string | null, extraEnv: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "judge-queue-doctor-"));
  if (envFile !== null) writeFileSync(join(dir, ".env.local"), envFile);
  mkdirSync(join(dir, "config"));
  const run = spawnSync(process.execPath, [join(root, "scripts/doctor.mjs")], {
    cwd: dir,
    // A clean environment: whatever the doctor knows must come from the files.
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...extraEnv } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 30_000,
  });
  return { dir, out: (run.stdout + run.stderr).replace(/\x1b\[[0-9;]*m/g, ""), status: run.status };
}

test("the doctor reads .env.local, so a DATABASE_URL there makes it production-like", () => {
  const { out, status } = runDoctor(
    "DATABASE_URL=postgresql://u:p@db.example.invalid/x\nSESSION_SECRET=change-me-to-something-random-and-long\nADMIN_CODE=Zq8mXk\n",
  );
  assert.match(out, /DATABASE_URL is set — using Postgres/, "the doctor never saw .env.local");
  assert.match(out, /SESSION_SECRET is still the placeholder/);
  assert.equal(status, 1);
});

test("the doctor flags a published role code and warns below 32 characters", () => {
  const { out } = runDoctor(
    "DATABASE_URL=postgresql://u:p@db.example.invalid/x\nSESSION_SECRET=k3j4h5g6f7d8s9a0q1w2e3r4t5y6\nADMIN_CODE=JA2026\nREFEREE_CODE=ref001\nHEAD_REFEREE_CODE=href01\nQUEUER_CODE=Desk77x\n",
  );
  assert.match(out, /ADMIN_CODE is "JA2026"/);
  assert.match(out, /REFEREE_CODE is "REF001"/);
  assert.match(out, /HEAD_REFEREE_CODE is "HREF01"/);
  assert.ok(!/QUEUER_CODE is "/.test(out), "a private code was reported as published");
  assert.match(out, /SESSION_SECRET is only 28 characters/);
});

test("the doctor warns when the head referee's code is not set, and not when it is", () => {
  const base = "DATABASE_URL=postgresql://u:p@db.example.invalid/x\nSESSION_SECRET=k3j4h5g6f7d8s9a0q1w2e3r4t5y6\nADMIN_CODE=Zq8mXk\n";
  assert.match(runDoctor(base).out, /HEAD_REFEREE_CODE is not set, so that role cannot sign in/);
  assert.ok(!/HEAD_REFEREE_CODE is not set/.test(runDoctor(`${base}HEAD_REFEREE_CODE=Mq4tRw\n`).out));
});

test(".env.example lists the head referee's code next to the shared referee code", () => {
  const lines = read(".env.example").split("\n");
  const at = lines.indexOf("REFEREE_CODE=REF001");
  assert.ok(at >= 0, "REFEREE_CODE is in .env.example");
  const head = lines.indexOf("HEAD_REFEREE_CODE=HREF01");
  assert.ok(head > at && head - at <= 3, "HEAD_REFEREE_CODE=HREF01 follows it, with its one-line comment between");
  assert.match(lines[head - 1], /^# .*head referee/i);
});

test("the doctor warns when a file store has no judge panels, and not when it has one", () => {
  const dir = mkdtempSync(join(tmpdir(), "judge-queue-doctor-data-"));
  const empty = join(dir, "empty.json");
  const stocked = join(dir, "stocked.json");
  writeFileSync(empty, JSON.stringify({ panels: [], teams: [] }));
  writeFileSync(stocked, JSON.stringify({ panels: [{ id: "p1" }], teams: [] }));

  assert.match(runDoctor(null, { DATA_FILE: empty }).out, /No judge panels yet — judging is unusable until you add one/);
  assert.ok(!/No judge panels yet/.test(runDoctor(null, { DATA_FILE: stocked }).out));
  // Postgres: skipped, with a note instead of a verdict.
  const pg = runDoctor("DATABASE_URL=postgresql://u:p@db.example.invalid/x\n", { DATA_FILE: empty }).out;
  assert.ok(!/No judge panels yet/.test(pg));
  assert.match(pg, /Not checking for judge panels/);
});
