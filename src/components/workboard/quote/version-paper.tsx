"use client";

import { fmtAud } from "@/lib/workboard/project-money";
import { fmtAuWeekdayDate } from "@/lib/au-dates";
import type { QuoteVersion } from "@/lib/quotes/quote-versions";

/* A PAST VERSION OF THE QUOTE, AS IT STOOD (quote-versions.ts): each
   option's lines and totals when it was approved, and what changed after
   it. Kept, never changed; read only. */

export function VersionPaper({ version, jobNumber, client }: { version: QuoteVersion; jobNumber: string | null; client: string | null }) {
  const approved = version.approvedAt ? fmtAuWeekdayDate(version.approvedAt.slice(0, 10)) : "";
  return (
    <article className="lp-paper" aria-label={`Version ${version.n}`}>
      <header className="lp-lh">
        <div>{client && <b className="lp-vto">{client}</b>}</div>
        <div className="lp-lh-r">
          <b>{`Version ${version.n}`}</b>
          {jobNumber && <span>{`Quote ${jobNumber}`}</span>}
          {approved && <span>{`Approved ${approved}`}</span>}
        </div>
      </header>
      {version.what && (
        <section className="lp-sec">
          <h3 className="lp-ph">{`What changed for version ${version.n + 1}`}</h3>
          <p className="lp-osum">{version.what}</p>
        </section>
      )}
      {version.options.map((o, i) => (
        <section className="lp-sec" key={i}>
          <h3 className="lp-ph">{o.name || `Option ${i + 1}`}</h3>
          <table className="lp-vt">
            <tbody>
              {o.lines.map((l, k) => (
                <tr key={k}>
                  <td>{l.name}</td>
                  <td className="n">{`${l.qty}${l.unit ? ` ${l.unit}` : ""}`}</td>
                  <td className="n">{l.totalCents == null ? "To price" : fmtAud(l.totalCents)}</td>
                </tr>
              ))}
              <tr className="tot">
                <td>Total ex GST</td>
                <td />
                <td className="n">{fmtAud(o.exGstCents)}</td>
              </tr>
              <tr>
                <td>GST</td>
                <td />
                <td className="n">{fmtAud(o.incGstCents - o.exGstCents)}</td>
              </tr>
              <tr className="tot">
                <td>Total inc GST</td>
                <td />
                <td className="n">{fmtAud(o.incGstCents)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      ))}
    </article>
  );
}
