"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import { CheckIcon, ChevronDown, CloseIcon, PlusIcon, WarnIcon } from "@/components/judge/parts";
import { call } from "@/components/useAppState";
import type { AppState, JudgeRow, Panel, PublicPanel } from "@/lib/types";
import { divisionTag, teamCount } from "./floorLogic";
import {
  addJudge,
  changeDivisionAfterAsking,
  conflictsLabel,
  deleteAllPanels,
  deletedAllNotice,
  deletePanelAfterAsking,
  judgeConflicts,
  moveJudgeShowing,
  panelJudges,
  panelValue,
  removeJudgeAfterAsking,
  rosterGroups,
  slotBody,
  slotsHeader,
  slotsSummary,
  startSlotDraft,
  takeOffCopy,
  takeOffLines,
  teamsByPanel,
  type PendingMove,
  type SlotDraft,
  type TakeOffInfo,
} from "./panelsLogic";

function Glyph({ size = 16, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const CopyIcon = () => (
  <Glyph>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
  </Glyph>
);
const TrashIcon = () => (
  <Glyph>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </Glyph>
);
const DotsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);

type Slice = Pick<AppState, "judges" | "panels" | "teams" | "conflicts" | "divisions" | "languages">;
type View = "judges" | "panels";
type JudgeForm = { kind: "new" } | { kind: "rename"; judge: JudgeRow };

const moreId = (judgeId: string) => `ja-pn-more-${judgeId}`;
const selectId = (judgeId: string) => `ja-pn-rs-${judgeId}`;

/**
 * The Panels section: the judge roster beside the panel cards. A judge's panel
 * is set from the roster -- moving one looks first (`dryRun`) and asks if teams
 * would come off the panel -- and a panel's judges are read off it. Every
 * question goes through the in-page confirm, or (the richer add-judge one) a
 * <dialog> built the same way. Nothing here decides what a conflict blocks.
 */
export function PanelsTab({
  state,
  refresh,
  onError,
  onOpenConflicts,
}: {
  state: AppState;
  refresh: () => Promise<void>;
  onError: (message: string | null) => void;
  /** Switch to the Conflicts section with this judge selected, as Scores' conduct link does for the Referee. */
  onOpenConflicts: (judgeId: string) => void;
}) {
  const { ask, dialog } = useConfirm();
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>("judges");
  const [pending, setPending] = useState<PendingMove>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [form, setForm] = useState<JudgeForm | null>(null);
  const [slotsFor, setSlotsFor] = useState<string | null>(null);
  const [takeOff, setTakeOff] = useState<(TakeOffInfo & { answer: (ok: boolean) => void }) | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focusEl, setFocusEl] = useState<string | null>(null);
  // One move at a time: a second change while the first is being looked at would answer the wrong question.
  const moving = useRef(false);

  // The sign-in codes are not in the polled state (it is sent to judges too), so they come from the panels route.
  const panelIds = state.panels.map((p) => p.id).join(",");
  const loadCodes = useMemo(
    () => () =>
      call<{ panels: Panel[] }>("/api/admin/panels", { method: "GET" })
        .then(({ panels }) => setCodes(Object.fromEntries(panels.map((p) => [p.id, p.code]))))
        .catch((e) => onError((e as Error).message)),
    [onError],
  );
  useEffect(() => {
    void loadCodes();
  }, [loadCodes, panelIds]);

  // Never leave a live "Delete all" button sitting around after a glance.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 8000);
    return () => clearTimeout(t);
  }, [armed]);

  // A "⋯" menu closes on Escape and on a press outside it. Escape only closes the menu here: nothing on this tab opens a question from a keydown.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(null);
      document.getElementById(moreId(menu))?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-ja-menu]")) setMenu(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [menu]);

  // A row that moved to another group, or a dialog that closed, hands the focus back to where the person was.
  useEffect(() => {
    if (!focusEl) return;
    document.getElementById(focusEl)?.focus();
    setFocusEl(null);
  }, [focusEl]);

  /** Run a write; show what the server refused. */
  async function run(fn: () => Promise<unknown>) {
    onError(null);
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  async function patchPanel(id: string, body: Record<string, unknown>) {
    await call("/api/admin/panels", { method: "PATCH", body: { id, ...body } });
    await refresh();
    await loadCodes();
  }

  async function move(judge: JudgeRow, panelId: string) {
    if (moving.current) return;
    moving.current = true;
    onError(null);
    try {
      if (judge.panel_id && judge.panel_id !== panelId) {
        const oldPanel = state.panels.find((p) => p.id === judge.panel_id)?.name ?? "their old panel";
        if (!(await ask(`Move ${judge.name} off ${oldPanel}?\n\nThat panel gets a new shared code. Everyone still on it will need to sign in again.`, { confirmLabel: "Move judge" }))) return;
      }
      const panelName = state.panels.find((p) => p.id === panelId)?.name ?? "that panel";
      await moveJudgeShowing(
        call,
        judge,
        panelId,
        (takenOff) =>
          new Promise<boolean>((answer) =>
            setTakeOff({ judge, panelName, lines: takeOffLines(judge.id, takenOff, state.teams, state.conflicts), answer }),
          ),
        setPending,
        async () => {
          await refresh();
          await loadCodes();
          setFocusEl(selectId(judge.id));
        },
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      moving.current = false;
    }
  }

  function answerTakeOff(ok: boolean) {
    takeOff?.answer(ok);
    setTakeOff(null);
  }

  async function remove(judge: JudgeRow) {
    setMenu(null);
    await run(async () => {
      if (await removeJudgeAfterAsking(ask, call, judge, judgeConflicts(judge.id, state.conflicts))) {
        await refresh();
        await loadCodes();
      }
      else setFocusEl(moreId(judge.id));
    });
  }

  async function saveJudge(name: string, note: string) {
    if (form?.kind === "rename") {
      await call("/api/admin/judges", { method: "PATCH", body: { id: form.judge.id, name } });
    } else {
      await addJudge(call, name, note);
    }
    await refresh();
  }

  function closeForm() {
    if (form?.kind === "rename") setFocusEl(moreId(form.judge.id));
    setForm(null);
  }

  async function addPanel(name: string, division: string): Promise<boolean> {
    setBusy(true);
    onError(null);
    try {
      await call("/api/admin/panels", {
        body: { name, division: division || state.divisions[0], sortOrder: state.panels.length + 1 },
      });
      await loadCodes();
      await refresh();
      return true;
    } catch (e) {
      onError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addPresets() {
    setBusy(true);
    onError(null);
    try {
      const res = await call<{ created: number }>("/api/admin/panels", { method: "PUT" });
      await loadCodes();
      await refresh();
      if (!res.created) onError("Every preset panel already exists.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAll() {
    setBusy(true);
    onError(null);
    try {
      const res = await deleteAllPanels(call);
      await loadCodes();
      await refresh();
      setArmed(false);
      onError(deletedAllNotice(res.deleted));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const slotsPanel = slotsFor ? (state.panels.find((p) => p.id === slotsFor) ?? null) : null;

  return (
    <PanelsBoard
      state={state}
      codes={codes}
      view={view}
      onView={setView}
      pending={pending}
      menu={menu}
      onMenu={setMenu}
      busy={busy}
      armed={armed}
      onArm={() => setArmed(true)}
      onDisarm={() => setArmed(false)}
      onDeleteAll={deleteAll}
      onNewJudge={() => setForm({ kind: "new" })}
      onMove={move}
      onOpenConflicts={onOpenConflicts}
      onRename={(judge) => {
        setMenu(null);
        setForm({ kind: "rename", judge });
      }}
      onRemove={remove}
      onToggleLanguage={(panel, id) =>
        run(() =>
          patchPanel(panel.id, {
            languages: panel.languages.includes(id) ? panel.languages.filter((x) => x !== id) : [...panel.languages, id],
          }),
        )
      }
      onEditSlots={(panel) => setSlotsFor(panel.id)}
      onDivision={(panel, division) =>
        run(() => changeDivisionAfterAsking(ask, panel.name, division, () => patchPanel(panel.id, { division })))
      }
      onDeletePanel={(panel) =>
        run(async () => {
          if (await deletePanelAfterAsking(ask, call, panel)) {
            await loadCodes();
            await refresh();
          }
        })
      }
      onAddPanel={addPanel}
      onPresets={addPresets}
    >
      {dialog}
      <JudgeDialog mode={form} onSubmit={saveJudge} onClose={closeForm} />
      <SlotsDialog panel={slotsPanel} onSave={(id, draft) => patchPanel(id, slotBody(draft))} onClose={() => setSlotsFor(null)} />
      <TakeOffDialog info={takeOff} onAnswer={answerTakeOff} />
    </PanelsBoard>
  );
}

/* ---- the page ------------------------------------------------------------- */

/**
 * The roster, the cards, Add panel, presets and Delete all. Everything it shows
 * comes in as props, so the markup can be checked without a browser;
 * `PanelsTab` owns the state. From 1024px the roster and the cards sit side by
 * side; below it a Judges | Panels switch shows one at a time.
 */
export function PanelsBoard({
  state,
  codes,
  view = "judges",
  onView,
  pending = null,
  menu = null,
  onMenu,
  busy = false,
  armed = false,
  onArm,
  onDisarm,
  onDeleteAll,
  onNewJudge,
  onMove,
  onOpenConflicts,
  onRename,
  onRemove,
  onToggleLanguage,
  onEditSlots,
  onDivision,
  onDeletePanel,
  onAddPanel,
  onPresets,
  children,
}: {
  state: Slice;
  /** Panel id -> sign-in code. */
  codes: Record<string, string>;
  view?: View;
  onView: (view: View) => void;
  pending?: PendingMove;
  /** The judge whose "⋯" menu is open. */
  menu?: string | null;
  onMenu: (judgeId: string | null) => void;
  busy?: boolean;
  armed?: boolean;
  onArm: () => void;
  onDisarm: () => void;
  onDeleteAll: () => void;
  onNewJudge: () => void;
  onMove: (judge: JudgeRow, panelId: string) => void;
  onOpenConflicts: (judgeId: string) => void;
  onRename: (judge: JudgeRow) => void;
  onRemove: (judge: JudgeRow) => void;
  onToggleLanguage: (panel: PublicPanel, languageId: string) => void;
  onEditSlots: (panel: PublicPanel) => void;
  onDivision: (panel: PublicPanel, division: string) => void;
  onDeletePanel: (panel: PublicPanel) => void;
  onAddPanel: (name: string, division: string) => Promise<boolean>;
  onPresets: () => void;
  /** The dialogs, rendered inside the board's own root. */
  children?: React.ReactNode;
}) {
  const uid = useId();
  const { judges, panels, teams, conflicts, divisions, languages } = state;
  const groups = useMemo(() => rosterGroups(judges, panels), [judges, panels]);
  const held = useMemo(() => teamsByPanel(teams), [teams]);

  return (
    <div className="ja-pn" data-view={view}>
      <div className="ja-pn-seg" role="group" aria-label="Show">
        <button type="button" aria-pressed={view === "judges"} onClick={() => onView("judges")}>
          <span>Judges</span>
          <small>{judges.length}</small>
        </button>
        <button type="button" aria-pressed={view === "panels"} onClick={() => onView("panels")}>
          <span>Panels</span>
          <small>{panels.length}</small>
        </button>
      </div>

      <div className="ja-pn-cols">
        <section className="ja-pn-roster" aria-labelledby={`${uid}-ro`}>
          <header className="ja-pn-rh">
            <h2 id={`${uid}-ro`}>{`Judges · ${judges.length}`}</h2>
            <button type="button" className="ja-pn-gh" aria-haspopup="dialog" onClick={onNewJudge}>
              <PlusIcon />
              New judge
            </button>
          </header>

          {groups.length ? (
            groups.map((g) => (
              <section key={g.key} className="ja-pn-grp" aria-labelledby={`${uid}-g-${g.key}`}>
                <header className="ja-pn-gh2">
                  <h3 id={`${uid}-g-${g.key}`}>{g.label}</h3>
                  <span>{`(${g.judges.length})`}</span>
                </header>
                <ul>
                  {g.judges.map((j) => {
                    const n = judgeConflicts(j.id, conflicts);
                    const value = pending?.judgeId === j.id ? pending.panelId : panelValue(j, panels);
                    return (
                      <li key={j.id} className="ja-pn-jr" data-nc={n ? undefined : "true"}>
                        <span className="ja-pn-jt" title={j.note ?? undefined}>
                          {j.name}
                        </span>
                        {n ? (
                          <button
                            type="button"
                            className="ja-pn-cp"
                            aria-label={`${conflictsLabel(n)}: open ${j.name} in Conflicts`}
                            onClick={() => onOpenConflicts(j.id)}
                          >
                            {conflictsLabel(n)}
                          </button>
                        ) : null}
                        <div className="ja-pn-sw">
                          <label className="sr-only" htmlFor={selectId(j.id)}>
                            {`Panel for ${j.name}`}
                          </label>
                          <select id={selectId(j.id)} className="ja-pn-ssel" value={value} onChange={(e) => onMove(j, e.target.value)}>
                            <option value="">— none —</option>
                            {panels.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <ChevronDown />
                        </div>
                        <div className="ja-mw ja-pn-mw" data-ja-menu>
                          <button
                            type="button"
                            id={moreId(j.id)}
                            className="ja-more ja-pn-more"
                            aria-label={`More actions for ${j.name}: rename, remove from roster`}
                            aria-haspopup="dialog"
                            aria-expanded={menu === j.id}
                            onClick={() => onMenu(menu === j.id ? null : j.id)}
                          >
                            <DotsIcon />
                          </button>
                          {menu === j.id ? (
                            <Popover label={`Actions for ${j.name}`}>
                              <button type="button" className="ja-pi" autoFocus onClick={() => onRename(j)}>
                                Rename
                              </button>
                              <button type="button" className="ja-pi ja-danger" onClick={() => onRemove(j)}>
                                Remove from roster
                              </button>
                            </Popover>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          ) : (
            <p className="ja-pn-empty">Nobody on the roster yet. Add the people who will judge, then put each on a panel.</p>
          )}
        </section>
        <p className="ja-pn-hint">Pick a panel for each judge. A judge sits on one panel at most.</p>

        <div className="ja-pn-right">
          <h2 className="sr-only">Panels</h2>
          {panels.length ? (
            <div className="ja-pn-grid">
              {panels.map((p) => (
                <PanelCard
                  key={p.id}
                  panel={p}
                  code={codes[p.id] ?? ""}
                  judgeNames={panelJudges(p.id, judges)}
                  teams={held.get(p.id) ?? 0}
                  languages={languages}
                  divisions={divisions}
                  onToggleLanguage={onToggleLanguage}
                  onEditSlots={onEditSlots}
                  onDivision={onDivision}
                  onDelete={onDeletePanel}
                />
              ))}
            </div>
          ) : (
            <p className="ja-pn-empty">
              No judge panels yet. Add one below, or load your presets — judges sign in with a panel&apos;s code.
            </p>
          )}
          <AddPanelForm divisions={divisions} busy={busy} onAdd={onAddPanel} />
        </div>
      </div>

      <div className="ja-pn-foot">
        <div className="ja-pn-fbox">
          <button type="button" className="ja-pn-gh" disabled={busy} onClick={onPresets}>
            Add preset panels
          </button>
          <p>
            Creates anything in <code>config/event.json</code> that is missing. Never overwrites a panel you already have.
          </p>
        </div>
        {panels.length ? (
          <div className="ja-pn-fbox ja-pn-dgr">
            {armed ? (
              <>
                {/* Cancel takes the place the first click was on, so a double-click lands on the safe answer. */}
                <button key="cancel" type="button" className="ja-pn-gh" autoFocus disabled={busy} onClick={onDisarm}>
                  Cancel
                </button>
                <button key="go" type="button" className="ja-pn-dbtn" disabled={busy} onClick={onDeleteAll}>
                  {busy ? "Deleting…" : `Delete all ${panels.length} ${panels.length === 1 ? "panel" : "panels"}`}
                </button>
                <p role="alert">Every judge code stops working immediately. Your teams stay, unassigned.</p>
              </>
            ) : (
              <>
                <button key="arm" type="button" className="ja-pn-dbtn" disabled={busy} onClick={onArm}>
                  Delete all panels
                </button>
                <p>{`Clears all ${panels.length} ${panels.length === 1 ? "panel" : "panels"} so you can start over. Teams are kept.`}</p>
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* On a phone's Judges view a button pinned to the bottom adds a judge. */}
      <div className="ja-pin ja-pn-pin">
        <button type="button" className="ja-prim" aria-haspopup="dialog" onClick={onNewJudge}>
          <PlusIcon />
          New judge
        </button>
      </div>

      {children}
    </div>
  );
}

/** The "⋯" menu, scrolled into view when it opens near the foot of the page. */
function Popover({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  return (
    <div ref={ref} className="ja-pop" role="dialog" aria-label={label}>
      {children}
    </div>
  );
}

/* ---- a panel's card ------------------------------------------------------- */

function PanelCard({
  panel,
  code,
  judgeNames,
  teams,
  languages,
  divisions,
  onToggleLanguage,
  onEditSlots,
  onDivision,
  onDelete,
}: {
  panel: PublicPanel;
  code: string;
  judgeNames: string[];
  teams: number;
  languages: Slice["languages"];
  divisions: string[];
  onToggleLanguage: (panel: PublicPanel, languageId: string) => void;
  onEditSlots: (panel: PublicPanel) => void;
  onDivision: (panel: PublicPanel, division: string) => void;
  onDelete: (panel: PublicPanel) => void;
}) {
  const uid = useId();
  const codeEl = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState<"copied" | "selected" | null>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied("copied");
    } catch {
      // No clipboard on an http page: select the code so it can be copied by hand.
      if (codeEl.current) window.getSelection()?.selectAllChildren(codeEl.current);
      setCopied("selected");
    }
  }

  return (
    <article className="ja-pn-card" aria-labelledby={`${uid}-h`}>
      <header className="ja-pn-ch">
        <h3 id={`${uid}-h`}>{panel.name}</h3>
        <span className="jg-ptag" title={panel.division}>
          <span aria-hidden="true">{divisionTag(panel.division)}</span>
          <span className="sr-only">{panel.division}</span>
        </span>
        <span className="ja-pn-tc">{teamCount(teams)}</span>
      </header>

      <div className="ja-pn-code">
        <div>
          <span className="ja-pn-cl">Judge sign-in code</span>
          <code ref={codeEl} className="ja-pn-cv">
            {code || "—"}
          </code>
        </div>
        <button type="button" className="ja-pn-gh ja-pn-cpy" disabled={!code} aria-label={`Copy ${code ? `code ${code}` : "code"} for ${panel.name}`} onClick={copy}>
          <CopyIcon />
          {copied === "copied" ? "Copied" : copied === "selected" ? "Selected" : "Copy"}
        </button>
        <span className="sr-only" role="status">
          {copied === "copied" ? "Code copied" : copied === "selected" ? "Code selected: copy it by hand" : ""}
        </span>
      </div>

      <div className="ja-pn-bj">
        <span className="ja-sec">
          Judges<span>· set from the roster</span>
        </span>
        {judgeNames.length ? (
          <p>{judgeNames.join(", ")}</p>
        ) : (
          <p>
            <span className="ja-pill">
              <WarnIcon />
              No judges yet
            </span>
          </p>
        )}
      </div>

      <div className="ja-fl">
        <span className="ja-sec" id={`${uid}-lg`}>
          Interviews in
        </span>
        <div className="ja-pn-lts" role="group" aria-labelledby={`${uid}-lg`}>
          {languages.map((l) => {
            const on = panel.languages.includes(l.id);
            return (
              <button key={l.id} type="button" className="ja-pn-lt" aria-pressed={on} onClick={() => onToggleLanguage(panel, l.id)}>
                {on ? <CheckIcon /> : null}
                <span lang={l.id}>{l.label}</span>
              </button>
            );
          })}
        </div>
        {!panel.languages.length ? <p className="ja-hint">Not stated — no request will be flagged.</p> : null}
      </div>

      <div className="ja-pn-bsl" data-off={panel.slot_count ? undefined : "true"}>
        <span>{slotsSummary(panel)}</span>
        <button type="button" className="ja-pn-edit" aria-haspopup="dialog" aria-label={`Edit booking slots for ${panel.name}`} onClick={() => onEditSlots(panel)}>
          Edit
        </button>
      </div>

      <div className="ja-pn-bf">
        <div className="ja-pn-dv">
          <label htmlFor={`${uid}-dv`}>Division</label>
          <div className="ja-pn-sw">
            {/* The select snaps back to the panel's division while the question is open; the choice is read from the event. */}
            <select id={`${uid}-dv`} className="ja-pn-ssel" value={panel.division} onChange={(e) => onDivision(panel, e.target.value)}>
              {divisions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <ChevronDown />
          </div>
        </div>
        <button type="button" className="ja-pn-del" aria-haspopup="dialog" aria-label={`Delete ${panel.name}`} onClick={() => onDelete(panel)}>
          <TrashIcon />
          Delete panel
        </button>
      </div>
    </article>
  );
}

/** Name and division; the panel is added with no judges, they come from the roster. */
function AddPanelForm({
  divisions,
  busy,
  onAdd,
}: {
  divisions: string[];
  busy: boolean;
  onAdd: (name: string, division: string) => Promise<boolean>;
}) {
  const uid = useId();
  const [name, setName] = useState("");
  const [division, setDivision] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    if (await onAdd(name, division)) {
      setName("");
      setDivision("");
    }
  }

  return (
    <form className="ja-pn-add" aria-label="Add panel" onSubmit={submit}>
      <div className="ja-fl ja-pn-an">
        <label className="ja-lab" htmlFor={`${uid}-n`}>
          Panel name
        </label>
        <input id={`${uid}-n`} className="ja-in" type="text" maxLength={80} autoComplete="off" placeholder="Panel D" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="ja-fl ja-pn-ad">
        <label className="ja-lab" htmlFor={`${uid}-d`}>
          Division
        </label>
        <div className="ja-selw">
          <select id={`${uid}-d`} className="ja-in ja-sel" value={division || divisions[0] || ""} onChange={(e) => setDivision(e.target.value)}>
            {divisions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <ChevronDown />
        </div>
      </div>
      <button type="submit" className="ja-prim ja-pn-addb" disabled={busy || !name.trim()}>
        Add panel
      </button>
    </form>
  );
}

/* ---- dialogs -------------------------------------------------------------- */

/**
 * A native <dialog> opened with showModal(), as the Correct flag sheet is: the
 * focus trap, Escape, `aria-modal` semantics and the inert page behind it come
 * with it. Escape and the backdrop ask the tab to close it. Whatever carries
 * `data-autofocus` gets the focus on opening (otherwise the first control does).
 */
function Modal({
  open,
  onClose,
  className,
  labelledBy,
  describedBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className: string;
  labelledBy: string;
  describedBy?: string;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      el.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`ja-sheet ${className}`}
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      // Escape closes the dialog by itself; tell the tab. A close it asked for (open already false) is not news.
      onClose={() => {
        if (open) onClose();
      }}
      // A click whose target is the dialog itself landed on the backdrop.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}

/** The top of a sheet: grab handle (phone), title and a 44px close. */
function SheetTop({ titleId, title, sub, onClose }: { titleId: string; title: string; sub?: string; onClose: () => void }) {
  return (
    <>
      <div className="jg-grab" aria-hidden="true" />
      <div className="ja-sh-top">
        <h2 id={titleId}>
          {title}
          {sub ? <span className="ja-pn-sub">{` · ${sub}`}</span> : null}
        </h2>
        <button type="button" className="ja-x" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
    </>
  );
}

/** "New judge" (name and an optional note: the roster only, on no panel) or "Rename judge". */
export function JudgeDialog({
  mode,
  onSubmit,
  onClose,
}: {
  mode: JudgeForm | null;
  onSubmit: (name: string, note: string) => Promise<void>;
  onClose: () => void;
}) {
  const titleId = useId();
  return (
    <Modal open={mode !== null} onClose={onClose} className="ja-pn-dlg" labelledBy={titleId}>
      {mode ? <JudgeFormBody key={mode.kind === "rename" ? mode.judge.id : "new"} mode={mode} titleId={titleId} onSubmit={onSubmit} onClose={onClose} /> : null}
    </Modal>
  );
}

function JudgeFormBody({
  mode,
  titleId,
  onSubmit,
  onClose,
}: {
  mode: JudgeForm;
  titleId: string;
  onSubmit: (name: string, note: string) => Promise<void>;
  onClose: () => void;
}) {
  const uid = useId();
  const renaming = mode.kind === "rename";
  const [name, setName] = useState(mode.kind === "rename" ? mode.judge.name : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name, note);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="ja-sh-form" onSubmit={submit}>
      <SheetTop titleId={titleId} title={renaming ? "Rename judge" : "New judge"} onClose={onClose} />
      <div className="ja-cf-scroll">
        {error ? (
          <p className="ja-err" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ja-fl">
          <label className="ja-lab" htmlFor={`${uid}-name`}>
            {renaming ? "Name" : "Judge’s name"}
          </label>
          <input
            id={`${uid}-name`}
            className="ja-in"
            type="text"
            maxLength={80}
            autoComplete="off"
            placeholder="e.g. Priya Nair"
            data-autofocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {renaming ? null : (
          <>
            <div className="ja-fl">
              <label className="ja-lab" htmlFor={`${uid}-note`}>
                About them <span className="ja-op">(optional)</span>
              </label>
              <input
                id={`${uid}-note`}
                className="ja-in"
                type="text"
                maxLength={280}
                autoComplete="off"
                placeholder="e.g. volunteer from the robotics club"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <p className="ja-hint">Added to the roster on no panel. Pick their panel from the list.</p>
          </>
        )}
      </div>
      <div className="ja-cf-foot">
        <button type="submit" className="ja-prim" disabled={busy || !name.trim()}>
          {busy ? "Saving…" : renaming ? "Save name" : "Add judge"}
        </button>
      </div>
    </form>
  );
}

/** The slot-grid fields, in a small dialog: first slot, minutes each, how many. */
export function SlotsDialog({
  panel,
  onSave,
  onClose,
}: {
  /** The panel being edited; null while the dialog is shut. */
  panel: PublicPanel | null;
  onSave: (panelId: string, draft: SlotDraft) => Promise<void>;
  onClose: () => void;
}) {
  const titleId = useId();
  return (
    <Modal open={panel !== null} onClose={onClose} className="ja-pn-dlg" labelledBy={titleId}>
      {panel ? <SlotsBody key={panel.id} panel={panel} titleId={titleId} onSave={onSave} onClose={onClose} /> : null}
    </Modal>
  );
}

function SlotsBody({
  panel,
  titleId,
  onSave,
  onClose,
}: {
  panel: PublicPanel;
  titleId: string;
  onSave: (panelId: string, draft: SlotDraft) => Promise<void>;
  onClose: () => void;
}) {
  const uid = useId();
  const [draft, setDraft] = useState<SlotDraft>(() => startSlotDraft(panel));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(panel.id, draft);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="ja-sh-form" onSubmit={submit}>
      <SheetTop titleId={titleId} title={slotsHeader(panel)} sub={panel.name} onClose={onClose} />
      <div className="ja-cf-scroll">
        {error ? (
          <p className="ja-err" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ja-fl">
          <label className="ja-lab" htmlFor={`${uid}-start`}>
            First slot starts
          </label>
          <input
            id={`${uid}-start`}
            className="ja-in"
            type="datetime-local"
            data-autofocus
            value={draft.start}
            onChange={(e) => setDraft({ ...draft, start: e.target.value })}
          />
        </div>
        <div className="ja-pn-g2">
          <div className="ja-fl">
            <label className="ja-lab" htmlFor={`${uid}-min`}>
              Minutes each
            </label>
            <input
              id={`${uid}-min`}
              className="ja-in"
              type="number"
              min={3}
              max={120}
              value={draft.minutes}
              onChange={(e) => setDraft({ ...draft, minutes: Number(e.target.value) })}
            />
          </div>
          <div className="ja-fl">
            <label className="ja-lab" htmlFor={`${uid}-n`}>
              How many
            </label>
            <input
              id={`${uid}-n`}
              className="ja-in"
              type="number"
              min={0}
              max={60}
              value={draft.count}
              onChange={(e) => setDraft({ ...draft, count: Number(e.target.value) })}
            />
          </div>
        </div>
        <p className="ja-hint">Set &ldquo;how many&rdquo; to 0 for walk-up queue only.</p>
      </div>
      <div className="ja-cf-foot">
        <button type="submit" className="ja-prim" disabled={busy}>
          {busy ? "Saving…" : "Save slot grid"}
        </button>
      </div>
    </form>
  );
}

/**
 * "Add Priya Nair to Panel 3?": the question a move asks when the judge's
 * conflicts would take teams off that panel. Cancel has the focus. Escape, the
 * backdrop and Cancel all answer No; only "Add and take teams off" answers Yes.
 */
export function TakeOffDialog({ info, onAnswer }: { info: TakeOffInfo | null; onAnswer: (ok: boolean) => void }) {
  const titleId = useId();
  const bodyId = useId();
  const copy = info ? takeOffCopy(info.judge.name, info.panelName, info.lines.length) : null;
  return (
    <Modal open={info !== null} onClose={() => onAnswer(false)} className="ja-pn-cfm" labelledBy={titleId} describedBy={bodyId}>
      {info && copy ? (
        <div className="ja-pn-cf">
          <h2 id={titleId}>{copy.title}</h2>
          <p className="ja-pn-cfb" id={bodyId}>
            {copy.lead}
          </p>
          <ul className="ja-pn-cfl" aria-label={`Teams that come off ${info.panelName}`}>
            {info.lines.map((l) => (
              <li key={l.number}>
                <p className="ja-pn-r1">
                  <b>{l.number}</b>
                  {l.name ? <span>{l.name}</span> : null}
                </p>
                {l.note ? <p className="ja-pn-r2">&ldquo;{l.note}&rdquo;</p> : null}
              </li>
            ))}
          </ul>
          <div className="jg-caution" role="note">
            <WarnIcon />
            <p>{copy.caution}</p>
          </div>
          <div className="ja-pn-cfx">
            {/* Cancel comes first, so it is also where showModal() puts the focus: the safe answer. */}
            <button type="button" className="ja-pn-gh ja-pn-cfc" data-autofocus onClick={() => onAnswer(false)}>
              Cancel
            </button>
            <button type="button" className="ja-prim ja-pn-cfo" onClick={() => onAnswer(true)}>
              {copy.confirm}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
