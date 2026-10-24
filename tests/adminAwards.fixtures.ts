import { awards as configAwards } from "../src/lib/presets";
import type { AppState, AwardView, NominationRow, Team, WinnerRow } from "../src/lib/types";

/* The event in design/awards-redesign/reference-awards-board.dc.html, as data:
   Middle School, Panel 2 (Sam Rivera, Priya Nair) and Panel 3 (Lena Ortiz,
   Ken Ito), 18 nominations for 9 teams, three awards decided. Plus one High
   School team, to show the division wall. Shared by the logic and runtime
   tests; the awards are the real config/event.json ones. */

export const awards: AwardView[] = configAwards();

export const team = (number: string, name: string, over: Partial<Team> = {}): Team => ({
  id: `t-${number}`, number, name, panel_id: "p2", division: "Middle School", category: "developing", pit: null, created_at: "2026-10-20T08:00:00Z", ...over,
});

export const panels = [
  { id: "p2", name: "Panel 2", division: "Middle School", judges: ["Sam Rivera", "Priya Nair"], languages: ["en"], sort_order: 2, slot_start_at: null, slot_minutes: 20, slot_count: 0 },
  { id: "p3", name: "Panel 3", division: "Middle School", judges: ["Lena Ortiz", "Ken Ito"], languages: ["en"], sort_order: 3, slot_start_at: null, slot_minutes: 20, slot_count: 0 },
  { id: "p4", name: "Panel 4", division: "High School", judges: [], languages: ["en"], sort_order: 4, slot_start_at: null, slot_minutes: 20, slot_count: 0 },
] as AppState["panels"];

export const gearGrinders = team("5150Z", "Gear Grinders", { panel_id: "p3" });
export const byteMe = team("7700B", "Byte Me");
export const roboraptors = team("6060R", "Roboraptors");
export const fortyTwo = team("4242F", "Forty-Two", { panel_id: "p3" });
export const torque = team("9882K", "Torque Titans");
export const momentum = team("8015M", "Momentum");
export const labRats = team("2088C", "Lab Rats", { panel_id: "p3" });
export const breakers = team("1234A", "Circuit Breakers");
export const hexAppeal = team("3311X", "Hex Appeal", { panel_id: "p3" });
/** Nobody nominated for this one in Middle School; it is in no one's matrix. */
export const quiet = team("1111Q", "Quiet Ones");
export const monitors = team("9000H", "Hall Monitors", { panel_id: "p4", division: "High School" });
export const teams = [gearGrinders, byteMe, roboraptors, fortyTwo, torque, momentum, labRats, breakers, hexAppeal, quiet, monitors];

let n = 0;
export const nom = (t: Team, awardId: string, panelId: string | null, judge: string, reason: string | null = null): NominationRow => ({
  id: `n${++n}`, award_id: awardId, team_id: t.id, panel_id: panelId, judge, reason, created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z",
});

export const nominations: NominationRow[] = [
  nom(gearGrinders, "excellence", "p3", "Lena Ortiz"),
  nom(gearGrinders, "innovate", "p3", "Lena Ortiz"),
  nom(gearGrinders, "amaze", "p3", "Lena Ortiz"),
  nom(gearGrinders, "amaze", "p3", "Ken Ito"),
  nom(byteMe, "excellence", "p2", "Sam Rivera", "Top notebook, and strong in every match."),
  nom(byteMe, "excellence", "p2", "Priya Nair", "Every entry names who did the work."),
  nom(byteMe, "design", "p2", "Sam Rivera"),
  nom(roboraptors, "innovate", "p2", "Sam Rivera"),
  nom(roboraptors, "create", "p2", "Priya Nair"),
  nom(fortyTwo, "think", "p3", "Lena Ortiz"),
  nom(fortyTwo, "build", "p3", "Ken Ito"),
  nom(torque, "build", "p2", "Sam Rivera"),
  nom(torque, "sportsmanship", "p2", "Priya Nair"),
  nom(momentum, "inspire", "p2", "Sam Rivera"),
  nom(momentum, "inspire", "p2", "Priya Nair"),
  nom(labRats, "design", "p3", "Lena Ortiz"),
  nom(breakers, "think", "p2", "Sam Rivera"),
  nom(hexAppeal, "judges", "p3", "Ken Ito"),
  // High School: a different wall.
  nom(monitors, "excellence", "p4", "Dana Cruz"),
];

export const win = (awardId: string, t: Team, division = t.division): WinnerRow => ({
  award_id: awardId, division, team_id: t.id, decided_by: "Alex Morgan", decided_at: "2026-10-20T15:00:00Z",
});

/** Amaze to 5150Z, Design to 2088C, Think to 1234A: 3 of 11 in Middle School. */
export const winners: WinnerRow[] = [win("amaze", gearGrinders), win("design", labRats), win("think", breakers)];

export const MS = "Middle School";
export const HS = "High School";
export const divisions = ["Elementary School", MS, HS, "Blended"];
