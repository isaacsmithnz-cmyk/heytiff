"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtAud } from "@/lib/workboard/project-money";
import { unsetWords } from "@/lib/quotes/build-settings";
import { stillToPrice } from "@/lib/quotes/job-price";
import type { QuotePrice } from "@/lib/quotes/quote-price-server";

/* THE QUOTE, PRICED, on the job card's Quote section (Isaac, 2026-10-04:
   "Switch it on now"): the job's own Materials list and its labour at this
   business's own prices, markups and day, with GST and the total. What
   couldn't be priced is listed with why; what isn't set in Quoting is said,
   with the way there. Only to someone with money access — the route says
   no to anyone else, and then nothing shows.

   A total is the quote's only when nothing is left to price; until then it
   is a total so far, and what's left heads the list (Isaac's walk,
   2026-10-05). Labour not given says so in that list, never as a $0 line,
   and a job with nothing to price shows no figures at all. */

const ROUTE = "/api/workboard/quote-price";

type Answer = { ok: true; price: QuotePrice } | { ok: false; reason: string };

const qtyWords = (n: number) => String(Math.round(n * 100) / 100);
const daysWords = (d: number) => `${Math.round(d * 100) / 100} person-day${d === 1 ? "" : "s"}`;
const LABOUR_FROM = { brief: "from the brief", history: "your typical for the work", none: "" } as const;

export function JobQuotePrice({ job, visible }: { job: string; visible: boolean }) {
  const [price, setPrice] = useState<QuotePrice | null | undefined>(undefined);

  useEffect(() => {
    if (!visible || price !== undefined) return;
    let live = true;
    fetch(`${ROUTE}?job=${encodeURIComponent(job)}`)
      .then((r) => r.json() as Promise<Answer>)
      .then((a) => live && setPrice(a.ok ? a.price : null))
      .catch(() => live && setPrice(null));
    return () => {
      live = false;
    };
  }, [job, visible, price]);

  if (!price) return null;

  if (!price.ok) {
    return (
      <section className="wb2-jcsec" aria-label="Price">
        <div className="wb2-jcdhead">
          <b>Price</b>
          <em>Not set</em>
        </div>
        <div className="wb2-mline">
          <b>Not set</b>
          <em>{unsetWords(price.unset)}</em>
          <span>
            <Link className="pbtn ghost sm" href="/dashboard/admin/quoting">
              Set in Quoting
            </Link>
          </span>
        </div>
      </section>
    );
  }

  const { build, unpriced, labourFrom, rows } = price;
  const left = stillToPrice({ unpriced, labourFrom, labourCents: build.labour.sellCents });
  const labourPriced = build.labour.sellCents > 0;
  if (rows === 0 && !labourPriced) {
    return (
      <section className="wb2-jcsec" aria-label="Price">
        <div className="wb2-jcdhead">
          <b>Price</b>
          <em>Nothing to price yet</em>
        </div>
        <p className="wb2-shtext">The job has no materials listed, and nothing gives its labour.</p>
      </section>
    );
  }
  const soFar = left.length > 0 ? ", so far" : "";
  return (
    <section className="wb2-jcsec" aria-label="Price">
      <div className="wb2-jcdhead">
        <b>Price</b>
        <em>
          {left.length > 0
            ? `Part priced: ${left.length} still to price`
            : rows
              ? "The job's materials and labour, at your prices"
              : "Labour only: the job has no materials listed"}
        </em>
      </div>
      {build.groups.map((g) =>
        g.lines.map((l) => (
          <div className="wb2-mline" key={l.key}>
            <b>{l.name}</b>
            <em>{`${qtyWords(l.qty)} at ${fmtAud(Math.round(l.unitBuyCents))} buy`}</em>
            <span>{fmtAud(l.sellCents)}</span>
          </div>
        ))
      )}
      {build.contingency && (
        <div className="wb2-mline">
          <b>Duct contingency</b>
          <em>{`On the ductwork and grilles, and ${build.contingency.hours} hrs in labour`}</em>
          <span>{fmtAud(build.contingency.sellCents)}</span>
        </div>
      )}
      {labourPriced && labourFrom !== "none" && (
        <div className="wb2-mline">
          <b>Labour</b>
          <em>{`${daysWords(build.labour.personDays)}, ${LABOUR_FROM[labourFrom]}`}</em>
          <span>{fmtAud(build.labour.sellCents)}</span>
        </div>
      )}
      <div className="wb2-mline total">
        <b>{`Ex GST${soFar}`}</b>
        <span>{fmtAud(build.exGstCents)}</span>
      </div>
      <div className="wb2-mline">
        <b>GST</b>
        <span>{fmtAud(build.gstCents)}</span>
      </div>
      <div className="wb2-mline total">
        <b>{`Inc GST${soFar}`}</b>
        <span>{fmtAud(build.incGstCents)}</span>
      </div>
      {left.length > 0 && (
        <>
          <p className="wb2-shtext">Still to price</p>
          {left.map((u, i) => (
            <div className="wb2-mline" key={`u-${i}`}>
              <b>{u.name}</b>
              <em>{u.why}</em>
              <span>{u.qty}</span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
