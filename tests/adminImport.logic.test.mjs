import assert from "node:assert/strict";
import test from "node:test";

import {
  importDisabled,
  importSummary,
  loadedLine,
  runImport,
  skippedEntry,
  skippedHeading,
} from "../src/components/admin/importLogic";

/* The Judge Advisor Import tab's decisions, run for real against
   src/components/admin/importLogic.ts. How they are drawn is in
   adminImport.runtime.test.tsx; what the server answers is in
   adminImport.route.runtime.test.ts. */

const reply = (over = {}) => ({ imported: 46, created: 12, updated: 34, assigned: 9, skipped: 2, skippedLines: [], ...over });

test("Import is off for an empty or blank box and while a request is out", () => {
  assert.equal(importDisabled("", false), true);
  assert.equal(importDisabled("  \n\t \n", false), true, "whitespace is an empty box");
  assert.equal(importDisabled("1234, Iron Hawks", false), false);
  assert.equal(importDisabled("1234, Iron Hawks", true), true, "busy");
});

test("Import sends the box and the two options, and hands back the reply with whether spreading was on", async () => {
  const sent = [];
  const answer = reply();
  const call = async (url, options) => {
    sent.push([url, options]);
    return answer;
  };
  const draft = { text: "1234, Iron Hawks", autoAssign: false, perPanel: 12 };
  const outcome = await runImport(call, draft);
  assert.deepEqual(sent, [["/api/admin/teams", { body: draft }]], "a POST (the default) with exactly the box and the options");
  assert.equal(outcome.reply, answer);
  assert.equal(outcome.autoAssign, false);
});

test("the server's refusal is thrown as it came, not swallowed", async () => {
  const call = async () => {
    throw new Error("Add at least one judge panel first.");
  };
  await assert.rejects(runImport(call, { text: "1", autoAssign: true, perPanel: 10 }), /Add at least one judge panel first\./);
});

test("the success line: 'Imported 46 teams, 12 new · 34 updated · assigned 9 to panels.'", () => {
  const { head, rest } = importSummary({ reply: reply(), autoAssign: true });
  assert.equal(head, "46 teams");
  assert.equal(`Imported ${head}${rest}`, "Imported 46 teams, 12 new · 34 updated · assigned 9 to panels.");
});

test("'assigned' is there only when spreading was on, even for none, and never when it was off", () => {
  const line = (r, autoAssign) => {
    const { head, rest } = importSummary({ reply: r, autoAssign });
    return `Imported ${head}${rest}`;
  };
  assert.equal(line(reply(), false), "Imported 46 teams, 12 new · 34 updated.");
  assert.equal(line(reply({ assigned: 0 }), true), "Imported 46 teams, 12 new · 34 updated · assigned 0 to panels.");
  assert.equal(line(reply({ assigned: 9 }), false), "Imported 46 teams, 12 new · 34 updated.", "a reply that carries a count is still not shown when it was off");
});

test("one team is 'team', and a list with nothing new says '0 new'", () => {
  const { head, rest } = importSummary({ reply: reply({ imported: 1, created: 0, updated: 1 }), autoAssign: false });
  assert.equal(`Imported ${head}${rest}`, "Imported 1 team, 0 new · 1 updated.");
});

test("the skipped box: '2 lines skipped' and one 'Line 17 · no team number' per line", () => {
  const lines = [
    { line: 17, text: ", Nameless", reason: "no team number" },
    { line: 41, text: "99.9, x", reason: "team number has characters other than A–Z, 0–9 and -" },
  ];
  assert.equal(skippedHeading(lines), "2 lines skipped");
  assert.equal(skippedHeading(lines.slice(0, 1)), "1 line skipped");
  assert.deepEqual(lines.map(skippedEntry), ["Line 17 · no team number", "Line 41 · team number has characters other than A–Z, 0–9 and -"]);
});

test("the info line after a file loads: 'Loaded teams.xlsx · 48 rows'", () => {
  assert.equal(loadedLine("teams.xlsx", 48), "Loaded teams.xlsx · 48 rows");
  assert.equal(loadedLine("one.csv", 1), "Loaded one.csv · 1 row");
  assert.equal(loadedLine("empty.csv", 0), "Loaded empty.csv · 0 rows");
});
