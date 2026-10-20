import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import * as conflicts from "../src/lib/conflicts";
import { allowedPanels } from "../src/components/admin/floorLogic";
import {
  blockedAndHeld,
  blockedTeams,
  conflictsFor,
  isPanelBlocked,
  judgeKey,
  panelBlocks,
} from "../src/lib/roster";
import type { ConflictRow, JudgeRow, PublicPanel, RequestRow, Team } from "../src/lib/types";

/* The one rule for "may this panel meet this team?", run for real against
   src/lib/roster.ts (re-exported from src/lib/conflicts.ts). */

const judge = (id: string, panel_id: string | null): JudgeRow => ({
  id,
  name: `Judge ${id}`,
  note: null,
  panel_id,
  created_at: "2026-10-20T08:00:00.000Z",
});

const byJudge = (id: string, judge_id: string, team_id: string): ConflictRow => ({
  id,
  panel_id: null,
  judge_id,
  team_id,
  judge_name: null,
  note: null,
  declared_by: "admin:Alex",
  created_at: "2026-10-20T08:00:00.000Z",
});

const byPanel = (id: string, panel_id: string, team_id: string): ConflictRow => ({
  id,
  panel_id,
  judge_id: null,
  team_id,
  judge_name: "Priya Nair",
  note: null,
  declared_by: "admin:Alex",
  created_at: "2026-10-20T08:00:00.000Z",
});

test("a judge's conflict blocks the panel the judge is on", () => {
  assert.deepEqual(panelBlocks([byJudge("c1", "j1", "t1")], [judge("j1", "p2")]), [
    { panel_id: "p2", team_id: "t1", conflict_id: "c1" },
  ]);
});

test("a judge with no panel blocks nobody yet", () => {
  assert.deepEqual(panelBlocks([byJudge("c1", "j1", "t1")], [judge("j1", null)]), []);
});

test("move the judge and the block follows", () => {
  const c = [byJudge("c1", "j1", "t1")];
  assert.ok(isPanelBlocked(panelBlocks(c, [judge("j1", "p2")]), "p2", "t1"));

  const moved = panelBlocks(c, [judge("j1", "p3")]);
  assert.ok(!isPanelBlocked(moved, "p2", "t1"), "Panel 2 is free of it once the judge leaves");
  assert.ok(isPanelBlocked(moved, "p3", "t1"), "and Panel 3 has it");
});

test("a conflict naming a judge who is not on the roster blocks nothing", () => {
  assert.deepEqual(panelBlocks([byJudge("c1", "gone", "t1")], [judge("j1", "p2")]), []);
});

test("an older whole-panel conflict blocks its panel whatever the roster says", () => {
  assert.deepEqual(panelBlocks([byPanel("c1", "p1", "t1")], []), [
    { panel_id: "p1", team_id: "t1", conflict_id: "c1" },
  ]);
});

test("any judge on the panel is enough, and the answer is per (panel, team)", () => {
  const blocks = panelBlocks(
    [byJudge("c1", "j1", "t1"), byJudge("c2", "j2", "t2"), byPanel("c3", "p1", "t3")],
    [judge("j1", "p2"), judge("j2", "p2")],
  );
  assert.deepEqual([...blockedTeams(blocks, "p2")].sort(), ["t1", "t2"]);
  assert.deepEqual([...blockedTeams(blocks, "p1")], ["t3"]);
  assert.ok(!isPanelBlocked(blocks, "p2", "t3"));
  assert.ok(!isPanelBlocked(blocks, "p3", "t1"));
});

test("conflictsFor gives a panel only the rows behind its own blocks", () => {
  const rows = [byJudge("c1", "j1", "t1"), byJudge("c2", "j2", "t2"), byPanel("c3", "p1", "t3")];
  const blocks = panelBlocks(rows, [judge("j1", "p2"), judge("j2", "p3")]);
  assert.deepEqual(conflictsFor("p2", rows, blocks).map((c) => c.id), ["c1"]);
  assert.deepEqual(conflictsFor("p1", rows, blocks).map((c) => c.id), ["c3"]);
  assert.deepEqual(conflictsFor("p9", rows, blocks), []);
});

