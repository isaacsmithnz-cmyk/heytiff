"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { TimepayNav } from "./timepay-nav";
import { fmtAuWeekdayDate } from "@/lib/au-dates";
import {
  CATEGORY_LABEL,
  owedTotal,
  STATUS_LABEL,
  type ExpenseStatus,
} from "@/lib/expenses/claim";
import type { TeamClaim } from "@/lib/expenses/query";
import {
  approveClaim,
  declineClaim,
  markReimbursed,
  type ExpenseResult,
} from "@/app/actions/expenses";

/* Reviewing everyone's expense claims.

   WHAT AN APPROVER SEES, AND DOESN'T. Amounts, in full — that IS the decision
   they're being asked to make. Never a pay rate: the query behind this screen
   doesn't select the wage column at all, so there is nothing here for a
   component to forget to hide.

   TWO DECISIONS, TWO GATES. `approvals` decides whether the spend was
   legitimate. `financials` records that the money actually moved. A manager
   who can do the first sees no "Mark paid" button at all, because offering a
   control that will be refused is worse than not offering it.

   DECLINING NEEDS A REASON, and the form makes that structural rather than
   advisory — somebody is out of pocket and being told no, and "declined" on
   its own is not an answer they can act on. */

const money = (n: number) =>
  `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Waiting on a person, in the order they should be dealt with: undecided
    first, then approved-but-unpaid, then everything settled. */
const QUEUE_ORDER: Record<ExpenseStatus, number> = {
  pending: 0,
  approved: 1,
  reimbursed: 2,
  declined: 3,
  cancelled: 4,
};

export function TeamExpenses({
  claims,
  canApprove,
  canPay,
}: {
  claims: TeamClaim[];
  /** `approvals` — decide whether the spend was legitimate. */
  canApprove: boolean;
  /** `financials` — record that it was paid. */
  canPay: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const run = (action: () => Promise<ExpenseResult>, onOk?: () => void) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) {
        onOk?.();
        router.refresh();
      } else setError(res.error);
    });
  };

  const sorted = [...claims].sort(
    (a, b) =>
      QUEUE_ORDER[a.status] - QUEUE_ORDER[b.status] || b.expenseDate.localeCompare(a.expenseDate)
  );

  const waiting = claims.filter((c) => c.status === "pending");
  const owed = owedTotal(claims);

  return (
    <div className="page in">
      <div className="wrap">
        {/* `wb2` for the board tokens the card's border reads — see timepay.tsx */}
        <div className="stg wb2" style={{ maxWidth: 900 }}>
          <div className="v2head" style={{ marginBottom: 14, alignItems: "center" }}>
            <div>
              <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
                Expenses
              </h1>
            </div>
          </div>
          {/* out of the title row and onto its own: these tabs are the card's
              dividers now, so they have to touch the card, not the heading */}
          <TimepayNav active="expenses" />

          <div className="wb2-card tp-card">
            {error && <div className="xc-err">{error}</div>}

            <div className="xr-sum">
            <div>
              <span className="xr-k">Waiting on a decision</span>
              <b>{waiting.length}</b>
            </div>
            <div>
              <span className="xr-k">Owed to staff</span>
              <b>{money(owed)}</b>
            </div>
          </div>

          {sorted.length === 0 ? (
            <div className="adm-empty">
              <b>No expense claims yet</b>
              <em>When someone pays for something out of their own pocket, it lands here.</em>
            </div>
          ) : (
            <div className="xc-list">
              {sorted.map((c) => (
                <div className={`xc-row ${c.status}`} key={c.id}>
                  <div className="xc-main">
                    <b>{c.description}</b>
                    <em>
                      {c.staffName} · {fmtAuWeekdayDate(c.expenseDate)}
                      {c.supplier ? ` · ${c.supplier}` : ""} · {CATEGORY_LABEL[c.category]}
                    </em>
                    {/* THE APPROVER'S VERSION OF THE SAME FACT, and the more
                        load-bearing one: without it, a fuel log AND a claim
                        for the same tank read as a duplicate to reject, when
                        they are the intended pair — the log is the record of
                        the fuel, this is the money going back to the person.
                        The tax report already counts it once (the log). */}
                    {c.fuelLog && (
                      <p className="xc-from">
                        <Icon name="fuel" size={13} />
                        Already logged against
                        {c.fuelLog.vehicle ? ` ${c.fuelLog.vehicle}` : " the vehicle"} — this is the
                        reimbursement
                      </p>
                    )}
                    {c.reviewNote && <p className="xc-note">{c.reviewNote}</p>}

                    {declining === c.id && (
                      <div className="xr-decline">
                        <input
                          className="inp"
                          autoFocus
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="Why is it being declined?"
                          aria-label={`Reason for declining ${c.staffName}'s claim`}
                        />
                        <button
                          className="xr-btn bad"
                          // Structural, not advisory: no reason, no decline.
                          disabled={busy || !reason.trim()}
                          onClick={() =>
                            run(() => declineClaim(c.id, reason), () => {
                              setDeclining(null);
                              setReason("");
                            })
                          }
                        >
                          Decline
                        </button>
                        <button
                          className="xr-btn"
                          disabled={busy}
                          onClick={() => {
                            setDeclining(null);
                            setReason("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="xc-amt">
                    {money(c.amount)}
                    {c.gstAmount ? <span>incl. {money(c.gstAmount)} GST</span> : null}
                  </div>

                  <div className="xc-side">
                    <span className={`xc-pill ${c.status}`}>{STATUS_LABEL[c.status]}</span>
                    {(c.receipts ?? []).length > 0 ? (
                      (c.receipts ?? []).map((r, i) =>
                        r.url ? (
                          <a key={i} className="xc-rec" href={r.url} target="_blank" rel="noopener noreferrer">
                            {i === 0 ? "Receipt" : `Receipt ${i + 1}`}
                          </a>
                        ) : null,
                      )
                    ) : (
                      /* Worth saying out loud rather than leaving blank: a
                         claim with no receipt is a judgement call, and the
                         approver should know that's what they're making. */
                      <span className="xr-noreceipt">No receipt</span>
                    )}

                    {canApprove && c.status === "pending" && declining !== c.id && (
                      <span className="xr-acts">
                        <button className="xr-btn go" disabled={busy} onClick={() => run(() => approveClaim(c.id))}>
                          Approve
                        </button>
                        <button className="xr-btn" disabled={busy} onClick={() => setDeclining(c.id)}>
                          Decline
                        </button>
                      </span>
                    )}

                    {/* Only `financials` sees this — offering a control that
                        will be refused is worse than not offering it. */}
                    {canPay && c.status === "approved" && (
                      <button className="xr-btn go" disabled={busy} onClick={() => run(() => markReimbursed(c.id))}>
                        Mark paid
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!canApprove && (
            <p className="xr-foot">
              <Icon name="info" size={14} />
              You can see these, but approving them needs the approvals permission.
            </p>
          )}

          {/* The audit's finding: "Mark paid" flips a status and nothing else,
              and nowhere said so — an owner could reasonably believe the money
              moved. Until the planned Xero push lands, the hand-off is manual
              and the screen owns up to it. */}
          {canPay && (
            <p className="xr-foot">
              <Icon name="info" size={14} />
              Mark paid records the decision here — paying the money and entering it in Xero stays
              manual for now.
            </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
