"use client";

import { useState, type ReactNode } from "react";
import { StateWord } from "@/components/parts/state";
import { Tick } from "@/components/parts/tick";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { NextVisit, RailTask } from "@/lib/jobs/job-conversation";

/* THE RAIL OF A JOB'S OVERVIEW (v2, step 6, slice A; the board JC-1).

   Three groups, each under a thin line (rule 35), then what was on the
   Overview's side before (the customer):

     Where it's up to   the job's stored summary, one paragraph, with the
                        day it was written in grey;
     To do on this job  its open tasks, each a tick with the task's name
                        and who and when in grey; a tick closes it, and the
                        toast's Undo opens it again;
     Next visit         its day and time and who is booked, and a word in
                        orange where the time isn't settled.

   Under them, the job's own words as the office wrote them (folded to two
   lines with Show all, as the summary face folded them) and ServiceM8's
   invoice description, which the summary face carried and the rail keeps. */

export function JobRail({
  upTo,
  upToOn,
  upToPending,
  tasks,
  tasksRead,
  onTick,
  next,
  what,
  invoice,
  children,
}: {
  /** Where it's up to, one paragraph; null when nothing is written yet. */
  upTo: string | null;
  /** The day the summary was written, ISO. */
  upToOn: string | null;
  upToPending: boolean;
  tasks: RailTask[];
  /** The tasks have been read (empty means none, not not-yet). */
  tasksRead: boolean;
  onTick: (task: RailTask) => void;
  next: NextVisit | null;
  /** The job's words, as the office wrote them. */
  what: string;
  /** ServiceM8's invoice description, when it has one. */
  invoice: string | null;
  /** The customer, and anything else the Overview's side carries. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const folds = what.length > 180 || /\n\s*\S/.test(what);
  return (
    <aside className="jc-rail" aria-label="About the job">
      <section className="jc-group" aria-labelledby="jc-upto">
        <h2 className="jc-h" id="jc-upto">
          Where it&rsquo;s up to
        </h2>
        {upTo ? (
          <>
            <p className="jc-read">{upTo}</p>
            {upToOn && <p className="jc-cap">{`Written ${fmtAuWeekdayDayMonth(upToOn)}`}</p>}
          </>
        ) : upToPending ? (
          <p className="jc-cap">Reading where the job is up to</p>
        ) : (
          <p className="jc-cap">Nothing written about it yet.</p>
        )}
      </section>

      <section className="jc-group" aria-labelledby="jc-todo">
        <h2 className="jc-h" id="jc-todo">
          To do on this job
        </h2>
        {tasks.length > 0 ? (
          <ul className="jc-tasks">
            {tasks.map((t) => (
              <li key={t.id}>
                <Tick
                  checked={false}
                  onChange={() => onTick(t)}
                  label={
                    <span className="jc-task">
                      <span className="jc-task-name">{t.title}</span>
                      <span className="jc-task-line">{t.line}</span>
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="jc-cap">{tasksRead ? "Nothing to do on it." : "Reading the job's tasks"}</p>
        )}
      </section>

      <section className="jc-group" aria-labelledby="jc-next">
        <h2 className="jc-h" id="jc-next">
          Next visit
        </h2>
        {next ? (
          <>
            <p className="jc-read">{`${next.when}${next.who ? `, ${next.who}` : ""}.`}</p>
            {next.state && <StateWord tone={next.state.tone}>{next.state.word}</StateWord>}
          </>
        ) : (
          <p className="jc-cap">Nothing booked.</p>
        )}
      </section>

      {(what || invoice) && (
        <section className="jc-group" aria-labelledby="jc-what">
          <h2 className="jc-h" id="jc-what">
            The job
          </h2>
          {what && (
            <>
              <p className={`jc-what${folds && !open ? " jc-what--folded" : ""}`}>{what}</p>
              {folds && (
                <button type="button" className="jc-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
                  {open ? "Show less" : "Show all"}
                </button>
              )}
            </>
          )}
          {invoice && (
            <>
              <p className="jc-cap">Invoice description</p>
              <p className="jc-what">{invoice}</p>
            </>
          )}
        </section>
      )}

      {children}
    </aside>
  );
}
