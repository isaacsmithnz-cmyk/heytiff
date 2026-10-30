"use client";

import { Button } from "@/components/parts/button";
import { Row, RowList } from "@/components/parts/row";
import { openInTab } from "@/components/shell/open-tabs";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { DesignState } from "@/lib/quotes/quote-steps";
import { designHref, studioJobHref } from "@/lib/shell/links";

/* THE DESIGN STEP, IN THE RAIL (Isaac, 28 October 2026: "Brief, Scope,
   Design (skippable), Priced, with the Studio opening from the Design
   step"; the mock https://claude.ai/artifact/GgHkkP8Jci3xQ94YwkLhCA). Under
   the stage line, before the price, as the line has it: the job's designs,
   each opening in the Studio; with none, Design it opens the Studio on the
   job, which starts the job's first design, and Price without a design
   passes the step by. Passed by, the line says No design, and Design it is
   still here, for a job won without one that wants one for the install.

   The Studio opens in a tab of its own, so the quote keeps this one, as
   Open job does. Coming back to the quote reads its designs again. The job's
   own Design section lists the same designs, outside the quote. */

/** One of the job's designs, as the quote's lines route gives it. */
export type QuoteDesignRow = { id: string; name: string; updatedAt: string };


/* the Studio in a tab of its own, so the quote keeps this one */
const keepQuote = (href: string) => {
  openInTab(href, `${window.location.pathname}${window.location.search}`);
};

/** How many of the job's designs the rail lists, newest first. */
const SHOWN = 3;

export function QuoteDesign({
  job,
  designs,
  state,
  busy = false,
  onSkip,
}: {
  job: string;
  designs: readonly QuoteDesignRow[];
  state: DesignState;
  busy?: boolean;
  /** No design pressed (true), or taken back (false) */
  onSkip: (skip: boolean) => void;
}) {
  /* Design it: the Studio on the job, its newest design or a new one on it */
  const designIt = studioJobHref(job);
  return (
    <section className="qc-rs" aria-label="Design">
      <h2 className="qc-h">Design</h2>
      {state === "drawn" ? (
        <RowList label="The job's designs">
          {designs.slice(0, SHOWN).map((d) => (
            <Row
              key={d.id}
              name={d.name}
              line={`Edited ${fmtAuWeekdayDayMonth(auDayOf(d.updatedAt))}`}
              end={
                <Button kind="quiet" size={32} href={designHref(d.id)} onClick={() => keepQuote(designHref(d.id))}>
                  Open design
                </Button>
              }
            />
          ))}
        </RowList>
      ) : state === "open" ? (
        <>
          <p className="qc-dsl">No design yet</p>
          <div className="qc-pair">
            <Button href={designIt} onClick={() => keepQuote(designIt)}>
              Design it
            </Button>
            <Button kind="quiet" disabled={busy} onClick={() => onSkip(true)}>
              Price without a design
            </Button>
          </div>
        </>
      ) : (
        <div className="qc-dsk">
          <p className="qc-dsl">Priced without a design</p>
          <Button kind="quiet" size={32} href={designIt} onClick={() => keepQuote(designIt)}>
            Design it
          </Button>
        </div>
      )}
    </section>
  );
}
