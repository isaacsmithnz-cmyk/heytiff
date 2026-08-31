"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { fmtAud } from "@/lib/workboard/project-money";
import { fmtQuantity, materialsTaxMixed, materialsTotalCents } from "@/lib/workboard/job-ledger";
import { claimTitle, type FamilyClaim } from "@/lib/workboard/job-family";
import { readClaim } from "@/app/actions/workboard";
import type { ClaimDetailRead } from "@/lib/workboard/all-jobs-query";

/* ONE PROGRESS CLAIM, AND DELIBERATELY NOTHING ELSE.

   ServiceM8 bills a staged job by cloning it, so every claim used to arrive
   wearing a full job card: the parent's description, the parent's contacts,
   the family's money and no way to tell which of the three you were on. The
   claim is not a job, so it stops getting a job's card and gets this instead.

   WHAT IS IN HERE IS WHAT THE CLAIM KNOWS: the lines on this invoice, the
   money that came in against it, anything somebody wrote on it, and its own
   paperwork. WHAT IS NOT: the description, the visits, the contacts, the
   checklist, the designs. Those belong to the job, and the job is one tap
   away behind the crumb at the top. The moment this grows one of them it has
   become a card again, which is the thing the whole slice exists to stop.

   NOT A SEPARATE PORTAL. It renders inside the sheet's own portal, over the
   card, because a modal on top of a modal that portals separately is how the
   scrim ends up above the thing it is dimming. */

export function JobClaimModal({
  claim,
  parentNumber,
  onClose,
}: {
  claim: FamilyClaim;
  /** The job this claim belongs to — the left half of the crumb. */
  parentNumber: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ClaimDetailRead | null>(null);
  const [loading, setLoading] = useState(true);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  /* No setLoading(true) here: the modal is KEYED BY CLAIM, so a different
     claim is a different component with `loading` already true — the same
     "keyed by id, never reset by effect" rule the sheet itself follows. */
  useEffect(() => {
    let live = true;
    void readClaim(claim.remoteId)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        setLoading(false);
      })
      .catch(() => {
        /* a claim that won't load must not take the card down with it */
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

  return (
    <>
      <div className="wb2-clscrim" onClick={onClose} />
      <aside
        className="wb2-claim"
        role="dialog"
        aria-modal="true"
        aria-label={`${claimTitle(claim)}${claim.jobNumber ? ` — invoice ${claim.jobNumber}` : ""}`}
      >
        <div className="wb2-cltop">
          {parentNumber && (
            <>
              <span className="wb2-shno">{`#${parentNumber}`}</span>
              <i className="wb2-shcrumb" aria-hidden>
                ›
              </i>
            </>
          )}
          <span className="wb2-shno here">
            {claim.jobNumber ? `#${claim.jobNumber}` : "—"}
          </span>
          <span className="wb2-clsp" />
          <button
            ref={closeRef}
            className="wb2-ico"
            onClick={onClose}
            title="Close"
            aria-label="Close this invoice"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="wb2-clhd">
          <b>{claimTitle(claim)}</b>
          <em>
            {[
              claim.percent !== null ? `${claim.percent}% of the job` : null,
              claim.raisedOn ? `Raised ${fmtAuWeekdayDayMonth(claim.raisedOn)}` : null,
              claim.state === "paid" && claim.paidOn
                ? `Paid ${fmtAuWeekdayDayMonth(claim.paidOn)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </em>
          <span className="wb2-clamt">
            {claim.amountCents !== null ? fmtAud(claim.amountCents) : "—"}
          </span>
        </div>

        <div className="wb2-clbody">
          {loading && !detail ? (
            <p className="int-hint">Reading the invoice…</p>
          ) : (
            <>
              {materials.length > 0 && (
                <div className="wb2-clgrp">
                  <span className="wb2-sect">On this invoice</span>
                  {materials.map((m) => (
                    <div className="wb2-mline" key={m.remoteId}>
                      <b>{m.name}</b>
                      <em>{m.quantity !== null ? `× ${fmtQuantity(m.quantity)}` : ""}</em>
                      <span>{m.lineCents !== null ? fmtAud(m.lineCents) : "—"}</span>
                    </div>
                  ))}
                  {(() => {
                    /* Same discipline as the job's own materials list: no
                       total when a line is unpriced, and none when the lines
                       disagree about tax. GST is never derived. */
                    if (materialsTaxMixed(materials)) return null;
                    const total = materialsTotalCents(materials);
                    if (total === null) return null;
                    return (
                      <div className="wb2-mline total">
                        <b>{materials[0].taxInclusive ? "Total inc GST" : "Total ex GST"}</b>
                        <em />
                        <span>{fmtAud(total)}</span>
                      </div>
                    );
                  })()}
                </div>
              )}

              {payments.length > 0 && (
                <div className="wb2-clgrp">
                  <span className="wb2-sect">Paid</span>
                  {payments.map((p) => (
                    <div className="wb2-mline" key={p.remoteId}>
                      <b>{p.method ?? "Payment"}</b>
                      <em>
                        {[
                          p.isDeposit ? "deposit" : null,
                          p.takenOn ? fmtAuWeekdayDayMonth(p.takenOn) : null,
                          p.takenBy,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </em>
                      <span>{p.amountCents !== null ? fmtAud(p.amountCents) : "—"}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="wb2-clgrp">
                <span className="wb2-sect">Written on it</span>
                {notes.length > 0 ? (
                  notes.map((n) => (
                    <div className="wb2-jnote" key={n.remoteId}>
                      <p className="wb2-shtext">{n.text}</p>
                      <em>
                        {[n.writtenBy, n.writtenOn ? fmtAuWeekdayDayMonth(n.writtenOn) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </em>
                    </div>
                  ))
                ) : (
                  /* SAYS WHAT WAS CHECKED. ServiceM8 writes "This job was
                     created as a Partial Invoice for Job #2380" onto every
                     clone it makes — 406 of the 618 notes on clones — and the
                     ledger already says it, better. Silence here would read
                     as "nobody looked". */
                  <p className="int-hint">
                    Nothing written on this invoice — ServiceM8&apos;s own note about raising it
                    isn&apos;t repeated here.
                  </p>
                )}
              </div>

              {paper.length > 0 && (
                <div className="wb2-clgrp">
                  <span className="wb2-sect">Paper</span>
                  {paper.map((f) => (
                    <p className="wb2-shtext" key={f.remoteId}>
                      {f.url ? (
                        <a className="wb2-colink" href={f.url} target="_blank" rel="noreferrer">
                          {f.name}
                        </a>
                      ) : (
                        <b>{f.name}</b>
                      )}
                    </p>
                  ))}
                </div>
              )}

              {/* The one thing this modal will NOT grow into. */}
              <p className="int-hint">
                The work itself — what was done, who went, who to ring — is on the job.
              </p>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
