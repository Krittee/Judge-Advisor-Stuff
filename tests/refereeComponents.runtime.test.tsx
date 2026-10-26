import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as flagsModule from "../src/components/Flags";
import { FlagList, type FlagKind } from "../src/components/Flags";
import { AllRulesPicker } from "../src/components/AllRulesPicker";
import * as matchFieldsModule from "../src/components/MatchFields";
import { MatchFields, type MatchDraft } from "../src/components/MatchFields";
import { commonFieldRules, getRuleset, MAX_FLAG_RULES } from "../src/lib/rules";
import type { FlagRow } from "../src/lib/types";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/* MatchFields is controlled and holds no hooks, so a test can call it as a
   plain function, read the element tree they return and fire the
   handlers on it -- there is no DOM harness in this repo to click a real page. */
type El = ReactElement<Record<string, unknown>>;
type Fn = (props: unknown) => ReactNode;

function* walk(node: ReactNode): Generator<El> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n);
    return;
  }
  if (!isValidElement(node)) return;
  const el = node as El;
  if (typeof el.type === "function") {
    yield* walk((el.type as Fn)(el.props));
    return;
  }
  yield el;
  yield* walk(el.props.children as ReactNode);
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (!isValidElement(node)) return "";
  const el = node as El;
  if (typeof el.type === "function") return textOf((el.type as Fn)(el.props));
  return textOf(el.props.children as ReactNode);
}

type Handler = (arg?: unknown) => void;
const press = (el: El | undefined) => {
  assert.ok(el, "the control to press is not on the page");
  (el.props.onClick as Handler)();
};

const draft = (matchType = "Q", matchNumber = "23", field = "2"): MatchDraft => ({ matchType, matchNumber, field });

function fields(over: Partial<ComponentProps<typeof MatchFields>> = {}) {
  const changes: MatchDraft[] = [];
  const props: ComponentProps<typeof MatchFields> = {
    rulesetId: "viqrc",
    fieldCount: 3,
    value: draft(),
    onChange: (next) => changes.push(next),
    idPrefix: "t",
    ...over,
  };
  const tree = [...walk(MatchFields(props))];
  return {
    changes,
    markup: renderToStaticMarkup(<MatchFields {...props} />),
    buttons: tree.filter((e) => e.type === "button"),
    named: (name: string) => tree.find((e) => e.type === "button" && e.props["aria-label"] === name),
    labelled: (text: string) => tree.find((e) => e.type === "button" && textOf(e) === text),
    input: (id: string) => tree.find((e) => e.type === "input" && e.props.id === id),
    typeNames: tree
      .filter((e) => e.type === "button" && /\([A-Z0-9]+\)$/.test(String(e.props["aria-label"] ?? "")))
      .map((e) => String(e.props["aria-label"])),
    fieldChips: tree.filter((e) => e.type === "button" && e.props.className && /\bw-12\b|\bmin-w-12\b/.test(String(e.props.className))),
  };
}

const type = (value: string) => ({ target: { value } });
const typeInto = (el: El | undefined, value: string) => {
  assert.ok(el, "the input to type into is not on the page");
  (el.props.onChange as Handler)(type(value));
};

/* ---- MatchFields: the types each program offers ---------------------------- */

