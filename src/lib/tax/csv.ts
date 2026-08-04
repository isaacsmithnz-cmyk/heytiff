import { formatAbn } from "@/lib/fleet/receipt";
import { fyLabel } from "./fy";
import { TAX_CATEGORY_LABEL, type TaxItem } from "./item";

/* The export an accountant actually opens.

   CSV, because it is the one format every accounting package and every
   spreadsheet takes without being asked twice, and because the person
   receiving it is as likely to want to sort it as to import it.

   TWO ESCAPING PROBLEMS, both handled here rather than hoped about:

   1. RFC 4180 quoting — a supplier called "Smith, Jones & Co" must not become
      two columns. Anything with a comma, a quote or a newline gets wrapped and
      its quotes doubled.

   2. FORMULA INJECTION — a cell beginning =, +, - or @ is executed as a
      formula by Excel, Sheets and LibreOffice alike. That is a live risk here
      and not a theoretical one: several of these fields are text that Claude
      read off a photograph, so their contents are not under anyone's control.
      A leading apostrophe makes the cell text, which is what it always was.

   The numbers are written unformatted — no dollar signs, no thousands
   separators — because they are going into arithmetic at the other end. */

const COLUMNS = [
  "Date",
  "Financial year",
  "Source",
  "Category",
  "Description",
  "Supplier",
  "ABN",
  "Amount (incl GST)",
  "GST",
  "Amount (ex GST)",
  "Staff",
  "Vehicle",
  "Receipt held",
  "Status",
] as const;

/** One cell, safe in every spreadsheet that will open this. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  if (raw === "") return "";
  // neutralise a formula BEFORE quoting — the apostrophe has to be inside
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function money(n: number | null): string {
  return n === null ? "" : n.toFixed(2);
}

/** The ex-GST figure, only where a GST amount was actually recorded. A blank
    means "no GST line on the receipt", which is not the same as zero GST and
    must not be reported as though the whole amount were ex-GST. */
function exGst(item: TaxItem): string {
  return item.gst === null ? "" : (Math.round((item.amount - item.gst) * 100) / 100).toFixed(2);
}

function statusOf(item: TaxItem): string {
  if (item.source === "fuel") return "Recorded";
  return item.provisional ? "Awaiting approval" : "Approved";
}

/** The whole year as one CSV document, header row included. */
export function taxCsv(items: TaxItem[], fy: number): string {
  const label = fyLabel(fy);
  const lines = [COLUMNS.map(csvCell).join(",")];
  for (const i of items) {
    lines.push(
      [
        csvCell(i.date),
        csvCell(label),
        csvCell(i.source === "fuel" ? "Fuel log" : "Expense claim"),
        csvCell(TAX_CATEGORY_LABEL[i.category]),
        csvCell(i.description),
        csvCell(i.supplier),
        csvCell(formatAbn(i.abn)),
        csvCell(money(i.amount)),
        csvCell(money(i.gst)),
        csvCell(exGst(i)),
        csvCell(i.staffName),
        csvCell(i.vehicle),
        csvCell(i.hasReceipt ? "Yes" : "No"),
        csvCell(statusOf(i)),
      ].join(","),
    );
  }
  // CRLF: what RFC 4180 specifies, and what stops Excel on Windows treating
  // the whole file as one row.
  return `${lines.join("\r\n")}\r\n`;
}

/** "heytiff-tax-2025-26.csv" — sorts by year in a downloads folder. */
export function taxCsvFilename(fy: number): string {
  return `heytiff-tax-${fy - 1}-${String(fy).slice(2)}.csv`;
}
