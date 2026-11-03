import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { languageFit } from "../src/lib/presets";
import { planAssignments, type PanelBlock } from "../src/lib/roster";

/* Auto-assign prefers a panel that speaks the team's language. It is a
   preference only: the walls (division, conflicts, perPanel) are unchanged
   and a team is never left unassigned over language. */

const D = "Elementary School";
const panel = (id: string, languages: string[], division = D) => ({ id, division, languages });
const team = (id: string, languages: string[], division = D) => ({ id, division, languages });
const plan = (
  teams: ReturnType<typeof team>[],
  panels: ReturnType<typeof panel>[],
  perPanel: number,
  blocks: PanelBlock[] = [],
  load = new Map<string, number>(panels.map((p) => [p.id, 0])),
) => Object.fromEntries(planAssignments(teams, panels, load, perPanel, blocks).map((a) => [a.teamId, a.panelId]));

test("languageFit: match, unstated, mismatch", () => {
  assert.equal(languageFit({ languages: ["en"] }, { languages: ["en"] }), "match");
  assert.equal(languageFit({ languages: ["en"] }, { languages: ["en", "th"] }), "match");
  assert.equal(languageFit({ languages: ["th"] }, { languages: ["en"] }), "mismatch");
  assert.equal(languageFit({ languages: ["en", "th"] }, { languages: ["en"] }), "match");
  assert.equal(languageFit({ languages: ["en", "th"] }, { languages: ["th"] }), "match");
  assert.equal(languageFit({ languages: [] }, { languages: ["en"] }), "unstated");
  assert.equal(languageFit({ languages: ["en"] }, { languages: [] }), "unstated");
  assert.equal(languageFit({ languages: [] }, { languages: [] }), "unstated");
});

test("no languages anywhere: the old emptiest-first deal", () => {
  const panels = [panel("A", []), panel("B", [])];
  const got = plan([team("1", []), team("2", []), team("3", []), team("4", [])], panels, 2);
  assert.deepEqual(got, { 1: "A", 2: "B", 3: "A", 4: "B" });
  // An existing load tips the first pick, and a full panel is skipped.
  const loaded = plan([team("1", []), team("2", [])], panels, 2, [], new Map([["A", 2], ["B", 0]]));
  assert.deepEqual(loaded, { 1: "B", 2: "B" });
});

test("a Thai-only team is not crowded out of the one Thai panel", () => {
  const panels = [panel("EN", ["en"]), panel("ENTH", ["en", "th"])];
  // The Thai team is last in line, behind three English teams.
  const got = plan([team("e1", ["en"]), team("e2", ["en"]), team("e3", ["en"]), team("t1", ["th"])], panels, 2);
  assert.equal(got.t1, "ENTH");
  assert.equal(Object.keys(got).length, 4, "everyone is placed");
});

test("a Thai team still gets an English panel when the Thai one is full", () => {
  const panels = [panel("EN", ["en"]), panel("TH", ["th"])];
  const got = plan([team("t1", ["th"])], panels, 2, [], new Map([["EN", 0], ["TH", 2]]));
  assert.deepEqual(got, { t1: "EN" });
});

test("matched panels beat unstated ones, which beat mismatches", () => {
  const panels = [panel("X", ["en"]), panel("U", []), panel("T", ["th"])];
  assert.equal(plan([team("t", ["th"])], panels, 5).t, "T");
  assert.equal(plan([team("t", ["th"])], panels.slice(0, 2), 5).t, "U");
});

test("the division wall and conflicts win over language", () => {
  const MS = "Middle School";
  const panels = [panel("TH-MS", ["th"], MS), panel("TH", ["th"]), panel("EN", ["en"])];
  // The Thai panel in the wrong division is never a candidate.
  assert.equal(plan([team("t", ["th"])], panels.slice(0, 1).concat(panels[2]), 5).t, "EN");
  // A conflict keeps the team off the Thai panel too.
  const blocks = [{ panel_id: "TH", team_id: "t", conflict_id: "c" }];
  assert.equal(plan([team("t", ["th"])], panels.slice(1), 5, blocks).t, "EN");
});

test("autoAssignTeams in the file store uses the language preference", async () => {
  process.env.DATA_FILE = join(tmpdir(), `judge-queue-lang-${process.pid}-${Date.now()}.json`);
  process.env.SEED_DEMO = "false";
  const { fileStore } = await import("../src/lib/db/file");
  await fileStore.resetAll();

  const make = (code: string, languages: string[]) =>
    fileStore.createPanel({
      name: code, code, division: D, judges: [], languages,
      sort_order: 1, slot_start_at: null, slot_minutes: 20, slot_count: 0,
    });
  const en = await make("LANGEN", ["en"]);
  const enth = await make("LANGTH", ["en", "th"]);
  await fileStore.upsertTeams(
    ["1001", "1002", "1003", "1004"].map((number, i) => ({
      number, name: `T${number}`, pit: null, division: D, category: "developing",
      languages: i === 3 ? ["th"] : ["en"],
    })),
  );

  assert.equal(await fileStore.autoAssignTeams(2), 4);
  const teams = await fileStore.listTeams();
  assert.equal(teams.find((t) => t.number === "1004")?.panel_id, enth.id, "the Thai team lands on the EN+TH panel");
  assert.equal(teams.filter((t) => t.panel_id === en.id).length, 2);
});
