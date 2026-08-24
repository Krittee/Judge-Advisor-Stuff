import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/**
 * The store is TypeScript and reaches for node:fs at import time, so
 * these tests exercise a JS transliteration of its rules rather than the
 * module itself. What is being pinned down here is the behaviour that
 * has no database to fall back on: the two uniqueness invariants, the
 * round-robin assignment, and the file lifecycle.
 */

const LIVE = ["requested", "acknowledged", "interviewing"];

function makeStore(file) {
  let data = load();

  function empty() {
    return { panels: [], teams: [], requests: [], notes: [], activity: [] };
  }

  function load() {
    try {
      return { ...empty(), ...JSON.parse(readFileSync(file, "utf8")) };
    } catch {
      return empty();
    }
  }

  function save() {
    writeFileSync(file, JSON.stringify(data, null, 2));
  }

  return {
    get data() {
      return data;
    },
    reload() {
      data = load();
    },
    addPanel(name, code) {
      const panel = { id: `p-${name}`, name, code, sort_order: data.panels.length };
      data.panels.push(panel);
      save();
      return panel;
    },
    addTeam(number, panelId = null) {
      const team = {
        id: `t-${number}`,
        number: String(number),
        name: `Team ${number}`,
        panel_id: panelId,
      };
      data.teams.push(team);
      save();
      return team;
    },
    createRequest({ teamId, panelId, kind = "queue", slotStart = null }) {
      if (data.requests.some((r) => r.team_id === teamId && LIVE.includes(r.status))) {
        throw new Error("already in the queue");
      }
      if (kind === "slot") {
        const clash = data.requests.some(
          (r) =>
            r.kind === "slot" &&
            r.panel_id === panelId &&
            r.slot_start === slotStart &&
            r.status !== "cancelled",
        );
        if (clash) throw new Error("slot taken");
      }
      const row = {
        id: `r-${data.requests.length}`,
        team_id: teamId,
        panel_id: panelId,
        kind,
        slot_start: slotStart,
        status: kind === "slot" ? "scheduled" : "requested",
      };
      data.requests.push(row);
      save();
      return row;
    },
    updateRequest(id, patch) {
      const row = data.requests.find((r) => r.id === id);
      if (patch.status && LIVE.includes(patch.status) && !LIVE.includes(row.status)) {
        const other = data.requests.some(
          (r) => r.id !== id && r.team_id === row.team_id && LIVE.includes(r.status),
        );
        if (other) throw new Error("team already has a live request");
      }
      Object.assign(row, patch);
      save();
      return row;
    },
    autoAssign(perPanel, includeAssigned = false) {
      const panels = [...data.panels].sort((a, b) => a.sort_order - b.sort_order);
      if (!panels.length) throw new Error("no panels");
      const pending = data.teams.filter((t) => includeAssigned || !t.panel_id);
      const load = new Map(panels.map((p) => [p.id, 0]));
      if (!includeAssigned) {
        for (const t of data.teams) {
          if (t.panel_id && load.has(t.panel_id)) load.set(t.panel_id, load.get(t.panel_id) + 1);
        }
      }
      let assigned = 0;
      for (const team of pending) {
        const target = panels
          .map((p) => ({ id: p.id, count: load.get(p.id) ?? 0 }))
          .filter((p) => p.count < perPanel)
          .sort((a, b) => a.count - b.count)[0];
        if (!target) break;
        load.set(target.id, target.count + 1);
        data.teams.find((t) => t.id === team.id).panel_id = target.id;
        assigned++;
      }
      save();
      return assigned;
    },
    deletePanel(id) {
      data.panels = data.panels.filter((p) => p.id !== id);
      for (const t of data.teams) if (t.panel_id === id) t.panel_id = null;
      for (const r of data.requests) if (r.panel_id === id) r.panel_id = null;
      save();
    },
    saveScore(teamId, rubricId, criterionId, value) {
      let row = data.scores?.find((x) => x.team_id === teamId && x.rubric_id === rubricId);
      data.scores = data.scores ?? [];
      if (!row) {
        row = { team_id: teamId, rubric_id: rubricId, values: {}, total: 0 };
        data.scores.push(row);
      }
      if (value === null) delete row.values[criterionId];
      else row.values[criterionId] = value;
      row.total = Object.values(row.values).reduce((n, v) => n + v, 0);
      save();
      return row;
    },
    clearScore(teamId, rubricId) {
      const before = (data.scores ?? []).length;
      data.scores = (data.scores ?? []).filter(
        (x) => !(x.team_id === teamId && x.rubric_id === rubricId),
      );
      const removed = data.scores.length < before;
      if (removed) save();
      return removed;
    },
    deleteAllPanels() {
      const removed = data.panels.length;
      data.panels = [];
      for (const t of data.teams) t.panel_id = null;
      for (const r of data.requests) r.panel_id = null;
      save();
      return removed;
    },
  };
}

