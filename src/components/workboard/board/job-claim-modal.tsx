"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/parts/dialog";
import { IconButton, LinkButton } from "@/components/parts/button";
import { Loading } from "@/components/parts/states";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { fmtAud } from "@/lib/workboard/project-money";
import { fmtQuantity, materialsExTotalCents } from "@/lib/workboard/job-ledger";
import { claimTitle, type FamilyClaim } from "@/lib/workboard/job-family";
import { claimLine, type PaymentRow } from "@/lib/workboard/job-billing";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import { readClaim } from "@/app/actions/workboard";
import type { ClaimDetailRead } from "@/lib/workboard/all-jobs-query";

/* ONE CLAIM, OPENED (Isaac, 25 October 2026, the job page's frame 10): the
   v2 dialog, 560 wide. Its title, "Payment 2, Progress"; one grey line saying
   which invoice it is, what share of the job, when it was raised and when
   it's due; the amount ex GST with its state word; then what is on the
   invoice, anything written on it, and its paper. No crumb back to the job
   and no closing line: the job is the page under it.

   WHAT IS IN HERE IS WHAT THE CLAIM KNOWS, and nothing the job owns: the
   description, the visits and the contacts stay on the job.

   Every figure is ex GST, from ServiceM8's own ex-GST price on each line. A
   payment is the one exception, and says so: it is what the customer paid,
   which is the invoice's inc-GST total. */

export function JobClaimModal({
  claim,
  row,
  staged = true,
  onOpenPaper,
  onClose,
}: {
  claim: FamilyClaim;
  /** the claim's row on Billing, so the dialog says its figure and its
      state word exactly as the row does */
  row: PaymentRow | null;
  /** billed in stages: the title is the payment's, else the invoice's */
  staged?: boolean;
  /** opens a file in the job's own viewer; absent, a file opens in a new tab */
  onOpenPaper?: (item: JobMediaItem) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ClaimDetailRead | null>(null);
  const [loading, setLoading] = useState(true);

  /* No setLoading(true) here: the dialog is KEYED BY CLAIM, so a different
     claim is a different component with `loading` already true. */
  useEffect(() => {
    let live = true;
    void readClaim(claim.remoteId)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        setLoading(false);
      })
      .catch(() => {
        /* a claim that won't load must not take the page down with it */
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [claim.remoteId]);

  const materials = detail?.ledger.materials ?? [];
  const payments = detail?.ledger.payments ?? [];
  const notes = detail?.notes ?? [];
  const paper = [...(detail?.media.documents ?? []), ...(detail?.media.photos ?? [])];
  const total = materialsExTotalCents(materials);
  const heading = staged ? claimTitle(claim) : claim.jobNumber ? `Invoice #${claim.jobNumber}` : "Invoice";

  return (
    <Dialog heading={heading} onClose={onClose} width={560}>
      <IconButton glyph="close" label="Close this invoice" size={32} className="jb-x" onClick={onClose} />
      <p className="jb-cl-line">{claimLine(claim, row ?? { percent: claim.percent }, staged)}</p>
      <p className="jb-cl-amt">
        <b>{row?.cents != null ? fmtAud(row.cents) : "—"}</b>
        <span className="jb-basis">{row?.basis === "inc" ? "inc GST" : "ex GST"}</span>
        {row && <span className={`pt-state pt-state--${row.tone}`}>{row.word}</span>}
      </p>

      {loading && !detail ? (
        <Loading what="Reading the invoice" />
      ) : (
        <>
          {materials.length > 0 && (
            <section className="jb-cl-grp">
              <h3>On this invoice</h3>
              <ul className="jb-cl-rows">
                {materials.map((m) => (
                  <li key={m.remoteId}>
                    <span className="jb-cl-t">
                      <b>{m.name}</b>
                      {m.quantity !== null && <em>{`× ${fmtQuantity(m.quantity)}`}</em>}
                    </span>
                    <span className="jb-amt">{m.exLineCents != null ? fmtAud(m.exLineCents) : "—"}</span>
                  </li>
                ))}
                {/* no total when a line has no ex-GST price */}
                {total !== null && (
                  <li className="jb-cl-total">
                    <span className="jb-cl-t">
                      <b>Total ex GST</b>
                    </span>
                    <span className="jb-amt">{fmtAud(total)}</span>
                  </li>
                )}
              </ul>
            </section>
          )}

          {payments.length > 0 && (
            <section className="jb-cl-grp">
              <h3>Paid</h3>
              <ul className="jb-cl-rows">
                {payments.map((p) => (
                  <li key={p.remoteId}>
                    <span className="jb-cl-t">
                      <b>{p.method ?? "Payment"}</b>
                      <em>
                        {[p.isDeposit ? "Deposit" : null, p.takenOn ? fmtAuWeekdayDayMonth(p.takenOn) : null, p.takenBy]
                          .filter(Boolean)
                          .join(", ")}
                      </em>
                    </span>
                    <span className="jb-amt">
                      {p.amountCents !== null ? `${fmtAud(p.amountCents)} inc GST` : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="jb-cl-grp">
            <h3>Written on it</h3>
            {notes.length > 0 ? (
              notes.map((n) => (
                <div className="jb-cl-note" key={n.remoteId}>
                  <p>{n.text}</p>
                  <em>
                    {[n.writtenBy, n.writtenOn ? fmtAuWeekdayDayMonth(n.writtenOn) : null].filter(Boolean).join(", ")}
                  </em>
                </div>
              ))
            ) : (
              /* ServiceM8's own note about raising a claim is left off
                 (isPartialInvoiceStubNote), so this is what was checked */
              <p className="jb-cl-none">Nothing written on it.</p>
            )}
          </section>

          {paper.length > 0 && (
            <section className="jb-cl-grp">
              <h3>Paper</h3>
              {paper.map((f) => (
                <p className="jb-cl-paper" key={f.remoteId}>
                  {!f.url ? (
                    <b>{f.name}</b>
                  ) : onOpenPaper ? (
                    <button type="button" className="pt-link jb-cl-open" onClick={() => onOpenPaper(f)}>
                      {f.name}
                    </button>
                  ) : (
                    <LinkButton href={f.url} target="_blank" rel="noreferrer">
                      {f.name}
                    </LinkButton>
                  )}
                </p>
              ))}
            </section>
          )}
        </>
      )}
    </Dialog>
  );
}
