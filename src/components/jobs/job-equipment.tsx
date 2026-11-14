"use client";

import { useEffect, useState } from "react";
import { Fade } from "@/components/parts/fade";
import { StateWord } from "@/components/parts/state";
import type { EquipmentRow } from "@/lib/stock/stock";
import { JobSection } from "./job-section";

/* EQUIPMENT, ON A JOB'S OVERVIEW (Isaac, 13 November 2026, board 9 of
   https://claude.ai/artifact/MpMUX46rk45j6dP6ZYnEsu, "Build it"): Stock's
   read of the job, under its brief. Each unit and control its quote needs,
   the visit it's wanted at, and where it's up to: In stock, Ordered, To site
   on the day it lands, in someone's van, or still to order. So nobody loads
   at the factory what's going straight to site. Nothing to tick here: Stock
   is where it's ticked. Shown only when Stock has something for the job. */

export function JobEquipment({ jobId }: { jobId: string }) {
  const [rows, setRows] = useState<EquipmentRow[] | null>(null);
  useEffect(() => {
    let live = true;
    void fetch(`/api/stock/job?job=${encodeURIComponent(jobId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; rows?: EquipmentRow[] } | null) => {
        if (live) setRows(j?.ok && j.rows ? j.rows : []);
      })
      .catch(() => {
        if (live) setRows([]);
      });
    return () => {
      live = false;
    };
  }, [jobId]);
  if (!rows?.length) return null;
  return (
    <JobSection name="Equipment" icon="box" hue="yellow" className="jov-equip">
      <ul className="jeq">
        {rows.map((r) => (
          <li key={r.key} className="jeq-row">
            <span className="jeq-n">{r.group === "duct" ? "" : r.qty}</span>
            <span className="jeq-mid">
              <Fade className="jeq-t">{r.title}</Fade>
              <Fade className="jeq-s">{[r.when, r.group === "duct" ? r.detail : r.detail !== r.title ? r.detail : null].filter(Boolean).join(", ")}</Fade>
            </span>
            {r.word ? <StateWord tone={r.word.tone}>{r.word.word}</StateWord> : null}
          </li>
        ))}
      </ul>
    </JobSection>
  );
}
