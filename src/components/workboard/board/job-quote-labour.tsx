"use client";

import { useEffect, useState } from "react";
import { fmtAud } from "@/lib/workboard/project-money";
import type { QuoteLabour } from "@/lib/quotes/quote-labour-server";

/* THE QUOTE'S LABOUR, on the job card's Quote section (Isaac, 2026-10-04:
   "any job should not recommend labour without data… number one source is
   the brief… recommendation comes from orgs own history").

   From the brief: its visits, its hours, and — for a reader with money
   access and a business with a rate — what they come to. Not in the brief:
   what this business typically takes for the kind of work, once enough of
   its own jobs say so. Neither: the fact, and nothing made up. */

const ROUTE = "/api/workboard/quote-labour";

type Answer = { ok: true; labour: QuoteLabour } | { ok: false; reason: string };

const hrs = (h: number) => `${Math.round(h * 10) / 10} hrs`;
const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);
const days = (d: number) => {
  if (Number.isInteger(d)) return d === 1 ? "1 day" : `${d} days`;
  if (Number.isInteger(d * 2)) return d < 1 ? "half a day" : `${Math.floor(d)} and a half days`;
  return hrs(d * 8);
};

export function JobQuoteLabour({ job, visible }: { job: string; visible: boolean }) {
  const [labour, setLabour] = useState<QuoteLabour | null | undefined>(undefined);

  useEffect(() => {
    if (!visible || labour !== undefined) return;
    let live = true;
    fetch(`${ROUTE}?job=${encodeURIComponent(job)}`)
      .then((r) => r.json() as Promise<Answer>)
      .then((a) => live && setLabour(a.ok ? a.labour : null))
      .catch(() => live && setLabour(null));
    return () => {
      live = false;
    };
  }, [job, visible, labour]);

  if (!labour) return null;
  const { advice, rate } = labour;
  const rateWords = rate ? `at your ${rate.from === "recommended" ? "recommended " : ""}${fmtAud(rate.perHourCents)}/hr` : null;
  const costOf = (hours: number) => (rate ? fmtAud(Math.round(hours * rate.perHourCents)) : null);

  if (advice.from === "brief") {
    const { visits, personHours, said } = advice.labour;
    return (
      <section className="wb2-jcsec" aria-label="Labour">
        <div className="wb2-jcdhead">
          <b>Labour</b>
          <em>{`${hrs(personHours)}, from the brief`}</em>
        </div>
        {visits.map((v, i) => (
          <div className="wb2-mline" key={i}>
            <b>{v.stage}</b>
            <em>{`${people(v.people)}, ${days(v.days)}`}</em>
            <span>{hrs(v.people * v.days * 8)}</span>
          </div>
        ))}
        {rateWords && (
          <div className="wb2-mline total">
            <b>{`Labour ${rateWords}`}</b>
            <span>{costOf(personHours)}</span>
          </div>
        )}
        <p className="wb2-shtext">{said.map((s) => `“${s}”`).join(" ")}</p>
      </section>
    );
  }

  return (
    <section className="wb2-jcsec" aria-label="Labour">
      <div className="wb2-jcdhead">
        <b>Labour</b>
        <em>Not in the brief</em>
      </div>
      {advice.from === "history" && (
        <>
          <p className="wb2-shtext">{advice.typical.words}</p>
          {rateWords && (
            <div className="wb2-mline total">
              <b>{`${hrs(advice.typical.hours)} ${rateWords}`}</b>
              <span>{costOf(advice.typical.hours)}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
