import { inflateRawSync } from "zlib";

/* A SPREADSHEET, READ WITHOUT A LIBRARY — just enough of .xlsx for a price
   list: the zip's files (central directory, stored or deflated entries),
   the shared strings, and one sheet's cells as values.

   An .xlsx is a zip of XML. Node inflates deflate itself, so no dependency
   is needed for the one sheet the price book reads (the Mitsubishi invoice
   workbook, 2026-09-30). Formulas are read as the value Excel last saved
   with them. Server only. */

function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  /* the end-of-central-directory record, searched from the end */
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip directory");
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compressed);
    if (method === 0) files.set(name, Buffer.from(data));
    else if (method === 8) files.set(name, inflateRawSync(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");

/** A cell's value: text, a number, or null when empty. */
export type Cell = string | number | null;

/** The named sheet's rows, each a map of column letter to value. */
export function readSheet(bytes: Buffer, sheetName: string): Map<string, Cell>[] {
  const files = unzip(bytes);
  const text = (name: string) => files.get(name)?.toString("utf8") ?? "";

  const shared: string[] = [];
  for (const si of text("xl/sharedStrings.xml").match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    shared.push(decode([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
  }

  /* the sheet's file: workbook name → relationship id → target */
  const wb = text("xl/workbook.xml");
  const sheetTag = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((t) => decode(/name="([^"]*)"/.exec(t)?.[1] ?? "") === sheetName);
  if (!sheetTag) throw new Error(`no sheet "${sheetName}"`);
  const rid = /r:id="([^"]*)"/.exec(sheetTag)?.[1];
  const rels = text("xl/_rels/workbook.xml.rels");
  const target = [...rels.matchAll(/<Relationship\b[^>]*>/g)]
    .map((m) => m[0])
    .find((t) => /Id="([^"]*)"/.exec(t)?.[1] === rid);
  const path = target ? /Target="([^"]*)"/.exec(target)?.[1] : undefined;
  if (!path) throw new Error("sheet file not found");
  const sheet = text(path.startsWith("/") ? path.slice(1) : `xl/${path}`);

  const rows: Map<string, Cell>[] = [];
  for (const row of sheet.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
    const cells = new Map<string, Cell>();
    for (const c of row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = /r="([A-Z]+)\d+"/.exec(c)?.[1];
      if (!ref) continue;
      const type = /t="([^"]*)"/.exec(c)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1];
      if (type === "s" && v != null) cells.set(ref, shared[Number(v)] ?? null);
      else if (type === "inlineStr") cells.set(ref, decode([...c.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
      else if (type === "str" || type === "e") cells.set(ref, v != null ? decode(v) : null);
      else if (v != null && v !== "") cells.set(ref, Number(v));
      else cells.set(ref, null);
    }
    rows.push(cells);
  }
  return rows;
}

/** An Excel date serial (days since 1899-12-30) as YYYY-MM-DD. */
export function excelDate(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}
