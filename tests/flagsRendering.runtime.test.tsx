import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FlagList, type FlagKind } from "../src/components/Flags";
import type { FlagRow } from "../src/lib/types";

const kinds: FlagKind[] = [
  { id: "good", label: "Good conduct", short: "Good", color: "emerald", severity: 0, requiresRule: false },
  { id: "warning", label: "Warning", short: "Warning", color: "amber", severity: 1, requiresRule: false },
  { id: "minor", label: "Minor violation", short: "Minor", color: "orange", severity: 2, requiresRule: true },
  { id: "major", label: "Major violation", short: "Major", color: "rose", severity: 3, requiresRule: true },
];

function report(values: Partial<FlagRow> = {}): FlagRow {
  return {
    id: "flag-1",
    team_id: "team-1852B",
    kind: "minor",
    body: "Possessed two Bean Bags.",
    author: "Head Referee",
    match_type: "Q",
    match_number: "23",
    field: "Field 2",
    rule: "SG6",
    created_at: "2026-09-09T10:00:00.000Z",
    ...values,
  };
}

test("FlagList renders rule, severity, match, field, description, author and time safely", () => {
  const markup = renderToStaticMarkup(<FlagList flags={[report()]} kinds={kinds} />);

  assert.match(markup, /Minor/);
  assert.match(markup, /&lt;SG6&gt; Possession \/ Plowing/);
  assert.match(markup, /Q23/);
  assert.match(markup, /Field 2/);
  assert.match(markup, /Possessed two Bean Bags\./);
  assert.match(markup, /Head Referee/);
  assert.match(markup, /\d/);
});

test("Good Conduct and legacy reports without rule information render no broken rule label", () => {
  const markup = renderToStaticMarkup(
    <FlagList
      flags={[
        report({ id: "good", kind: "good", rule: null, body: "Helped reset the Field." }),
        report({
          id: "legacy",
          kind: "warning",
          rule: null,
          match_type: null,
          match_number: null,
          field: null,
          body: "Legacy report",
        }),
      ]}
      kinds={kinds}
    />,
  );

  assert.match(markup, /Good/);
  assert.match(markup, /Helped reset the Field\./);
  assert.match(markup, /Legacy report/);
  assert.doesNotMatch(markup, /undefined|null|Rule violated/);
});
