import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/* A parameterised query whose $N placeholders and argument list disagree
   typecheck cleanly, build cleanly, and then fail at runtime against a real
   database with "bind message supplies N parameters, but prepared statement
   requires M".  Only the Postgres deployment sees it, so it can reach the
   event un-noticed.  This walks every call site in the backend and counts
   both sides. */

const src = readFileSync(new URL("../src/lib/db/postgres.ts", import.meta.url), "utf8");

/* Reads the SQL string and the params array that follows it, returning
   the highest $N used and the number of arguments supplied. */
function callSites(source) {
  const sites = [];
  const re = /\bquery\s*(?:<[^>]*>)?\s*\(/g;
  while (re.exec(source)) {
    let i = re.lastIndex;
    while (/\s/.test(source[i])) i++;
    const quote = source[i];
    if (quote !== "`" && quote !== '"' && quote !== "'") continue;

    let j = i + 1;
    while (j < source.length && !(source[j] === quote && source[j - 1] !== "\\")) j++;
    const sql = source.slice(i + 1, j);
    const line = source.slice(0, i).split("\n").length;

    /* Queries that interpolate a fragment build their own placeholders, so
       the two counts legitimately differ. */
    if (sql.includes("${")) continue;

    const placeholders = [...sql.matchAll(/\$(\d+)/g)].reduce((a, x) => Math.max(a, +x[1]), 0);

    let k = j + 1;
    while (/[\s,]/.test(source[k])) k++;
    if (source[k] !== "[") {
      sites.push({ line, sql, placeholders, params: 0 });
      continue;
    }

    let depth = 0;
    let commas = 0;
    let end = k;
    for (let p = k; p < source.length; p++) {
      const c = source[p];
      if (c === "[" || c === "(" || c === "{") depth++;
      else if (c === "]" || c === ")" || c === "}") {
        depth--;
        if (depth === 0) {
          end = p;
          break;
        }
      } else if (c === "`" || c === '"' || c === "'") {
        const open = c;
        p++;
        while (p < source.length && !(source[p] === open && source[p - 1] !== "\\")) p++;
      } else if (depth === 1 && c === ",") commas++;
    }
    const inner = source.slice(k + 1, end).trim();
    const params = inner === "" ? 0 : commas + (inner.endsWith(",") ? 0 : 1);
    sites.push({ line, sql, placeholders, params });
  }
  return sites;
}

test("the scanner can actually spot a mismatch", () => {
  const bad = callSites('await query("insert into t (a, b) values ($1, $2)", [one, two, three]);');
  assert.equal(bad.length, 1);
  assert.equal(bad[0].placeholders, 2);
  assert.equal(bad[0].params, 3);

  const good = callSites('await query("select * from t where a = $1", [one]);');
  assert.equal(good[0].placeholders, good[0].params);

  /* Nested arrays and calls count as one argument, not several. */
  const nested = callSites('await query("insert into t (a, b) values ($1, $2)", [id, [x, y]]);');
  assert.equal(nested[0].params, 2);

  /* A comma inside a string literal is not an argument separator. */
  const str = callSites('await query("select $1", ["a, b"]);');
  assert.equal(str[0].params, 1);
});

test("every Postgres query supplies exactly as many params as it uses", () => {
  const sites = callSites(src);
  assert.ok(sites.length > 20, `expected to find the backend's queries, found ${sites.length}`);

  const mismatched = sites.filter((s) => s.placeholders !== s.params);
  const report = mismatched
    .map(
      (s) =>
        `postgres.ts:${s.line} uses $1..$${s.placeholders} but passes ${s.params}\n    ` +
        s.sql.replace(/\s+/g, " ").trim().slice(0, 120),
    )
    .join("\n  ");
  assert.equal(mismatched.length, 0, `\n  ${report}\n`);
});

/* Splits a parenthesised list on its top-level commas, so that a call like
   coalesce($3::jsonb, \'{}\'::jsonb) counts as the single value it is. */
function topLevelItems(source, open) {
  const items = [];
  let depth = 0;
  let start = open + 1;
  for (let p = open; p < source.length; p++) {
    const c = source[p];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        items.push(source.slice(start, p));
        return { items: items.filter((i) => i.trim()), end: p };
      }
    } else if (c === "'" || c === '"') {
      const q = c;
      p++;
      while (p < source.length && source[p] !== q) p++;
    } else if (depth === 1 && c === ",") {
      items.push(source.slice(start, p));
      start = p + 1;
    }
  }
  return { items: items.filter((i) => i.trim()), end: source.length };
}

test("the list splitter ignores commas inside nested calls and strings", () => {
  assert.equal(topLevelItems("(a, b, c)", 0).items.length, 3);
  assert.equal(topLevelItems("($1, coalesce($2, '{}'), $3)", 0).items.length, 3);
  assert.equal(topLevelItems("('a, b', $2)", 0).items.length, 2);
});

test("insert column lists match their value lists", () => {
  /* The mismatch that caused this test to exist: a column added to the params
     but not to the column list. */
  for (const site of callSites(src)) {
    const head = /insert\s+into\s+\w+\s*\(/is.exec(site.sql);
    if (!head) continue;
    const columns = topLevelItems(site.sql, head.index + head[0].length - 1);
    const values = /values\s*\(/is.exec(site.sql.slice(columns.end));
    if (!values) continue;
    const supplied = topLevelItems(
      site.sql.slice(columns.end),
      values.index + values[0].length - 1,
    );
    assert.equal(
      columns.items.length,
      supplied.items.length,
      `postgres.ts:${site.line} inserts ${columns.items.length} columns ` +
        `but supplies ${supplied.items.length} values`,
    );
  }
});

/* ---- updateRequest's compare-and-set (BUG-011) ------------------------

   updateRequest builds its UPDATE from the patch's column names, so the
   scanner above skips it (it interpolates a fragment) and none of the
   conformance suite runs without a database. Its status predicate is the
   whole of the Postgres half of the fix, and the one place a hard-coded
   "$3" would be wrong for every patch that is not exactly one column wide.
   So the real store is run here against a recording stand-in for the
   driver: the statement it sends, the parameters that go with it, and how
   it reads the answer are all checked. What this cannot show is that
   Postgres accepts the statement -- but it is the existing UPDATE with one
   `and status = $n` appended and its parameter pushed last. */

const ROW = { id: "r1", status: "requested", kind: "queue", panel_id: "p1", slot_start: null };
const calls = [];
const released = [];
let answer = () => [];
let clients = 0;

class FakePool {
  on() {}
  /* `client` says which connection sent it: "pool" for a bare pool.query(). */
  async query(sql, params, client = "pool") {
    calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params, client });
    return { rows: answer(sql.replace(/\s+/g, " ").trim(), params) };
  }
  /* withClient runs a transaction on one connection; here that is the same recorder. */
  async connect() {
    const client = `client${++clients}`;
    return { query: (sql, params) => this.query(sql, params, client), release: () => released.push(client) };
  }
}

const nodeRequire = createRequire(import.meta.url);
const pgPath = nodeRequire.resolve("pg");
nodeRequire.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
process.env.DATABASE_URL = "postgres://localhost/judge_queue_test";
const { postgresStore } = await import("../src/lib/db/postgres");

/** Run `fn` against the stand-in, with `rows(sql)` answering each query. Returns the requests-table statements it sent, and what it threw. */
async function run(rows, fn) {
  calls.length = 0;
  answer = rows;
  const error = await fn().then(
    () => undefined,
    (e) => e,
  );
  return { sent: calls.filter((c) => /^(update|select \*) .*requests/.test(c.sql)), error };
}

test("updateRequest with ifStatus appends the status predicate, numbered after every patch column", async () => {
  const { sent } = await run(
    (sql) => (sql.startsWith("update requests") ? [{ ...ROW, status: "acknowledged" }] : []),
    () => postgresStore.updateRequest("r1", { status: "acknowledged", acknowledged_at: "t" }, "requested"),
  );
  const update = sent.find((c) => c.sql.startsWith("update requests"));
  assert.equal(
    update.sql,
    "update requests set status = $2, acknowledged_at = $3, updated_at = now() where id = $1 and status = $4 returning *",
  );
  assert.deepEqual(update.params, ["r1", "acknowledged", "t", "requested"]);
});

test("updateRequest without ifStatus stays unconditional", async () => {
  const { sent } = await run(
    (sql) => (sql.startsWith("update requests") ? [ROW] : []),
    () => postgresStore.updateRequest("r1", { status: "acknowledged" }),
  );
  const update = sent.find((c) => c.sql.startsWith("update requests"));
  assert.equal(
    update.sql,
    "update requests set status = $2, updated_at = now() where id = $1 returning *",
  );
  assert.deepEqual(update.params, ["r1", "acknowledged"]);
});

