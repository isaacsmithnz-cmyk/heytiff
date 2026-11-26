"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button, type ControlSize } from "@/components/parts/button";
import { Menu } from "@/components/parts/menu";
import { StateWord } from "@/components/parts/state";
import type { Variation } from "@/lib/quotes/lines-job";

/* THE QUOTE'S BUTTONS, PINNED AT THE RAIL'S FOOT (layout B, Isaac's pick on
   21 October 2026: "Price on top, buttons pinned"; they stood under the card
   from 18 October, in the title's corner from 2026-10-13). You approve after
   you've read the price, so the button you press last is last, and never
   scrolls away. Preview quote on the left, a second button, lays the paper
   over the left and says where it goes back to while it's up; Approve quote
   on the right, the main button, waits until the option open is priced and
   nothing is open, and one orange line under them says what's left. Once
   given it is a solid green Approved that can't be pressed, and Send to
   ServiceM8 comes under them (job-quote-send.tsx), then Sent to ServiceM8
   and its day. Update quote and Mark accepted are as they were, in a row of
   their own once it's approved. All of it is money only: a tech quotes the
   work, and never prices or approves it (2026-10-12). Every button is the
   normal 36 ("Buttons need to be normal size", 21 October). */

/** a list's glyph: three lines, each with its point (layout B's Line items) */
const LIST = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <path d="M8 6h12M8 12h12M8 18h12" />
    <circle cx="4" cy="6" r="1" />
    <circle cx="4" cy="12" r="1" />
    <circle cx="4" cy="18" r="1" />
  </svg>
);

/** LINE ITEMS, under the price (layout B): swaps the left from the
    conversation to the line items, and says Back to the conversation while
    they're up. Only while Tiff is on: without her the line items are the left. */
export function LinesButton({ up, onLines }: { up: boolean; onLines: () => void }) {
  return (
    <Button icon={LIST} onClick={onLines}>
      {up ? "Back to the conversation" : "Line items"}
    </Button>
  );
}

/** given: Approve's seat says so in green, a state word as rule 17 has it,
    where it stood as a solid green block (the walk of 15 November 2026, T3:
    "As the mock") */
