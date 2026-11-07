"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { quoteSendOffered, sendQuoteToSm8, sendVariationToSm8, type QuoteSendAnswer, type VariationSendAnswer } from "@/app/actions/quote-sm8";
import { fmtAud } from "@/lib/workboard/project-money";
import { NONE_ACCEPTED, NOT_APPROVED, type SendPlan } from "@/lib/quotes/sm8-send-plan";

/* WHAT GOES TO SERVICEM8, on the job card's Quote section once an option
   is accepted (Isaac, 2026-10-05: "copy the scope and line items to service
   mate so that we can see the basic version of the accepted quote in
   service mate correctly"). Exactly what one press would send — the job
   made a Work Order, its invoice description, its lines and the lines that
   come off — shown before anything is sent, then sent with one press
   where the owner has Accepted quotes on. A trial run says nothing went.
   Only to someone with money access; the route says no to anyone else, and
   then nothing shows. */

const ROUTE = "/api/workboard/quote-send";

type Answer = { ok: true; plan: SendPlan; editDate: string | null; key: string } | { ok: false; reason: string };
/** `at`: the quote's version it was read for. */
type Seen = { plan: SendPlan; editDate: string | null; key: string; at: string | null | undefined };

const qtyWords = (n: number) => String(Math.round(n * 100) / 100);

/** `as`: "quote" sends the approved quote as a quote, before it's accepted
    (slice 7.3): its scope as the job's description, the job left a Quote.
    `look`: "button" is the quote page's pinned Send to ServiceM8 (layout B,
    Isaac, 21 October 2026), the main button alone under Approve, with what
    the send said under it and, once it went (`sentAt`), Sent to ServiceM8
    and its day; the paper it sends is Preview quote's. The same read, the
    same press, the same key. */
