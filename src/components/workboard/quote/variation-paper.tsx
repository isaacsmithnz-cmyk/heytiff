"use client";

import { fmtAud } from "@/lib/workboard/project-money";
import { fmtAuWeekdayDate } from "@/lib/au-dates";

/* A VARIATION, AS THE CLIENT GETS IT (Isaac, 2026-10-10, the round-2 mock):
   what changes, the accepted price, the variation's, the new total, and
   their approval. The accepted quote is never changed; this is the
   difference, approved on its own. */

export type VariationChanges = { added: string[]; changed: string[]; removed: string[] };

const signed = (c: number) => `${c > 0 ? "+" : c < 0 ? "−" : ""}${fmtAud(Math.abs(c))}`;

export function VariationPaper({
  n,
  what,
  startedAt,
  jobNumber,
  client,
  acceptedExCents,
  newExCents,
  newIncCents,
  changes,
}: {
  n: number;
  what: string;
  startedAt: string;
  jobNumber: string | null;
  client: string | null;
  /** the accepted quote, ex GST */
  acceptedExCents: number;
  /** the quote with this variation, ex GST and inc */
  newExCents: number;
  newIncCents: number;
  changes: VariationChanges;
}) {
  const day = startedAt ? fmtAuWeekdayDate(startedAt.slice(0, 10)) : "";
  const list = (label: string, items: string[]) =>
    items.length > 0 && (
      <div className="lp-vchg">
        <b>{label}</b>
        <ul>
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <article className="lp-paper" aria-label={`Variation ${n}`}>
      <header className="lp-lh">
        <div>{client && <b className="lp-vto">{client}</b>}</div>
        <div className="lp-lh-r">
          <b>{`Variation ${n}`}</b>
          {jobNumber && <span>{`To quote ${jobNumber}`}</span>}
          {day && <span>{day}</span>}
        </div>
      </header>
      <section className="lp-sec">
        <h3 className="lp-ph">What changes</h3>
        {what && <p className="lp-osum">{what}</p>}
        {list("Added", changes.added)}
        {list("Changed", changes.changed)}
        {list("Taken off", changes.removed)}
      </section>
      <section className="lp-sec">
        <h3 className="lp-ph">The price</h3>
        <table className="lp-vt">
          <tbody>
            <tr>
              <td>The accepted quote</td>
              <td className="n">{fmtAud(acceptedExCents)}</td>
            </tr>
            <tr className="chg">
              <td>{`Variation ${n}`}</td>
              <td className="n">{signed(newExCents - acceptedExCents)}</td>
            </tr>
            <tr className="tot">
              <td>New total ex GST</td>
              <td className="n">{fmtAud(newExCents)}</td>
            </tr>
            <tr>
              <td>GST</td>
              <td className="n">{fmtAud(newIncCents - newExCents)}</td>
            </tr>
            <tr className="tot">
              <td>New total inc GST</td>
              <td className="n">{fmtAud(newIncCents)}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section className="lp-sec">
        <h3 className="lp-ph">Approve this variation</h3>
        <div className="lp-sign">
          <div>Name</div>
          <div>Signature</div>
          <div>Date</div>
          <div />
        </div>
      </section>
    </article>
  );
}
