/**
 * Read a dropped spreadsheet into the same text the import box accepts.
 *
 * Runs entirely in the browser — the file never leaves the machine, and
 * there is no upload endpoint to secure.
 *
 * .xlsx is a ZIP of XML, and browsers can inflate ZIP entries natively,
 * so it is read here rather than by pulling in a parser. The two obvious
 * libraries were both a bad trade: SheetJS on npm carries high-severity
 * advisories with no fix, and ExcelJS costs 97 packages and 36MB for one
 * feature on one screen.
 */

export type SheetResult = {
  /** CSV text, ready to drop straight into the import box. */
  text: string;
  rows: number;
  /** Set when the file was read but something looked off. */
  warning?: string;
};

const XLSX_EXT = /\.xlsx$/i;
const LEGACY_XLS = /\.xls$/i;
const TEXT_EXT = /\.(csv|tsv|txt)$/i;

export async function readSpreadsheet(file: File): Promise<SheetResult> {
  if (LEGACY_XLS.test(file.name)) {
    throw new Error(
      "Old .xls files are not supported. In Excel choose File → Save As and pick " +
        "either .xlsx or CSV, then try again.",
    );
  }

  if (XLSX_EXT.test(file.name)) return readXlsx(file);

  if (TEXT_EXT.test(file.name) || file.type.startsWith("text/")) {
    const text = await file.text();
    return { text: text.trim(), rows: countRows(text) };
  }

  throw new Error(`Cannot read ${file.name}. Use a .csv, .tsv or .xlsx file.`);
}

function countRows(text: string): number {
  return text.split(/\r?\n/).filter((l) => l.trim()).length;
}

/* ------------------------------------------------------------------ *
 * .xlsx
 * ------------------------------------------------------------------ */

async function readXlsx(file: File): Promise<SheetResult> {
  const buffer = await file.arrayBuffer();

  let entries: Map<string, Uint8Array>;
  try {
    entries = await unzip(buffer);
  } catch {
    throw new Error(
      `${file.name} could not be opened. If it came from another program, ` +
        "re-save it as CSV and try again.",
    );
  }

  const sheetName = firstWorksheet(entries);
  if (!sheetName) {
    throw new Error(`No worksheet found in ${file.name}. Try saving it as CSV instead.`);
  }

  const shared = readSharedStrings(entries);
  const grid = readSheet(decode(entries.get(sheetName)!), shared);

  if (!grid.length) {
    return { text: "", rows: 0, warning: "That sheet looked empty." };
  }

  const text = grid.map((row) => row.map(csvCell).join(",")).join("\n");
  const warning =
    grid.length > 1 && grid.every((r) => r.length < 2)
      ? "Only one column was found — check the team names are in the second column."
      : undefined;

  return { text, rows: grid.length, warning };
}

/** Quote only when a value would otherwise break the row. */
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function firstWorksheet(entries: Map<string, Uint8Array>): string | null {
  const sheets = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort();
  return sheets[0] ?? null;
}

function readSharedStrings(entries: Map<string, Uint8Array>): string[] {
  const raw = entries.get("xl/sharedStrings.xml");
  if (!raw) return [];

  const doc = parseXml(decode(raw));
  return [...doc.getElementsByTagName("si")].map((si) =>
    // A string can be split into runs; the text is the runs joined.
    [...si.getElementsByTagName("t")].map((t) => t.textContent ?? "").join(""),
  );
}

function readSheet(xml: string, shared: string[]): string[][] {
  const doc = parseXml(xml);
  const rows: string[][] = [];

  for (const row of [...doc.getElementsByTagName("row")]) {
    const cells: string[] = [];

    for (const cell of [...row.getElementsByTagName("c")]) {
      // Cells are omitted when empty, so place each one by its column.
      const index = columnIndex(cell.getAttribute("r") ?? "");
      const type = cell.getAttribute("t");

      let value = "";
      if (type === "s") {
        const i = Number(cell.getElementsByTagName("v")[0]?.textContent ?? -1);
        value = shared[i] ?? "";
      } else if (type === "inlineStr") {
        value = [...cell.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("");
      } else {
        value = cell.getElementsByTagName("v")[0]?.textContent ?? "";
      }

      while (cells.length < index) cells.push("");
      cells[index] = value.trim();
    }

    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    if (cells.length) rows.push(cells);
  }

  return rows;
}

/** "B7" -> 1. Letters are base-26, digits are the row and irrelevant here. */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return Math.max(0, n - 1);
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("The sheet could not be read.");
  }
  return doc;
}

/* ------------------------------------------------------------------ *
 * Minimal ZIP reader
 *
 * Only what an .xlsx needs: walk the central directory, then inflate the
 * entries we care about. Stored and deflated members are both handled.
 * ------------------------------------------------------------------ */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;

async function unzip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error("Not a zip file.");

  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);

  const wanted = /^xl\/(worksheets\/sheet\d+\.xml|sharedStrings\.xml)$/i;
  const out = new Map<string, Uint8Array>();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(pointer, true) !== CENTRAL_SIG) break;

    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));

    if (wanted.test(name)) {
      // The local header repeats the name and extra fields at its own
      // lengths, which need not match the central directory's.
      const localName = view.getUint16(localOffset + 26, true);
      const localExtra = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localName + localExtra;
      const raw = bytes.subarray(start, start + compressedSize);

      out.set(name, method === 0 ? raw : await inflate(raw));
    }

    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return out;
}

/** The end-of-central-directory record sits in the last 64KB or so. */
function findEocd(view: DataView): number {
  const limit = Math.max(0, view.byteLength - 0xffff - 22);
  for (let i = view.byteLength - 22; i >= limit; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

async function inflate(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([raw as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