function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), "jq-"));
  try {
    fn(makeStore(join(dir, "state.json")), join(dir, "state.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a team cannot be live in the queue twice", () => {
  withStore((s) => {
    const p = s.addPanel("A", "AAA");
    const t = s.addTeam(1234, p.id);
    s.createRequest({ teamId: t.id, panelId: p.id });
    assert.throws(() => s.createRequest({ teamId: t.id, panelId: p.id }), /already in the queue/);
  });
});

test("finishing an interview frees the team to queue again", () => {
  withStore((s) => {
    const p = s.addPanel("A", "AAA");
    const t = s.addTeam(1234, p.id);
    const r = s.createRequest({ teamId: t.id, panelId: p.id });
    s.updateRequest(r.id, { status: "completed" });
    assert.doesNotThrow(() => s.createRequest({ teamId: t.id, panelId: p.id }));
  });
});

test("cancelling also frees the team", () => {
  withStore((s) => {
    const p = s.addPanel("A", "AAA");
    const t = s.addTeam(1234, p.id);
    const r = s.createRequest({ teamId: t.id, panelId: p.id });
    s.updateRequest(r.id, { status: "cancelled" });
    assert.doesNotThrow(() => s.createRequest({ teamId: t.id, panelId: p.id }));
  });
});

test("re-opening a request cannot create a second live one", () => {
  withStore((s) => {
    const p = s.addPanel("A", "AAA");
    const t = s.addTeam(1234, p.id);
    const first = s.createRequest({ teamId: t.id, panelId: p.id });
    s.updateRequest(first.id, { status: "completed" });
    s.createRequest({ teamId: t.id, panelId: p.id });
    assert.throws(
      () => s.updateRequest(first.id, { status: "requested" }),
      /already has a live request/,
    );
  });
});

test("two teams cannot hold the same panel slot", () => {
  withStore((s) => {
    const p = s.addPanel("A", "AAA");
    const a = s.addTeam(1, p.id);
    const b = s.addTeam(2, p.id);
    const when = "2026-09-01T14:00:00.000Z";
    s.createRequest({ teamId: a.id, panelId: p.id, kind: "slot", slotStart: when });
    assert.throws(
      () => s.createRequest({ teamId: b.id, panelId: p.id, kind: "slot", slotStart: when }),
      /slot taken/,
    );
  });
});

test("the same clock time on a different panel is a different slot", () => {
  withStore((s) => {
    const p1 = s.addPanel("A", "AAA");
    const p2 = s.addPanel("B", "BBB");
    const a = s.addTeam(1, p1.id);
    const b = s.addTeam(2, p2.id);
    const when = "2026-09-01T14:00:00.000Z";
    s.createRequest({ teamId: a.id, panelId: p1.id, kind: "slot", slotStart: when });
    assert.doesNotThrow(() =>
      s.createRequest({ teamId: b.id, panelId: p2.id, kind: "slot", slotStart: when }),
    );
  });
});

test("cancelling a booking releases the slot for someone else", () => {
  withStore((s) => {
    const p = s.addPanel("A", "AAA");
    const a = s.addTeam(1, p.id);
    const b = s.addTeam(2, p.id);
    const when = "2026-09-01T14:00:00.000Z";
    const r = s.createRequest({ teamId: a.id, panelId: p.id, kind: "slot", slotStart: when });
    s.updateRequest(r.id, { status: "cancelled" });
    assert.doesNotThrow(() =>
      s.createRequest({ teamId: b.id, panelId: p.id, kind: "slot", slotStart: when }),
    );
  });
});

test("auto-assign spreads teams evenly and respects the cap", () => {
  withStore((s) => {
    const panels = [s.addPanel("A", "AAA"), s.addPanel("B", "BBB"), s.addPanel("C", "CCC")];
    for (let i = 0; i < 24; i++) s.addTeam(1000 + i);

    const assigned = s.autoAssign(10);
    assert.equal(assigned, 24);

    const counts = panels.map((p) => s.data.teams.filter((t) => t.panel_id === p.id).length);
    assert.deepEqual(counts, [8, 8, 8], "24 teams across 3 panels is 8 each");
  });
});

test("auto-assign stops at the cap and leaves the rest unassigned", () => {
  withStore((s) => {
    s.addPanel("A", "AAA");
    s.addPanel("B", "BBB");
    for (let i = 0; i < 30; i++) s.addTeam(1000 + i);

    const assigned = s.autoAssign(10);
    assert.equal(assigned, 20, "2 panels x 10 = 20 placed");
    assert.equal(s.data.teams.filter((t) => !t.panel_id).length, 10, "10 left over");
  });
});

test("a top-up balances against panels that already have teams", () => {
  withStore((s) => {
    const a = s.addPanel("A", "AAA");
    const b = s.addPanel("B", "BBB");
    for (let i = 0; i < 6; i++) s.addTeam(100 + i, a.id); // A starts loaded
    for (let i = 0; i < 4; i++) s.addTeam(200 + i); // newcomers

    s.autoAssign(10);
    const inA = s.data.teams.filter((t) => t.panel_id === a.id).length;
    const inB = s.data.teams.filter((t) => t.panel_id === b.id).length;
    assert.equal(inB, 4, "all newcomers go to the empty panel");
    assert.equal(inA, 6, "the loaded panel is left alone");
  });
});

test("deleting a panel orphans its teams instead of losing them", () => {
  withStore((s) => {
    const p = s.addPanel("A", "AAA");
    const t = s.addTeam(1234, p.id);
    s.createRequest({ teamId: t.id, panelId: p.id });

    s.deletePanel(p.id);

    assert.equal(s.data.teams.length, 1, "team survives");
    assert.equal(s.data.teams[0].panel_id, null, "team is unassigned");
    assert.equal(s.data.requests.length, 1, "request survives");
    assert.equal(s.data.requests[0].panel_id, null);
  });
});

test("state survives a restart", () => {
  withStore((s, file) => {
    const p = s.addPanel("A", "AAA");
    const t = s.addTeam(1234, p.id);
    s.createRequest({ teamId: t.id, panelId: p.id });

    const reopened = makeStore(file);
    assert.equal(reopened.data.teams.length, 1);
    assert.equal(reopened.data.requests.length, 1);
    assert.equal(reopened.data.requests[0].status, "requested");
  });
});

test("deleting all panels keeps the roster, unassigned", () => {
  withStore((s) => {
    const a = s.addPanel("A", "AAA");
    const b = s.addPanel("B", "BBB");
    const t1 = s.addTeam(1234, a.id);
    const t2 = s.addTeam(5678, b.id);
    s.createRequest({ teamId: t1.id, panelId: a.id });

    const removed = s.deleteAllPanels();

    assert.equal(removed, 2, "reports how many went");
    assert.equal(s.data.panels.length, 0);
    assert.equal(s.data.teams.length, 2, "the roster is expensive to rebuild — it must survive");
    assert.equal(s.data.requests.length, 1, "interview history survives too");
    assert.deepEqual(
      s.data.teams.map((t) => t.panel_id),
      [null, null],
      "every team is released",
    );
    assert.equal(s.data.requests[0].panel_id, null);
    assert.deepEqual(s.data.teams.map((t) => t.number), [String(t1.number), String(t2.number)]);
  });
});

test("deleting all panels twice is harmless", () => {
  withStore((s) => {
    s.addPanel("A", "AAA");
    assert.equal(s.deleteAllPanels(), 1);
    assert.equal(s.deleteAllPanels(), 0, "nothing left to delete, and no error");
  });
});

test("panels can be rebuilt and the surviving teams reassigned", () => {
  withStore((s) => {
    const a = s.addPanel("A", "AAA");
    s.addTeam(1, a.id);
    s.addTeam(2, a.id);
    s.deleteAllPanels();

    const fresh = s.addPanel("New", "NEW");
    assert.equal(s.autoAssign(10), 2, "both released teams pick up the new panel");
    assert.ok(s.data.teams.every((t) => t.panel_id === fresh.id));
  });
});

/* ---- clearing scores ----------------------------------------------- */

test("clearing one rubric leaves the other one alone", () => {
  withStore((s) => {
    s.saveScore("t1", "notebook", "notebook:a", 4);
    s.saveScore("t1", "notebook", "notebook:b", 3);
    s.saveScore("t1", "interview", "interview:a", 2);

    assert.equal(s.clearScore("t1", "notebook"), true);

    const left = s.data.scores;
    assert.equal(left.length, 1);
    assert.equal(left[0].rubric_id, "interview");
    assert.equal(left[0].total, 2, "the interview score is untouched");
  });
});

test("clearing removes the row rather than zeroing it", () => {
  withStore((s) => {
    s.saveScore("t1", "interview", "interview:a", 2);
    s.clearScore("t1", "interview");

    assert.equal(
      s.data.scores.find((x) => x.team_id === "t1"),
      undefined,
      "a zeroed row would rank a cleared team as genuinely bottom-placed",
    );
  });
});

test("a cleared team and a team scored zero stay distinguishable", () => {
  withStore((s) => {
    // t1 is scored zero on every criterion; t2 is scored then cleared.
    s.saveScore("t1", "interview", "interview:a", 0);
    s.saveScore("t1", "interview", "interview:b", 0);
    s.saveScore("t2", "interview", "interview:a", 2);
    s.clearScore("t2", "interview");

    const zeroed = s.data.scores.find((x) => x.team_id === "t1");
    const cleared = s.data.scores.find((x) => x.team_id === "t2");

    assert.equal(zeroed.total, 0);
    assert.equal(Object.keys(zeroed.values).length, 2, "a real zero is still a judgement");
    assert.equal(cleared, undefined, "a cleared team has no judgement at all");
  });
});

test("clearing a rubric that was never scored is harmless", () => {
  withStore((s) => {
    assert.equal(s.clearScore("t1", "notebook"), false);
    assert.deepEqual(s.data.scores ?? [], []);
  });
});

test("clearing one team does not touch another", () => {
  withStore((s) => {
    s.saveScore("t1", "notebook", "notebook:a", 4);
    s.saveScore("t2", "notebook", "notebook:a", 4);

    s.clearScore("t1", "notebook");

    assert.equal(s.data.scores.length, 1);
    assert.equal(s.data.scores[0].team_id, "t2");
  });
});