test("rows from before the roster, with no judge_id at all, still read as whole-panel conflicts", () => {
  const legacy = [{ id: "c1", panel_id: "p1", team_id: "t1" }] as unknown as ConflictRow[];
  assert.ok(isPanelBlocked(panelBlocks(legacy, []), "p1", "t1"));
});

test("names are compared trimmed and ignoring case", () => {
  assert.equal(judgeKey("  Priya NAIR "), judgeKey("priya nair"));
  assert.notEqual(judgeKey("Priya Nair"), judgeKey("Priya Nayar"));
});

/* ---- the teams a panel must give up ---------------------------------------- */

const team = (id: string, panel_id: string | null): Team => ({
  id,
  number: id.toUpperCase(),
  name: id,
  panel_id,
  division: "Middle School",
  category: "developing",
  pit: null,
  created_at: "2026-10-20T08:00:00.000Z",
});
const req = (team_id: string, panel_id: string | null, status: RequestRow["status"]) =>
  ({ team_id, panel_id, status }) as RequestRow;

test("a panel gives up the blocked teams it holds: assigned, or in flight on it", () => {
  const blocks = panelBlocks(
    [byJudge("c1", "j1", "t1"), byJudge("c2", "j1", "t2"), byJudge("c3", "j1", "t3"), byJudge("c4", "j1", "t4")],
    [judge("j1", "p2")],
  );
  const teams = [team("t1", "p2"), team("t2", null), team("t3", null), team("t4", "p3"), team("t5", "p2")];
  const requests = [
    req("t2", "p2", "requested"), // waiting on Panel 2
    req("t3", "p2", "completed"), // finished: history, not held
    req("t4", "p3", "interviewing"), // on another panel
  ];
  assert.deepEqual(
    blockedAndHeld("p2", blocks, teams, requests).map((t) => t.id),
    ["t1", "t2"],
    "t5 is held but not blocked; t3's interview is over; t4 is someone else's",
  );
  assert.deepEqual(blockedAndHeld("p2", blocks, teams, [req("t3", "p2", "scheduled")]).map((t) => t.id), ["t1", "t3"], "a booking counts");
});

/* ---- every check goes through it ------------------------------------------ */

test("conflicts.ts hands server code the same rule", () => {
  assert.equal(conflicts.panelBlocks, panelBlocks);
  assert.equal(conflicts.isPanelBlocked, isPanelBlocked);
  assert.equal(conflicts.blockedTeams, blockedTeams);
});

const panels = (["p1", "p2", "p3"] as const).map(
  (id) => ({ id, name: id, division: "Middle School", languages: [], judges: [] }) as unknown as PublicPanel,
);

test("the Floor's Move to panel list uses the rule: a judge's conflict removes the panel the judge is on", () => {
  const t = { id: "t1", division: "Middle School" };
  const c = [byJudge("c1", "j1", "t1")];
  assert.deepEqual(allowedPanels(t, "p1", panels, c, [judge("j1", "p2")]).map((p) => p.id), ["p1", "p3"]);
  assert.deepEqual(allowedPanels(t, "p1", panels, c, [judge("j1", "p3")]).map((p) => p.id), ["p1", "p2"], "moved to Panel 3");
  assert.deepEqual(allowedPanels(t, "p1", panels, c, [judge("j1", null)]).map((p) => p.id), ["p1", "p2", "p3"], "no panel, no block");
  assert.deepEqual(allowedPanels(t, "p2", panels, c, [judge("j1", "p2")]).map((p) => p.id), ["p1", "p2", "p3"], "never drops the current panel, even a blocked one");
});

/* The rule must live once. Anything under src reading a conflict's panel_id
   has gone round it, and will go on agreeing with the roster only until the
   next change to the model. The rule itself and the file store's own row
   bookkeeping are the only readers. */
test("no other file reads panel_id off a conflict", () => {
  const allowed = new Set(["src/lib/roster.ts", "src/lib/db/file.ts"]);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry) && !allowed.has(path)) {
        const text = readFileSync(path, "utf8");
        if (/\bc\.panel_id\b|conflicts?\.(?:some|find)\([^)]*panel_id/.test(text)) offenders.push(path);
      }
    }
  };
  walk("src");
  assert.deepEqual(offenders, [], "these read a conflict's panel_id directly instead of going through panelBlocks");
});
