import assert from "node:assert/strict";
import test from "node:test";

import { parseLanguageList } from "../src/lib/presets";

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
