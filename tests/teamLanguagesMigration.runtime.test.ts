import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/**
 * A state file written before team languages existed must still load, with
 * every team's languages as "not stated yet". The data file is named before
 * the store is imported because file.ts resolves DATA_FILE once, at load.
 */
const dir = join(tmpdir(), `judge-queue-team-languages-${process.pid}-${Date.now()}`);
mkdirSync(dir, { recursive: true });
const file = join(dir, "state.json");
process.env.DATA_FILE = file;
process.env.SEED_DEMO = "false";

writeFileSync(
  file,
  JSON.stringify({
    panels: [],
    teams: [
      { id: "00000000-0000-4000-8000-000000000001", number: "1852B", name: "Old team", pit: null, division: "Elementary School", category: "developing", panel_id: null },
      { id: "00000000-0000-4000-8000-000000000002", number: "9882K", name: "Newer team", pit: null, division: "Elementary School", category: "developing", panel_id: null, languages: ["th"] },
    ],
    requests: [],
    notes: [],
    scores: [],
    conflicts: [],
    flags: [],
    activity: [],
  }),
);

test("a team stored without languages loads with an empty list, and one with languages keeps them", async () => {
  const { fileStore } = await import("../src/lib/db/file");
  const teams = await fileStore.listTeams();
  assert.deepEqual(teams.find((t) => t.number === "1852B")?.languages, []);
  assert.deepEqual(teams.find((t) => t.number === "9882K")?.languages, ["th"]);
});
