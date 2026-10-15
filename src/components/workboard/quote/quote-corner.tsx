"use client";

import type { Variation } from "@/lib/quotes/lines-job";

/* THE QUOTE'S NEXT STEP, IN THE TITLE'S CORNER (portalled there by the
   face). View quote opens the paper in the main column, and on the paper
   the way back says where it goes. Approve stands in the corner on both
   (the chat-first page, Isaac, 2026-10-13), in the one primary he chose:
   "Dark green outline white body and green approved text". Update quote and
   Mark accepted are as they were. Money only: a tech quotes the work, and
   never prices or approves it (2026-10-12). */

export function QuoteCorner({
  money,
  lines,
  busy,
  paper,
  back,
  kept,
  variation,
  approved,
  approver,
  update,
  options,
  at,
  accepted,
  onView,
  onBack,
  onApprove,
  onUpdate,
  onAccept,
}: {
  money: boolean;
  /** how many lines the quote has, every option */
  lines: number;
  busy: boolean;
  /** the paper is up */
  paper: boolean;
  /** the way back off the paper, in words: where it goes */
  back: string;
  /** a version kept at an earlier approval is open: nothing to approve or accept */
  kept: boolean;
  /** the variation open, if one is */
  variation: Variation | null;
  approved: boolean;
  /** who approved it, in words */
  approver: string;
  /** Update quote is offered: it's approved or accepted, and no variation is open */
  update: boolean;
  options: number;
  at: number;
  /** the option open is the one the client took */
  accepted: boolean;
  onView: () => void;
  onBack: () => void;
  onApprove: () => void;
  onUpdate: () => void;
  onAccept: () => void;
}) {
  const approve = kept ? null : variation ? (
    variation.approvedAt ? (
      <span className="qp-approved">{`Variation ${variation.n} approved`}</span>
    ) : (
      <button type="button" className="pbtn ghost qp-go" disabled={busy} onClick={onApprove}>
        Approve
      </button>
    )
  ) : approved ? (
    <span className="qp-approved">{`Approved by ${approver}`}</span>
  ) : (
    <button type="button" className="pbtn ghost qp-go" disabled={busy || lines === 0} onClick={onApprove}>
      Approve
    </button>
  );
  return (
    <>
      {paper ? (
        <button type="button" className="pbtn ghost" onClick={onBack}>
          {back}
        </button>
      ) : (
        money &&
        lines > 0 && (
          <button type="button" className="pbtn ghost" onClick={onView}>
            {variation ? "View variation" : "View quote"}
          </button>
        )
      )}
      {!paper && money && update && (
        <button type="button" className="pbtn ghost" disabled={busy} onClick={onUpdate}>
          Update quote
        </button>
      )}
      {money && approve}
      {money &&
        lines > 0 &&
        !kept &&
        (variation ? (
          <button
            type="button"
            className={variation.acceptedAt ? "pbtn ghost wb2-jqacc on" : "pbtn ghost"}
            aria-pressed={!!variation.acceptedAt}
            disabled={busy}
            onClick={onAccept}
          >
            {variation.acceptedAt ? `Variation ${variation.n} accepted` : `Mark variation ${variation.n} accepted`}
          </button>
        ) : (
          <button type="button" className={accepted ? "pbtn ghost wb2-jqacc on" : "pbtn ghost"} aria-pressed={accepted} disabled={busy} onClick={onAccept}>
            {accepted ? (options > 1 ? `Option ${at + 1} accepted` : "Accepted") : options > 1 ? `Mark option ${at + 1} accepted` : "Mark accepted"}
          </button>
        ))}
    </>
  );
}
