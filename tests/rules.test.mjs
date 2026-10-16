import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  commonFieldRules,
  getRuleset,
  isValidRuleId,
  isValidRulesetId,
  joinRuleList,
  manualLabel,
  parseRuleList,
  ruleDisplayLabel,
  RULESETS,
  searchRules,
} from "../src/lib/rules";

/* The rulesets a referee cites: VEX IQ and V5RC Override. These run against
   the real src/lib/rules.ts (tsx resolves the TypeScript and the JSON in
   config/rules/), not a hand-mirrored copy, so a change to the module or to
   the data files is what these tests see. */

const RULE_CATEGORIES = [
  "Scoring Rules",
  "Specific Game Rules",
  "Safety Rules",
  "General Rules",
  "General Game Rules",
  "Robot Skills Challenge Rules",
  "Robot Rules",
  "Tournament Rules",
  "Tournament Special",
];

const IQ = getRuleset("viqrc");
const V5 = getRuleset("v5rc");
/** The rules a ruleset ships itself, without the shared event specials. */
const official = (rs) => rs.rules.filter((r) => r.category !== "Tournament Special");

/* ---- the catalog itself ------------------------------------------------ */

test("two rulesets are offered, VEX IQ first, and each says which program and manual it is", () => {
  assert.deepEqual(RULESETS.map((r) => r.id), ["viqrc", "v5rc"]);
  assert.equal(IQ.label, "VEX IQ");
  assert.equal(IQ.manualVersion, null, "the IQ data records no manual edition");
  assert.equal(V5.label, "V5RC Override");
  assert.equal(V5.game, "Override");
  assert.equal(V5.manualVersion, "2.1");
});

test("rulesets resolve by id, and anything unknown or missing is VEX IQ", () => {
  assert.equal(getRuleset("v5rc").id, "v5rc");
  assert.equal(getRuleset("viqrc").id, "viqrc");
  for (const unknown of [undefined, null, "", "nope", "V5RC "]) {
    assert.equal(getRuleset(unknown).id, "viqrc", `${JSON.stringify(unknown)} should fall back to IQ`);
  }
  assert.ok(isValidRulesetId("v5rc") && isValidRulesetId("viqrc"));
  for (const bad of [undefined, null, "", "nope", 5]) assert.ok(!isValidRulesetId(bad));
});

test("each ruleset lists its categories in the manual's order, Tournament Special last", () => {
  for (const rs of [IQ, V5]) {
    assert.deepEqual([...new Set(rs.rules.map((r) => r.category))], RULE_CATEGORIES, rs.id);
  }
});

test("IQ ids are in the required order and assigned to their exact categories", () => {
  const groups = [
    ["Scoring Rules", "SC", 5],
    ["Specific Game Rules", "SG", 7],
    ["Safety Rules", "S", 3],
    ["General Rules", "G", 5],
    ["General Game Rules", "GG", 14],
    ["Robot Skills Challenge Rules", "RSC", 8],
    ["Robot Rules", "R", 17],
    ["Tournament Rules", "T", 19],
    ["Tournament Special", "TS", 3],
  ];
  const expected = groups.flatMap(([category, prefix, count]) =>
    Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index + 1}`, category })),
  );
  assert.deepEqual(IQ.rules.map(({ id, category }) => ({ id, category })), expected);
});

test("V5RC ids are in the required order and assigned to their exact categories", () => {
  const groups = [
    ["Scoring Rules", "SC", 8],
    ["Specific Game Rules", "SG", 13],
    ["Safety Rules", "S", 5],
    ["General Rules", "G", 5],
    ["General Game Rules", "GG", 18],
    ["Robot Skills Challenge Rules", "RSC", 5],
    ["Robot Rules", "R", 28],
    ["Tournament Rules", "T", 24],
    ["Tournament Special", "TS", 3],
  ];
  const expected = groups.flatMap(([category, prefix, count]) =>
    Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index + 1}`, category })),
  );
  assert.deepEqual(V5.rules.map(({ id, category }) => ({ id, category })), expected);
});

