"use client";

import { useEffect, useState } from "react";
import { IconButton } from "@/components/parts/button";
import { Field, TextInput } from "@/components/parts/field";

/** A job as a form's record field names it: "Job 3209, Richards Building,
    North Narrabeen". */
export type FormJob = { uuid: string; label: string };

/** Search's own reader, fetched when a search is typed: the forms that
    carry this field open from a job's card and from Home, and the reader
    waits until a job is looked for. Outside the component, where the
    compiler doesn't have to lower an import. */
const findJobs = (term: string) => import("@/app/actions/palette").then(({ searchPalette }) => searchPalette(term));

/* THE JOB (rule 51): a field, filled in, that you can change or clear.
   Empty, it finds a job by number, client or site, as Search does. The
   task form's job, and the Visit form's, which empty says "Find a job". */
export function JobField({
  job,
  onChange,
  placeholder = "None, a general task",
}: {
  job: FormJob | null;
  onChange: (j: FormJob | null) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<FormJob[]>([]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      void findJobs(term).then((f) => {
        if (!live) return;
        setHits(
          f.jobs.slice(0, 6).map((j) => ({
            uuid: j.remoteId,
            label: [j.jobNumber ? `Job ${j.jobNumber}` : "Job", j.clientName, j.suburb].filter(Boolean).join(", "),
          })),
        );
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  if (job) {
    return (
      <Field label="Job">
        <div className="mk-job">
          <span className="mk-job-name">{job.label}</span>
          <IconButton glyph="clear" label="Clear the job" size={32} onClick={() => onChange(null)} />
        </div>
      </Field>
    );
  }
  return (
    <Field label="Job">
      <div className="mk-jobfind">
        <TextInput value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)} />
        {q.trim().length >= 2 && hits.length > 0 && (
          <ul className="mk-jobhits" aria-label="Jobs">
            {hits.map((h) => (
              <li key={h.uuid}>
                <button
                  type="button"
                  className="mk-jobhit"
                  onClick={() => {
                    onChange(h);
                    setQ("");
                    setHits([]);
                  }}
                >
                  {h.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}
