import assert from "node:assert/strict";
import test from "node:test";
import { awards, presetPrograms } from "../src/lib/presets";
import { canSave, checklist, outsideRows, previewGroups, tiles } from "../src/components/admin/eventLogic";

/* The Event page's pure pieces: the four tiles, the preview, the "Before you can save" rows. */

const programs = presetPrograms();
const list = awards();
const ES = "Elementary School";
const MS = "Middle School";
const HS = "High School";

const IQ = { program: "VEX IQ", format: "blended" };
const IQ_STD = { program: "VEX IQ", format: "standard" };
const win = (award_id, division, team_id = "t1") => ({ award_id, division, team_id, decided_by: "Alex", decided_at: "2026-11-20T09:00:00Z" });
const sent = (award_id, division) => ({ award_id, division, teams: [], no_winner: true, previous: null, status: "sent", sent_at: "", sent_by: "", changed_at: null });
const view = (over = {}) => ({ awards: list, nominations: [], winners: [], noWinners: [], ...over });
const released = (over = {}) => ({ awards: [], divisions: [], programs: [], releases: [], ...over });
const team = (id, number, division) => ({ id, number, name: `Team ${number}`, division });
const panel = (id, name, division) => ({ id, name, division });
const ctx = (over = {}) => ({ awards: view(), released: released(), teams: [], panels: [], ...over });

test("tiles: programs x [standard, blended] in config order, with the counts from the config", () => {
  const t = tiles(programs, list);
  assert.deepEqual(t.map((x) => x.title), ["VEX IQ · Standard", "VEX IQ · Blended", "V5RC · Standard", "V5RC · Blended"]);
  assert.deepEqual(t.map((x) => x.awardCount), [22, 13, 22, 13]);
  assert.deepEqual(t[0].divisions, [ES, MS]);
  assert.deepEqual(t[2].divisions, [MS, HS]);
  assert.equal(t[0].line, "22 awards · every award per division");
  assert.equal(t[1].line, "13 awards · Excellence and Design per division, 9 for the whole event");
});

test("previewGroups: blended is ES 2, MS 2, Whole event 9 (Judges shown with its places); standard is 11 each", () => {
  const b = previewGroups([ES, MS], "blended", list);
  assert.deepEqual(b.map((g) => [g.key, g.labels.length]), [[ES, 2], [MS, 2], ["Whole event", 9]]);
  assert.ok(b[2].labels.includes("Judges (2)"));
  assert.deepEqual(b[0].labels, ["Excellence", "Design"]);
  const s = previewGroups([ES, MS], "standard", list);
  assert.deepEqual(s.map((g) => [g.key, g.labels.length]), [[ES, 11], [MS, 11]]);
});

test("checklist: decided awards block it with the counts; the saved setup is what is counted", () => {
  const rows = checklist(IQ_STD, ctx({ awards: view({ winners: [win("excellence", ES)] }), released: released({ releases: [sent("design", MS)], setup: IQ }) }));
  assert.equal(rows[0].id, "awards");
  assert.equal(rows[0].ok, false);
  assert.ok(rows[0].text.includes("Clear the awards first."));
  assert.ok(rows[0].text.includes("1 of 13 decided, 1 sent to Marketing"), rows[0].text);
  // with no saved setup it counts under the picked one
  const none = checklist(IQ_STD, ctx({ awards: view({ winners: [win("excellence", ES)] }), released: released({ releases: [sent("design", MS)] }) }));
  assert.ok(none[0].text.includes("1 of 22 decided, 1 sent to Marketing"), none[0].text);
  assert.deepEqual(rows.map((r) => r.id), ["awards", "teams", "panels"]);
});

test("checklist: decisions under a division outside the program are counted, once per (award, division)", () => {
  const rows = checklist(IQ, ctx({ awards: view({ winners: [win("excellence", HS), win("judges", HS, "t1"), win("judges", HS, "t2")], noWinners: [{ award_id: "design", division: "Blended", decided_by: "A", decided_at: "" }] }) }));
  assert.equal(rows[0].ok, false);
  assert.ok(rows[0].text.includes("3 of 13 decided"), rows[0].text);
});

test("checklist: a recalled release does not block, a 'No winner' does", () => {
  const recalled = checklist(IQ_STD, ctx({ released: released({ releases: [{ ...sent("design", MS), status: "recalled" }] }) }));
  assert.equal(recalled[0].ok, true);
  const none = checklist(IQ_STD, ctx({ awards: view({ noWinners: [{ award_id: "design", division: MS, decided_by: "A", decided_at: "" }] }) }));
  assert.equal(none[0].ok, false);
});

