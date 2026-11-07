"use client";

import { lazy, Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { StateWord } from "@/components/parts/state";
import { Empty } from "@/components/parts/states";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { bookWords, lineCents, money, totalCents, type Purchase } from "@/lib/purchases/purchase";
import type { OpenPurchase, PurchaseListRow } from "@/lib/purchases/purchase-list-server";
import { purchaseLine } from "@/components/purchases/add-purchase";

const AddPurchase = lazy(() => import("@/components/purchases/add-purchase").then((m) => ({ default: m.AddPurchase })));

/* TEAM › PURCHASES (lib/purchases/purchase-list-server says what's on it).
   The list: Date, Supplier, Bought by, Went to, Price book, Before GST. A
   purchase opens here (`?purchase=`), its docket beside its lines; a van's
   service opens the van, a receipt opens Expenses. A purchase with lines
   still to put somewhere says so in orange and offers Put away. */

export type PurchasesData = { rows: PurchaseListRow[]; open: OpenPurchase | null };

const href = (id: string) => `/dashboard/team?view=purchases&purchase=${id}`;
const tone = (t: "or" | "gr") => (t === "or" ? "look" : "good");

function Book({ book }: { book: { text: string; tone: "or" | "gr" | "q" } }) {
  return book.tone === "q" ? <span className="pu-cell-q">{book.text}</span> : <StateWord tone={tone(book.tone)}>{book.text}</StateWord>;
}

function List({ rows }: { rows: PurchaseListRow[] }) {
  return (
    <table className="pu-table">
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Supplier</th>
          <th scope="col">Bought by</th>
          <th scope="col">Went to</th>
          <th scope="col">Price book</th>
          <th scope="col" className="pu-num">
            Before GST
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const to = r.purchaseId ? href(r.purchaseId) : r.href;
          return (
            <tr key={r.key}>
              <td className="pu-date">{fmtAuWeekdayDayMonth(r.date)}</td>
              <td>
                <Fade className="pu-two">
                  {to ? (
                    <Link className="pu-open" href={to}>
                      {r.supplier}
                    </Link>
                  ) : (
                    <b>{r.supplier}</b>
                  )}
                </Fade>
                <span className="pu-cell-q">{r.ref}</span>
              </td>
              <td>{r.boughtBy ?? ""}</td>
              <td>
                <Fade className="pu-two">{r.wentTo}</Fade>
                {r.wentNote && (r.open ? <StateWord tone="look">{r.wentNote}</StateWord> : <span className="pu-cell-q">{r.wentNote}</span>)}
              </td>
              <td>
                <Book book={r.book} />
              </td>
              <td className="pu-num">
                {r.cents == null ? "" : money(r.cents)}
                {r.withGst && <span className="pu-cell-q">with GST</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Opened({ open, onPutAway }: { open: OpenPurchase; onPutAway: (p: Purchase) => void }) {
  const p = open.purchase;
  const left = p.lines.some((l) => l.wentTo === "open");
  return (
    <div className="pu-opened">
      <div className="pu-opened-head">
        <div>
          <h2 className="pu-title">{[p.supplierName || "A supplier", p.invoiceNo ? `invoice ${p.invoiceNo}` : null].filter(Boolean).join(", ")}</h2>
          <p className="pu-quiet">
            {purchaseLine(p)} {money(totalCents(p.lines))} before GST.
          </p>
        </div>
        <div className="pu-opened-acts">
          <Button href="/dashboard/team?view=purchases">Back to purchases</Button>
          {open.docket && (
            <Button href={open.docket.url} target="_blank" rel="noopener noreferrer">
              Open the docket
            </Button>
          )}
          {left && (
            <Button kind="main" onClick={() => onPutAway(p)}>
              Put away
            </Button>
          )}
        </div>
      </div>
      <div className={open.docket?.image ? "pu-split" : undefined}>
        {open.docket?.image && (
          // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL the image optimiser can't fetch
          <img className="pu-docket" src={open.docket.url} alt={`The docket from ${p.supplierName || "the supplier"}`} />
        )}
        <table className="pu-table">
          <thead>
            <tr>
              <th scope="col">Line</th>
              <th scope="col" className="pu-num">
                Qty
              </th>
              <th scope="col" className="pu-num">
                Price
              </th>
              <th scope="col">Went to</th>
              <th scope="col">Price book</th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l) => {
              const total = lineCents(l);
              return (
                <tr key={l.id}>
                  <td>
                    <Fade className="pu-two">
                      <b>{l.name}</b>
                    </Fade>
                    <span className="pu-cell-q">{l.code || "No code"}</span>
                  </td>
                  <td className="pu-num">{l.qty}</td>
                  <td className="pu-num">{total == null ? "" : money(total)}</td>
                  <td>{l.wentTo === "job" ? l.jobLabel : l.wentTo === "stock" ? "Stock" : <StateWord tone="look">Not put away</StateWord>}</td>
                  <td>
                    <Book book={bookWords(l)} />
                  </td>
                </tr>
              );
            })}
            <tr className="pu-foot">
              <td>Total before GST</td>
              <td />
              <td className="pu-num">{money(totalCents(p.lines))}</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {p.skipped.length > 0 && <p className="pu-quiet">Left off the lines: {p.skipped.map((s) => `${s.name}, ${s.why}`).join("; ")}.</p>}
    </div>
  );
}

export function TeamPurchases({ data, adding, onAdded }: { data: PurchasesData; adding: boolean; onAdded: () => void }) {
  const router = useRouter();
  /* the opened one only while the address still names it: a view tab
     switched away and back drops `?purchase=` without a round trip */
  const named = useSearchParams()?.get("purchase") ?? null;
  const open = data.open && data.open.purchase.id === named ? data.open : null;
  const [putting, setPutting] = useState<Purchase | null>(null);
  const done = () => {
    setPutting(null);
    onAdded();
    router.refresh();
  };
  return (
    <>
      {open ? (
        <Opened open={open} onPutAway={setPutting} />
      ) : data.rows.length ? (
        <List rows={data.rows} />
      ) : (
        <Empty what="No purchases yet" line="A supplier's docket, a van's service and a receipt all land here once they're scanned." action={null} />
      )}
      {(adding || putting) && (
        <Suspense fallback={null}>
          <AddPurchase resume={putting ?? undefined} onClose={done} />
        </Suspense>
      )}
    </>
  );
}
