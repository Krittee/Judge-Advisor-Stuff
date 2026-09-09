import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/* The VIQRC Level Up Quick Reference rule list. Reads the real data file
   (JSON, so no TS loader needed) and mirrors src/lib/rules.ts's parsing
   and search logic, the way the other lib tests mirror their .ts source. */

const raw = JSON.parse(readFileSync(new URL("../config/rules.json", import.meta.url)));

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

const COMMON_FIELD_RULE_IDS = ["SG6", "SG7", "GG4", "GG10", "GG12", "SG2", "S1"];

function parseRules(list) {
  return list
    .map((entry) => {
      const o = entry ?? {};
      const id = String(o.id ?? "").trim().toUpperCase();
      const category = String(o.category ?? "").trim();
      const officialTitle = String(o.officialTitle ?? "").trim();
      const shortLabel = String(o.shortLabel ?? "").trim();
      if (!id || !category || !officialTitle || !shortLabel) return null;
      const searchKeywords = Array.isArray(o.searchKeywords)
        ? o.searchKeywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean)
        : [];
      return {
        id,
        displayId: `<${id}>`,
        category,
        officialTitle,
        shortLabel,
        searchKeywords: [...new Set([id.toLowerCase(), ...searchKeywords])],
      };
    })
    .filter((r) => r !== null);
}

const RULES = parseRules(raw);
const BY_ID = new Map(RULES.map((r) => [r.id, r]));

function isValidRuleId(id) {
  return typeof id === "string" && BY_ID.has(id.trim().toUpperCase());
}

function ruleDisplayLabel(id) {
  const found = id ? BY_ID.get(String(id).trim().toUpperCase()) : null;
  return found ? `${found.displayId} ${found.shortLabel}` : null;
}

function searchRules(query) {
  const q = query.trim().toLowerCase();
  if (!q) return RULES;
  return RULES.filter(
    (r) =>
      r.id.toLowerCase().includes(q) ||
      r.displayId.toLowerCase().includes(q) ||
      r.shortLabel.toLowerCase().includes(q) ||
      r.officialTitle.toLowerCase().includes(q) ||
      r.searchKeywords.some((k) => k.includes(q)),
  );
}

/* ---- the catalog itself ------------------------------------------------ */

test("official categories are followed by the event's Tournament Special category", () => {
  const seen = [...new Set(RULES.map((r) => r.category))];
  assert.deepEqual(seen, RULE_CATEGORIES);
});

test("every rule id is in the required order and assigned to its exact category", () => {
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
  assert.deepEqual(RULES.map(({ id, category }) => ({ id, category })), expected);
});

test("every rule id is unique", () => {
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "a rule id is duplicated");
});

test("every rule has an official title, a short label and at least one keyword", () => {
  for (const r of RULES) {
    assert.ok(r.officialTitle.length > 2, `${r.id} has no official title`);
    assert.ok(r.shortLabel.length > 1, `${r.id} has no short label`);
    assert.ok(r.searchKeywords.length > 0, `${r.id} has no search keywords`);
    assert.equal(r.displayId, `<${r.id}>`, `${r.id}'s displayId is not <${r.id}>`);
  }
});

test("the 78 official rules and three Tournament Special rules are present", () => {
  assert.equal(RULES.length, 81);
});

test("every official title exactly preserves the supplied Quick Reference wording", () => {
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
    Object.fromEntries(
      RULES.filter((rule) => rule.category !== "Tournament Special").map((rule) => [rule.id, rule.officialTitle]),
    ),
    expected,
  );
});

test("Tournament Special preserves TS1-TS3 and their event-specific titles", () => {
  assert.deepEqual(
    RULES.filter((rule) => rule.category === "Tournament Special").map(
      ({ id, officialTitle }) => ({ id, officialTitle }),
    ),
    [
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
      {
        id: "TS3",
        officialTitle: "A Team may help another Team reset the Field between Matches",
      },
    ],
  );

  for (const [query, id] of [
    ["TS1", "TS1"],
    ["sportsmanship", "TS1"],
    ["TS2", "TS2"],
    ["unsportsmanlike", "TS2"],
    ["TS3", "TS3"],
    ["help reset", "TS3"],
  ]) {
    assert.ok(searchRules(query).some((rule) => rule.id === id), `${query} missed ${id}`);
  }
});

/* ---- common field rule shortcuts --------------------------------------- */