test("rule ids are unique within each ruleset", () => {
  for (const rs of RULESETS) {
    const ids = rs.rules.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, `${rs.id} repeats a rule id`);
  }
});

test("every rule has an official title and at least one keyword; IQ also has short labels", () => {
  for (const rs of RULESETS) {
    for (const r of rs.rules) {
      assert.ok(r.officialTitle.length > 2, `${rs.id} ${r.id} has no official title`);
      assert.ok(r.searchKeywords.length > 0, `${rs.id} ${r.id} has no search keywords`);
      assert.equal(r.displayId, `<${r.id}>`, `${r.id}'s displayId is not <${r.id}>`);
    }
  }
  for (const r of official(IQ)) assert.ok(r.shortLabel && r.shortLabel.length > 1, `${r.id} has no short label`);
  for (const r of official(V5)) assert.equal(r.shortLabel, undefined, `V5 ${r.id} should have no short label`);
});

test("IQ keeps its 78 official rules and V5RC its 106, each plus three Tournament Special", () => {
  assert.equal(official(IQ).length, 78);
  assert.equal(IQ.rules.length, 81);
  assert.equal(official(V5).length, 106);
  assert.equal(V5.rules.length, 109);
});

test("every IQ official title exactly preserves the supplied Quick Reference wording", () => {
  const expected = {
    SC1: "All scoring statuses are evaluated after the Match ends",
    SC2: "All scoring statuses are evaluated visually by a Head Referee",
    SC3: "Scored Bean Bag in a Floor Goal criteria",
    SC4: "Scored Bean Bag in a L1, L2, or L3 Goal criteria",
    SC5: "Scored Bean Bag on a L4 Goal criteria",
    SG1: "Starting a Match",
    SG2: "Horizontal expansion is limited",
    SG3: "Vertical expansion is unlimited",
    SG4: "Keep Scoring Objects in the Field",
    SG5: "Each Robot gets one yellow Bean Bag as a Preload",
    SG6: "Possession / Plowing is limited to a maximum of one (1) Bean Bag",
    SG7: "Using the Load Zone",
    S1: "Stay safe, don’t damage the Field",
    S2: "Students must be accompanied by an Adult",
    S3: "Each Student Team member must have a completed participant release form on file",
    G1: "Participants must follow the Code of Conduct",
    G2: "Participants must follow the Student Centered Policy",
    G3: "Use common sense",
    G4: "Students must meet the Student Eligibility Policy requirements",
    G5: "There is a difference between accidentally and willfully violating a Robot rule",
    GG1: "Drivers drive your Robot, and stay in the Driver Station",
    GG2: "A Team’s Robot should attend every Match",
    GG3: "Robots on the Field must be ready to play",
    GG4: "Hands out of the Field",
    GG5: "Match Replays are allowed, but rare",
    GG6: "Disqualifications",
    GG7: "Time-outs",
    GG8: "Keep your Robot together",
    GG9: "Don’t damage the Field",
    GG10: "Handling the Robot mid-Match is allowed under certain circumstances",
    GG11: "A Team’s two Drivers switch controllers midway through the Match",
    GG12: "Don’t start before the timer, and stop moving at the end of the Match",
    GG13: "Ending a Match early",
    GG14: "Drive Team Members are permitted to appeal the Head Referee’s ruling",
    RSC1: "Standard rules apply in most cases",
    RSC2: "Scoring Robot Skills Matches",
    RSC3: "Robot and Field setup for Robot Skills Matches",
    RSC4: "Loading and Driver differences",
    RSC5: "Handling Robots during an Autonomous Coding Skills Match",
    RSC6: "Starting an Autonomous Coding Skills Match",
    RSC7: "Autonomous means “no humans”",
    RSC8: "Skills Stop Time",
    R1: "One Robot per Team",
    R2: "Robots must pass inspection",
    R3: "Robots must fit within an 11” x 20” x 15” (279.4mm x 508mm x 381.0mm) volume",
    R4: "License Plates",
    R5: "Let it go after the Match is over",
    R6: "Robots have one Brain",
    R7: "Keep the power button accessible",
    R8: "Firmware",
    R9: "Motors",
    R10: "Batteries",
    R11: "One controller per Robot",
    R12: "Robots are built from the VEX IQ product line",
    R13: "Prohibited items",
    R14: "Legal Non-VEX IQ components",
    R15: "Decorations are allowed",
    R16: "Pneumatics",
    R17: "Modifications of parts",
    T1: "Head Referees have ultimate and final authority on all gameplay and Robot ruling decisions",
    T2: "Head Referees must be qualified",
    T3: "The Drive Team Members are permitted to immediately appeal the Head Referee’s ruling",
    T4: "The Event Partner has ultimate authority regarding all non-gameplay decisions",
    T5: "Be prepared for minor Field variance",
    T6: "Fields and Field Elements may be repaired at the Event Partner’s discretion",
    T7: "Fields at an event must be consistent with each other",
    T8: "Qualification Matches will occur according to the official Match Schedule",
    T9: "Each Team will be scheduled Qualification Matches as follows",
    T10: "Teams are ranked by their average Qualification Match scores",
    T11: "Qualification Match tiebreakers",
    T12: "How Alliances are formed for Teamwork Matches",
    T13: "Teams playing in Finals Matches.",
    T14: "Finals Match Schedule",
    T15: "Skills Match Schedule",
    T16: "No requirement that Skills Fields have the same modifications as the Teamwork Fields",
    T17: "Skills Rankings at events",
    T18: "Skills Rankings globally",
    T19: "Robot Skills at League Events",
  };

  assert.deepEqual(
    Object.fromEntries(official(IQ).map((rule) => [rule.id, rule.officialTitle])),
    expected,
  );
});

