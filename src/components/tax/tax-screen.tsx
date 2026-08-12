import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { formatAbn } from "@/lib/fleet/receipt";
import { fyIsCurrent, fyLabel } from "@/lib/tax/fy";
import { TAX_CATEGORY_LABEL, type TaxItem, type TaxYear } from "@/lib/tax/item";

/* Tax & EOFY — one financial year, everything spent in it, and the paper.

   THE SCREEN'S ONE JOB is to answer a question somebody is asked once a year
   and cannot answer from memory: "can you produce the receipt for that?" So
   the number it leads with is not the total — an accountant can add up a
   column — it is how many of these lines have the document behind them. A
   figure with no receipt is not a smaller deduction, it is a deduction that
   may not survive being asked about, and the screen says so on the line.

   NOTHING HERE IS EDITABLE, on purpose. Every row belongs to a fuel log or an
   expense claim with its own rules about who may change it; a second place to
   correct a figure is a second place for the two to disagree. This reports.

   No "use client": the year is a link, the export is a link, and the receipts
   are links. There is nothing to hold in state. */

const money = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});
const moneyCents = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "4 Aug 2025" — a date on a receipt, read the Australian way. */
function auDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

export function TaxScreen({
  year,
  choices,
  today,
}: {
  year: TaxYear;
  /** Financial years the picker offers, current first. */
  choices: number[];
  today: string;
}) {
  const { items, totals, fy } = year;
  const current = fyIsCurrent(fy, today);
  const missing = totals.count - totals.withReceipt;

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg adm-stg">
          <div className="v2head" style={{ marginBottom: 10 }}>
            <div>
              <Link href="/dashboard/admin" className="int-back">
                <Icon name="chevL" size={15} />
                Admin
              </Link>
              <h1 style={{ margin: "10px 0 0" }}>
                Tax &amp; EOFY
              </h1>
            </div>
          </div>
          <p className="int-lede">
            Everything the business spent out in the field, filed by financial year with the
            receipt attached — fuel logged against a vehicle, and expenses staff claimed back.
            The company&rsquo;s own bills stay in your accounting system; this is the spend that
            otherwise turns up at tax time in a glovebox.
          </p>

          {/* The year picker. Links, not tabs — the year is in the URL, so one
              of these can be sent to an accountant as-is. */}
          <div className="tx-years">
            {choices.map((y) => (
              <Link
                key={y}
                href={`/dashboard/admin/tax?fy=${y}`}
                className={`tx-year${y === fy ? " on" : ""}`}
                aria-current={y === fy ? "page" : undefined}
              >
                {fyLabel(y)}
                {fyIsCurrent(y, today) && <em>so far</em>}
              </Link>
            ))}
          </div>

          <div className="tx-sumrow">
            <Stat label="Total spend" value={money.format(totals.amount)} sub={`${totals.count} ${totals.count === 1 ? "item" : "items"}`} />
            <Stat label="GST recorded" value={money.format(totals.gst)} sub="only where a receipt showed one" />
            <Stat
              label="Receipts held"
              value={`${totals.withReceipt} of ${totals.count}`}
              sub={missing === 0 ? "every item substantiated" : `${missing} without a receipt`}
              tone={totals.count > 0 && missing > 0 ? "warn" : "ok"}
            />
          </div>

          {current && (
            <p className="tx-note">
              <Icon name="alert" size={14} />
              This financial year is still running — these figures are what has been recorded so
              far, not a closed set of books.
            </p>
          )}
          {totals.provisionalAmount > 0 && (
            <p className="tx-note">
              <Icon name="alert" size={14} />
              {/* The `{" "}` is load-bearing: a JSX text block that runs over
                  more than one line AND carries an HTML entity loses the space
                  it begins with, so this read "$412.90of this is" in
                  production. Same bug the Xero costs banner shipped with
                  ("more than 6 monthsold") and the same fix. Guarded by
                  lib/format/__tests__/jsx-entity-spacing. */}
              {moneyCents.format(totals.provisionalAmount)}{" "}
              of this is expense claims nobody has approved yet. The money has been spent; the
              business hasn&rsquo;t accepted it.
            </p>
          )}

          {totals.byCategory.length > 0 && (
            <div className="adm-card tx-cats">
              {totals.byCategory.map((c) => (
                <div className="tx-cat" key={c.category}>
                  <span className="tx-catname">{TAX_CATEGORY_LABEL[c.category]}</span>
                  <span className="tx-catcount">{c.count}</span>
                  <span className="tx-catgst">{c.gst > 0 ? `${moneyCents.format(c.gst)} GST` : "no GST recorded"}</span>
                  <span className="tx-catamt">{moneyCents.format(c.amount)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="tx-listhead">
            <h2>Every item</h2>
            {items.length > 0 && (
              /* A plain anchor, not a Link: this response is a file, and the
                 client router would try to render it as a page. */
              <a className="pbtn ghost" href={`/dashboard/admin/tax/export?fy=${fy}`}>
                <Icon name="download" size={15} />
                Export CSV
              </a>
            )}
          </div>

          {items.length === 0 ? (
            <div className="emptybox">
              <span className="ei">
                <Icon name="receipt" size={24} />
              </span>
              <b>Nothing recorded in {fyLabel(fy)}</b>
              <em>
                Fuel logged with a scanned docket and approved expense claims land here
                automatically, with their receipts.
              </em>
            </div>
          ) : (
            <div className="adm-card tx-items">
              {items.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "plain",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "plain" | "ok" | "warn";
}) {
  return (
    <div className={`tx-stat ${tone}`}>
      <span className="tx-statlab">{label}</span>
      <b className="tx-statval">{value}</b>
      <em className="tx-statsub">{sub}</em>
    </div>
  );
}

function ItemRow({ item }: { item: TaxItem }) {
  /* The second line is whatever distinguishes THIS row from the one above it:
     which van the fuel went into, or who spent the money. Both when both are
     known, neither when neither is. */
  const context = [item.vehicle, item.staffName].filter(Boolean).join(" · ");

  return (
    <div className="tx-item">
      <span className={`tx-ic ${item.source}`}>
        <Icon name={item.source === "fuel" ? "fuel" : "receipt"} size={17} />
      </span>
      <span className="tx-main">
        <b>
          {item.supplier || item.description}
          {item.provisional && <span className="tx-flag">awaiting approval</span>}
        </b>
        <em>
          {auDate(item.date)}
          {item.supplier && ` · ${item.description}`}
          {context && ` · ${context}`}
          {item.abn && ` · ABN ${formatAbn(item.abn)}`}
        </em>
      </span>
      <span className="tx-amt">
        <b>{moneyCents.format(item.amount)}</b>
        <em>{item.gst === null ? "no GST shown" : `incl. ${moneyCents.format(item.gst)} GST`}</em>
      </span>
      {/* The receipt is the whole point of the row, so its absence is stated
          rather than left as an empty column. */}
      {item.hasReceipt && item.receiptUrl ? (
        <a className="tx-rcpt" href={item.receiptUrl} target="_blank" rel="noreferrer">
          <Icon name="check" size={13} />
          Receipt
        </a>
      ) : (
        <span className="tx-rcpt none">
          <Icon name="alert" size={13} />
          No receipt
        </span>
      )}
    </div>
  );
}
