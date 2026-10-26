"use client";

import { useId, useState } from "react";
import { CheckIcon, WarnIcon } from "@/components/judge/parts";
import { call } from "@/components/useAppState";
import { readSpreadsheet } from "@/lib/spreadsheet";
import {
  importDisabled,
  importSummary,
  loadedLine,
  runImport,
  skippedEntry,
  skippedHeading,
  type ImportOutcome,
} from "./importLogic";

function Glyph({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/**
 * The Import section: one box. A file chosen, a file dropped on the card and
 * a paste all land in the same textarea; Import sends what is in it. The
 * answer is two boxes under the button: what was imported, and which lines
 * could not be read.
 */
export function ImportTab({
  refresh,
  onError,
  divisions,
}: {
  refresh: () => Promise<void>;
  onError: (message: string | null) => void;
  divisions: string[];
}) {
  const formatId = useId();
  const [text, setText] = useState("");
  const [autoAssign, setAutoAssign] = useState(true);
  const [perPanel, setPerPanel] = useState(10);
  const [loaded, setLoaded] = useState<{ line: string; warning?: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportOutcome | null>(null);

  /** Read a dropped or chosen file straight into the box. */
  async function takeFile(file: File | undefined | null) {
    if (!file) return;
    onError(null);
    setResult(null);
    setLoaded(null);
    try {
      const sheet = await readSpreadsheet(file);
      setText(sheet.text);
      setLoaded({ line: loadedLine(file.name, sheet.rows), warning: sheet.warning });
    } catch (e) {
      onError((e as Error).message);
    }
  }

  async function submit() {
    setBusy(true);
    onError(null);
    setResult(null);
    try {
      setResult(await runImport(call, { text, autoAssign, perPanel }));
      setText("");
      setLoaded(null);
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ja-im">
      <section className="ja-im-fmt" aria-labelledby={formatId}>
        <div className="ja-im-fmt-l">
          <h2 id={formatId} className="ja-im-k">
            Format · one team per line
          </h2>
          <p className="ja-im-line">number, name, pit, division</p>
          <p className="ja-im-hint">
            Tabs work too, and a header row is skipped. An optional fifth column sets the notebook type; without it,
            teams start as the default.
          </p>
        </div>
        <ul className="ja-im-bul">
          <li>
            <b>Division is each team&apos;s own.</b> One list can hold every division. Blank means the first one
            {divisions[0] ? (
              <>
                , <code>{divisions[0]}</code>
              </>
            ) : null}
            .
          </li>
          <li>
            <b>Pit reads as a letter and a number,</b> like <code>A1</code>. That places the team on the floor plan.
          </li>
          <li>
            <b>Re-importing updates teams.</b> It never duplicates them.
          </li>
        </ul>
      </section>

      {/* Drop a spreadsheet, or paste: both end up in the same box. */}
      <div
        className="ja-im-drop"
        data-drag={dragging ? "" : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          // Moving over the card's own children is not leaving it.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          takeFile(e.dataTransfer.files?.[0]);
        }}
      >
        <div className="ja-im-pickrow">
          <label className="ja-im-pick">
            <Glyph size={18}>
              <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M4 19h16" />
            </Glyph>
            Choose a file
            <input
              type="file"
              accept=".xlsx,.csv,.tsv,.txt"
              className="sr-only"
              onChange={(e) => {
                takeFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <p>or drag one here · .xlsx .csv .tsv · or paste below</p>
        </div>
        <textarea
          aria-label="Team list"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setLoaded(null);
          }}
          rows={8}
          wrap="off"
          spellCheck={false}
          placeholder={
            "1234, Iron Hawks, A1, Elementary School\n" +
            "9882K, Kilo Kestrels, A2, Middle School\n" +
            "9882A, Alpha Antelopes, B1, Elementary School"
          }
          className="ja-im-ta"
        />
      </div>

      {loaded ? (
        <p className="ja-im-info" role="status">
          <Glyph size={16}>
            <path d="M6 3h8l4 4v14H6zM14 3v4h4" />
          </Glyph>
          <span>{loaded.line}</span>
          {loaded.warning ? <span className="ja-im-warn">{loaded.warning}</span> : null}
        </p>
      ) : null}

      <div className="ja-im-opts">
        <label className="ja-im-chk">
          <input type="checkbox" className="ja-im-cb" checked={autoAssign} onChange={(e) => setAutoAssign(e.target.checked)} />
          Spread across panels evenly
        </label>
        <label className="ja-im-max">
          max
          <input
            type="number"
            min={1}
            max={40}
            value={perPanel}
            onChange={(e) => setPerPanel(Number(e.target.value))}
            disabled={!autoAssign}
            className="ja-im-num"
          />
          per panel
        </label>
        <button type="button" className="ja-prim" onClick={submit} disabled={importDisabled(text, busy)}>
          {busy ? "Importing…" : "Import"}
        </button>
      </div>

      {result ? <ImportResult outcome={result} /> : null}
    </div>
  );
}

/** What the import did, and (only when there were any) the lines it could not read. */
export function ImportResult({ outcome }: { outcome: ImportOutcome }) {
  const { head, rest } = importSummary(outcome);
  const skipped = outcome.reply.skippedLines;
  return (
    <div className="ja-im-out">
      <section className="ja-im-ok" role="status">
        <CheckIcon />
        <p>
          Imported <b>{head}</b>
          {rest}
        </p>
      </section>
      {skipped.length ? (
        <div className="jg-caution ja-im-skip" role="note">
          <WarnIcon />
          <div>
            <b>{skippedHeading(skipped)}</b>
            <ul>
              {skipped.map((l) => (
                <li key={l.line} title={l.text}>
                  {skippedEntry(l)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