test("V5RC titles are the manual's wording, spot-checked, and the IQ-only ids are absent", () => {
  const byId = Object.fromEntries(V5.rules.map((r) => [r.id, r.officialTitle]));
  assert.equal(byId.SG6, "Possession is limited to a maximum of one Pin and one Cup");
  assert.equal(byId.GG17, "No Holding for more than a 3-count");
  assert.equal(byId.GG4, "Hands out of the Field");
  assert.equal(byId.SG9, "Alliance Goals are protected");
  assert.equal(byId.RSC6, undefined, "RSC6 exists only in IQ");
  assert.equal(byId.RSC8, undefined, "RSC8 exists only in IQ");
});

test("Tournament Special TS1-TS3 are present, identical, in BOTH rulesets", () => {
  const specials = (rs) =>
    rs.rules
      .filter((rule) => rule.category === "Tournament Special")
      .map(({ id, officialTitle }) => ({ id, officialTitle }));

  assert.deepEqual(specials(IQ), [
    {
      id: "TS1",
      officialTitle:
        "Teams and individuals are expected to display good sportsmanship toward opponents, officials and volunteers at all times",
    },
    {
      id: "TS2",
      officialTitle:
        "Unsportsmanlike conduct by a Team or individual is a violation and may be penalized",
    },
    { id: "TS3", officialTitle: "A Team may help another Team reset the Field between Matches" },
  ]);
  assert.deepEqual(specials(V5), specials(IQ));

  for (const rulesetId of ["viqrc", "v5rc"]) {
    for (const [query, id] of [
      ["TS1", "TS1"],
      ["sportsmanship", "TS1"],
      ["TS2", "TS2"],
      ["unsportsmanlike", "TS2"],
      ["TS3", "TS3"],
      ["help reset", "TS3"],
    ]) {
      assert.ok(searchRules(query, rulesetId).some((rule) => rule.id === id), `${rulesetId}: ${query} missed ${id}`);
      assert.ok(isValidRuleId(id, rulesetId), `${id} is not valid under ${rulesetId}`);
    }
  }
});

/* ---- common field rule shortcuts --------------------------------------- */