test("a step-time correction (the Judge Advisor's set-times) is an ordinary patch: the time columns, then the status guard, status untouched", async () => {
  const { sent } = await run(
    (sql) => (sql.startsWith("update requests") ? [{ ...ROW, status: "completed" }] : []),
    () => postgresStore.updateRequest("r1", { started_at: "2026-10-20T03:12:00.000Z", finished_at: "2026-10-20T03:32:00.000Z" }, "completed"),
  );
  const update = sent.find((c) => c.sql.startsWith("update requests"));
  assert.equal(
    update.sql,
    "update requests set started_at = $2, finished_at = $3, updated_at = now() where id = $1 and status = $4 returning *",
  );
  assert.deepEqual(update.params, ["r1", "2026-10-20T03:12:00.000Z", "2026-10-20T03:32:00.000Z", "completed"]);
});

test("zero rows with ifStatus: a request that still exists is a 409, one that is gone is a 404", async () => {
  // The predicate missed. A second look at the row says which kind of miss it was.
  const moved = await run(
    (sql) => (sql.startsWith("select * from requests where id") ? [ROW] : []),
    () => postgresStore.updateRequest("r1", { status: "acknowledged" }, "scheduled"),
  );
  assert.equal(moved.error?.status, 409);
  assert.match(moved.error.message, /changed on another screen/);

  const gone = await run(
    () => [],
    () => postgresStore.updateRequest("r1", { status: "acknowledged" }, "scheduled"),
  );
  assert.equal(gone.error?.status, 404);
});

test("an empty patch still honours ifStatus, as the file store does", async () => {
  const { error } = await run(
    (sql) => (sql.startsWith("select * from requests where id") ? [ROW] : []),
    () => postgresStore.updateRequest("r1", {}, "scheduled"),
  );
  assert.equal(error?.status, 409);
});

test("a booking turned into a walk-up request skips the booking-gap lookup; an ordinary slot move still runs it", async () => {
  const booking = { ...ROW, status: "scheduled", kind: "slot", slot_start: "2099-01-01T14:00:00.000Z" };
  const rows = (sql) =>
    sql.startsWith("update requests") ? [ROW] : sql.startsWith("select * from requests where id") ? [booking] : [];

  // ready now: it is a slot only until this write lands, and it is giving the slot up.
  let { sent } = await run(rows, () =>
    postgresStore.updateRequest(
      "r1",
      { kind: "queue", status: "requested", slot_start: null, slot_end: null, requested_at: "t" },
      "scheduled",
    ),
  );
  assert.ok(
    !sent.some((c) => c.sql.includes("kind = 'slot'")),
    "converting a booking to a queue request should not check the slot it is giving up against its neighbours",
  );
  const update = sent.find((c) => c.sql.startsWith("update requests"));
  assert.match(update.sql, /where id = \$1 and status = \$7 returning \*$/);
  assert.equal(update.params.at(-1), "scheduled");

  // Moving a booking to another time is still a booking, and still checked.
  ({ sent } = await run(rows, () =>
    postgresStore.updateRequest("r1", { slot_start: "2099-01-01T14:20:00.000Z" }, "scheduled"),
  ));
  assert.ok(
    sent.some((c) => c.sql.includes("kind = 'slot'")),
    "a slot move must still be checked against the panel's other bookings",
  );
});

test("reassignRequest rolls back the request move if updating its team fails", async () => {
  const { error } = await run(
    (sql) => {
      if (sql.startsWith("select * from requests where id") && sql.includes("for update")) return [ROW];
      if (sql.startsWith("update requests set panel_id")) return [{ ...ROW, panel_id: "p2" }];
      if (sql.startsWith("update teams set panel_id")) throw new Error("team write failed");
      return [];
    },
    () => postgresStore.reassignRequest("r1", "p1", "p2", "requested"),
  );
  assert.equal(error?.message, "team write failed");
  assert.ok(calls.some((c) => c.sql === "begin"));
  assert.ok(calls.some((c) => c.sql === "rollback"));
  assert.ok(!calls.some((c) => c.sql === "commit"));
});

test("reassignRequest locks the row and rejects an old panel even when status still matches", async () => {
  const { error } = await run(
    (sql) => (sql.startsWith("select * from requests where id") ? [{ ...ROW, panel_id: "p2" }] : []),
    () => postgresStore.reassignRequest("r1", "p1", "p3", "requested"),
  );
  assert.equal(error?.status, 409);
  assert.ok(calls.some((c) => c.sql.includes("for update")));
  assert.ok(!calls.some((c) => c.sql.startsWith("update requests")));
});

test("reassignRequest keeps a booked team in place when the target panel has a nearby booking", async () => {
  const booked = { ...ROW, status: "scheduled", kind: "slot", slot_start: "2099-01-01T14:00:00.000Z" };
  const { error } = await run(
    (sql) => {
      if (sql.startsWith("select * from requests where id") && sql.includes("for update")) return [booked];
      if (sql.includes("kind = 'slot'")) return [{ ...booked, id: "r2", panel_id: "p2" }];
      return [];
    },
    () => postgresStore.reassignRequest("r1", "p1", "p2", "scheduled"),
  );
  assert.equal(error?.status, 409);
  assert.ok(!calls.some((c) => c.sql.startsWith("update requests")));
  assert.ok(!calls.some((c) => c.sql.startsWith("update teams")));
  assert.ok(calls.some((c) => c.sql === "rollback"));
});

/* ---- the live-request index can be created on an old database (NEW-B3) ----

   A database that predates 'scheduled' in the index may already hold two live
   rows for one team. Creating the unique index then fails, and every request
   fails with it. migrate() must cancel the extras first. This checks the
   order of the statements in migrate(); the database itself is not available
   here, so what Postgres makes of the UPDATE is not shown. */
