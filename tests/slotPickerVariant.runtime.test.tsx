import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { PanelBusyLine, TOO_CLOSE_TITLE, takenTitle } from "../src/components/SlotPicker";

/* SlotPicker.tsx is now only the helpers the team page and the queue desk share:
   the team page is read-only, so the slot tiles it drew are gone, and the desk
   draws its own grid (components/desk/DeskSlots.tsx, deskGrid.runtime.test.tsx).
   PanelBusyLine is plain text: the team page shows it on a status panel. */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const noComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("the busy line is plain text, with no colour of its own", () => {
  const free = { waiting: 0, interviewing: 0, longestWait: 0 };
  const busy = { waiting: 2, interviewing: 1, longestWait: 6 };
  assert.equal(renderToStaticMarkup(<PanelBusyLine load={free} />), "<span>Panel is free right now</span>");
  assert.equal(renderToStaticMarkup(<PanelBusyLine load={busy} />), "<span>1 in interview · 2 already waiting (longest 6 min)</span>");
});

test("the words for a slot that cannot be booked are the desk's to reuse", () => {
  assert.match(TOO_CLOSE_TITLE, /^Too close to another team's booking on this panel/);
  assert.equal(takenTitle({ teamId: "t", teamNumber: "1111A", status: "scheduled" }), "Taken by team 1111A — Scheduled");
});

test("nothing renders SlotPicker any more: not the team page, not the queue desk", () => {
  const callers = ["src/app/team/[number]/page.tsx", "src/components/team/TeamView.tsx", "src/app/queue/page.tsx", "src/components/desk/DeskView.tsx", "src/components/desk/DeskSlots.tsx"];
  for (const file of callers) assert.doesNotMatch(noComments(read(file)), /<SlotPicker/, `${file} draws the picker`);
  assert.doesNotMatch(noComments(read("src/components/SlotPicker.tsx")), /export function SlotPicker|TeamSlot|useMemo|buildSlots/, "the picker is back");
});
