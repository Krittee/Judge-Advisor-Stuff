import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { ConfirmDialog, createConfirmer, type Pending } from "../src/components/ConfirmDialog";

/* window.confirm() answers "no" at once, and shows nothing, in the Claude
   desktop app's browser and some phone in-app webviews -- so every action
   behind it silently did nothing. The app asks in the page instead, with one
   shared <dialog>. There is no DOM harness: the question/answer logic runs for
   real as a plain function, the dialog is rendered to markup, and the wiring
   that needs a browser (showModal, Escape, the backdrop) is read from source. */

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const noop = () => {};

/* ---- no native confirm anywhere ------------------------------------------- */

function sourceFiles(dir: string): string[] {
  return readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(`${dir}${e.name}/`) : /\.(tsx?|jsx?|mjs)$/.test(e.name) ? [`${dir}${e.name}`] : [],
  );
}

const withoutComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

test("nothing under src calls window.confirm", () => {
  const files = sourceFiles("src/");
  assert.ok(files.length > 50, "the scan found the source tree");
  // A bare confirm( or window./globalThis./self.confirm(, but not ask(, useConfirm( or createConfirmer(.
  const native = /(?:^|[^\w$.])confirm\s*\(|\b(?:window|globalThis|self)\.confirm\s*\(/;
  for (const file of files) {
    assert.doesNotMatch(withoutComments(read(file)), native, `${file} calls the native confirm()`);
  }
});

/* ---- the answer logic ----------------------------------------------------- */

test("ask shows the question and resolves true when it is confirmed", async () => {
  const shown: (Pending | null)[] = [];
  const { ask, settle } = createConfirmer((p) => shown.push(p));
  const answer = ask("Remove it?", { confirmLabel: "Remove", danger: true });
  assert.deepEqual(shown, [{ question: "Remove it?", confirmLabel: "Remove", danger: true }]);
  settle(true);
  assert.equal(await answer, true);
  assert.equal(shown.at(-1), null, "the dialog is put away");
});

test("cancel, Escape and the backdrop all settle false", async () => {
  const { ask, settle } = createConfirmer(noop);
  const answer = ask("Remove it?");
  settle(false);
  assert.equal(await answer, false);
});

test("asking again while a question is open dismisses the first as no", async () => {
  const { ask, settle } = createConfirmer(noop);
  const first = ask("first?");
  const second = ask("second?");
  assert.equal(await first, false);
  settle(true);
  assert.equal(await second, true);
});

test("settling with nothing open is harmless, and an answer is only taken once", async () => {
  const { ask, settle } = createConfirmer(noop);
  settle(true);
  const answer = ask("once?");
  settle(true);
  settle(false); // the close event that follows a programmatic close
  assert.equal(await answer, true);
});

/* ---- the dialog ----------------------------------------------------------- */

test("the dialog is labelled by its question, with Cancel first and the confirm labelled", () => {
  const markup = renderToStaticMarkup(
    <ConfirmDialog pending={{ question: "Remove team 1A and all its requests?", confirmLabel: "Remove team" }} onSettle={noop} />,
  );
  const labelledby = markup.match(/<dialog[^>]*aria-modal="true"[^>]*aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(labelledby, "a modal dialog with aria-labelledby");
  assert.match(markup, new RegExp(`<p id="${labelledby}"[^>]*>Remove team 1A and all its requests\\?</p>`));
  assert.ok(markup.indexOf(">Cancel<") < markup.indexOf(">Remove team<"), "Cancel is first, so focus starts there");
  assert.equal(markup.match(/min-h-11/g)?.length, 2, "both buttons are 44px or taller");
});

test("a destructive question styles the confirm in the danger tokens; others use the accent", () => {
  const danger = renderToStaticMarkup(
    <ConfirmDialog pending={{ question: "Delete?", confirmLabel: "Delete panel", danger: true }} onSettle={noop} />,
  );
  assert.match(danger, /class="[^"]*bg-danger[^"]*text-danger-ink[^"]*"[^>]*>Delete panel</);
  const plain = renderToStaticMarkup(
    <ConfirmDialog pending={{ question: "Change?", confirmLabel: "Change for everyone" }} onSettle={noop} />,
  );
  assert.match(plain, /class="[^"]*bg-accent[^"]*"[^>]*>Change for everyone</);
  assert.doesNotMatch(plain, /bg-danger/);
  assert.match(
    renderToStaticMarkup(<ConfirmDialog pending={{ question: "Sure?" }} onSettle={noop} />),
    />Confirm</,
    "a plain Confirm when no label is given",
  );
});

test("with nothing pending the dialog is an empty shell", () => {
  const markup = renderToStaticMarkup(<ConfirmDialog pending={null} onSettle={noop} />);
  assert.match(markup, /<dialog/);
  assert.doesNotMatch(markup, /<button|<p /);
});

test("the dialog is a native modal: showModal, Escape and the backdrop say no, only Confirm says yes", () => {
  const src = read("src/components/ConfirmDialog.tsx");
  assert.ok(src.includes("dialog.showModal()"), "showModal gives the focus trap and Escape");
  assert.ok(src.includes("dialog.close()"));
  assert.match(src, /onClose=\{\(\) => \{\s*if \(pending\) onSettle\(false\);\s*\}\}/, "Escape");
  assert.match(src, /e\.target === e\.currentTarget\) onSettle\(false\)/, "the backdrop");
  assert.match(src, /<Button variant="ghost"[^>]*onClick=\{\(\) => onSettle\(false\)\}>\s*Cancel/);
  assert.match(src, /onClick=\{\(\) => onSettle\(true\)\}/, "only the confirming button says yes");
  assert.equal(src.match(/onSettle\(true\)/g)?.length, 1);
});

/* ---- every site asks through it ------------------------------------------- */

test("the referee page awaits the shared ask() for the setup change before saving it", () => {
  const src = read("src/app/referee/page.tsx");
  assert.ok(src.includes('import { useConfirm } from "@/components/ConfirmDialog"'));
  assert.ok(src.includes("const { ask, dialog } = useConfirm();"));
  const save = src.slice(src.indexOf("async function saveSetup"), src.indexOf("if (session === undefined)"));
  const question = save.indexOf("setupChangeQuestion(");
  const asked = save.indexOf('await ask(question, { confirmLabel: "Change for everyone" })');
  const put = save.indexOf('call("/api/referee-setup"');
  assert.ok(question >= 0 && question < asked && asked < put, "question, then ask, then PUT");
  assert.match(save, /if \(question && !\(await ask\(question/, "a declined question stops the save");
  // The Event setup screen is a return of its own, so it needs the dialog too.
  assert.equal(src.match(/\{dialog\}/g)?.length, 2, "rendered on the setup screen and the report");
});

test("each of the admin console's confirmations goes through ask()", () => {
  const src = read("src/app/admin/page.tsx");
  // Every question moved into a tab (checked below); the page itself asks none.
  assert.equal(src.match(/await ask\(/g)?.length ?? 0, 0);
  assert.ok(!src.includes("useConfirm()"), "the page has no hook of its own to render");
  // The Panels tab: the division change, Delete panel and Remove from roster, all through ask(); the add-judge one is its own dialog.
  const panelsLogic = read("src/components/admin/panelsLogic.ts");
  const sites: [string, RegExp][] = [
    ["move division", /await ask\(divisionQuestion\(panelName, division\), \{ confirmLabel: "Move division", danger: true \}\)/],
    ["delete panel", /await ask\(deletePanelQuestion\(panel\.name\), \{ confirmLabel: "Delete panel", danger: true \}\)/],
    ["remove judge", /await ask\(removeJudgeQuestion\(judge\.name, conflicts\), \{ confirmLabel: "Remove from roster", danger: true \}\)/],
  ];
  for (const [name, re] of sites) assert.match(panelsLogic, re, `${name} does not ask through ask()`);
  assert.match(panelsLogic, /Move \$\{panelName\} to \$\{division\}\?\\n\\n/);
  const panelsTab = read("src/components/admin/PanelsTab.tsx");
  assert.equal(panelsTab.match(/useConfirm\(\)/g)?.length, 1, "one hook, one rendered dialog");
  assert.equal(panelsTab.match(/\{dialog\}/g)?.length, 1);
  assert.ok(panelsTab.includes("changeDivisionAfterAsking(ask, panel.name, division,"));
  assert.ok(panelsTab.includes("deletePanelAfterAsking(ask, call, panel)"));
  assert.ok(panelsTab.includes("removeJudgeAfterAsking(ask, call, judge,"));
  // The select snaps back while the question is open, so the choice is read from the event, as it happens.
  assert.ok(panelsTab.includes("onChange={(e) => onDivision(panel, e.target.value)}"));

  // Two more ask from elsewhere: Withdraw (in the Conflicts tab) and Remove flag (in the Referee tab).
  const conflicts = read("src/components/admin/ConflictsTab.tsx");
  assert.ok(conflicts.includes("withdrawAfterAsking(ask, question,"), "withdraw a conflict asks first");
  assert.match(read("src/components/admin/conflictsLogic.ts"), /await ask\(question, \{ confirmLabel: "Withdraw", danger: true \}\)/);
  // The Teams tab: Remove team, the status override, discarding unsaved changes, and the two resets.
  const teams = read("src/components/admin/teamsLogic.ts");
  assert.match(teams, /await ask\(removeQuestion\(team\), \{ confirmLabel: "Remove team", danger: true \}\)/);
  assert.match(teams, /await ask\(resetQuestion\(team, status\), \{ confirmLabel: "Reset status" \}\)/);
  assert.match(teams, /return ask\(discardQuestion\(team\), \{ confirmLabel: "Discard changes", danger: true \}\)/);
  assert.match(teams, /await ask\(question, \{ confirmLabel, danger: true \}\)/);
  assert.match(teams, /Remove team \$\{team\.number\} and all its requests\?/);
  const referee = read("src/components/admin/RefereeTab.tsx");
  assert.ok(referee.includes("removeAfterAsking(ask, async () => {"), "remove a flag asks first");
  assert.match(
    read("src/components/admin/refereeLogic.ts"),
    /await ask\(REMOVE_QUESTION, \{ confirmLabel: "Remove flag", danger: true \}\)/,
  );
});

test("the match sheet no longer carries the program line or its Change link", () => {
  const src = read("src/components/referee/MatchSheet.tsx");
  assert.ok(!src.includes("set for this event"));
  assert.ok(!src.includes("onChangeProgram"));
  assert.ok(!src.includes("Program:"));
  assert.ok(!read("src/app/referee/page.tsx").includes("onChangeProgram"));
  const css = read("src/app/globals.css");
  assert.ok(!css.includes(".rf-prog") && !css.includes(".rf-lnk"));
});
