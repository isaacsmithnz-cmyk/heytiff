"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Waiting } from "@/components/ui/orb";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import { quoteCardWords, quoteStarted, type QuoteFacts } from "@/lib/quotes/quote-card";
import { DocRow } from "./job-documents-face";

/* THE JOB CARD'S QUOTE SECTION (Isaac, 2026-10-05: "it should have opened up
   the proper quote screen not a section below"; 2026-10-12, retiring the old
   builder: the same card on the new code, and for techs too — "the quoting
   section should still be accessible. For techs who are quoting a job").
   ServiceM8's own quote first, where HeyTiff's stands in a line, and the one
   button into the quote page. No money of HeyTiff's: what ServiceM8's quote
   came to shows only to a reader who sees money (sm8-quote-of.ts). */

const ROUTE = "/api/workboard/quote-status";

/** ServiceM8's own quote on the job: the PDF it generated, the day it went,
    and what it came to for a reader who sees money. */
export type Sm8Quote = {
  papers: JobMediaItem[];
  sentOn: string | null;
  /** Already worded, "$45,430 inc GST"; null without the money grant. */
  value: string | null;
  /** The same, as money, on the basis ServiceM8 holds it; null without the
      money grant. */
  quoted?: { cents: number; basis: "ex" | "inc" } | null;
};

export function JobQuoteCard({
  job,
  visible,
  sm8 = null,
  onOpenPaper,
}: {
  /** The job card's uuid, or the row's until the record read lands. */
  job: string;
  /** Read where the quote stands only once the section is opened. */
  visible: boolean;
  sm8?: Sm8Quote | null;
  onOpenPaper?: (item: JobMediaItem) => void;
}) {
  /* undefined while it's read; null when the read failed */
  const [facts, setFacts] = useState<QuoteFacts | null | undefined>(undefined);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    Promise.resolve()
      .then(() => fetch(`${ROUTE}?job=${encodeURIComponent(job)}`))
      .then((r) => r.json() as Promise<{ ok: boolean; facts?: QuoteFacts }>)
      .then((a) => live && setFacts(a.ok && a.facts ? a.facts : null))
      .catch(() => live && setFacts(null));
    return () => {
      live = false;
    };
  }, [visible, job, reads]);

  const sm8Quoted = !!sm8 && (sm8.papers.length > 0 || !!sm8.sentOn);
  const sm8Block = sm8Quoted ? (
    <div className="wb2-jcsec">
      <div className="wb2-jcdhead">
        <b>Quote from ServiceM8</b>
        <em>{[sm8.sentOn ? `Sent ${fmtAuWeekdayDayMonth(sm8.sentOn)}` : "Not sent yet", sm8.value].filter(Boolean).join(", ")}</em>
      </div>
      {sm8.papers.map((p) => (
        <DocRow key={p.remoteId} item={p} onOpen={(item) => onOpenPaper?.(item)} />
      ))}
    </div>
  ) : null;

  if (facts === undefined)
    return (
      <>
        {sm8Block}
        <Waiting note="Reading the quote" />
      </>
    );
  if (facts === null)
    return (
      <>
        {sm8Block}
        <div className="wb2-jcsec wb2-jq">
          <p className="wb2-sherr">Where the quote stands couldn&rsquo;t be read.</p>
          <div className="wb2-jqacts">
            <button type="button" className="pbtn ghost" onClick={() => setReads((n) => n + 1)}>
              Try again
            </button>
          </div>
        </div>
      </>
    );

  const started = quoteStarted(facts);
  const words = quoteCardWords(facts, fmtAuWeekdayDayMonth);
  return (
    <>
      {sm8Block}
      {started && (
        <div className="wb2-jcsec">
          <div className="wb2-jcdhead">
            <b>Quote</b>
            {words && <em>{words}</em>}
          </div>
        </div>
      )}
      <div className="wb2-jqacts">
        <Link
          className={started ? "pbtn primary" : "pbtn ghost"}
          /* a quote not started yet starts with Tiff (4.4) */
          href={`/dashboard/workboard/quotes/${encodeURIComponent(job)}${started ? "" : "?start=1"}`}
        >
          {!started && <Icon name="plus" size={15} />}
          {started ? "Continue quote" : sm8Quoted ? "Update ServiceM8 quote" : "Create a quote"}
        </Link>
      </div>
    </>
  );
}
