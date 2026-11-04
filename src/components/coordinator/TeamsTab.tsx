"use client";

import { teamList, pillText, rowState, ASK_DESK_LINE, NO_PANEL_LINE, SET_LANGUAGE_LINE, toggleLanguage } from "./coordinatorLogic";
import type { CoordinatorViewProps } from "./CoordinatorView";
import { requestOrder, TONE } from "@/components/desk/deskLogic";
import { divisionTag } from "@/components/admin/floorLogic";
import { LanguageCover, languageNames } from "@/components/Language";
import { filterTeamNumberInput, normalizeTeamNumber } from "@/lib/teamNumber";
import type { RequestRow } from "@/lib/types";

/** The status pill: the same fill and ink pairs the board and the desk use. */
export function Pill({ request }: { request: Pick<RequestRow, "status" | "slot_start"> }) {
  return <span className={`dk-sc dk-s-${TONE[request.status]}`}>{pillText(request)}</span>;
}

export function Info() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

/**
 * Teams, in walking order: search, division, "Not asked", then a row each
 * with its status pill and the EN / TH chips. A tap on the row opens it in
 * place (one at a time); a tap on a chip saves the language at once.
 */
export function TeamsTab(p: CoordinatorViewProps) {
  const { rows, total, asked, notAsked } = teamList(p.teams, p.requests, {
    query: p.query,
    division: p.division,
    notAskedOnly: p.notAskedOnly,
  });
  const order = p.languages.map((l) => l.id);
  const panelById = new Map(p.panels.map((x) => [x.id, x]));

  return (
    <>
      <div className="co-srch">
        <label className="sr-only" htmlFor="co-q">
          Find a team by number or name
        </label>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
        <input
          id="co-q"
          className="dk-input"
          type="text"
          value={p.query}
          onChange={(e) => p.onQuery(filterTeamNumberInput(e.target.value))}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          placeholder="Team number or name"
        />
      </div>

      <div className="co-frow">
        <div className="dk-selw">
          <label className="sr-only" htmlFor="co-div">
            Division
          </label>
          <select id="co-div" className="dk-input dk-sel" value={p.division} onChange={(e) => p.onDivision(e.target.value)}>
            <option value="">All divisions</option>
            {p.divisions.map((d) => (
              <option key={d} value={d}>
                {divisionTag(d)}
              </option>
            ))}
          </select>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
        <button type="button" className="co-tgl" aria-pressed={p.notAskedOnly} onClick={() => p.onNotAskedOnly(!p.notAskedOnly)}>
          Not asked <b>{notAsked}</b>
        </button>
      </div>

      <p className="co-sum">
        {total} {total === 1 ? "team" : "teams"} · {asked} asked · {notAsked} not asked yet
      </p>

      <ul className="co-tl" aria-label="Teams">
        {rows.map(({ team, request }) => {
          const open = p.openId === team.id;
          const none = !team.languages.length;
          const panel = team.panel_id ? (panelById.get(team.panel_id) ?? null) : null;
          const state = rowState(team, panel, request);
          const ready = state.kind === "ready";

          return (
            <li key={team.id} className="co-card" data-open={open}>
              <div className="co-trow">
                <button
                  type="button"
                  className="co-tt"
                  aria-expanded={open}
                  aria-controls={`co-x-${team.id}`}
                  onClick={() => p.onOpen(open ? null : team.id)}
                >
                  <span className="co-tx">
                    <span className="co-t1">
                      <b>{team.number}</b>
                      <span className="co-nm">{team.name}</span>
                    </span>
                    <span className="co-t2">
                      <span>
                        {divisionTag(team.division)}
                        {team.pit ? ` · Pit ${team.pit}` : ""}
                      </span>
                      {request ? <Pill request={request} /> : null}
                    </span>
                  </span>
                  <span className="co-ask">{none ? "Ask" : ""}</span>
                </button>
                <div className={`co-chips${none ? " none" : ""}`} role="group" aria-label={`Interview language for ${team.number}${none ? ", not asked yet" : ""}`}>
                  {p.languages.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className="co-chip"
                      aria-pressed={team.languages.includes(l.id)}
                      onClick={() => p.onLanguages(team, toggleLanguage(team.languages, l.id, order))}
                    >
                      <span aria-hidden="true">{l.short}</span>
                      <span className="sr-only">{l.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {open ? (
                <div className="co-xp" id={`co-x-${team.id}`} role="group" aria-label={`Actions for ${team.number}`}>
                  {state.kind === "held" ? (
                    <p className="co-held">
                      <Pill request={state.request} />
                      <span>{ASK_DESK_LINE}</span>
                    </p>
                  ) : (
                    <>
                      {requestOrder(team, p.languages).map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          className={o.primary ? "dk-prim dk-lg" : "dk-out"}
                          disabled={!ready || p.busy}
                          onClick={() => p.onRequest(team, o.id)}
                        >
                          Request · {languageNames([o.id], p.languages)}
                        </button>
                      ))}
                      {state.kind === "ready" ? (
                        <div className="dk-cover">
                          <LanguageCover panel={state.panel} languages={p.languages} />
                        </div>
                      ) : (
                        <p className="dk-cover">{state.kind === "no-language" ? SET_LANGUAGE_LINE : NO_PANEL_LINE}</p>
                      )}
                      <button type="button" className="co-txb" disabled={!ready} onClick={() => p.onBookTime(team)}>
                        Book a time
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
        {!rows.length ? (
          <li className="dk-empty">
            {p.query
              ? `No team matches ${normalizeTeamNumber(p.query)}.`
              : p.notAskedOnly
                ? "Every team has a language."
                : "No teams yet."}
          </li>
        ) : null}
      </ul>

      <p className="co-ro">
        <Info />
        <span>Teams with a booking or waiting show here read-only. {ASK_DESK_LINE}</span>
      </p>
    </>
  );
}
