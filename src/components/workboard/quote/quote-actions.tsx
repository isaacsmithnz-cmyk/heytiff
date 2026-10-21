"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";
import { Icon } from "@/components/shell/icon";
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

/** given: a solid green block in Approve's seat, not a button (a press would
    say nothing more); white words on green's word value, as a schedule's
    block wears them (rule 19) */
const given = (words: string) => (
  <span className="pt-btn pt-btn--36 qc-given">
    <span className="pt-btn__icon" aria-hidden="true">
      <Icon name="check" size={16} />
    </span>
    <span className="pt-btn__word">{words}</span>
  </span>
);

export function QuoteActions({
  money,
  lines,
  busy,
  paper,
  back,
  kept,
  variation,
  approved,
  ready,
  why,
  send,
  acceptable,
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
  /** the option open is priced, every line of it, and nothing is open: Approve can be pressed */
  ready: boolean;
  /** what's left before it can be, in words: "4 questions to answer, 1 line to price" */
  why: string;
  /** Send to ServiceM8, once it's approved (job-quote-send.tsx); null otherwise */
  send: ReactNode;
  /** Mark accepted is offered: it's approved, or an option already is */
  acceptable: boolean;
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
  const view = paper ? (
    <Button onClick={onBack}>{back}</Button>
  ) : money && lines > 0 ? (
    <Button icon="eye" onClick={onView}>
      {variation ? "Preview variation" : "Preview quote"}
    </Button>
  ) : null;
  /* Approve shows from the first line, held until it can be pressed */
  const waiting = !money || kept || lines === 0 ? null : variation ? !variation.approvedAt : !approved;
  const approve =
    waiting === null ? null : !waiting ? (
      given(variation ? `Variation ${variation.n} approved` : "Approved")
    ) : (
      <Button kind="main" disabled={busy || !ready} onClick={onApprove}>
        {variation ? "Approve variation" : "Approve quote"}
      </Button>
    );
  const left = waiting && !ready && why ? <StateWord tone="look">{why}</StateWord> : null;
  const accept =
    !money || lines === 0 || kept ? null : variation ? (
      <Button aria-pressed={!!variation.acceptedAt} disabled={busy} onClick={onAccept}>
        {variation.acceptedAt ? `Variation ${variation.n} accepted` : `Mark variation ${variation.n} accepted`}
      </Button>
    ) : acceptable ? (
      <Button aria-pressed={accepted} disabled={busy} onClick={onAccept}>
        {accepted ? (options > 1 ? `Option ${at + 1} accepted` : "Accepted") : options > 1 ? `Mark option ${at + 1} accepted` : "Mark accepted"}
      </Button>
    ) : null;
  const updating =
    !paper && money && update ? (
      <Button disabled={busy} onClick={onUpdate}>
        Update quote
      </Button>
    ) : null;
  if (!view && !approve && !send && !updating && !accept) return null;
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
      {(updating || accept) && (
        <div className="qc-pair">
          {updating}
          {accept}
        </div>
      )}
    </div>
  );
}
