import assert from "node:assert/strict";
import test from "node:test";
import { awards, divisionsCompatible, parseAwards, presetDivisions } from "../src/lib/presets";
import {
  WHOLE_EVENT,
  awardKey,
  awardKeys,
  awardPairs,
  awardsUnder,
  divisionChoices,
  keyError,
  scopeKeys,
  setupDivisions,
  setupLabel,
} from "../src/lib/eventSetup";

/* Event setup: program + format. In a Blended event Excellence and Design are decided per
   division and every other award once under "Whole event". */

const ES = "Elementary School";
const MS = "Middle School";
const HS = "High School";
const iq = (format) => ({ program: "VEX IQ", format });
const byId = (id) => awards().find((a) => a.id === id);

test("only Excellence and Design are division-scoped in config", () => {
  assert.deepEqual(awards().filter((a) => a.blendedScope === "division").map((a) => a.id), ["excellence", "design"]);
  assert.deepEqual(parseAwards([{ id: "x" }]), [{ id: "x", label: "x", short: "x", blurb: "", places: 1 }]);
});

test("setupDivisions is the saved program's divisions", () => {
  assert.deepEqual(setupDivisions(iq("blended")), [ES, MS]);
  assert.deepEqual(setupDivisions({ program: "V5RC", format: "standard" }), [MS, HS]);
  assert.equal(setupDivisions(null), null);
  assert.equal(setupDivisions({ program: "Nope", format: "standard" }), null);
});

test("awardKeys and awardKey follow the format", () => {
  const divs = [ES, MS];
  assert.deepEqual(awardKeys(byId("excellence"), divs, "blended"), divs);
  assert.deepEqual(awardKeys(byId("judges"), divs, "blended"), [WHOLE_EVENT]);
  assert.deepEqual(awardKeys(byId("judges"), divs, "standard"), divs);
  assert.deepEqual(awardKeys(byId("judges"), divs, null), divs);
  assert.equal(awardKey(byId("innovate"), MS, "blended"), WHOLE_EVENT);
  assert.equal(awardKey(byId("design"), MS, "blended"), MS);
  assert.equal(awardKey(byId("innovate"), MS, undefined), MS);
});

test("awardsUnder and scopeKeys", () => {
  const all = awards();
  assert.deepEqual(awardsUnder(all, WHOLE_EVENT, "blended").map((a) => a.id), all.filter((a) => a.blendedScope !== "division").map((a) => a.id));
  assert.deepEqual(awardsUnder(all, MS, "blended").map((a) => a.id), ["excellence", "design"]);
  assert.equal(awardsUnder(all, MS, "standard").length, all.length);
  assert.deepEqual(scopeKeys([ES, MS], "blended"), [ES, MS, WHOLE_EVENT]);
  assert.deepEqual(scopeKeys([ES, MS], "standard"), [ES, MS]);
  assert.deepEqual(scopeKeys([ES, MS], null), [ES, MS]);
});

test("awardPairs walks key-major in config order", () => {
  const blended = awardPairs(awards(), [ES, MS], "blended");
  assert.equal(blended.length, 2 * 2 + 9);
  assert.equal(blended.filter((p) => p.award.id === "excellence").length, 2);
  assert.deepEqual(blended.filter((p) => p.award.id === "judges").map((p) => p.division), [WHOLE_EVENT]);
  const plain = awardPairs(awards(), [ES, MS], null);
  assert.equal(plain.length, 22);
  assert.ok(plain.slice(0, 11).every((p) => p.division === ES));
});

test("keyError names the wrong key, and never fires with no setup", () => {
  assert.match(keyError(byId("innovate"), MS, iq("blended")), /whole event/);
  assert.match(keyError(byId("excellence"), WHOLE_EVENT, iq("blended")), /each division/);
  assert.equal(keyError(byId("excellence"), MS, iq("blended")), null);
  assert.equal(keyError(byId("innovate"), WHOLE_EVENT, iq("blended")), null);
  assert.notEqual(keyError(byId("excellence"), HS, iq("standard")), null);
  assert.equal(keyError(byId("excellence"), "Anything", null), null);
});

test("divisionChoices for teams and panels", () => {
  assert.deepEqual(divisionChoices(null, false), { options: presetDivisions(), fallback: presetDivisions()[0] });
  assert.deepEqual(divisionChoices(iq("blended"), true), { options: [ES, MS, WHOLE_EVENT], fallback: WHOLE_EVENT });
  assert.deepEqual(divisionChoices({ program: "V5RC", format: "standard" }, true), { options: [MS, HS], fallback: MS });
});

test("divisionsCompatible lets a blended event cross divisions", () => {
  assert.equal(divisionsCompatible(ES, HS), false);
  assert.equal(divisionsCompatible(ES, HS, "blended"), true);
  assert.equal(divisionsCompatible(ES, "Blended"), true);
});

test("setupLabel", () => {
  assert.equal(setupLabel(iq("blended")), "VEX IQ · Blended");
  assert.equal(setupLabel({ program: "V5RC", format: "standard" }), "V5RC · Standard");
});
