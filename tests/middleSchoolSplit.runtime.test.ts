import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ADMIN, MARKETING, hit, world } from "./routeHarness";

/* "Middle School" used to be ONE division shared by VEX IQ and V5RC, so an IQ award also showed under
   the V5RC tab. They are two divisions now, and a plain "Middle School" typed on an import or a panel
   follows the saved program (and is refused as ambiguous when none is saved). */
process.env.DATA_FILE = join(tmpdir(), `judge-queue-ms-split-${process.pid}-${Date.now()}.json`);
process.env.SEED_DEMO = "false";
process.env.SESSION_SECRET = "ms-split-test-secret-0123456789";
delete process.env.DATABASE_URL;

const IMS = "IQ Middle School";
const VMS = "V5RC Middle School";
const AMBIGUOUS = `"Middle School" could be ${IMS} or ${VMS}. Save the program on the Event page first, or write the full name.`;

const route = (name: string) => () => import(`../src/app/api/${name}/route`);
const teams = (method: "POST" | "PATCH", body: unknown) => hit(route("admin/teams"), method, ADMIN, "/api/admin/teams", body);
const panels = (method: "POST" | "PATCH", body: unknown) => hit(route("admin/panels"), method, ADMIN, "/api/admin/panels", body);

test("the desk puts IQ Middle School only under VEX IQ and V5RC Middle School only under V5RC", async () => {
  const w = await world([["1111A", "Iq", IMS], ["2222B", "Vrc", VMS]]);
  await w.db.setWinner({ awardId: "excellence", division: IMS, teamId: w.team("1111A").id, decidedBy: "Alex", places: 1 });
  const sent = await hit(route("awards/released"), "PUT", ADMIN, "/api/awards/released", { awardId: "excellence", division: IMS });
  assert.equal(sent.status, 200);
  const { programs } = (await hit(route("awards/released"), "GET", MARKETING, "/api/awards/released")).body;
  assert.deepEqual(programs, [
    { label: "VEX IQ", divisions: ["Elementary School", IMS] },
    { label: "V5RC", divisions: [VMS, "High School"] },
    { label: "Blended", divisions: ["Blended"] },
  ]);
  const all: string[] = programs.flatMap((p: { divisions: string[] }) => p.divisions);
  assert.equal(new Set(all).size, all.length, "no division sits in two tabs");
});

test("import: plain Middle School follows the saved program", async () => {
  for (const [program, want] of [["VEX IQ", IMS], ["V5RC", VMS]]) {
    const w = await world();
    await w.db.saveEventSetup({ program, format: "standard", setBy: "Alex" });
    const res = await teams("POST", { text: "9882K, Kilo Kestrels, A2, Middle School" });
    assert.equal(res.status, 200, program);
    assert.deepEqual(res.body.skippedLines, [], program);
    assert.equal((await w.db.listTeams()).find((t) => t.number === "9882K")?.division, want, program);
  }
});

test("import: with no program saved, plain Middle School is refused with the reason; full names still go in", async () => {
  const w = await world([]);
  const res = await teams("POST", { text: `1111A, Ok, A1, ${IMS}\n9882K, Kilo Kestrels, A2, Middle School` });
  assert.equal(res.status, 200);
  assert.equal(res.body.imported, 1);
  assert.deepEqual(res.body.skippedLines, [{ line: 2, text: "9882K, Kilo Kestrels, A2, Middle School", reason: AMBIGUOUS }]);
  assert.deepEqual((await w.db.listTeams()).map((t) => t.number), ["1111A"]);
});

test("import: when every line is refused for the division, the 400 says why", async () => {
  const w = await world([]);
  const res = await teams("POST", { text: "3003X, Plain Kids, C1, Middle School" });
  assert.equal(res.status, 400);
  assert.ok(res.body.error.includes(AMBIGUOUS), res.body.error);
  assert.equal((await w.db.listTeams()).length, 0);
});

test("a single team or panel named plain Middle School with no program saved is a 400, not a silent fallback", async () => {
  const w = await world();
  const t = w.team("2088C");
  for (const reply of [
    await teams("PATCH", { teamId: t.id, division: "Middle School" }),
    await panels("POST", { name: "P1", division: "Middle School" }),
  ]) {
    assert.equal(reply.status, 400);
    assert.equal(reply.body.error, AMBIGUOUS);
  }
  const p = await w.db.createPanel({ name: "P2", code: "MS1001", division: IMS, judges: [], languages: [], sort_order: 1, slot_start_at: null, slot_minutes: 20, slot_count: 0 });
  const bad = await panels("PATCH", { id: p.id, division: "Middle School" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, AMBIGUOUS);
});

test("a panel or team named plain Middle School follows the saved program; an unknown division keeps the old fallback", async () => {
  const w = await world();
  await w.db.saveEventSetup({ program: "V5RC", format: "standard", setBy: "Alex" });
  const made = await panels("POST", { name: "P1", division: "middle school" });
  assert.equal(made.body.panel.division, VMS);
  const odd = await panels("POST", { name: "P2", division: "Nowhere" });
  assert.equal(odd.body.panel.division, VMS, "falls back to the first option as before");
});
