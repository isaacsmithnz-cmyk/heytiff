"use client";

import type { ReadInvoice, ReadLine } from "@/lib/quotes/invoice-read";

/* AN INVOICE, READ, BEFORE IT GOES IN: what Tiff read off the PDF or the
   photo, a line a row — the supplier's code, the words, how many, what one
   cost before GST — each beside what it does to the book: a new item, the
   price it replaces, or the newer price the book keeps. What wasn't taken
   says why. One press adds the lot; nothing is saved before it. */

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const dollars = (cents: number) => money.format(cents / 100);
const dateOf = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

/** What adding the line does to the price a quote takes. */
function bookWords(l: ReadLine): string {
  if (l.now === null) return "New";
  if (l.after !== l.now) return `Was ${dollars(l.now)}`;
  return l.cents === l.now ? "Same price" : `Keeps ${dollars(l.now)}, a newer price`;
}

export function InvoiceReview({
  read,
  fileName,
  supplierName,
  otherSupplier,
  busy,
  onCancel,
  onAdd,
}: {
  read: ReadInvoice;
  fileName: string;
  supplierName: string;
  /** another of the business's suppliers the invoice names */
  otherSupplier: string | null;
  busy: boolean;
  onCancel: () => void;
  onAdd: () => void;
}) {
  const what = read.invoiceNo ? `Invoice ${read.invoiceNo}` : fileName;
  const head = `${what}${read.supplier ? ` from ${read.supplier}` : ""}${read.invoiceDate ? `, ${dateOf(read.invoiceDate)}` : ""}`;
  const n = read.lines.length;
  return (
    <div className="qs-match pbi-review">
      <h3 className="qs-h">{head}</h3>
      {otherSupplier && <p className="qs-sub qs-state warn">{`This invoice names ${otherSupplier}, not ${supplierName}.`}</p>}
      {n === 0 ? (
        <p className="qs-sub">No prices on it to add.</p>
      ) : (
        <div className="pbi-wrap">
          <table className="pbi">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Item</th>
                <th scope="col" className="pbi-num">
                  Qty
                </th>
                <th scope="col" className="pbi-num">
                  Each, before GST
                </th>
                <th scope="col">In the book</th>
              </tr>
            </thead>
            <tbody>
              {read.lines.map((l) => (
                <tr key={l.code}>
                  <td className="pbi-code">{l.code}</td>
                  <td>{l.name}</td>
                  <td className="pbi-num">{l.qty.toLocaleString("en-AU")}</td>
                  <td className="pbi-num">{dollars(l.cents)}</td>
                  <td>{bookWords(l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {read.skipped.length > 0 && <p className="qs-sub">{`Not taken: ${read.skipped.map((s) => `${s.name}, ${s.why}`).join("; ")}.`}</p>}
      <div className="wb2-jqacts">
        <button type="button" className="pbtn ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {n > 0 && (
          <button type="button" className="pbtn primary" disabled={busy} onClick={onAdd}>
            {busy ? "Adding" : `Add ${n} price${n === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </div>
  );
}