test("checklist: teams and panels outside the picked program are listed", () => {
  const rows = checklist(
    { program: "VEX IQ", format: "standard" },
    ctx({ teams: [team("a", "1010M", HS), team("b", "2020P", ES)], panels: [panel("p1", "Panel 3", HS), panel("p2", "Panel 1", "Whole event")] }),
  );
  assert.equal(rows[1].ok, false);
  assert.equal(rows[1].text, "1 team is in High School, which VEX IQ doesn't have");
  assert.deepEqual(rows[1].items, [{ id: "a", main: "1010M", sub: "Team 1010M", tag: "HS" }]);
  assert.equal(rows[2].ok, false);
  assert.equal(rows[2].text, "Panel 3 · High School, Panel 1 · Whole event");
  assert.equal(rows[2].items, undefined);
  // blended lets a panel sit under "Whole event"
  const blended = checklist(IQ, ctx({ panels: [panel("p2", "Panel 1", "Whole event")] }));
  assert.equal(blended[2].ok, true);
});

test("checklist: all fine is three green rows; no awards loaded yet is ok:null; plural wording", () => {
  const rows = checklist(IQ, ctx());
  assert.deepEqual(rows.map((r) => r.ok), [true, true, true]);
  assert.equal(rows[0].text, "none decided");
  assert.equal(rows[1].text, "all in the program's divisions");
  assert.equal(checklist(IQ, ctx({ awards: null }))[0].ok, null);
  const two = checklist(IQ, ctx({ teams: [team("a", "1", HS), team("b", "2", HS)] }));
  assert.equal(two[1].text, "2 teams are in High School, which VEX IQ doesn't have");
});

test("checklist: the saved setup picked again shows the awards row green even with decisions", () => {
  const rows = checklist(IQ, ctx({ awards: view({ winners: [win("excellence", ES)] }), released: released({ setup: IQ }) }));
  assert.equal(rows[0].ok, true);
});

test("checklist: the saved setup picked again is three green rows whatever the awards, teams and panels say", () => {
  const rows = checklist(
    IQ,
    ctx({ awards: view({ winners: [win("excellence", ES)] }), released: released({ setup: IQ, releases: [sent("design", MS)] }), teams: [team("a", "1010M", HS)], panels: [panel("p1", "Panel 3", HS)] }),
  );
  assert.deepEqual(rows.map((r) => r.ok), [true, true, true]);
  assert.deepEqual(rows.map((r) => r.items), [undefined, undefined, undefined]);
});

test("checklist: a saved program the config no longer lists falls back without throwing", () => {
  const rows = checklist(IQ_STD, ctx({ released: released({ setup: { program: "Gone", format: "blended" } }), awards: view({ winners: [win("excellence", ES)] }) }));
  assert.equal(rows[0].ok, false);
  assert.equal(tiles(programs, list).length, 4);
});

test("outsideRows rebuilds Teams and Panels from a 409 reply, names from the teams list", () => {
  const rows = outsideRows(
    { teams: [{ id: "a", number: "1010M", division: ES }], panels: [{ id: "p1", name: "Panel 3", division: ES }] },
    [team("a", "1010M", ES)],
    "V5RC",
  );
  assert.deepEqual(rows.map((r) => [r.id, r.ok]), [["teams", false], ["panels", false]]);
  assert.equal(rows[0].text, "1 team is in Elementary School, which V5RC doesn't have");
  assert.deepEqual(rows[0].items, [{ id: "a", main: "1010M", sub: "Team 1010M", tag: "ES" }]);
  assert.equal(rows[1].text, "Panel 3 · Elementary School");
  assert.deepEqual(outsideRows({ teams: [], panels: [] }, []).map((r) => r.ok), [true, true]);
});

test("canSave: only when something is picked, it differs from the saved, and every row is fine", () => {
  const ok = [{ id: "awards", ok: true, text: "" }];
  const bad = [{ id: "awards", ok: false, text: "" }];
  const wait = [{ id: "awards", ok: null, text: "" }];
  assert.equal(canSave(null, null, ok), false);
  assert.equal(canSave(IQ, IQ, ok), false);
  assert.equal(canSave(IQ, null, ok), true);
  assert.equal(canSave(IQ_STD, IQ, ok), true);
  assert.equal(canSave(IQ_STD, IQ, bad), false);
  assert.equal(canSave(IQ_STD, IQ, wait), false);
});