test("every common field rule shortcut references a real rule of ITS ruleset", () => {
  for (const rs of [IQ, V5]) {
    assert.ok(rs.commonRuleIds.length > 0, `${rs.id} has no shortcuts`);
    const shortcuts = commonFieldRules(rs.id);
    assert.deepEqual(shortcuts.map((r) => r.id), rs.commonRuleIds, `${rs.id} lost a shortcut`);
    for (const r of shortcuts) {
      // The very same object as the full list, never a duplicate copy.
      assert.equal(rs.rules.find((x) => x.id === r.id), r, `${rs.id} ${r.id} is a copy`);
    }
  }
  assert.ok(V5.commonRuleIds.includes("GG17"), "V5RC's shortcuts include the 3-count holding rule");
  assert.ok(!IQ.commonRuleIds.includes("GG17"), "IQ has no GG17");
});

/* ---- search ------------------------------------------------------------- */

test("V5RC search: SG6, holding and autonomous each find their rules", () => {
  assert.deepEqual(searchRules("SG6", "v5rc").map((r) => r.id), ["SG6"]);
  assert.ok(searchRules("holding", "v5rc").some((r) => r.id === "GG17"), "\"holding\" missed GG17");

  const expected = V5.rules
    .filter((r) => r.officialTitle.toLowerCase().includes("autonomous"))
    .map((r) => r.id);
  assert.ok(expected.length >= 5, "the data should have several autonomous rules");
  assert.deepEqual(searchRules("autonomous", "v5rc").map((r) => r.id).filter((id) => expected.includes(id)), expected);
  for (const id of ["SC7", "SC8", "SG7", "SG8", "GG12", "GG13"]) {
    assert.ok(expected.includes(id), `${id} has autonomous in its title`);
  }
});

test("search is per-ruleset: an IQ query does not return V5 rules and vice versa", () => {
  assert.ok(searchRules("plow", "viqrc").some((r) => r.id === "SG6"), "IQ SG6 is Possession / Plowing");
  assert.ok(!searchRules("plow", "v5rc").some((r) => r.id === "SG6"), "V5 SG6 has no plowing");
  assert.ok(searchRules("cup", "v5rc").some((r) => r.id === "SG6"));
  assert.ok(!searchRules("cup", "viqrc").some((r) => r.id === "SG6"));
  // No ruleset given is IQ, the same as a legacy flag.
  assert.deepEqual(searchRules("plow").map((r) => r.id), searchRules("plow", "viqrc").map((r) => r.id));
});

test("IQ keeps finding the rules it always did by id, number and keyword", () => {
  for (const query of ["SG6", "<SG6>", "sg6", "6", "possession", "plow", "plowing", "bean bag"]) {
    assert.ok(searchRules(query, "viqrc").some((r) => r.id === "SG6"), `"${query}" did not find SG6`);
  }
  for (const query of ["SG7", "7", "load", "loading", "loader", "load zone"]) {
    assert.ok(searchRules(query, "viqrc").some((r) => r.id === "SG7"), `"${query}" did not find SG7`);
  }
  for (const query of ["GG4", "4", "hand", "hands", "touch", "touching"]) {
    assert.ok(searchRules(query, "viqrc").some((r) => r.id === "GG4"), `"${query}" did not find GG4`);
  }
  for (const query of ["GG12", "12", "timer", "early", "late", "timing"]) {
    assert.ok(searchRules(query, "viqrc").some((r) => r.id === "GG12"), `"${query}" did not find GG12`);
  }
  for (const query of ["S1", "safety", "unsafe", "damage", "field damage"]) {
    assert.ok(searchRules(query, "viqrc").some((r) => r.id === "S1"), `"${query}" did not find S1`);
  }
});

test("a query with no matches returns an empty list; an empty query returns the whole ruleset", () => {
  for (const id of ["viqrc", "v5rc"]) {
    assert.deepEqual(searchRules("xyznonsense", id), []);
    assert.equal(searchRules("", id).length, getRuleset(id).rules.length);
    assert.equal(searchRules("   ", id).length, getRuleset(id).rules.length);
  }
});