test("every common field rule shortcut references a real rule -- not a duplicate object", () => {
  for (const id of COMMON_FIELD_RULE_IDS) {
    assert.ok(BY_ID.has(id), `${id} is listed as a common field rule but is not in the catalog`);
  }
  // Exactly one entry per id in the whole catalog: a "duplicate object"
  // bug would show up here as more than one match.
  for (const id of COMMON_FIELD_RULE_IDS) {
    assert.equal(RULES.filter((r) => r.id === id).length, 1, `${id} appears more than once`);
  }
});

/* ---- search: the mandated SG6 queries ---------------------------------- */

test("SG6 is found by id, bracketed id, number, and every given keyword", () => {
  for (const query of ["SG6", "<SG6>", "sg6", "6", "possession", "plow", "plowing", "bean bag"]) {
    const hit = searchRules(query).some((r) => r.id === "SG6");
    assert.ok(hit, `"${query}" did not find SG6`);
  }
});

test("SG7 is found by load-related terms", () => {
  for (const query of ["SG7", "7", "load", "loading", "loader", "load zone"]) {
    assert.ok(searchRules(query).some((r) => r.id === "SG7"), `"${query}" did not find SG7`);
  }
});

test("GG4 is found by hand-related terms, and \"hand\" also surfaces other handling rules", () => {
  for (const query of ["GG4", "4", "hand", "hands", "touch", "touching"]) {
    assert.ok(searchRules(query).some((r) => r.id === "GG4"), `"${query}" did not find GG4`);
  }
  // "hand" is deliberately broad -- GG10's "Robot Handling" and RSC5's
  // "Autonomous Robot Handling" both legitimately contain it.
  const handMatches = searchRules("hand").map((r) => r.id);
  assert.ok(handMatches.includes("GG10"), "\"hand\" should also surface GG10 (Robot Handling)");
});

test("GG10, GG12 and SG2 are found by their given keywords", () => {
  for (const query of ["GG10", "10", "handling", "robot reset"]) {
    assert.ok(searchRules(query).some((r) => r.id === "GG10"), `"${query}" did not find GG10`);
  }
  for (const query of ["GG12", "12", "timer", "early", "late", "timing"]) {
    assert.ok(searchRules(query).some((r) => r.id === "GG12"), `"${query}" did not find GG12`);
  }
  for (const query of ["SG2", "2", "horizontal", "expansion", "24"]) {
    assert.ok(searchRules(query).some((r) => r.id === "SG2"), `"${query}" did not find SG2`);
  }
});

test("S1 is found by safety-related terms", () => {
  for (const query of ["S1", "safety", "unsafe", "damage", "field damage"]) {
    assert.ok(searchRules(query).some((r) => r.id === "S1"), `"${query}" did not find S1`);
  }
});

test("a query with no matches returns an empty list, not everything", () => {
  assert.deepEqual(searchRules("xyznonsense"), []);
});

test("an empty query returns the whole catalog", () => {
  assert.equal(searchRules("").length, RULES.length);
  assert.equal(searchRules("   ").length, RULES.length);
});

test("search is case-insensitive and matches partial terms", () => {
  assert.ok(searchRules("PLOW").some((r) => r.id === "SG6"));
  assert.ok(searchRules("plo").some((r) => r.id === "SG6"));
});

/* ---- validation and display -------------------------------------------- */

test("isValidRuleId accepts a real id in any case, and rejects garbage", () => {
  assert.ok(isValidRuleId("SG6"));
  assert.ok(isValidRuleId("sg6"));
  for (const junk of ["", "SG99", "not-a-rule", null, undefined, 6]) {
    assert.ok(!isValidRuleId(junk), `"${junk}" should not be a valid rule id`);
  }
});

test("ruleDisplayLabel reads \"<ID> Short Label\", and is null with nothing to show", () => {
  assert.equal(ruleDisplayLabel("SG6"), "<SG6> Possession / Plowing");
  assert.equal(ruleDisplayLabel("sg6"), "<SG6> Possession / Plowing");
  assert.equal(ruleDisplayLabel(null), null);
  assert.equal(ruleDisplayLabel(undefined), null);
  assert.equal(ruleDisplayLabel(""), null);
  assert.equal(ruleDisplayLabel("not-a-rule"), null);
});

/* ---- the module really does read config/rules.json, not an inline copy - */

test("src/lib/rules.ts sources its data from config/rules.json", () => {
  const src = readFileSync(new URL("../src/lib/rules.ts", import.meta.url), "utf8");
  assert.ok(
    src.includes('import rulesFile from "../../config/rules.json"'),
    "rules.ts no longer reads config/rules.json -- SG6 in Common Field Rules and SG6 under " +
      "Specific Game Rules must reference the same underlying data",
  );
});
