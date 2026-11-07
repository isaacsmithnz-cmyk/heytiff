"use client";

import { Button } from "@/components/parts/button";
import { Row, RowList } from "@/components/parts/row";
import { Empty, Loading } from "@/components/parts/states";
import { openInTab } from "@/components/shell/open-tabs";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { designHref, studioJobHref } from "@/lib/shell/links";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";

/* A JOB'S DESIGN (Isaac, 28 October 2026: "It's going to have to be a
   separate tab outside of ... the quoting. And the quoting can just go back
   to that when it needs to"). A section of its own, after Quote, so nobody
   goes through the quote to look at a design. One heading and one blue New
   design, as Documents has one Add; under it the job's designs, newest
   first, each a v2 row with Open design, as the quote's Design step lists
   them. New design opens the Studio's New design with the job filled in and
   fixed, so a job's second design is one press too.

   The Studio opens in a tab of its own, so the job keeps this one, as the
   quote's Design step does. */

/** A design's grey line: its floors, its systems and when it was last edited. */
export const designRowLine = (d: MirrorJobDetail["designs"][number]): string =>
  `${d.floorCount} ${d.floorCount === 1 ? "floor" : "floors"}, ` +
  `${d.systemCount} ${d.systemCount === 1 ? "system" : "systems"}, ` +
  `edited ${fmtAuWeekdayDayMonth(auDayOf(d.updatedAt))}`;

/* the Studio in a tab of its own, so the job keeps this one */
const keepJob = (href: string) => {
  openInTab(href, `${window.location.pathname}${window.location.search}`);
};

export function JobDesignFace({
  job,
  designs,
  loading,
}: {
  /** The job's ServiceM8 uuid, which the Studio opens New design on. */
  job: string;
  designs: MirrorJobDetail["designs"];
  /** The job is still being read. */
  loading: boolean;
}) {
  const fresh = studioJobHref(job, true);
  return (
    <div className="jdoc">
      <div className="jdoc-head">
        <h2 className="jdoc-h">Design</h2>
        <Button kind="main" icon="plus" href={fresh} onClick={() => keepJob(fresh)}>
          New design
        </Button>
      </div>
      {designs.length > 0 ? (
        <RowList label="The job's designs">
          {designs.map((d) => (
            <Row
              key={d.id}
              name={d.name}
              line={designRowLine(d)}
              end={
                <Button kind="quiet" size={32} href={designHref(d.id)} onClick={() => keepJob(designHref(d.id))}>
                  Open design
                </Button>
              }
            />
          ))}
        </RowList>
      ) : loading ? (
        <Loading what="Reading the job's designs" />
      ) : (
        <Empty what="No design on this job" action={null} />
      )}
    </div>
  );
}
