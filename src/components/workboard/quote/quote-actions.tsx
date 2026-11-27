"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button, type ControlSize } from "@/components/parts/button";
import { Menu } from "@/components/parts/menu";
import { StateWord } from "@/components/parts/state";
import type { Variation } from "@/lib/quotes/lines-job";
import type { ReviewStep } from "@/lib/quotes/review";

/* THE QUOTE'S NEXT STEP, PINNED AT THE PANEL'S FOOT (layout B, Isaac's pick
   on 21 October 2026: "Price on top, buttons pinned"; one button since 21
   November, below). You approve after you've read the price, so the button
   you press last is last, and never scrolls away. Mark ready to send waits
   until the option open is priced and nothing is open, and one orange line
   under it says what's left; her questions open, it's Settle N questions,
   which opens Settle on them. All of it is money only: a tech quotes the
   work, and never prices or approves it (2026-10-12). */

/** a client's yes, said in green, with Undo beside it while it can be taken back */
function Taken({ words, busy, onUndo }: { words: string; busy: boolean; onUndo: () => void }) {
  return (
    <span className="qc-taken">
      <StateWord tone="good">{words}</StateWord>
      <Button kind="quiet" size={32} disabled={busy} onClick={onUndo} aria-label={`Undo ${words.toLowerCase()}`}>
        Undo
      </Button>
    </span>
  );
}

/* THE PANEL'S FOOT IS ONE BUTTON (Isaac, 21 November 2026, "Yes, one
   button", on the quote in its own tab): the next step and nothing else,
   as the phone's screen has it. Mark ready to send, then Send to ServiceM8,
   then Customer accepted, then Update quote. What else can be done then
   moves to the Actions at the head of the tab: Customer accepted before
   it's next, and Update quote. Share stands over the Proposal's page. */

export type FootStep = "approve" | "send" | "accept" | "update";
export type Moved = "accept" | "update";

export function panelFoot(a: {
  money: boolean;
  lines: number;
  kept: boolean;
  variation: Variation | null;
  approved: boolean;
  /** Send to ServiceM8 is offered and it hasn't gone for real yet */
  sending: boolean;
  acceptable: boolean;
  accepted: boolean;
  update: boolean;
  paper: boolean;
  /** the design changed since it was sent: Update quote comes before the customer's yes (design-units.ts) */
  updateFirst?: boolean;
}): { step: FootStep | null; moved: Moved[] } {
  if (!a.money || a.lines === 0 || a.kept) return { step: null, moved: [] };
  if (a.variation) return { step: a.variation.approvedAt ? "accept" : "approve", moved: [] };
  const accept = a.acceptable && !a.accepted;
  const update = a.update && !a.paper;
  const step: FootStep | null = !a.approved ? "approve" : a.sending ? "send" : update && a.updateFirst ? "update" : accept ? "accept" : update ? "update" : null;
  const moved: Moved[] = [];
  if (accept && step !== "accept") moved.push("accept");
  if (update && step !== "update") moved.push("update");
  return { step, moved };
}

