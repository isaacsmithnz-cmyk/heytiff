import Link from "next/link";
import { buttonClass, LinkButton } from "@/components/parts/button";
import { Dot, StateWord } from "@/components/parts/state";
import { Empty } from "@/components/parts/states";
import { Fade } from "@/components/parts/fade";
import { formatAbn } from "@/lib/fleet/receipt";
import { fyIsCurrent, fyLabel } from "@/lib/tax/fy";
import { TAX_CATEGORY_LABEL, type TaxItem, type TaxYear } from "@/lib/tax/item";
import "./tax-view.css";

/* REPORTS › TAX AND EOFY (v2, 25 October 2026; it was Admin, Tax & EOFY,
   Isaac: "Tax and EOFY as a view in Reports"). One financial year,
   everything spent out in the field in it, and the paper behind it.

   THE VIEW'S ONE JOB is to answer a question somebody is asked once a year
   and cannot answer from memory: "can you produce the receipt for that?" So
   a line with no receipt says so on the line, in the colour of needing a
   look, and the top line counts how many have theirs.

   NOTHING HERE IS EDITABLE, on purpose. Every row belongs to a fuel log or an
   expense claim with its own rules about who may change it; a second place to
   correct a figure is a second place for the two to disagree. This reports.

   The year is the address's (`?view=tax&fy=`), so a year can be sent to an
   accountant as a link and Back does the obvious thing, and the export is a
   plain link to the file. */

/* ONE FORMATTER, cents everywhere: this is the one view in the app whose
   reader is an accountant reconciling a column, and the figure above a
   column has to be the sum of it, to the cent. (There were two once, and
   "Total spend $565" sat above $152.35 + $412.90.) */
const money = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "4 Aug 2025": a date on a receipt, read the Australian way. */
function auDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export type TaxState = {
  year: TaxYear;
  /** the financial years offered, current first */
  choices: number[];
  /** the AU calendar day, which decides whether the year is still running */
  today: string;
};

/** Where a year lives: the Reports view, the period kept if it was chosen. */
export const taxHref = (fy: number, period?: string | null) =>
  `/dashboard/analytics?view=tax&fy=${fy}${period ? `&period=${period}` : ""}`;

/** The CSV of a year: a route handler, so the browser downloads it. */
export const taxExportHref = (fy: number) => `/dashboard/admin/tax/export?fy=${fy}`;

/** The head's grey line on this view: what it holds, and over which days. */
export function taxFacts({ year, today }: TaxState): string {
  const from = `1 July ${year.fy - 1}`;
  return fyIsCurrent(year.fy, today)
    ? `Fuel and expense claims from ${from} to today, the year still running.`
    : `Fuel and expense claims from ${from} to 30 June ${year.fy}.`;
}

/** Something on it needs a look: a line without its receipt. */
export const taxWaiting = ({ year }: TaxState) => year.totals.count > year.totals.withReceipt;

/** One of a few (rule 30), as links: the year is the address's. */
export function FyPicker({ tax, period }: { tax: TaxState; period?: string | null }) {
  return (
    <nav className="pt-tray st2-rp-period" aria-label="Financial year">
      {tax.choices.map((y) => (
        <Link key={y} className="pt-tray-opt" href={taxHref(y, period)} scroll={false} aria-current={y === tax.year.fy ? "true" : undefined}>
          {fyLabel(y)}
        </Link>
      ))}
    </nav>
  );
}