test("VEX IQ offers Practice, Qualification and Final for Teamwork, and Driver and Auto for Skills", () => {
  const teamwork = fields();
  assert.deepEqual(teamwork.typeNames, ["Practice (P)", "Qualification (Q)", "Final (F)"]);
  assert.match(teamwork.markup, /Match type/);
  assert.doesNotMatch(teamwork.markup, /Round of 16|Quarterfinal|Semifinal/);

  const skills = fields({ value: draft("SKD", "1") });
  assert.match(skills.markup, />Driver</);
  assert.match(skills.markup, />Auto</);
  assert.match(skills.markup, />Run #</);
  assert.deepEqual(skills.typeNames, [], "Skills shows no Teamwork type chips");
  assert.doesNotMatch(skills.markup, /Match type|Bracket/);
});

test("V5RC offers Practice, Qualification, Round of 16, Quarterfinal, Semifinal and Final", () => {
  const v5 = fields({ rulesetId: "v5rc" });
  assert.deepEqual(v5.typeNames, [
    "Practice (P)",
    "Qualification (Q)",
    "Round of 16 (R16)",
    "Quarterfinal (QF)",
    "Semifinal (SF)",
    "Final (F)",
  ]);
  // The visible text is the short code, the full name is the accessible name.
  for (const code of ["P", "Q", "R16", "QF", "SF", "F"]) assert.match(v5.markup, new RegExp(`>${code}<`));
});

test("the Skills panel is a Driver | Auto control beside a plain Run # box, with no alliance anywhere", () => {
  for (const rulesetId of ["viqrc", "v5rc"]) {
    const skills = fields({ rulesetId, value: draft("SKA", "2") });
    assert.deepEqual(
      skills.buttons.filter((b) => ["Driver", "Auto"].includes(textOf(b))).map((b) => [textOf(b), b.props["aria-pressed"]]),
      [
        ["Driver", false],
        ["Auto", true],
      ],
    );
    assert.match(skills.markup, /<label[^>]*for="t-number"[^>]*>Run #<\/label>/);
    assert.equal(skills.input("t-number")?.props.value, "2");
    // One row, as in the match-sheet mocks: the run box has no -/+ stepper.
    assert.doesNotMatch(skills.markup, /Decrease|Increase/);
    assert.doesNotMatch(skills.markup, /alliance|\b(?:Red|Blue)\b/i);
  }
  const f = fields({ value: draft("SKD", "1") });
  typeInto(f.input("t-number"), "4a5");
  assert.deepEqual(f.changes, [{ matchType: "SKD", matchNumber: "45", field: "2" }], "digits only, other fields untouched");
  press(f.labelled("Auto"));
  assert.equal(f.changes[1].matchType, "SKA");
  assert.equal(f.changes[1].matchNumber, "1", "Driver to Auto keeps the run number");
});

test("the selected type and group carry aria-pressed", () => {
  const { buttons } = fields({ rulesetId: "v5rc", value: draft("QF", "2-1") });
  const pressed = buttons.filter((b) => b.props["aria-pressed"] === true).map((b) => textOf(b));
  assert.deepEqual(pressed, ["Teamwork", "QF", "2"], "group, type and the field (2) are the pressed ones");
  assert.ok(buttons.every((b) => b.props["aria-pressed"] !== undefined || b.props["aria-controls"]), "every toggle states its state");
});

/* ---- MatchFields: the number ------------------------------------------------ */

test("the Bracket and Match inputs appear only for a bracket type", () => {
  const qf = fields({ rulesetId: "v5rc", value: draft("QF", "2-1") });
  assert.match(qf.markup, /<label[^>]*for="t-bracket"[^>]*>Bracket<\/label>/);
  assert.match(qf.markup, /<label[^>]*for="t-match"[^>]*>Match<\/label>/);
  assert.equal(qf.input("t-bracket")?.props.value, "2");
  assert.equal(qf.input("t-match")?.props.value, "1");
  assert.doesNotMatch(qf.markup, /Match number/);

  // Final is a bracket in V5RC and a plain number in VEX IQ.
  assert.match(fields({ rulesetId: "v5rc", value: draft("F", "1-1") }).markup, /Bracket/);
  for (const plain of [fields({ rulesetId: "v5rc", value: draft("Q") }), fields({ value: draft("F", "2") })]) {
    assert.doesNotMatch(plain.markup, /Bracket/);
    assert.match(plain.markup, /<label[^>]*for="t-number"[^>]*>Match number<\/label>/);
    assert.match(plain.markup, /aria-label="Decrease Match number"/);
    assert.match(plain.markup, /aria-label="Increase Match number"/);
  }
});

test("the stepper buttons and number input are 44px or more, and labelled", () => {
  const { markup } = fields();
  assert.match(markup, /h-16 w-16/, "64px stepper buttons");
  assert.match(markup, /<input id="t-number"/);
  assert.match(markup, /inputMode="numeric"|inputmode="numeric"/i);
});

test("the stepper steps by one, stops at 1, and will not wrap past four digits", () => {
  const at = (matchNumber: string) => fields({ value: draft("Q", matchNumber) });

  const mid = at("23");
  press(mid.named("Increase Match number"));
  press(mid.named("Decrease Match number"));
  assert.deepEqual(mid.changes.map((c) => c.matchNumber), ["24", "22"]);
  assert.equal(mid.changes[0].matchType, "Q");
  assert.equal(mid.changes[0].field, "2");

  assert.equal(at("1").named("Decrease Match number")?.props.disabled, true, "there is no match 0");
  assert.equal(at("").named("Decrease Match number")?.props.disabled, true);
  const fresh = at("");
  press(fresh.named("Increase Match number"));
  assert.equal(fresh.changes[0].matchNumber, "1", "the first + from empty is match 1");

  assert.equal(at("9999").named("Increase Match number")?.props.disabled, true, "10000 would be clipped to 1000");
  assert.equal(at("9998").named("Increase Match number")?.props.disabled, false);
});

test("typing a match number keeps digits only", () => {
  const f = fields();
  typeInto(f.input("t-number"), "4a5");
  assert.equal(f.changes[0].matchNumber, "45");
});

test("the bracket and match boxes compose one 'b-m' number", () => {
  const f = fields({ rulesetId: "v5rc", value: draft("QF", "2-1") });
  typeInto(f.input("t-bracket"), "3");
  typeInto(f.input("t-match"), "12");
  assert.deepEqual(f.changes.map((c) => c.matchNumber), ["3-1", "2-12"]);

  // Emptying the match box leaves just the bracket; the number only means
  // something once both are there, which is the save-time check's job.
  const a = fields({ rulesetId: "v5rc", value: draft("QF", "2-1") });
  typeInto(a.input("t-match"), "");
  assert.equal(a.changes[0].matchNumber, "2");

  const b = fields({ rulesetId: "v5rc", value: draft("QF", "2") });
  typeInto(b.input("t-match"), "4");
  assert.equal(b.changes[0].matchNumber, "2-4");

  // Three digits in a half do not fit a bracket ("2-1" is at most 99-99).
  const c = fields({ rulesetId: "v5rc", value: draft("QF", "") });
  typeInto(c.input("t-bracket"), "123");
  assert.equal(c.changes[0].matchNumber, "12");
});

/* ---- MatchFields: switching group and type ---------------------------------- */

test("switching group picks that group's first type and clears the number, keeping the field", () => {
  const toSkills = fields({ value: draft("Q", "23", "3") });
  press(toSkills.labelled("Skills"));
  assert.deepEqual(toSkills.changes, [{ matchType: "SKD", matchNumber: "", field: "3" }]);

  const toTeamwork = fields({ rulesetId: "v5rc", value: draft("SKA", "2", "1") });
  press(toTeamwork.labelled("Teamwork"));
  assert.deepEqual(toTeamwork.changes, [{ matchType: "P", matchNumber: "", field: "1" }]);

  // The group already showing does nothing.
  const same = fields();
  press(same.labelled("Teamwork"));
  assert.deepEqual(same.changes, []);
});

test("changing the type keeps a number that still fits and drops one that does not", () => {
  const iq = fields({ value: draft("Q", "23") });
  press(iq.named("Final (F)"));
  assert.equal(iq.changes[0].matchNumber, "23", "Q23 -> F23: still a plain number");

  const toBracket = fields({ rulesetId: "v5rc", value: draft("Q", "23") });
  press(toBracket.named("Quarterfinal (QF)"));
  assert.equal(toBracket.changes[0].matchNumber, "", "23 is not a bracket");

  const bracketToBracket = fields({ rulesetId: "v5rc", value: draft("QF", "2-1") });
  press(bracketToBracket.named("Final (F)"));
  assert.equal(bracketToBracket.changes[0].matchNumber, "2-1");

  const toPlain = fields({ rulesetId: "v5rc", value: draft("QF", "2-1") });
  press(toPlain.named("Qualification (Q)"));
  assert.equal(toPlain.changes[0].matchNumber, "");

  const sameType = fields();
  press(sameType.named("Qualification (Q)"));
  assert.deepEqual(sameType.changes, [], "re-tapping the chosen type changes nothing");
});

/* ---- MatchFields: the field -------------------------------------------------- */

test("there is one 48px chip per field the event has, and the note says how many", () => {
  for (const count of [1, 3, 8, 20]) {
    const f = fields({ fieldCount: count, value: draft("Q", "23", "1") });
    assert.equal(f.fieldChips.length, count, `${count} fields -> ${count} chips`);
    assert.deepEqual(
      f.fieldChips.map((c) => textOf(c)),
      Array.from({ length: count }, (_, i) => String(i + 1)),
    );
    assert.ok(f.fieldChips.every((c) => /\bh-12\b/.test(String(c.props.className))), "48px squares");
    assert.match(f.markup, new RegExp(`${count} ${count === 1 ? "field" : "fields"} · set in event setup`));
  }
});

test("a field chip is a toggle that sets the plain number, and the chosen one is pressed", () => {
  const f = fields({ value: draft("Q", "23", "2") });
  assert.deepEqual(
    f.fieldChips.map((c) => c.props["aria-pressed"]),
    [false, true, false],
  );
  press(f.fieldChips[2]);
  assert.deepEqual(f.changes, [{ matchType: "Q", matchNumber: "23", field: "3" }]);
  assert.match(f.markup, /aria-labelledby="t-field-l"/);
});

/* ---- MatchFields: values the program no longer offers ------------------------ */

test("a legacy match type and field are shown as selected '(old)' options and survive unchanged", () => {
  const f = fields({
    value: { matchType: "SK", matchNumber: "3", field: "HS2" },
    legacy: { matchType: "SK", field: "HS2" },
  });
  assert.match(f.markup, />Skills \(old\)</);
  assert.match(f.markup, />HS2 \(old\)</);
  const oldType = f.labelled("Skills (old)");
  const oldField = f.labelled("HS2 (old)");
  assert.equal(oldType?.props["aria-pressed"], true);
  assert.equal(oldField?.props["aria-pressed"], true);
  // The group is Skills, so the Run # is shown and the old run's number is kept.
  assert.match(f.markup, />Run #</);
  assert.equal(f.input("t-number")?.props.value, "3");

  // Moving off it and back is possible: it stays on offer.
  const off = fields({
    value: { matchType: "SKD", matchNumber: "3", field: "1" },
    legacy: { matchType: "SK", field: "HS2" },
  });
  press(off.labelled("Skills (old)"));
  press(off.labelled("HS2 (old)"));
  assert.equal(off.changes[0].matchType, "SK");
  assert.equal(off.changes[1].field, "HS2");
});

test("a field above the event's count is also kept as '(old)'; one the event offers, or a type it offers, is not", () => {
  const above = fields({ fieldCount: 3, value: draft("Q", "5", "7"), legacy: { field: "7" } });
  assert.match(above.markup, />7 \(old\)</);
  assert.equal(above.fieldChips.length, 4, "three real chips and the old one");

  const fine = fields({
    fieldCount: 3,
    value: draft("Q", "5", "2"),
    legacy: { matchType: "Q", field: "2" },
  });
  assert.doesNotMatch(fine.markup, /\(old\)/);
  assert.doesNotMatch(fields({ legacy: { matchType: null, field: null } }).markup, /\(old\)/);
  assert.doesNotMatch(fields().markup, /\(old\)/, "no legacy prop, nothing old");
});

test("a legacy 'SK' shows beside Driver and Auto only when the flag holds it", () => {
  assert.doesNotMatch(fields({ value: draft("SKD", "1") }).markup, /\(old\)/);
  const f = fields({ value: draft("SK", "1"), legacy: { matchType: "SK" } });
  assert.match(f.markup, />Driver</);
  assert.match(f.markup, />Auto</);
  assert.match(f.markup, />Skills \(old\)</);
});

/* ---- AllRulesPicker ---------------------------------------------------------- */

const picker = (over: Partial<ComponentProps<typeof AllRulesPicker>> = {}) =>
  renderToStaticMarkup(
    <AllRulesPicker open rulesetId="v5rc" value={[]} onChange={() => {}} onClose={() => {}} {...over} />,
  );

/** The attributes of every checkbox in the markup. */
const checkboxes = (markup: string) => markup.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];

test("AllRulesPicker is a native <dialog> opened with showModal, closed on a backdrop click", () => {
  const src = source("../src/components/AllRulesPicker.tsx");
  assert.match(src, /<dialog\b/);
  assert.ok(src.includes("dialog.showModal()"), "a modal dialog gives the focus trap and Escape");
  assert.ok(src.includes("dialog.close()"));
  assert.ok(src.includes("e.target === e.currentTarget"), "only a click on the dialog itself is a backdrop click");
  assert.match(src, /onClose=\{\(\) => \{\s*if \(open\) onClose\(\);/, "Escape reaches the caller, a close it asked for does not echo");
  assert.ok(!/role="dialog"|aria-modal/.test(src), "the element supplies both, a hand-made copy would not");
  assert.ok(src.includes("aria-labelledby={titleId}"), "the dialog is named by its heading");

  const markup = picker();
  assert.match(markup, /^<dialog\b/);
  assert.match(markup, /aria-labelledby="/);
  assert.doesNotMatch(markup, /<dialog[^>]*\sopen(=|\s|>)/, "the open attribute is the browser's to set, via showModal");
});

test("a closed AllRulesPicker holds the dialog but none of its rules", () => {
  const markup = picker({ open: false });
  assert.match(markup, /<dialog\b/);
  assert.doesNotMatch(markup, /Done \(|type="search"|type="checkbox"/);
});

test("the header has a Back arrow, the ruleset and Done (k); the search is a labelled field", () => {
  const markup = picker({ value: ["SG6", "GG17"] });
  assert.match(markup, /aria-label="Back"/);
  assert.match(markup, /Rules · V5RC Override/);
  assert.match(markup, /Done \(2\)/);
  assert.match(picker(), /Done \(0\)/);
  assert.match(markup, /<label[^>]*><span class="sr-only">Search rules<\/span>[\s\S]*?<input[^>]*type="search"/);
  assert.match(markup, /h-11 w-11/, "the back arrow is 44px");
  assert.match(markup, /h-11 shrink-0[^"]*">Done \(2\)/, "Done is 44px");
});

test("the bottom bar names the selection and has its own Done", () => {
  assert.match(picker({ value: ["GG17", "SG6"] }), /<b[^>]*>2 rules selected<\/b> · GG17, SG6/);
  assert.match(picker({ value: ["SG6"] }), /1 rule selected/);
  assert.match(picker(), /0 rules selected/);
  assert.match(picker(), />Done<\/button>/);
});

test("Common comes first, then every category with its count; the first three open, the rest collapsed", () => {
  const markup = picker({ value: ["SG6"] });
  const ruleset = getRuleset("v5rc");
  // Common: the program's own shortcut rules as pressed chips.
  const commonAt = markup.indexOf("Common");
  assert.ok(commonAt > 0 && commonAt < markup.indexOf("Scoring Rules"), "Common is the first group");
  const common = commonFieldRules("v5rc");
  assert.ok(common.length > 0);
  for (const r of common) {
    assert.match(markup, new RegExp(`aria-pressed="${r.id === "SG6"}"[^>]*>${r.id}</button>`), `${r.id} chip`);
  }
  // Every category is there, in the manual's order, with how many rules it holds.
  const counts = new Map<string, number>();
  for (const r of ruleset.rules) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  assert.ok(counts.size >= 6);
  for (const [category, n] of counts) {
    assert.match(markup, new RegExp(`${category}</span>(<span[^>]*>[^<]*</span>)?<span[^>]*>${n}</span>`), `${category} (${n})`);
  }
  assert.ok(markup.indexOf("Scoring Rules") < markup.indexOf("Specific Game Rules"));
  // Open by default: their rows are present. Collapsed: they are not.
  for (const id of ["SC1", "SG6", "GG17"]) assert.ok(markup.includes(`>${id}</span>`), `${id} row`);
  for (const id of ["S4", "R1", "T1", "TS1"]) assert.ok(!markup.includes(`>${id}</span>`), `${id} row should be hidden`);
  assert.match(markup, /aria-expanded="true"/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /1 selected/, "a group says how many of its rules are ticked");
});

test("rows are real checkboxes of 48px or more with the id and the official title", () => {
  const markup = picker({ value: ["SG6"] });
  const boxes = checkboxes(markup);
  assert.ok(boxes.length > 20);
  assert.equal(boxes.filter((b) => /\schecked=""/.test(b)).length, 1);
  assert.match(markup, /<label[^>]*min-h-12[^>]*>/);
  assert.match(markup, /min-w-12 shrink-0[^"]*">SG6<\/span><span[^>]*>Possession is limited to a maximum of one Pin and one Cup/);
  assert.match(markup, /break-words/, "long titles wrap rather than scroll sideways");
});

test("a ruleset shows its own rules and nothing from the other", () => {
  const iq = picker({ rulesetId: "viqrc", value: ["SG6"] });
  assert.match(iq, /Rules · VEX IQ/);
  assert.match(iq, /Possession \/ Plowing is limited/);
  assert.doesNotMatch(iq, /one Pin and one Cup/);
});

test("at the cap every unselected rule is disabled, selected ones stay tappable, and it says why", () => {
  const picked = ["SC1", "SC2", "SC3", "SC4", "SC5"].slice(0, MAX_FLAG_RULES);
  const capped = picker({ value: picked });
  const boxes = checkboxes(capped);
  assert.ok(boxes.length > MAX_FLAG_RULES);
  for (const b of boxes) {
    const on = /\schecked=""/.test(b);
    assert.equal(/\sdisabled=""/.test(b), !on, `${on ? "selected" : "unselected"} box: ${b}`);
  }
  // The shortcut chips lock the same way.
  const chips = capped.match(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>/g) ?? [];
  assert.ok(chips.length > 0);
  for (const chip of chips) {
    assert.equal(/\sdisabled=""/.test(chip), chip.includes('aria-pressed="false"'), chip);
  }
  assert.match(capped, new RegExp(`Most ${MAX_FLAG_RULES} rules`));

  const under = picker({ value: picked.slice(0, MAX_FLAG_RULES - 1) });
  assert.ok(checkboxes(under).every((b) => !/\sdisabled=""/.test(b)), "below the cap nothing is locked");
  assert.doesNotMatch(under, /Most \d rules/);
});

/* ---- what was removed, and what the new files may not do ---------------------- */

test("the old ruleset dropdown, division field and rule dropdown are gone", () => {
  for (const gone of ["RulesetPicker", "FieldPicker", "RulePicker"]) {
    assert.ok(!(gone in flagsModule), `${gone} is still exported`);
  }
  const flags = source("../src/components/Flags.tsx");
  assert.ok(!/RulesetPicker|FieldPicker|RulePicker|RULESET_STORAGE_KEY|localStorage/.test(flags));
  assert.ok(!source("../src/lib/flagValidation.ts").includes("FIELD_PREFIXES"));
  assert.ok(!flags.includes("matchTypes?:"), "the deprecated FlagList matchTypes prop is gone");
});

test("the three new controls take their colours from the app's tokens, not literals", () => {
  for (const file of ["MatchFields.tsx", "AllRulesPicker.tsx", "Flags.tsx"]) {
    const src = source(`../src/components/${file}`);
    assert.ok(!/oklch\(|#[0-9a-fA-F]{3,8}\b|\brgb\(/.test(src), `${file} hard-codes a colour`);
  }
});

test("there is no alliance: no toggle, no helper, no caption, no token, no PATCH key", () => {
  assert.ok(!("AllianceToggle" in matchFieldsModule), "AllianceToggle is exported again");
  assert.ok(!("correctionNeedsAlliance" in flagsModule), "correctionNeedsAlliance is exported again");
  for (const file of ["MatchFields.tsx", "Flags.tsx", "AllRulesPicker.tsx"]) {
    assert.ok(!/alliance/i.test(source(`../src/components/${file}`)), `${file} still mentions an alliance`);
  }
});

/* ---- the read-only referee flag list ----------------------------------------- */

const kinds: FlagKind[] = [
  { id: "warning", label: "Warning", short: "Warning", color: "amber", severity: 1, requiresRule: false },
  { id: "minor", label: "Minor violation", short: "Minor", color: "orange", severity: 2, requiresRule: true },
];

function flag(values: Partial<FlagRow> = {}): FlagRow {
  return {
    id: "flag-1",
    team_id: "team-1852B",
    kind: "minor",
    body: "",
    author: "Head Referee",
    match_type: "Q",
    match_number: "23",
    field: "2",
    rule: "SG6",
    ruleset: "viqrc",
    manual_version: null,
    match_affecting: false,
    created_at: "2026-09-09T10:00:00.000Z",
    ...values,
  };
}

test("the referee flag list shows the report without correction controls", () => {
  const markup = renderToStaticMarkup(<FlagList flags={[flag()]} kinds={kinds} />);
  assert.match(markup, /Head Referee/);
  assert.doesNotMatch(markup, /<button|<textarea|<select/);
});

test("the head referee can open a correction from the flag list", () => {
  const markup = renderToStaticMarkup(<FlagList flags={[flag()]} kinds={kinds} onEdit={() => {}} />);
  assert.match(markup, /<button[^>]*>Edit<\/button>/);
});
