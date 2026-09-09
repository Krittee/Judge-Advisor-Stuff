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

test("every category from the Quick Reference is present, in order, with no extras", () => {
  const seen = [...new Set(RULES.map((r) => r.category))];
  assert.deepEqual(seen, RULE_CATEGORIES);
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

test("the full 8-category, 78-rule Quick Reference is present", () => {
  assert.equal(RULES.length, 78);
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