export function TaxView({ tax }: { tax: TaxState }) {
  const { items, totals, fy } = tax.year;
  const missing = totals.count - totals.withReceipt;

  return (
    <div className="st2-rp-face">
      <section className="st2-rp-figs" aria-label="The year">
        <div className="st2-rp-fig">
          <span className="st2-rp-label">Total spend</span>
          <span className="st2-rp-value" data-fig="total">
            {money.format(totals.amount)}
          </span>
          <span className="st2-rp-note">{`${totals.count.toLocaleString("en-AU")} ${totals.count === 1 ? "item" : "items"}`}</span>
        </div>
        <div className="st2-rp-fig">
          <span className="st2-rp-label">GST recorded</span>
          <span className="st2-rp-value" data-fig="gst">
            {money.format(totals.gst)}
          </span>
          {/* GST is never derived: a receipt that showed none adds none */}
          <span className="st2-rp-note">Only where a receipt showed it</span>
        </div>
        <div className="st2-rp-fig">
          <span className="st2-rp-label">Receipts held</span>
          <span className="st2-rp-value">{`${totals.withReceipt.toLocaleString("en-AU")} of ${totals.count.toLocaleString("en-AU")}`}</span>
          {missing > 0 ? (
            <span className="st2-rp-note st2-rp-note--look">{`${missing.toLocaleString("en-AU")} without a receipt`}</span>
          ) : (
            <span className={totals.count > 0 ? "st2-rp-note st2-rp-note--good" : "st2-rp-note"}>
              {totals.count > 0 ? "Every item has its receipt" : "Nothing to hold yet"}
            </span>
          )}
        </div>
      </section>

      {totals.provisionalAmount > 0 && (
        <p className="st2-rp-todo">
          <Dot hue="orange" />
          <span>
            {`${money.format(totals.provisionalAmount)} of this is expense claims nobody has approved yet: the money is spent, the business hasn’t accepted it.`}
          </span>
        </p>
      )}

      {totals.byCategory.length > 0 && (
        <section className="st2-rp-sec" aria-labelledby="st2-tx-h-cat">
          <h2 className="st2-rp-h" id="st2-tx-h-cat">
            By category
          </h2>
          <table className="st2-rp-table st2-tx-cats" aria-labelledby="st2-tx-h-cat">
            <thead>
              <tr>
                <th>Category</th>
                <th className="st2-rp-num">Items</th>
                <th className="st2-rp-num">GST</th>
                <th className="st2-rp-num">Spent</th>
              </tr>
            </thead>
            <tbody>
              {totals.byCategory.map((c) => (
                <tr key={c.category}>
                  <td className="st2-rp-strong">{TAX_CATEGORY_LABEL[c.category]}</td>
                  <td className="st2-rp-num">{c.count.toLocaleString("en-AU")}</td>
                  <td className={c.gst > 0 ? "st2-rp-num" : "st2-rp-num st2-rp-quiet"} data-col="gst">
                    {c.gst > 0 ? money.format(c.gst) : "None recorded"}
                  </td>
                  <td className="st2-rp-num st2-rp-strong" data-col="amount">
                    {money.format(c.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="st2-rp-sec" aria-labelledby="st2-tx-h-items">
        <div className="st2-tx-head">
          <h2 className="st2-rp-h" id="st2-tx-h-items">
            Every item
          </h2>
          {items.length > 0 && (
            /* A plain anchor, not a Link: the answer is a file, and the client
               router would try to draw it as a page. */
            <a className={buttonClass("second", 32)} href={taxExportHref(fy)} download>
              <span className="pt-btn__word">Export CSV</span>
            </a>
          )}
        </div>
        {items.length === 0 ? (
          <Empty what={`Nothing recorded in ${fyLabel(fy)}`} action={null} />
        ) : (
          <table className="st2-rp-table st2-tx-items" aria-labelledby="st2-tx-h-items">
            <thead>
              <tr>
                <th className="st2-tx-day">Date</th>
                <th>Spent at</th>
                <th className="st2-rp-num st2-tx-fig">Amount</th>
                <th className="st2-rp-num st2-tx-fig">GST</th>
                <th className="st2-tx-paper">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function ItemRow({ item }: { item: TaxItem }) {
  /* The grey line is whatever tells THIS row from the one above it: what it
     was, which van the fuel went into or who spent the money, and the ABN. */
  const line = [item.supplier ? item.description : null, item.vehicle, item.staffName, item.abn ? `ABN ${formatAbn(item.abn)}` : null]
    .filter(Boolean)
    .join(", ");
  return (
    <tr>
      <td className="st2-tx-day">{auDate(item.date)}</td>
      <td className="st2-tx-what">
        <Fade className="st2-rp-strong">{item.supplier || item.description}</Fade>
        {line && <Fade className="st2-tx-line">{line}</Fade>}
        {item.provisional && <StateWord tone="look">Awaiting approval</StateWord>}
      </td>
      <td className="st2-rp-num st2-rp-strong" data-col="amount">
        {money.format(item.amount)}
      </td>
      <td className={item.gst === null ? "st2-rp-num st2-rp-quiet" : "st2-rp-num"}>
        {item.gst === null ? "No GST shown" : money.format(item.gst)}
      </td>
      {/* The receipt is the point of the row, so its absence is said, never
          left as an empty cell. */}
      <td className="st2-tx-paper">
        {item.hasReceipt && item.receiptUrl ? (
          <LinkButton href={item.receiptUrl} target="_blank" rel="noreferrer">
            View receipt
          </LinkButton>
        ) : item.hasReceipt ? (
          <StateWord tone="info">Receipt held</StateWord>
        ) : (
          <StateWord tone="look">No receipt</StateWord>
        )}
      </td>
    </tr>
  );
}
