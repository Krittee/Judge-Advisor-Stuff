import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PitMap } from "../src/components/PitMap";
import type { AppState, RequestRow, Team } from "../src/lib/types";

/* The pit floor as it is drawn. Pit placement is pure (pit.test.mjs); these
   check what actually reaches the screen: a shared pit shows both teams,
   a row draws only its own span, and Hide completed removes the tile. */

const DIVISION = "Elementary School";

function team(number: string, pit: string | null): Team {
  return {
    id: `team-${number}`,
    number,
    name: `Team ${number}`,
    panel_id: null,
    division: DIVISION,
    category: "ungraded",
    pit,
    created_at: "2026-10-01T00:00:00.000Z",
  };
}

function request(teamNumber: string, status: RequestRow["status"]): RequestRow {
  return { id: `req-${teamNumber}`, team_id: `team-${teamNumber}`, status } as RequestRow;
}

function floor(teams: Team[], requests: RequestRow[] = []): AppState {
  return {
    teams,
    requests,
    divisions: [DIVISION],
    pitFloor: { columns: "left-to-right", rows: "top-to-bottom" },
  } as unknown as AppState;
}

const render = (state: AppState, hideDone = false) =>
  renderToStaticMarkup(<PitMap state={state} hideDone={hideDone} />);

test("two teams on one pit are both on the plan", () => {
  const markup = render(floor([team("1111A", "A1"), team("2222B", "A1")]));
  assert.match(markup, /1111A/);
  assert.match(markup, /2222B/);
  assert.match(markup, /2 teams/, "the shared pit says so rather than showing one team as if alone");
});

test("Hide completed removes the completed team's tile and leaves an empty box in its place", () => {
  const state = floor(
    [team("1111A", "A1"), team("2222B", "A2")],
    [request("1111A", "completed"), request("2222B", "requested")],
  );
  const hidden = render(state, true);
  assert.doesNotMatch(hidden, /1111A/, "the completed team is still drawn");
  assert.match(hidden, /2222B/, "a team still waiting must not be hidden with it");
  assert.match(
    hidden,
    /<div aria-hidden="true" class="bd-pit bd-pit--gone"><\/div>/,
    "no placeholder: the grid would shift up to fill the gap",
  );
});

test("with Hide completed off, a completed team is still shown", () => {
  const state = floor([team("1111A", "A1")], [request("1111A", "completed")]);
  assert.match(render(state, false), /1111A/);
});

test("a row draws only its own span, so no empty pits appear before its first team", () => {
  const markup = render(floor([team("1111A", "C5"), team("2222B", "C6"), team("3333C", "D1")]));
  assert.equal(
    (markup.match(/bd-pit--empty/g) ?? []).length,
    0,
    "C1 to C4 were drawn as free pits, although another division's team stands in C5",
  );
});

test("a gap inside a row's span is still drawn as a real empty pit", () => {
  const markup = render(floor([team("1111A", "A1"), team("2222B", "A3")]));
  assert.equal((markup.match(/bd-pit--empty/g) ?? []).length, 1, "A2 is free and must read as free");
});
