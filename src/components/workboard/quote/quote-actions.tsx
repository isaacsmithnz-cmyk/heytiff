"use client";

import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";
import type { Variation } from "@/lib/quotes/lines-job";

/* THE QUOTE'S BUTTONS, UNDER ITS CARD IN THE RAIL (layout C, Isaac's pick on
   18 October 2026; they stood in the title's corner from 2026-10-13). Two
   second buttons side by side: View line items, which swaps the left from
   the conversation to the line items and says Back to the conversation
   while they're up, and View quote, which lays the paper over the left and
   says where it goes back to while it's up. Approve joins them, blue, the
   main button (Q3), once the option open is priced; once given it is a
   green word. Update quote and Mark accepted are as they were. Money only,
   but for the line items: a tech quotes the work, and never prices or
   approves it (2026-10-12). */

export function QuoteActions({
  money,
  lines,
  busy,
  chat,
  linesUp,
  paper,
  back,
  kept,
  variation,
  approved,
  approver,
  priced,
  update,
  options,
  at,
  accepted,
  onLines,
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
  /** Tiff is on: the left has a conversation to swap with the line items */
  chat: boolean;
  /** the line items fill the left */
  linesUp: boolean;
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
  /** the option open is priced, every line of it: Approve shows */
  priced: boolean;
  /** Update quote is offered: it's approved or accepted, and no variation is open */
  update: boolean;
  options: number;
  at: number;
  /** the option open is the one the client took */
  accepted: boolean;
  onLines: () => void;
  onView: () => void;
  onBack: () => void;
  onApprove: () => void;
  onUpdate: () => void;
  onAccept: () => void;
}) {
  const view = paper ? (
    <Button onClick={onBack}>{back}</Button>
  ) : money && lines > 0 ? (
    <Button onClick={onView}>{variation ? "View variation" : "View quote"}</Button>
  ) : null;
  const approve = !money || kept ? null : variation ? (
    variation.approvedAt ? (
      <StateWord tone="good">{`Variation ${variation.n} approved`}</StateWord>
    ) : priced ? (
      <Button kind="main" disabled={busy} onClick={onApprove}>
        Approve
      </Button>
    ) : null
  ) : approved ? (
    <StateWord tone="good">{`Approved by ${approver}`}</StateWord>
  ) : priced ? (
    <Button kind="main" disabled={busy} onClick={onApprove}>
      Approve
    </Button>
  ) : null;
  const accept =
    !money || lines === 0 || kept ? null : variation ? (
      <Button aria-pressed={!!variation.acceptedAt} disabled={busy} onClick={onAccept}>
        {variation.acceptedAt ? `Variation ${variation.n} accepted` : `Mark variation ${variation.n} accepted`}
      </Button>
    ) : (
      <Button aria-pressed={accepted} disabled={busy} onClick={onAccept}>
        {accepted ? (options > 1 ? `Option ${at + 1} accepted` : "Accepted") : options > 1 ? `Mark option ${at + 1} accepted` : "Mark accepted"}
      </Button>
    );
  const updating =
    !paper && money && update ? (
      <Button disabled={busy} onClick={onUpdate}>
        Update quote
      </Button>
    ) : null;
  return (
    <div className="qc-acts" role="group" aria-label="The quote's buttons">
      {(chat || view) && (
        <div className="qc-pair">
          {chat && <Button onClick={onLines}>{linesUp ? "Back to the conversation" : "View line items"}</Button>}
          {view}
        </div>
      )}
      {approve}
      {(updating || accept) && (
        <div className="qc-pair">
          {updating}
          {accept}
        </div>
      )}
    </div>
  );
}
