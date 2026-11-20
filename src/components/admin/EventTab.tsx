"use client";

import { useId, useRef, useState } from "react";
import { presetDivisions, presetPrograms, awards as presetAwards } from "@/lib/presets";
import type { AppState, AwardsAdminView, EventSetup, ReleasedView } from "@/lib/types";
import type { AdminTab } from "./AdminFrame";
import { canSave, checklist, outsideRows, previewGroups, tiles, type Row } from "./eventLogic";

type Pick2 = Pick<EventSetup, "program" | "format">;
type Outside = Parameters<typeof outsideRows>[0];

const svg = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const Tick = ({ size, width }: { size: number; width: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={width} {...svg}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const same = (a: Pick2 | null, b: Pick2 | null) => Boolean(a && b && a.program === b.program && a.format === b.format);

const ROW_LABEL = { awards: "Awards", teams: "Teams", panels: "Panels" } as const;
const GO_TAB = { awards: "awards", teams: "teams", panels: "panels" } as const;

function ChecklistRow({ row, onOpenTab }: { row: Row; onOpenTab: (t: AdminTab) => void }) {
  const lead = "Clear the awards first.";
  return (
    <li className={`ja-es-cr${row.ok === false ? " ja-es-warn" : ""}`}>
      <span
        className={`ja-es-si ${row.ok === true ? "ja-es-ok" : row.ok === false ? "ja-es-no" : "ja-es-wait"}`}
        role="img"
        aria-label={row.ok === true ? "Fine" : row.ok === false ? "Needs attention" : "Checking"}
      >
        {row.ok === true ? (
          <Tick size={14} width={3} />
        ) : row.ok === false ? (
          <svg width="18" height="18" viewBox="0 0 24 24" strokeWidth={2} {...svg}>
            <path d="M12 4l9 16H3zM12 10v4M12 17v.01" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" strokeWidth={3} {...svg}>
            <path d="M6 12h.01M12 12h.01M18 12h.01" />
          </svg>
        )}
      </span>
      <div className="ja-es-cb">
        <p className="ja-es-ms">
          <b>{ROW_LABEL[row.id]}</b>
          {row.text.startsWith(lead) ? (
            <>
              <em>{lead}</em>
              {row.text.slice(lead.length)}
            </>
          ) : (
            row.text
          )}
        </p>
        {row.id === "teams" && row.items?.length ? (
          <ul className="ja-es-tl">
            {row.items.map((t) => (
              <li key={t.id}>
                <b>{t.main}</b>
                <span className="ja-es-n">{t.sub}</span>
                {t.tag ? <span className="ja-es-ptag">{t.tag}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {row.ok === false ? (
        <button type="button" className="ja-es-go" onClick={() => onOpenTab(GO_TAB[row.id])}>
          Open {ROW_LABEL[row.id]}
        </button>
      ) : null}
    </li>
  );
}

/**
 * The Judge Advisor's Event page: which program the event runs and its format
 * (Standard or Blended). Four tiles, a preview of what that gives the Awards
 * tab and the Awards Desk, and the three things that would refuse the save.
 * The checklist is a convenience; PUT /api/event-setup is the rule, and its
 * refusal is shown as it comes.
 */
export function EventTab({
  state,
  awards,
  released,
  refresh,
  reloadAwards,
  onError,
  onOpenTab,
}: {
  state: AppState;
  awards: AwardsAdminView | null;
  released: ReleasedView | null;
  refresh: () => Promise<void> | void;
  /** Asks /api/awards again now: a refused save says the awards changed, and the Awards row should too. */
  reloadAwards: () => Promise<void>;
  onError: (m: string | null) => void;
  onOpenTab: (t: AdminTab) => void;
}) {
  const saved = state.eventSetup;
  const awardList = awards?.awards ?? presetAwards();
  const tileList = tiles(presetPrograms(), awardList);
  const fromSaved = () => (saved && tileList.some((t) => same(t, saved)) ? { program: saved.program, format: saved.format } : null);
  const [picked, setPicked] = useState<Pick2 | null>(fromSaved);
  /* A save from elsewhere, or state arriving late, moves the pick to the new saved setup. */
  const savedKey = saved ? `${saved.program}|${saved.format}` : "";
  const [seenSaved, setSeenSaved] = useState(savedKey);
  if (seenSaved !== savedKey) {
    setSeenSaved(savedKey);
    setPicked(fromSaved());
  }
  /* The 409's `outside` list: replaces the Teams and Panels rows until the pick changes or the teams or panels do. */
  const rosterKey = [...state.teams.map((t) => `${t.id}:${t.division}`), "|", ...state.panels.map((p) => `${p.id}:${p.division}`)].join(",");
  const [refused, setOutside] = useState<{ list: Outside; key: string } | null>(null);
  const outside = refused?.key === rosterKey ? refused.list : null;
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const hintId = useId();
  const uid = useId();

  const pickedTile = tileList.find((t) => same(t, picked)) ?? null;
  const choose = (t: { program: string; format: Pick2["format"] }) => {
    if (same(t, picked)) return;
    setPicked({ program: t.program, format: t.format });
    setOutside(null);
    onError(null);
  };
  const move = (i: number, step: number) => {
    const j = (i + step + tileList.length) % tileList.length;
    choose(tileList[j]);
    refs.current[j]?.focus();
  };

  // The saved setup is the key the awards were decided under: state is fresher than the awards poll.
  const rows: Row[] = picked
    ? (() => {
        const base = checklist(picked, {
          awards,
          released,
          saved,
          divisions: state.divisions,
          teams: state.teams,
          panels: state.panels,
        });
        return outside ? [base[0], ...outsideRows(outside, state.teams, picked.program)] : base;
      })()
    : [];
  const allowed = canSave(picked, saved, rows);
  const hint = !picked
    ? "Pick a program and format to save."
    : same(picked, saved)
      ? null
      : rows.some((r) => r.ok === false)
        ? "Fix the items above to save."
        : rows.some((r) => r.ok === null)
          ? "Checking the awards…"
          : null;

  const save = async () => {
    if (!picked || busy.current) return;
    busy.current = true;
    setSaving(true);
    onError(null);
    try {
      // Not `call`: it keeps only the message, and a 409 also carries `outside`.
      const res = await fetch("/api/event-setup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program: picked.program, format: picked.format }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(data.error || `Request failed (${res.status})`);
        if (data.outside) setOutside({ list: data.outside, key: rosterKey });
        await reloadAwards();
        return;
      }
      setOutside(null);
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the event setup.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const groups = pickedTile ? previewGroups(pickedTile.divisions, pickedTile.format, awardList) : [];
  const time = saved ? hhmm(saved.updated_at) : "";

  return (
    <div className="ja-es">
      <div className="ja-es-tit">
        <h2 className="ja-es-h">Event setup</h2>
        <p className="ja-es-intro">Pick what this event runs. It decides the divisions and how awards are given.</p>
      </div>

      {!saved ? (
        <div className="ja-es-notice" role="note">
          <svg width="18" height="18" viewBox="0 0 24 24" strokeWidth={1.8} {...svg}>
            <path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 11v5M12 8v.01" />
          </svg>
          <span>
            Not set up yet. The event uses the divisions from the config ({presetDivisions().join(", ")}) and gives every award once per division, as today.
          </span>
        </div>
      ) : null}

      <div
        className="ja-es-tiles"
        role="radiogroup"
        aria-label="Program and format"
        onKeyDown={(e) => {
          const i = refs.current.findIndex((b) => b === document.activeElement);
          if (i < 0) return;
          if (e.key === "ArrowRight" || e.key === "ArrowDown") move(i, 1);
          else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(i, -1);
          else return;
          e.preventDefault();
        }}
      >
        {tileList.map((t, i) => {
          const on = same(t, picked);
          return (
            <button
              key={t.title}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-labelledby={`${uid}-t${i}`}
              aria-describedby={same(t, saved) ? `${uid}-s${i}` : undefined}
              tabIndex={on || (!picked && i === 0) ? 0 : -1}
              className="ja-es-tile"
              onClick={() => choose(t)}
            >
              <span className="ja-es-tt">
                <span className="ja-es-tn">
                  <b id={`${uid}-t${i}`}>{t.title}</b>
                  {same(t, saved) ? (
                    <span className="ja-es-sv" id={`${uid}-s${i}`}>
                      <Tick size={11} width={3} />
                      Saved
                    </span>
                  ) : null}
                </span>
                <span className="ja-es-dv">{t.divisions.join(" + ")}</span>
                <span className="ja-es-ds">{t.line}</span>
              </span>
              <span className="ja-es-ck" aria-hidden="true">
                <Tick size={16} width={3} />
              </span>
            </button>
          );
        })}
      </div>

      <section className="ja-es-pv" aria-label="Preview">
        <span className="ja-es-eb">Preview</span>
        <h2 className="ja-es-ph">On the Awards tab and the Awards Desk</h2>
        {pickedTile ? (
          <>
            {groups.map((g) => (
              <div key={g.key} className="ja-es-pg">
                <div className="ja-es-pgh">
                  <b>{g.key}</b>
                  <span>
                    {g.labels.length} {g.labels.length === 1 ? "award" : "awards"}
                  </span>
                </div>
                <ul className="ja-es-pgc">
                  {g.labels.map((l) => (
                    <li key={l} className="ja-es-aw">
                      {l}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {pickedTile.format === "blended" ? <p className="ja-es-note">Any panel can interview any team.</p> : null}
          </>
        ) : (
          <p className="ja-es-mu">Pick a program and format to see the awards.</p>
        )}
      </section>

      {picked ? (
        <div className="ja-es-ckb">
          <h2 className="ja-es-ch">Before you can save</h2>
          <ul className="ja-es-cl">
            {rows.map((r) => (
              <ChecklistRow key={r.id} row={r} onOpenTab={onOpenTab} />
            ))}
          </ul>
        </div>
      ) : null}

      <div className="ja-es-save">
        <button type="button" className="ja-es-prim" disabled={!allowed || saving} aria-describedby={hint ? hintId : undefined} onClick={save}>
          {saving ? "Saving…" : "Save event setup"}
        </button>
        {hint ? (
          <span className="ja-es-hint" id={hintId}>
            {hint}
          </span>
        ) : null}
      </div>

      {saved ? (
        <p className="ja-es-by">
          Set {saved.set_by ? `by ${saved.set_by} ` : ""}
          {time ? `at ${time}` : ""}
        </p>
      ) : null}
    </div>
  );
}
