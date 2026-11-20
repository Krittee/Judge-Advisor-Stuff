import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { AdminFrame, SECTION_GROUPS } from "../src/components/admin/AdminFrame";
import { EventTab } from "../src/components/admin/EventTab";
import { outsideRows } from "../src/components/admin/eventLogic";
import { awards, presetDivisions } from "../src/lib/presets";
import type { AppState, AwardsAdminView, ReleasedView } from "../src/lib/types";

/* The Event page and its chrome, rendered to markup. A tap, the arrow keys and the 409 path need a browser: the 409's lists run as outsideRows below. */

const noop = () => {};
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");
const eventSetup = { program: "VEX IQ", format: "blended" as const, set_by: "Alex Morgan", updated_at: "2026-11-20T08:12:00" };
const team = (id: string, number: string, division: string) => ({ id, number, name: `Team ${number}`, division });
const state = (over: Partial<AppState> = {}) => ({ teams: [], panels: [], eventSetup: null, ...over }) as unknown as AppState;
const view: AwardsAdminView = { awards: awards(), nominations: [], winners: [], noWinners: [] };
const released: ReleasedView = { awards: [], divisions: [], programs: [], releases: [] };
const tab = (s: AppState, over: Partial<Parameters<typeof EventTab>[0]> = {}) =>
  renderToStaticMarkup(<EventTab state={s} awards={view} released={released} refresh={noop} reloadAwards={async () => {}} onError={noop} onOpenTab={noop} {...over} />);

test("not set up yet: the notice, no picked tile, an empty preview, Save disabled with its hint", () => {
  const m = tab(state());
  assert.ok(text(m).includes(`Not set up yet. The event uses the divisions from the config (${presetDivisions().join(", ")}) and gives every award once per division, as today.`));
  assert.ok(!m.includes('aria-checked="true"'));
  assert.ok(m.includes("Pick a program and format to see the awards."));
  assert.ok(m.includes("Pick a program and format to save."));
  assert.match(m, /<button[^>]*class="ja-es-prim"[^>]*disabled=""|<button[^>]*disabled=""[^>]*class="ja-es-prim"/);
  assert.ok(!m.includes("Before you can save"));
  assert.ok(!m.includes("Set by"));
});

test("four tiles in one radiogroup; the saved one is picked, tagged Saved, with its preview and the footer", () => {
  const m = tab(state({ eventSetup }));
  assert.ok(m.includes('role="radiogroup"'));
  assert.equal((m.match(/role="radio"/g) ?? []).length, 4);
  assert.equal((m.match(/aria-checked="true"/g) ?? []).length, 1);
  const picked = m.match(/<button[^>]*aria-checked="true"[\s\S]*?<\/button>/)![0];
  assert.ok(picked.includes("VEX IQ · Blended") && picked.includes("Saved"));
  assert.equal((m.match(/Saved/g) ?? []).length, 1);
  assert.ok(!m.includes("Not set up yet"));
  assert.ok(text(m).includes("Set by Alex Morgan at 08:12"));
  assert.ok(m.includes("Whole event") && m.includes("Judges (2)") && m.includes("Any panel can interview any team."));
  // all three rows green, Save disabled with no hint: nothing changed
  assert.equal((m.match(/aria-label="Fine"/g) ?? []).length, 3);
  assert.ok(!m.includes("Fix the items above to save."));
});

test("each tile is named by its title, and the saved one is described by its Saved tag", () => {
  const m = tab(state({ eventSetup }));
  const radios = [...m.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((x) => x[0]);
  assert.equal(radios.length, 4);
  const nameOf = (r: string) => {
    const id = /aria-labelledby="([^"]+)"/.exec(r)![1];
    return text(new RegExp(`<b id="${id.replace(/[:]/g, "\\$&")}">[\\s\\S]*?</b>`).exec(m)![0]);
  };
  assert.deepEqual(radios.map(nameOf), ["VEX IQ · Standard", "VEX IQ · Blended", "V5RC · Standard", "V5RC · Blended"]);
  const described = radios.filter((r) => r.includes("aria-describedby"));
  assert.equal(described.length, 1);
  assert.ok(described[0].includes("aria-checked=\"true\""));
  const sid = /aria-describedby="([^"]+)"/.exec(described[0])![1];
  assert.ok(m.includes(`id="${sid}"`) && text(new RegExp(`id="${sid}"[\\s\\S]*?</span>`).exec(m)![0]).includes("Saved"));
});

test("a saved setup with a decided award: the saved tile picked again stays green", () => {
  const decided = { ...view, winners: [{ award_id: "excellence", division: "Elementary School", team_id: "a", decided_by: "x", decided_at: "" }] };
  assert.equal((tab(state({ eventSetup }), { awards: decided, released: { ...released, setup: eventSetup } }).match(/aria-label="Fine"/g) ?? []).length, 3);
});

test("the checklist waits for the awards: Checking, Save disabled", () => {
  const m = tab(state({ eventSetup }), { awards: null });
  assert.ok(m.includes('aria-label="Checking"') && m.includes("checking…"));
  assert.match(m, /<button[^>]*class="ja-es-prim"[^>]*disabled=""|<button[^>]*disabled=""[^>]*class="ja-es-prim"/);
});

test("the 409's outside list rebuilds the Teams and Panels rows with number, name, tag and the panel lines", () => {
  const rows = outsideRows(
    { teams: [{ id: "a", number: "41111A", division: "Elementary School" }], panels: [{ id: "p3", name: "Panel 3", division: "Elementary School" }] },
    [team("a", "41111A", "Elementary School")],
    "V5RC",
  );
  assert.equal(rows[0].text, "1 team is in Elementary School, which V5RC doesn't have");
  assert.deepEqual(rows[0].items, [{ id: "a", main: "41111A", sub: "Team 41111A", tag: "ES" }]);
  assert.equal(rows[1].text, "Panel 3 · Elementary School");
});

test("the rail's Setup group is Event, Teams, Panels, Conflicts, Import", () => {
  const setup = SECTION_GROUPS.find((g) => g.label === "Setup")!;
  assert.deepEqual(setup.items.map((i) => i.id), ["event", "teams", "panels", "conflicts", "import"]);
});

const router = {} as React.ContextType<typeof AppRouterContext>;
const frame = (over: Partial<Parameters<typeof AdminFrame>[0]> = {}) =>
  renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <AdminFrame name="Alex Morgan" online tab="event" onTab={noop} counts={{}} {...over}>
        <p>the tab</p>
      </AdminFrame>
    </AppRouterContext.Provider>,
  );

test("the top bar and the phone bar are titled with the setup, and say nothing without one", () => {
  assert.ok(!frame({ setup: null }).includes("VEX IQ"));
  assert.ok(!frame().includes("ja-bd"));
  const m = frame({ setup: { program: "VEX IQ", format: "blended" } });
  assert.ok(m.includes('<span class="ja-bd-s">VEX IQ · Blended</span>'));
  assert.ok(m.includes('<span class="ja-rc">VEX IQ · Blended</span>'));
  // the phone bar's label is the Event page's only
  assert.ok(!frame({ setup: { program: "VEX IQ", format: "blended" }, tab: "floor" }).includes('<span class="ja-rc">VEX IQ · Blended</span>'));
});