export function JobQuoteSend({
  job,
  visible,
  version,
  as = "accepted",
  onSent,
  look = "section",
  sentAt = null,
}: {
  job: string;
  visible: boolean;
  version?: string | null;
  as?: "accepted" | "quote";
  onSent?: () => void;
  look?: "section" | "button";
  /** when it went to ServiceM8 for real, for the button's Sent */
  sentAt?: string | null;
}) {
  const asQuote = as === "quote";
  const [seen, setSeen] = useState<Seen | null | undefined>(undefined);
  const [offer, setOffer] = useState<{ offered: boolean; trial: boolean; held?: string | null }>({ offered: false, trial: false });
  const [sending, setSending] = useState(false);
  const [answer, setAnswer] = useState<QuoteSendAnswer | null>(null);
  const [reads, setReads] = useState(0);
  /* what a send said belongs to the version it was sent from */
  const [sentOn, setSentOn] = useState(version);
  if (version !== sentOn) {
    setSentOn(version);
    setAnswer(null);
  }

  /* a new version of the quote is read afresh; what was read stays on
     screen until then */
  useEffect(() => {
    if (!visible) return;
    let live = true;
    fetch(`${ROUTE}?job=${encodeURIComponent(job)}${asQuote ? "&as=quote" : ""}`)
      .then((r) => r.json() as Promise<Answer>)
      .then((a) => live && setSeen(a.ok ? { plan: a.plan, editDate: a.editDate, key: a.key, at: version } : null))
      .catch(() => live && setSeen(null));
    quoteSendOffered()
      .then((o) => live && setOffer(o))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [job, visible, reads, version, asQuote]);

  /* read for this version of the quote: until then, nothing can be sent */
  const fresh = !!seen && seen.at === version;
  const send = async () => {
    if (!seen || !fresh) return;
    setSending(true);
    setAnswer(null);
    const a = await sendQuoteToSm8(job, crypto.randomUUID(), seen.editDate, seen.key, as).catch((): QuoteSendAnswer => ({ ok: false, error: "HeyTiff couldn't send that. Nothing went; try again." }));
    setAnswer(a);
    setSending(false);
    setReads((n) => n + 1);
    if (a.ok) onSent?.();
  };

  const plan = seen?.plan;
  /* gone: its day, unless the press that sent it said something went wrong,
     which stays with the button to press again */
  const troubled = !!answer && (!answer.ok || answer.failed.length > 0);
  if (look === "button" && sentAt && !troubled) return <StateWord tone="good">{`Sent to ServiceM8, ${fmtAuWeekdayDayMonth(auDayOf(sentAt))}`}</StateWord>;
  if (!plan || (!plan.ok && (plan.why === NONE_ACCEPTED || plan.why === NOT_APPROVED))) return null;

  if (look === "button") {
    if (!plan.ok) return <StateWord tone="look">{plan.why}</StateWord>;
    if (!offer.offered) return offer.held ? <StateWord tone="look">{offer.held}</StateWord> : null;
    return (
      <>
        <Button kind="main" disabled={sending || !fresh} onClick={() => void send()}>
          {sending ? "Sending" : offer.trial ? "Trial send to ServiceM8" : "Send to ServiceM8"}
        </Button>
        {answer && <SendResult answer={answer} />}
      </>
    );
  }

  if (!plan.ok) {
    return (
      <section className="wb2-jcsec" aria-label="To ServiceM8">
        <div className="wb2-jcdhead">
          <b>To ServiceM8</b>
          <em>Can&rsquo;t go yet</em>
        </div>
        <p className="wb2-shtext">{plan.why}</p>
      </section>
    );
  }

  return (
    <section className="wb2-jcsec" aria-label="To ServiceM8">
      <div className="wb2-jcdhead">
        <b>To ServiceM8</b>
        <em>{asQuote ? "Stays a Quote" : plan.status ? "Becomes a Work Order" : "Its Work Order, updated"}</em>
      </div>
      <div className="wb2-mline">
        <b>{asQuote ? "Job description" : "Invoice description"}</b>
        <em className="wb2-jcread">{asQuote ? plan.jobDescription : plan.workDone}</em>
      </div>
      {plan.lines.map((l, i) => (
        <div className="wb2-mline" key={`l-${i}`}>
          <b>{l.name}</b>
          <em>{`${qtyWords(l.quantity)} × ${fmtAud(Math.round(l.unitPriceCents))}`}</em>
          <span>{fmtAud(Math.round(l.quantity * l.unitPriceCents))}</span>
        </div>
      ))}
      <div className="wb2-mline total">
        <b>Ex GST</b>
        <span>{fmtAud(plan.exGstCents)}</span>
      </div>
      {plan.remove.length > 0 && (
        <p className="wb2-shtext">{`Comes off the job: ${plan.remove.map((r) => r.name || "a line").join(", ")}`}</p>
      )}
      {answer && <SendResult answer={answer} />}
      {offer.offered && (
        <div className="wb2-jqacts">
          <button type="button" className="pbtn primary" disabled={sending || !fresh} onClick={() => void send()}>
            {sending ? "Sending" : offer.trial ? "Trial send to ServiceM8" : asQuote ? "Send to ServiceM8 as a quote" : "Send to ServiceM8 as a work order"}
          </button>
        </div>
      )}
    </section>
  );
}

function SendResult({ answer }: { answer: QuoteSendAnswer }) {
  if (!answer.ok) return <p className="wb2-sherr">{answer.error}</p>;
  if (answer.trial) return <p className="wb2-shtext">Trial run: every change was checked and logged, and nothing went to ServiceM8.</p>;
  return (
    <>
      <p className="wb2-shtext">
        {answer.waiting > 0
          ? `${answer.sent} sent, ${answer.waiting} still going to ServiceM8.`
          : `Sent to ServiceM8: ${answer.sent} ${answer.sent === 1 ? "change" : "changes"}.`}
      </p>
      {answer.failed.map((f, i) => (
        <p className="wb2-sherr" key={i}>
          {f}
        </p>
      ))}
    </>
  );
}

/** AN ACCEPTED VARIATION TO SERVICEM8, as extra lines on the job (decision
    21): the quote page presses it on accepting, and its rail again while it
    hasn't all gone. Here beside the accepted quote's send, the one door the
    page reaches the send's action by. */
export const sendVariation = (job: string, option: number): Promise<VariationSendAnswer> =>
  sendVariationToSm8(job, option).catch((): VariationSendAnswer => ({ ok: false, error: "HeyTiff couldn't send that. Nothing went; try again." }));
