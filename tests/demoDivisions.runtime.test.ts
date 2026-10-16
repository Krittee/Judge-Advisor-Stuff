import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * A fresh file store seeds demo panels and teams (BUG-030). Their divisions
 * must be ones the event config really lists, or the demo hides errors that
 * a real event would hit.
 *
 * DATA_FILE is named before the store is imported, and the file does not
 * exist yet, so this process gets the demo seed.
 */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-demo-divisions-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "true";

test("demo panels and teams use the first two divisions from config/event.json", async () => {
  const { fileStore } = await import("../src/lib/db/file");
  const { presetDivisions } = await import("../src/lib/presets");
  const divisions = presetDivisions();
  assert.ok(divisions.length >= 2, "the event config lists at least two divisions");

  const panels = await fileStore.listPanels();
  assert.deepEqual(
    panels.map((p) => p.division),
    [divisions[0], divisions[0], divisions[1]],
    "the demo panels take the configured divisions, not invented names",
  );

  const teams = await fileStore.listTeams();
  assert.ok(teams.length > 0, "the demo seeds teams");
  for (const team of teams) {
    assert.ok(divisions.includes(team.division), `${team.number} is in a configured division`);
  }
});
