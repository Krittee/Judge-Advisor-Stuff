import assert from "node:assert/strict";
import test from "node:test";

import type { Store } from "../src/lib/db/types";
import { StoreError } from "../src/lib/db/types";

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
      field: "Field 1",
      rule: "SG6",
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
      field: "Field 2",
      rule: null,
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
      field: "Field 1",
      rule: "SG6",
    });

    await store.resetDay();
    assert.equal(
      (await store.listFlags()).length,
      1,
      "repeat-violation history is event-wide and survives a day reset",
    );
    assert.equal((await store.listRequests()).length, 0, "the day's queue does not");
    assert.equal((await store.listTeams()).length, 1, "nor does the roster go");

    await store.resetAll();
    assert.deepEqual(await store.listFlags(), [], "a full wipe is the event boundary");
    assert.deepEqual(await store.listTeams(), []);
    assert.deepEqual(await store.listPanels(), []);
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

  it("a panel code is found case-insensitively, and only while it exists", async (store) => {
    const panel = await store.createPanel(panelInput({ code: "CONF01" }));
    assert.equal((await store.findPanelByCode("conf01"))?.id, panel.id);
    await store.deletePanel(panel.id);
    assert.equal(await store.findPanelByCode("CONF01"), null, "a deleted panel signs nobody in");
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
