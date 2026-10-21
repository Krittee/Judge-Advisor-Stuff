import assert from "node:assert/strict";
import test from "node:test";

import type { Store } from "../src/lib/db/types";
import { StoreError } from "../src/lib/db/types";
import { defaultCategory, presetDivisions } from "../src/lib/presets";

/**
 * One set of rules, run against every backend.
 *
 * The app has two stores -- a JSON file for a laptop at the venue, and
 * Postgres for a deploy with no disk -- behind one 36-method interface,
 * and until this file existed nothing checked that they agreed. That is
 * not a theoretical gap. `deleteTeam` cleared a team's requests, notes,
 * scores and conflicts on the file store but left its referee flags
 * behind, while Postgres cascaded them; the roster looked identical and
 * the two databases were not. It was found by reading, which is not a
 * strategy.
 *
 * So the assertions live here once, and each backend is handed to them.
 * A rule that only one store keeps now fails on the other.
 *
 * Isolation is `resetAll()` rather than a fresh database per test: it is
 * the one wipe both backends implement, and it means this suite makes no
 * assumptions about how either one stores anything.
 */

const ES = "Elementary School";
const MS = "Middle School";
const BLEND = "Blended";

/** Defaults for the fields every panel needs but most tests do not care about. */
function panelInput(over: Partial<Parameters<Store["createPanel"]>[0]> = {}) {
  return {
    name: "Panel A",
    code: "CONF01",
    division: ES,
    judges: [],
    languages: [],
    sort_order: 1,
    slot_start_at: null,
    slot_minutes: 20,
    slot_count: 0,
    ...over,
  };
}

function teamInput(number: string, over: Partial<{ name: string; pit: string | null; division: string; category: string }> = {}) {
  return {
    number,
    name: `Team ${number}`,
    pit: null,
    division: ES,
    category: "developing",
    ...over,
  };
}

function requestInput(teamId: string, panelId: string, over: Record<string, unknown> = {}) {
  return {
    teamId,
    panelId,
    kind: "queue" as const,
    createdBy: "team",
    language: "en",
    ...over,
  } as Parameters<Store["createRequest"]>[0];
}

/** A slot time far enough out that no other test collides with it. */
const SLOT_A = "2026-09-01T14:00:00.000Z";
const SLOT_B = "2026-09-01T14:20:00.000Z";

/**
 * Every rule both stores must keep.
 *
 * `label` names the backend in the test titles so a failure says which
 * one broke. `open` is called once per test and must return a usable
 * store; the suite wipes it before each.
 */
