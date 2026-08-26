import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

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
  let m;
  while ((m = re.exec(source))) {
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
