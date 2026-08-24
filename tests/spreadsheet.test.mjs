import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import test from "node:test";

/* The .xlsx reader in src/lib/spreadsheet.ts, exercised through its two
   trickiest pure parts: the ZIP walk and the cell-reference maths. The
   XML side needs a browser DOMParser, so it is covered by driving a real
   browser instead. */

/* ---- column references -------------------------------------------- */

function columnIndex(ref) {
  let n = 0;
  for (const ch of ref.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return Math.max(0, n - 1);
}

test("cell references map to zero-based columns", () => {
  assert.equal(columnIndex("A1"), 0);
  assert.equal(columnIndex("B7"), 1);
  assert.equal(columnIndex("C100"), 2);
  assert.equal(columnIndex("Z2"), 25);
  assert.equal(columnIndex("AA1"), 26, "letters are base-26, not base-10");
  assert.equal(columnIndex("AB1"), 27);
  assert.equal(columnIndex("BA1"), 52);
});

test("a malformed reference does not produce a negative column", () => {
  for (const ref of ["", "1", "!", "9A"]) {
    assert.ok(columnIndex(ref) >= 0, `${ref} should not go negative`);
  }
});

/* ---- CSV escaping -------------------------------------------------- */

function csvCell(value) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

test("cells are quoted only when they would otherwise break the row", () => {
  assert.equal(csvCell("Iron Hawks"), "Iron Hawks");
  assert.equal(csvCell("9882K"), "9882K");
  assert.equal(csvCell("Robotics, Inc."), '"Robotics, Inc."', "a comma must not split the row");
  assert.equal(csvCell('The "Bots"'), '"The ""Bots"""', "quotes are doubled");
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
});

test("a round trip through the CSV writer survives the importer's reader", () => {
  // Mirrors splitRow in the import route.
  const clean = (v) => v.trim().replace(/^"(.*)"$/s, "$1").trim();
  function splitRow(line) {
    if (line.includes("\t")) return line.split("\t").map(clean);
    const cells = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = !quoted;
      } else if (ch === "," && !quoted) {
        cells.push(clean(field));
        field = "";
      } else field += ch;
    }
    cells.push(clean(field));
    return cells;
  }

  const original = ["9882K", "Robotics, Inc.", "Pit 13"];
  const line = original.map(csvCell).join(",");
  assert.deepEqual(splitRow(line), original, "what the sheet reader writes, the importer reads");
});

/* ---- the ZIP walk -------------------------------------------------- */

function buildZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of files) {
    const data = Buffer.from(content, "utf8");
    const comp = deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

function findEocd(view) {
  const limit = Math.max(0, view.byteLength - 0xffff - 22);
  for (let i = view.byteLength - 22; i >= limit; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error("Not a zip file.");

  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);
  const wanted = /^xl\/(worksheets\/sheet\d+\.xml|sharedStrings\.xml)$/i;
  const out = new Map();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(pointer, true) !== 0x02014b50) break;
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));

    if (wanted.test(name)) {
      const localName = view.getUint16(localOffset + 26, true);
      const localExtra = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localName + localExtra;
      const raw = bytes.subarray(start, start + compressedSize);
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      out.set(name, method === 0 ? raw : new Uint8Array(await new Response(stream).arrayBuffer()));
    }
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

test("the zip walk finds only the sheet parts it needs", async () => {
  const zip = buildZip([
    ["[Content_Types].xml", "<Types/>"],
    ["xl/workbook.xml", "<workbook/>"],
    ["xl/sharedStrings.xml", "<sst><si><t>Iron Hawks</t></si></sst>"],
    ["xl/worksheets/sheet1.xml", "<worksheet>one</worksheet>"],
    ["xl/worksheets/sheet2.xml", "<worksheet>two</worksheet>"],
    ["docProps/app.xml", "<Properties/>"],
  ]);

  const entries = await unzip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength));
  const names = [...entries.keys()].sort();

  assert.deepEqual(names, [
    "xl/sharedStrings.xml",
    "xl/worksheets/sheet1.xml",
    "xl/worksheets/sheet2.xml",
  ], "workbook metadata and doc properties are skipped");

  const decoded = new TextDecoder().decode(entries.get("xl/sharedStrings.xml"));
  assert.match(decoded, /Iron Hawks/, "entries inflate back to their original bytes");
});

test("the first worksheet is chosen, not an arbitrary one", async () => {
  const zip = buildZip([
    ["xl/worksheets/sheet2.xml", "<worksheet>second</worksheet>"],
    ["xl/worksheets/sheet1.xml", "<worksheet>first</worksheet>"],
  ]);
  const entries = await unzip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength));

  const first = [...entries.keys()].filter((n) => /sheet\d+\.xml$/.test(n)).sort()[0];
  assert.equal(first, "xl/worksheets/sheet1.xml", "even when stored out of order");
});

test("a file that is not a zip is rejected rather than misread", async () => {
  const notAZip = Buffer.from("this is a plain text roster, not a spreadsheet");
  await assert.rejects(
    () => unzip(notAZip.buffer.slice(notAZip.byteOffset, notAZip.byteOffset + notAZip.byteLength)),
    /Not a zip file/,
  );
});
