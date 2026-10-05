"use client";

import { useEffect, useState } from "react";
import { quoteSendOffered, sendQuoteToSm8, type QuoteSendAnswer } from "@/app/actions/quote-sm8";
import { fmtAud } from "@/lib/workboard/project-money";
import { NONE_ACCEPTED, type SendPlan } from "@/lib/quotes/sm8-send-plan";

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

type Answer = { ok: true; plan: SendPlan; editDate: string | null } | { ok: false; reason: string };
type Seen = { plan: SendPlan; editDate: string | null };

const qtyWords = (n: number) => String(Math.round(n * 100) / 100);

export function JobQuoteSend({ job, visible, version }: { job: string; visible: boolean; version?: string | null }) {
  const [seen, setSeen] = useState<Seen | null | undefined>(undefined);
  const [offer, setOffer] = useState<{ offered: boolean; trial: boolean }>({ offered: false, trial: false });
  const [sending, setSending] = useState(false);
  const [answer, setAnswer] = useState<QuoteSendAnswer | null>(null);
  const [reads, setReads] = useState(0);

  /* a new version of the quote is read afresh; what was read stays on
     screen until then */
  useEffect(() => {
    if (!visible) return;
    let live = true;
    fetch(`${ROUTE}?job=${encodeURIComponent(job)}`)
      .then((r) => r.json() as Promise<Answer>)
      .then((a) => live && setSeen(a.ok ? { plan: a.plan, editDate: a.editDate } : null))
      .catch(() => live && setSeen(null));
    quoteSendOffered()
      .then((o) => live && setOffer(o))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [job, visible, reads, version]);

  const send = async () => {
    if (!seen) return;
    setSending(true);
    setAnswer(null);
    const a = await sendQuoteToSm8(job, crypto.randomUUID(), seen.editDate).catch((): QuoteSendAnswer => ({ ok: false, error: "HeyTiff couldn't send that. Nothing went; try again." }));
    setAnswer(a);
    setSending(false);
    setReads((n) => n + 1);
  };

  const plan = seen?.plan;
  if (!plan || (!plan.ok && plan.why === NONE_ACCEPTED)) return null;

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
        <em>{plan.status ? "Becomes a Work Order" : "Its Work Order, updated"}</em>
      </div>
      <div className="wb2-mline">
        <b>Invoice description</b>
        <em className="wb2-jcread">{plan.workDone}</em>
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
          <button type="button" className="pbtn primary" disabled={sending} onClick={() => void send()}>
            {sending ? "Sending" : offer.trial ? "Trial send to ServiceM8" : "Send to ServiceM8 as a work order"}
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