test("search is case-insensitive and matches partial terms", () => {
  assert.ok(searchRules("PLOW", "viqrc").some((r) => r.id === "SG6"));
  assert.ok(searchRules("plo", "viqrc").some((r) => r.id === "SG6"));
  assert.ok(searchRules("HOLDING", "v5rc").some((r) => r.id === "GG17"));
  // The prefix is part of the id: "sg" lists the Specific Game rules.
  assert.equal(searchRules("sg", "v5rc").filter((r) => r.id.startsWith("SG")).length, 13);
});

/* ---- validation and display -------------------------------------------- */

test("isValidRuleId accepts a real id in any case, per ruleset, and rejects garbage", () => {
  assert.ok(isValidRuleId("SG6"));
  assert.ok(isValidRuleId("sg6", "v5rc"));
  for (const junk of ["", "SG99", "not-a-rule", null, undefined, 6]) {
    assert.ok(!isValidRuleId(junk), `"${junk}" should not be a valid rule id`);
  }
  // Ids that exist in only one manual.
  assert.ok(isValidRuleId("RSC8", "viqrc"));
  assert.ok(!isValidRuleId("RSC8", "v5rc"), "RSC8 is an IQ-only rule");
  assert.ok(isValidRuleId("GG17", "v5rc"));
  assert.ok(!isValidRuleId("GG17", "viqrc"), "GG17 is a V5RC-only rule");
});

test("ruleDisplayLabel reads \"<ID> — official title\" for both rulesets, null with nothing to show", () => {
  assert.equal(
    ruleDisplayLabel("SG6", "v5rc"),
    "<SG6> — Possession is limited to a maximum of one Pin and one Cup",
  );
  assert.equal(
    ruleDisplayLabel("sg6", "viqrc"),
    "<SG6> — Possession / Plowing is limited to a maximum of one (1) Bean Bag",
  );
  assert.equal(ruleDisplayLabel("SG6"), ruleDisplayLabel("SG6", "viqrc"), "no ruleset is IQ");
  assert.equal(ruleDisplayLabel("RSC8", "v5rc"), null, "an id from the other manual is not shown as a rule");
  assert.equal(ruleDisplayLabel(null), null);
  assert.equal(ruleDisplayLabel(undefined), null);
  assert.equal(ruleDisplayLabel(""), null);
  assert.equal(ruleDisplayLabel("not-a-rule"), null);
});

test("manualLabel comes from the data, and is just the label when no version is recorded", () => {
  assert.equal(manualLabel(V5), "Override Manual v2.1");
  assert.equal(manualLabel(IQ), "VEX IQ");
  assert.equal(manualLabel({ ...V5, manualVersion: "3.0" }), "Override Manual v3.0");
});

/* ---- a flag stores its rules as one comma-joined list ------------------- */

test("parseRuleList trims, uppercases and de-duplicates, keeping the first-seen order", () => {
  assert.deepEqual(parseRuleList("GG17,SG9"), ["GG17", "SG9"]);
  assert.deepEqual(parseRuleList(" gg17 , sg9,GG17 ,, "), ["GG17", "SG9"]);
  assert.deepEqual(parseRuleList("SG6"), ["SG6"], "a legacy single-rule flag is a one-item list");
  for (const none of [null, undefined, "", "  ", ",,"]) assert.deepEqual(parseRuleList(none), []);
});

test("joinRuleList is the inverse, and null when there is nothing to store", () => {
  assert.equal(joinRuleList(["GG17", "SG9"]), "GG17,SG9");
  assert.equal(joinRuleList(["gg17", "GG17", " sg9"]), "GG17,SG9");
  assert.equal(joinRuleList([]), null);
  assert.deepEqual(parseRuleList(joinRuleList(["SG9", "GG17"])), ["SG9", "GG17"]);
});

/* ---- the module really does read config/rules, not an inline copy ------- */

test("src/lib/rules.ts sources its data from the files in config/rules", () => {
  const src = readFileSync(new URL("../src/lib/rules.ts", import.meta.url), "utf8");
  for (const file of ["viqrc.json", "v5rc-override-2.1.json", "event-specials.json"]) {
    assert.ok(
      src.includes(`../../config/rules/${file}`),
      `rules.ts no longer reads config/rules/${file} -- the data files are the single source of the rules`,
    );
  }
});