test("migrate() cancels duplicate live requests before it creates the one-live-per-team index", () => {
  const body = src.slice(src.indexOf("async function migrate()"));
  const create = body.indexOf("create unique index if not exists requests_one_live_per_team");
  const cancel = body.indexOf("update requests set status = 'cancelled'");
  assert.ok(create > 0, "the one-live-per-team index is gone from migrate()");
  assert.ok(cancel > 0, "nothing cancels the duplicate live requests an old database can hold");
  assert.ok(cancel < create, "the cancel must run before the index, or the create fails on that database");
  assert.match(
    body.slice(cancel, create),
    /row_number\(\) over \(\s*partition by team_id/,
    "the extra rows are picked per team, keeping one",
  );
});

/* ---- the migration across serverless instances ---------------------------

   Several instances cold-start together on Vercel and each runs the schema
   DDL. Run as bare pool queries they interleave, and two `create ... if not
   exists` can collide on the catalog. So the whole migration is one
   transaction on one connection, behind an advisory lock that makes the
   instances take turns. What Postgres does with the lock is not shown here;
   this checks what is sent, in what order, and on which connection. */

/** Forget that this instance has migrated, as a cold start does. */
const coldStart = () => {
  globalThis.__judgeQueuePostgres.migration = null;
  released.length = 0;
};

test("a cold start migrates on one connection: begin, the advisory lock, then the DDL, then commit", async () => {
  coldStart();
  const { error } = await run(() => [], () => postgresStore.listPanels());
  assert.equal(error, undefined);

  const commit = calls.findIndex((c) => c.sql === "commit");
  assert.ok(commit > 0, "the migration never commits");
  const migration = calls.slice(0, commit + 1);
  assert.equal(migration[0].sql, "begin");
  assert.match(migration[1].sql, /^select pg_advisory_xact_lock\(\$1\)$/);
  assert.ok(Number.isSafeInteger(migration[1].params[0]), "the lock key is a fixed number");
  const ddl = migration.slice(2, -1);
  assert.ok(ddl.length >= 2 && ddl.every((c) => /^(create table|do \$\$)/.test(c.sql)), "the schema blocks, nothing before the lock");
  assert.equal(new Set(migration.map((c) => c.client)).size, 1, "the lock and the DDL share a connection");
  assert.notEqual(migration[0].client, "pool");
  assert.deepEqual(released, [migration[0].client], "the connection goes back to the pool");
});

test("a migration that fails rolls back, gives the connection back, and is retried by the next request", async () => {
  coldStart();
  const failing = await run(
    (sql) => {
      if (sql.startsWith("do $$")) throw new Error("catalog collision");
      return [];
    },
    () => postgresStore.listPanels(),
  );
  assert.equal(failing.error?.message, "catalog collision");
  assert.equal(calls.at(-1).sql, "rollback");
  assert.ok(!calls.some((c) => c.sql === "commit"));
  assert.equal(released.length, 1);

  const retry = await run(() => [], () => postgresStore.listPanels());
  assert.equal(retry.error, undefined);
  assert.ok(calls.some((c) => c.sql === "commit"), "the next request migrates again");
});

/* ---- the referee setup and the flag columns (no database here either) -------

   Nothing below runs against Postgres. The recording stand-in shows the
   statements and parameters the store sends -- the placeholders line up with
   their values, the flag fields go in the columns they are named for -- and the
   source checks show migrate() and supabase/schema.sql agree. What they
   cannot show is that Postgres accepts the SQL. */

const sent = (match) => calls.filter((c) => match.test(c.sql));

test("migrate() creates the single-row referee_setup table, and locks it down", () => {
  const body = src.slice(src.indexOf("async function migrate()"));
  assert.match(
    body,
    /create table if not exists referee_setup \(\s*id\s+int primary key default 1 check \(id = 1\),\s*ruleset\s+text not null,\s*field_count int not null check \(field_count between 1 and 20\),\s*set_by\s+text not null,\s*set_on\s+text not null,\s*updated_at\s+timestamptz not null default now\(\)\s*\);/,
  );
  assert.ok(body.includes("alter table referee_setup enable row level security;"), "RLS must cover the new table");

  const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  assert.match(schema, /create table referee_setup \(\s*id\s+int primary key default 1 check \(id = 1\),/);
  assert.match(schema, /field_count int not null check \(field_count between 1 and 20\)/);
  assert.ok(schema.includes("alter table referee_setup enable row level security;"));
  assert.ok(schema.includes("drop table if exists referee_setup cascade;"));
});

test("no alliance anywhere in the Postgres store or its schema", () => {
  /* An alliance (red/blue) was briefly a flag column. The match API it needed
     is not there, so it was removed outright; nothing may bring it back. */
  const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  assert.doesNotMatch(src, /alliance/i, "src/lib/db/postgres.ts mentions an alliance");
  assert.doesNotMatch(schema, /alliance/i, "supabase/schema.sql mentions an alliance");
});

test("createFlag and updateFlag send every flag field in the column it is named for", async () => {
  const flag = {
    teamId: "t1",
    kind: "minor",
    body: "",
    author: "Dana",
    matchType: "QF",
    matchNumber: "2-1",
    field: "2",
    rule: "GG17",
    ruleset: "v5rc",
    manualVersion: "2.1",
    matchAffecting: true,
  };

  calls.length = 0;
  answer = () => [{ id: "f1" }];
  await postgresStore.createFlag(flag);
  const [insert] = sent(/^insert into flags/);
  assert.match(
    insert.sql,
    /\(team_id, kind, body, author, match_type, match_number, field, rule, ruleset, manual_version, match_affecting\) values \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11\)/,
  );
  assert.deepEqual(insert.params, ["t1", "minor", "", "Dana", "QF", "2-1", "2", "GG17", "v5rc", "2.1", true]);

  calls.length = 0;
  await postgresStore.updateFlag("f1", flag);
  const [update] = sent(/^update flags/);
  assert.match(update.sql, /match_affecting = \$10 where id = \$1 returning \*$/);
  assert.equal(update.params[9], true);
  assert.equal(update.params.length, 10);
});

test("the referee setup is one upserted row, read back by name, never by its key", async () => {
  const row = { ruleset: "v5rc", field_count: 3, set_by: "Dana", set_on: "2026-09-09", updated_at: new Date("2026-09-09T01:02:03.456Z") };

  calls.length = 0;
  answer = () => [row];
  const saved = await postgresStore.saveRefereeSetup({ ruleset: "v5rc", fieldCount: 3, setBy: "Dana", setOn: "2026-09-09" });
  const [upsert] = sent(/^insert into referee_setup/);
  assert.match(
    upsert.sql,
    /^insert into referee_setup \(id, ruleset, field_count, set_by, set_on\) values \(1, \$1, \$2, \$3, \$4\) on conflict \(id\) do update set ruleset = excluded\.ruleset, field_count = excluded\.field_count, set_by = excluded\.set_by, set_on = excluded\.set_on, updated_at = now\(\) returning ruleset, field_count, set_by, set_on, updated_at$/,
  );
  assert.deepEqual(upsert.params, ["v5rc", 3, "Dana", "2026-09-09"]);
  assert.deepEqual(saved, { ...row, updated_at: "2026-09-09T01:02:03.456Z" }, "the driver's Date becomes the ISO string the app speaks");
  assert.equal(saved.set_on, "2026-09-09", "set_on stays the text it was sent as");

  calls.length = 0;
  const read = await postgresStore.getRefereeSetup();
  assert.equal(sent(/^select .* from referee_setup/)[0].sql, "select ruleset, field_count, set_by, set_on, updated_at from referee_setup");
  assert.deepEqual(read, saved);

  answer = () => [];
  assert.equal(await postgresStore.getRefereeSetup(), null, "no row means no setup");
});

test("a full wipe truncates the referee setup with the event; a day reset leaves it", async () => {
  answer = () => [];
  calls.length = 0;
  await postgresStore.resetAll();
  const [wipe] = sent(/^truncate/);
  assert.match(wipe.sql, /\breferee_setup\b/);
  assert.ok(wipe.sql.endsWith("cascade"));

  calls.length = 0;
  await postgresStore.resetDay();
  const [day] = sent(/^truncate/);
  assert.ok(day && !/referee_setup/.test(day.sql), "the setup is the event's, not the day's");
  assert.ok(!/\bflags\b/.test(day.sql));
});


/* ---- the judge roster and judge conflicts ----------------------------------

   The database itself is not available here, so what is checked is what the
   code sends it: the migration's shape and order (by reading migrate()), and
   every statement the roster methods send, with its parameters, run against
   the recording stand-in for the driver. */

const schemaSql = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const migrateBody = src.slice(
  src.indexOf("async function migrate()"),
  src.indexOf("/** Turn a unique-violation"),
);
const after = (text, needle, from = 0) => {
  const at = text.indexOf(needle, from);
  assert.ok(at >= 0, `missing: ${needle}`);
  return at;
};

test("migrate() creates the judge roster once, copying the old judge lists with names deduped ignoring case", () => {
  const guard = after(migrateBody, "if to_regclass('public.judges') is null then");
  const create = after(migrateBody, "create table judges (", guard);
  const copy = after(migrateBody, "insert into judges (name, panel_id)", create);
  const end = after(migrateBody, "end if;", copy);
  assert.ok(guard < create && create < copy && copy < end, "the copy runs only inside the first-time guard, after the table exists");

  assert.match(
    migrateBody,
    /create table judges \(\s*id\s+uuid primary key default gen_random_uuid\(\),\s*seq\s+bigint generated always as identity,\s*name\s+text not null,\s*note\s+text,\s*panel_id\s+uuid references panels\(id\) on delete set null,\s*created_at timestamptz not null default now\(\)\s*\);/,
  );
  const copySql = migrateBody.slice(copy, end);
  assert.match(copySql, /unnest\(p\.judges\) with ordinality/, "reads the old lists, keeping their order");
  assert.match(copySql, /select distinct on \(lower\(l\.name\)\)/, "one judge per name ignoring case");
  assert.match(copySql, /order by lower\(l\.name\), l\.sort_order, l\.panel_name, l\.ord/, "the first panel in event order keeps the judge");
  assert.match(copySql, /where l\.name <> ''/, "blank entries are skipped");
  assert.match(copySql, /order by d\.sort_order, d\.panel_name, d\.ord;/, "and roster order follows the event's panel order");
  assert.ok(!/update panels|delete from panels|drop column/i.test(migrateBody.slice(guard, end)), "the old lists are left untouched, never emptied");

  assert.ok(migrateBody.includes("create unique index if not exists judges_name_unique on judges (lower(name));"));
  assert.ok(migrateBody.includes("create index if not exists judges_panel_idx on judges (panel_id);"));
  assert.ok(
    after(migrateBody, "create table judges (") < after(migrateBody, "create table if not exists conflicts ("),
    "conflicts references judges, so the roster comes first",
  );
});

test("migrate() locks the judges table down like every other table", () => {
  assert.match(migrateBody, /alter table judges\s+enable row level security;/);
  assert.match(schemaSql, /alter table judges\s+enable row level security;/);
});

test("conflicts: a judge's or a panel's, exactly one; old rows keep their panel; both unique", () => {
  assert.match(
    migrateBody,
    /create table if not exists conflicts \(\s*id\s+uuid primary key default gen_random_uuid\(\),\s*panel_id\s+uuid references panels\(id\) on delete cascade,\s*judge_id\s+uuid references judges\(id\) on delete cascade,\s*team_id\s+uuid not null references teams\(id\) on delete cascade,/,
    "panel_id is nullable now, and a panel's removal still takes only its own whole-panel rows",
  );
  assert.match(migrateBody, /unique \(panel_id, team_id\),\s*constraint conflicts_one_owner check \(\(panel_id is null\) <> \(judge_id is null\)\)/);

  // An already-deployed database is brought up by guarded ALTERs, in an order that can succeed.
  const column = after(migrateBody, "alter table conflicts add column if not exists judge_id uuid references judges(id) on delete cascade;");
  const nullable = after(migrateBody, "alter table conflicts alter column panel_id drop not null;", column);
  const unique = after(migrateBody, "create unique index if not exists conflicts_judge_team_unique on conflicts (judge_id, team_id);", nullable);
  const check = after(migrateBody, "if not exists (select 1 from pg_constraint where conname = 'conflicts_one_owner') then", unique);
  assert.ok(column < nullable && nullable < unique && unique < check);
  assert.match(
    migrateBody.slice(check),
    /^if not exists \(select 1 from pg_constraint where conname = 'conflicts_one_owner'\) then\s*alter table conflicts add constraint conflicts_one_owner\s+check \(\(panel_id is null\) <> \(judge_id is null\)\);\s*end if;/,
  );
  assert.ok(!/delete from conflicts|update conflicts|truncate conflicts/i.test(migrateBody), "no conflict row is touched by the migration");
});

test("supabase/schema.sql agrees with migrate() on the roster and the conflict shape", () => {
  assert.ok(schemaSql.includes("drop table if exists judges    cascade;"));
  assert.match(
    schemaSql,
    /create table judges \(\s*id\s+uuid primary key default gen_random_uuid\(\),\s*seq\s+bigint generated always as identity,\s*name\s+text not null,\s*note\s+text,\s*panel_id\s+uuid references panels\(id\) on delete set null,\s*created_at timestamptz not null default now\(\)\s*\);/,
  );
  assert.ok(schemaSql.includes("create unique index judges_name_unique on judges (lower(name));"));
  assert.match(
    schemaSql,
    /create table conflicts \(\s*id\s+uuid primary key default gen_random_uuid\(\),\s*panel_id\s+uuid references panels\(id\) on delete cascade,\s*judge_id\s+uuid references judges\(id\) on delete cascade,/,
  );
  assert.match(schemaSql, /constraint conflicts_one_owner check \(\(panel_id is null\) <> \(judge_id is null\)\)/);
  assert.ok(schemaSql.includes("create unique index conflicts_judge_team_unique on conflicts (judge_id, team_id);"));
  assert.ok(after(schemaSql, "create table judges (") < after(schemaSql, "create table conflicts ("));
});

const JUDGE_COLUMNS = "id, name, note, panel_id, created_at";
const judgeRow = (over = {}) => ({ id: "j1", name: "Dana Ruiz", note: null, panel_id: null, created_at: new Date("2026-10-20T08:00:00.000Z"), ...over });
const pgError = (code, constraint) => Object.assign(new Error(`pg ${code}`), { code, constraint });

test("the roster reads by named columns in the order judges were added; the ordering key is not part of a judge", async () => {
  calls.length = 0;
  answer = () => [judgeRow()];
  const list = await postgresStore.listJudges();
  assert.equal(sent(/from judges order by seq/)[0].sql, `select ${JUDGE_COLUMNS} from judges order by seq`);
  assert.deepEqual(list, [{ ...judgeRow(), created_at: "2026-10-20T08:00:00.000Z" }]);
});

test("addJudge trims the name, and a taken one is a 409 that names it", async () => {
  calls.length = 0;
  answer = () => [judgeRow()];
  await postgresStore.addJudge({ name: "  Dana Ruiz ", note: "coach" });
  const [insert] = sent(/^insert into judges/);
  assert.equal(insert.sql, `insert into judges (name, note) values ($1, $2) returning ${JUDGE_COLUMNS}`);
  assert.deepEqual(insert.params, ["Dana Ruiz", "coach"]);

  answer = (sql) => {
    if (sql.startsWith("insert into judges")) throw pgError("23505", "judges_name_unique");
    return [];
  };
  await assert.rejects(
    () => postgresStore.addJudge({ name: " dana ruiz " }),
    (e) => e.status === 409 && e.message === "dana ruiz is already on the roster.",
  );

  calls.length = 0;
  await assert.rejects(() => postgresStore.addJudge({ name: "   " }), (e) => e.status === 400);
  assert.equal(sent(/judges/).length, 0, "a blank name never reaches the database");
});

test("updateJudge numbers its parameters after the id, sends a null panel as null, and maps the refusals", async () => {
  calls.length = 0;
  answer = (sql) => (sql.startsWith("update judges") ? [judgeRow({ name: "Dana R." })] : []);
  await postgresStore.updateJudge("j1", { name: " Dana R. ", note: "n", panel_id: null });
  const [update] = sent(/^update judges set/);
  assert.equal(update.sql, `update judges set name = $2, note = $3, panel_id = $4 where id = $1 returning ${JUDGE_COLUMNS}`);
  assert.deepEqual(update.params, ["j1", "Dana R.", "n", null]);

  calls.length = 0;
  answer = (sql) => (sql.startsWith("select") ? [judgeRow()] : []);
  await postgresStore.updateJudge("j1", {});
  assert.equal(sent(/^update/).length, 0, "an empty patch only reads");

  answer = () => [];
  await assert.rejects(() => postgresStore.updateJudge("j1", { note: "x" }), (e) => e.status === 404);

  answer = (sql) => {
    if (sql.startsWith("update judges")) throw pgError("23505", "judges_name_unique");
    return [];
  };
  await assert.rejects(() => postgresStore.updateJudge("j1", { name: "Sam" }), (e) => e.status === 409 && /Sam is already on the roster/.test(e.message));

  answer = (sql) => {
    if (sql.startsWith("update judges")) throw pgError("23503", "judges_panel_id_fkey");
    return [];
  };
  await assert.rejects(() => postgresStore.updateJudge("j1", { panel_id: "gone" }), (e) => e.status === 404 && /panel no longer exists/.test(e.message));
});

test("removeJudge deletes by id and reports whether there was one; their conflicts go by the foreign key", async () => {
  calls.length = 0;
  answer = () => [{ id: "j1" }];
  assert.equal(await postgresStore.removeJudge("j1"), true);
  const [del] = sent(/^delete from judges/);
  assert.equal(del.sql, "delete from judges where id = $1 returning id, panel_id");
  assert.deepEqual(del.params, ["j1"]);
  answer = () => [];
  assert.equal(await postgresStore.removeJudge("j1"), false);
  const method = src.slice(src.indexOf("async removeJudge(id) {"));
  assert.ok(!/conflicts/.test(method.slice(0, method.indexOf("\n  },"))), "removeJudge deletes no conflict by hand: on delete cascade does");
});

test("removing or moving a seated judge rotates the old panel code in the same transaction", async () => {
  calls.length = 0;
  answer = (sql) => {
    if (sql.startsWith("delete from judges")) return [{ id: "j1", panel_id: "p1" }];
    if (sql.startsWith("select code from panels")) return [{ code: "CONF01" }];
    if (sql.startsWith("update panels set code")) return [{ id: "p1" }];
    return [];
  };
  assert.equal(await postgresStore.removeJudge("j1"), true);
  const statements = calls.map((c) => c.sql);
  assert.ok(statements.indexOf("begin") < statements.findIndex((sql) => sql.startsWith("delete from judges")));
  assert.ok(statements.findIndex((sql) => sql.startsWith("delete from judges")) < statements.findIndex((sql) => sql.startsWith("update panels set code")));
  assert.equal(statements.at(-1), "commit");
  assert.equal(sent(/^update panels set code/)[0].params[0], "p1");

  calls.length = 0;
  answer = (sql) => {
    if (sql.startsWith("select panel_id from judges")) return [{ panel_id: "p1" }];
    if (sql.startsWith("update judges")) return [judgeRow({ panel_id: "p2" })];
    if (sql.startsWith("select code from panels")) return [{ code: "CONF01" }];
    if (sql.startsWith("update panels set code")) return [{ id: "p1" }];
    return [];
  };
  await postgresStore.updateJudge("j1", { panel_id: "p2" });
  assert.equal(sent(/^update panels set code/)[0].params[0], "p1");
  assert.equal(calls.at(-1).sql, "commit");

  calls.length = 0;
  answer = (sql) => {
    if (sql.startsWith("delete from judges")) return [{ id: "j1", panel_id: "p1" }];
    if (sql.startsWith("select code from panels")) return [{ code: "CONF01" }];
    if (sql.startsWith("update panels set code")) throw new Error("rotation failed");
    return [];
  };
  await assert.rejects(() => postgresStore.removeJudge("j1"), /rotation failed/);
  assert.equal(calls.at(-1).sql, "rollback", "judge deletion must roll back if revocation fails");
});

test("a conflict is inserted for a judge or for a panel, never both, and the judge's writes no label", async () => {
  calls.length = 0;
  answer = (sql) => (sql.startsWith("insert into conflicts") ? [{ id: "c1" }] : []);
  await postgresStore.addConflict({ judgeId: "j1", teamId: "t1", note: "n", declaredBy: "admin:JA", judgeName: "ignored" });
  const [byJudge] = sent(/^insert into conflicts/);
  assert.equal(
    byJudge.sql,
    "insert into conflicts (judge_id, team_id, note, declared_by) values ($1, $2, $3, $4) on conflict (judge_id, team_id) do update set note = conflicts.note returning *",
  );
  assert.deepEqual(byJudge.params, ["j1", "t1", "n", "admin:JA"]);

  calls.length = 0;
  await postgresStore.addConflict({ panelId: "p1", teamId: "t1", judgeName: "Old", note: null, declaredBy: "admin:JA" });
  const [byPanel] = sent(/^insert into conflicts/);
  assert.match(byPanel.sql, /^insert into conflicts \(panel_id, team_id, judge_name, note, declared_by\) values \(\$1, \$2, \$3, \$4, \$5\) on conflict \(panel_id, team_id\) do update set/);
  assert.deepEqual(byPanel.params, ["p1", "t1", "Old", null, "admin:JA"]);

  calls.length = 0;
  const base = { teamId: "t1", note: null, declaredBy: "admin:JA" };
  await assert.rejects(() => postgresStore.addConflict({ ...base }), (e) => e.status === 400);
  await assert.rejects(() => postgresStore.addConflict({ ...base, panelId: "p1", judgeId: "j1" }), (e) => e.status === 400);
  assert.equal(sent(/conflicts/).length, 0, "the database is never asked");

  answer = () => {
    throw pgError("23503", "conflicts_judge_id_fkey");
  };
  await assert.rejects(() => postgresStore.addConflict({ ...base, judgeId: "gone" }), (e) => e.status === 404);
});

test("every panel read takes its judges from the roster; the legacy column is never read", async () => {
  assert.doesNotMatch(src, /select \* from panels|returning \*[^`"]*panels/, "no panel is read whole, legacy column and all");
  calls.length = 0;
  answer = () => [];
  await postgresStore.listPanels();
  await postgresStore.findPanelByCode("abc");
  const reads = sent(/from panels p/);
  assert.equal(reads.length, 2);
  for (const read of reads) {
    assert.match(read.sql, /array\(select j\.name from judges j where j\.panel_id = p\.id order by j\.seq\) as judges/);
    assert.doesNotMatch(read.sql, /p\.judges|\*/);
  }
});

const newPanel = { name: "Panel B", code: "BRAVO2", division: "Division 1", judges: ["Dana Ruiz", " dana ruiz ", "Sam Okafor", ""], languages: [], sort_order: 2, slot_start_at: null, slot_minutes: 20, slot_count: 0 };
const syncOf = (id, names) => [
  [/^update judges set panel_id = \$1::uuid where lower\(name\) in/, [id, names]],
  [/^insert into judges \(name, panel_id\) select t\.n, \$1::uuid from unnest\(\$2::text\[\]\) with ordinality as t\(n, ord\) where not exists/, [id, names]],
  [/^update judges set panel_id = null where panel_id = \$1::uuid and lower\(name\) not in/, [id, names]],
];

test("createPanel writes no judges column, then makes the roster say who is on the panel, all in one transaction", async () => {
  calls.length = 0;
  answer = (sql) => (sql.startsWith("insert into panels") ? [{ id: "p9" }] : sql.includes("from panels p") ? [{ id: "p9", judges: ["Dana Ruiz", "Sam Okafor"] }] : []);
  const made = await postgresStore.createPanel(newPanel);

  const [insert] = sent(/^insert into panels/);
  assert.doesNotMatch(insert.sql, /judges/);
  assert.equal(insert.params.length, 8);

  const sql = calls.map((c) => c.sql);
  const at = [/^begin$/, /^insert into panels/, ...syncOf("p9", []).map(([re]) => re), /^commit$/].map((re) => sql.findIndex((q) => re.test(q)));
  assert.ok(at.every((i) => i >= 0) && at.every((i, k) => k === 0 || i > at[k - 1]), `statements out of order: ${at}`);
  for (const [re, params] of syncOf("p9", ["Dana Ruiz", "Sam Okafor"])) {
    assert.deepEqual(calls.find((c) => re.test(c.sql)).params, params, "names trimmed, blanks dropped, repeats ignoring case dropped");
  }
  assert.deepEqual(made.judges, ["Dana Ruiz", "Sam Okafor"]);
});

test("a panel code taken twice rolls the whole creation back and says so", async () => {
  calls.length = 0;
  answer = (sql) => {
    if (sql.startsWith("insert into panels")) throw pgError("23505", "panels_code_key");
    return [];
  };
  await assert.rejects(() => postgresStore.createPanel(newPanel), (e) => e.status === 409 && /code is already in use/.test(e.message));
  const sql = calls.map((c) => c.sql);
  assert.ok(sql.includes("rollback") && !sql.includes("commit"));
  assert.ok(!sql.some((q) => /judges/.test(q) && !q.startsWith("insert into panels")), "no judge was touched");
});

test("a judge name taken a moment ago while a panel is saved is not reported as a panel code clash", async () => {
  calls.length = 0;
  answer = (sql) => {
    if (sql.startsWith("insert into panels")) return [{ id: "p9" }];
    if (sql.startsWith("insert into judges")) throw pgError("23505", "judges_name_unique");
    return [];
  };
  await assert.rejects(() => postgresStore.createPanel(newPanel), (e) => e.status === 409 && /judge with that name/.test(e.message));
  assert.ok(calls.some((c) => c.sql === "rollback"), "and the panel is not left half-made");
});

test("updatePanel treats judges as the roster's: no column is updated for them, and a judges-only save sends no UPDATE panels", async () => {
  calls.length = 0;
  answer = (sql) => (sql.includes("from panels p") ? [{ id: "p2", judges: ["Priya Nair"] }] : []);
  const only = await postgresStore.updatePanel("p2", { judges: ["Priya Nair", "priya nair"] });
  assert.equal(sent(/^update panels/).length, 0);
  for (const [re, params] of syncOf("p2", ["Priya Nair"])) assert.deepEqual(calls.find((c) => re.test(c.sql)).params, params);
  assert.deepEqual(only.judges, ["Priya Nair"]);

  calls.length = 0;
  answer = (sql) =>
    sql.startsWith("select division") ? [{ division: "Division 1" }] : sql.startsWith("update panels") ? [{ id: "p2" }] : sql.includes("from panels p") ? [{ id: "p2", judges: [] }] : [];
  await postgresStore.updatePanel("p2", { name: "Panel Two", judges: [] });
  const [update] = sent(/^update panels/);
  assert.equal(update.sql, "update panels set name = $2 where id = $1 returning id");
  assert.deepEqual(update.params, ["p2", "Panel Two"]);
  assert.equal(sent(/^update judges set panel_id = null/).length, 1, "an empty list still clears the panel's judges");

  calls.length = 0;
  await postgresStore.updatePanel("p2", { name: "Panel Three" });
  assert.equal(sent(/judges set/).length, 0, "a save that does not mention judges leaves the roster alone");
});

test("a panel roster edit rotates the shared code if someone leaves", async () => {
  calls.length = 0;
  answer = (sql) => {
    if (sql.startsWith("select name, panel_id from judges")) return [{ name: "Dana", panel_id: "p2" }];
    if (sql.startsWith("select code from panels")) return [{ code: "CONF01" }];
    if (sql.startsWith("update panels set code")) return [{ id: "p2" }];
    if (sql.includes("from panels p")) return [{ id: "p2", code: "CONF01", judges: ["Sam"] }];
    return [];
  };
  await postgresStore.updatePanel("p2", { judges: ["Sam"] });
  assert.equal(sent(/^update panels set code/).length, 1);
  assert.equal(sent(/^update panels set code/)[0].params[0], "p2");
  assert.equal(calls.filter((c) => c.sql === "commit").length, 1);
});

test("updatePanel rolls back its division change when releasing teams fails", async () => {
  calls.length = 0;
  answer = (sql) => {
    if (sql.startsWith("select division, code from panels")) return [{ division: "Elementary School", code: "CONF01" }];
    if (sql.startsWith("select id, division from teams")) return [{ id: "t1", division: "Elementary School" }];
    if (sql.startsWith("update panels")) return [{ id: "p2" }];
    if (sql.startsWith("update teams set panel_id = null")) throw new Error("team update failed");
    return [];
  };
  await assert.rejects(() => postgresStore.updatePanel("p2", { division: "Middle School" }), /team update failed/);
  assert.ok(calls.some((c) => c.sql === "begin"));
  assert.ok(calls.some((c) => c.sql === "rollback"));
  assert.ok(!calls.some((c) => c.sql === "commit"));
});

test("updatePanel refuses a division change with an active request before writing", async () => {
  calls.length = 0;
  answer = (sql) => {
    if (sql.startsWith("select division, code from panels")) return [{ division: "Elementary School", code: "CONF01" }];
    if (sql.startsWith("select id, division from teams")) return [{ id: "t1", division: "Elementary School" }];
    if (sql.startsWith("select 1 from requests")) return [{ exists: 1 }];
    return [];
  };
  await assert.rejects(
    () => postgresStore.updatePanel("p2", { division: "Middle School" }),
    (e) => e.status === 409,
  );
  assert.ok(!calls.some((c) => c.sql.startsWith("update panels")));
  assert.ok(calls.some((c) => c.sql === "rollback"));
});

test("seeding preset panels inserts no judges column, and puts each new panel's preset judges on the roster", async () => {
  const { presetPanels } = await import("../src/lib/presets");
  calls.length = 0;
  answer = (sql) => (sql.startsWith("insert into panels") ? [{ id: "px" }] : []);
  await postgresStore.seedPresetPanels();
  const inserts = sent(/^insert into panels/);
  assert.equal(inserts.length, presetPanels().length);
  assert.ok(inserts.every((i) => !/judges/.test(i.sql) && i.params.length === 8));
  assert.equal(sent(/^insert into judges/).length, presetPanels().length, "one roster sync per new panel");
});

test("auto-assign does not choose the panel a conflicted judge sits on, and does once the judge is off it", async () => {
  const panel = (id) => ({ id, name: id, division: "Division 1", sort_order: 1, languages: [], judges: [], created_at: new Date() });
  const rowsFor = (judgePanel) => (sql) => {
    if (sql.includes("from panels p")) return [panel("pA"), panel("pB")];
    if (sql === "select * from teams") return [{ id: "t1", number: "1001", name: "Hawks", panel_id: null, division: "Division 1", category: "developing", pit: null, created_at: new Date() }];
    if (sql === "select * from conflicts") return [{ id: "c1", panel_id: null, judge_id: "j1", team_id: "t1" }];
    if (sql.startsWith(`select ${JUDGE_COLUMNS} from judges`)) return [judgeRow({ panel_id: judgePanel })];
    return [];
  };
  const assignedTo = () => sent(/^update teams set panel_id = data\.panel_id::uuid/)[0]?.params;

  calls.length = 0;
  answer = rowsFor("pA");
  await postgresStore.autoAssignTeams(10);
  assert.deepEqual(assignedTo(), [["t1"], ["pB"]], "Dana is on Panel A, so the team goes to B");

  calls.length = 0;
  answer = rowsFor(null);
  await postgresStore.autoAssignTeams(10);
  assert.deepEqual(assignedTo(), [["t1"], ["pA"]], "with no panel she blocks nobody");
});

test("a full wipe truncates the roster with the event; a day reset keeps it", async () => {
  answer = () => [];
  calls.length = 0;
  await postgresStore.resetAll();
  assert.match(sent(/^truncate/)[0].sql, /\bjudges\b/);
  calls.length = 0;
  await postgresStore.resetDay();
  assert.ok(!/\bjudges\b|\bconflicts\b/.test(sent(/^truncate/)[0].sql), "the roster and its conflicts are the event's, not the day's");
});

test("a blank name, pit, division or notebook type on a re-import keeps the stored one; a new row still gets the defaults", async () => {
  const { blendedDivisions, defaultCategory, presetDivisions } = await import("../src/lib/presets");
  calls.length = 0;
  answer = () => [];
  await postgresStore.upsertTeams([
    { number: "1001", name: null, pit: null },
    { number: "1002", name: "Given", pit: "B2", division: "High School", category: "ungraded" },
  ]);
  const [upsert] = sent(/insert into teams/);
  assert.match(upsert.sql, /pit = coalesce\(excluded\.pit, teams\.pit\)/, "a null pit leaves the stored one");
  assert.match(upsert.sql, /coalesce\(t\.name, \(select k\.name from teams k where k\.number = t\.number\), 'Team ' \|\| t\.number\)/, "a blank name keeps the stored one; a new team is 'Team <number>'");
  // The proposed row is checked against not null before the conflict, so it carries the stored value, else the default.
  assert.match(upsert.sql, /coalesce\(t\.division, \(select k\.division from teams k where k\.number = t\.number\), \$6::text\)/);
  assert.match(upsert.sql, /coalesce\(t\.category, \(select k\.category from teams k where k\.number = t\.number\), \$7::text\)/);
  assert.match(upsert.sql, /division = excluded\.division,\s*category = excluded\.category/, "so the update writes what the insert carried");
  assert.deepEqual(upsert.params, [
    ["1001", "1002"],
    [null, "Given"],
    [null, "B2"],
    [null, "High School"],
    [null, "ungraded"],
    presetDivisions()[0],
    defaultCategory(),
    blendedDivisions(),
  ]);
  // A division that really changes takes the panel off only when the panel can't judge the new one (divisionsCompatible).
  assert.match(upsert.sql, /when teams\.division is not distinct from excluded\.division then teams\.panel_id/);
  assert.match(upsert.sql, /select 1 from panels p\s+where p\.id = teams\.panel_id\s+and \(p\.division = excluded\.division\s+or excluded\.division = any\(\$8::text\[\]\)\s+or p\.division = any\(\$8::text\[\]\)\)\s+\) then teams\.panel_id\s+else null/);
});

/* ---- Activity: kind, the actor's role, and the team number (no database here either) ---- */

test("migrate() adds the activity kind and role as idempotent nullable columns, and schema.sql creates them", () => {
  assert.ok(migrateBody.includes("alter table activity add column if not exists kind text;"));
  assert.ok(migrateBody.includes("alter table activity add column if not exists actor_role text;"));
  assert.ok(!/alter table activity add column if not exists (kind|actor_role) text not null/.test(migrateBody), "an older row has neither, so both stay nullable");
  assert.match(schemaSql, /create table activity \(\s*id\s+uuid primary key default gen_random_uuid\(\),\s*request_id\s+uuid references requests\(id\) on delete cascade,\s*team_id\s+uuid references teams\(id\) on delete set null,\s*kind\s+text,[^\n]*\n\s*actor\s+text not null,[^\n]*\n\s*actor_role\s+text,/);
});

test("logActivity stores the kind and the actor's role in their own columns", async () => {
  calls.length = 0;
  answer = () => [];
  await postgresStore.logActivity({ teamId: "t1", kind: "referee", actor: "Jordan", actorRole: "Referee", action: "flagged minor", detail: "Team 9882K" });
  const [insert] = sent(/^insert into activity/);
  assert.match(insert.sql, /^insert into activity \(request_id, team_id, kind, actor, actor_role, action, detail\) values \(\$1, \$2, \$3, \$4, \$5, \$6, \$7\)$/);
  assert.deepEqual(insert.params, [null, "t1", "referee", "Jordan", "Referee", "flagged minor", "Team 9882K"]);
});

test("listActivity joins the team's number in one query, and reads an old row (no kind) from its action and actor", async () => {
  const at = new Date("2026-10-20T09:00:00.000Z");
  const row = { id: "a1", request_id: null, team_id: "t1", detail: null, created_at: at, team_number: "9882K" };
  calls.length = 0;
  answer = () => [
    { ...row, kind: "setup", actor: "Alex", actor_role: "Judge Advisor", action: "added a judge" },
    { ...row, id: "a2", team_number: null, team_id: null, kind: null, actor_role: null, actor: "referee:Jordan", action: "flagged minor" },
  ];
  const read = await postgresStore.listActivity(5);

  const selects = sent(/from activity/);
  assert.equal(selects.length, 1, "one query, not one per row");
  assert.match(selects[0].sql, /left join teams t on t\.id = a\.team_id/);
  assert.match(selects[0].sql, /t\.number as team_number/);
  assert.match(selects[0].sql, /order by a\.created_at desc limit \$1$/);
  assert.deepEqual(selects[0].params, [5]);

  assert.deepEqual(read.map((a) => [a.kind, a.actor, a.actor_role, a.team_number, a.created_at]), [
    ["setup", "Alex", "Judge Advisor", "9882K", "2026-10-20T09:00:00.000Z"],
    ["referee", "Jordan", "Referee", null, "2026-10-20T09:00:00.000Z"],
  ]);
});

/* ---- Awards: nominations and winners (no database here either) ----------

   What is checked is what migrate() declares and what the store sends: the
   tables and their keys by reading the source, the statements and parameters
   against the recording stand-in. What this cannot show is that Postgres
   accepts the SQL -- the conformance suite does that under TEST_DATABASE_URL. */

test("migrate() creates nominations, cascading with the team and nulling with the panel", () => {
  assert.match(
    migrateBody,
    /create table if not exists nominations \(\s*id\s+uuid primary key default gen_random_uuid\(\),\s*award_id\s+text not null,\s*team_id\s+uuid not null references teams\(id\) on delete cascade,\s*panel_id\s+uuid references panels\(id\) on delete set null,\s*judge\s+text not null,\s*reason\s+text,\s*created_at timestamptz not null default now\(\),\s*updated_at timestamptz not null default now\(\)\s*\);/,
  );
  assert.ok(migrateBody.includes("create index if not exists nominations_team_idx on nominations (team_id);"));
  assert.ok(
    after(migrateBody, "create table if not exists teams (") < after(migrateBody, "create table if not exists nominations ("),
    "nominations reference teams and panels, so they come after both",
  );
});

test("migrate() keys a nomination on the judge as the roster compares a name, and rebuilds an older database's key", () => {
  // A plain unique constraint on the typed name let "Dana" and "dana" in as two judges.
  assert.ok(!/unique \(award_id, team_id, panel_id, judge\)/.test(migrateBody), "no constraint on the raw name");
  const drop = after(migrateBody, "alter table nominations drop constraint if exists nominations_award_id_team_id_panel_id_judge_key;");
  const dedupe = after(migrateBody, "delete from nominations", drop);
  const index = migrateBody.search(/create unique index if not exists nominations_one_per_judge\s+on nominations \(award_id, team_id, panel_id, lower\(btrim\(judge\)\)\);/);
  assert.ok(index > dedupe, "old constraint out, duplicates out, then the index (which cannot be built over duplicates)");
  assert.ok(after(migrateBody, "create table if not exists nominations (") < drop);

  const cleanup = migrateBody.slice(dedupe, index);
  assert.match(cleanup, /partition by award_id, team_id, panel_id, lower\(btrim\(judge\)\)\s*order by updated_at desc, created_at desc, id/, "keeps the latest of each judge");
  assert.match(cleanup, /where panel_id is not null/, "an orphaned row (no panel) is its own and is left alone");
  assert.match(cleanup, /ranked\.rn > 1/);
});

test("migrate() gives nominations a role and the Judge Advisor's rows an index of their own, after the judges' index, and schema.sql agrees", () => {
  // Added the way every later column is: idempotent, in the block that follows the tables, so an existing database gets it and every row stays a judge's.
  const column = after(migrateBody, "alter table nominations add column if not exists role text not null default 'judge' check (role in ('judge', 'admin'));");
  const admin = migrateBody.search(/create unique index if not exists nominations_one_per_admin\s+on nominations \(award_id, team_id, lower\(btrim\(judge\)\)\) where role = 'admin';/);
  assert.ok(admin > column, "the index needs the column");
  assert.ok(column > after(migrateBody, "create table if not exists nominations ("));
  assert.ok(migrateBody.search(/create unique index if not exists nominations_one_per_judge/) < column, "the judges' index and its cleanup are untouched and run first");
  // The judges' index sees a NULL panel as distinct, which is why the Judge Advisor's rows (no panel) need a partial one of their own, without the panel.
  assert.ok(!/nominations_one_per_admin[^;]*panel_id/.test(migrateBody), "the Judge Advisor's key has no panel in it");
  assert.match(
    schemaSql,
    /create unique index nominations_one_per_admin\s+on nominations \(award_id, team_id, lower\(btrim\(judge\)\)\) where role = 'admin';/,
  );
  assert.match(schemaSql, /create unique index nominations_one_per_judge\s+on nominations \(award_id, team_id, panel_id, lower\(btrim\(judge\)\)\);/, "and the judges' index is as it was");
});

test("migrate() creates award_winners with one row per (award, division), cascading with the team", () => {
  assert.match(
    migrateBody,
    /create table if not exists award_winners \(\s*award_id\s+text not null,\s*division\s+text not null,\s*team_id\s+uuid not null references teams\(id\) on delete cascade,\s*decided_by text not null,\s*decided_at timestamptz not null default now\(\),\s*primary key \(award_id, division\)\s*\);/,
  );
  assert.ok(migrateBody.includes("create index if not exists award_winners_team_idx on award_winners (team_id);"));
});

test("both award tables are locked down like every other, and supabase/schema.sql agrees with migrate()", () => {
  for (const table of ["nominations", "award_winners"]) {
    assert.ok(migrateBody.includes(`alter table ${table} enable row level security;`), `${table}: RLS in migrate()`);
    assert.ok(schemaSql.includes(`alter table ${table} enable row level security;`), `${table}: RLS in schema.sql`);
    assert.ok(schemaSql.includes(`drop table if exists ${table} cascade;`), `${table}: dropped before it is recreated`);
  }
  assert.match(
    schemaSql,
    /create table nominations \(\s*id\s+uuid primary key default gen_random_uuid\(\),\s*award_id\s+text not null,[^\n]*\n\s*team_id\s+uuid not null references teams\(id\) on delete cascade,\s*panel_id\s+uuid references panels\(id\) on delete set null,\s*judge\s+text not null,[^\n]*\n\s*role\s+text not null default 'judge' check \(role in \('judge', 'admin'\)\),\s*reason\s+text,\s*created_at timestamptz not null default now\(\),\s*updated_at timestamptz not null default now\(\)\s*\);/,
  );
  assert.match(
    schemaSql,
    /create table award_winners \(\s*award_id\s+text not null,\s*division\s+text not null,\s*team_id\s+uuid not null references teams\(id\) on delete cascade,\s*decided_by text not null,\s*decided_at timestamptz not null default now\(\),\s*primary key \(award_id, division\)\s*\);/,
  );
  assert.match(
    schemaSql,
    /create unique index nominations_one_per_judge\s+on nominations \(award_id, team_id, panel_id, lower\(btrim\(judge\)\)\);/,
    "schema.sql keys a nomination on the same expression migrate() does",
  );
  assert.ok(!/unique \(award_id, team_id, panel_id, judge\)/.test(schemaSql));
  assert.ok(schemaSql.includes("create index nominations_team_idx on nominations (team_id);"));
  assert.ok(schemaSql.includes("create index award_winners_team_idx on award_winners (team_id);"));
});

const NOMINATION = { id: "n1", award_id: "excellence", team_id: "t1", panel_id: "p1", judge: "Amy", reason: null, created_at: new Date("2026-10-24T08:00:00.000Z"), updated_at: new Date("2026-10-24T08:00:00.000Z") };

test("nominate is one upsert on the full non-null key, the judge as lower(btrim(name)): no reason keeps the stored one, a reason (or null) sets it", async () => {
  calls.length = 0;
  answer = () => [NOMINATION];
  const made = await postgresStore.nominate({ awardId: "excellence", teamId: "t1", panelId: "p1", judge: "Amy" });
  const [upsert] = sent(/^insert into nominations/);
  assert.match(
    upsert.sql,
    /^insert into nominations \(award_id, team_id, panel_id, judge, reason\) values \(\$1, \$2, \$3, \$4, \$5\) on conflict \(award_id, team_id, panel_id, lower\(btrim\(judge\)\)\) do update set reason = case when \$6::boolean then excluded\.reason else nominations\.reason end, updated_at = case when \$6::boolean and excluded\.reason is distinct from nominations\.reason then now\(\) else nominations\.updated_at end returning \*$/,
  );
  assert.deepEqual(upsert.params, ["excellence", "t1", "p1", "Amy", null, false], "no reason given: $6 says leave the stored one");
  assert.deepEqual(made, { ...NOMINATION, created_at: "2026-10-24T08:00:00.000Z", updated_at: "2026-10-24T08:00:00.000Z" });
  assert.equal(sent(/for update/).length, 0, "one statement, so there is nothing to lock");

  calls.length = 0;
  await postgresStore.nominate({ awardId: "excellence", teamId: "t1", panelId: "p1", judge: "Amy", reason: "Lovely notebook" });
  assert.deepEqual(sent(/^insert into nominations/)[0].params, ["excellence", "t1", "p1", "Amy", "Lovely notebook", true]);

  calls.length = 0;
  await postgresStore.nominate({ awardId: "excellence", teamId: "t1", panelId: "p1", judge: "Amy", reason: null });
  assert.deepEqual(sent(/^insert into nominations/)[0].params, ["excellence", "t1", "p1", "Amy", null, true], "null clears it, which is not the same as leaving it out");
});

test("the Judge Advisor's nomination is one upsert on the partial index, with no panel and role 'admin': no reason keeps the stored one, a reason (or null) sets it", async () => {
  calls.length = 0;
  answer = () => [{ ...NOMINATION, panel_id: null, judge: "Alex", role: "admin" }];
  const made = await postgresStore.nominateAsAdmin({ awardId: "excellence", teamId: "t1", judge: "Alex" });
  const [upsert] = sent(/^insert into nominations/);
  assert.equal(
    upsert.sql.replace(/\s+/g, " "),
    "insert into nominations (award_id, team_id, panel_id, judge, role, reason) values ($1, $2, null, $3, 'admin', $4) on conflict (award_id, team_id, lower(btrim(judge))) where role = 'admin' do update set reason = case when $5::boolean then excluded.reason else nominations.reason end, updated_at = case when $5::boolean and excluded.reason is distinct from nominations.reason then now() else nominations.updated_at end returning *",
    "the conflict is the partial index's own expression and predicate, so Postgres can infer it",
  );
  assert.deepEqual(upsert.params, ["excellence", "t1", "Alex", null, false], "no reason given: $5 says leave the stored one");
  assert.equal(made.role, "admin");
  assert.equal(made.panel_id, null);
  assert.equal(sent(/for update/).length, 0, "one statement, so there is nothing to lock");

  calls.length = 0;
  await postgresStore.nominateAsAdmin({ awardId: "excellence", teamId: "t1", judge: "Alex", reason: "Worth a look" });
  assert.deepEqual(sent(/^insert into nominations/)[0].params, ["excellence", "t1", "Alex", "Worth a look", true]);
  calls.length = 0;
  await postgresStore.nominateAsAdmin({ awardId: "excellence", teamId: "t1", judge: "Alex", reason: null });
  assert.deepEqual(sent(/^insert into nominations/)[0].params, ["excellence", "t1", "Alex", null, true], "null clears it, which is not the same as leaving it out");

  // The judges' upsert is not the Judge Advisor's: it still names the panel and writes no role (the column's default is 'judge').
  calls.length = 0;
  answer = () => [NOMINATION];
  await postgresStore.nominate({ awardId: "excellence", teamId: "t1", panelId: "p1", judge: "Amy" });
  assert.doesNotMatch(sent(/^insert into nominations/)[0].sql, /role|admin/);
});

test("the Judge Advisor's nomination of a vanished team is a 404, and any other error goes through", async () => {
  const input = { awardId: "excellence", teamId: "t1", judge: "Alex" };
  answer = () => {
    throw pgError("23503", "nominations_team_id_fkey");
  };
  await assert.rejects(() => postgresStore.nominateAsAdmin(input), (e) => e.status === 404 && /team no longer exists/.test(e.message));
  answer = () => {
    throw pgError("40001");
  };
  await assert.rejects(() => postgresStore.nominateAsAdmin(input), (e) => e.code === "40001");
});

test("removing a nomination deletes by id alone, whoever made it, and says whether anything went", async () => {
  calls.length = 0;
  answer = () => [{ id: "n1" }];
  assert.equal(await postgresStore.removeNomination("n1"), true);
  const [del] = sent(/^delete from nominations/);
  assert.equal(del.sql, "delete from nominations where id = $1 returning id", "no role and no panel in it: a judge's row or the Judge Advisor's");
  assert.deepEqual(del.params, ["n1"]);
  answer = () => [];
  assert.equal(await postgresStore.removeNomination("n1"), false);
});

test("nominate turns a vanished team or panel into a 404, and lets any other error through", async () => {
  const input = { awardId: "excellence", teamId: "t1", panelId: "p1", judge: "Amy" };
  const failWith = (code, constraint) => () => {
    throw pgError(code, constraint);
  };

  answer = failWith("23503", "nominations_team_id_fkey");
  await assert.rejects(() => postgresStore.nominate(input), (e) => e.status === 404 && /team no longer exists/.test(e.message));
  answer = failWith("23503", "nominations_panel_id_fkey");
  await assert.rejects(() => postgresStore.nominate(input), (e) => e.status === 404 && /panel no longer exists/.test(e.message));
  answer = failWith("40001");
  await assert.rejects(() => postgresStore.nominate(input), (e) => e.code === "40001");
});

test("withdrawing deletes by the whole key, the judge as lower(btrim(name)), and says whether anything went", async () => {
  calls.length = 0;
  answer = () => [{ id: "n1" }];
  assert.equal(await postgresStore.withdrawNomination({ awardId: "excellence", teamId: "t1", panelId: "p1", judge: "Amy" }), true);
  const [del] = sent(/^delete from nominations/);
  assert.equal(
    del.sql.replace(/\s+/g, " "),
    "delete from nominations where award_id = $1 and team_id = $2 and panel_id = $3 and lower(btrim(judge)) = lower(btrim($4)) returning id",
    "the same expression as the unique index, so a variant spelling withdraws the row it would have updated",
  );
  assert.deepEqual(del.params, ["excellence", "t1", "p1", "Amy"]);

  answer = () => [];
  assert.equal(await postgresStore.withdrawNomination({ awardId: "excellence", teamId: "t1", panelId: "p1", judge: "Amy" }), false);
});

test("nominations and winners are read whole, oldest first", async () => {
  calls.length = 0;
  answer = () => [NOMINATION];
  await postgresStore.listNominations();
  assert.equal(sent(/from nominations/)[0].sql, "select * from nominations order by created_at, id");

  const decided = new Date("2026-10-24T09:00:00.000Z");
  answer = () => [{ award_id: "design", division: "Middle School", team_id: "t1", decided_by: "Alex", decided_at: decided }];
  const winners = await postgresStore.listWinners();
  assert.equal(sent(/from award_winners/)[0].sql, "select * from award_winners order by decided_at, award_id, division");
  assert.equal(winners[0].decided_at, "2026-10-24T09:00:00.000Z");
});

test("setWinner upserts on (award, division) so a replacement takes the place; clearWinner deletes by the same key", async () => {
  calls.length = 0;
  answer = () => [{ award_id: "design", division: "Middle School", team_id: "t2", decided_by: "Alex", decided_at: new Date("2026-10-24T09:00:00.000Z") }];
  await postgresStore.setWinner({ awardId: "design", division: "Middle School", teamId: "t2", decidedBy: "Alex" });
  const [upsert] = sent(/^insert into award_winners/);
  assert.match(
    upsert.sql,
    /^insert into award_winners \(award_id, division, team_id, decided_by\) values \(\$1, \$2, \$3, \$4\) on conflict \(award_id, division\) do update set team_id = excluded\.team_id, decided_by = excluded\.decided_by, decided_at = now\(\) returning \*$/,
  );
  assert.deepEqual(upsert.params, ["design", "Middle School", "t2", "Alex"]);

  answer = () => {
    throw pgError("23503", "award_winners_team_id_fkey");
  };
  await assert.rejects(() => postgresStore.setWinner({ awardId: "design", division: "Middle School", teamId: "t2", decidedBy: "Alex" }), (e) => e.status === 404);

  calls.length = 0;
  answer = () => [{ award_id: "design" }];
  assert.equal(await postgresStore.clearWinner("design", "Middle School"), true);
  const [del] = sent(/^delete from award_winners/);
  assert.equal(del.sql, "delete from award_winners where award_id = $1 and division = $2 returning award_id");
  assert.deepEqual(del.params, ["design", "Middle School"]);
  answer = () => [];
  assert.equal(await postgresStore.clearWinner("design", "Middle School"), false);
});

test("a day reset names the nominations and winners (and still spares flags and the setup); a full wipe reaches them through teams", async () => {
  answer = () => [];
  calls.length = 0;
  await postgresStore.resetDay();
  const [day] = sent(/^truncate/);
  assert.match(day.sql, /\bnominations\b/);
  assert.match(day.sql, /\baward_winners\b/);
  assert.ok(!/\bflags\b|referee_setup/.test(day.sql));

  // Both tables reference teams, so truncating teams with cascade empties them.
  calls.length = 0;
  await postgresStore.resetAll();
  const [wipe] = sent(/^truncate/);
  assert.match(wipe.sql, /\bteams\b/);
  assert.ok(wipe.sql.endsWith("cascade"));
  assert.match(migrateBody, /nominations \(\s*id\s+uuid primary key default gen_random_uuid\(\),\s*award_id\s+text not null,\s*team_id\s+uuid not null references teams\(id\)/);
});
