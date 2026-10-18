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
let answer = () => [];

class FakePool {
  on() {}
  async query(sql, params) {
    calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
    return { rows: answer(sql.replace(/\s+/g, " ").trim(), params) };
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

/* ---- the referee setup and the alliance (no database here either) ----------

   Nothing below runs against Postgres. The recording stand-in shows the
   statements and parameters the store sends -- the placeholders line up with
   their values, the alliance goes in the column it is named for -- and the
   source checks show migrate() and supabase/schema.sql agree. What they
   cannot show is that Postgres accepts the SQL. */

const sent = (match) => calls.filter((c) => match.test(c.sql));

test("migrate() creates the single-row referee_setup table, locks it down, and adds flags.alliance", () => {
  const body = src.slice(src.indexOf("async function migrate()"));
  assert.match(
    body,
    /create table if not exists referee_setup \(\s*id\s+int primary key default 1 check \(id = 1\),\s*ruleset\s+text not null,\s*field_count int not null check \(field_count between 1 and 20\),\s*set_by\s+text not null,\s*set_on\s+text not null,\s*updated_at\s+timestamptz not null default now\(\)\s*\);/,
  );
  assert.ok(body.includes("alter table referee_setup enable row level security;"), "RLS must cover the new table");
  assert.ok(body.includes("alter table flags add column if not exists alliance text check (alliance in ('red','blue'));"));
  /* The alter is additive and sits inside the guarded block, after the table it alters exists. */
  assert.ok(body.indexOf("create table if not exists flags") < body.indexOf("add column if not exists alliance"));

  const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  assert.match(schema, /create table referee_setup \(\s*id\s+int primary key default 1 check \(id = 1\),/);
  assert.match(schema, /field_count int not null check \(field_count between 1 and 20\)/);
  assert.ok(schema.includes("alter table referee_setup enable row level security;"));
  assert.ok(schema.includes("drop table if exists referee_setup cascade;"));
});

test("createFlag and updateFlag send the alliance in the column it is named for", async () => {
  const flag = {
    teamId: "t1",
    kind: "minor",
    body: "",
    author: "Dana",
    matchType: "QF",
    matchNumber: "2-1",
    alliance: "blue",
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
    /\(team_id, kind, body, author, match_type, match_number, field, rule, ruleset, manual_version, match_affecting, alliance\) values \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12\)/,
  );
  assert.deepEqual(insert.params, ["t1", "minor", "", "Dana", "QF", "2-1", "2", "GG17", "v5rc", "2.1", true, "blue"]);

  calls.length = 0;
  await postgresStore.createFlag({ ...flag, matchType: "SKD", matchNumber: "1", alliance: null });
  assert.equal(sent(/^insert into flags/)[0].params[11], null, "a Skills run stores a null alliance");

  calls.length = 0;
  await postgresStore.updateFlag("f1", { ...flag, alliance: "red" });
  const [update] = sent(/^update flags/);
  assert.match(update.sql, /match_affecting = \$10, alliance = \$11 where id = \$1 returning \*$/);
  assert.equal(update.params[10], "red");
  assert.equal(update.params.length, 11);
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