export function runStoreConformance(label: string, open: () => Promise<Store>) {
  /** Fresh state, then the store. Every test starts from nothing. */
  async function fresh(): Promise<Store> {
    const store = await open();
    await store.resetAll();
    return store;
  }

  const it = (name: string, fn: (store: Store) => Promise<void>) =>
    test(`${label}: ${name}`, async () => fn(await fresh()));

  /* ---- invariant 1: one live request per team ------------------------ */

  it("a team cannot hold two live requests at once", async (store) => {
    const panel = await store.createPanel(panelInput());
    await store.upsertTeams([teamInput("1001")]);
    const team = await store.findTeamByNumber("1001");
    assert.ok(team);

    await store.createRequest(requestInput(team.id, panel.id));
    await assert.rejects(
      () => store.createRequest(requestInput(team.id, panel.id)),
      (e: unknown) => e instanceof StoreError && e.status === 409,
      "a second live request must be refused with a 409, not accepted",
    );
  });

  it("a finished interview frees the team to queue again", async (store) => {
    const panel = await store.createPanel(panelInput());
    await store.upsertTeams([teamInput("1001")]);
    const team = await store.findTeamByNumber("1001");
    assert.ok(team);

    const first = await store.createRequest(requestInput(team.id, panel.id));
    await store.updateRequest(first.id, { status: "completed" });
    await store.createRequest(requestInput(team.id, panel.id));
    const live = (await store.listRequests()).filter((r) => r.team_id === team.id);
    assert.equal(live.length, 2, "the completed request is kept as history");
  });

  it("a scheduled booking occupies the team's one slot", async (store) => {
    /* The bug this pins: if 'scheduled' is not counted as live, a team can
       hold any number of future bookings at once, because none of them
       ever reads as "already in the queue". */
    const panel = await store.createPanel(panelInput({ slot_count: 8, slot_start_at: SLOT_A }));
    await store.upsertTeams([teamInput("1001")]);
    const team = await store.findTeamByNumber("1001");
    assert.ok(team);

    await store.createRequest(
      requestInput(team.id, panel.id, { kind: "slot", slotStart: SLOT_A, slotEnd: SLOT_B }),
    );
    await assert.rejects(
      () =>
        store.createRequest(
          requestInput(team.id, panel.id, { kind: "slot", slotStart: SLOT_B, slotEnd: SLOT_A }),
        ),
      (e: unknown) => e instanceof StoreError,
      "a second booking at a different time must still be refused",
    );
    await assert.rejects(
      () => store.createRequest(requestInput(team.id, panel.id)),
      (e: unknown) => e instanceof StoreError,
      "a walk-up request on top of a booking must be refused",
    );
  });

  /* ---- invariant 2: one team per panel slot -------------------------- */

  it("two teams cannot hold the same slot on the same panel", async (store) => {
    const panel = await store.createPanel(panelInput({ slot_count: 8, slot_start_at: SLOT_A }));
    await store.upsertTeams([teamInput("1001"), teamInput("1002")]);
    const a = await store.findTeamByNumber("1001");
    const b = await store.findTeamByNumber("1002");
    assert.ok(a && b);

    await store.createRequest(
      requestInput(a.id, panel.id, { kind: "slot", slotStart: SLOT_A, slotEnd: SLOT_B }),
    );
    await assert.rejects(
      () =>
        store.createRequest(
          requestInput(b.id, panel.id, { kind: "slot", slotStart: SLOT_A, slotEnd: SLOT_B }),
        ),
      (e: unknown) => e instanceof StoreError,
      "the slot is taken and the second team must be refused",
    );
  });

  it("the same clock time on another panel is a different slot", async (store) => {
    const one = await store.createPanel(panelInput({ slot_count: 8, slot_start_at: SLOT_A }));
    const two = await store.createPanel(
      panelInput({ name: "Panel B", code: "CONF02", slot_count: 8, slot_start_at: SLOT_A }),
    );
    await store.upsertTeams([teamInput("1001"), teamInput("1002")]);
    const a = await store.findTeamByNumber("1001");
    const b = await store.findTeamByNumber("1002");
    assert.ok(a && b);

    await store.createRequest(
      requestInput(a.id, one.id, { kind: "slot", slotStart: SLOT_A, slotEnd: SLOT_B }),
    );
    await store.createRequest(
      requestInput(b.id, two.id, { kind: "slot", slotStart: SLOT_A, slotEnd: SLOT_B }),
    );
    assert.equal((await store.listRequests()).length, 2);
  });

  it("cancelling a booking releases its slot", async (store) => {
    const panel = await store.createPanel(panelInput({ slot_count: 8, slot_start_at: SLOT_A }));
    await store.upsertTeams([teamInput("1001"), teamInput("1002")]);
    const a = await store.findTeamByNumber("1001");
    const b = await store.findTeamByNumber("1002");
    assert.ok(a && b);

    const held = await store.createRequest(
      requestInput(a.id, panel.id, { kind: "slot", slotStart: SLOT_A, slotEnd: SLOT_B }),
    );
    await store.updateRequest(held.id, { status: "cancelled" });
    await store.createRequest(
      requestInput(b.id, panel.id, { kind: "slot", slotStart: SLOT_A, slotEnd: SLOT_B }),
    );
  });

  /* ---- compare-and-set: updateRequest's ifStatus --------------------- */

  /* BUG-011. The route reads a request's status, decides what to do from
     it, and writes -- and between the read and the write another screen
     can have moved it. ifStatus is what makes the write refuse to land
     on a row that is no longer in the status the decision was made from. */

  it("updateRequest with a stale ifStatus is a 409 and writes nothing", async (store) => {
    const panel = await store.createPanel(panelInput());
    await store.upsertTeams([teamInput("1001")]);
    const team = await store.findTeamByNumber("1001");
    assert.ok(team);

    const req = await store.createRequest(requestInput(team.id, panel.id));
    await store.updateRequest(req.id, { status: "acknowledged" }, "requested");

    // A second screen, still looking at "requested", tries to advance it.
    await assert.rejects(
      () =>
        store.updateRequest(
          req.id,
          { status: "interviewing", started_at: "2026-09-01T14:00:00.000Z" },
          "requested",
        ),
      (e: unknown) =>
        e instanceof StoreError && e.status === 409 && /changed on another screen/.test(e.message),
      "a stale ifStatus must be a 409 that says the request moved",
    );

    const after = await store.findRequest(req.id);
    assert.equal(after?.status, "acknowledged", "the stale write must not change the status");
    assert.equal(after?.started_at, null, "...nor any other column of the patch");
  });

  it("updateRequest with a matching ifStatus applies, and without one is unconditional", async (store) => {
    const panel = await store.createPanel(panelInput());
    await store.upsertTeams([teamInput("1001")]);
    const team = await store.findTeamByNumber("1001");
    assert.ok(team);

    const req = await store.createRequest(requestInput(team.id, panel.id));
    const moved = await store.updateRequest(req.id, { status: "acknowledged" }, "requested");
    assert.equal(moved.status, "acknowledged");

    // No ifStatus: every existing caller (and admin tooling) keeps working.
    const forced = await store.updateRequest(req.id, { status: "interviewing" });
    assert.equal(forced.status, "interviewing");
  });

  it("updateRequest with ifStatus on a request that is gone is a 404, not a 409", async (store) => {
    await assert.rejects(
      () => store.updateRequest("00000000-0000-4000-8000-000000000000", { status: "cancelled" }, "requested"),
      (e: unknown) => e instanceof StoreError && e.status === 404,
      "a vanished request and a moved one are different problems and must read differently",
    );
  });

  it("a booking becomes a walk-up request in place and gives its slot back", async (store) => {
    /* BUG-016. "Ready now" used to cancel the booking and then create a
       second request; this is the one-row conversion that replaces it. */
    const panel = await store.createPanel(panelInput({ slot_count: 8, slot_start_at: SLOT_A }));
    await store.upsertTeams([teamInput("1001"), teamInput("1002")]);
    const a = await store.findTeamByNumber("1001");
    const b = await store.findTeamByNumber("1002");
    assert.ok(a && b);

    const booking = await store.createRequest(
      requestInput(a.id, panel.id, { kind: "slot", slotStart: SLOT_A, slotEnd: SLOT_B }),
    );
    const now = "2026-09-01T13:00:00.000Z";
    const converted = await store.updateRequest(
      booking.id,
      { kind: "queue", status: "requested", slot_start: null, slot_end: null, requested_at: now },
      "scheduled",
    );

    assert.equal(converted.id, booking.id, "the same row, not a replacement");
    assert.equal(converted.kind, "queue");
    assert.equal(converted.status, "requested");
    assert.equal(converted.slot_start, null);
    assert.equal(converted.slot_end, null);
    assert.equal(new Date(converted.requested_at).toISOString(), now);

    const mine = (await store.listRequests()).filter((r) => r.team_id === a.id);
    assert.equal(mine.length, 1, "one row for the team -- nothing cancelled, nothing duplicated");
    assert.equal(mine[0].status, "requested");

    // The slot it held is free for someone else.
    await store.createRequest(
      requestInput(b.id, panel.id, { kind: "slot", slotStart: SLOT_A, slotEnd: SLOT_B }),
    );
  });

  /* ---- cascades: what a delete takes with it ------------------------- */

  it("deleting a team takes everything hanging off it", async (store) => {
    /* The divergence that prompted this whole file. Postgres cascades
       flags with the team and nulls activity.team_id; the file store was
       silently keeping orphan flags under a dead id, where they still
       counted toward the team's repeat-violation history. */
    const panel = await store.createPanel(panelInput());
    await store.upsertTeams([teamInput("1001"), teamInput("1002")]);
    const doomed = await store.findTeamByNumber("1001");
    const bystander = await store.findTeamByNumber("1002");
    assert.ok(doomed && bystander);
    await store.updateTeam(doomed.id, { panel_id: panel.id });

    await store.createRequest(requestInput(doomed.id, panel.id));
    await store.createNote({
      teamId: doomed.id,
      requestId: null,
      panelId: panel.id,
      author: "Judge",
      body: "note",
    });
    await store.createFlag({
      teamId: doomed.id,
      kind: "minor",
      body: "violation",
      author: "Referee",
      matchType: "Q",
      matchNumber: "3",
      field: "1",
      rule: "SG6",
      ruleset: "viqrc",
      manualVersion: null,
      matchAffecting: false,
    });
    await store.saveScore({
      teamId: doomed.id,
      rubricId: "interview",
      criterionId: "interview:x",
      value: 2,
      scoredBy: "Judge",
      panelId: panel.id,
      totalOf: (v) => Object.values(v).reduce((s, n) => s + Number(n || 0), 0),
    });
    await store.addConflict({
      panelId: panel.id,
      teamId: doomed.id,
      judgeName: "Judge",
      note: null,
      declaredBy: "admin:JA",
    });
    // A bystander's flag must survive, or the test would pass on a store
    // that simply deleted everything.
    await store.createFlag({
      teamId: bystander.id,
      kind: "good",
      body: "kept",
      author: "Referee",
      matchType: "Q",
      matchNumber: "4",
      field: "2",
      rule: null,
      ruleset: "viqrc",
      manualVersion: null,
      matchAffecting: false,
    });

    await store.deleteTeam(doomed.id);

    const gone = (name: string, rows: { team_id?: string | null }[]) =>
      assert.equal(
        rows.filter((r) => r.team_id === doomed.id).length,
        0,
        `${name} survived the team being deleted`,
      );

    gone("requests", await store.listRequests());
    gone("notes", await store.listNotes());
    gone("scores", await store.listScores());
    gone("conflicts", await store.listConflicts());
    gone("flags", await store.listFlags());
    assert.equal(
      (await store.listFlags()).filter((f) => f.team_id === bystander.id).length,
      1,
      "another team's flag must not be taken with it",
    );
  });

  it("deleting a panel orphans its teams rather than losing them", async (store) => {
    const panel = await store.createPanel(panelInput());
    await store.upsertTeams([teamInput("1001")]);
    const team = await store.findTeamByNumber("1001");
    assert.ok(team);
    await store.updateTeam(team.id, { panel_id: panel.id });
    await store.createRequest(requestInput(team.id, panel.id));

    await store.deletePanel(panel.id);

    const after = (await store.listTeams()).find((t) => t.id === team.id);
    assert.ok(after, "the team must survive its panel");
    assert.equal(after.panel_id, null, "and fall back to unassigned");
    assert.equal((await store.listRequests()).length, 1, "its request must survive too");
  });

  it("clearing every panel keeps the roster", async (store) => {
    await store.createPanel(panelInput());
    await store.createPanel(panelInput({ name: "Panel B", code: "CONF02" }));
    await store.upsertTeams([teamInput("1001"), teamInput("1002")]);
    for (const t of await store.listTeams()) {
      await store.updateTeam(t.id, { panel_id: (await store.listPanels())[0].id });
    }

    const removed = await store.deleteAllPanels();
    assert.equal(removed, 2);
    assert.equal((await store.listPanels()).length, 0);
    assert.equal((await store.listTeams()).length, 2, "the roster is expensive to rebuild");
    assert.ok(
      (await store.listTeams()).every((t) => t.panel_id === null),
      "every team falls back to unassigned",
    );
  });

  /* ---- the division wall --------------------------------------------- */

  it("auto-assign respects the wall, the cap, and declared conflicts", async (store) => {
    const es = await store.createPanel(panelInput({ code: "CONFES", division: ES }));
    await store.createPanel(panelInput({ name: "Panel MS", code: "CONFMS", division: MS }));
    await store.upsertTeams([
      teamInput("1001", { division: ES }),
      teamInput("1002", { division: ES }),
      teamInput("2001", { division: MS }),
      teamInput("3001", { division: BLEND }),
    ]);

    const conflicted = await store.findTeamByNumber("1002");
    assert.ok(conflicted);
    await store.addConflict({
      panelId: es.id,
      teamId: conflicted.id,
      judgeName: "Dana",
      note: null,
      declaredBy: "admin:JA",
    });

    await store.autoAssignTeams(10);
    const byNumber = new Map((await store.listTeams()).map((t) => [t.number, t]));
    const panelById = new Map((await store.listPanels()).map((p) => [p.id, p]));
    const divisionOf = (n: string) => {
      const id = byNumber.get(n)?.panel_id;
      return id ? panelById.get(id)?.division : null;
    };

    assert.equal(divisionOf("1001"), ES, "an ES team belongs on the ES panel");
    assert.equal(divisionOf("2001"), MS, "an MS team belongs on the MS panel");
    assert.ok(divisionOf("3001"), "a Blended team must be placed, not skipped");
    assert.equal(
      byNumber.get("1002")?.panel_id,
      null,
      "the only panel that may judge this team is conflicted with it",
    );
    assert.equal(byNumber.get("3001")?.division, BLEND, "assignment must not rewrite a division");
  });

  it("auto-assign stops at the cap", async (store) => {
    await store.createPanel(panelInput());
    await store.upsertTeams(["1001", "1002", "1003", "1004"].map((n) => teamInput(n)));

    const assigned = await store.autoAssignTeams(2);
    assert.equal(assigned, 2, "only as many as the cap allows");
    assert.equal(
      (await store.listTeams()).filter((t) => t.panel_id !== null).length,
      2,
      "the rest are left unassigned rather than piled on",
    );
  });

  it("moving a panel's division releases only the teams it may no longer judge", async (store) => {
    const panel = await store.createPanel(panelInput({ division: ES }));
    await store.upsertTeams([
      teamInput("1001", { division: ES }),
      teamInput("3001", { division: BLEND }),
    ]);
    for (const t of await store.listTeams()) await store.updateTeam(t.id, { panel_id: panel.id });

    await store.updatePanel(panel.id, { division: MS });

    const byNumber = new Map((await store.listTeams()).map((t) => [t.number, t]));
    assert.equal(byNumber.get("1001")?.panel_id, null, "the ES team is across the wall now");
    assert.equal(
      byNumber.get("3001")?.panel_id,
      panel.id,
      "a Blended team may be judged either side, so it stays",
    );
  });

  /* ---- teams and identity -------------------------------------------- */

  it("a team number cannot be taken twice", async (store) => {
    await store.upsertTeams([teamInput("1001"), teamInput("1002")]);
    const team = await store.findTeamByNumber("1002");
    assert.ok(team);

    await assert.rejects(
      () => store.updateTeam(team.id, { number: "1001" }),
      (e: unknown) => e instanceof StoreError && e.status === 409,
      "renaming onto another team's number must be refused",
    );
    await store.updateTeam(team.id, { number: "1002" });
  });

  it("re-importing a roster updates rather than duplicates", async (store) => {
    await store.upsertTeams([teamInput("1001", { name: "Old Name" })]);
    await store.upsertTeams([teamInput("1001", { name: "New Name" })]);

    const teams = await store.listTeams();
    assert.equal(teams.length, 1, "the same number must not appear twice");
    assert.equal(teams[0].name, "New Name");
  });

  /* A blank cell on a re-import is "not said", not "clear it": a stored team keeps its notebook type,
     division and pit, a new one gets the defaults, and a value still changes the field. */

  it("re-importing without a name keeps each team's name, calls a new team 'Team <number>', and a given name still renames it", async (store) => {
    await store.upsertTeams([teamInput("1001", { name: "Iron Hawks" })]);

    await store.upsertTeams([{ number: "1001", name: null, pit: "A1" }, { number: "1002", pit: null }]);
    const [kept, created] = await store.listTeams();
    assert.equal(kept.name, "Iron Hawks", "no name cell: the stored name stays");
    assert.equal(kept.pit, "A1", "the rest of the line still updates");
    assert.equal(created.name, "Team 1002", "a new team gets the fallback name");

    await store.upsertTeams([{ number: "1001", name: "Kilo Kestrels", pit: null }]);
    assert.equal((await store.findTeamByNumber("1001"))?.name, "Kilo Kestrels", "a name that is given wins");
  });

  it("re-importing without a notebook type keeps each team's, gives a new team the default, and a given type still changes it", async (store) => {
    await store.upsertTeams([teamInput("1001", { category: "ungraded" })]);

    await store.upsertTeams([{ number: "1001", name: "Re-imported", pit: null }, { number: "1002", name: "Brand new", pit: null }]);
    const [kept, created] = await store.listTeams();
    assert.equal(kept.name, "Re-imported", "the rest of the line still updates");
    assert.equal(kept.category, "ungraded", "no fifth column: the stored type stays");
    assert.equal(created.category, defaultCategory(), "a new team gets the default type");

    await store.upsertTeams([{ number: "1001", name: "Re-imported", pit: null, category: "fully-developed" }]);
    assert.equal((await store.findTeamByNumber("1001"))?.category, "fully-developed", "a type that is given wins");
  });

  it("re-importing without a division keeps each team's division and panel, gives a new team the first division, and a given division still moves it", async (store) => {
    const panel = await store.createPanel(panelInput({ division: MS }));
    await store.upsertTeams([teamInput("1001", { division: MS })]);
    const held = await store.findTeamByNumber("1001");
    assert.ok(held);
    await store.updateTeam(held.id, { panel_id: panel.id });

    await store.upsertTeams([{ number: "1001", name: "Re-imported", pit: null }, { number: "1002", name: "Brand new", pit: null }]);
    const kept = await store.findTeamByNumber("1001");
    assert.equal(kept?.division, MS, "no fourth column: the stored division stays");
    assert.equal(kept?.panel_id, panel.id, "so the panel it holds is not taken away");
    assert.equal((await store.findTeamByNumber("1002"))?.division, presetDivisions()[0], "a new team gets the first division");

    await store.upsertTeams([{ number: "1001", name: "Re-imported", pit: null, division: ES }]);
    const moved = await store.findTeamByNumber("1001");
    assert.equal(moved?.division, ES, "a division that is given wins");
    assert.equal(moved?.panel_id, null, "and the panel on the far side of the wall comes off");
  });

  it("re-importing a team into a division its panel can still judge keeps the panel; one it can't judge clears it", async (store) => {
    const panel = await store.createPanel(panelInput({ division: MS }));
    await store.upsertTeams([teamInput("1001", { division: MS }), teamInput("1002", { division: MS })]);
    for (const t of await store.listTeams()) await store.updateTeam(t.id, { panel_id: panel.id });

    // Blended may be judged by anyone, so the panel stays; the stored division still moves.
    await store.upsertTeams([teamInput("1001", { division: BLEND })]);
    const blended = await store.findTeamByNumber("1001");
    assert.equal(blended?.division, BLEND);
    assert.equal(blended?.panel_id, panel.id, "the MS panel can still judge a Blended team");

    await store.upsertTeams([teamInput("1002", { division: ES })]);
    const moved = await store.findTeamByNumber("1002");
    assert.equal(moved?.division, ES);
    assert.equal(moved?.panel_id, null, "the MS panel can't judge an ES team");
  });

  it("re-importing without a pit keeps each team's pit, a new team has none, and a given pit still changes it", async (store) => {
    await store.upsertTeams([teamInput("1001", { pit: "A1" })]);

    await store.upsertTeams([{ number: "1001", name: "Re-imported", pit: null }, { number: "1002", name: "Brand new", pit: null }]);
    assert.equal((await store.findTeamByNumber("1001"))?.pit, "A1", "no pit column: the stored pit stays");
    assert.equal((await store.findTeamByNumber("1002"))?.pit, null, "a new team has no pit");

    await store.upsertTeams([{ number: "1001", name: "Re-imported", pit: "B2" }]);
    assert.equal((await store.findTeamByNumber("1001"))?.pit, "B2", "a pit that is given wins");
  });

  it("a team is found whatever case its number is typed in", async (store) => {
    await store.upsertTeams([teamInput("9882K")]);
    assert.ok(await store.findTeamByNumber("9882k"), "lowercase must find it");
    assert.ok(await store.findTeamByNumber("9882K"));
  });

  /* ---- scores --------------------------------------------------------- */

  it("clearing one rubric leaves the other alone", async (store) => {
    await store.upsertTeams([teamInput("1001")]);
    const team = await store.findTeamByNumber("1001");
    assert.ok(team);
    const totalOf = (v: Record<string, number>) =>
      Object.values(v).reduce((s, n) => s + Number(n || 0), 0);

    await store.saveScore({
      teamId: team.id,
      rubricId: "interview",
      criterionId: "interview:a",
      value: 2,
      scoredBy: "Judge",
      panelId: null,
      totalOf,
    });
    await store.saveScore({
      teamId: team.id,
      rubricId: "notebook",
      criterionId: "notebook:a",
      value: 3,
      scoredBy: "Judge",
      panelId: null,
      totalOf,
    });

    assert.equal(await store.clearScore(team.id, "interview"), true);
    const left = await store.listScores(team.id);
    assert.deepEqual(
      left.map((s) => s.rubric_id),
      ["notebook"],
      "only the rubric asked for is wiped",
    );
    assert.equal(
      await store.clearScore(team.id, "interview"),
      false,
      "clearing an already-clear rubric reports that there was nothing there",
    );
  });

  it("a cleared score and a score of zero stay different things", async (store) => {
    await store.upsertTeams([teamInput("1001")]);
    const team = await store.findTeamByNumber("1001");
    assert.ok(team);
    const totalOf = (v: Record<string, number>) =>
      Object.values(v).reduce((s, n) => s + Number(n || 0), 0);

    await store.saveScore({
      teamId: team.id,
      rubricId: "interview",
      criterionId: "interview:a",
      value: 0,
      scoredBy: "Judge",
      panelId: null,
      totalOf,
    });
    const scored = (await store.listScores(team.id))[0];
    assert.ok(scored, "a zero is a judgement and must be stored");
    assert.deepEqual(Object.keys(scored.values ?? {}), ["interview:a"]);

    await store.saveScore({
      teamId: team.id,
      rubricId: "interview",
      criterionId: "interview:a",
      value: null,
      scoredBy: "Judge",
      panelId: null,
      totalOf,
    });
    const cleared = (await store.listScores(team.id))[0];
    assert.deepEqual(
      Object.keys(cleared?.values ?? {}),
      [],
      "clearing removes the criterion rather than storing a zero",
    );
  });

  /* ---- flags and the event boundary ----------------------------------- */

  it("a flag keeps its ruleset, rules, manual version and match-affecting through create and correct", async (store) => {
    await store.upsertTeams([teamInput("1001")]);
    const team = await store.findTeamByNumber("1001");
    assert.ok(team);

    const created = await store.createFlag({
      teamId: team.id,
      kind: "major",
      body: "Held a robot for a count of five.",
      author: "Referee",
      matchType: "QF",
      matchNumber: "2-1",
      field: "1",
      rule: "GG17,SG9",
      ruleset: "v5rc",
      manualVersion: "2.1",
      matchAffecting: true,
    });
    const view = (f: typeof created) => ({
      rule: f.rule,
      ruleset: f.ruleset,
      manual_version: f.manual_version,
      match_affecting: f.match_affecting,
      match: `${f.match_type} ${f.match_number}`,
      field: f.field,
    });
    const v5 = {
      rule: "GG17,SG9",
      ruleset: "v5rc",
      manual_version: "2.1",
      match_affecting: true,
      match: "QF 2-1",
      field: "1",
    };
    assert.deepEqual(view(created), v5, "createFlag returns what it stored");
    assert.deepEqual(view((await store.listFlags())[0]), v5, "listFlags reads it back");

    // A flag recorded the old way: no ruleset, a prefixed field, not match affecting.
    await store.createFlag({
      teamId: team.id,
      kind: "warning",
      body: "",
      author: "Referee",
      matchType: "Q",
      matchNumber: "4",
      field: "ES1",
      rule: null,
      ruleset: null,
      manualVersion: null,
      matchAffecting: false,
    });
    const legacy = (await store.listFlags()).find((f) => f.match_number === "4");
    assert.ok(legacy);
    assert.deepEqual(view(legacy), {
      rule: null,
      ruleset: null,
      manual_version: null,
      match_affecting: false,
      match: "Q 4",
      field: "ES1",
    });

    const corrected = await store.updateFlag(created.id, {
      kind: "minor",
      body: "Held a robot for a count of five.",
      matchType: "SKD",
      matchNumber: "3",
      field: "2",
      rule: "SG6",
      ruleset: "viqrc",
      manualVersion: null,
      matchAffecting: false,
    });
    const iq = {
      rule: "SG6",
      ruleset: "viqrc",
      manual_version: null,
      match_affecting: false,
      match: "SKD 3",
      field: "2",
    };
    assert.deepEqual(view(corrected), iq, "updateFlag returns the corrected values");
    assert.deepEqual(
      view((await store.listFlags()).find((f) => f.id === created.id)!),
      iq,
      "and they persisted",
    );
  });

  it("a day reset keeps referee flags; a full wipe does not", async (store) => {
    const panel = await store.createPanel(panelInput());
    await store.upsertTeams([teamInput("1001")]);
    const team = await store.findTeamByNumber("1001");
    assert.ok(team);
    await store.createRequest(requestInput(team.id, panel.id));
    await store.createFlag({
      teamId: team.id,
      kind: "minor",
      body: "violation",
      author: "Referee",
      matchType: "Q",
      matchNumber: "3",
      field: "1",
      rule: "SG6",
      ruleset: "viqrc",
      manualVersion: null,
      matchAffecting: false,
    });
    const setup = await store.saveRefereeSetup({
      ruleset: "v5rc",
      fieldCount: 4,
      setBy: "Dana",
      setOn: "2026-09-09",
    });

    await store.resetDay();
    assert.equal(
      (await store.listFlags()).length,
      1,
      "repeat-violation history is event-wide and survives a day reset",
    );
    assert.equal((await store.listRequests()).length, 0, "the day's queue does not");
    assert.equal((await store.listTeams()).length, 1, "nor does the roster go");
    assert.deepEqual(await store.getRefereeSetup(), setup, "the event's referee setup survives a day reset too");

    await store.resetAll();
    assert.deepEqual(await store.listFlags(), [], "a full wipe is the event boundary");
    assert.equal(await store.getRefereeSetup(), null, "and takes the referee setup with it");
    assert.deepEqual(await store.listTeams(), []);
    assert.deepEqual(await store.listPanels(), []);
  });

  it("the referee setup is one record per event: absent, saved, read back, replaced", async (store) => {
    assert.equal(await store.getRefereeSetup(), null, "nothing is set up on a fresh event");

    const first = await store.saveRefereeSetup({
      ruleset: "v5rc",
      fieldCount: 3,
      setBy: "Dana",
      setOn: "2026-09-09",
    });
    assert.deepEqual(
      { ...first, updated_at: undefined },
      { ruleset: "v5rc", field_count: 3, set_by: "Dana", set_on: "2026-09-09", updated_at: undefined },
    );
    assert.equal(typeof first.field_count, "number", "a count, not the driver's text");
    assert.equal(first.set_on, "2026-09-09", "the date is kept as the caller wrote it");
    assert.ok(!Number.isNaN(Date.parse(first.updated_at)), "updated_at is a timestamp");
    assert.deepEqual(await store.getRefereeSetup(), first, "and it reads back as saved");

    const second = await store.saveRefereeSetup({
      ruleset: "viqrc",
      fieldCount: 20,
      setBy: "Judge Advisor",
      setOn: "2026-09-10",
    });
    assert.deepEqual(
      { ...second, updated_at: undefined },
      { ruleset: "viqrc", field_count: 20, set_by: "Judge Advisor", set_on: "2026-09-10", updated_at: undefined },
      "a second save replaces the first rather than adding a second record",
    );
    assert.deepEqual(await store.getRefereeSetup(), second);
    assert.ok(!("id" in second), "the single row's key is not part of the record");

    await store.resetDay();
    assert.deepEqual(await store.getRefereeSetup(), second, "a day reset keeps it");
    await store.resetAll();
    assert.equal(await store.getRefereeSetup(), null, "a full wipe clears it");
  });

  it("a conflict is declared once, however many times it is asked for", async (store) => {
    const panel = await store.createPanel(panelInput());
    await store.upsertTeams([teamInput("1001")]);
    const team = await store.findTeamByNumber("1001");
    assert.ok(team);

    const first = await store.addConflict({
      panelId: panel.id,
      teamId: team.id,
      judgeName: "Dana",
      note: null,
      declaredBy: "admin:JA",
    });
    const again = await store.addConflict({
      panelId: panel.id,
      teamId: team.id,
      judgeName: "Dana",
      note: null,
      declaredBy: "admin:JA",
    });

    assert.equal(again.id, first.id, "declaring the same pair twice must not make a second row");
    assert.equal((await store.listConflicts()).length, 1);
    assert.equal(await store.removeConflict(first.id), true);
    assert.equal(await store.removeConflict(first.id), false, "removing it twice is harmless");
  });

  /* ---- the judge roster, and conflicts that belong to a judge ------------- */

  /** A well-formed id nothing has: Postgres rejects a malformed uuid before it gets to "not found". */
  const NO_SUCH = "00000000-0000-4000-8000-000000000000";
  const statusOf = (status: number) => (e: unknown) => e instanceof StoreError && e.status === status;
  const namesOn = async (store: Store, panelId: string) =>
    (await store.listJudges()).filter((j) => j.panel_id === panelId).map((j) => j.name);

  it("the roster keeps names trimmed, unique ignoring case, in the order they were added", async (store) => {
    const dana = await store.addJudge({ name: "  Dana Ruiz ", note: "coaches 9882K" });
    await store.addJudge({ name: "Sam Okafor" });

    assert.equal(dana.name, "Dana Ruiz", "names are trimmed");
    assert.equal(dana.note, "coaches 9882K");
    assert.equal(dana.panel_id, null, "a new judge is on no panel");
    assert.ok(!Number.isNaN(Date.parse(dana.created_at)), "created_at is a timestamp");
    assert.deepEqual(
      Object.keys(dana).sort(),
      ["created_at", "id", "name", "note", "panel_id"],
      "exactly a JudgeRow, nothing the table keeps for itself",
    );

    await assert.rejects(() => store.addJudge({ name: "dana RUIZ" }), statusOf(409));
    await assert.rejects(() => store.addJudge({ name: "   " }), statusOf(400));
    assert.deepEqual((await store.listJudges()).map((j) => j.name), ["Dana Ruiz", "Sam Okafor"]);
  });

  it("a roster judge can be renamed, noted and moved; a taken name or a missing panel is refused", async (store) => {
    const panel = await store.createPanel(panelInput());
    const dana = await store.addJudge({ name: "Dana Ruiz" });
    const sam = await store.addJudge({ name: "Sam Okafor" });

    const moved = await store.updateJudge(dana.id, { panel_id: panel.id, note: "coaches 9882K" });
    assert.equal(moved.panel_id, panel.id);
    assert.equal(moved.note, "coaches 9882K");
    assert.equal((await store.updateJudge(dana.id, { name: "Dana R." })).name, "Dana R.");
    assert.equal((await store.updateJudge(dana.id, { name: "dana r." })).name, "dana r.", "a judge may re-case their own name");

    await assert.rejects(() => store.updateJudge(sam.id, { name: "DANA R." }), statusOf(409));
    await assert.rejects(() => store.updateJudge(dana.id, { name: " " }), statusOf(400));
    await assert.rejects(() => store.updateJudge(sam.id, { panel_id: NO_SUCH }), statusOf(404));
    await assert.rejects(() => store.updateJudge(NO_SUCH, { note: "x" }), statusOf(404));
    assert.equal((await store.listJudges()).find((j) => j.id === sam.id)?.panel_id, null, "a refused move changes nothing");

    assert.equal((await store.updateJudge(dana.id, { panel_id: null })).panel_id, null, "null takes them off the panel");
    assert.equal(await store.removeJudge(sam.id), true);
    assert.equal(await store.removeJudge(sam.id), false, "removing twice is harmless");
  });

  it("a panel's judges are the roster's: found or added by name ignoring case, and they move with the judge", async (store) => {
    const one = await store.createPanel(panelInput({ judges: ["Dana Ruiz", "Sam Okafor"] }));
    assert.deepEqual(one.judges, ["Dana Ruiz", "Sam Okafor"]);
    assert.deepEqual(await namesOn(store, one.id), ["Dana Ruiz", "Sam Okafor"]);

    // Sam is found despite the case, and keeps the roster's spelling; he leaves Panel A for B.
    const two = await store.createPanel(
      panelInput({ name: "Panel B", code: "CONF02", judges: ["sam okafor", "Priya Nair"] }),
    );
    assert.deepEqual(two.judges, ["Sam Okafor", "Priya Nair"], "in roster order, not the order typed");
    assert.equal((await store.findPanelByCode("conf01"))?.judges.join(), "Dana Ruiz");
    assert.equal((await store.listJudges()).length, 3, "nobody was added twice");

    // Saving the field again with fewer names takes the others off the panel, not off the roster.
    assert.deepEqual((await store.updatePanel(two.id, { judges: ["Priya Nair"] })).judges, ["Priya Nair"]);
    assert.equal((await store.listJudges()).find((j) => j.name === "Sam Okafor")?.panel_id, null);
    assert.equal((await store.listJudges()).length, 3, "Sam is still on the roster");

    // A patch that does not mention judges leaves them alone; an empty list clears them.
    assert.deepEqual((await store.updatePanel(two.id, { name: "Panel Two" })).judges, ["Priya Nair"]);
    assert.deepEqual((await store.listPanels()).map((p) => p.judges), [["Dana Ruiz"], ["Priya Nair"]]);
    assert.deepEqual((await store.updatePanel(one.id, { judges: [] })).judges, []);
    assert.equal((await store.listJudges()).length, 3);
  });

  it("preset panels put their judges on the roster", async (store) => {
    await store.seedPresetPanels();
    for (const panel of await store.listPanels()) {
      assert.deepEqual(panel.judges, await namesOn(store, panel.id), `${panel.name}'s judges are the roster's`);
    }
  });

  it("a conflict is a judge's or a panel's, never both and never neither", async (store) => {
    const panel = await store.createPanel(panelInput());
    await store.upsertTeams([teamInput("1001")]);
    const team = (await store.findTeamByNumber("1001"))!;
    const dana = await store.addJudge({ name: "Dana Ruiz" });
    const base = { teamId: team.id, note: null, declaredBy: "admin:JA" };

    await assert.rejects(() => store.addConflict({ ...base }), statusOf(400));
    await assert.rejects(() => store.addConflict({ ...base, panelId: panel.id, judgeId: dana.id }), statusOf(400));
    await assert.rejects(() => store.addConflict({ ...base, judgeId: NO_SUCH }), statusOf(404));
    assert.deepEqual(await store.listConflicts(), [], "none of those wrote anything");

    const mine = await store.addConflict({ ...base, judgeId: dana.id, note: "coaches them", judgeName: "ignored" });
    assert.equal(mine.judge_id, dana.id);
    assert.equal(mine.panel_id, null);
    assert.equal(mine.judge_name, null, "a judge's conflict names the judge by id and writes no label");
    assert.equal(mine.note, "coaches them");

    const legacy = await store.addConflict({ ...base, panelId: panel.id, judgeName: "Old Name" });
    assert.equal(legacy.panel_id, panel.id);
    assert.equal(legacy.judge_id, null);
    assert.equal(legacy.judge_name, "Old Name", "an older whole-panel row still carries its label");
  });

  it("a judge's conflict is recorded once; removing the judge takes theirs and nobody else's", async (store) => {
    await store.upsertTeams([teamInput("1001")]);
    const team = (await store.findTeamByNumber("1001"))!;
    const dana = await store.addJudge({ name: "Dana Ruiz" });
    const sam = await store.addJudge({ name: "Sam Okafor" });
    const base = { teamId: team.id, note: null, declaredBy: "admin:JA" };

    const first = await store.addConflict({ ...base, judgeId: dana.id });
    const again = await store.addConflict({ ...base, judgeId: dana.id });
    assert.equal(again.id, first.id, "the same judge and team is one conflict");
    const theirs = await store.addConflict({ ...base, judgeId: sam.id });
    assert.notEqual(theirs.id, first.id, "another judge's conflict with the same team is its own");
    assert.equal((await store.listConflicts()).length, 2);

    assert.equal(await store.removeJudge(dana.id), true);
    assert.deepEqual((await store.listConflicts()).map((c) => c.id), [theirs.id], "their conflicts go with them");
    assert.equal(await store.removeConflict(theirs.id), true);
  });

  it("deleting a panel keeps its judges' conflicts and drops only the whole-panel ones", async (store) => {
    const panel = await store.createPanel(panelInput({ judges: ["Dana Ruiz"] }));
    await store.upsertTeams([teamInput("1001"), teamInput("1002")]);
    const [t1, t2] = await store.listTeams();
    const dana = (await store.listJudges())[0];
    const base = { note: null, declaredBy: "admin:JA" };
    const kept = await store.addConflict({ ...base, judgeId: dana.id, teamId: t1.id });
    await store.addConflict({ ...base, panelId: panel.id, teamId: t2.id });

    await store.deletePanel(panel.id);

    assert.deepEqual((await store.listConflicts()).map((c) => c.id), [kept.id], "the legacy row went with its panel; the judge's stayed");
    assert.equal((await store.listJudges())[0].panel_id, null, "the judge is on the roster, on no panel");
  });

  it("clearing every panel keeps the judges' conflicts too", async (store) => {
    await store.createPanel(panelInput({ judges: ["Dana Ruiz"] }));
    await store.createPanel(panelInput({ name: "Panel B", code: "CONF02", judges: ["Sam Okafor"] }));
    await store.upsertTeams([teamInput("1001")]);
    const team = (await store.findTeamByNumber("1001"))!;
    for (const judge of await store.listJudges()) {
      await store.addConflict({ judgeId: judge.id, teamId: team.id, note: null, declaredBy: "admin:JA" });
    }
    await store.addConflict({ panelId: (await store.listPanels())[0].id, teamId: team.id, judgeName: null, note: null, declaredBy: "admin:JA" });

    await store.deleteAllPanels();

    const left = await store.listConflicts();
    assert.equal(left.length, 2, "only the whole-panel conflict went");
    assert.ok(left.every((c) => c.judge_id !== null && c.panel_id === null));
    assert.ok((await store.listJudges()).every((j) => j.panel_id === null));
  });

  it("deleting a team removes judges' conflicts with it", async (store) => {
    await store.upsertTeams([teamInput("1001"), teamInput("1002")]);
    const [gone, kept] = await store.listTeams();
    const dana = await store.addJudge({ name: "Dana Ruiz" });
    await store.addConflict({ judgeId: dana.id, teamId: gone.id, note: null, declaredBy: "admin:JA" });
    const stays = await store.addConflict({ judgeId: dana.id, teamId: kept.id, note: null, declaredBy: "admin:JA" });

    await store.deleteTeam(gone.id);

    assert.deepEqual((await store.listConflicts()).map((c) => c.id), [stays.id]);
  });

  it("a day reset keeps the roster and its conflicts; a full wipe clears them", async (store) => {
    await store.upsertTeams([teamInput("1001")]);
    const team = (await store.findTeamByNumber("1001"))!;
    const dana = await store.addJudge({ name: "Dana Ruiz" });
    await store.addConflict({ judgeId: dana.id, teamId: team.id, note: null, declaredBy: "admin:JA" });

    await store.resetDay();
    assert.equal((await store.listJudges()).length, 1, "the roster is the event's, not the day's");
    assert.equal((await store.listConflicts()).length, 1);

    await store.resetAll();
    assert.deepEqual(await store.listJudges(), []);
    assert.deepEqual(await store.listConflicts(), []);
  });

  it("auto-assign respects a judge's conflict through the panel the judge sits on, and stops when they move", async (store) => {
    const a = await store.createPanel(panelInput({ code: "CONFA1", judges: ["Dana Ruiz"] }));
    const b = await store.createPanel(panelInput({ name: "Panel B", code: "CONFB2" }));
    await store.upsertTeams([teamInput("1001")]);
    const team = (await store.findTeamByNumber("1001"))!;
    const dana = (await store.listJudges())[0];
    await store.addConflict({ judgeId: dana.id, teamId: team.id, note: null, declaredBy: "admin:JA" });

    await store.autoAssignTeams(10);
    assert.equal((await store.findTeamByNumber("1001"))?.panel_id, b.id, "Dana is on Panel A, so the team goes to B");

    // Dana moves to Panel B: the block follows her, and A is free of it.
    await store.updateTeam(team.id, { panel_id: null });
    await store.updateJudge(dana.id, { panel_id: b.id });
    await store.autoAssignTeams(10);
    assert.equal((await store.findTeamByNumber("1001"))?.panel_id, a.id);

    // And with no panel at all she blocks nobody.
    await store.updateTeam(team.id, { panel_id: null });
    await store.updateJudge(dana.id, { panel_id: null });
    await store.autoAssignTeams(10);
    assert.ok((await store.findTeamByNumber("1001"))?.panel_id, "assignable again");
  });

  it("a panel code is found case-insensitively, and only while it exists", async (store) => {
    const panel = await store.createPanel(panelInput({ code: "CONF01" }));
    assert.equal((await store.findPanelByCode("conf01"))?.id, panel.id);
    await store.deletePanel(panel.id);
    assert.equal(await store.findPanelByCode("CONF01"), null, "a deleted panel signs nobody in");
  });

  it("an activity entry keeps its kind, name and role, and reads back with the number of the team it names", async (store) => {
    await store.upsertTeams([teamInput("1001")]);
    const team = await store.findTeamByNumber("1001");
    assert.ok(team);

    await store.logActivity({ teamId: team.id, kind: "referee", actor: "Jordan", actorRole: "Referee", action: "flagged minor", detail: "Team 1001" });
    await store.logActivity({ kind: "setup", actor: "Alex", actorRole: "Judge Advisor", action: "added a judge" });

    const read = async (action: string) => (await store.listActivity()).find((a) => a.action === action);
    const flagged = await read("flagged minor");
    assert.deepEqual(
      [flagged?.kind, flagged?.actor, flagged?.actor_role, flagged?.team_id, flagged?.team_number, flagged?.detail],
      ["referee", "Jordan", "Referee", team.id, "1001", "Team 1001"],
    );
    const setup = await read("added a judge");
    assert.deepEqual([setup?.kind, setup?.actor, setup?.actor_role, setup?.team_id, setup?.team_number], ["setup", "Alex", "Judge Advisor", null, null]);

    await store.deleteTeam(team.id);
    assert.equal((await read("flagged minor"))?.team_number, null, "a removed team leaves the entry with no number");

    await store.resetDay();
    assert.deepEqual(await store.listActivity(), [], "a day reset clears the log");
  });

  it("the same panel code cannot be issued twice", async (store) => {
    await store.createPanel(panelInput({ code: "CONF01" }));
    await assert.rejects(
      () => store.createPanel(panelInput({ name: "Panel B", code: "CONF01" })),
      (e: unknown) => e instanceof StoreError && e.status === 409,
      "two panels sharing a code would sign judges into the wrong one",
    );
  });
}
