import assert from "node:assert/strict";
import test from "node:test";

import { bookingLanguage, parseLanguageList } from "../src/lib/presets";

/* The event config lists English then Thai (ids "en", "th", shorts "EN", "TH"). */

test("an array is read id by id, in config order, without repeats", () => {
  assert.deepEqual(parseLanguageList(["th", "en", "th"]), ["en", "th"]);
  assert.deepEqual(parseLanguageList([]), []);
});

test("free text splits on slashes, plus, commas, ampersands, semicolons and spaces", () => {
  for (const text of ["EN/TH", "en+th", "en, th", "EN & TH", "en;th", "th en"]) {
    assert.deepEqual(parseLanguageList(text), ["en", "th"], text);
  }
});

test("a language is matched by id, short code or label, ignoring case", () => {
  assert.deepEqual(parseLanguageList("Thai"), ["th"]);
  assert.deepEqual(parseLanguageList("ENGLISH"), ["en"]);
  assert.deepEqual(parseLanguageList("Th"), ["th"]);
});

test("both and all mean every configured language", () => {
  assert.deepEqual(parseLanguageList("both"), ["en", "th"]);
  assert.deepEqual(parseLanguageList("All"), ["en", "th"]);
});

test("unknown tokens are dropped, and nothing recognised is an empty list", () => {
  assert.deepEqual(parseLanguageList("en/klingon"), ["en"]);
  assert.deepEqual(parseLanguageList("klingon"), []);
  assert.deepEqual(parseLanguageList(""), []);
  assert.deepEqual(parseLanguageList(null), []);
  assert.deepEqual(parseLanguageList(undefined), []);
});

test("a booking uses the language named, else the team's first, else the event default", () => {
  assert.equal(bookingLanguage("th", { languages: ["en"] }), "th");
  assert.equal(bookingLanguage("Thai", { languages: [] }), "th");
  assert.equal(bookingLanguage(undefined, { languages: ["th"] }), "th");
  assert.equal(bookingLanguage("", { languages: ["en", "th"] }), "en");
  assert.equal(bookingLanguage("klingon", { languages: ["th"] }), "th");
  assert.equal(bookingLanguage(undefined, { languages: [] }), "en");
});

test("a booking on a panel uses the first of the team's languages the panel covers", () => {
  assert.equal(bookingLanguage(undefined, { languages: ["th"] }, { languages: ["th"] }), "th");
  assert.equal(bookingLanguage(undefined, { languages: ["en"] }, { languages: ["th"] }), "en", "a panel that does not cover it is only a caution, not a switch");
  const both = { languages: ["en", "th"] };
  assert.equal(bookingLanguage(undefined, both, { languages: ["th"] }), "th", "Thai-only panel");
  assert.equal(bookingLanguage(undefined, both, { languages: ["en"] }), "en", "English-only panel");
  assert.equal(bookingLanguage(undefined, both, { languages: ["en", "th"] }), "en", "covers both: the team's first");
  assert.equal(bookingLanguage(undefined, both, { languages: [] }), "en", "panel has not said: the team's first");
  assert.equal(bookingLanguage(undefined, both, null), "en", "no panel: the team's first");
  assert.equal(bookingLanguage(undefined, { languages: ["th", "en"] }, { languages: ["xx"] }), "th", "covers neither: the team's first");
  assert.equal(bookingLanguage("en", both, { languages: ["th"] }), "en", "an explicit language still wins");
});
