"use client";

import { useEffect, useState } from "react";
import { fmtAud } from "@/lib/workboard/project-money";
import { NONE_ACCEPTED, type SendPlan } from "@/lib/quotes/sm8-send-plan";

/* WHAT GOES TO SERVICEM8, on the job card's Quote section once an option
   is accepted (Isaac, 2026-10-05: "copy the scope and line items to service
   mate so that we can see the basic version of the accepted quote in
   service mate correctly"). Exactly what one press would send — the job
   made a Work Order, its invoice description, its lines and the lines that
   come off — shown before anything is sent. Only to someone with money
   access; the route says no to anyone else, and then nothing shows. */

const ROUTE = "/api/workboard/quote-send";

type Answer = { ok: true; plan: SendPlan } | { ok: false; reason: string };

const qtyWords = (n: number) => String(Math.round(n * 100) / 100);

export function JobQuoteSend({ job, visible }: { job: string; visible: boolean }) {
  const [plan, setPlan] = useState<SendPlan | null | undefined>(undefined);

  useEffect(() => {
    if (!visible || plan !== undefined) return;
    let live = true;
    fetch(`${ROUTE}?job=${encodeURIComponent(job)}`)
      .then((r) => r.json() as Promise<Answer>)
      .then((a) => live && setPlan(a.ok ? a.plan : null))
      .catch(() => live && setPlan(null));
    return () => {
      live = false;
    };
  }, [job, visible, plan]);

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
    </section>
  );
}
