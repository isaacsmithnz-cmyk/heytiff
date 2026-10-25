"use client";

import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";
import type { ReadInvoice, ReadLine } from "@/lib/quotes/invoice-read";
import { dollars } from "./pb-bits";

/* AN INVOICE, READ, BEFORE IT GOES IN: what Tiff read off the PDF or the
   photo, a line a row — the supplier's code, the words, how many, what one
   cost before GST — each beside what it does to the book: a new item, the
   price it replaces, or the newer price the book keeps. What wasn't taken
   says why. One press adds the lot; nothing is saved before it. It stands
   in the supplier's own dialog. */

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
  adding,
  onCancel,
  onAdd,
}: {
  read: ReadInvoice;
  fileName: string;
  supplierName: string;
  /** another of the business's suppliers the invoice names */
  otherSupplier: string | null;
  /** anything in the dialog under way: the buttons wait */
  busy: boolean;
  /** this invoice's prices going in */
  adding: boolean;
  onCancel: () => void;
  onAdd: () => void;
}) {
  const what = read.invoiceNo ? `Invoice ${read.invoiceNo}` : fileName;
  const head = `${what}${read.supplier ? ` from ${read.supplier}` : ""}${read.invoiceDate ? `, ${dateOf(read.invoiceDate)}` : ""}`;
  const n = read.lines.length;
  return (
    <section aria-label={head}>
      <h3 className="st2-pb-sub">{head}</h3>
      {otherSupplier && <StateWord tone="look">{`This invoice names ${otherSupplier}, not ${supplierName}.`}</StateWord>}
      {n === 0 ? (
        <p className="st2-pb-said">No prices on it to add.</p>
      ) : (
        <div className="st2-pb-ledgerwrap">
          <table className="st2-pb-ledger">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Item</th>
                <th scope="col" className="st2-pb-num">
                  Qty
                </th>
                <th scope="col" className="st2-pb-num">
                  Each, before GST
                </th>
                <th scope="col">In the book</th>
              </tr>
            </thead>
            <tbody>
              {read.lines.map((l) => (
                <tr key={l.code}>
                  <td className="st2-pb-code">{l.code}</td>
                  <td>{l.name}</td>
                  <td className="st2-pb-num">{l.qty.toLocaleString("en-AU")}</td>
                  <td className="st2-pb-num">{dollars(l.cents)}</td>
                  <td>{bookWords(l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {read.skipped.length > 0 && <p className="st2-pb-said">{`Not taken: ${read.skipped.map((s) => `${s.name}, ${s.why}`).join("; ")}.`}</p>}
      <div className="st2-pb-foot">
        <Button kind="second" size={36} disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        {n > 0 && (
          <Button kind="main" size={36} disabled={busy} onClick={onAdd}>
            {adding ? "Adding the prices" : `Add ${n} price${n === 1 ? "" : "s"}`}
          </Button>
        )}
      </div>
    </section>
  );
}