const given = (words: string) => (
  <span className="qc-given">
    <StateWord tone="good">{words}</StateWord>
  </span>
);

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
}): { step: FootStep | null; moved: Moved[] } {
  if (!a.money || a.lines === 0 || a.kept) return { step: null, moved: [] };
  if (a.variation) return { step: a.variation.approvedAt ? "accept" : "approve", moved: [] };
  const accept = a.acceptable && !a.accepted;
  const update = a.update && !a.paper;
  const step: FootStep | null = !a.approved ? "approve" : a.sending ? "send" : accept ? "accept" : update ? "update" : null;
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
  views = false,
  back,
  kept,
  variation,
  approved,
  ready,
  why,
  asked = 0,
  onAnswer,
  send,
  pdf = null,
  acceptable,
  update,
  options,
  at,
  accepted,
  one = false,
  sent = false,
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
  /** Chat, Line items and Preview are a tray over the left (the job's Price
      tab): no Preview quote or way back here */
  views?: boolean;
  /** the way back off the paper, in words: where it goes */
  back: string;
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
  /** the quote's PDF, once it's approved: Share offers it (Isaac, 21 October
      2026: "You can download PDF or share"); null before */
  pdf?: string | null;
  /** Mark accepted is offered: it's approved, or an option already is */
  acceptable: boolean;
  /** Update quote is offered: it's approved or accepted, and no variation is open */
  update: boolean;
  options: number;
  at: number;
  /** the option open is the one the client took */
  accepted: boolean;
  /** the panel's foot: the next step alone (panelFoot) */
  one?: boolean;
  /** it went to ServiceM8 for real: Where it's up to says so, not the foot */
  sent?: boolean;
  onView: () => void;
  onBack: () => void;
  onApprove: () => void;
  onUpdate: () => void;
  onAccept: () => void;
}) {
  const view = views ? null : paper ? (
    <Button onClick={onBack}>{back}</Button>
  ) : money && lines > 0 ? (
    <Button icon="eye" onClick={onView}>
      {variation ? "Preview variation" : "Preview quote"}
    </Button>
  ) : null;
  /* Approve shows from the first line, held until it can be pressed */
  const waiting = !money || kept || lines === 0 ? null : variation ? !variation.approvedAt : !approved;
  const answering = !!waiting && asked > 0 && !!onAnswer;
  const approve =
    waiting === null ? null : !waiting ? (
      /* on the Price tab the steps say it (the Price mock, 16 November 2026) */
      views && !variation ? null : (
        given(variation ? `Variation ${variation.n} approved` : "Ready to send")
      )
    ) : answering ? (
      /* her questions come first, and the button opens Settle on them: one
         next step, as the phone's foot has it (Isaac, 24 November 2026; Settle
         26 November 2026). It was Mark ready to send greyed out, with the
         reason under it. */
      <Button kind="main" disabled={busy} onClick={onAnswer}>
        {`Settle ${asked} ${asked === 1 ? "question" : "questions"}`}
      </Button>
    ) : (
      <Button kind="main" disabled={busy || !ready} onClick={onApprove}>
        {variation ? "Approve variation" : "Mark ready to send"}
      </Button>
    );
  const left = waiting && !ready && why && !answering ? <StateWord tone="look">{why}</StateWord> : null;
  const accept =
    !money || lines === 0 || kept ? null : variation ? (
      variation.acceptedAt ? (
        <Taken words={`Variation ${variation.n} accepted`} busy={busy} onUndo={onAccept} />
      ) : (
        <Button disabled={busy} onClick={onAccept}>{`Mark variation ${variation.n} accepted`}</Button>
      )
    ) : acceptable ? (
      /* "Customer accepted" to press until it is, then the words in green with
         Undo (T3); the phone's words since the Price overhaul, 18 November 2026 */
      accepted ? (
        /* on the Price tab the steps say it, with Undo beside it */
        views ? null : (
          <Taken words={options > 1 ? `Customer accepted option ${at + 1}` : "Customer accepted"} busy={busy} onUndo={onAccept} />
        )
      ) : (
        <Button disabled={busy} onClick={onAccept}>{options > 1 ? `Customer accepted option ${at + 1}` : "Customer accepted"}</Button>
      )
    ) : null;
  const updating =
    !paper && money && update ? (
      /* quoting orange once it's gone out, as rule 25c has it on the rail */
      <Button kind="quote" disabled={busy} onClick={onUpdate}>
        Update quote
      </Button>
    ) : null;
  if (one) {
    const { step } = panelFoot({ money, lines, kept, variation, approved, sending: !!send && !sent, acceptable, accepted, update, paper });
    const node = step === "approve" ? approve : step === "send" ? send : step === "accept" ? accept : step === "update" ? updating : null;
    if (!node) return null;
    return (
      <div className="qc-dock" role="group" aria-label="The next step">
        {node}
        {step === "approve" && left}
      </div>
    );
  }
  if (!view && !approve && !send && !pdf && !updating && !accept) return null;
  return (
    <div className="qc-dock" role="group" aria-label="The quote's buttons">
      {(view || approve) && (
        <div className="qc-pair">
          {view}
          {approve}
        </div>
      )}
      {left}
      {send}
      {views ? (
        /* the Price tab: Mark accepted as wide as the rail till it's said,
           then Update quote and Share side by side (the Price mock) */
        <>
          {accept}
          {(updating || pdf) && (
            <div className="qc-pair qc-pair--two">
              {updating}
              {pdf && <Share pdf={pdf} />}
            </div>
          )}
        </>
      ) : (
        <>
          {pdf && <Share pdf={pdf} />}
          {(updating || accept) && (
            <div className="qc-pair">
              {updating}
              {accept}
            </div>
          )}
        </>
      )}
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