export function QuoteActions({
  money,
  lines,
  busy,
  paper,
  kept,
  variation,
  approved,
  ready,
  why,
  asked = 0,
  onAnswer,
  send,
  acceptable,
  update,
  updateFirst = false,
  options,
  at,
  accepted,
  sent = false,
  onApprove,
  onUpdate,
  onAccept,
  review = null,
  checking = false,
  walk,
  onCheck,
  onFix,
}: {
  money: boolean;
  /** how many lines the quote has, every option */
  lines: number;
  busy: boolean;
  /** the paper is up */
  paper: boolean;
  /** a version kept at an earlier approval is open: nothing to approve or accept */
  kept: boolean;
  /** the variation open, if one is */
  variation: Variation | null;
  approved: boolean;
  /** the option open is priced, every line of it, and nothing is open: Approve can be pressed */
  ready: boolean;
  /** what's left before it can be, in words: "4 questions to answer, 1 line to price" */
  why: string;
  /** her questions still open: answering them is the next step, as on the phone */
  asked?: number;
  /** to her questions, in Build */
  onAnswer?: () => void;
  /** Send to ServiceM8, once it's approved (job-quote-send.tsx); null otherwise */
  send: ReactNode;
  /** Mark accepted is offered: it's approved, or an option already is */
  acceptable: boolean;
  /** Update quote is offered: it's approved or accepted, and no variation is open */
  update: boolean;
  /** the design changed since it was sent: Update quote is the next step */
  updateFirst?: boolean;
  options: number;
  at: number;
  /** the option open is the one the client took */
  accepted: boolean;
  /** it went to ServiceM8 for real: Where it's up to says so, not the foot */
  sent?: boolean;
  onApprove: () => void;
  onUpdate: () => void;
  onAccept: () => void;
  /** Tiff's check (review.ts), advice beside Mark ready to send: where it's
      left the quote; absent, there's no check to offer */
  review?: ReviewStep | null;
  /** she's checking it now */
  checking?: boolean;
  /** the finding she's on, as a card (quote-review.tsx) */
  walk?: ReactNode;
  onCheck?: () => void;
  onFix?: () => void;
}) {
  const { step } = panelFoot({ money, lines, kept, variation, approved, sending: !!send && !sent, acceptable, accepted, update, paper, updateFirst });
  const answering = step === "approve" && asked > 0 && !!onAnswer;
  const node =
    step === "approve" ? (
      answering ? (
        /* her questions come first, and the button opens Settle on them: one
           next step, as the phone's foot has it (Isaac, 24 November 2026;
           Settle 26 November 2026) */
        <Button kind="main" disabled={busy} onClick={onAnswer}>
          {`Settle ${asked} ${asked === 1 ? "question" : "questions"}`}
        </Button>
      ) : (
        /* TIFF'S CHECK IS ADVICE, NOT A GATE (Isaac, 27 November 2026:
           "The reviewer is just full of shit", then "Advice, not a gate"):
           Mark ready to send marks it; Check with Tiff is there to press,
           what she finds comes one at a time over it, and Ignore puts it away */
        <>
          {!variation && ready && review?.step === "walk" && walk}
          {!variation && ready && review?.step === "fix" && (
            <Button kind="second" disabled={busy || checking} onClick={onFix}>
              {`Fix ${review.fixes} with Tiff`}
            </Button>
          )}
          <Button kind="main" disabled={busy || !ready} onClick={onApprove}>
            {variation ? "Approve variation" : "Mark ready to send"}
          </Button>
          {!variation && ready && review?.step === "check" && onCheck && (
            <Button kind="quiet" disabled={busy || checking} onClick={onCheck}>
              {checking ? "Checking the quote" : review.again ? "Check with Tiff again" : "Check with Tiff"}
            </Button>
          )}
        </>
      )
    ) : step === "send" ? (
      send
    ) : step === "accept" ? (
      variation ? (
        variation.acceptedAt ? (
          <Taken words={`Variation ${variation.n} accepted`} busy={busy} onUndo={onAccept} />
        ) : (
          <Button disabled={busy} onClick={onAccept}>{`Mark variation ${variation.n} accepted`}</Button>
        )
      ) : (
        /* the phone's words since the Price overhaul, 18 November 2026 */
        <Button disabled={busy} onClick={onAccept}>{options > 1 ? `Customer accepted option ${at + 1}` : "Customer accepted"}</Button>
      )
    ) : step === "update" ? (
      /* quoting orange once it's gone out, as rule 25c has it */
      <Button kind="quote" disabled={busy} onClick={onUpdate}>
        Update quote
      </Button>
    ) : null;
  if (!node) return null;
  const left = step === "approve" && !ready && why && !answering ? <StateWord tone="look">{why}</StateWord> : null;
  return (
    <div className="qc-dock" role="group" aria-label="The next step">
      {node}
      {left}
    </div>
  );
}

/* SHARE (Isaac, 21 October 2026: "Or maybe just a share button. You can
   download PDF or share"), once it's approved: the quote's PDF, printed as
   the paper (api/workboard/quote-pdf), or its link for someone in HeyTiff. */
export function Share({ pdf, size }: { pdf: string; size?: ControlSize }) {
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const pick = (key: string) => {
    setOpen(false);
    if (key === "pdf") window.location.assign(pdf);
    if (key === "link")
      void navigator.clipboard
        ?.writeText(window.location.href)
        .then(() => setSaid("Link copied"))
        .catch(() => setSaid("The link couldn't be copied"));
  };
  return (
    <>
      <Button ref={anchor} size={size} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Share
      </Button>
      <Menu
        open={open}
        anchor={anchor}
        onClose={() => setOpen(false)}
        onSelect={pick}
        label="Share the quote"
        matchWidth
        items={[
          { key: "pdf", label: "Download PDF" },
          { key: "link", label: "Copy the quote's link", hint: "For people in HeyTiff" },
        ]}
      />
      {said && <p className="qc-said" role="status">{said}</p>}
    </>
  );
}
